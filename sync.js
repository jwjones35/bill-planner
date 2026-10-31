'use strict';
/* Bill Planner: keeping phones in sync.
   - Every linked phone shares a household id and a secret key. The key never leaves the phones: everything sent
     to the sync storage is encrypted with it first (AES-GCM), so the storage only ever holds scrambled data.
   - Each change is stamped with the time it was made; when two phones changed things, both are merged record by
     record, and the newer change wins.
   - A new phone joins with a one-time 8-character code (works once, for 15 minutes).
   Loaded before app.js; everything here runs only after the app has started. */

const SYNC_CFG_KEY = 'billplanner.sync';      // { id, secret, ver, hash, last } on this phone only
const BANK_UPD_KEY = 'billplanner.bankUpd';   // when the bank connection was last changed on this phone
const SYNC_DEFAULT = 'https://bill-planner-sync.bill-planner-sync.workers.dev';
const PAIR_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
function syncBase() {
  // For testing on this PC, a local sync server can be used instead.
  try { const o = localStorage.getItem('billplanner.syncUrl'); if (o && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return o; } catch (e) { }
  return SYNC_DEFAULT;
}

/* ---------- small helpers ---------- */
const syncCfg = () => { try { return JSON.parse(localStorage.getItem(SYNC_CFG_KEY)) || null; } catch (e) { return null; } };
const setSyncCfg = c => { try { if (c) localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(SYNC_CFG_KEY); } catch (e) { } };
const syncLinked = () => !!syncCfg();
const bankUpd = () => { try { return Number(localStorage.getItem(BANK_UPD_KEY)) || 0; } catch (e) { return 0; } };
const setBankUpd = t => { try { localStorage.setItem(BANK_UPD_KEY, String(t)); } catch (e) { } };
function b64uEnc(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDec(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
const randBytes = n => crypto.getRandomValues(new Uint8Array(n));
const utf8 = s => new TextEncoder().encode(s);
async function sha256hex(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s)))].map(x => x.toString(16).padStart(2, '0')).join(''); }

/* ---------- encryption ---------- */
async function hkdfBase(secretBytes) { return crypto.subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveKey', 'deriveBits']); }
const hkdfParams = info => ({ name: 'HKDF', hash: 'SHA-256', salt: utf8('bill-planner-sync'), info: utf8(info) });
let keyCache = null;
async function syncKeys(cfg) {
  if (keyCache && keyCache.secret === cfg.secret) return keyCache;
  const base = await hkdfBase(b64uDec(cfg.secret));
  const key = await crypto.subtle.deriveKey(hkdfParams('data'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const token = b64uEnc(await crypto.subtle.deriveBits(hkdfParams('auth'), base, 256));
  return (keyCache = { secret: cfg.secret, key, token });
}
async function gz(bytes, how) {
  const stream = new Blob([bytes]).stream().pipeThrough(how === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function encryptJson(key, obj) {
  let bytes = utf8(JSON.stringify(obj)), tag = 'p1';
  if (typeof CompressionStream === 'function') { bytes = await gz(bytes, 'c'); tag = 'g1'; }
  const iv = randBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return `${tag}.${b64uEnc(iv)}.${b64uEnc(ct)}`;
}
async function decryptJson(key, str) {
  const [tag, iv, ct] = String(str).split('.');
  let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDec(iv) }, key, b64uDec(ct)));
  if (tag === 'g1') {
    if (typeof DecompressionStream !== 'function') throw new Error('This phone needs an iOS update to sync.');
    bytes = await gz(bytes, 'd');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ---------- change stamps and merging ----------
   Records are compared with how they looked at the last save; anything new or changed gets upd = now, and anything
   removed leaves a "tombstone" so the other phone removes it too. Settings get a stamp per field. */
const SYNC_COLL = {
  bills: r => r.id, incomes: r => r.id, setAsides: r => r.id, infos: r => r.id, spending: r => r.id,
  payments: r => r.billId + '|' + r.due, receipts: r => r.incomeId + '|' + r.date
};
const SYNC_FIELDS = ['setupDate', 'balances', 'everydayPerWeek', 'savingsBuffer', 'suggestSavings', 'lastBackup', 'autopayWait'];
const SYNC_BANK_LWW = ['labels', 'txNames', 'manual', 'feeAlerts', 'priceAlerts'];
const SYNC_BANK_UNION = ['ignore', 'noFeePairs', 'feeRules'];
const SYNC_BANK_FEED = ['accounts', 'tx', 'bal', 'fetchedAt', 'error', 'fetchLog', 'checkingId', 'savingsId'];
const noUpd = (k, v) => (k === 'upd' ? undefined : v);
let syncSnap = null;
function syncTakeSnap() {
  if (!S) { syncSnap = null; return; }
  const snap = { rec: {}, f: {} };
  for (const [c, kf] of Object.entries(SYNC_COLL)) for (const r of S[c] || []) snap.rec[c + '|' + kf(r)] = JSON.stringify(r, noUpd);
  for (const f of SYNC_FIELDS) snap.f[f] = JSON.stringify(S[f]);
  for (const f of SYNC_BANK_LWW) snap.f['bank.' + f] = JSON.stringify(S.bank[f]);
  syncSnap = snap;
}
function syncStamp() {
  if (!S || !syncLinked()) return;
  if (!syncSnap) { syncTakeSnap(); return; }
  const now = Date.now(), seen = new Set();
  S.tomb = S.tomb || {}; S.fupd = S.fupd || {};
  for (const [c, kf] of Object.entries(SYNC_COLL)) for (const r of S[c] || []) {
    const k = c + '|' + kf(r); seen.add(k);
    if (syncSnap.rec[k] !== JSON.stringify(r, noUpd)) { r.upd = now; delete S.tomb[k]; }
  }
  for (const k of Object.keys(syncSnap.rec)) if (!seen.has(k)) S.tomb[k] = now;
  for (const f of SYNC_FIELDS) if (syncSnap.f[f] !== JSON.stringify(S[f])) S.fupd[f] = now;
  for (const f of SYNC_BANK_LWW) if (syncSnap.f['bank.' + f] !== JSON.stringify(S.bank[f])) S.fupd['bank.' + f] = now;
  // Tombstones older than about 4 months are no longer needed.
  for (const [k, t] of Object.entries(S.tomb)) if (now - t > 120 * 86400000) delete S.tomb[k];
  syncTakeSnap();
}
function mergeStates(L, R) {
  const out = JSON.parse(JSON.stringify(L));
  const tomb = Object.assign({}, L.tomb || {});
  for (const [k, t] of Object.entries(R.tomb || {})) tomb[k] = Math.max(t, tomb[k] || 0);
  const fu = Object.assign({}, L.fupd || {}), rfu = R.fupd || {};
  for (const [c, kf] of Object.entries(SYNC_COLL)) {
    const m = new Map();
    for (const r of L[c] || []) m.set(kf(r), r);
    for (const r of R[c] || []) { const k = kf(r), l = m.get(k); if (!l || (r.upd || 0) > (l.upd || 0)) m.set(k, r); }
    out[c] = [...m.values()].filter(r => !(tomb[c + '|' + kf(r)] > (r.upd || 0)));
  }
  for (const f of SYNC_FIELDS) if ((rfu[f] || 0) > (fu[f] || 0)) { out[f] = R[f]; fu[f] = rfu[f]; }
  const lb = L.bank || {}, rb = R.bank || {};
  out.bank = out.bank || {};
  // Bank data: whichever phone heard from the bank most recently.
  if ((rb.fetchedAt || 0) > (lb.fetchedAt || 0)) for (const f of SYNC_BANK_FEED) out.bank[f] = rb[f];
  for (const f of SYNC_BANK_LWW) { const k = 'bank.' + f; if ((rfu[k] || 0) > (fu[k] || 0)) { out.bank[f] = rb[f]; fu[k] = rfu[k]; } }
  for (const f of SYNC_BANK_UNION) out.bank[f] = [...new Set([...(lb[f] || []), ...(rb[f] || [])])].slice(-400);
  out.tomb = tomb; out.fupd = fu;
  return out;
}
function syncPayload() {
  const st = JSON.parse(JSON.stringify(S));
  if (st.bank) { delete st.bank.suggest; delete st.bank.autoLog; }
  return { v: 1, state: st, bank: { url: bankAccess(), upd: bankUpd() } };
}

/* ---------- the sync itself ---------- */
let syncBusy = false, syncAgain = false, syncTimer = null, syncApplying = false;
let syncStatus = { at: 0, error: null };
async function api(method, path, token, body) {
  const r = await fetch(syncBase() + path, {
    method, cache: 'no-store',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null; try { j = await r.json(); } catch (e) { }
  return { status: r.status, j };
}
// Bring in the other phone's changes and send this phone's. Safe to call often.
async function syncNow() {
  const cfg = syncCfg();
  if (!cfg || !S) return;
  if (!navigator.onLine) { syncStatus.error = 'Offline. Changes will sync when the phone is back online.'; return; }
  if (syncBusy) { syncAgain = true; return; }
  syncBusy = true;
  try {
    const k = await syncKeys(cfg);
    for (let attempt = 0; attempt < 4; attempt++) {
      const g = await api('GET', `/v1/h/${cfg.id}`, k.token);
      let ver = 0, remoteHash = null;
      if (g.status === 200) {
        ver = g.j.ver;
        if (ver !== cfg.ver) {
          const remote = await decryptJson(k.key, g.j.data);
          syncApply(remote);
          remoteHash = await sha256hex(JSON.stringify(remote.state) + '|' + remote.bank.url + '|' + remote.bank.upd);
        }
      } else if (g.status === 404 && cfg.ver > 0) {
        // The shared copy was deleted from the other phone ("stop for all phones"): stop here too, keep this phone's data.
        setSyncCfg(null); syncSnap = null;
        syncStatus = { at: 0, error: null };
        toast('Sharing was turned off from the other phone. This phone keeps its copy.');
        render();
        return;
      } else if (g.status === 403) throw new Error("This phone's sync link no longer works. Link it again under More.");
      else if (g.status !== 404) throw new Error(`The sync storage answered with error ${g.status}.`);
      const p = syncPayload();
      const hash = await sha256hex(JSON.stringify(p.state) + '|' + p.bank.url + '|' + p.bank.upd);
      if (g.status === 200 && (hash === remoteHash || (remoteHash === null && hash === cfg.hash))) { cfg.ver = ver; cfg.hash = hash; break; }
      const put = await api('PUT', `/v1/h/${cfg.id}`, k.token, { ver, data: await encryptJson(k.key, p) });
      if (put.status === 200) { cfg.ver = put.j.ver; cfg.hash = hash; break; }
      if (put.status !== 409) throw new Error(`The sync storage answered with error ${put.status}.`);
      // Someone saved first: go round again, merging their version.
    }
    cfg.last = Date.now(); setSyncCfg(Object.assign(syncCfg() || {}, { ver: cfg.ver, hash: cfg.hash, last: cfg.last }));
    syncStatus = { at: Date.now(), error: null };
  } catch (e) {
    syncStatus.error = e.message || "Couldn't sync.";
  } finally {
    syncBusy = false;
    if (syncAgain) { syncAgain = false; setTimeout(syncNow, 300); }
  }
}
function syncApply(remote) {
  syncApplying = true;
  try {
    const merged = mergeStates(S, remote.state || {});
    if (remote.bank && (remote.bank.upd || 0) > bankUpd()) { setBankAccess(remote.bank.url || ''); setBankUpd(remote.bank.upd); }
    S = normalize(merged);
    if (bankOn()) runMatching();
    save();
    syncTakeSnap();
  } finally { syncApplying = false; }
  render();
}
// Called by save(): send changes a moment later (several quick saves become one sync).
function syncSoon() {
  if (syncApplying || !syncLinked()) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500);
}

/* ---------- linking phones ---------- */
async function syncStart() {
  const cfg = { id: b64uEnc(randBytes(16)), secret: b64uEnc(randBytes(32)), ver: 0, hash: null, last: 0 };
  setSyncCfg(cfg);
  syncTakeSnap();
  if (!bankUpd() && bankAccess()) setBankUpd(Date.now());
  await syncNow();
  if (syncStatus.error) { setSyncCfg(null); throw new Error(syncStatus.error); }
}
const fmtCode = c => c.slice(0, 4) + '-' + c.slice(4);
async function pairKey(code) { return crypto.subtle.deriveKey(hkdfParams('pair'), await hkdfBase(utf8('bp-pair:' + code)), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function syncMakeCode() {
  const cfg = syncCfg(); if (!cfg) throw new Error('Syncing is not on.');
  const r = randBytes(8); let code = '';
  for (const b of r) code += PAIR_CHARS[b % PAIR_CHARS.length];
  const blob = await encryptJson(await pairKey(code), { id: cfg.id, secret: cfg.secret });
  const res = await api('PUT', `/v1/pair/${await sha256hex('bp-pair:' + code)}`, null, { data: blob });
  if (res.status !== 200) throw new Error(`Couldn't make a code (error ${res.status}). Check the internet connection.`);
  return code;
}
async function syncJoin(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (code.length !== 8 || [...code].some(ch => !PAIR_CHARS.includes(ch))) throw new Error('The code has 8 letters and numbers, like KX4P-9TRM.');
  const res = await api('GET', `/v1/pair/${await sha256hex('bp-pair:' + code)}`);
  if (res.status === 404) throw new Error("That code didn't work. Codes work once, for 15 minutes; make a new one on the other phone.");
  if (res.status !== 200) throw new Error(`Couldn't join (error ${res.status}). Check the internet connection.`);
  const { id, secret } = await decryptJson(await pairKey(code), res.j.data);
  const cfg = { id, secret, ver: 0, hash: null, last: 0 };
  const k = await syncKeys(cfg);
  const g = await api('GET', `/v1/h/${id}`, k.token);
  if (g.status !== 200) throw new Error("Couldn't load the shared data. Try again in a minute.");
  const remote = await decryptJson(k.key, g.j.data);
  // Joining replaces whatever was on this phone with the shared copy.
  S = normalize(remote.state);
  setBankAccess(remote.bank && remote.bank.url || ''); setBankUpd(remote.bank && remote.bank.upd || 0);
  cfg.ver = g.j.ver; cfg.hash = await sha256hex(JSON.stringify(remote.state) + '|' + remote.bank.url + '|' + remote.bank.upd); cfg.last = Date.now();
  setSyncCfg(cfg);
  syncApplying = true; try { save(); } finally { syncApplying = false; }
  syncTakeSnap();
  syncStatus = { at: Date.now(), error: null };
}
async function syncStop(deleteOnline) {
  const cfg = syncCfg(); if (!cfg) return;
  if (deleteOnline) { const k = await syncKeys(cfg); await api('DELETE', `/v1/h/${cfg.id}`, k.token); }
  setSyncCfg(null); syncSnap = null;
}

/* ---------- screens ---------- */
function syncCardHtml() {
  const cfg = syncCfg();
  if (!cfg) return `<h2>Share with another phone</h2><div class="card pad">
    <p style="margin-top:0">Keep this app the same on two phones (for example yours and your spouse's). Bills, payments, paychecks, spending and the bank connection update on both by themselves.</p>
    <div class="btns"><button class="btn" data-act="syncOn">Turn on sharing</button></div>
    <div class="btns"><button class="btn ghost" data-act="syncJoin">Join another phone's app</button></div>
    <p class="hint">Everything is locked with a key that stays on your phones before it's sent, so the storage it passes through can't read it.</p></div>`;
  const when = syncStatus.at || cfg.last;
  return `<h2>Share with another phone</h2><div class="card pad">
    <div><b>Sharing is on</b></div>
    <div class="small ${syncStatus.error ? 'neg' : 'muted'}">${syncStatus.error ? esc(syncStatus.error) : when ? `Last synced ${timeAgo(when)}` : 'Not synced yet'}</div>
    <div class="btns"><button class="btn" data-act="syncAdd">Add another phone</button><button class="btn ghost" data-act="syncNow">Sync now</button></div>
    <p class="small" style="margin:22px 0 0;text-align:right"><a href="#" data-act="syncOff" class="muted">Stop sharing…</a></p></div>`;
}
function sheetSyncCode(code) {
  openSheet(`<h3>Add another phone</h3>
    <p>On the other phone:</p>
    <ol style="padding-left:20px;margin:6px 0">
      <li>Open <b>Safari</b> and go to<br><b>jwjones35.github.io/bill-planner</b></li>
      <li>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open <b>Bills</b> from the Home Screen and tap <b>Join another phone's app</b>.</li>
      <li>Type this code:</li></ol>
    <div style="font:700 34px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;text-align:center;padding:14px;background:var(--chip);border-radius:12px;margin:8px 0">${fmtCode(code)}</div>
    <p class="hint">The code works once, for 15 minutes. Need another? Tap Add another phone again.</p>
    <div class="btns"><button class="btn" data-act="close">Done</button></div>`);
}
function sheetSyncJoin(err) {
  openSheet(`<form id="fJoin"><h3>Join another phone's app</h3>
    <p class="hint">On the phone that already has the app set up: <b>More › Share with another phone › Add another phone</b>. It shows a code; type it here.</p>
    ${S && (S.bills.length || S.incomes.length) ? '<div class="banner warn">Joining replaces what is on this phone with the shared copy.</div>' : ''}
    ${err ? `<div class="form-error">${esc(err)}</div>` : ''}
    <label for="jCode">Code</label><input id="jCode" name="code" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="KX4P-9TRM" style="font-size:22px;letter-spacing:.08em;text-transform:uppercase">
    <div class="btns">${cancelBtn}<button class="btn">Join</button></div></form>`);
  setTimeout(() => { const i = document.getElementById('jCode'); if (i) i.focus(); }, 250);
}
// Stopping is deliberately hard to do by accident: the word has to be typed before the button works.
function sheetSyncOff() {
  openSheet(`<h3>Stop sharing?</h3>
    <form id="fSyncOff" data-word="STOP">
      <p>This phone keeps everything it has now, but <b>stops updating with the other phone</b>. Changes made on either phone after this won't show on the other. To share again later, you'd link the phones again with a new code.</p>
      <label for="soWord">To stop sharing on this phone, type <b>STOP</b></label>
      <input id="soWord" name="word" autocapitalize="characters" autocomplete="off" spellcheck="false" data-act="offWord">
      <div class="btns"><button type="button" class="btn" data-act="close">Keep sharing</button><button class="btn danger" disabled>Stop sharing</button></div>
    </form>
    <details style="margin-top:22px"><summary class="small muted">Stop for every phone and delete the online copy…</summary>
      <form id="fSyncOffAll" data-word="DELETE">
        <p class="small">Sharing stops on <b>every</b> phone, and the copy stored online is deleted. Each phone keeps what it has now.</p>
        <label for="soAll">To do this, type <b>DELETE</b></label>
        <input id="soAll" name="word" autocapitalize="characters" autocomplete="off" spellcheck="false" data-act="offWord">
        <div class="btns"><button class="btn danger" disabled>Stop for every phone and delete</button></div>
      </form></details>`);
}
// The Stop buttons only work once the word is typed exactly.
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.act !== 'offWord') return;
  const f = el.form, btn = f.querySelector('button.danger');
  if (btn) btn.disabled = el.value.trim().toUpperCase() !== f.dataset.word;
});
document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.id !== 'fSyncOff' && f.id !== 'fSyncOffAll') return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (String(new FormData(f).get('word') || '').trim().toUpperCase() !== f.dataset.word) return;
  await syncAct(f.id === 'fSyncOff' ? 'syncOffYes' : 'syncOffAll');
}, true);
// Button and form handlers (the app's own handlers pass anything they don't know here).
async function syncAct(act) {
  try {
    if (act === 'syncOn') { toast('Turning on sharing...'); await syncStart(); render(); sheetSyncCode(await syncMakeCode()); return true; }
    if (act === 'syncAdd') { sheetSyncCode(await syncMakeCode()); return true; }
    if (act === 'syncJoin') { sheetSyncJoin(); return true; }
    if (act === 'syncNow') { await syncNow(); render(); toast(syncStatus.error || 'Synced.'); return true; }
    if (act === 'syncOff') { sheetSyncOff(); return true; }
    if (act === 'syncOffYes') { await syncStop(false); closeSheet(); render(); toast('Sharing is off on this phone.'); return true; }
    if (act === 'syncOffAll') { await syncStop(true); closeSheet(); render(); toast('Sharing is off, and the online copy is deleted.'); return true; }
  } catch (e) { toast(e.message || 'Something went wrong.'); return true; }
  return false;
}
async function syncSubmitJoin(f) {
  const btn = f.querySelector('button.btn:not(.ghost)'); btn.disabled = true; btn.textContent = 'Joining...';
  try {
    await syncJoin(new FormData(f).get('code'));
    closeSheet(); tab = 'home'; render();
    toast('Joined. This phone now shares the app with the other one.');
    try { localStorage.removeItem('billplanner.profileAsked'); } catch (e) { }
    setTimeout(askProfileOnce, 600);
    fetchBank(false);
  } catch (e) { sheetSyncJoin(e.message); }
}
