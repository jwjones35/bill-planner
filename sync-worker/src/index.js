/* Bill Planner sync storage (Cloudflare Worker + D1).
   It only ever holds scrambled (end-to-end encrypted) data: the key to read it never leaves the linked phones.
   Each household is one row: an id, a hash of its access token, a version number and the encrypted data.

   GET    /v1/h/:id   -> { ver, data }            (404 if none yet)
   PUT    /v1/h/:id   { ver, data } -> { ver }    (409 with the current { ver, data } if someone saved first)
   DELETE /v1/h/:id   -> { ok: true }
   Every request needs "Authorization: Bearer <token>". */

// The app's address, plus two addresses on the developer's own PC for testing as two separate phones.
const ALLOWED = ['https://jwjones35.github.io', 'http://127.0.0.1:8770', 'http://127.0.0.1:8771'];
const MAX = 1_500_000; // characters of encrypted data per household

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// Compare two strings without leaking how much of them matched.
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- Web Push (RFC 8291 encryption + VAPID), with the browser's built-in crypto ---------- */
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function concat(...parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function encryptPush(sub, text) {
  const uaPublic = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(86); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65; head.set(asPublic, 21);
  return concat(head, ct);
}
async function vapid(env, endpoint) {
  // (The stored secret may start with an invisible byte-order mark from Windows; skip it.)
  const jwk = JSON.parse(String(env.VAPID_PRIVATE_JWK).replace(/^﻿/, '').trim());
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + p));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
async function sendPush(env, sub, text) {
  const r = await fetch(sub.endpoint, {
    redirect: 'manual',
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: await vapid(env, sub.endpoint) },
    body: await encryptPush(sub, text)
  });
  // The phone turned notifications off or the app was removed: forget it.
  if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(sub.endpoint).run();
  sendPush.lastReason = r.status >= 300 ? (await r.text()).slice(0, 200) : '';
  return r.status;
}
const PUSH_HOSTS = /^https:\/\/([a-z0-9.-]+\.)?(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
// Every 15 minutes: send each household's reminders that are due, then keep only the later ones.
async function sendDue(env) {
  const now = Date.now();
  const rows = (await env.DB.prepare('SELECT household, items FROM sched').all()).results || [];
  for (const row of rows) {
    let items; try { items = JSON.parse(row.items); } catch (e) { items = []; }
    const due = items.filter(i => i.at <= now), later = items.filter(i => i.at > now);
    if (!due.length) continue;
    const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth, who FROM subs WHERE household = ?').bind(row.household).all()).results || [];
    // Reminders more than 6 hours late (storage was down, etc.) are skipped rather than sent at an odd time.
    // A reminder with "to" goes only to that person's phone(s).
    for (const i of due.filter(i => now - i.at < 6 * 3600000)) for (const s of subs.filter(s => !i.to || s.who === i.to)) { try { await sendPush(env, s, i.data); } catch (e) { } }
    await env.DB.prepare('UPDATE sched SET items = ? WHERE household = ?').bind(JSON.stringify(later), row.household).run();
  }
}

/* ---------- around-the-clock bank check ----------
   Every 4 hours (every 2 while broken) the storage asks SimpleFIN for balances only, with the household's read-only
   key. It keeps no balances or transactions, only whether the connection works. When it breaks, every phone gets
   the "sign in again" notification; when it works again, the "working again" one. Both were encrypted by the phones.
   SimpleFIN allows about 24 requests a day per key and turns the key off if an app keeps going over, so this
   uses at most 4 a day (8 while broken) and each phone at most 8. Only a real sign-in problem counts as broken:
   no answer, a busy SimpleFIN (429, 5xx) or a temporary account message changes nothing. */
const BW_OK_EVERY = 6 * 3600000, BW_BROKEN_EVERY = 3 * 3600000;
// Older SimpleFIN answers have plain-text errors without a code: these words mean someone has to sign in again.
const BW_SIGNIN = /auth|sign.?in|log.?in|credential|password|mfa|reconnect|re-?link|expired/i;
const BW_QUOTA = /too many|quota|rate.?limit|request limit|limit (is |was |has been )?(reached|exceeded)|per day/i;
// Only SimpleFIN's own addresses (and, on the developer's PC, a pretend SimpleFIN for testing).
function bwHostOk(env, u) {
  try { const x = new URL(u); return (x.protocol === 'https:' && /(^|\.)simplefin\.org$/.test(x.hostname)) || (!!env.BW_TEST_HOST && x.hostname === env.BW_TEST_HOST); } catch (e) { return false; }
}
// One check: 'ok', 'broken' (with sure = it clearly needs a sign-in), or null when SimpleFIN couldn't be reached.
async function bwCheck(env, access) {
  let r;
  try {
    const u = new URL(access);
    const auth = 'Basic ' + btoa(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password));
    r = await fetch(`${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}/accounts?version=2&balances-only=1`, { headers: { Authorization: auth } });
  } catch (e) { return null; }
  if (r.status === 403 || r.status === 402) return { state: 'broken', sure: true };
  if (!r.ok) return null;
  let j; try { j = await r.json(); } catch (e) { return null; }
  const errs = [...(Array.isArray(j.errlist) ? j.errlist : []), ...(Array.isArray(j.errors) ? j.errors : [])]
    .map(e => (typeof e === 'string' ? { msg: e } : e || {}));
  if (!errs.length) return { state: 'ok' };
  // SimpleFIN codes: con.auth = the bank wants a new sign-in, gen.auth = the key isn't accepted.
  const signin = errs.some(e => {
    const code = String(e.code || ''), msg = String(e.msg || e.message || '');
    if (BW_QUOTA.test(msg)) return false;
    return code ? /^(con|gen)\.auth/.test(code) : BW_SIGNIN.test(msg);
  });
  // Anything else (account temporarily unavailable, missing data, a warning) is not a broken connection.
  return signin ? { state: 'broken', sure: true } : null;
}
async function bwRun(env, onlyId) {
  const now = Date.now();
  const rows = onlyId
    ? [await env.DB.prepare('SELECT * FROM bankwatch WHERE household = ?').bind(onlyId).first()].filter(Boolean)
    : (await env.DB.prepare('SELECT * FROM bankwatch').all()).results || [];
  for (const w of rows) {
    if (!env.BW_TEST_HOST && now - w.checked < (onlyId ? 10 * 60000 : (w.state === 'broken' ? BW_BROKEN_EVERY : BW_OK_EVERY) - 60000)) continue;
    const c = await bwCheck(env, w.access);
    if (!c) { await env.DB.prepare('UPDATE bankwatch SET checked = ? WHERE household = ?').bind(now, w.household).run(); continue; }
    let state = w.state, strikes = 0;
    if (c.state === 'ok') state = 'ok';
    else { strikes = w.strikes + 1; if (c.sure || strikes >= 2) state = 'broken'; }
    const changed = state !== w.state;
    // Notify on a real change (not the very first check after being set up, unless it's already broken).
    const note = changed && state === 'broken' ? w.broken : changed && state === 'ok' && w.state === 'broken' ? w.fixed : null;
    // A new problem (or a fix) starts the acknowledgements over.
    await env.DB.prepare('UPDATE bankwatch SET state = ?, strikes = ?, checked = ?, changed = ?, acked = ?, nagged = ? WHERE household = ?')
      .bind(state, strikes, now, changed ? now : w.changed, changed ? '[]' : w.acked, changed ? (state === 'broken' ? now : 0) : w.nagged, w.household).run();
    console.log(`bankwatch: ${w.state} -> ${state}${note ? (note === w.broken ? ' (sent: sign in again)' : ' (sent: working again)') : ''}`);
    if (note) {
      const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM subs WHERE household = ?').bind(w.household).all()).results || [];
      for (const s of subs) { try { await sendPush(env, s, note); } catch (e) { } }
    }
  }
}
// While broken: every hour, send "sign in again" again to each phone that hasn't acknowledged it.
// Not between 10 PM and 7 AM at home (the first alert goes out at any hour). No repeats when the household also
// has the live balance (Plaid): then "Available to spend" is still right, only new purchases wait.
const BW_NAG_EVERY = 3600000;
async function bwNag(env) {
  const now = Date.now();
  const rows = (await env.DB.prepare("SELECT household, broken, acked, nagged, tz FROM bankwatch WHERE state = 'broken'").all()).results || [];
  for (const w of rows) {
    if (await env.DB.prepare('SELECT 1 FROM plaid WHERE household = ?').bind(w.household).first()) continue;
    if (!env.BW_TEST_HOST && now - w.nagged < BW_NAG_EVERY - 60000) continue;
    const hour = new Date(now - (w.tz || 0) * 60000).getUTCHours();
    if (!env.BW_TEST_HOST && (hour < 7 || hour >= 22)) continue;
    let acked; try { acked = new Set(JSON.parse(w.acked)); } catch (e) { acked = new Set(); }
    const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM subs WHERE household = ?').bind(w.household).all()).results || [];
    let to = 0;
    for (const s of subs) {
      if (acked.has((await sha256(s.endpoint)).slice(0, 24))) continue;
      to++;
      try { await sendPush(env, s, w.broken); } catch (e) { }
    }
    console.log(`bankwatch: reminder for ${to} phone(s) not yet acknowledged`);
    await env.DB.prepare('UPDATE bankwatch SET nagged = ? WHERE household = ?').bind(now, w.household).run();
  }
}

/* ---------- live balance from the bank (Plaid) ----------
   SimpleFIN only gets new numbers from the bank about once a day. Plaid's Balance asks the bank right now.
   The household's Plaid access token stays here (never sent to the phones); the phones ask for the balance.
   Needs PLAID_CLIENT_ID (wrangler.toml), the Cloudflare secret PLAID_SECRET and PLAID_HOST (Plaid's address).
   The free Trial plan allows 10 bank connections in total, ever, so a connection is only made on purpose. */
async function plaidCall(env, path, body) {
  let r;
  try {
    r = await fetch(String(env.PLAID_HOST).replace(/\/$/, '') + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ client_id: env.PLAID_CLIENT_ID, secret: String(env.PLAID_SECRET || '').replace(/^﻿/, '').trim() }, body))
    });
  } catch (e) { return { error: { code: 'UNREACHABLE', msg: "Couldn't reach Plaid." } }; }
  let j = null; try { j = await r.json(); } catch (e) { }
  if (!r.ok || !j) return { error: { code: (j && j.error_code) || 'HTTP_' + r.status, msg: (j && (j.display_message || j.error_message)) || 'Plaid answered with error ' + r.status + '.' } };
  return { data: j };
}
// Only what the phones need: which account, and its balances.
const plaidAccounts = j => (j.accounts || []).map(a => ({
  id: a.account_id, name: a.official_name || a.name || 'Account', mask: a.mask || '', type: a.type, subtype: a.subtype,
  available: a.balances && a.balances.available != null ? a.balances.available : null,
  current: a.balances && a.balances.current != null ? a.balances.current : null
}));
const PLAID_MIN_GAP = 30000; // the same answer is reused for 30 seconds (both phones opening at once, double taps)
const PLAID_TX_GAP = 60000; // the purchase list is reused for 1 minute
const PLAID_REFRESH_GAP = 15 * 60000; // ask Plaid to check the bank for new purchases at most every 15 minutes
async function plaidRoute(req, env, id, body) {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET || !env.PLAID_HOST) return { s: 503, b: { error: 'not set up' } };
  const row = await env.DB.prepare('SELECT * FROM plaid WHERE household = ?').bind(id).first();
  const step = String(body.step || '');
  if (req.method === 'GET') return { s: 200, b: row ? { on: true, last: row.last, institution: row.institution } : { on: false } };
  if (req.method === 'POST' && step === 'link') {
    // A one-time code that opens Plaid's own sign-in window on the phone. update: fix an existing connection.
    const opts = { client_name: 'Bill Planner', user: { client_user_id: (await sha256('bp|' + id)).slice(0, 32) }, country_codes: ['US'], language: 'en' };
    if (body.update && row) opts.access_token = row.token; else opts.products = ['transactions'];
    const r = await plaidCall(env, '/link/token/create', opts);
    return r.error ? { s: 502, b: { error: r.error } } : { s: 200, b: { link_token: r.data.link_token } };
  }
  if (req.method === 'POST' && step === 'exchange') {
    const pt = String(body.public_token || '');
    if (!/^public-[a-z]+-[0-9a-f-]{20,80}$/.test(pt)) return { s: 400, b: { error: 'bad token' } };
    const r = await plaidCall(env, '/item/public_token/exchange', { public_token: pt });
    if (r.error) return { s: 502, b: { error: r.error } };
    // Replacing an earlier connection: tell Plaid to forget the old one.
    if (row && row.token !== r.data.access_token) await plaidCall(env, '/item/remove', { access_token: row.token });
    const inst = String(body.institution || '').slice(0, 80);
    await env.DB.prepare('INSERT OR REPLACE INTO plaid (household, token, item, institution, created, last, cache) VALUES (?, ?, ?, ?, ?, 0, NULL)').bind(id, r.data.access_token, r.data.item_id, inst, Date.now()).run();
    return { s: 200, b: { ok: true } };
  }
  if (req.method === 'POST' && step === 'balance') {
    if (!row) return { s: 404, b: { error: { code: 'NOT_CONNECTED', msg: 'No live balance connection yet.' } } };
    const now = Date.now();
    if (row.cache && now - row.last < PLAID_MIN_GAP) return { s: 200, b: JSON.parse(row.cache) };
    const r = await plaidCall(env, '/accounts/balance/get', { access_token: row.token });
    const out = r.error ? { error: r.error, at: now } : { accounts: plaidAccounts(r.data), at: now };
    await env.DB.prepare('UPDATE plaid SET last = ?, cache = ? WHERE household = ?').bind(now, JSON.stringify(out), id).run();
    console.log(`plaid: balance ${r.error ? 'error ' + r.error.code : 'ok'}`);
    return { s: 200, b: out };
  }
  if (req.method === 'POST' && step === 'tx') {
    // The last 10 days of purchases, so the spending list shows today's ones before SimpleFIN has them.
    if (!row) return { s: 404, b: { error: { code: 'NOT_CONNECTED', msg: 'No live balance connection yet.' } } };
    const now = Date.now();
    const c = await env.DB.prepare('SELECT last, cache FROM plaidtx WHERE household = ?').bind(id).first();
    const prev = c && c.cache ? JSON.parse(c.cache) : null;
    if (prev && now - c.last < PLAID_TX_GAP) return { s: 200, b: prev };
    // Plaid only updates its purchase list on its own schedule (it went 3 days without one), so ask it to
    // check the bank now. That runs in the background; the new purchases show on the next ask, a minute or so later.
    let refreshed = prev && prev.refreshed || 0;
    if (now - refreshed >= PLAID_REFRESH_GAP) {
      const rf = await plaidCall(env, '/transactions/refresh', { access_token: row.token });
      console.log(`plaid: refresh ${rf.error ? 'error ' + rf.error.code : 'ok'}`);
      if (!rf.error) refreshed = now;
    }
    const day =ms => new Date(ms - 6 * 3600000).toISOString().slice(0, 10); // US Central-ish calendar day
    const opts = { count: 250 };
    const acct = String(body.account || '');
    if (/^[A-Za-z0-9_-]{8,80}$/.test(acct)) opts.account_ids = [acct];
    const r = await plaidCall(env, '/transactions/get', { access_token: row.token, start_date: day(now - 10 * 86400000), end_date: day(now + 86400000), options: opts });
    const out = r.error ? { error: r.error, at: now, refreshed } : {
      at: now, refreshed,
      tx:(r.data.transactions || []).map(t => ({
        id: t.transaction_id, acct: t.account_id, date: t.authorized_date || t.date, amount: t.amount,
        name: t.merchant_name || t.name || '', pending: !!t.pending
      }))
    };
    await env.DB.prepare('INSERT OR REPLACE INTO plaidtx (household, last, cache) VALUES (?, ?, ?)').bind(id, now, JSON.stringify(out)).run();
    console.log(`plaid: tx ${r.error ? 'error ' + r.error.code : 'ok ' + out.tx.length}`);
    return { s: 200, b: out };
  }
  if (req.method === 'DELETE') {
    if (row) { await plaidCall(env, '/item/remove', { access_token: row.token }); await env.DB.prepare('DELETE FROM plaid WHERE household = ?').bind(id).run(); await env.DB.prepare('DELETE FROM plaidtx WHERE household = ?').bind(id).run(); }
    return { s: 200, b: { ok: true } };
  }
  return { s: 405, b: { error: 'method not allowed' } };
}

// For the encryption test on the developer's PC (ignored by Cloudflare).
export const _test = { encryptPush, vapid };

/* Unleaded prices near home, once a day, from Google's gas station listings (Places API "Nearby Search").
   Needs two Cloudflare secrets: GOOGLE_PLACES_KEY (made by the user in Google Cloud) and HOME_LATLNG ("lat,lng" of
   the home town; up to about 31 miles around it are searched). Stores the median price of stations that updated
   their unleaded price in the last 3 days. */
/* The free U.S. government price (EIA, Energy Information Administration): the weekly average retail price of
   regular unleaded for the Midwest (Oklahoma) and the Gulf Coast (Arkansas), averaged, since purchases happen on
   both sides of the state line around Fort Smith. Needs the Cloudflare secret EIA_KEY (free, no card). */
const EIA_SERIES = ['EMM_EPMR_PTE_R20_DPG', 'EMM_EPMR_PTE_R30_DPG'];
async function fetchEia(env) {
  const q = new URLSearchParams({ api_key: String(env.EIA_KEY).replace(/^﻿/, '').trim(), frequency: 'weekly', 'data[0]': 'value', 'sort[0][column]': 'period', 'sort[0][direction]': 'desc', length: '10' });
  EIA_SERIES.forEach(s => q.append('facets[series][]', s));
  const r = await fetch('https://api.eia.gov/v2/petroleum/pri/gnd/data/?' + q.toString());
  if (!r.ok) return { error: r.status, detail: (await r.text()).slice(0, 300) };
  const rows = ((await r.json()).response || {}).data || [];
  const latest = {};
  for (const x of rows) if (!latest[x.series] || x.period > latest[x.series].period) latest[x.series] = x;
  const vals = Object.values(latest).map(x => Number(x.value)).filter(v => v > 1 && v < 10);
  if (!vals.length) return { error: 'no prices' };
  const price = vals.reduce((a, b) => a + b, 0) / vals.length;
  const period = Object.values(latest).map(x => x.period).sort().pop();
  await env.DB.prepare("INSERT OR REPLACE INTO prices (area, price, low, high, stations, at, source, period) VALUES ('home', ?, ?, ?, 0, ?, 'eia', ?)").bind(price, Math.min(...vals), Math.max(...vals), Date.now(), period).run();
  return { price, period };
}
async function fetchPrices(env, force) {
  const last = await env.DB.prepare("SELECT at FROM prices WHERE area = 'home'").first();
  if (!force && last && Date.now() - last.at < 20 * 3600000) return { skipped: 'fresh' };
  if (env.EIA_KEY) return fetchEia(env);
  if (!env.GOOGLE_PLACES_KEY || !env.HOME_LATLNG) return { skipped: 'not set up' };
  const [lat, lng] = String(env.HOME_LATLNG).split(',').map(Number);
  const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': String(env.GOOGLE_PLACES_KEY).replace(/^﻿/, '').trim(), 'X-Goog-FieldMask': 'places.displayName,places.fuelOptions' },
    body: JSON.stringify({ includedTypes: ['gas_station'], maxResultCount: 20, locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } } })
  });
  if (!r.ok) return { error: r.status, detail: (await r.text()).slice(0, 300) };
  const j = await r.json(), cutoff = Date.now() - 3 * 86400000, ps = [];
  for (const p of j.places || []) for (const f of ((p.fuelOptions || {}).fuelPrices || [])) {
    if (f.type !== 'REGULAR_UNLEADED' || !f.price) continue;
    const v = Number(f.price.units || 0) + Number(f.price.nanos || 0) / 1e9;
    if (v > 1 && v < 10 && (!f.updateTime || Date.parse(f.updateTime) >= cutoff)) ps.push(v);
  }
  if (!ps.length) return { error: 'no prices', places: (j.places || []).length };
  ps.sort((a, b) => a - b);
  const med = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
  await env.DB.prepare("INSERT OR REPLACE INTO prices (area, price, low, high, stations, at, source, period) VALUES ('home', ?, ?, ?, ?, ?, 'google', NULL)").bind(med, ps[0], ps[ps.length - 1], ps.length, Date.now()).run();
  return { price: med, stations: ps.length };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(Promise.all([sendDue(env), fetchPrices(env).catch(() => { }), bwRun(env).then(() => bwNag(env)).catch(() => { })])); },
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/v1') return json(req, 200, { ok: true, service: 'bill-planner-sync' });
    // One-time codes for adding a phone. The address is a hash of the code; the data is encrypted with the code.
    const pm = url.pathname.match(/^\/v1\/pair\/([0-9a-f]{64})$/);
    if (pm) {
      const now = Date.now();
      if (req.method === 'PUT') {
        let body; try { body = await req.json(); } catch (e) { return json(req, 400, { error: 'bad json' }); }
        if (!body || typeof body.data !== 'string' || body.data.length > 2000) return json(req, 400, { error: 'bad request' });
        await env.DB.prepare('DELETE FROM pairs WHERE expires < ?').bind(now).run();
        await env.DB.prepare('INSERT OR REPLACE INTO pairs (code, data, expires) VALUES (?, ?, ?)').bind(pm[1], body.data, now + 15 * 60000).run();
        return json(req, 200, { ok: true });
      }
      if (req.method === 'GET') {
        const row = await env.DB.prepare('SELECT data, expires FROM pairs WHERE code = ?').bind(pm[1]).first();
        if (!row || row.expires < now) return json(req, 404, { error: 'no such code' });
        await env.DB.prepare('DELETE FROM pairs WHERE code = ?').bind(pm[1]).run(); // works once
        return json(req, 200, { data: row.data });
      }
      return json(req, 405, { error: 'method not allowed' });
    }
    const m = url.pathname.match(/^\/v1\/h\/([A-Za-z0-9_-]{16,64})(?:\/(sub|sched|test|notify|subs|fuelprice|inbox|bankwatch|plaid))?$/);
    if (!m) return json(req, 404, { error: 'not found' });
    const id = m[1];
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (token.length < 20 || token.length > 200) return json(req, 401, { error: 'missing token' });
    const auth = await sha256(token);
    const row = await env.DB.prepare('SELECT auth, ver, data FROM households WHERE id = ?').bind(id).first();
    if (row && !same(row.auth, auth)) return json(req, 403, { error: 'wrong token' });

    // Notifications: a phone's push address, the household's reminder schedule, and a test message.
    if (m[2]) {
      if (!row) return json(req, 404, { error: 'no data yet' });
      let body = {};
      if (req.method !== 'DELETE' || req.headers.get('Content-Type')) { try { body = await req.json(); } catch (e) { body = {}; } }
      if (m[2] === 'sub') {
        const ep = String(body.endpoint || '');
        if (!PUSH_HOSTS.test(ep) || ep.length > 1000) return json(req, 400, { error: 'bad endpoint' });
        if (req.method === 'PUT') {
          if (typeof body.p256dh !== 'string' || typeof body.auth !== 'string' || body.p256dh.length > 200 || body.auth.length > 100) return json(req, 400, { error: 'bad keys' });
          // who: a code for the phone's person, made by the phones with the household key (not a readable name).
          const who = typeof body.who === 'string' && /^[0-9a-f]{8,64}$/.test(body.who) ? body.who : null;
          await env.DB.prepare('INSERT OR REPLACE INTO subs (endpoint, household, p256dh, auth, created, who) VALUES (?, ?, ?, ?, ?, ?)').bind(ep, id, body.p256dh, body.auth, Date.now(), who).run();
          return json(req, 200, { ok: true });
        }
        if (req.method === 'DELETE') { await env.DB.prepare('DELETE FROM subs WHERE endpoint = ? AND household = ?').bind(ep, id).run(); return json(req, 200, { ok: true }); }
      }
      if (m[2] === 'sched' && req.method === 'PUT') {
        const items = Array.isArray(body.items) ? body.items.slice(0, 200) : null;
        if (!items || items.some(i => !Number.isFinite(i.at) || typeof i.data !== 'string' || i.data.length > 1500)) return json(req, 400, { error: 'bad items' });
        const tag = t => (typeof t === 'string' && /^[0-9a-f]{8,64}$/.test(t) ? t : null);
        await env.DB.prepare('INSERT OR REPLACE INTO sched (household, items, updated) VALUES (?, ?, ?)').bind(id, JSON.stringify(items.map(i => ({ at: i.at, to: tag(i.to), data: i.data }))), Date.now()).run();
        return json(req, 200, { ok: true });
      }
      // Send one notification right now: to one person's phones, or to every phone in the household.
      if (m[2] === 'notify' && req.method === 'POST') {
        if (typeof body.data !== 'string' || body.data.length > 1500) return json(req, 400, { error: 'bad data' });
        const to = typeof body.to === 'string' && /^[0-9a-f]{8,64}$/.test(body.to) ? body.to : null;
        const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth, who FROM subs WHERE household = ?').bind(id).all()).results || [];
        let sent = 0;
        for (const s of subs.filter(s => !to || s.who === to)) { try { if ((await sendPush(env, s, body.data)) < 300) sent++; } catch (e) { } }
        return json(req, 200, { sent });
      }
      // Today's unleaded price near home. ?check=1 fetches now if the stored one is over 20 hours old (or missing).
      if (m[2] === 'fuelprice' && req.method === 'GET') {
        let info = null;
        if (url.searchParams.get('check') === '1') info = await fetchPrices(env).catch(e => ({ error: String(e) }));
        const p = await env.DB.prepare("SELECT price, low, high, stations, at, source, period FROM prices WHERE area = 'home'").first();
        return json(req, 200, p ? Object.assign({}, p, { info }) : { price: null, info });
      }
      // A one-time setup note: handed to the first phone that asks, and deleted right then. (There's no way to
      // write one from outside; only the owner can, with Wrangler.)
      if (m[2] === 'inbox' && req.method === 'GET') {
        const n = await env.DB.prepare('SELECT data FROM inbox WHERE household = ?').bind(id).first();
        if (!n) return json(req, 200, { data: null });
        await env.DB.prepare('DELETE FROM inbox WHERE household = ?').bind(id).run();
        return json(req, 200, { data: n.data });
      }
      /* The around-the-clock bank check. PUT { access, broken, fixed } turns it on (or updates it); GET says how
         it's going (never the key); DELETE turns it off. POST checks right now (used after reconnecting). */
      if (m[2] === 'bankwatch') {
        if (req.method === 'PUT') {
          const a = String(body.access || '');
          if (!/^https?:\/\/[^:@\/]+:[^@\/]+@[^\/]+\//.test(a) || a.length > 600 || !bwHostOk(env, a)) return json(req, 400, { error: 'bad access' });
          if (typeof body.broken !== 'string' || typeof body.fixed !== 'string' || body.broken.length > 1500 || body.fixed.length > 1500) return json(req, 400, { error: 'bad notes' });
          const tz = Number.isInteger(body.tz) && Math.abs(body.tz) <= 840 ? body.tz : 360;
          const old = await env.DB.prepare('SELECT access FROM bankwatch WHERE household = ?').bind(id).first();
          if (old && old.access === a) await env.DB.prepare('UPDATE bankwatch SET broken = ?, fixed = ?, tz = ?, updated = ? WHERE household = ?').bind(body.broken, body.fixed, tz, Date.now(), id).run();
          else await env.DB.prepare("INSERT OR REPLACE INTO bankwatch (household, access, broken, fixed, state, strikes, checked, changed, updated, acked, nagged, tz) VALUES (?, ?, ?, ?, 'unknown', 0, 0, 0, ?, '[]', 0, ?)").bind(id, a, body.broken, body.fixed, Date.now(), tz).run();
          return json(req, 200, { ok: true });
        }
        // POST { ack: <this phone's push address> }: this phone has seen the problem; stop its hourly reminders.
        if (req.method === 'POST' && typeof body.ack === 'string' && body.ack.length < 1000) {
          const w = await env.DB.prepare('SELECT acked FROM bankwatch WHERE household = ?').bind(id).first();
          if (w) {
            let acked; try { acked = JSON.parse(w.acked); } catch (e) { acked = []; }
            const h = (await sha256(body.ack)).slice(0, 24);
            if (!acked.includes(h)) { acked.push(h); await env.DB.prepare('UPDATE bankwatch SET acked = ? WHERE household = ?').bind(JSON.stringify(acked.slice(-20)), id).run(); }
          }
        } else if (req.method === 'POST') { await bwRun(env, id); }
        if (req.method === 'GET' || req.method === 'POST') {
          const w = await env.DB.prepare('SELECT state, checked, changed FROM bankwatch WHERE household = ?').bind(id).first();
          return json(req, 200, w ? { on: true, state: w.state, checked: w.checked, changed: w.changed } : { on: false });
        }
        if (req.method === 'DELETE') { await env.DB.prepare('DELETE FROM bankwatch WHERE household = ?').bind(id).run(); return json(req, 200, { ok: true }); }
      }
      // The live balance (Plaid): GET status, POST { step: 'link' | 'exchange' | 'balance' }, DELETE to disconnect.
      if (m[2] === 'plaid') { const r = await plaidRoute(req, env, id, body); return json(req, r.s, r.b); }
      // Which people have a phone set up for notifications (their codes only).
      if (m[2] === 'subs' && req.method === 'GET') {
        const subs = (await env.DB.prepare('SELECT who FROM subs WHERE household = ?').bind(id).all()).results || [];
        return json(req, 200, { tags: subs.map(s => s.who).filter(Boolean) });
      }
      if (m[2] === 'test' && req.method === 'POST') {
        const s = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM subs WHERE endpoint = ? AND household = ?').bind(String(body.endpoint || ''), id).first();
        if (!s || typeof body.data !== 'string' || body.data.length > 1500) return json(req, 400, { error: 'not subscribed' });
        let status, detail = '';
        try { status = await sendPush(env, s, body.data); detail = sendPush.lastReason || ''; } catch (e) { status = 0; detail = String(e && e.message || e); }
        return json(req, status >= 200 && status < 300 ? 200 : 502, { status, detail });
      }
      return json(req, 405, { error: 'method not allowed' });
    }

    if (req.method === 'GET') {
      if (!row) return json(req, 404, { error: 'no data yet' });
      return json(req, 200, { ver: row.ver, data: row.data });
    }
    if (req.method === 'PUT') {
      let body;
      try { body = await req.json(); } catch (e) { return json(req, 400, { error: 'bad json' }); }
      const ver = Number(body && body.ver), data = body && body.data;
      if (!Number.isInteger(ver) || ver < 0 || typeof data !== 'string' || !data || data.length > MAX) return json(req, 400, { error: 'bad request' });
      const now = Date.now();
      if (!row) {
        if (ver !== 0) return json(req, 409, { ver: 0, data: null });
        await env.DB.prepare('INSERT INTO households (id, auth, ver, data, updated) VALUES (?, ?, 1, ?, ?)').bind(id, auth, data, now).run();
        return json(req, 200, { ver: 1 });
      }
      // Only save over the version the phone last saw; otherwise send back the newer one to merge with.
      const r = await env.DB.prepare('UPDATE households SET ver = ver + 1, data = ?, updated = ? WHERE id = ? AND ver = ?').bind(data, now, id, ver).run();
      if (!r.meta || r.meta.changes !== 1) {
        const cur = await env.DB.prepare('SELECT ver, data FROM households WHERE id = ?').bind(id).first();
        return json(req, 409, { ver: cur.ver, data: cur.data });
      }
      return json(req, 200, { ver: ver + 1 });
    }
    if (req.method === 'DELETE') {
      if (row) {
        await env.DB.prepare('DELETE FROM households WHERE id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM subs WHERE household = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM sched WHERE household = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM bankwatch WHERE household = ?').bind(id).run();
        const p = await env.DB.prepare('SELECT token FROM plaid WHERE household = ?').bind(id).first();
        if (p) { await plaidCall(env, '/item/remove', { access_token: p.token }).catch(() => { }); await env.DB.prepare('DELETE FROM plaid WHERE household = ?').bind(id).run(); }
        await env.DB.prepare('DELETE FROM plaidtx WHERE household = ?').bind(id).run();
      }
      return json(req, 200, { ok: true });
    }
    return json(req, 405, { error: 'method not allowed' });
  }
};
