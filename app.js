'use strict';
/* Bill Planner: bills, paydays and what's safe to spend.
   Everything is stored on this device only (localStorage). No server, no tracking. */

const APP_VERSION = '1.0.4';
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
    incomes: [], bills: [], payments: [], receipts: [], setAsides: [], infos: []
  };
}
function normalize(s) {
  const b = blankState();
  const out = Object.assign(b, s || {});
  out.balances = Object.assign(blankState().balances, out.balances || {});
  for (const k of ['incomes', 'bills', 'payments', 'receipts', 'setAsides', 'infos']) if (!Array.isArray(out[k])) out[k] = [];
  for (const k of ['incomes', 'bills', 'setAsides', 'infos']) out[k].forEach(x => { if (!x.id) x.id = uid(); });
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
function billAmt(b) {
  if (b.varies) {
    const ps = S.payments.filter(p => p.billId === b.id).sort((x, y) => y.due.localeCompare(x.due)).slice(0, 3);
    if (ps.length) return { v: sum(ps.map(p => p.amount)) / ps.length, est: true };
    if (b.amount != null) return { v: b.amount, est: true };
    return { v: 0, unknown: true };
  }
  if (b.amount == null) return { v: 0, unknown: true };
  return { v: b.amount, est: false };
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

/* Safe to spend = checking - unpaid bills due before the next payday - money set aside.
   Everyday spending is NOT subtracted here; it is shown separately as an estimate. */
function calc() {
  const t = today();
  const np = nextPayday() || addDays(t, 14);
  const bills = dueList(lookback(), np);
  const billsTotal = sum(bills.map(x => x.amt));
  const days = Math.max(0, diffDays(t, np));
  const everyday = (S.everydayPerWeek || 0) * days / 7;
  const aside = sum(S.setAsides.map(a => a.amount || 0));
  const safe = (S.balances.checking || 0) - billsTotal - aside;
  return { np, hasPay: !!nextPayday(), bills, billsTotal, days, everyday, aside, safe, unknown: bills.filter(x => x.unknown) };
}
// Pay periods ahead, each from one payday up to the next, with a running "cushion".
function periods(n = 8) {
  const t = today();
  const c = calc();
  const pays = payList(addDays(t, 1), addDays(t, 120));
  const dates = [...new Set(pays.map(p => p.d))].sort().slice(0, n + 1);
  const out = [];
  // Today's paychecks that haven't been confirmed yet are expected, so the projection includes them.
  const todayPays = payList(t, addDays(t, 1));
  // The forecast does allow for everyday spending, starting with the days until the next payday.
  let run = c.safe - c.everyday + sum(todayPays.map(p => p.amt));
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
  const sub = x.p ? `Paid ${nice(x.p.paidOn || x.d)}` : `${nice(x.d)} · ${rel(x.d)}`;
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
  const bal = S.balances;
  const stale = !bal.updated ? 'Balance not entered yet' : diffDays(bal.updated, t) === 0 ? 'Balance updated today' : `Balance updated ${diffDays(bal.updated, t)} day${diffDays(bal.updated, t) === 1 ? '' : 's'} ago`;
  let h = `<h1>Bills</h1>
  <div class="card hero">
    <div class="label">Safe to spend ${c.hasPay ? `until payday, ${nice(c.np)}` : 'for the next 2 weeks'}</div>
    <div class="big num ${c.safe < 0 ? 'neg' : ''}">${fm(c.safe)}</div>
    <div class="small muted">${stale} · <a href="#" data-act="balances">Update</a></div>
    ${c.everyday ? `<div class="small muted" style="margin-top:4px">Usual everyday spending until then: about ${fm(c.everyday)} <span class="tag">not subtracted</span></div>` : ''}
    <details><summary>How this is worked out</summary>
      <div class="breakdown num">
        <div><span>Checking${bal.pending ? ' (after pending payments)' : ''}</span><span>${fm(bal.checking)}</span></div>
        <div><span>Bills due before payday (${c.bills.length})</span><span>−${fm(c.billsTotal)}</span></div>
        ${c.aside ? `<div><span>Set aside</span><span>−${fm(c.aside)}</span></div>` : ''}
        <div class="sum"><span>Safe to spend</span><span>${fm(c.safe)}</span></div>
        ${bal.savings ? `<div class="muted"><span>Savings (not counted)</span><span>${fm(bal.savings)}</span></div>` : ''}
      </div></details>
  </div>`;

  // Paychecks that should have arrived but weren't confirmed
  const missed = payList(addDays(t, -10) > S.setupDate ? addDays(t, -10) : S.setupDate, t);
  if (missed.length) h += `<div class="banner warn">Did ${missed.length === 1 ? 'this paycheck' : 'these paychecks'} arrive? ${missed.map(p => `<b>${esc(p.inc.name)}</b> (${nice(p.d)})`).join(', ')}. <a href="#" data-act="tab" data-tab="pay">Confirm on Paydays</a></div>`;
  const todayPay = payList(t, addDays(t, 1));
  if (todayPay.length) h += `<div class="banner good">Payday today: ${todayPay.map(p => esc(p.inc.name)).join(', ')}. <a href="#" data-act="tab" data-tab="pay">Confirm the amounts</a> when they land.</div>`;
  if (c.unknown.length) h += `<div class="banner warn">${c.unknown.map(x => `<b>${esc(x.b.name)}</b>`).join(', ')} ${c.unknown.length === 1 ? 'has' : 'have'} no amount yet, so ${c.unknown.length === 1 ? "it isn't" : "they aren't"} counted. Tap the bill to add one.</div>`;
  if (S.suggestSavings && c.hasPay) {
    // Only suggest saving if the cushion stays above the buffer for the next few paydays too.
    const lowest = Math.min(c.safe - c.everyday, ...periods(4).out.map(p => p.run));
    const extra = Math.floor((lowest - (S.savingsBuffer || 0)) / 25) * 25;
    if (extra >= 25) h += `<div class="banner good">You could move <b>${fm(extra)}</b> to savings and still keep at least a ${fm(S.savingsBuffer)} cushion over the next few paydays.</div>`;
  }

  const overdue = dueList(lookback(), t);
  if (overdue.length) h += section('Overdue', overdue, '');
  const wkEnd = addDays(t, 7);
  h += section('This week', dueList(t, wkEnd), 'Nothing due in the next 7 days.');
  const fonm = firstOfNextMonth(t);
  if (wkEnd < fonm) h += section(`Rest of ${MO[Number(t.slice(5, 7)) - 1]}`, dueList(wkEnd, fonm), 'Nothing else due this month.');
  const nmStart = wkEnd > fonm ? wkEnd : fonm;
  h += section(`${monthName(fonm).split(' ')[0]} (next month)`, dueList(nmStart, firstOfNextMonth(fonm)), 'Nothing due.', true);
  const paidThisMonth = dueList(firstOfMonth(t), fonm, false).filter(x => x.p);
  if (paidThisMonth.length) h += section('Paid this month', paidThisMonth, '', true);

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
  h += `<div class="card pad" style="margin-top:14px"><div class="small muted">Now until ${c.hasPay ? nice(c.np) : 'payday'}</div><div class="num" style="font-size:22px;font-weight:700"><span class="${c.safe < 0 ? 'neg' : ''}">${fm(c.safe)}</span> <span class="small muted" style="font-weight:400">safe to spend${todayPays.length ? ', before today\'s pay' : ''}</span></div>
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
  h += `<p class="small muted" style="margin:14px 4px">"Expected cushion" is a forecast: what's safe to spend now, minus usual everyday spending, plus each paycheck, minus bills. Set everyday spending to 0 under More › Planning to leave it out. ~ means an estimate.</p>`;
  return h;
}
function incRow(p) {
  return `<button class="row" data-act="recv" data-id="${p.inc.id}" data-d="${p.d}">
    <span class="dot ${p.r ? 'paid' : p.d < today() ? 'soon' : 'ok'}"></span>
    <span class="main"><div class="name">${esc(p.inc.name)}${p.inc.owner ? ` <span class="tag">${esc(p.inc.owner)}</span>` : ''}</div><div class="sub">${nice(p.d)} · ${p.r ? 'received' : p.d < today() ? 'tap to confirm' : rel(p.d)}</div></span>
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
  return h + `</div>`;
}

function viewMore() {
  const bal = S.balances;
  let h = `<h1>More</h1>
  <h2>Balances</h2><div class="card">
    <button class="row" data-act="balances"><span class="main"><div class="name">Checking</div><div class="sub">${bal.updated ? 'Updated ' + nice(bal.updated) : 'Not entered yet'}</div></span><span class="amt num">${fm(bal.checking)}</span></button>
    <button class="row" data-act="balances"><span class="main"><div class="name">Savings</div></span><span class="amt num">${fm(bal.savings)}</span></button></div>

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
    <p class="muted">See what's due, what's coming in, and what's safe to spend until payday. Everything stays on this device.</p>
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
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
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
    <label class="check"><input type="checkbox" name="adjust" checked> Subtract it from my checking balance</label>
    <p class="hint">Untick this if you have already updated your balance since paying.</p>
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
    <label class="check"><input type="checkbox" name="adjust" checked> Add it to my checking balance</label>
    <p class="hint">Untick this if you have already updated your balance since it arrived.</p>
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
function sheetBill(b) {
  const x = b || { freq: 'monthly' };
  const hist = b ? S.payments.filter(p => p.billId === b.id).sort((p, q) => q.due.localeCompare(p.due)).slice(0, 6) : [];
  openSheet(`<form id="fBill" data-id="${b ? b.id : ''}">
    <h3>${b ? 'Edit bill' : 'New bill'}</h3>
    <label for="bName">Name</label><input id="bName" name="name" value="${esc(x.name || '')}" required>
    ${freqFields(x, 'b')}
    <label for="bAmt">Usual amount</label><input id="bAmt" name="amount" inputmode="decimal" value="${money2(x.amount)}" placeholder="Leave empty if you don't know yet">
    <label class="check"><input type="checkbox" name="varies"${x.varies ? ' checked' : ''}> The amount changes (like electric or water)</label>
    <label class="check"><input type="checkbox" name="active"${x.active === false ? '' : ' checked'}> Still paying this</label>
    <label for="bNote">Note</label><input id="bNote" name="note" value="${esc(x.note || '')}" placeholder="Optional">
    ${hist.length ? `<label>Recent payments</label><div class="small num">${hist.map(p => `<div class="toolbar"><span>${nice(p.due)}</span><span>${fm(p.amount)}</span></div>`).join('')}</div>` : ''}
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div>
    ${b ? `<div class="btns"><button type="button" class="btn danger" data-act="delBill" data-id="${b.id}">Delete bill</button></div>` : ''}
  </form>`);
}
// List of all paychecks, opened from the Paydays tab.
function sheetIncomes() {
  openSheet(`<h3>Paychecks</h3><p class="hint">Tap one to change its name, whose it is, schedule or usual amount.</p>
    <div class="card" style="margin-top:10px">${S.incomes.map(i => `<button class="row" data-act="editInc" data-id="${i.id}"><span class="main"><div class="name">${esc(i.name)}${i.owner ? ` <span class="tag">${esc(i.owner)}</span>` : ''}${i.active === false ? ' <span class="tag">stopped</span>' : ''}</div><div class="sub">${freqText(i)}${i.varies ? ' · varies' : ''}</div></span><span class="amt num">${incAmt(i).est ? '~' : ''}${fm(incAmt(i).v)}</span></button>`).join('') || '<div class="empty">No paychecks yet.</div>'}</div>
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
    <p class="hint">Money in checking that is already meant for something. It is left out of "safe to spend".</p>
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
// Payments marked paid in the app that may not have reached the bank yet (they can take 3-5 business days).
const pendingPays = () => S.payments.filter(p => !p.cleared && p.paidOn && diffDays(p.paidOn, today()) <= 14 && p.paidOn >= S.setupDate)
  .sort((a, b) => b.paidOn.localeCompare(a.paidOn));
function sheetBalances() {
  const pend = pendingPays();
  openSheet(`<form id="fBal"><h3>Balances</h3><p class="hint">Copy the balances your bank app shows. Bills you mark paid and paychecks you confirm keep checking up to date between updates.</p>
    <label for="cBal">Checking, as your bank shows it</label><input id="cBal" name="checking" inputmode="decimal" value="${pend.length ? '' : money2(S.balances.checking)}" placeholder="0.00" required>
    ${pend.length ? `<label>Paid in the app but not showing in the bank yet?</label>
      <p class="hint" style="margin-top:0">Payments can take 3-5 business days to post. Ticked ones are subtracted from the bank's number. Untick any that already show in your bank.</p>
      ${pend.map(p => { const b = S.bills.find(x => x.id === p.billId); return `<label class="check"><input type="checkbox" name="pend" value="${esc(p.billId + '|' + p.due)}"${diffDays(p.paidOn, today()) <= 7 ? ' checked' : ''}> ${esc(b ? b.name : 'Bill')} · ${fm(p.amount)} <span class="muted small">paid ${nice(p.paidOn)}</span></label>`; }).join('')}` : ''}
    <label for="sBal">Savings</label><input id="sBal" name="savings" inputmode="decimal" value="${money2(S.balances.savings)}">
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div></form>`);
}
function sheetPlanning() {
  openSheet(`<form id="fPlan"><h3>Planning</h3>
    <label for="eDay">Everyday spending per week</label><input id="eDay" name="everyday" inputmode="decimal" value="${money2(S.everydayPerWeek)}">
    <p class="hint">Groceries, gas, eating out, household things. Shown next to "safe to spend" and used in the Paydays forecast, but not subtracted from safe to spend.</p>
    <label class="check"><input type="checkbox" name="suggest"${S.suggestSavings ? ' checked' : ''}> Suggest moving extra money to savings</label>
    <label for="sBuf">Cushion to keep before suggesting savings</label><input id="sBuf" name="buffer" inputmode="decimal" value="${money2(S.savingsBuffer)}">
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div></form>`);
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
      if (p) { if (p.adjusted) S.balances.checking = (S.balances.checking || 0) + p.amount; S.payments = S.payments.filter(x => x !== p); save(); }
      closeSheet(); render(); toast(`${b.name} marked not paid.`); break;
    }
    case 'unrecv': {
      const inc = findI(id); const r = rcptRec(inc, d);
      if (r) { if (r.adjusted) S.balances.checking = (S.balances.checking || 0) - r.amount; S.receipts = S.receipts.filter(x => x !== r); save(); }
      closeSheet(); render(); toast(`${inc.name} marked not received.`); break;
    }
    case 'editBill': sheetBill(id ? findB(id) : null); break;
    case 'editInc': sheetInc(id ? findI(id) : null); break;
    case 'incomes': sheetIncomes(); break;
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
      const adjusted = fd.get('adjust') === 'on';
      S.payments.push({ billId: b.id, due: f.dataset.d, paidOn: fd.get('paidOn') || today(), amount, adjusted });
      if (adjusted) S.balances.checking = (S.balances.checking || 0) - amount;
      if (b.amount == null && !b.varies) b.amount = amount;
      save(); closeSheet(); render(); toast(`${b.name} marked paid.`); break;
    }
    case 'fRecv': {
      const inc = findI(id); const amount = num(fd.get('amount'));
      if (amount == null) { toast('Enter the amount.'); return; }
      const adjusted = fd.get('adjust') === 'on';
      S.receipts.push({ incomeId: inc.id, date: f.dataset.d, amount, adjusted });
      if (adjusted) S.balances.checking = (S.balances.checking || 0) + amount;
      save(); closeSheet(); render(); toast(`${inc.name} received.`); break;
    }
    case 'fBill': {
      const fr = readFreq(fd); if (!fr) { toast(fd.get('freq') === 'monthly' ? 'Enter a day of the month (1-31).' : 'Pick the next date.'); return; }
      const o = Object.assign({ name: fd.get('name').trim(), amount: num(fd.get('amount')), varies: fd.get('varies') === 'on', active: fd.get('active') === 'on', note: fd.get('note').trim() }, fr);
      if (id) Object.assign(findB(id), o); else S.bills.push(Object.assign({ id: uid() }, o));
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
      for (const p of pendingPays()) {
        if (still.has(p.billId + '|' + p.due)) pendingSum += p.amount; else p.cleared = true;
      }
      S.balances.checking = bank - pendingSum;
      S.balances.pending = pendingSum;
      S.balances.savings = num(fd.get('savings')) || 0;
      S.balances.updated = today();
      save(); closeSheet(); render(); toast(pendingSum ? `Balances updated, minus ${fm(pendingSum)} still on its way out.` : 'Balances updated.'); break;
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
