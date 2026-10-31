'use strict';
/* Bill Planner: spending watch.
   Goal 2 of the app: keep a close eye on money spent on eating out, snacks and drinks, alcohol and entertainment.
   - Every purchase is sorted into a category from where it was made (or the user's own choice for that store).
   - Each card is remembered as someone's (Arvest shows the card's last 4 digits after "CD"), so every purchase
     on it shows that person's name.
   - Gas stations sell both fuel and snacks on one charge, so each gas-station purchase gets a question:
     who made it, and exactly how much was fuel (gallons, cost, odometer). The rest counts as snacks and drinks.
     The question goes to the right phone by itself, reminds every 2 hours until answered, and can't be closed.
   - Fuel answers are checked against each vehicle's miles per gallon and tank size, and against recent prices.
   - Weekly limits per category, a meter on Home, alerts at 75% and over the limit, and a Sunday report.
   Loaded before app.js; everything here runs after the app has started. */

/* ---------- categories ---------- */
const CATS = {
  groceries: { name: 'Groceries', fun: false }, fuel: { name: 'Fuel', fun: false }, household: { name: 'Household', fun: false },
  eatout: { name: 'Eating out', fun: true }, snacks: { name: 'Snacks & drinks', fun: true },
  alcohol: { name: 'Alcohol', fun: true }, fun: { name: 'Entertainment', fun: true },
  unexpected: { name: 'Unexpected', fun: false }, other: { name: 'Other', fun: false }
};
const FUN_CATS = ['eatout', 'snacks', 'alcohol', 'fun'];
const CAT_NAMES = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [v.name, k]));
const catKey = c => (CATS[c] ? c : CAT_NAMES[c] || (c === 'Gas' ? 'fuel' : null));
const DEFAULT_LIMITS = { eatout: 40, snacks: 25, alcohol: 20, fun: 30 };
const limits = () => Object.assign({}, DEFAULT_LIMITS, S.limits || {});

// Where a purchase was made says what it probably was. (Bank wording is upper case, punctuation turned to spaces.)
const STORE_RULES = [
  ['station', /\b(CIRCLEK|CIRCLE K|CASEYS|CASEY S|MURPHY|QUIKTRIP|QT|SHELL|EXXON|EXXONMOBIL|CHEVRON|PHILLIPS 66|CONOCO|VALERO|LOVES|LOVE S|PILOT|FLYING J|7 ELEVEN|SINCLAIR|SPEEDWAY|KUM GO|ONCUE|ON CUE|MAVERIK|RACETRAC|MARATHON|CITGO|SHEETZ|WAWA|BUC EE|MAPCO|STRIPES|SUNOCO|BP|TRAVEL CENTER|TRUCK STOP|KWIK|EZ MART|E Z MART|ALLSUPS|STOP N GO)\b/],
  ['alcohol', /\b(LIQUOR|LIQUORS|WINE|WINES|SPIRITS|BREWERY|BREWING|TAVERN|PUB|SALOON|BEER)\b/],
  ['eatout', /\b(MCDONALD S|MCDONALDS|SONIC|TACO BELL|TACO BUENO|WENDY S|WENDYS|BURGER KING|SUBWAY|PIZZA|DOMINO S|DOMINOS|KFC|CHICK FIL A|ARBY S|ARBYS|WHATABURGER|BRAUM S|BRAUMS|DAIRY QUEEN|STARBUCKS|APPLEBEE S|CHILI S|IHOP|WAFFLE HOUSE|DOORDASH|UBER EATS|UBEREATS|GRUBHUB|RESTAURANT|GRILL|CAFE|DINER|BBQ|CRACKER BARREL|PANDA EXPRESS|POPEYES|JACK IN THE BOX|DUNKIN|HARDEE S|HARDEES|LITTLE CAESARS|PAPA JOHN S|PAPA JOHNS|CHIPOTLE|ZAXBY S|RAISING CANE S|CULVER S|FREDDY S|SLIM CHICKENS|WINGSTOP|BUFFALO WILD|OLIVE GARDEN|RED LOBSTER|LONGHORN|TEXAS ROADHOUSE|OUTBACK|GOLDEN CORRAL|DENNY S|DENNYS|EL CHICO|MAZZIO S|MAZZIOS|CICIS|STEAK N SHAKE|DONUT|DONUTS|COFFEE)\b/],
  ['fun', /\b(STEAMGAMES|STEAM|PLAYSTATION|XBOX|NINTENDO|CINEMA|THEATRE|THEATER|CINEMARK|AMC|REGAL|CASINO|BOWLING|TICKETMASTER|STUBHUB|FANDANGO|ARCADE|GAMESTOP|TWITCH|ROBLOX|BLIZZARD|LOTTERY|LOTTO)\b/],
  ['groceries', /\b(HARPS|WALMART|WAL MART|WM SUPERCENTER|ALDI|KROGER|HOMELAND|REASOR S|REASORS|SAMS CLUB|SAM S CLUB|COSTCO|WHOLE FOODS|PRICE CUTTER|SAVE A LOT|FOOD STOR|FOOD STORE|SUPERMARKET|GROCERY)\b/],
  ['household', /\b(DOLLAR GENERAL|FAMILY DOLLAR|DOLLAR TREE|LOWE S|LOWES|HOME DEPOT|TARGET|WALGREENS|CVS|ATWOODS|TRACTOR SUPPLY|AUTOZONE|O REILLY|OREILLY|ADVANCE AUTO)\b/]
];
const storeKind = desc => { for (const [k, re] of STORE_RULES) if (re.test(desc)) return k; return null; };
// A bank charge's category: the user's choice for that store first, then the store rules.
function txCat(t) {
  const l = labelFor(t);
  if (l && l.ignore) return null;
  const own = l && catKey(l.cat);
  if (own) return own;
  return storeKind(t.desc) || 'other';
}

// A readable store name from the bank's wording: "CIRCLEK 2654321 1234 DDA PIN POS PUR CD1111 FORT SMITH" -> "Circle K".
const STORE_NAMES = { CIRCLEK: 'Circle K', 'CIRCLE K': 'Circle K', CASEYS: "Casey's", 'CASEY S': "Casey's", MURPHY: 'Murphy USA', QUIKTRIP: 'QuikTrip',
  'SONIC DRIVE IN': 'Sonic', 'MCDONALD S': "McDonald's", MCDONALDS: "McDonald's", 'WAL MART': 'Walmart', WALMART: 'Walmart', 'DOLLAR GENERAL': 'Dollar General',
  'HARPS FOOD STOR': 'Harps', 'LOVE S': "Love's", LOVES: "Love's", '7 ELEVEN': '7-Eleven', ONCUE: 'OnCue', 'ON CUE': 'OnCue' };
function storeName(t) {
  const l = labelFor(t); if (l && l.name) return l.name;
  const d = String(t.desc || '');
  for (const [k, v] of Object.entries(STORE_NAMES)) if ((' ' + d + ' ').includes(' ' + k + ' ') || d.startsWith(k)) return v;
  const words = d.split(/\b(?:DDA|PIN|POS|PUR|PURCHASE|DEBIT|CARD|CD\d{4})\b/)[0].split(' ').filter(w => w && !/\d/.test(w));
  const s = words.slice(0, 4).join(' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return s || d;
}

/* ---------- cards and people ---------- */
const cardOf = desc => { const m = String(desc || '').match(/\bCD(\d{4})\b/); return m ? m[1] : null; };
const people = () => householdNames();
const me = () => (profile() || {}).name || null;
function whoOfTx(t) {
  const card = cardOf(t.desc);
  if (card && (S.cards || {})[card]) return S.cards[card];
  const q = (S.fuelQ || []).find(q => q.txId === t.id);
  return q && q.answer && q.answer.by ? q.answer.by : null;
}

/* ---------- spending in a date range ---------- */
// Bank charges that are spending (not bill payments, not their fees, not marked "not spending").
function spendingTx(from, to) {
  if (!bankOn()) return [];
  const billTx = new Set(S.payments.flatMap(p => [p.txId, p.feeTxId]).concat(S.bank.suggest.flatMap(s => [s.txId, s.feeTxId, s.smallId])).filter(Boolean));
  return S.bank.tx.filter(t => t.amount < 0 && t.date >= from && t.date < to && !billTx.has(t.id) && txCat(t) !== null);
}
// Totals per category and per person. A gas-station charge is split by its answer: fuel, and the rest snacks.
function spendSummary(from, to) {
  const cats = {}, byWho = {}, pending = [];
  const add = (cat, amt, who) => {
    cats[cat] = (cats[cat] || 0) + amt;
    const w = who || 'Not known yet';
    byWho[w] = byWho[w] || {}; byWho[w][cat] = (byWho[w][cat] || 0) + amt;
  };
  for (const t of spendingTx(from, to)) {
    const amt = -t.amount, cat = txCat(t), who = whoOfTx(t);
    if (cat !== 'station') { add(cat, amt, who); continue; }
    const q = (S.fuelQ || []).find(q => q.txId === t.id);
    const a = q && q.answer;
    if (!a) { pending.push({ t, amt, who }); continue; }
    if (a.unrecognized) { add('other', amt, who); continue; }
    const fuel = a.none ? 0 : Math.min(a.fuel || 0, amt);
    if (fuel) add('fuel', fuel, a.by || who);
    if (amt - fuel > 0.004) add('snacks', amt - fuel, a.by || who);
  }
  for (const x of S.spending.filter(x => !x.txId && x.date >= from && x.date < to)) add(catKey(x.what) || 'other', x.amount, x.who || null);
  const fun = sum(FUN_CATS.map(c => cats[c] || 0));
  return { cats, byWho, pending, fun };
}
const weekStart = d => { const w = new Date(parseD(d)).getUTCDay(); return addDays(d, -((w + 6) % 7)); }; // Monday
// Take-home pay per week, from the paychecks set up (for "% of take-home").
const weeklyPay = () => sum(S.incomes.filter(i => i.active !== false).map(i => {
  const v = incAmt(i).v; return i.freq === 'weekly' ? v : i.freq === 'biweekly' ? v / 2 : i.freq === 'monthly' ? v * 12 / 52 : i.freq === 'yearly' ? v / 52 : 0;
}));

/* ---------- the weekly meter on Home ---------- */
function meterHtml() {
  if (!S || !bankOn() && !S.spending.length) return '';
  const ws = weekStart(today()), s = spendSummary(ws, addDays(ws, 7)), L = limits();
  const pay = weeklyPay(), pct = pay ? Math.round(s.fun / pay * 100) : null;
  const bars = FUN_CATS.map(c => {
    const spent = s.cats[c] || 0, lim = L[c] || 0, r = lim ? spent / lim : 0;
    const cls = r >= 1 ? 'over' : r >= 0.75 ? 'near' : 'ok';
    return `<div class="meter-row"><div class="meter-top"><span>${CATS[c].name}</span><span class="num ${r >= 1 ? 'neg' : ''}">${fm(spent)}${lim ? ` <span class="muted">of ${fm(lim)}</span>` : ''}</span></div>
      <div class="meter-bar"><span class="meter-fill ${cls}" style="width:${Math.min(100, Math.round(r * 100))}%"></span></div></div>`;
  }).join('');
  const who = Object.entries(s.byWho).map(([w, c]) => [w, sum(FUN_CATS.map(k => c[k] || 0))]).filter(([, v]) => v > 0.004);
  return `<h2>This week's fun spending<span class="tot num">${fm(s.fun)}</span></h2><div class="card pad meter">
    <div class="small muted" style="margin-bottom:6px">Eating out, snacks and drinks, alcohol and entertainment since Monday${pct != null ? ` · <b>${pct}%</b> of a week's take-home pay` : ''}.</div>
    ${bars}
    ${who.length ? `<div class="small" style="margin-top:8px">${who.map(([w, v]) => `<b>${esc(w === me() ? 'Me' : w)}</b> ${fm(v)}`).join(' · ')}</div>` : ''}
    ${s.pending.length ? `<div class="small muted" style="margin-top:6px">${s.pending.length} gas-station purchase${s.pending.length === 1 ? '' : 's'} (${fm(sum(s.pending.map(p => p.amt)))}) waiting for an answer, not counted yet.</div>` : ''}
    <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="spLimits">Weekly limits</button></div></div>`;
}

/* ---------- vehicles ---------- */
const vehicles = () => S.vehicles || [];
const findV = id => vehicles().find(v => v.id === id);
const fuelOn = () => !!(S && profile() && vehicles().length);
// Fill-ups answered for a vehicle, oldest first.
const fills = vid => (S.fuelQ || []).filter(q => q.answer && !q.answer.none && !q.answer.unrecognized && q.answer.vehicle === vid && q.answer.odo)
  .map(q => Object.assign({ date: q.date }, q.answer)).sort((a, b) => a.odo - b.odo);
function recentPrice() {
  // (Answers already flagged for an odd price don't count toward what's normal.)
  // (Only answers with gallons typed from the pump.)
  const ps = (S.fuelQ || []).filter(q => q.answer && q.answer.gallons && q.answer.fuel && !q.answer.priceOdd && diffDays(q.date, today()) <= 60).map(q => q.answer.fuel / q.answer.gallons).sort((a, b) => a - b);
  return ps.length ? ps[Math.floor(ps.length / 2)] : null;
}
/* Today's typical unleaded price within about 30 miles of home (checked once a day by the sync storage, from
   Google's gas station listings). Kept on this phone for 6 hours between checks. */
let localPriceCache = null;
async function loadLocalPrice() {
  try { const c = JSON.parse(localStorage.getItem('billplanner.localPrice')); if (c && Date.now() - c.got < 6 * HOUR) { localPriceCache = c; return c; } } catch (e) { }
  const cfg = syncCfg(); if (!cfg) return null;
  const k = await syncKeys(cfg);
  const r = await api('GET', `/v1/h/${cfg.id}/fuelprice?check=1`, k.token);
  if (r.status !== 200 || !r.j || !r.j.price) return localPriceCache;
  localPriceCache = { price: r.j.price, low: r.j.low, high: r.j.high, stations: r.j.stations, at: r.j.at, got: Date.now() };
  try { localStorage.setItem('billplanner.localPrice', JSON.stringify(localPriceCache)); } catch (e) { }
  return localPriceCache;
}
const localPrice = () => {
  if (!localPriceCache) { try { localPriceCache = JSON.parse(localStorage.getItem('billplanner.localPrice')); } catch (e) { } }
  return localPriceCache && Date.now() - localPriceCache.at < 4 * 86400000 ? localPriceCache.price : null;
};
// The price per gallon to judge by: today's local price, or else the usual price from your own fill-ups.
const refPrice = () => localPrice() || recentPrice();
// Gallons for an answer: as typed from the pump, or worked out from the fuel cost and the price that day.
const gallonsOf = a => a.gallons || (a.fuel && a.price ? a.fuel / a.price : 0);

/* Fuel use without odometer readings: over the last 4 weeks, the fuel bought for a vehicle is compared with what
   its usual daily miles need at its miles per gallon. The margin is generous (35%, plus half a tank for whatever
   was in the tank at the start) because daily miles are only a guess. An odometer reading entered now and then
   replaces the guess with the real miles per day. */
function milesPerDay(v) {
  const f = fills(v.id);
  if (f.length >= 2) { const a = f[0], b = f[f.length - 1], days = diffDays(a.date, b.date); if (days >= 7 && b.odo > a.odo) return { mpd: (b.odo - a.odo) / days, real: true }; }
  return v.milesPerDay ? { mpd: v.milesPerDay, real: false } : null;
}
function usageCheck(v) {
  const m = milesPerDay(v); if (!m) return;
  const from = addDays(today(), -28);
  const qs = (S.fuelQ || []).filter(q => q.answer && !q.answer.none && !q.answer.unrecognized && q.answer.vehicle === v.id && q.date >= from);
  if (qs.length < 2) return;
  const gal = sum(qs.map(q => gallonsOf(q.answer))), spent = sum(qs.map(q => q.answer.fuel || 0));
  const mpg = ((v.mpgLow || 18) + (v.mpgHigh || 20)) / 2, need = m.mpd * 28 / mpg;
  const most = need * 1.35 + (v.tank || 20) * 0.5;
  if (gal <= most) return;
  const price = refPrice() || (spent / gal), extra = (gal - need) * price;
  addFlag(v.id, `Fuel check, ${v.name}: in the last 4 weeks ${fm(spent)} of fuel was reported (about ${gal.toFixed(0)} gallons). ${m.real ? `Its odometer readings show about ${Math.round(m.mpd)} miles a day, which at ${mpg} mpg needs` : `At its usual ${Math.round(m.mpd)} miles a day (a guess) and ${mpg} mpg, it needs`} about ${need.toFixed(0)} gallons: that's about ${fm(extra)} more fuel than expected.${m.real ? '' : ' If it really drives more than that, update its usual miles a day under More › Spending watch.'}`, 'u:' + v.id + ':' + weekStart(today()));
}

// Real miles per gallon from full-tank to full-tank fill-ups, once there are some.
function actualMpg(v) {
  const f = fills(v.id); let miles = 0, gal = 0, prev = null;
  for (const x of f) { if (prev && x.full) { miles += x.odo - prev.odo; gal += sum(f.filter(y => y.odo > prev.odo && y.odo <= x.odo).map(gallonsOf)); } if (x.full) prev = x; }
  return gal > 3 ? miles / gal : null;
}

/* ---------- the gas-station questions ---------- */
const openQs = () => (S.fuelQ || []).filter(q => !q.answer);
// Questions this phone's person must answer: assigned to them, or not assigned and they haven't said "not me".
const myQs = () => { const m = me(); return m ? openQs().filter(q => q.assigned ? sameName(q.assigned, m) : !(q.notMe || []).some(n => sameName(n, m))) : []; };
// New gas-station charges since the fuel check was turned on get a question (once each).
function spendScan() {
  if (!fuelOn() || !bankOn()) return false;
  S.fuelQ = S.fuelQ || [];
  let added = false;
  for (const t of spendingTx(S.fuelSince || today(), addDays(today(), 1))) {
    if (txCat(t) !== 'station' || S.fuelQ.some(q => q.txId === t.id)) continue;
    const card = cardOf(t.desc), owner = card && (S.cards || {})[card];
    S.fuelQ.push({ id: 'q' + t.id, txId: t.id, txDate: t.date, date: t.date, merchant: storeName(t), total: Math.round(-t.amount * 100) / 100, card,
      assigned: owner || null, assignedAt: owner ? Date.now() : null, notMe: [], created: Date.now() });
    added = true;
  }
  return added;
}
// Two phones may each have made a question for the same charge: keep one (an answered one if there is).
function fuelDedupe() {
  if (!S.fuelQ || S.fuelQ.length < 2) return;
  const keep = new Map();
  for (const q of S.fuelQ) { const k = q.txId, o = keep.get(k); if (!o || (!o.answer && q.answer)) keep.set(k, q); }
  if (keep.size !== S.fuelQ.length) S.fuelQ = [...keep.values()];
}
function sheetFuelQ(q, warn) {
  const m = me(), mine = q.assigned && sameName(q.assigned, m);
  const head = `<div class="fq-head"><div class="small muted">${nice(q.date)}</div>
    <div class="fq-store">${esc(q.merchant)}</div><div class="fq-total num">${fm(q.total)}</div>${q.card ? `<div class="small muted">Card ending ${q.card}</div>` : ''}</div>`;
  if (!mine) {
    const others = people().filter(n => !sameName(n, m) && !(q.notMe || []).some(x => sameName(x, n)));
    return openSheet(`<h3>Was this you?</h3>${head}
      <p class="hint">Gas-station purchases need a quick answer so fuel and snacks can be told apart. This can't be skipped.</p>
      <div class="btns"><button class="btn" data-act="fqYes" data-id="${q.id}">Yes, it was me</button></div>
      <div class="btns"><button class="btn ghost" data-act="fqNo" data-id="${q.id}">Not me${others.length === 1 ? `, ask ${esc(others[0])}` : ''}</button></div>`, { locked: true });
  }
  const vs = vehicles(), mineV = vs.find(v => sameName(v.driver, m)) || vs[0];
  const a = q.draft || {};
  openSheet(`<form id="fFuelQ" data-id="${q.id}"><h3>How much was fuel?</h3>${head}
    ${warn ? `<div class="form-error">${warn}</div>` : ''}
    <label for="fqV">Vehicle</label><select id="fqV" name="vehicle">${vs.map(v => `<option value="${v.id}"${(a.vehicle || mineV.id) === v.id ? ' selected' : ''}>${esc(v.name)}${v.driver ? ` (${esc(v.driver)})` : ''}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" name="none" data-act="fqNone"${a.none ? ' checked' : ''}> No fuel, it was all snacks, drinks or other things</label>
    <div data-fq="fuel"${a.none ? ' hidden' : ''}>
      <p class="hint" style="margin-top:10px"><b>Be exact:</b> copy the fuel cost from the pump or the receipt. It's checked against the miles the vehicle usually drives${localPrice() ? ` and today's local price (${fm(localPrice())} a gallon)` : ''}.</p>
      <label for="fqF">Fuel cost</label><input id="fqF" name="fuel" inputmode="decimal" placeholder="20.00" value="${a.fuel || ''}">
      <details${a.gallons || a.odo ? ' open' : ''}><summary class="small" style="margin-top:10px;color:var(--brand)">Gallons or odometer (only if you know them)</summary>
        <div class="two"><div><label for="fqG">Gallons</label><input id="fqG" name="gallons" inputmode="decimal" placeholder="7.142" value="${a.gallons || ''}"></div>
        <div><label for="fqO">Odometer</label><input id="fqO" name="odo" inputmode="numeric" placeholder="148326" value="${a.odo || ''}"></div></div>
        <label class="check"><input type="checkbox" name="full"${a.full ? ' checked' : ''}> I filled the tank all the way</label>
        <p class="hint">Not needed. An odometer reading now and then makes the fuel check more exact.</p>
      </details>
    </div>
    <div class="fq-rest small" data-fq="rest" data-total="${q.total}"></div>
    <input type="hidden" name="confirm" value="${warn ? '1' : ''}">
    <div class="btns"><button class="btn block">${warn ? 'These numbers are right, send them' : 'Send'}</button></div>
    <p class="small" style="text-align:center;margin-top:14px"><a href="#" data-act="fqUnknown" data-id="${q.id}" class="muted">I don't recognize this purchase</a></p></form>`, { locked: true });
  fqRest();
}
// Live "the rest counts as snacks and drinks".
function fqRest() {
  const f = document.getElementById('fFuelQ'); if (!f) return;
  const el = f.querySelector('[data-fq=rest]'), total = Number(el.dataset.total), none = f.elements.none.checked;
  f.querySelector('[data-fq=fuel]').hidden = none;
  const fuel = none ? 0 : (num(f.elements.fuel.value) || 0);
  const rest = Math.max(0, total - fuel);
  el.innerHTML = fuel > total + 0.004 ? `<span class="neg">The fuel cost is more than the whole purchase (${fm(total)}).</span>` : `The rest, <b>${fm(rest)}</b>, counts as snacks and drinks.`;
}
// Show the next question this phone must answer (it stays until answered).
function showFuelQuestion() {
  if (!fuelOn()) return false;
  const q = myQs().sort((a, b) => a.created - b.created)[0];
  if (!q) { if (sheetLocked()) closeSheet(true); return false; }
  const sh = document.getElementById('sheet');
  if (sheetLocked() && sh.dataset.q === q.id) return true;
  sheetFuelQ(q); sh.dataset.q = q.id;
  return true;
}
function rememberCard(q, who) { if (q.card && who && !(S.cards || {})[q.card]) S.cards = Object.assign({}, S.cards, { [q.card]: who }); }
function fqYes(q) { q.assigned = me(); q.assignedAt = Date.now(); rememberCard(q, me()); save(); sheetFuelQ(q); document.getElementById('sheet').dataset.q = q.id; }
function fqNo(q) {
  const m = me();
  q.notMe = [...new Set([...(q.notMe || []), m])];
  const others = people().filter(n => !q.notMe.some(x => sameName(x, n)));
  if (others.length === 1) { q.assigned = others[0]; q.assignedAt = Date.now(); }
  else if (!others.length) {
    q.answer = { unrecognized: true, by: null, at: Date.now() };
    addFlag(null, `Nobody claimed the ${q.merchant} purchase of ${fm(q.total)} on ${nice(q.date)}. If neither of you made it, call the bank about the card.`, 'q:' + q.id);
  }
  save(); spendAlerts(); closeSheet(true); render(); showFuelQuestion();
  toast(q.assigned ? `Sent to ${q.assigned}. They'll be reminded until they answer.` : 'Noted.');
}
function fqUnknown(q) {
  openSheet(`<h3>Don't recognize it?</h3><p><b>${esc(q.merchant)}</b>, ${fm(q.total)} on ${nice(q.date)}.</p>
    <p>If neither of you made this purchase, the card may have been used by someone else. Both phones will be alerted, and you should call the bank.</p>
    <div class="btns"><button class="btn ghost" data-act="fqBack" data-id="${q.id}">Go back</button><button class="btn danger" data-act="fqUnknownYes" data-id="${q.id}">I don't recognize it</button></div>`, { locked: true });
}
function fqUnknownYes(q) {
  q.answer = { unrecognized: true, by: me(), at: Date.now() };
  addFlag(null, `${me()} doesn't recognize the ${q.merchant} purchase of ${fm(q.total)} on ${nice(q.date)}. If neither of you made it, call the bank about the card.`, 'q:' + q.id);
  save(); spendAlerts(); closeSheet(true); render(); showFuelQuestion();
}
// The fuel answer: checked right away (tank, odometer, price per gallon) and over time (miles vs gallons).
function submitFuelQ(f) {
  const q = (S.fuelQ || []).find(x => x.id === f.dataset.id); if (!q) { closeSheet(true); return; }
  const fd = new FormData(f), v = findV(fd.get('vehicle')), none = fd.get('none') === 'on';
  const err = (msg, field) => { formError(f, msg, field); };
  const a = { by: me(), at: Date.now(), vehicle: v && v.id, none };
  q.draft = { vehicle: a.vehicle, none, gallons: fd.get('gallons'), fuel: fd.get('fuel'), odo: fd.get('odo'), full: fd.get('full') === 'on' };
  const warns = [];
  if (!none) {
    a.fuel = num(fd.get('fuel'));
    a.gallons = num(fd.get('gallons')) || null;
    a.odo = parseInt(String(fd.get('odo') || '').replace(/[^\d]/g, ''), 10) || null;
    a.full = fd.get('full') === 'on';
    a.price = refPrice() ? Math.round(refPrice() * 1000) / 1000 : null; // the price that day, to work out gallons
    if (!(a.fuel > 0)) return err('Enter the fuel cost from the pump or the receipt.', 'fuel');
    if (a.fuel > q.total + 0.01) return err(`The fuel cost can't be more than the whole purchase (${fm(q.total)}).`, 'fuel');
    // More fuel than the tank can hold (typed gallons, or the cost at today's price).
    const gal = gallonsOf(a);
    if (v && v.tank && gal > v.tank + 0.5) return err(a.gallons ? `That's more than the ${v.name}'s tank holds (${v.tank} gallons). Check the pump numbers.`
      : `At about ${fm(a.price)} a gallon, ${fm(a.fuel)} would be ${gal.toFixed(1)} gallons: more than the ${v.name}'s tank holds (${v.tank}). Check the fuel cost.`, a.gallons ? 'gallons' : 'fuel');
    if (a.odo) {
      const prev = v ? fills(v.id) : [];
      const last = prev.length ? prev[prev.length - 1].odo : null;
      if (last != null && a.odo < last) return err(`The odometer is lower than the last reading for the ${v.name} (${last.toLocaleString()} miles). Check the number, or leave it empty.`, 'odo');
      if (last != null && a.odo - last > 3000) warns.push(`That's ${(a.odo - last).toLocaleString()} miles since the last odometer reading for the ${v.name}.`);
    }
    // Typed gallons: does the price per gallon match what fuel costs around here?
    if (a.gallons) {
      const ppg = a.fuel / a.gallons, ref = refPrice();
      if (ref ? (ppg > ref * 1.12 + 0.10 || ppg < ref * 0.88 - 0.10) : (ppg < 1.5 || ppg > 6)) {
        warns.push(`That works out to ${fm(ppg)} a gallon${ref ? `, but unleaded around here is about ${fm(ref)} a gallon` : ''}.`);
        a.priceOdd = Math.round(ppg * 1000) / 1000; a.usualPrice = ref ? Math.round(ref * 1000) / 1000 : null;
      }
    }
  }
  if (warns.length && fd.get('confirm') !== '1') { sheetFuelQ(q, warns.join(' ') + ' Check the numbers. If they are right, send them anyway.'); return; }
  delete q.draft;
  q.answer = a; q.assigned = q.assigned || me();
  rememberCard(q, me());
  if (a.priceOdd) addFlag(v && v.id, `${me()} reported ${fm(a.fuel)} of fuel for ${a.gallons} gallons at ${q.merchant} on ${nice(q.date)}: ${fm(a.priceOdd)} a gallon, which is unusual${a.usualPrice ? ` (recent fill-ups: about ${fm(a.usualPrice)} a gallon)` : ''}. Some of it may not have been fuel.`, 'p:' + q.id);
  if (v && !none) { mileageCheck(v); usageCheck(v); }
  save(); spendAlerts(); closeSheet(true); render();
  toast(none ? 'Thanks. It counts as snacks and drinks.' : `Thanks. ${fm(a.fuel)} fuel, ${fm(Math.max(0, q.total - a.fuel))} snacks and drinks.`);
  setTimeout(showFuelQuestion, 400);
}
/* Miles vs gallons: between two full-tank fill-ups, the fuel bought should match the miles driven divided by the
   vehicle's miles per gallon. Allows 15% for detours, idling, cold weather and short trips. */
function mileageCheck(v) {
  const f = fills(v.id), fulls = f.filter(x => x.full);
  if (fulls.length < 2) return;
  const b = fulls[fulls.length - 1], aF = fulls[fulls.length - 2];
  const miles = b.odo - aF.odo; if (miles <= 0) return;
  const gal = sum(f.filter(y => y.odo > aF.odo && y.odo <= b.odo).map(gallonsOf));
  const most = miles / (v.mpgLow || 18) * 1.15 + 0.5;
  if (gal <= most) return;
  const extra = gal - miles / (v.mpgLow || 18), price = refPrice() || (b.fuel / gallonsOf(b));
  addFlag(v.id, `Fuel check, ${v.name}: between ${nice(aF.date)} and ${nice(b.date)} it drove ${miles.toLocaleString()} miles, which needs at most about ${most.toFixed(1)} gallons at ${v.mpgLow || 18} mpg (with 15% to spare). The fill-ups reported come to ${gal.toFixed(1)} gallons: about ${fm(extra * price)} more fuel than the miles explain.`, 'm:' + v.id + ':' + b.odo);
}
function addFlag(vehicle, text, key) {
  S.fuelFlags = S.fuelFlags || [];
  if (S.fuelFlags.some(x => x.key === key)) return;
  S.fuelFlags.push({ id: uid(), key, vehicle, text, at: Date.now(), seenBy: [] });
}
const openFlags = () => (S.fuelFlags || []).filter(x => !(x.seenBy || []).some(n => sameName(n, me() || '?')));

/* ---------- Home: questions waiting on someone, and fuel-check alerts ---------- */
function spendAttentionHtml() {
  if (!S) return '';
  let h = '';
  for (const x of openFlags()) h += `<div class="banner bad"><b>Spending watch:</b> ${esc(x.text)}
    <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="flagSeen" data-id="${x.id}">Got it</button></div></div>`;
  const waiting = openQs().filter(q => !myQs().includes(q));
  if (waiting.length) h += `<div class="banner warn"><b>Waiting for an answer:</b> ${waiting.map(q => `${esc(q.merchant)} ${fm(q.total)} (${q.assigned ? `asked ${esc(q.assigned)}` : 'asked everyone'}, ${nice(q.date)})`).join('; ')}. Reminders keep going until it's answered.</div>`;
  for (const n of offPhones) h += `<div class="banner warn"><b>${esc(n)}'s phone isn't getting notifications</b>, so questions and reminders won't reach ${esc(n)} until the app is opened. On ${esc(n)}'s phone: More › Phone notifications › Turn on.</div>`;
  return h;
}
let offPhones = [];

/* ---------- alerts: questions, limits, flags (sent once each, to the right phones) ---------- */
const sentOnce = k => { S.sentAlerts = S.sentAlerts || []; if (S.sentAlerts.includes(k)) return false; S.sentAlerts = S.sentAlerts.concat([k]).slice(-500); return true; };
async function spendAlerts() {
  if (!S || !syncLinked() || typeof notifyNow !== 'function') return;
  const m = me(), out = [];
  for (const v of vehicles()) usageCheck(v); // 4-week fuel vs usual miles, re-checked as days pass
  for (const q of openQs()) {
    const to = q.assigned ? [q.assigned] : people().filter(n => !(q.notMe || []).some(x => sameName(x, n)));
    for (const n of to) if (!sameName(n, m) && sentOnce(`ask:${q.id}:${n}`))
      out.push([{ title: q.assigned ? `${q.merchant}: how much was fuel?` : `${q.merchant}: was this you?`, body: `${fm(q.total)} on ${nice(q.date)}. Open Bill Planner to answer.`, tag: 'q-' + q.id }, n]);
  }
  for (const x of S.fuelFlags || []) if (sentOnce('flag:' + x.id)) out.push([{ title: 'Spending watch', body: x.text, tag: 'f-' + x.id }, null]);
  if (bankOn()) {
    const ws = weekStart(today()), s = spendSummary(ws, addDays(ws, 7)), L = limits();
    for (const c of FUN_CATS) {
      const spent = s.cats[c] || 0, lim = L[c]; if (!lim) continue;
      if (spent >= lim && sentOnce(`lim:${ws}:${c}:100`)) out.push([{ title: `Over the ${CATS[c].name.toLowerCase()} limit`, body: `${fm(spent)} this week, limit ${fm(lim)}.`, tag: 'lim-' + c }, null]);
      else if (spent >= lim * 0.75 && spent < lim && sentOnce(`lim:${ws}:${c}:75`)) out.push([{ title: `${CATS[c].name}: ${Math.round(spent / lim * 100)}% of this week's limit`, body: `${fm(spent)} of ${fm(lim)} so far this week.`, tag: 'lim-' + c }, null]);
    }
  }
  if (!out.length) return;
  save();
  for (const [note, to] of out) { try { await notifyNow(note, to); } catch (e) { } }
}
// Reminders for the stored notification list (see sync.js buildNotes).
function spendNotes() {
  if (!S) return [];
  const now = Date.now(), out = [];
  const slots = (start, n) => { const r = []; let t = new Date(Math.max(start, now + 10 * 60000)); t.setMinutes(0, 0, 0); t = new Date(t.getTime() + HOUR);
    while (r.length < n) { const h = t.getHours(); if (h >= 8 && h <= 21) r.push(t.getTime()); t = new Date(t.getTime() + (h >= 8 && h <= 21 ? 2 * HOUR : HOUR)); } return r; };
  for (const q of openQs()) {
    const to = q.assigned ? [q.assigned] : people().filter(n => !(q.notMe || []).some(x => sameName(x, n)));
    for (const n of to) for (const at of slots(q.assignedAt || q.created, 18))
      out.push({ at, to: n, tag: 'q-' + q.id, title: `Still waiting: ${q.merchant}`, body: `${fm(q.total)} on ${nice(q.date)}. Open Bill Planner to answer. Reminders continue until it's answered.` });
    // After a day without an answer, tell the other person too.
    if (q.assigned) for (const n of people().filter(n => !sameName(n, q.assigned))) {
      const at = (q.assignedAt || q.created) + 24 * HOUR;
      if (at > now) out.push({ at, to: n, tag: 'late-' + q.id, title: `${q.assigned} hasn't answered yet`, body: `About ${q.merchant}, ${fm(q.total)} on ${nice(q.date)}.` });
    }
  }
  // Sunday evening report (worked out from this week so far).
  if (bankOn()) {
    const ws = weekStart(today()), sun = addDays(ws, 6), [y, mo, d] = sun.split('-').map(Number), at = new Date(y, mo - 1, d, 18, 0).getTime();
    if (at > now) {
      const s = spendSummary(ws, addDays(ws, 7)), L = limits(), pay = weeklyPay();
      const parts = FUN_CATS.filter(c => s.cats[c]).map(c => `${CATS[c].name} ${fm(s.cats[c])}${L[c] && s.cats[c] > L[c] ? ` (over the ${fm(L[c])} limit)` : ''}`);
      out.push({ at, to: null, tag: 'week-' + ws, title: `This week: ${fm(s.fun)} on fun spending${pay ? ` (${Math.round(s.fun / pay * 100)}% of take-home)` : ''}`, body: parts.length ? parts.join(', ') + '.' : 'Nothing on eating out, snacks, alcohol or entertainment. Nice work.' });
    }
  }
  return out;
}

/* ---------- More: limits, vehicles, cards ---------- */
function recentCards() {
  const seen = {};
  for (const t of (S.bank.tx || [])) { const c = cardOf(t.desc); if (c) seen[c] = (seen[c] || 0) + 1; }
  for (const c of Object.keys(S.cards || {})) seen[c] = seen[c] || 0;
  return Object.keys(seen).sort((a, b) => seen[b] - seen[a]);
}
function spendMoreHtml() {
  const vs = vehicles(), cards = recentCards(), L = limits();
  return `<h2>Spending watch</h2><div class="card">
    <button class="row" data-act="spLimits"><span class="main"><div class="name">Weekly limits</div><div class="sub">${FUN_CATS.map(c => `${CATS[c].name} ${fm(L[c])}`).join(' · ')}</div></span></button>
    <div class="row" style="cursor:default"><span class="main"><div class="name">Unleaded near home</div><div class="sub">${localPrice() ? `${fm(localPrice())} a gallon (typical of ${localPriceCache.stations} stations within about 30 miles, ${whenText(localPriceCache.at)})` : 'Not available yet. Checked once a day from Google\'s gas station listings.'}</div></span></div>
    ${vs.map(v => { const a = actualMpg(v), m = milesPerDay(v); return `<button class="row" data-act="spVehicle" data-id="${v.id}"><span class="main"><div class="name">${esc(v.name)}</div><div class="sub">${v.driver ? esc(v.driver) + ' · ' : ''}${v.mpgLow}-${v.mpgHigh} mpg${a ? ` (actual ${a.toFixed(1)})` : ''} · ${v.tank} gal tank${m ? ` · about ${Math.round(m.mpd)} miles a day${m.real ? ' (from odometer)' : ''}` : ''}</div></span></button>`; }).join('')}
    <button class="row" data-act="spVehicle"><span class="main"><div class="name">+ Add a vehicle</div><div class="sub">${vs.length ? 'Another vehicle' : 'Turns on the gas-station questions and the fuel check'}</div></span></button>
    ${cards.map(c => `<button class="row" data-act="spCard" data-id="${c}"><span class="main"><div class="name">Card ending ${c}</div><div class="sub">${(S.cards || {})[c] ? esc(S.cards[c]) + "'s card" : 'Whose card is this? Tap to choose'}</div></span></button>`).join('')}
  </div>`;
}
function sheetLimits() {
  const L = limits();
  openSheet(`<form id="fLimits"><h3>Weekly limits</h3><p class="hint">Monday to Sunday. You both get a notification at 75% and when a limit is passed, and a report on Sunday evening.</p>
    ${FUN_CATS.map(c => `<label for="lim${c}">${CATS[c].name}</label><input id="lim${c}" name="${c}" inputmode="decimal" value="${money2(L[c])}">`).join('')}
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div></form>`);
}
function sheetVehicle(v) {
  const x = v || { mpgLow: 18, mpgHigh: 20, tank: '' };
  openSheet(`<form id="fVehicle" data-id="${v ? v.id : ''}"><h3>${v ? 'Edit vehicle' : 'Add a vehicle'}</h3>
    <label for="vName">Vehicle</label><input id="vName" name="name" value="${esc(x.name || '')}" placeholder="For example: 2010 Ford F-150" required>
    <label for="vDriver">Who usually drives it</label><select id="vDriver" name="driver">${people().map(n => `<option${sameName(n, x.driver) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <div class="two"><div><label for="vLo">Miles per gallon, low</label><input id="vLo" name="mpgLow" inputmode="decimal" value="${x.mpgLow || ''}"></div>
    <div><label for="vHi">high</label><input id="vHi" name="mpgHigh" inputmode="decimal" value="${x.mpgHigh || ''}"></div></div>
    <label for="vTank">Fuel tank size (gallons)</label><input id="vTank" name="tank" inputmode="decimal" value="${x.tank || ''}" placeholder="For example: 19">
    <label for="vMpd">Miles driven on a usual day</label><input id="vMpd" name="milesPerDay" inputmode="numeric" value="${x.milesPerDay || ''}" placeholder="For example: 40">
    <p class="hint">A rough guess is fine: work and back, errands, averaged over the week. Used to check fuel answers: a fill-up can't be bigger than the tank, and the fuel bought each month should roughly match the miles driven. If anyone ever enters an odometer reading, the real miles replace this guess.</p>
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div>
    ${v ? `<div class="btns"><button type="button" class="btn danger" data-act="spVehicleDel" data-id="${v.id}">Remove vehicle</button></div>` : ''}</form>`);
}
function sheetCard(c) {
  openSheet(`<h3>Card ending ${c}</h3><p class="hint">Purchases on this card will show this person's name, and their gas-station questions go straight to them.</p>
    ${people().map(n => `<div class="btns"><button class="btn${sameName((S.cards || {})[c], n) ? '' : ' ghost'}" data-act="spCardSet" data-id="${c}" data-name="${esc(n)}">${esc(n)}'s card</button></div>`).join('')}
    <div class="btns"><button class="btn small ghost" data-act="spCardSet" data-id="${c}" data-name="">Not sure / shared card</button></div>`);
}

/* ---------- buttons and forms (the app passes these on) ---------- */
function spendAct(act, el) {
  const q = el.dataset.id && (S.fuelQ || []).find(x => x.id === el.dataset.id);
  switch (act) {
    case 'fqYes': if (q) fqYes(q); return true;
    case 'fqNo': if (q) fqNo(q); return true;
    case 'fqUnknown': if (q) fqUnknown(q); return true;
    case 'fqUnknownYes': if (q) fqUnknownYes(q); return true;
    case 'fqBack': if (q) { sheetFuelQ(q); document.getElementById('sheet').dataset.q = q.id; } return true;
    case 'flagSeen': { const x = (S.fuelFlags || []).find(f => f.id === el.dataset.id); if (x) { x.seenBy = [...new Set([...(x.seenBy || []), me() || '?'])]; save(); render(); } return true; }
    case 'spLimits': sheetLimits(); return true;
    case 'spVehicle': sheetVehicle(el.dataset.id ? findV(el.dataset.id) : null); return true;
    case 'spVehicleDel': S.vehicles = vehicles().filter(v => v.id !== el.dataset.id); save(); closeSheet(); render(); return true;
    case 'spCard': sheetCard(el.dataset.id); return true;
    case 'spCardSet': { const c = el.dataset.id, n = el.dataset.name; S.cards = Object.assign({}, S.cards); if (n) S.cards[c] = n; else delete S.cards[c]; save(); closeSheet(); render(); toast(n ? `Card ending ${c} is now ${n}'s.` : 'Card not assigned.'); return true; }
  }
  return false;
}
function spendSubmit(f) {
  const fd = new FormData(f);
  if (f.id === 'fFuelQ') { submitFuelQ(f); return true; }
  if (f.id === 'fLimits') { S.limits = Object.fromEntries(FUN_CATS.map(c => [c, num(fd.get(c)) || 0])); save(); closeSheet(); render(); toast('Weekly limits saved.'); return true; }
  if (f.id === 'fVehicle') {
    const name = String(fd.get('name') || '').trim(); if (!name) { formError(f, 'Give the vehicle a name.', 'name'); return true; }
    const lo = num(fd.get('mpgLow')), hi = num(fd.get('mpgHigh')), tank = num(fd.get('tank'));
    if (!(lo > 3 && hi >= lo)) { formError(f, 'Enter the miles per gallon, low and high (for example 18 and 20).', 'mpgLow'); return true; }
    if (!(tank > 3)) { formError(f, 'Enter the fuel tank size in gallons.', 'tank'); return true; }
    const mpd = num(fd.get('milesPerDay'));
    if (!(mpd > 0)) { formError(f, 'Enter a rough guess of the miles driven on a usual day (for example 40).', 'milesPerDay'); return true; }
    const o = { name, driver: fd.get('driver') || null, mpgLow: lo, mpgHigh: hi, tank, milesPerDay: mpd };
    S.vehicles = vehicles();
    if (f.dataset.id) Object.assign(findV(f.dataset.id), o); else S.vehicles = S.vehicles.concat([Object.assign({ id: uid() }, o)]);
    if (!S.fuelSince) S.fuelSince = today(); // questions start with purchases from today on
    save(); closeSheet(); render(); toast('Vehicle saved.'); return true;
  }
  return false;
}
document.addEventListener('input', e => { if (e.target.form && e.target.form.id === 'fFuelQ') fqRest(); });
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.act === 'fqNone') fqRest(); });
