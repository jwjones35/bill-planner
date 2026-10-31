'use strict';
/* Bill Planner: bills, paydays and what's available to spend.
   Everything is stored on this device only (localStorage). No server, no tracking. */

const APP_VERSION = '1.5.1';
const KEY = 'billplanner.v1';
const DAY = 86400000;

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fm = n => moneyFmt.format(Math.round((n || 0) * 100) / 100);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = a => a.reduce((s, x) => s + (Number(x) || 0), 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const num = v => { const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };

/* Dates are plain 'YYYY-MM-DD' strings, so they compare and sort as text. */
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmtD = t => { const d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
const today = () => { const n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()); };
const addDays = (s, n) => fmtD(parseD(s) + n * DAY);
const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / DAY);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
const firstOfNextMonth = s => { const [y, m] = s.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`; };
const firstOfMonth = s => s.slice(0, 8) + '01';
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const nice = s => { const d = new Date(parseD(s)); return `${WD[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const monthName = s => { const [y, m] = s.split('-').map(Number); return `${MO[m - 1]} ${y}`; };
function rel(s) {
  const n = diffDays(today(), s);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days late`;
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
function freqText(x) {
  if (x.freq === 'monthly') return `Monthly on the ${ordinal(x.day || 1)}`;
  if (x.freq === 'weekly') return x.anchor ? `Every ${WDL[new Date(parseD(x.anchor)).getUTCDay()]}` : 'Every week';
  if (x.freq === 'biweekly') return x.anchor ? `Every other ${WDL[new Date(parseD(x.anchor)).getUTCDay()]}` : 'Every 2 weeks';
  if (x.freq === 'yearly') return x.anchor ? `Yearly on ${MO[Number(x.anchor.slice(5, 7)) - 1]} ${Number(x.anchor.slice(8))}` : 'Yearly';
  return '';
}

/* ---------- state ---------- */
function blankState() {
  return {
    version: 1, setupDate: today(),
    balances: { checking: 0, savings: 0, updated: null },
    everydayPerWeek: 0, savingsBuffer: 300, suggestSavings: true,
    incomes: [], bills: [], payments: [], receipts: [], setAsides: [], infos: [], spending: [],
    bank: { accounts: [], tx: [], ignore: [], suggest: [], autoLog: [] }
  };
}
function normalize(s) {
  const b = blankState();
  const out = Object.assign(b, s || {});
  out.balances = Object.assign(blankState().balances, out.balances || {});
  for (const k of ['incomes', 'bills', 'payments', 'receipts', 'setAsides', 'infos', 'spending']) if (!Array.isArray(out[k])) out[k] = [];
  for (const k of ['incomes', 'bills', 'setAsides', 'infos', 'spending']) out[k].forEach(x => { if (!x.id) x.id = uid(); });
  out.bank = Object.assign({ accounts: [], tx: [], ignore: [], suggest: [], autoLog: [] }, out.bank || {});
  return out;
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version === 1) return normalize(s); } catch (e) { /* no saved data */ }
  return null;
}
let S = load();
function save() {
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  S.balances.checking = r2(S.balances.checking);
  S.balances.savings = r2(S.balances.savings);
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Could not save on this device. Make a backup file from More.'); }
}

/* ---------- schedules ---------- */
// Dates in [from, to) on which a bill or paycheck happens.
function occ(item, from, to) {
  const out = [];
  if (!item || item.active === false || from >= to) return out;
  if (item.freq === 'monthly') {
    if (!item.day) return out;
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      const d = `${y}-${pad(m)}-${pad(Math.min(item.day, daysInMonth(y, m)))}`;
      if (d >= from && d < to) out.push(d);
      if (++m > 12) { m = 1; y++; }
    }
  } else if (item.freq === 'weekly' || item.freq === 'biweekly') {
    if (!item.anchor) return out;
    const step = item.freq === 'weekly' ? 7 : 14;
    let d = addDays(item.anchor, Math.ceil(diffDays(item.anchor, from) / step) * step);
    while (d < to) { out.push(d); d = addDays(d, step); }
  } else if (item.freq === 'yearly') {
    if (!item.anchor) return out;
    const am = Number(item.anchor.slice(5, 7)), ad = Number(item.anchor.slice(8, 10));
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const d = `${y}-${pad(am)}-${pad(Math.min(ad, daysInMonth(y, am)))}`;
      if (d >= from && d < to) out.push(d);
    }
  }
  if (item.endDate) return out.filter(d => d <= item.endDate);
  return out;
}

const paidRec = (b, d) => S.payments.find(p => p.billId === b.id && p.due === d);
const rcptRec = (inc, d) => S.receipts.find(r => r.incomeId === inc.id && r.date === d);

// What a bill will probably cost: varying bills use the average of the last 3 payments.
// v = the total expected (bill + any transaction fee), base = the bill alone, fee = the fee charged with it.
function billAmt(b) {
  const fee = b.fee || 0;
  const out = (base, est, unknown) => ({ v: unknown ? 0 : base + fee, base: unknown ? 0 : base, fee, est, unknown: !!unknown });
  if (b.varies) {
    const ps = S.payments.filter(p => p.billId === b.id).sort((x, y) => y.due.localeCompare(x.due)).slice(0, 3);
    if (ps.length) return out(sum(ps.map(p => p.amount - (p.fee || 0))) / ps.length, true);
    if (b.amount != null) return out(b.amount, true);
    return out(0, false, true);
  }
  if (b.amount == null) return out(0, false, true);
  return out(b.amount, false);
}
// What a paycheck will probably be: varying ones use the average of the last 4 received.
function incAmt(inc) {
  if (inc.varies) {
    const rs = S.receipts.filter(r => r.incomeId === inc.id).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 4);
    if (rs.length) return { v: sum(rs.map(r => r.amount)) / rs.length, est: true };
    return { v: inc.amount || 0, est: true };
  }
  return { v: inc.amount || 0, est: false };
}

function dueList(from, to, unpaidOnly = true) {
  const out = [];
  for (const b of S.bills) {
    for (const d of occ(b, from, to)) {
      const p = paidRec(b, d);
      if (unpaidOnly && p) continue;
      const a = billAmt(b);
      out.push({ b, d, p, amt: p ? p.amount : a.v, est: !p && a.est, unknown: !p && a.unknown });
    }
  }
  return out.sort((x, y) => x.d.localeCompare(y.d) || x.b.name.localeCompare(y.b.name));
}
function payList(from, to, unreceivedOnly = true) {
  const out = [];
  for (const inc of S.incomes) {
    for (const d of occ(inc, from, to)) {
      const r = rcptRec(inc, d);
      if (unreceivedOnly && r) continue;
      const a = incAmt(inc);
      out.push({ inc, d, r, amt: r ? r.amount : a.v, est: !r && a.est });
    }
  }
  return out.sort((x, y) => x.d.localeCompare(y.d) || x.inc.name.localeCompare(y.inc.name));
}
// Missed bills are only looked for since the app was set up (and at most 60 days back).
const lookback = () => { const t = addDays(today(), -60); return t > S.setupDate ? t : S.setupDate; };
// The next payday AFTER today. A paycheck due today only counts once you confirm it arrived.
function nextPayday() { const l = payList(addDays(today(), 1), addDays(today(), 45)); return l.length ? l[0].d : null; }

/* Available to spend = checking - unpaid bills due before the next payday - money set aside.
   Everyday spending is NOT subtracted here; it is shown separately as an estimate. */
function calc() {
  const t = today();
  const np = nextPayday() || addDays(t, 14);
  const bills = dueList(lookback(), np);
  const billsTotal = sum(bills.map(x => x.amt));
  const days = Math.max(0, diffDays(t, np));
  const everyday = (S.everydayPerWeek || 0) * days / 7;
  const aside = sum(S.setAsides.map(a => a.amount || 0));
  const safe = checkingNow() - billsTotal - aside;
  return { np, hasPay: !!nextPayday(), bills, billsTotal, days, everyday, aside, safe, unknown: bills.filter(x => x.unknown) };
}
/* Estimated available to spend next week = today's available + next payday's expected pay - bills due before the
   payday after it. It assumes nothing else is spent before payday, so recorded spending lowers both figures.
   "short" is how much next week's pay falls below next week's bills (that much of today's money must be kept). */
function nextWeek(c) {
  if (!c.hasPay) return null;
  const p1 = c.np;
  const pays1 = payList(p1, addDays(p1, 1));
  const later = payList(addDays(p1, 1), addDays(p1, 45));
  const p2 = later.length ? later[0].d : addDays(p1, 7);
  const bills = dueList(p1, p2);
  const billsTotal = sum(bills.map(x => x.amt));
  const income = sum(pays1.map(p => p.amt));
  const est = pays1.some(p => p.est) || bills.some(x => x.est);
  const short = Math.max(0, billsTotal - income);
  return { p1, p2, income, billsTotal, bills, short, est, available: c.safe + income - billsTotal };
}

/* ---------- recorded spending (groceries, gas, unexpected costs...) ---------- */
const SPEND_KINDS = ['Groceries', 'Gas', 'Eating out', 'Household', 'Unexpected', 'Other'];
// The most recent payday on or before today; spending is totalled from there.
function lastPayday() {
  const t = today();
  const l = payList(addDays(t, -16), addDays(t, 1), false);
  return l.length ? l[l.length - 1].d : addDays(t, -6);
}
const spendSince = d => S.spending.filter(x => x.date >= d).sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));

// Pay periods ahead, each from one payday up to the next, with a running "cushion".
function periods(n = 8, countTodaysPay = true) {
  const t = today();
  const c = calc();
  const pays = payList(addDays(t, 1), addDays(t, 120));
  const dates = [...new Set(pays.map(p => p.d))].sort().slice(0, n + 1);
  const out = [];
  // Today's paychecks that haven't been confirmed yet are expected, so the projection includes them.
  const todayPays = payList(t, addDays(t, 1));
  // The forecast does allow for everyday spending, starting with the days until the next payday.
  let run = c.safe - c.everyday + (countTodaysPay ? sum(todayPays.map(p => p.amt)) : 0);
  for (let i = 0; i < Math.min(n, dates.length); i++) {
    const d = dates[i];
    const end = dates[i + 1] || addDays(d, i > 0 ? diffDays(dates[i - 1], d) : 14);
    const incs = pays.filter(p => p.d === d);
    const inTot = sum(incs.map(p => p.amt));
    const bills = dueList(d, end);
    const bt = sum(bills.map(x => x.amt));
    const ev = (S.everydayPerWeek || 0) * diffDays(d, end) / 7;
    const left = inTot - bt - ev;
    run += left;
    out.push({ d, end, incs, inTot, bills, bt, ev, left, run });
  }
  return { c, out, todayPays };
}

/* ---------- bank connection (SimpleFIN Bridge) ----------
   The bank login happens on SimpleFIN's own website. The app only keeps SimpleFIN's "access URL", a read-only key,
   in its own storage slot on this device. It is never put in backup files or sent anywhere except SimpleFIN. */
const BANK_KEY = 'billplanner.bank';
const HOUR = 3600000;
let bankBusy = false;
function bankAccess() { try { return localStorage.getItem(BANK_KEY) || ''; } catch (e) { return ''; } }
function setBankAccess(v) { try { if (v) localStorage.setItem(BANK_KEY, v); else localStorage.removeItem(BANK_KEY); } catch (e) { } }
const bankOn = () => !!(S && bankAccess() && S.bank.checkingId && S.bank.bal);
const bankName = () => { const a = S.bank.accounts.find(x => x.id === S.bank.checkingId); return (a && a.org) || 'your bank'; };
// "today 6:10 AM", "yesterday 9:42 PM", "Wed Oct 28 7:05 AM"
function whenText(ms) {
  const d = new Date(ms);
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const diff = diffDays(day, today());
  return (diff === 0 ? 'today' : diff === 1 ? 'yesterday' : nice(day)) + ' ' + time;
}
// How old the bank's own data is (falls back to when the app last checked).
const bankAsOf = () => S.bank.bal && (S.bank.bal.asOf || S.bank.bal.at);
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
const bankAgeText = () => `${esc(capFirst(bankName()))} balance as of ${whenText(bankAsOf())}`;
function timeAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hour${h === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'} ago`;
}
const normText = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const STOP = new Set(['OF', 'THE', 'AND', 'FOR', 'FEE', 'BILL', 'PAYMENT', 'PAYMENTS', 'ORIGINAL', 'VEHICLE', 'REPAIR', 'FORMERLY',
  'WATER', 'SEWER', 'TRASH', 'HEALTH', 'INSURANCE', 'CAR', 'ELECTRIC', 'ONLINE', 'PAY', 'INC', 'LLC', 'LL', 'CO', 'MY', 'ME']);
const nameWords = name => normText(name).split(' ').filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
const hasWord = (desc, w) => (' ' + desc + ' ').includes(' ' + w + ' ');
// Bank wording that says nothing about who was paid
const BANKWORDS = new Set(['ONLINE', 'PMT', 'PYMT', 'PYMNT', 'PYMNTS', 'PAYMENT', 'PAYMENTS', 'PAY', 'ACH', 'DEBIT', 'CREDIT', 'POS', 'PURCHASE', 'PUR',
  'DDA', 'PIN', 'RECUR', 'RECURRING', 'CARD', 'CHECKCARD', 'CD', 'WEB', 'TRANSFER', 'XFER', 'BILLPAY', 'BILL', 'AUTOPAY', 'AUTO', 'ELECTRONIC',
  'WITHDRAWAL', 'W', 'D', 'DIR', 'DEP', 'DEPOSIT', 'PPD', 'ID', 'CO', 'INC', 'LLC', 'THE', 'OF', 'AND', 'REF', 'EDI', 'WEBPAY', 'MOBILE', 'VISA', 'MC']);
// A remembered match is a set of words that must all appear in the bank description, in any order.
const learned = (item, desc) => (item.match || []).some(p => p && p.split(' ').every(w => hasWord(desc, w)));
const guessed = (item, desc) => nameWords(item.name).some(w => hasWord(desc, w));
// What to remember after the user confirms a match: the first two meaningful words ("VERIZON WIRELESS", "RENT").
function phraseOf(desc) {
  const words = desc.split(' ').filter(w => w.length >= 2 && !/^\d+$/.test(w) && !BANKWORDS.has(w));
  return (words.length ? words : desc.split(' ')).slice(0, 2).join(' ');
}
function localDate(sec) { const d = new Date(sec * 1000); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

// Turn a one-time SimpleFIN setup token into the access URL.
async function claimToken(token) {
  let url;
  try { url = atob(token.replace(/\s+/g, '')); } catch (e) { throw new Error("That doesn't look like a SimpleFIN setup token."); }
  if (!/^https:\/\//.test(url)) throw new Error("That doesn't look like a SimpleFIN setup token.");
  let r;
  try { r = await fetch(url, { method: 'POST' }); }
  catch (e) { throw new Error("Couldn't reach SimpleFIN from this phone. Check the internet connection and try again."); }
  if (r.status === 403) throw new Error('That setup token was already used or has expired. Create a new one on SimpleFIN.');
  if (!r.ok) throw new Error('SimpleFIN answered with error ' + r.status + '.');
  const access = (await r.text()).trim();
  if (!/^https:\/\/[^:@\/]+:[^@\/]+@/.test(access)) throw new Error("SimpleFIN's answer wasn't what was expected.");
  return access;
}

// Fetch balances and the last ~5 weeks of transactions. At most about once an hour (SimpleFIN allows ~24 a day).
async function fetchBank(force) {
  const acc = bankAccess();
  if (!acc || !S || bankBusy) return;
  const now = Date.now();
  let log = S.bank.fetchLog || {};
  if (log.day !== today()) log = { day: today(), count: 0 };
  if (!force && S.bank.fetchedAt && now - S.bank.fetchedAt < HOUR) return;
  if (force && S.bank.fetchedAt && now - S.bank.fetchedAt < 2 * 60000) { toast('Updated a moment ago already.'); return; }
  if (log.count >= 20) { S.bank.error = "Today's update limit is reached. It will update again tomorrow."; save(); render(); return; }
  bankBusy = true; render();
  try {
    const u = new URL(acc);
    const auth = 'Basic ' + btoa(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password));
    const base = u.origin + u.pathname.replace(/\/$/, '');
    const start = Math.floor((now - 35 * DAY) / 1000);
    log.count++; S.bank.fetchLog = log;
    let r;
    try { r = await fetch(`${base}/accounts?version=2&pending=1&start-date=${start}`, { headers: { Authorization: auth } }); }
    catch (e) { throw new Error("Couldn't reach SimpleFIN. Check the internet connection."); }
    if (r.status === 403) throw new Error('SimpleFIN refused the connection. It may have been turned off; reconnect under More.');
    if (r.status === 402) throw new Error('SimpleFIN says the subscription needs payment.');
    if (!r.ok) throw new Error('SimpleFIN answered with error ' + r.status + '.');
    const j = await r.json();
    applyBank(j, now);
    const errs = (j.errlist || j.errors || []).map(e => typeof e === 'string' ? e : (e.msg || e.message || e.code || '')).filter(Boolean);
    S.bank.error = errs.length ? errs.join(' ') : null;
    S.bank.fetchedAt = now;
  } catch (e) {
    S.bank.error = e.message || "Couldn't update from the bank.";
  }
  bankBusy = false;
  save(); render();
}

function applyBank(j, now) {
  const raw = Array.isArray(j.accounts) ? j.accounts : [];
  // Newer SimpleFIN answers name the bank in a separate "connections" list instead of on each account.
  const conns = {};
  (Array.isArray(j.connections) ? j.connections : []).forEach(c => { if (c && c.conn_id) conns[c.conn_id] = c.name || c.org_name || c.org_id || ''; });
  S.bank.accounts = raw.map(a => ({
    id: String(a.id), name: a.name || 'Account',
    org: (a.org && (a.org.name || a.org.domain)) || conns[a.conn_id] || '',
    balance: parseFloat(a.balance), available: a['available-balance'] != null && a['available-balance'] !== '' ? parseFloat(a['available-balance']) : null
  }));
  const accts = S.bank.accounts;
  if (!accts.find(a => a.id === S.bank.checkingId)) {
    const ch = accts.find(a => /check/i.test(a.name)) || accts[0];
    S.bank.checkingId = ch ? ch.id : null;
  }
  if (S.bank.savingsId === undefined || (S.bank.savingsId && !accts.find(a => a.id === S.bank.savingsId))) {
    const sv = accts.find(a => /sav/i.test(a.name) && a.id !== S.bank.checkingId);
    S.bank.savingsId = sv ? sv.id : null;
  }
  const ch = raw.find(a => String(a.id) === S.bank.checkingId);
  S.bank.tx = ((ch && ch.transactions) || []).map(t => ({
    id: String(t.id),
    date: t.posted ? localDate(t.posted) : t.transacted_at ? localDate(t.transacted_at) : today(),
    amount: parseFloat(t.amount),
    desc: normText(t.description || t.payee || t.memo),
    pending: !!t.pending || !t.posted
  })).filter(t => !isNaN(t.amount)).sort((a, b) => b.date.localeCompare(a.date));
  /* Pending transactions count as real ones. The bank's "available" balance normally already includes them;
     if the bank doesn't send one, apply the pending transactions to the posted balance ourselves. */
  const pendingSum = sum(S.bank.tx.filter(t => t.pending).map(t => t.amount));
  const pick = id => { const a = accts.find(x => x.id === id); return a ? (a.available != null && !isNaN(a.available) ? a.available : a.balance) : null; };
  const cA = accts.find(x => x.id === S.bank.checkingId);
  const hasAvail = cA && cA.available != null && !isNaN(cA.available);
  S.bank.bal = {
    checking: cA ? (hasAvail ? cA.available : cA.balance + pendingSum) : null,
    savings: S.bank.savingsId ? pick(S.bank.savingsId) : null,
    posted: cA ? cA.balance : null, available: hasAvail ? cA.available : null, pendingSum, at: now,
    // When the bank itself last reported this balance (SimpleFIN refreshes about once a day)
    asOf: (() => { const r = raw.find(a => String(a.id) === S.bank.checkingId); const s = r && Number(r['balance-date']); return s ? s * 1000 : null; })()
  };
  runMatching();
}

/* Checking as it really stands: the bank's balance, minus things entered in the app that the bank doesn't show yet
   (bill payments can take 3-5 business days; card purchases a day or two). Without a bank connection it's the
   balance kept up to date by hand. */
const inTransitPays = () => S.payments.filter(p => p.inTransit && !p.txId && diffDays(p.paidOn, today()) <= 14);
const inTransitSpends = () => S.spending.filter(x => x.inTransit && !x.txId && diffDays(x.date, today()) <= 14);
/* A balance typed in from the bank's own app (which is up to the minute) is used until the bank connection brings
   data newer than it. Items entered in the app after it, or ticked as "not in the bank's app yet", still subtract. */
function manualBal() {
  const m = S.bank.manual;
  if (!m || !bankOn()) return null;
  // Newer bank data replaces it. If the bank doesn't say when its balance was taken, a changed balance means new data.
  if (S.bank.bal.asOf) return m.at > S.bank.bal.asOf ? m : null;
  return Math.abs((S.bank.bal.checking || 0) - (m.bankBal || 0)) < 0.005 ? m : null;
}
const itemKey = x => (x.billId ? 'b|' + x.billId + '|' + x.due : 's|' + x.id);
function checkingNow() {
  if (!bankOn() || S.bank.bal.checking == null) return S.balances.checking || 0;
  const items = [...inTransitPays(), ...inTransitSpends()];
  const m = manualBal();
  if (m) {
    const keep = new Set(m.keep || []);
    return m.amount - sum(items.filter(x => keep.has(itemKey(x)) || (x.at || 0) > m.at).map(x => x.amount));
  }
  return S.bank.bal.checking - sum(items.map(x => x.amount));
}
const savingsNow = () => (bankOn() && S.bank.bal.savings != null ? S.bank.bal.savings : S.balances.savings || 0);

// Match bank transactions to bills and paychecks. Confirmed matches happen automatically; first-time ones are
// offered for the user to confirm on Home.
function runMatching() {
  const used = new Set([...S.payments.map(p => p.txId), ...S.payments.map(p => p.feeTxId), ...S.receipts.map(r => r.txId), ...S.spending.map(x => x.txId)].filter(Boolean));
  const ignore = new Set(S.bank.ignore || []);
  const free = t => !used.has(t.id) && !ignore.has(t.id);
  const suggest = [];
  const auto = [];
  // 1. Link things entered in the app to the bank transaction once it shows up.
  for (const p of S.payments.filter(p => p.inTransit && !p.txId)) {
    const near = t => free(t) && t.amount < 0 && t.date >= addDays(p.paidOn, -3) && t.date <= addDays(p.paidOn, 10);
    // The bank may show it as one charge, or as the bill plus a separate fee charge.
    let t = S.bank.tx.find(t => near(t) && Math.abs(-t.amount - p.amount) < 0.01);
    if (t) { p.txId = t.id; used.add(t.id); continue; }
    if (p.fee) {
      t = S.bank.tx.find(t => near(t) && Math.abs(-t.amount - (p.amount - p.fee)) < 0.01);
      if (t) {
        p.txId = t.id; used.add(t.id);
        const fx = S.bank.tx.find(x => near(x) && x.id !== t.id && Math.abs(-x.amount - p.fee) <= 0.5 && Math.abs(diffDays(x.date, t.date)) <= 2);
        if (fx) { p.feeTxId = fx.id; used.add(fx.id); p.amount = p.amount - p.fee + -fx.amount; p.fee = -fx.amount; feeCheck(findB(p.billId), p); }
      }
    }
  }
  for (const x of S.spending.filter(x => x.inTransit && !x.txId)) {
    const t = S.bank.tx.find(t => free(t) && t.amount < 0 && Math.abs(-t.amount - x.amount) < 0.01 && t.date >= addDays(x.date, -1) && t.date <= addDays(x.date, 7));
    if (t) { x.txId = t.id; used.add(t.id); }
  }
  // A small charge from the same place on the same day as a bill's charge: its transaction fee.
  // With an expected fee, the closest one wins, and a higher-than-usual fee is still caught (and flagged by feeCheck).
  const feeTxFor = (t, fee) => S.bank.tx.filter(f => f.id !== t.id && free(f) && f.amount < 0 && Math.abs(diffDays(f.date, t.date)) <= 2 &&
    phraseOf(f.desc) === phraseOf(t.desc) && -f.amount < -t.amount &&
    ((fee && Math.abs(-f.amount - fee) <= 0.5) || -f.amount <= Math.max(10, -t.amount * 0.1, fee * 5)))
    .sort((a, b) => Math.abs(-a.amount - fee) - Math.abs(-b.amount - fee))[0];
  // 1b. A bill already marked paid whose fee charge showed up later.
  for (const p of S.payments.filter(p => p.txId && !p.feeTxId)) {
    const b = findB(p.billId), t = S.bank.tx.find(x => x.id === p.txId);
    if (!b || !b.fee || !t) continue;
    const f = feeTxFor(t, b.fee);
    if (f) { p.feeTxId = f.id; p.fee = -f.amount; p.amount += -f.amount; used.add(f.id); feeCheck(b, p); }
  }
  // 2. Money out: bill payments. Bigger charges first, so a small fee isn't taken for the bill itself.
  for (const t of S.bank.tx.filter(t => t.amount < 0 && t.date >= addDays(S.setupDate, -3)).sort((a, b) => a.amount - b.amount)) {
    if (!free(t)) continue;
    const amt = -t.amount;
    let best = null;
    for (const b of S.bills) {
      const from = addDays(t.date, -7) > S.setupDate ? addDays(t.date, -7) : S.setupDate;
      for (const d of occ(b, from, addDays(t.date, 6))) {
        if (paidRec(b, d)) continue;
        const e = billAmt(b);
        // Compare with the bill alone: its fee arrives as a separate charge.
        const diff = e.unknown ? null : Math.abs(amt - e.base);
        const amtOk = e.unknown ? false : b.varies ? diff <= Math.max(5, e.base * 0.6) : diff <= 0.5;
        let c = null;
        if (learned(b, t.desc) && (amtOk || e.unknown)) c = { auto: true };
        else if ((guessed(b, t.desc) && (amtOk || e.unknown)) || (!b.varies && !e.unknown && diff < 0.01)) c = { auto: false };
        if (!c) continue;
        c = Object.assign(c, { b, d, diff: diff == null ? 999 : diff, gap: Math.abs(diffDays(d, t.date)) });
        if (!best || (c.auto && !best.auto) || (c.auto === best.auto && (c.diff < best.diff || (c.diff === best.diff && c.gap < best.gap)))) best = c;
      }
    }
    if (!best) continue;
    // Its fee: expected (the bill has one), or a same-day small charge from the same place the user said to combine.
    const rule = (S.bank.feeRules || []).includes(phraseOf(t.desc));
    const f = best.b.fee ? feeTxFor(t, best.b.fee) : rule ? feeTxFor(t, 0) : null;
    if (best.auto) {
      const pay = { billId: best.b.id, due: best.d, paidOn: t.date, amount: amt, txId: t.id, auto: true };
      if (f) { pay.fee = -f.amount; pay.amount += -f.amount; pay.feeTxId = f.id; used.add(f.id); feeCheck(best.b, pay); if (!best.b.fee) best.b.fee = -f.amount; }
      S.payments.push(pay);
      used.add(t.id); auto.push(best.b.name);
    } else {
      suggest.push({ kind: 'bill', txId: t.id, id: best.b.id, d: best.d, feeTxId: f ? f.id : null });
      if (f) used.add(f.id);
    }
  }
  // 2b. Two same-day charges from the same place, one small, with no bill expecting a fee: ask whether to combine.
  const noPair = new Set(S.bank.noFeePairs || []);
  for (const t of S.bank.tx.filter(t => t.amount < 0 && t.date >= addDays(S.setupDate, -3))) {
    const f = feeTxFor(t, 0);
    if (!f || noPair.has(t.id + '+' + f.id) || (S.bank.feeRules || []).includes(phraseOf(t.desc))) continue;
    if (suggest.some(s => s.txId === f.id || s.feeTxId === f.id || s.smallId === f.id)) continue;
    suggest.push({ kind: 'fee', txId: t.id, smallId: f.id });
  }
  // 3. Money in: paychecks.
  for (const t of S.bank.tx.filter(t => t.amount > 0 && free(t) && t.date >= addDays(S.setupDate, -3))) {
    let best = null;
    for (const inc of S.incomes) {
      const from = addDays(t.date, -4) > S.setupDate ? addDays(t.date, -4) : S.setupDate;
      for (const d of occ(inc, from, addDays(t.date, 5))) {
        if (rcptRec(inc, d)) continue;
        const e = incAmt(inc).v;
        const amtOk = Math.abs(t.amount - e) <= Math.max(50, e * (inc.varies ? 0.7 : 0.25));
        let c = null;
        if (learned(inc, t.desc)) c = { auto: true };
        else if (guessed(inc, t.desc) && amtOk) c = { auto: false };
        if (!c) continue;
        c = Object.assign(c, { inc, d, gap: Math.abs(diffDays(d, t.date)) });
        if (!best || (c.auto && !best.auto) || (c.auto === best.auto && c.gap < best.gap)) best = c;
      }
    }
    if (!best) continue;
    if (best.auto) {
      S.receipts.push({ incomeId: best.inc.id, date: best.d, amount: t.amount, txId: t.id, auto: true });
      used.add(t.id); auto.push(best.inc.name);
    } else suggest.push({ kind: 'pay', txId: t.id, id: best.inc.id, d: best.d });
  }
  S.bank.suggest = suggest;
  if (auto.length) S.bank.autoLog = [{ at: Date.now(), names: auto }].concat(S.bank.autoLog || []).slice(0, 10);
}

// Flag a transaction fee that's noticeably higher than the bill's usual fee.
function feeCheck(b, p) {
  if (!b || !b.fee || !p.fee || p.fee <= b.fee * 1.2 + 0.25) return;
  S.bank.feeAlerts = (S.bank.feeAlerts || []).filter(a => !(a.billId === b.id && a.date === (p.paidOn || p.due)))
    .concat([{ billId: b.id, date: p.paidOn || p.due, fee: p.fee, usual: b.fee }]).slice(-20);
}

/* Readable names for bank transactions. The bank's own wording is kept for recognizing them;
   the name is only what's shown. A label applies to every transaction containing its words. */
function labelFor(t) {
  const one = (S.bank.txNames || {})[t.id];
  if (one) return one;
  return (S.bank.labels || []).find(l => l.words && l.words.split(' ').every(w => hasWord(t.desc, w))) || null;
}
const txName = t => { const l = labelFor(t); return l && l.name ? l.name : t.desc; };

function sheetTxWhat(t) {
  const l = labelFor(t) || {};
  const phrase = phraseOf(t.desc);
  const opts = [];
  if (t.amount < 0) {
    opts.push(`<option value="spend">Everyday spending (groceries, gas, a purchase)</option>`);
    for (const b of S.bills) for (const d of occ(b, addDays(t.date, -25), addDays(t.date, 25))) {
      if (!paidRec(b, d)) opts.push(`<option value="bill|${b.id}|${d}">Payment for the bill: ${esc(b.name)} (due ${nice(d)})</option>`);
    }
    opts.push(`<option value="newbill">A bill that isn't in the app yet (set it up from this)</option>`);
  } else {
    opts.push(`<option value="spend">Money in (refund or other)</option>`);
    for (const inc of S.incomes) for (const d of occ(inc, addDays(t.date, -10), addDays(t.date, 10))) {
      if (!rcptRec(inc, d)) opts.push(`<option value="pay|${inc.id}|${d}">Paycheck: ${esc(inc.name)} (${nice(d)})</option>`);
    }
  }
  opts.push(`<option value="ignore"${l.ignore ? ' selected' : ''}>Not spending (for example a transfer to savings)</option>`);
  openSheet(`<form id="fTx" data-id="${esc(t.id)}"><h3>What is this?</h3>
    <div class="small muted">${nice(t.date)}${t.pending ? ' · pending' : ''} · as the bank shows it:</div>
    <div><b>${esc(t.desc)}</b> <span class="num">${fm(Math.abs(t.amount))}</span></div>
    <label for="txKind">This is</label><select id="txKind" name="kind">${opts.join('')}</select>
    <label for="txName">Name you see in the app</label><input id="txName" name="name" value="${esc(l.name || '')}" placeholder="For example: Water / sewer / trash">
    <label for="txCat">Category</label><select id="txCat" name="cat">${SPEND_KINDS.map(k => `<option${l.cat === k ? ' selected' : ''}>${k}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" name="remember" checked> Use this for every transaction the bank shows as "${esc(phrase)}"</label>
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div></form>`);
}

/* Two bills on the same schedule from the same place, one much smaller (like a water bill and its $2.25
   payment fee), are probably one bill plus a transaction fee. Offer to combine them. */
function relatedBillPairs() {
  const out = [];
  const no = new Set(S.ignorePairs || []);
  const live = S.bills.filter(b => b.active !== false && b.amount != null);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    let a = live[i], b = live[j];
    if (a.freq !== b.freq || (a.freq === 'monthly' ? a.day !== b.day : a.anchor !== b.anchor)) continue;
    if (b.amount > a.amount) [a, b] = [b, a]; // a = bigger, b = smaller
    if (b.amount <= 0 || b.amount > Math.max(10, a.amount * 0.1) || a.fee) continue;
    const wa = nameWords(a.name), wb = nameWords(b.name);
    const sharedName = wa.some(w => wb.includes(w));
    const sharedBank = (a.match || []).some(m => (b.match || []).includes(m));
    if (!sharedName && !sharedBank) continue;
    const key = [a.id, b.id].sort().join('+');
    if (!no.has(key)) out.push({ big: a, small: b, key });
  }
  return out;
}
let lastCombine = null;
function sheetCombine(big, small) {
  if (!big || !small) return;
  const key = [big.id, small.id].sort().join('+');
  openSheet(`<h3>Combine these two bills?</h3>
    <div class="breakdown num" style="font-size:15px;margin-top:8px">
      <div><span>${esc(big.name)}</span><span>${fm(big.amount)}</span></div>
      <div><span>${esc(small.name)}</span><span>${fm(small.amount)}</span></div>
      <div class="sum"><span>Combined total, ${freqText(big).toLowerCase()}</span><span>${fm(big.amount + small.amount)}</span></div></div>
    <p class="small" style="margin-top:10px">If you combine them, <b>${esc(big.name)}</b> becomes one bill of ${fm(big.amount)} plus a ${fm(small.amount)} <b>transaction fee</b>, and "${esc(small.name)}" stops being a separate bill. Only do this if the smaller charge is a fee for paying the larger bill.</p>
    <div class="btns"><button class="btn ghost" data-act="combineNot" data-key="${key}">Cancel, these are not related</button></div>
    <div class="btns"><button class="btn ghost" data-act="close">Decide later</button><button class="btn" data-act="combineDo" data-big="${big.id}" data-small="${small.id}">Yes, combine them</button></div>`);
}
function combineBills(bigId, smallId) {
  const big = findB(bigId), small = findB(smallId);
  if (!big || !small) return;
  big.fee = Math.round(((big.fee || 0) + (small.amount || 0)) * 100) / 100;
  big.match = [...new Set([...(big.match || []), ...(small.match || [])])];
  // Payments of the fee bill become the fee part of the main bill's payment on the same date, if there is one.
  for (const p of S.payments.filter(p => p.billId === small.id)) {
    const main = S.payments.find(q => q.billId === big.id && q.due === p.due);
    if (main) { main.amount += p.amount; main.fee = (main.fee || 0) + p.amount; if (p.txId) main.feeTxId = p.txId; }
  }
  S.payments = S.payments.filter(p => p.billId !== small.id);
  S.bills = S.bills.filter(b => b.id !== small.id);
}

// The user's answer to "is this the X bill?"
function answerSuggestion(i, yes) {
  const s = S.bank.suggest[i];
  if (!s) return;
  const t = S.bank.tx.find(x => x.id === s.txId);
  if (s.kind === 'fee') {
    const small = S.bank.tx.find(x => x.id === s.smallId);
    if (yes && t && small) {
      S.bank.feeRules = [...new Set([...(S.bank.feeRules || []), phraseOf(t.desc)])];
      const p = S.payments.find(q => q.txId === t.id);
      if (p) {
        p.fee = (p.fee || 0) - small.amount; p.amount += -small.amount; p.feeTxId = small.id;
        const b = findB(p.billId); if (b && !b.fee) b.fee = -small.amount;
      }
      toast('Combined. From now on these will be treated as one charge plus its transaction fee.');
    } else {
      S.bank.noFeePairs = [...new Set([...(S.bank.noFeePairs || []), s.txId + '+' + s.smallId])].slice(-200);
    }
    S.bank.suggest.splice(i, 1);
    runMatching(); save(); render();
    return;
  }
  if (yes && t) {
    if (s.kind === 'bill') {
      const b = findB(s.id);
      const f = s.feeTxId && S.bank.tx.find(x => x.id === s.feeTxId);
      const pay = { billId: b.id, due: s.d, paidOn: t.date, amount: -t.amount, txId: t.id, auto: true };
      if (f) { pay.fee = -f.amount; pay.amount += -f.amount; pay.feeTxId = f.id; feeCheck(b, pay); }
      S.payments.push(pay);
      b.match = [...new Set([...(b.match || []), phraseOf(t.desc)])];
      toast(`${b.name} marked paid${f ? ', including its fee' : ''}. Future payments like this will be matched automatically.`);
    } else {
      const inc = findI(s.id);
      S.receipts.push({ incomeId: inc.id, date: s.d, amount: t.amount, txId: t.id, auto: true });
      inc.match = [...new Set([...(inc.match || []), phraseOf(t.desc)])];
      toast(`${inc.name} marked received. Future deposits like this will be matched automatically.`);
    }
  } else {
    S.bank.ignore = [...new Set([...(S.bank.ignore || []), s.txId])].slice(-300);
  }
  S.bank.suggest.splice(i, 1);
  runMatching();
  save(); render();
}

/* ---------- rendering ---------- */
let tab = (() => { try { return sessionStorage.getItem('bp.tab') || 'home'; } catch (e) { return 'home'; } })();

function render() {
  const v = $('#view');
  $('#tabs').hidden = !S;
  if (!S) { v.innerHTML = viewWelcome(); return; }
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  v.innerHTML = tab === 'pay' ? viewPay() : tab === 'bills' ? viewBills() : tab === 'more' ? viewMore() : viewHome();
}

function amtHtml(x) {
  if (x.unknown) return `<span class="tag warn">amount?</span>`;
  return `${x.est ? '~' : ''}${fm(x.amt)}`;
}
function billRow(x) {
  const t = today();
  const late = !x.p && x.d < t;
  const soon = !x.p && !late && diffDays(t, x.d) <= 3;
  const dot = x.p ? 'paid' : late ? 'late' : soon ? 'soon' : 'ok';
  const sub = (x.p ? `Paid ${nice(x.p.paidOn || x.d)}` : `${nice(x.d)} · ${rel(x.d)}`) + (x.b.fee ? ` · includes ${fm(x.b.fee)} fee` : '');
  return `<button class="row${x.p ? ' done' : ''}" data-act="pay" data-id="${x.b.id}" data-d="${x.d}">
    <span class="dot ${dot}"></span>
    <span class="main"><div class="name">${esc(x.b.name)}</div><div class="sub">${sub}</div></span>
    <span class="amt num">${amtHtml(x)}</span></button>`;
}
function section(title, list, emptyText, collapsed) {
  const tot = sum(list.map(x => x.amt));
  const rows = list.length ? list.map(billRow).join('') : `<div class="empty">${emptyText}</div>`;
  if (collapsed) {
    return `<details class="card" style="margin-top:22px"><summary class="row"><span class="main"><div class="name">${title}</div><div class="sub">${list.length} bill${list.length === 1 ? '' : 's'}</div></span><span class="amt num">${fm(tot)}</span></summary>${rows}</details>`;
  }
  return `<h2>${title}<span class="tot num">${list.length ? fm(tot) : ''}</span></h2><div class="card">${rows}</div>`;
}

function viewHome() {
  const t = today();
  const c = calc();
  const nw = nextWeek(c);
  const bal = S.balances;
  // Bank transactions that look like a bill payment or paycheck: ask once, then match automatically.
  // Shown right under the main number: until answered, a paid bill is counted as still due.
  let sugHtml = '';
  for (const pr of relatedBillPairs().slice(0, 2)) {
    sugHtml += `<div class="card pad" style="margin-top:12px"><div><b>These two bills look related</b></div>
      <div class="small" style="margin-top:4px">${esc(pr.big.name)} (${fm(pr.big.amount)}) and ${esc(pr.small.name)} (${fm(pr.small.amount)}) are both ${freqText(pr.big).toLowerCase()}.</div>
      <div class="small muted" style="margin-top:4px">Combine them into one bill, with the ${fm(pr.small.amount)} as its transaction fee? The total would be ${fm(pr.big.amount + pr.small.amount)}.</div>
      <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="pairNo" data-key="${pr.key}">Not related</button><button class="btn small" data-act="pairYes" data-big="${pr.big.id}" data-small="${pr.small.id}">Combine...</button></div></div>`;
  }
  if (bankOn() && S.bank.suggest.length) {
    sugHtml += `<h2>Found at ${esc(bankName())}: please confirm</h2><div class="card">` + S.bank.suggest.slice(0, 5).map((s, i) => {
      const t = S.bank.tx.find(x => x.id === s.txId);
      if (!t) return '';
      if (s.kind === 'fee') {
        const sm = S.bank.tx.find(x => x.id === s.smallId);
        if (!sm) return '';
        return `<div class="pad" style="border-top:1px solid var(--line)"><div class="small muted">${nice(t.date)}</div>
        <div><b>${esc(txName(t))}</b>: two charges, <span class="num">${fm(-t.amount)}</span> and <span class="num">${fm(-sm.amount)}</span></div>
        <div class="small" style="margin-top:4px">Are these related? Combine them, with the ${fm(-sm.amount)} as a transaction fee for the ${fm(-t.amount)} charge?</div>
        <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="sugNo" data-i="${i}">Not related</button><button class="btn small" data-act="sugYes" data-i="${i}">Combine...</button></div></div>`;
      }
      const f = s.feeTxId && S.bank.tx.find(x => x.id === s.feeTxId);
      const what = s.kind === 'bill' ? `the <b>${esc((findB(s.id) || {}).name || '')}</b> bill due ${nice(s.d)}${f ? `, with the ${fm(-f.amount)} charge as its fee` : ''}` : `the <b>${esc((findI(s.id) || {}).name || '')}</b> paycheck for ${nice(s.d)}`;
      return `<div class="pad" style="border-top:1px solid var(--line)"><div class="small muted">${nice(t.date)}${t.pending ? ' · pending' : ''}</div>
        <div><b>${esc(txName(t))}</b> <span class="num">${fm(Math.abs(t.amount))}</span>${f ? ` <span class="small muted">+ ${fm(-f.amount)}</span>` : ''}</div>
        <div class="small" style="margin-top:4px">Is this ${what}?</div>
        <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="sugNo" data-i="${i}">No</button><button class="btn small" data-act="sugYes" data-i="${i}">Yes</button></div></div>`;
    }).join('') + `<div class="empty">Answering keeps the numbers above right. After the first time, the app recognizes these by itself.</div></div>`;
  }
  const stale = !bal.updated ? 'Balance not entered yet' : diffDays(bal.updated, t) === 0 ? 'Balance updated today' : `Balance updated ${diffDays(bal.updated, t)} day${diffDays(bal.updated, t) === 1 ? '' : 's'} ago`;
  let h = `<h1>Bills</h1>
  <div class="card hero">
    <div class="label">Available to spend ${c.hasPay ? `until payday, ${nice(c.np)}` : 'for the next 2 weeks'}</div>
    <div class="big num ${c.safe < 0 ? 'neg' : ''}">${fm(c.safe)}</div>
    <div class="small muted">Checking minus the bills due before payday.${nw ? ' Next week is estimated below.' : ' Bills after payday are not included, so keep some back for next week.'}</div>
    ${bankOn()
      ? (manualBal()
        ? `<div class="small muted" style="margin-top:4px">Using the balance you entered from your bank's app (${whenText(manualBal().at)}) until the bank connection has newer data · <a href="#" data-act="balances">Change</a></div>`
        : `<div class="small muted" style="margin-top:4px">${bankBusy ? `Updating from ${esc(bankName())}...` : `<a href="#" data-act="balances">${bankAgeText()}</a> (updates about once a day) · <a href="#" data-act="balances">Balance details, or enter today's balance from your bank's app</a>`}</div>
         ${!bankBusy && Date.now() - bankAsOf() > 36 * HOUR ? `<div class="small" style="margin-top:4px;color:var(--warn)">The bank data is over a day old, so recent purchases may be missing. For an up-to-the-minute number, enter today's balance from your bank's app.</div>` : ''}`)
        + (S.bank.error ? `<div class="small neg" style="margin-top:4px">${esc(S.bank.error)}</div>` : '')
      : `<div class="small muted" style="margin-top:4px">${stale} · <a href="#" data-act="balances">Update</a></div>`}
    ${c.everyday ? `<div class="small muted" style="margin-top:4px">Usual everyday spending until then: about ${fm(c.everyday)} <span class="tag">not subtracted</span></div>` : ''}
    <details><summary>How this is worked out</summary>
      <div class="breakdown num">
        ${bankOn() ? `<div><span>${manualBal() ? "Checking (entered from your bank's app)" : `Checking at ${esc(bankName())}`}</span><span>${fm(manualBal() ? manualBal().amount : S.bank.bal.checking)}</span></div>
        ${Math.abs(checkingNow() - (manualBal() ? manualBal().amount : S.bank.bal.checking)) > 0.004 ? `<div><span>Paid in the app, not showing at the bank yet</span><span>−${fm((manualBal() ? manualBal().amount : S.bank.bal.checking) - checkingNow())}</span></div>` : ''}`
        : `<div><span>Checking${bal.pending ? ' (after pending payments)' : ''}</span><span>${fm(bal.checking)}</span></div>`}
        <div><span>Bills due before payday (${c.bills.length})</span><span>−${fm(c.billsTotal)}</span></div>
        ${c.aside ? `<div><span>Set aside</span><span>−${fm(c.aside)}</span></div>` : ''}
        <div class="sum"><span>Available to spend</span><span>${fm(c.safe)}</span></div>
        ${savingsNow() ? `<div class="muted"><span>Savings (not counted)</span><span>${fm(savingsNow())}</span></div>` : ''}
      </div></details>
    ${nw ? `<div class="nextweek">
      <div class="nw-label">Estimated available to spend next week, ${nice(nw.p1)} to ${nice(addDays(nw.p2, -1))}</div>
      <div class="nw-amt num ${nw.available < 0 ? 'neg' : ''}">${nw.est ? '<span class="small muted" style="font-weight:400">about</span> ' : ''}${fm(nw.available)}</div>
      <div class="small muted">Today's ${fm(c.safe)} + about ${fm(nw.income)} pay on ${nice(nw.p1)} − ${fm(nw.billsTotal)} in bills due before ${nice(nw.p2)}. If nothing else is spent before payday. Recording spending lowers both numbers.</div>
      ${nw.short > 0 ? `<div class="nw-warn">Next week's pay is ${fm(nw.short)} less than next week's bills, so keep at least <b>${fm(nw.short)}</b> of today's money for them.</div>` : ''}
    </div>` : ''}
  </div>
  ${sugHtml}
  <div class="btns" style="margin-top:10px"><button class="btn" data-act="spend">+ Record spending (groceries, gas, other purchases)</button></div>`;

  // Paychecks that should have arrived but weren't confirmed
  const missed = payList(addDays(t, -10) > S.setupDate ? addDays(t, -10) : S.setupDate, t);
  if (missed.length) h += `<div class="banner warn">Did ${missed.length === 1 ? 'this paycheck' : 'these paychecks'} arrive? ${missed.map(p => `<b>${esc(p.inc.name)}</b> (${nice(p.d)})`).join(', ')}. <a href="#" data-act="tab" data-tab="pay">Confirm on Paydays</a></div>`;
  const todayPay = payList(t, addDays(t, 1));
  if (todayPay.length) h += `<div class="banner good">Payday today: ${todayPay.map(p => esc(p.inc.name)).join(', ')}. <a href="#" data-act="tab" data-tab="pay">Confirm the amounts</a> when they land.</div>`;
  if (c.unknown.length) h += `<div class="banner warn">${c.unknown.map(x => `<b>${esc(x.b.name)}</b>`).join(', ')} ${c.unknown.length === 1 ? 'has' : 'have'} no amount yet, so ${c.unknown.length === 1 ? "it isn't" : "they aren't"} counted. Tap the bill to add one.</div>`;
  if (S.suggestSavings && c.hasPay && !(bankOn() && S.bank.suggest.length)) {
    // Only suggest saving if the cushion stays above the buffer for the next few paydays too,
    // without counting paychecks that haven't been confirmed yet.
    const lowest = Math.min(c.safe - c.everyday, ...periods(4, false).out.map(p => p.run));
    const extra = Math.floor((lowest - (S.savingsBuffer || 0)) / 25) * 25;
    if (extra >= 25) h += `<div class="banner good">You could move <b>${fm(extra)}</b> to savings and still keep at least a ${fm(S.savingsBuffer)} cushion over the next few paydays.</div>`;
  }

  for (const a of (S.bank.feeAlerts || []).filter(a => !a.seen)) {
    const b = findB(a.billId);
    if (!b) continue;
    h += `<div class="banner bad"><b>Higher fee than usual:</b> ${esc(b.name)} charged a ${fm(a.fee)} transaction fee on ${nice(a.date)}. The usual fee is ${fm(a.usual)}. You may want to contact them about it.
      <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="feeSeen" data-bill="${a.billId}" data-date="${a.date}">Got it</button></div></div>`;
  }
  const lastAuto = (S.bank.autoLog || [])[0];
  if (bankOn() && lastAuto && Date.now() - lastAuto.at < 6 * HOUR) h += `<div class="banner good">Matched automatically from ${esc(bankName())}: ${lastAuto.names.map(esc).join(', ')}.</div>`;

  // Spending since the last payday: from the bank when connected, plus anything recorded by hand.
  const since = lastPayday();
  const billTx = new Set(S.payments.map(p => p.txId).concat(S.bank.suggest.map(s => s.txId)).filter(Boolean));
  S.payments.forEach(p => { if (p.feeTxId) billTx.add(p.feeTxId); });
  S.bank.suggest.forEach(s => { if (s.feeTxId) billTx.add(s.feeTxId); if (s.smallId) billTx.add(s.smallId); });
  let bankSpend = bankOn() ? S.bank.tx.filter(t => t.amount < 0 && t.date >= since && !billTx.has(t.id) && !(labelFor(t) || {}).ignore) : [];
  // Charges the user said to combine: show the main charge with its fee as one line.
  const feeOf = {};
  for (const t of bankSpend) {
    if (!(S.bank.feeRules || []).includes(phraseOf(t.desc)) || feeOf[t.id] === null) continue;
    const sm = bankSpend.find(f => f.id !== t.id && !(f.id in feeOf) && phraseOf(f.desc) === phraseOf(t.desc) && Math.abs(diffDays(f.date, t.date)) <= 2 && -f.amount < -t.amount && -f.amount <= Math.max(10, -t.amount * 0.1));
    if (sm) { feeOf[t.id] = sm; feeOf[sm.id] = null; }
  }
  bankSpend = bankSpend.filter(t => feeOf[t.id] !== null);
  const linked = new Set(S.spending.map(x => x.txId).filter(Boolean));
  const handSpend = spendSince(since).filter(x => !x.txId);
  if (bankSpend.length || handSpend.length) {
    const total = sum(bankSpend.map(t => -t.amount + (feeOf[t.id] ? -feeOf[t.id].amount : 0))) + sum(handSpend.map(x => x.amount));
    const n = bankSpend.length + handSpend.length;
    h += `<details class="card" style="margin-top:22px"><summary class="row"><span class="main"><div class="name">Spending since ${nice(since)}</div><div class="sub">${n} purchase${n === 1 ? '' : 's'}${bankOn() ? ` · from ${esc(bankName())}` : ''} · tap to see</div></span><span class="amt num">${fm(total)}</span></summary>
      ${handSpend.map(x => `<button class="row" data-act="spendEdit" data-id="${x.id}"><span class="dot ok"></span><span class="main"><div class="name">${esc(x.what)}${x.note ? ` <span class="muted" style="font-weight:400">· ${esc(x.note)}</span>` : ''}</div><div class="sub">${nice(x.date)} · ${x.cash ? 'cash, entered by hand' : 'entered by hand' + (bankOn() ? ', not at the bank yet' : '')}</div></span><span class="amt num">${fm(x.amount)}</span></button>`).join('')}
      ${bankSpend.map(t => { const l = labelFor(t); return `<button class="row" data-act="txWhat" data-id="${esc(t.id)}"><span class="dot ${t.pending ? 'soon' : 'ok'}"></span><span class="main"><div class="name">${esc(txName(t))}${l && l.cat ? ` <span class="tag">${esc(l.cat)}</span>` : ''}</div><div class="sub">${nice(t.date)}${t.pending ? ' · pending' : ''}${linked.has(t.id) ? ' · also entered by hand' : ''}${feeOf[t.id] ? ` · includes ${fm(-feeOf[t.id].amount)} fee` : ''}${l && l.name ? ` · bank: ${esc(t.desc)}` : ' · tap to name it'}</div></span><span class="amt num">${fm(-t.amount + (feeOf[t.id] ? -feeOf[t.id].amount : 0))}</span></button>`; }).join('')}
    </details>`;
  }

  const overdue = dueList(lookback(), t);
  if (overdue.length) h += section('Overdue bills', overdue, '');
  const wkEnd = addDays(t, 7);
  h += section('Bills due this week', dueList(t, wkEnd), 'No bills due in the next 7 days.');
  const fonm = firstOfNextMonth(t);
  if (wkEnd < fonm) h += section(`Bills due later in ${MONTHL[Number(t.slice(5, 7)) - 1]}`, dueList(wkEnd, fonm), 'No other bills due this month.');
  const nmStart = wkEnd > fonm ? wkEnd : fonm;
  h += section(`Bills due in ${MONTHL[Number(fonm.slice(5, 7)) - 1]}`, dueList(nmStart, firstOfNextMonth(fonm)), 'No bills due.', true);
  const paidThisMonth = dueList(firstOfMonth(t), fonm, false).filter(x => x.p);
  if (paidThisMonth.length) h += section('Bills paid this month', paidThisMonth, '', true);

  for (const info of S.infos) h += infoCard(info);
  if (!S.bills.length) h += `<div class="banner warn">No bills yet. Add them on the <a href="#" data-act="tab" data-tab="bills">Bills</a> tab, or restore a backup file from More.</div>`;
  return h;
}

function infoCard(info) {
  let line = '';
  if (info.endMonth) {
    const end = addDays(firstOfNextMonth(info.endMonth + '-01'), -1);
    const step = info.freq === 'monthly' ? 30.44 : info.freq === 'biweekly' ? 14 : 7;
    const left = Math.max(0, Math.ceil(diffDays(today(), end) / step));
    line = `About <b>${left}</b> payment${left === 1 ? '' : 's'} left, ending ${monthName(info.endMonth + '-01')}.`;
  } else line = 'Add the end month (More › Info) to see a countdown.';
  return `<button class="card row" style="margin-top:22px" data-act="editInfo" data-id="${info.id}">
    <span class="main"><div class="name">${esc(info.name)}</div><div class="sub">${info.amount ? fm(info.amount) + ' ' + (info.freq === 'monthly' ? 'a month' : info.freq === 'biweekly' ? 'every 2 weeks' : 'a week') + ' · ' : ''}${esc(info.note || 'For information only, not counted as a bill')}</div><div class="sub">${line}</div></span></button>`;
}

function viewPay() {
  const t = today();
  const { c, out, todayPays } = periods(8);
  let h = `<div class="toolbar"><h1>Paydays</h1><button class="btn small ghost" data-act="incomes">Edit paychecks</button></div>`;
  const missed = payList(addDays(t, -14) > S.setupDate ? addDays(t, -14) : S.setupDate, t);
  if (missed.length) {
    h += `<h2>Did these arrive?</h2><div class="card">` + missed.map(p => incRow(p)).join('') + `</div>`;
  }
  if (todayPays.length) {
    h += `<h2>Payday today<span class="tot num">${todayPays.some(p => p.est) ? '~' : ''}${fm(sum(todayPays.map(p => p.amt)))}</span></h2><div class="card">` + todayPays.map(p => incRow(p)).join('') +
      `<div class="empty">Tap each one when it shows up in your bank, to add it to checking.</div></div>`;
  }
  h += `<div class="card pad" style="margin-top:14px"><div class="small muted">Now until ${c.hasPay ? nice(c.np) : 'payday'}</div><div class="num" style="font-size:22px;font-weight:700"><span class="${c.safe < 0 ? 'neg' : ''}">${fm(c.safe)}</span> <span class="small muted" style="font-weight:400">available to spend${todayPays.length ? ', before today\'s pay' : ''}</span></div>
    ${c.everyday ? `<div class="small muted">Usual everyday spending until then: about ${fm(c.everyday)}. The forecast below allows for it.</div>` : ''}</div>`;
  if (!out.length) {
    h += `<div class="banner warn">No paychecks set up yet. <a href="#" data-act="editInc">Add a paycheck</a></div>`;
    return h;
  }
  for (const p of out) {
    const short = p.left < 0;
    h += `<div class="card period" style="margin-top:12px">
      <div class="head"><span class="when">${nice(p.d)}</span><span class="small muted">to ${nice(addDays(p.end, -1))}</span></div>
      ${p.incs.map(x => incRow(x)).join('')}
      <div class="lines num">
        <div><span>Paychecks</span><span>${p.incs.some(x => x.est) ? '~' : ''}${fm(p.inTot)}</span></div>
        <div><span>Bills (${p.bills.length})</span><span>−${fm(p.bt)}</span></div>
        <div><span>Everyday spending</span><span>−${fm(p.ev)}</span></div>
        <div class="sum"><span>${short ? 'Short by' : 'Left over'}</span><span class="${short ? 'neg' : 'pos'}">${fm(Math.abs(p.left))}</span></div>
        <div class="muted"><span>Expected cushion after</span><span class="${p.run < 0 ? 'neg' : ''}">${fm(p.run)}</span></div>
      </div>
      ${p.bills.length ? `<details><summary>Show the ${p.bills.length} bill${p.bills.length === 1 ? '' : 's'}</summary>${p.bills.map(billRow).join('')}</details>` : ''}
    </div>`;
  }
  h += `<p class="small muted" style="margin:14px 4px">"Expected cushion" is a forecast: what's available to spend now, minus usual everyday spending, plus each paycheck, minus bills. Set everyday spending to 0 under More › Planning to leave it out. ~ means an estimate.</p>`;
  return h;
}
function incRow(p) {
  return `<button class="row" data-act="recv" data-id="${p.inc.id}" data-d="${p.d}">
    <span class="dot ${p.r ? 'paid' : p.d < today() ? 'soon' : 'ok'}"></span>
    <span class="main"><div class="name">${esc(p.inc.name)}</div><div class="sub">${p.inc.owner ? `<b>${esc(p.inc.owner)}</b> · ` : ''}${nice(p.d)} · ${p.r ? 'received' : p.d < today() ? 'tap to confirm' : rel(p.d)}</div></span>
    <span class="amt num">${p.est ? '~' : ''}${fm(p.amt)}</span></button>`;
}

function viewBills() {
  const t = today();
  const rows = S.bills.map(b => {
    const next = dueList(lookback(), addDays(t, 400)).find(x => x.b.id === b.id);
    return { b, next };
  }).sort((x, y) => (x.b.active === false) - (y.b.active === false) || (x.next ? x.next.d : '9999').localeCompare(y.next ? y.next.d : '9999'));
  const monthly = sum(S.bills.filter(b => b.active !== false).map(b => {
    const a = billAmt(b).v;
    return b.freq === 'monthly' ? a : b.freq === 'weekly' ? a * 52 / 12 : b.freq === 'biweekly' ? a * 26 / 12 : b.freq === 'yearly' ? a / 12 : 0;
  }));
  let h = `<div class="toolbar"><h1>All bills</h1><button class="btn small" data-act="editBill">+ Add</button></div>
  <p class="small muted" style="margin:0 4px 10px">About <b>${fm(monthly)}</b> a month in total.</p><div class="card">`;
  h += rows.length ? rows.map(({ b, next }) => {
    const a = billAmt(b);
    return `<button class="row" data-act="editBill" data-id="${b.id}">
      <span class="dot ${b.active === false ? '' : 'ok'}"></span>
      <span class="main"><div class="name">${esc(b.name)}${b.varies ? ' <span class="tag">varies</span>' : ''}${b.active === false ? ' <span class="tag">stopped</span>' : ''}</div>
      <div class="sub">${freqText(b)}${next ? ' · next ' + nice(next.d) : ''}</div></span>
      <span class="amt num">${a.unknown ? '<span class="tag warn">amount?</span>' : (a.est ? '~' : '') + fm(a.v)}</span></button>`;
  }).join('') : `<div class="empty">No bills yet. Tap + Add.</div>`;
  h += `</div>`;
  // Transaction fees paid over the last 12 months, per bill, so unusually high ones stand out.
  const yearAgo = addDays(today(), -365);
  const feePays = S.payments.filter(p => p.fee && (p.paidOn || p.due) >= yearAgo);
  if (feePays.length || S.bills.some(b => b.fee)) {
    const byBill = {};
    feePays.forEach(p => { (byBill[p.billId] = byBill[p.billId] || []).push(p); });
    h += `<h2>Transaction fees, last 12 months<span class="tot num">${fm(sum(feePays.map(p => p.fee)))}</span></h2><div class="card">` +
      S.bills.filter(b => b.fee || byBill[b.id]).map(b => {
        const ps = (byBill[b.id] || []).sort((x, y) => (y.paidOn || y.due).localeCompare(x.paidOn || x.due));
        const high = ps.length ? Math.max(...ps.map(p => p.fee)) : 0;
        return `<button class="row" data-act="editBill" data-id="${b.id}"><span class="main"><div class="name">${esc(b.name)}</div>
          <div class="sub">Usual fee ${fm(b.fee || 0)}${ps.length ? ` · ${ps.length} paid, last ${fm(ps[0].fee)} on ${nice(ps[0].paidOn || ps[0].due)}` : ''}${high > (b.fee || 0) + 0.01 ? ` · <span class="neg">highest ${fm(high)}</span>` : ''}</div></span>
          <span class="amt num">${fm(sum(ps.map(p => p.fee)))}</span></button>`;
      }).join('') + `<div class="empty">Fees charged on top of a bill. If one looks too high, contact the business about it.</div></div>`;
  }
  return h;
}

function viewMore() {
  const bal = S.balances;
  let h = `<h1>More</h1>
  <h2>Bank connection</h2><div class="card">${bankAccess()
    ? `<div class="pad"><div><b>${bankOn() ? `Connected to ${esc(bankName())}` : 'Connected, waiting for the first update'}</b></div>
        <div class="small muted">${bankBusy ? 'Updating now...' : S.bank.fetchedAt ? `${S.bank.bal ? bankAgeText() + '. ' : ''}SimpleFIN gets new data from the bank about once a day; the app checks for it every hour while open (last checked ${timeAgo(S.bank.fetchedAt)}).` : 'Not updated yet.'}</div>
        ${S.bank.error ? `<div class="small neg" style="margin-top:4px">${esc(S.bank.error)}</div>` : ''}
        <div class="btns"><button class="btn small" data-act="bankRefresh">Update now</button><button class="btn small ghost" data-act="bankAccounts">Choose accounts</button></div>
        <div class="btns"><button class="btn small danger" data-act="bankDisconnect">Disconnect bank</button></div></div>`
    : `<div class="pad"><p>Connect your bank so balances, spending and paid bills update by themselves, for everyone using the app.</p>
        <div class="btns"><button class="btn" data-act="bankConnect">Connect bank</button></div>
        <p class="hint">Uses SimpleFIN Bridge (a paid service, about $15 a year). You sign in to your bank on SimpleFIN's website, never in this app.</p></div>`}</div>

  <h2>Balances</h2><div class="card">
    <button class="row" data-act="balances"><span class="main"><div class="name">Checking</div><div class="sub">${bankOn() ? (manualBal() ? `Entered from your bank's app ${whenText(manualBal().at)}` : bankAgeText()) + ' · tap to enter today\'s balance' : bal.updated ? 'Updated ' + nice(bal.updated) : 'Not entered yet'}</div></span><span class="amt num">${fm(checkingNow())}</span></button>
    <button class="row" data-act="balances"><span class="main"><div class="name">Savings</div></span><span class="amt num">${fm(savingsNow())}</span></button></div>

  <h2>Set aside</h2><div class="card">${S.setAsides.map(a => `<button class="row" data-act="editAside" data-id="${a.id}"><span class="main"><div class="name">${esc(a.name)}</div><div class="sub">Not counted as spendable</div></span><span class="amt num">${fm(a.amount)}</span></button>`).join('') || '<div class="empty">Money you are holding for something specific, like a repair.</div>'}
    <div class="list-actions"><button class="btn small ghost" data-act="editAside">+ Set money aside</button></div></div>

  <h2>Info</h2><div class="card">${S.infos.map(i => `<button class="row" data-act="editInfo" data-id="${i.id}"><span class="main"><div class="name">${esc(i.name)}</div><div class="sub">Shown on Home, not counted</div></span><span class="amt num">${i.amount ? fm(i.amount) : ''}</span></button>`).join('') || '<div class="empty">Things to keep an eye on that are not bills (for example a payment taken from your paycheck).</div>'}
    <div class="list-actions"><button class="btn small ghost" data-act="editInfo">+ Add info</button></div></div>

  <h2>Planning</h2><div class="card">
    <button class="row" data-act="planning"><span class="main"><div class="name">Everyday spending</div><div class="sub">Groceries, gas, eating out and so on</div></span><span class="amt num">${fm(S.everydayPerWeek)}/wk</span></button>
    <button class="row" data-act="planning"><span class="main"><div class="name">Savings tips</div><div class="sub">${S.suggestSavings ? `On, keeps a ${fm(S.savingsBuffer)} cushion` : 'Off'}</div></span></button></div>

  <h2>Reminders</h2><div class="card pad">
    <p>Put every bill in your iPhone Calendar with alerts, so you're reminded even when the app is closed.</p>
    <div class="btns"><button class="btn" data-act="calendar">Add bills to Calendar</button></div>
    <p class="hint">Only each bill's name, amount and due date go into the calendar. If you change bills later, delete the old "Bill due" events before adding them again.</p></div>

  <h2>Backup</h2><div class="card pad">
    <p>Your data lives only on this phone. Save a backup file to iCloud Drive or Files now and then.</p>
    <div class="btns"><button class="btn" data-act="backup">Save backup</button>
    <label class="btn ghost file-btn" style="margin:0">Restore<input type="file" accept=".json,application/json" data-act="restore"></label></div></div>

  <h2>Other</h2><div class="card pad">
    <p class="small muted">Bill Planner ${APP_VERSION}. No accounts, no tracking, nothing sent anywhere.</p>
    <div class="btns"><button class="btn danger" data-act="erase">Erase everything</button></div></div>`;
  return h;
}

function viewWelcome() {
  return `<div class="welcome">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Bill Planner</h1>
    <p class="muted">See what's due, what's coming in, and what's available to spend until payday. Everything stays on this device.</p>
  </div>
  <div class="card pad" style="margin-top:16px">
    <label class="btn block file-btn" style="margin:0">Load my starter or backup file<input type="file" accept=".json,application/json" data-act="restore"></label>
    <div class="btns"><button class="btn ghost" data-act="startEmpty">Start empty</button><button class="btn ghost" data-act="demo">Try a demo</button></div>
  </div>`;
}

/* ---------- sheets (pop-up forms) ---------- */
function openSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = html;
  sh.hidden = false; $('#scrim').hidden = false;
  sh.querySelectorAll('input[inputmode=decimal]:not([placeholder])').forEach(i => { i.placeholder = '0.00'; });
  const f = sh.querySelector('input:not([type=checkbox]):not([type=hidden]), select');
  if (f && !('ontouchstart' in window)) f.focus();
}
function closeSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; $('#sheet').innerHTML = ''; }
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  // Long enough to read (about 5 seconds, longer for long messages); tapping it closes it sooner.
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, Math.max(5000, msg.length * 70));
  t.onclick = () => { t.hidden = true; };
}
const cancelBtn = `<button type="button" class="btn ghost" data-act="close">Cancel</button>`;
// Amount boxes start empty instead of "0.00", so there's nothing to delete before typing.
const money2 = v => (v == null || Number(v) === 0 ? '' : (Math.round(v * 100) / 100).toFixed(2));

function sheetPay(b, d) {
  const p = paidRec(b, d);
  const a = billAmt(b);
  if (p) {
    openSheet(`<h3>${esc(b.name)}</h3><p class="muted">Due ${nice(d)} · paid ${nice(p.paidOn || d)}</p>
      <p style="font-size:28px;font-weight:700" class="num">${fm(p.amount)}</p>
      ${p.adjusted ? `<p class="hint">Marking it unpaid adds ${fm(p.amount)} back to your checking balance.</p>` : ''}
      <div class="btns">${cancelBtn}<button class="btn danger" data-act="unpay" data-id="${b.id}" data-d="${d}">Mark not paid</button></div>`);
    return;
  }
  openSheet(`<form id="fPay" data-id="${b.id}" data-d="${d}">
    <h3>${esc(b.name)}</h3><p class="muted">Due ${nice(d)} · ${rel(d)}</p>
    <div class="two"><div><label for="pAmt">Amount paid</label><input id="pAmt" name="amount" inputmode="decimal" value="${a.unknown ? '' : money2(a.v)}" placeholder="0.00" required></div>
    <div><label for="pOn">Paid on</label><input id="pOn" name="paidOn" type="date" value="${today()}" required></div></div>
    ${a.est ? `<p class="hint">The amount is an estimate. Change it to what you really paid.</p>` : ''}
    ${bankOn() ? `<p class="hint">It's subtracted from checking until ${esc(bankName())} shows the payment (usually 3-5 business days), then matched automatically.</p>`
    : `<label class="check"><input type="checkbox" name="adjust" checked> Subtract it from my checking balance</label>
    <p class="hint">Untick this if you have already updated your balance since paying.</p>`}
    <div class="btns">${cancelBtn}<button class="btn">Mark paid</button></div></form>`);
}
function sheetRecv(inc, d) {
  const r = rcptRec(inc, d);
  if (r) {
    openSheet(`<h3>${esc(inc.name)}</h3><p class="muted">${nice(d)} · received</p><p style="font-size:28px;font-weight:700" class="num">${fm(r.amount)}</p>
      <div class="btns">${cancelBtn}<button class="btn danger" data-act="unrecv" data-id="${inc.id}" data-d="${d}">Mark not received</button></div>`);
    return;
  }
  const a = incAmt(inc);
  openSheet(`<form id="fRecv" data-id="${inc.id}" data-d="${d}">
    <h3>${esc(inc.name)}</h3><p class="muted">Payday ${nice(d)}</p>
    <label for="rAmt">Amount that landed in checking</label><input id="rAmt" name="amount" inputmode="decimal" value="${money2(a.v)}" required>
    ${a.est ? `<p class="hint">This one varies. Enter the real amount so future estimates get better.</p>` : ''}
    ${bankOn() ? `<p class="hint">Your balance comes from ${esc(bankName())}, so this only records the amount.</p>`
    : `<label class="check"><input type="checkbox" name="adjust" checked> Add it to my checking balance</label>
    <p class="hint">Untick this if you have already updated your balance since it arrived.</p>`}
    <div class="btns">${cancelBtn}<button class="btn">Received</button></div>
    <div class="btns"><button type="button" class="btn ghost" data-act="editInc" data-id="${inc.id}">Edit this paycheck</button></div></form>`);
}
function freqFields(x, prefix) {
  const f = x.freq || 'monthly';
  return `<label for="${prefix}Freq">How often</label>
    <select id="${prefix}Freq" name="freq" data-act="freqChange">
      <option value="monthly"${f === 'monthly' ? ' selected' : ''}>Monthly</option>
      <option value="biweekly"${f === 'biweekly' ? ' selected' : ''}>Every 2 weeks</option>
      <option value="weekly"${f === 'weekly' ? ' selected' : ''}>Every week</option>
      <option value="yearly"${f === 'yearly' ? ' selected' : ''}>Yearly</option></select>
    <div data-show="monthly"${f === 'monthly' ? '' : ' hidden'}><label for="${prefix}Day">Day of the month</label><input id="${prefix}Day" name="day" type="number" min="1" max="31" inputmode="numeric" value="${x.day || ''}"></div>
    <div data-show="other"${f === 'monthly' ? ' hidden' : ''}><label for="${prefix}Anchor">Next date</label><input id="${prefix}Anchor" name="anchor" type="date" value="${x.anchor || ''}"><p class="hint">Any upcoming date it happens on. The rest are worked out from it.</p></div>`;
}
function readFreq(fd) {
  const freq = fd.get('freq');
  const o = { freq };
  if (freq === 'monthly') { const d = parseInt(fd.get('day'), 10); if (!(d >= 1 && d <= 31)) return null; o.day = d; o.anchor = null; }
  else { const a = fd.get('anchor'); if (!a) return null; o.anchor = a; o.day = null; }
  return o;
}
// draft: values to pre-fill a new bill (for example one made from a bank transaction).
function sheetBill(b, draft) {
  const x = b || draft || { freq: 'monthly' };
  const hist = b ? S.payments.filter(p => p.billId === b.id).sort((p, q) => q.due.localeCompare(p.due)).slice(0, 6) : [];
  openSheet(`<form id="fBill" data-id="${b ? b.id : ''}" data-tx="${esc((draft && draft.txId) || '')}" data-due="${esc((draft && draft.anchor) || '')}">
    <h3>${b ? 'Edit bill' : 'New bill'}</h3>
    <label for="bName">Name you see in the app</label><input id="bName" name="name" value="${esc(x.name || '')}" placeholder="For example: Water / sewer / trash" required>
    ${freqFields(x, 'b')}
    <label for="bAmt">Usual amount</label><input id="bAmt" name="amount" inputmode="decimal" value="${money2(x.amount)}" placeholder="Leave empty if you don't know yet">
    <label for="bFee">Transaction fee charged with it</label><input id="bFee" name="fee" inputmode="decimal" value="${money2(x.fee)}" placeholder="Optional, for example 2.25">
    <p class="hint">A small extra charge that comes with this bill on the same day. It's added to the bill's total.</p>
    <label class="check"><input type="checkbox" name="varies"${x.varies ? ' checked' : ''}> The amount changes (like electric or water)</label>
    <label for="bMatch">How the bank shows it</label><input id="bMatch" name="match" value="${esc((x.match || []).join(', '))}" autocapitalize="characters" placeholder="Filled in when you confirm a bank payment">
    <p class="hint">Words from the bank's description used to recognize this bill, for example TOWN MULDROW. Only used for matching; the name above is what you see. Separate several with commas.</p>
    <label class="check"><input type="checkbox" name="active"${x.active === false ? '' : ' checked'}> Still paying this</label>
    <label for="bNote">Note</label><input id="bNote" name="note" value="${esc(x.note || '')}" placeholder="Optional">
    ${hist.length ? `<label>Recent payments</label><div class="small num">${hist.map(p => `<div class="toolbar"><span>${nice(p.due)}</span><span>${fm(p.amount)}${p.fee ? ` <span class="${b && b.fee && p.fee > b.fee + 0.01 ? 'neg' : 'muted'}">(includes ${fm(p.fee)} fee)</span>` : ''}</span></div>`).join('')}</div>` : ''}
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div>
    ${b && b.fee ? `<div class="btns"><button type="button" class="btn ghost" data-act="splitFee" data-id="${b.id}">Split the ${fm(b.fee)} fee back into its own bill</button></div>` : ''}
    ${b ? `<div class="btns"><button type="button" class="btn danger" data-act="delBill" data-id="${b.id}">Delete bill</button></div>` : ''}
  </form>`);
}
// List of all paychecks, opened from the Paydays tab.
function sheetIncomes() {
  openSheet(`<h3>Paychecks</h3><p class="hint">Tap one to change its name, whose it is, schedule or usual amount.</p>
    <div class="card" style="margin-top:10px">${S.incomes.map(i => `<button class="row" data-act="editInc" data-id="${i.id}"><span class="main"><div class="name">${esc(i.name)}${i.active === false ? ' <span class="tag">stopped</span>' : ''}</div><div class="sub">${i.owner ? `<b>${esc(i.owner)}</b> · ` : ''}${freqText(i)}${i.varies ? ' · amount varies' : ''}</div></span><span class="amt num">${incAmt(i).est ? '~' : ''}${fm(incAmt(i).v)}</span></button>`).join('') || '<div class="empty">No paychecks yet.</div>'}</div>
    <div class="btns"><button class="btn ghost" data-act="close">Done</button><button class="btn" data-act="editInc">+ Add paycheck</button></div>`);
}
function sheetInc(i) {
  const x = i || { freq: 'biweekly' };
  openSheet(`<form id="fInc" data-id="${i ? i.id : ''}">
    <h3>${i ? 'Edit paycheck' : 'New paycheck'}</h3>
    <div class="two"><div><label for="iName">Name</label><input id="iName" name="name" value="${esc(x.name || '')}" required></div>
    <div><label for="iOwner">Whose</label><input id="iOwner" name="owner" value="${esc(x.owner || '')}" placeholder="A name"></div></div>
    ${freqFields(x, 'i')}
    <label for="iAmt">Usual take-home amount</label><input id="iAmt" name="amount" inputmode="decimal" value="${money2(x.amount)}" required>
    <label class="check"><input type="checkbox" name="varies"${x.varies ? ' checked' : ''}> The amount changes (extra hours and so on)</label>
    <label class="check"><input type="checkbox" name="active"${x.active === false ? '' : ' checked'}> Still getting this</label>
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div>
    ${i ? `<div class="btns"><button type="button" class="btn danger" data-act="delInc" data-id="${i.id}">Delete paycheck</button></div>` : ''}
  </form>`);
}
function sheetAside(a) {
  const x = a || {};
  openSheet(`<form id="fAside" data-id="${a ? a.id : ''}">
    <h3>${a ? 'Set-aside money' : 'Set money aside'}</h3>
    <p class="hint">Money in checking that is already meant for something. It is left out of "available to spend".</p>
    <label for="aName">What it's for</label><input id="aName" name="name" value="${esc(x.name || '')}" required>
    <label for="aAmt">Amount still set aside</label><input id="aAmt" name="amount" inputmode="decimal" value="${money2(x.amount)}" required>
    ${a ? `<label for="aSpent">Just spent some of it?</label><input id="aSpent" name="spent" inputmode="decimal" placeholder="Amount spent (optional)">
    <label class="check"><input type="checkbox" name="adjust" checked> Also subtract what I spent from checking</label>` : ''}
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div>
    ${a ? `<div class="btns"><button type="button" class="btn danger" data-act="delAside" data-id="${a.id}">Remove</button></div>` : ''}
  </form>`);
}
function sheetInfo(i) {
  const x = i || { freq: 'weekly' };
  openSheet(`<form id="fInfo" data-id="${i ? i.id : ''}">
    <h3>${i ? 'Edit info' : 'New info'}</h3>
    <p class="hint">Shown on Home to keep an eye on. Never counted as a bill.</p>
    <label for="nName">Name</label><input id="nName" name="name" value="${esc(x.name || '')}" required>
    <div class="two"><div><label for="nAmt">Amount</label><input id="nAmt" name="amount" inputmode="decimal" value="${money2(x.amount)}"></div>
    <div><label for="nFreq">How often</label><select id="nFreq" name="freq">
      <option value="weekly"${x.freq === 'weekly' ? ' selected' : ''}>Weekly</option>
      <option value="biweekly"${x.freq === 'biweekly' ? ' selected' : ''}>Every 2 weeks</option>
      <option value="monthly"${x.freq === 'monthly' ? ' selected' : ''}>Monthly</option></select></div></div>
    <label for="nEnd">Last month of payments</label><input id="nEnd" name="endMonth" type="month" value="${esc(x.endMonth || '')}">
    <label for="nNote">Note</label><input id="nNote" name="note" value="${esc(x.note || '')}">
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div>
    ${i ? `<div class="btns"><button type="button" class="btn danger" data-act="delInfo" data-id="${i.id}">Remove</button></div>` : ''}
  </form>`);
}
/* Bill payments and recorded purchases that may not have reached the bank yet.
   Bill payments can take 3-5 business days; card purchases usually show within a day or two. */
function pendingItems() {
  const t = today();
  const bills = S.payments.filter(p => !p.cleared && p.adjusted !== false && p.paidOn && diffDays(p.paidOn, t) <= 14 && p.paidOn >= S.setupDate)
    .map(p => { const b = S.bills.find(x => x.id === p.billId); return { key: 'b|' + p.billId + '|' + p.due, rec: p, name: b ? b.name : 'Bill', amount: p.amount, date: p.paidOn, tick: diffDays(p.paidOn, t) <= 7 }; });
  const spends = S.spending.filter(x => !x.cleared && x.adjusted !== false && diffDays(x.date, t) <= 14)
    .map(x => ({ key: 's|' + x.id, rec: x, name: x.what + (x.note ? ' · ' + x.note : ''), amount: x.amount, date: x.date, tick: diffDays(x.date, t) <= 2 }));
  return bills.concat(spends).sort((a, b) => b.date.localeCompare(a.date));
}
// With a bank connected, balances come from the bank; this just explains them.
function sheetBankBalances() {
  const pays = inTransitPays(), spends = inTransitSpends();
  const m = manualBal();
  const items = [...pays.map(p => ({ key: itemKey(p), name: (findB(p.billId) || {}).name || 'Bill', amount: p.amount, date: p.paidOn, tick: diffDays(p.paidOn, today()) <= 5 })),
                 ...spends.map(x => ({ key: itemKey(x), name: x.what + (x.note ? ' · ' + x.note : ''), amount: x.amount, date: x.date, tick: false }))];
  openSheet(`<h3>Balances</h3>
    ${m ? `<div class="banner good" style="margin-top:6px">Using the balance you entered from your bank's app: <b>${fm(m.amount)}</b> (${whenText(m.at)}). It will be replaced automatically as soon as newer data comes in through your bank connection.
      <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="manualClear">Go back to the automatic balance now</button></div></div>` : ''}
    <label style="margin-top:14px">Automatic balance from your bank connection</label>
    <p class="hint" style="margin-top:0">${bankAgeText()}. Your bank connection (SimpleFIN) gets new information from your bank only about once a day, and new purchases can take a few days to show up.</p>
    <div class="breakdown num" style="font-size:15px">
      ${S.bank.bal.posted != null ? `<div class="muted"><span>Posted balance</span><span>${fm(S.bank.bal.posted)}</span></div>` : ''}
      <div class="muted"><span>Pending transactions</span><span>${S.bank.bal.pendingSum < 0 ? '−' : ''}${fm(Math.abs(S.bank.bal.pendingSum || 0))}</span></div>
      <div><span>Available at ${esc(bankName())}${S.bank.bal.available != null ? '' : ' (posted + pending)'}</span><span>${fm(S.bank.bal.checking)}</span></div>
      ${pays.map(p => `<div><span>${esc((findB(p.billId) || {}).name || 'Bill')}, paid ${nice(p.paidOn)}, not at the bank yet</span><span>−${fm(p.amount)}</span></div>`).join('')}
      ${spends.map(x => `<div><span>${esc(x.what)}, ${nice(x.date)}, not at the bank yet</span><span>−${fm(x.amount)}</span></div>`).join('')}
      <div class="sum"><span>Checking used by the app</span><span>${fm(checkingNow())}</span></div>
      <div class="muted"><span>Savings</span><span>${fm(savingsNow())}</span></div></div>
    <p class="hint">Pending transactions count as real ones. Payments you mark paid in the app are subtracted until they show up through the bank connection (usually 3-5 business days), then they are matched automatically.</p>

    <form id="fManual" style="border-top:1px solid var(--line);margin-top:14px;padding-top:4px">
      <label for="mBal" style="color:var(--text);font-weight:600;font-size:16px">Enter today's balance from your bank's app</label>
      <p class="hint" style="margin-top:2px">Your bank's own app is up to the minute; the bank connection is not. If money has been spent or deposited since the connection last updated, open your bank's app and type the <b>available balance</b> it shows. This brings every number in Bill Planner up to date right now. The app goes back to the automatic balance by itself as soon as newer data comes in through the bank connection.</p>
      <input id="mBal" name="amount" inputmode="decimal" placeholder="Available balance from your bank's app">
      ${items.length ? `<label>Entered in Bill Planner but not showing in your bank's app yet?</label>
        <p class="hint" style="margin-top:0">Ticked ones are subtracted from the balance you type. Untick any your bank's app already shows.</p>
        ${items.map(i => `<label class="check"><input type="checkbox" name="keep" value="${esc(i.key)}"${i.tick ? ' checked' : ''}> ${esc(i.name)} · ${fm(i.amount)} <span class="muted small">${nice(i.date)}</span></label>`).join('')}` : ''}
      <div class="btns"><button type="button" class="btn ghost" data-act="close">Close</button><button class="btn">Use this balance</button></div>
    </form>
    <div class="btns"><button class="btn small ghost" data-act="bankRefresh">Check the bank connection for new data</button></div>`);
}
function sheetConnect() {
  openSheet(`<form id="fConnect"><h3>Connect your bank</h3>
    <ol class="small" style="padding-left:20px;margin:8px 0">
      <li>On SimpleFIN Bridge (bridge.simplefin.org), sign up and connect your bank. You sign in to your bank there, not here.</li>
      <li>In SimpleFIN, create a new <b>app connection</b> and copy the <b>setup token</b> it shows.</li>
      <li>Paste it below. Each phone needs its own setup token.</li></ol>
    <label for="sfTok">SimpleFIN setup token</label><textarea id="sfTok" name="token" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the setup token here"></textarea>
    <p class="hint">Only a read-only connection key is kept, on this phone only. It is never put in backup files, and nothing can move money with it.</p>
    <div class="btns">${cancelBtn}<button class="btn">Connect</button></div></form>`);
}
function sheetAccounts() {
  const opts = sel => S.bank.accounts.map(a => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}${a.org ? ' (' + esc(a.org) + ')' : ''} · ${fm(a.available != null && !isNaN(a.available) ? a.available : a.balance)}</option>`).join('');
  openSheet(`<form id="fAccounts"><h3>Choose accounts</h3>
    <label for="acCh">Checking account (bills come out of this one)</label><select id="acCh" name="checking">${opts(S.bank.checkingId)}</select>
    <label for="acSv">Savings account</label><select id="acSv" name="savings"><option value="">None</option>${opts(S.bank.savingsId)}</select>
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div></form>`);
}
function sheetBalances() {
  if (bankOn()) { sheetBankBalances(); return; }
  const pend = pendingItems();
  openSheet(`<form id="fBal"><h3>Balances</h3><p class="hint">Copy the balances your bank app shows. Bills you mark paid, spending you record and paychecks you confirm keep checking up to date between updates.</p>
    <label for="cBal">Checking, as your bank shows it</label><input id="cBal" name="checking" inputmode="decimal" value="${pend.length ? '' : money2(S.balances.checking)}" placeholder="0.00" required>
    ${pend.length ? `<label>Entered in the app but not showing in the bank yet?</label>
      <p class="hint" style="margin-top:0">Bill payments can take 3-5 business days to post, purchases a day or two. Ticked ones are subtracted from the bank's number. Untick any that already show in your bank.</p>
      ${pend.map(p => `<label class="check"><input type="checkbox" name="pend" value="${esc(p.key)}"${p.tick ? ' checked' : ''}> ${esc(p.name)} · ${fm(p.amount)} <span class="muted small">${nice(p.date)}</span></label>`).join('')}` : ''}
    <label for="sBal">Savings</label><input id="sBal" name="savings" inputmode="decimal" value="${money2(S.balances.savings)}">
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div></form>`);
}
function sheetPlanning() {
  openSheet(`<form id="fPlan"><h3>Planning</h3>
    <label for="eDay">Everyday spending per week</label><input id="eDay" name="everyday" inputmode="decimal" value="${money2(S.everydayPerWeek)}">
    <p class="hint">Groceries, gas, eating out, household things. Shown next to "available to spend" and used in the Paydays forecast, but not subtracted from it.</p>
    <label class="check"><input type="checkbox" name="suggest"${S.suggestSavings ? ' checked' : ''}> Suggest moving extra money to savings</label>
    <label for="sBuf">Cushion to keep before suggesting savings</label><input id="sBuf" name="buffer" inputmode="decimal" value="${money2(S.savingsBuffer)}">
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div></form>`);
}
function sheetSpend() {
  openSheet(`<form id="fSpend"><h3>Record spending</h3>
    <p class="hint">Anything that comes out of checking that isn't a bill: groceries, gas, a repair, a surprise cost. It lowers "available to spend" right away.</p>
    <label for="xAmt">Amount spent</label><input id="xAmt" name="amount" inputmode="decimal" required>
    <label for="xWhat">What it was for</label><select id="xWhat" name="what">${SPEND_KINDS.map(k => `<option>${k}</option>`).join('')}</select>
    <label for="xNote">Note</label><input id="xNote" name="note" placeholder="Optional, for example the store">
    <label for="xDate">Date</label><input id="xDate" name="date" type="date" value="${today()}" required>
    <label class="check"><input type="checkbox" name="cash"> Paid with cash (not from checking)</label>
    ${bankOn()
      ? `<p class="hint">Card purchases are subtracted until ${esc(bankName())} shows them, then matched automatically. Purchases usually show up at the bank by themselves, so you only need this for ones that haven't yet, or for cash.</p>`
      : `<label class="check"><input type="checkbox" name="adjust" checked> Subtract it from my checking balance</label>
    <p class="hint">Untick this if you have already updated your balance since spending it.</p>`}
    <div class="btns">${cancelBtn}<button class="btn">Record</button></div></form>`);
}
function sheetSpendEdit(x) {
  openSheet(`<h3>${esc(x.what)}${x.note ? ' · ' + esc(x.note) : ''}</h3><p class="muted">Recorded for ${nice(x.date)}</p>
    <p style="font-size:28px;font-weight:700" class="num">${fm(x.amount)}</p>
    ${x.adjusted ? `<p class="hint">Removing it adds ${fm(x.amount)} back to your checking balance.</p>` : ''}
    <div class="btns">${cancelBtn}<button class="btn danger" data-act="delSpend" data-id="${x.id}">Remove this spending</button></div>`);
}

/* ---------- files: backup, restore, calendar ---------- */
async function shareOrDownload(name, text, type) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function backup() {
  S.lastBackup = today(); save();
  shareOrDownload(`bill-planner-backup-${today()}.json`, JSON.stringify(S, null, 1), 'application/json');
}
function restoreFile(file) {
  const r = new FileReader();
  r.onload = () => {
    let data;
    try { data = JSON.parse(r.result); } catch (e) { toast("That file isn't a Bill Planner backup."); return; }
    if (!data || data.version !== 1 || !Array.isArray(data.bills)) { toast("That file isn't a Bill Planner backup."); return; }
    if (S && (S.bills.length || S.incomes.length) && !confirm('Replace everything in the app with this file?')) return;
    // A starter file begins counting from the day it is loaded, so earlier bills don't show as overdue.
    if (data.starter) { data.setupDate = today(); delete data.starter; }
    S = normalize(data);
    save(); tab = data.balances && data.balances.updated ? 'home' : 'more'; closeSheet(); render();
    if (tab === 'more') { setTimeout(sheetBalances, 400); }
    toast(`Loaded ${S.bills.length} bills and ${S.incomes.length} paychecks.${tab === 'more' ? ' Now enter your balances.' : ''}`);
  };
  r.readAsText(file);
}
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
function buildIcs() {
  const t = today();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bill Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Bills'];
  let n = 0;
  for (const b of S.bills) {
    if (b.active === false) continue;
    const first = occ(b, t, addDays(t, 400))[0];
    if (!first) continue;
    let rule;
    if (b.freq === 'monthly') rule = b.day >= 31 ? 'FREQ=MONTHLY;BYMONTHDAY=-1' : `FREQ=MONTHLY;BYMONTHDAY=${b.day}`;
    else if (b.freq === 'weekly') rule = 'FREQ=WEEKLY';
    else if (b.freq === 'biweekly') rule = 'FREQ=WEEKLY;INTERVAL=2';
    else rule = 'FREQ=YEARLY';
    const a = billAmt(b);
    const title = `Bill due: ${b.name}${a.unknown ? '' : ` ${a.est ? '~' : ''}${fm(a.v)}`}`;
    L.push('BEGIN:VEVENT', `UID:${b.id}@billplanner`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${first.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(first, 1).replace(/-/g, '')}`,
      `RRULE:${rule}`, `SUMMARY:${icsEsc(title)}`, 'TRANSP:TRANSPARENT',
      // 9 AM three days before, and 9 AM on the day
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title + ' in 3 days')}`, 'TRIGGER:-P2DT15H', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title + ' today')}`, 'TRIGGER:PT9H', 'END:VALARM',
      'END:VEVENT');
    n++;
  }
  L.push('END:VCALENDAR');
  return { text: L.join('\r\n') + '\r\n', n };
}
function exportCalendar() {
  const { text, n } = buildIcs();
  if (!n) { toast('No bills to add yet.'); return; }
  // Opening an .ics file on iPhone shows "Add All" to Calendar.
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a'); a.href = url;
  if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) a.download = 'bills.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------- demo data (made-up) ---------- */
function demoState() {
  const s = blankState();
  const t = today();
  const nextFri = addDays(t, (5 - new Date(parseD(t)).getUTCDay() + 7) % 7);
  s.balances = { checking: 1240.55, savings: 310, updated: t };
  s.everydayPerWeek = 450; s.savingsBuffer = 200;
  s.incomes = [
    { id: uid(), name: 'Acme Corp', owner: 'Me', freq: 'biweekly', anchor: nextFri, amount: 1450, varies: false },
    { id: uid(), name: 'Corner Cafe', owner: 'Partner', freq: 'weekly', anchor: nextFri, amount: 380, varies: true }
  ];
  const B = (name, day, amount, varies) => ({ id: uid(), name, freq: 'monthly', day, amount, varies: !!varies });
  s.bills = [B('Rent', 1, 950), B('Electric', 9, 140, true), B('Phone', 18, 85), B('Car insurance', 15, 110),
    B('Internet', 6, 60), B('Water', 14, 55, true), B('Streaming', 22, 15.99),
    { id: uid(), name: 'Furniture lease', freq: 'biweekly', anchor: nextFri, amount: 45, varies: false }];
  s.setAsides = [{ id: uid(), name: 'Car repair fund', amount: 300 }];
  s.infos = [{ id: uid(), name: 'Student loan (taken from pay)', amount: 50, freq: 'weekly', endMonth: '2028-06', note: 'Withheld before deposit' }];
  return s;
}

/* ---------- events ---------- */
const findB = id => S.bills.find(b => b.id === id);
const findI = id => S.incomes.find(i => i.id === id);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const act = el.dataset.act, id = el.dataset.id, d = el.dataset.d;
  if (el.tagName === 'A') e.preventDefault();
  switch (act) {
    case 'tab': tab = el.dataset.tab; try { sessionStorage.setItem('bp.tab', tab); } catch (x) { } closeSheet(); render(); window.scrollTo(0, 0); break;
    case 'close': closeSheet(); break;
    case 'pay': sheetPay(findB(id), d); break;
    case 'recv': sheetRecv(findI(id), d); break;
    case 'unpay': {
      const b = findB(id); const p = paidRec(b, d);
      if (p) {
        if (p.adjusted) S.balances.checking = (S.balances.checking || 0) + p.amount;
        // If it was matched from the bank, don't match that bank transaction to this bill again.
        if (p.txId && p.auto) S.bank.ignore = [...new Set([...(S.bank.ignore || []), p.txId])];
        S.payments = S.payments.filter(x => x !== p); save();
      }
      closeSheet(); render(); toast(`${b.name} marked not paid.`); break;
    }
    case 'bankConnect': sheetConnect(); break;
    case 'bankAccounts': if (S.bank.accounts.length) sheetAccounts(); else toast('Update from the bank first.'); break;
    case 'bankRefresh': fetchBank(true); break;
    case 'bankDisconnect':
      if (confirm('Disconnect the bank from this phone? Your bills and history stay. To stop it completely, also remove the app connection on SimpleFIN.')) {
        setBankAccess('');
        S.bank = { accounts: [], tx: [], ignore: S.bank.ignore || [], suggest: [], autoLog: [] };
        save(); render(); toast('Bank disconnected. Balances are entered by hand again.');
      }
      break;
    case 'pairYes': sheetCombine(findB(el.dataset.big), findB(el.dataset.small)); break;
    case 'combineDo': {
      const big = findB(el.dataset.big), small = findB(el.dataset.small);
      if (!big || !small) { closeSheet(); break; }
      // Keep a copy so the result screen can undo it.
      lastCombine = { bills: S.bills.map(b => JSON.parse(JSON.stringify(b))), payments: JSON.parse(JSON.stringify(S.payments)) };
      const smallName = small.name, smallAmt = small.amount;
      combineBills(big.id, small.id);
      if (bankOn()) runMatching();
      save(); render();
      openSheet(`<h3>Bills combined</h3>
        <p><b>${esc(big.name)}</b> is now one bill: ${fm(big.amount)} plus a ${fm(big.fee)} transaction fee, ${fm(big.amount + big.fee)} in total.</p>
        <p class="small muted">"${esc(smallName)}" (${fm(smallAmt)}) is now this bill's transaction fee instead of a separate bill. The fee is shown on the bill and on the Bills tab, and you'll be warned if it's ever higher than usual.</p>
        <div class="btns"><button class="btn ghost" data-act="combineUndo">Undo, they're not related</button><button class="btn" data-act="close">OK</button></div>`);
      break;
    }
    case 'combineUndo':
      if (lastCombine) { S.bills = lastCombine.bills; S.payments = lastCombine.payments; lastCombine = null; save(); }
      closeSheet(); render(); toast('Undone. The two bills are separate again.'); break;
    case 'combineNot':
      S.ignorePairs = [...new Set([...(S.ignorePairs || []), el.dataset.key])]; save(); closeSheet(); render();
      toast("OK, they'll stay separate and you won't be asked again."); break;
    case 'splitFee': {
      const b = findB(id);
      if (!b || !b.fee) break;
      if (!confirm(`Split the ${fm(b.fee)} fee back into its own bill?`)) break;
      const nb = { id: uid(), name: b.name + ' fee', freq: b.freq, day: b.day, anchor: b.anchor, amount: b.fee, varies: false, active: true, match: [...(b.match || [])] };
      S.bills.push(nb);
      b.fee = 0;
      // They were split on purpose, so don't offer to combine them again.
      S.ignorePairs = [...new Set([...(S.ignorePairs || []), [b.id, nb.id].sort().join('+')])];
      save(); closeSheet(); render(); toast('The fee is now its own bill again.'); break;
    }
    case 'pairNo': S.ignorePairs = [...new Set([...(S.ignorePairs || []), el.dataset.key])]; save(); render(); break;
    case 'manualClear': S.bank.manual = null; save(); closeSheet(); render(); toast('Back to the automatic balance from the bank connection.'); break;
    case 'feeSeen': {
      const a = (S.bank.feeAlerts || []).find(x => x.billId === el.dataset.bill && x.date === el.dataset.date);
      if (a) a.seen = true;
      save(); render(); break;
    }
    case 'txWhat': { const t = S.bank.tx.find(x => x.id === id); if (t) sheetTxWhat(t); break; }
    case 'sugYes': {
      const i = Number(el.dataset.i), s = S.bank.suggest[i];
      if (s && s.kind === 'fee') {
        const t = S.bank.tx.find(x => x.id === s.txId), sm = S.bank.tx.find(x => x.id === s.smallId);
        if (!t || !sm) break;
        openSheet(`<h3>Combine these two charges?</h3>
          <div class="breakdown num" style="font-size:15px;margin-top:8px">
            <div><span>${esc(txName(t))}, ${nice(t.date)}</span><span>${fm(-t.amount)}</span></div>
            <div><span>${esc(txName(sm))}, ${nice(sm.date)}</span><span>${fm(-sm.amount)}</span></div>
            <div class="sum"><span>Shown as one charge</span><span>${fm(-t.amount - sm.amount)}</span></div></div>
          <p class="small" style="margin-top:10px">The ${fm(-sm.amount)} charge would be treated as a <b>transaction fee</b> for the ${fm(-t.amount)} charge, now and every time these two show up together. The fee stays visible, and you'll be warned if it's ever higher than usual.</p>
          <div class="btns"><button class="btn ghost" data-act="sugNo" data-i="${i}">Cancel, these are not related</button></div>
          <div class="btns"><button class="btn ghost" data-act="close">Decide later</button><button class="btn" data-act="sugFeeDo" data-i="${i}">Yes, combine them</button></div>`);
        break;
      }
      answerSuggestion(i, true); break;
    }
    case 'sugFeeDo': closeSheet(); answerSuggestion(Number(el.dataset.i), true); break;
    case 'sugNo': closeSheet(); answerSuggestion(Number(el.dataset.i), false); break;
    case 'unrecv': {
      const inc = findI(id); const r = rcptRec(inc, d);
      if (r) { if (r.adjusted) S.balances.checking = (S.balances.checking || 0) - r.amount; S.receipts = S.receipts.filter(x => x !== r); save(); }
      closeSheet(); render(); toast(`${inc.name} marked not received.`); break;
    }
    case 'editBill': sheetBill(id ? findB(id) : null); break;
    case 'editInc': sheetInc(id ? findI(id) : null); break;
    case 'incomes': sheetIncomes(); break;
    case 'spend': sheetSpend(); break;
    case 'spendEdit': { const x = S.spending.find(s => s.id === id); if (x) sheetSpendEdit(x); break; }
    case 'delSpend': {
      const x = S.spending.find(s => s.id === id);
      if (x) { if (x.adjusted) S.balances.checking = (S.balances.checking || 0) + x.amount; S.spending = S.spending.filter(s => s !== x); save(); }
      closeSheet(); render(); toast('Spending removed.'); break;
    }
    case 'editAside': sheetAside(id ? S.setAsides.find(a => a.id === id) : null); break;
    case 'editInfo': sheetInfo(id ? S.infos.find(a => a.id === id) : null); break;
    case 'balances': sheetBalances(); break;
    case 'planning': sheetPlanning(); break;
    case 'delBill': if (confirm('Delete this bill and its payment history?')) { S.bills = S.bills.filter(b => b.id !== id); S.payments = S.payments.filter(p => p.billId !== id); save(); closeSheet(); render(); } break;
    case 'delInc': if (confirm('Delete this paycheck and its history?')) { S.incomes = S.incomes.filter(i => i.id !== id); S.receipts = S.receipts.filter(r => r.incomeId !== id); save(); closeSheet(); render(); } break;
    case 'delAside': S.setAsides = S.setAsides.filter(a => a.id !== id); save(); closeSheet(); render(); break;
    case 'delInfo': S.infos = S.infos.filter(a => a.id !== id); save(); closeSheet(); render(); break;
    case 'backup': backup(); break;
    case 'calendar': exportCalendar(); break;
    case 'startEmpty': S = blankState(); save(); tab = 'more'; render(); toast('Start by entering your balances, paychecks and bills.'); break;
    case 'demo': S = demoState(); save(); tab = 'home'; render(); toast('Demo data loaded. Erase it from More when you are done.'); break;
    case 'erase':
      if (confirm('Erase all bills, paychecks and history from this device? Make a backup first if you might want it back.')) {
        try { localStorage.removeItem(KEY); } catch (x) { }
        S = null; tab = 'home'; render();
      }
      break;
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'restore' && el.files && el.files[0]) { restoreFile(el.files[0]); el.value = ''; }
  if (el.dataset.act === 'freqChange') {
    const f = el.form; const m = el.value === 'monthly';
    f.querySelector('[data-show=monthly]').hidden = !m;
    f.querySelector('[data-show=other]').hidden = m;
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f), id = f.dataset.id;
  switch (f.id) {
    case 'fPay': {
      const b = findB(id); const amount = num(fd.get('amount'));
      if (amount == null) { toast('Enter the amount paid.'); return; }
      if (bankOn()) {
        // The bank balance doesn't show it yet; subtract it until the matching bank transaction appears.
        S.payments.push({ billId: b.id, due: f.dataset.d, paidOn: fd.get('paidOn') || today(), amount, fee: b.fee && amount > b.fee ? b.fee : 0, adjusted: false, inTransit: true, at: Date.now() });
        runMatching();
      } else {
        const adjusted = fd.get('adjust') === 'on';
        S.payments.push({ billId: b.id, due: f.dataset.d, paidOn: fd.get('paidOn') || today(), amount, fee: b.fee && amount > b.fee ? b.fee : 0, adjusted });
        if (adjusted) S.balances.checking = (S.balances.checking || 0) - amount;
      }
      if (b.amount == null && !b.varies) b.amount = amount;
      save(); closeSheet(); render(); toast(`${b.name} marked paid.`); break;
    }
    case 'fRecv': {
      const inc = findI(id); const amount = num(fd.get('amount'));
      if (amount == null) { toast('Enter the amount.'); return; }
      const adjusted = !bankOn() && fd.get('adjust') === 'on'; // with a bank connected, the deposit is already in the balance
      S.receipts.push({ incomeId: inc.id, date: f.dataset.d, amount, adjusted });
      if (adjusted) S.balances.checking = (S.balances.checking || 0) + amount;
      save(); closeSheet(); render(); toast(`${inc.name} received.`); break;
    }
    case 'fBill': {
      const fr = readFreq(fd); if (!fr) { toast(fd.get('freq') === 'monthly' ? 'Enter a day of the month (1-31).' : 'Pick the next date.'); return; }
      const match = String(fd.get('match') || '').split(',').map(normText).filter(Boolean);
      const o = Object.assign({ name: fd.get('name').trim(), amount: num(fd.get('amount')), fee: num(fd.get('fee')) || 0, match, varies: fd.get('varies') === 'on', active: fd.get('active') === 'on', note: fd.get('note').trim() }, fr);
      let bill;
      if (id) bill = Object.assign(findB(id), o); else S.bills.push(bill = Object.assign({ id: uid() }, o));
      // A new bill made from a bank transaction: that transaction is its first payment.
      const tx = f.dataset.tx && S.bank.tx.find(t => t.id === f.dataset.tx);
      if (!id && tx) {
        const d = occ(bill, addDays(tx.date, -20), addDays(tx.date, 20)).sort((a, c) => Math.abs(diffDays(a, tx.date)) - Math.abs(diffDays(c, tx.date)))[0] || tx.date;
        S.payments.push({ billId: bill.id, due: d, paidOn: tx.date, amount: -tx.amount, txId: tx.id, auto: true });
        S.bank.suggest = S.bank.suggest.filter(s => s.txId !== tx.id);
      }
      if (bankOn()) runMatching();
      save(); closeSheet(); render(); toast('Bill saved.'); break;
    }
    case 'fInc': {
      const fr = readFreq(fd); if (!fr) { toast(fd.get('freq') === 'monthly' ? 'Enter a day of the month (1-31).' : 'Pick the next payday.'); return; }
      const amount = num(fd.get('amount')); if (amount == null) { toast('Enter the usual amount.'); return; }
      const o = Object.assign({ name: fd.get('name').trim(), owner: fd.get('owner').trim(), amount, varies: fd.get('varies') === 'on', active: fd.get('active') === 'on' }, fr);
      if (id) Object.assign(findI(id), o); else S.incomes.push(Object.assign({ id: uid() }, o));
      save(); closeSheet(); render(); toast('Paycheck saved.'); break;
    }
    case 'fAside': {
      const name = fd.get('name').trim(); let amount = num(fd.get('amount')) || 0;
      const spent = num(fd.get('spent'));
      if (spent) { amount = Math.max(0, amount - spent); if (fd.get('adjust') === 'on') S.balances.checking = (S.balances.checking || 0) - spent; }
      if (id) Object.assign(S.setAsides.find(a => a.id === id), { name, amount }); else S.setAsides.push({ id: uid(), name, amount });
      save(); closeSheet(); render(); toast(spent ? `${fm(spent)} spent, ${fm(amount)} left set aside.` : 'Saved.'); break;
    }
    case 'fSpend': {
      const amount = num(fd.get('amount'));
      if (!amount || amount <= 0) { toast('Enter the amount spent.'); return; }
      const cash = fd.get('cash') === 'on';
      const inTransit = !cash && bankOn();
      const adjusted = !cash && !bankOn() && fd.get('adjust') === 'on';
      S.spending.push({ id: uid(), date: fd.get('date') || today(), amount, what: fd.get('what'), note: fd.get('note').trim(), adjusted, inTransit, cash, at: Date.now() });
      if (adjusted) S.balances.checking = (S.balances.checking || 0) - amount;
      if (inTransit) runMatching();
      // Keep the history from growing forever: drop records older than about 4 months
      const cutoff = addDays(today(), -120);
      S.spending = S.spending.filter(x => x.date >= cutoff);
      save(); closeSheet(); render(); toast(`${fm(amount)} for ${fd.get('what').toLowerCase()} recorded.`); break;
    }
    case 'fInfo': {
      const o = { name: fd.get('name').trim(), amount: num(fd.get('amount')), freq: fd.get('freq'), endMonth: fd.get('endMonth') || null, note: fd.get('note').trim() };
      if (id) Object.assign(S.infos.find(a => a.id === id), o); else S.infos.push(Object.assign({ id: uid() }, o));
      save(); closeSheet(); render(); break;
    }
    case 'fBal': {
      const bank = num(fd.get('checking'));
      if (bank == null) { toast('Enter the checking balance.'); return; }
      const still = new Set(fd.getAll('pend'));
      let pendingSum = 0;
      for (const p of pendingItems()) {
        if (still.has(p.key)) pendingSum += p.amount; else p.rec.cleared = true;
      }
      S.balances.checking = bank - pendingSum;
      S.balances.pending = pendingSum;
      S.balances.savings = num(fd.get('savings')) || 0;
      S.balances.updated = today();
      save(); closeSheet(); render(); toast(pendingSum ? `Balances updated, minus ${fm(pendingSum)} still on its way out.` : 'Balances updated.'); break;
    }
    case 'fConnect': {
      const token = (fd.get('token') || '').trim();
      if (!token) { toast('Paste the setup token from SimpleFIN.'); return; }
      const btn = f.querySelector('button.btn:not(.ghost)'); btn.disabled = true; btn.textContent = 'Connecting...';
      // Backup method: an already-claimed SimpleFIN access URL can be pasted instead of a setup token.
      const direct = /^https:\/\/[^:@\/\s]+:[^@\/\s]+@\S+$/.test(token);
      (direct ? Promise.resolve(token) : claimToken(token)).then(async access => {
        setBankAccess(access);
        S.bank = { accounts: [], tx: [], ignore: S.bank.ignore || [], suggest: [], autoLog: [] };
        save(); closeSheet();
        await fetchBank(false);
        if (S.bank.error && !S.bank.accounts.length) { toast(S.bank.error); return; }
        toast(`Connected to ${bankName()}.`);
        if (S.bank.accounts.length > 1) sheetAccounts();
      }).catch(e => { btn.disabled = false; btn.textContent = 'Connect'; toast(e.message); });
      return;
    }
    case 'fManual': {
      const amount = num(fd.get('amount'));
      if (amount == null) { toast("Type the available balance from your bank's app."); return; }
      S.bank.manual = { amount, at: Date.now(), keep: fd.getAll('keep'), bankBal: S.bank.bal ? S.bank.bal.checking : null };
      save(); closeSheet(); render();
      toast("Using the balance from your bank's app until the bank connection has newer data.");
      return;
    }
    case 'fTx': {
      const t = S.bank.tx.find(x => x.id === f.dataset.id);
      if (!t) { closeSheet(); return; }
      const kind = fd.get('kind'), name = (fd.get('name') || '').trim(), cat = fd.get('cat'), phrase = phraseOf(t.desc);
      const saveLabel = extra => {
        const lab = Object.assign({ name, cat }, extra || {});
        if (fd.get('remember') === 'on') {
          S.bank.labels = (S.bank.labels || []).filter(x => x.words !== phrase).concat([Object.assign({ words: phrase }, lab)]);
        } else {
          S.bank.txNames = Object.assign({}, S.bank.txNames || {}, { [t.id]: lab });
        }
      };
      if (kind === 'newbill') {
        closeSheet();
        sheetBill(null, { name: name || '', amount: -t.amount, freq: 'monthly', day: Number(t.date.slice(8)), match: [phrase], txId: t.id });
        return;
      }
      if (kind.startsWith('bill|')) {
        const [, bid, d] = kind.split('|'); const b = findB(bid);
        S.payments.push({ billId: b.id, due: d, paidOn: t.date, amount: -t.amount, txId: t.id, auto: true });
        b.match = [...new Set([...(b.match || []), phrase])];
        toast(`${b.name} marked paid. Future payments like this will be matched automatically.`);
      } else if (kind.startsWith('pay|')) {
        const [, iid, d] = kind.split('|'); const inc = findI(iid);
        S.receipts.push({ incomeId: inc.id, date: d, amount: t.amount, txId: t.id, auto: true });
        inc.match = [...new Set([...(inc.match || []), phrase])];
        toast(`${inc.name} marked received.`);
      } else if (kind === 'ignore') {
        saveLabel({ ignore: true }); toast('It will no longer count as spending.');
      } else {
        saveLabel(); toast(name ? `Saved as "${name}".` : 'Saved.');
      }
      S.bank.suggest = S.bank.suggest.filter(s => s.txId !== t.id);
      runMatching(); save(); closeSheet(); render();
      return;
    }
    case 'fAccounts': {
      S.bank.checkingId = fd.get('checking');
      S.bank.savingsId = fd.get('savings') || null;
      S.bank.fetchedAt = 0; S.bank.tx = []; S.bank.bal = null;
      save(); closeSheet();
      fetchBank(false);
      break;
    }
    case 'fPlan': {
      S.everydayPerWeek = num(fd.get('everyday')) || 0;
      S.suggestSavings = fd.get('suggest') === 'on';
      S.savingsBuffer = num(fd.get('buffer')) || 0;
      save(); closeSheet(); render(); break;
    }
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
// Tapping an amount box selects what's in it, so typing replaces it.
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.tagName === 'INPUT' && el.inputMode === 'decimal' && el.value) {
    setTimeout(() => { try { el.setSelectionRange(0, el.value.length); } catch (x) { el.select(); } }, 0);
  }
});

// Re-draw when the app comes back to the front (the date may have changed).
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); fetchBank(false); } });

render();
fetchBank(false); // updates from the bank if connected and the last update is over an hour old
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
  // When a new version of the app takes over, reload once so it shows straight away.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || !$('#sheet').hidden) return; // never interrupt an open form
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => reg.update()).catch(() => { });
}
