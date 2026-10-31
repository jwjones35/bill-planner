'use strict';
/* Bill Planner: spending watch.
   Goal 2 of the app: keep a close eye on money spent on eating out, snacks and drinks, alcohol and entertainment,
   with nobody having to type numbers or do math.
   - Every purchase is sorted into a category from where it was made (or the user's own choice for that store).
   - Each card is remembered as someone's (Arvest shows the card's last 4 digits after "CD"), so every purchase on it
     shows that person's name. A new card is asked about once, with one tap.
   - Gas stations sell fuel and snacks on one charge. The app splits each one by itself:
       * a round-dollar charge ($20.00, $30.00) is fuel prepaid at the counter;
       * any other amount counts as fuel up to what that person's vehicle has burned since its last stop
         (its usual miles a day / miles per gallon x the current gas price), never more than a full tank;
         the rest is snacks and drinks.
     One tap on the purchase corrects it when the estimate is off.
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
  ['fun', /\b(STEAMGAMES|STEAM|PLAYSTATION|XBOX|NINTENDO|CINEMA|THEATRE|THEATER|CINEMARK|AMC|REGAL|CASINO|BOWLING|TICKETMASTER|STUBHUB|FANDANGO|ARCADE|GAMESTOP|TWITCH|ROBLOX|BLIZZARD|BLIZZ|BLIZZARD ENT|BATTLE NET|BATTLENET|ACTIVISION|WORLD OF WARCRAFT|LOTTERY|LOTTO)\b/],
  ['groceries', /\b(HARPS|WALMART|WAL MART|WM SUPERCENTER|ALDI|KROGER|HOMELAND|REASOR S|REASORS|SAMS CLUB|SAM S CLUB|COSTCO|WHOLE FOODS|PRICE CUTTER|SAVE A LOT|FOOD STOR|FOOD STORE|SUPERMARKET|GROCERY)\b/],
  ['household', /\b(DOLLAR GENERAL|FAMILY DOLLAR|DOLLAR TREE|LOWE S|LOWES|HOME DEPOT|TARGET|WALGREENS|CVS|ATWOODS|TRACTOR SUPPLY|AUTOZONE|O REILLY|OREILLY|ADVANCE AUTO)\b/]
];
// Bills that are entertainment (streaming and the like). Amazon Prime isn't, since it's mostly used for household
// shopping. A bill can be switched either way in its settings ("Counts as entertainment").
const FUN_BILLS = /\b(NETFLIX|DISNEY|HULU|SPOTIFY|PARAMOUNT|PEACOCK|HBO|MAX|YOUTUBE TV|YOUTUBE PREMIUM|SLING|STARZ|SHOWTIME|CRUNCHYROLL|PANDORA|SIRIUS|SIRIUSXM|XBOX|PLAYSTATION|NINTENDO|TWITCH|BLIZZARD|BLIZZ|BATTLE NET|BATTLENET|ACTIVISION|WORLD OF WARCRAFT|WOW|WARCRAFT)\b/;
const billIsFun = b => (b.fun != null ? !!b.fun : FUN_BILLS.test(normText(b.name)));
const storeKind = desc => { for (const [k, re] of STORE_RULES) if (re.test(desc)) return k; return null; };
// A bank charge's category: the user's choice for that store first, then the store rules.
function txCat(t) {
  const ed = txEd(t);
  if (ed.cat) return ed.cat === 'none' ? null : ed.cat; // changed by hand for this one purchase
  const l = labelFor(t);
  if (l && l.ignore) return null;
  const own = l && (l.cat === 'station' ? 'station' : catKey(l.cat));
  if (own) return own;
  return storeKind(t.desc) || 'other';
}
// A readable store name from the bank's wording: "CIRCLEK 2654321 1234 DDA PIN POS PUR CD1111 FORT SMITH" -> "Circle K".
const STORE_NAMES = { CIRCLEK: 'Circle K', 'CIRCLE K': 'Circle K', CASEYS: "Casey's", 'CASEY S': "Casey's", MURPHY: 'Murphy USA', QUIKTRIP: 'QuikTrip',
  'SONIC DRIVE IN': 'Sonic', 'MCDONALD S': "McDonald's", MCDONALDS: "McDonald's", 'WAL MART': 'Walmart', WALMART: 'Walmart', 'DOLLAR GENERAL': 'Dollar General',
  'HARPS FOOD STOR': 'Harps', 'LOVE S': "Love's", LOVES: "Love's", '7 ELEVEN': '7-Eleven', ONCUE: 'OnCue', 'ON CUE': 'OnCue' };
function storeName(t) {
  if (txEd(t).store) return txEd(t).store;
  const l = labelFor(t); if (l && l.name) return l.name;
  const d = String(t.desc || '');
  for (const [k, v] of Object.entries(STORE_NAMES)) if ((' ' + d + ' ').includes(' ' + k + ' ') || d.startsWith(k)) return v;
  const words = d.split(/\b(?:DDA|PIN|POS|PUR|PURCHASE|DEBIT|CARD|CD\d{4})\b/)[0].split(' ').filter(w => w && !/\d/.test(w));
  const s = words.slice(0, 4).join(' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return s || d;
}

/* ---------- cards and people ---------- */
const SHARED = '*shared*'; // a card both people use: each gas-station purchase on it asks who, with one tap
const cardOf = desc => { const m = String(desc || '').match(/\bCD(\d{4})\b/); return m ? m[1] : null; };
const people = () => householdNames();
const me = () => (profile() || {}).name || null;
const cardOwner = c => { const o = c && (S.cards || {})[c]; return o && o !== SHARED ? o : null; };
// Who made a station purchase: answered for that purchase, or the card's owner.
const whoOfRecord = q => q.who || cardOwner(q.card) || null;
const SHARED_BILLS = 'Shared bills';
const UNKNOWN = 'Not known yet';
function whoOfTx(t) {
  const set = txEd(t).who || (S.txWho || {})[t.id]; if (set) return set; // set for this one purchase
  const q = (S.fuelQ || []).find(q => q.txId === t.id);
  return (q && whoOfRecord(q)) || cardOwner(cardOf(t.desc));
}

/* ---------- changes made by hand to one bank purchase ----------
   S.txEdit[bank id] = { who, cat, store, date, amount }: only what was changed. The bank's own record is never
   altered, so "Go back to what the bank shows" always works. */
const txEd = t => (S && S.txEdit && S.txEdit[t.id]) || {};
const txDate = t => txEd(t).date || t.date;
const txAmt = t => (txEd(t).amount != null ? txEd(t).amount : -t.amount);

/* ---------- spending in a date range ---------- */
// Bank charges that are spending (not bill payments, not their fees, not marked "not spending").
function spendingTx(from, to) {
  if (!bankOn()) return [];
  const billTx = new Set(S.payments.flatMap(p => [p.txId, p.feeTxId]).concat(S.bank.suggest.flatMap(s => [s.txId, s.feeTxId, s.smallId])).filter(Boolean));
  return S.bank.tx.filter(t => t.amount < 0 && txDate(t) >= from && txDate(t) < to && !billTx.has(t.id) && txCat(t) !== null);
}
/* Every piece of spending in a date range, each with where its number came from. The totals on Home are added up
   from exactly this list, so the breakdown behind a total always matches it.
   Gas-station charges become two pieces: fuel and snacks. */
function spendItems(from, to) {
  const items = [], unsplit = [], splits = stationSplits();
  const push = o => { if (o.amt >= 0.005) items.push(o); };
  for (const t of spendingTx(from, to)) {
    const amt = txAmt(t), cat = txCat(t), who = whoOfTx(t), base = { src: 'tx', t, id: t.id, date: txDate(t), name: storeName(t), who };
    if (cat !== 'station') { push(Object.assign({ cat, amt }, base)); continue; }
    const s = splits.get(t.id);
    if (!s) { unsplit.push({ t, amt, who }); continue; }
    if (s.unrecognized) { push(Object.assign({ cat: 'other', amt }, base)); continue; }
    push(Object.assign({ cat: 'fuel', amt: s.fuel, part: 'fuel', s, total: amt }, base));
    push(Object.assign({ cat: 'snacks', amt: s.snacks, part: 'snacks', s, total: amt }, base));
  }
  for (const x of S.spending.filter(x => !x.txId && x.date >= from && x.date < to))
    push({ src: 'hand', x, id: x.id, cat: catKey(x.what) || 'other', amt: x.amount, who: x.who || null, date: x.date, name: x.note || x.what });
  // Entertainment bills (streaming) paid this week count toward the entertainment limit too.
  // (They are still bills for "Available to spend"; this only reports them here.)
  for (const p of S.payments) {
    const d = p.paidOn || p.due, b = findB(p.billId);
    if (d >= from && d < to && b && billIsFun(b)) push({ src: 'bill', p, b, id: b.id, cat: 'fun', amt: p.amount, who: p.funWho || SHARED_BILLS, date: d, name: b.name });
  }
  return { items, unsplit };
}
// Totals per category and per person.
function spendSummary(from, to) {
  const cats = {}, byWho = {}, { items, unsplit } = spendItems(from, to);
  for (const it of items) {
    cats[it.cat] = (cats[it.cat] || 0) + it.amt;
    const w = it.who || UNKNOWN;
    byWho[w] = byWho[w] || {}; byWho[w][it.cat] = (byWho[w][it.cat] || 0) + it.amt;
  }
  const fun = sum(FUN_CATS.map(c => cats[c] || 0));
  return { cats, byWho, unsplit, fun };
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
    return `<a href="#" class="meter-row meter-link" data-act="spDetail" data-cat="${c}"><div class="meter-top"><span>${CATS[c].name} <span class="meter-more">›</span></span><span class="num ${r >= 1 ? 'neg' : ''}">${fm(spent)}${lim ? ` <span class="muted">of ${fm(lim)}</span>` : ''}</span></div>
      <div class="meter-bar"><span class="meter-fill ${cls}" style="width:${Math.min(100, Math.round(r * 100))}%"></span></div></a>`;
  }).join('');
  const who = Object.entries(s.byWho).map(([w, c]) => [w, sum(FUN_CATS.map(k => c[k] || 0))]).filter(([, v]) => v > 0.004);
  return `<h2>This week's fun spending<span class="tot num">${fm(s.fun)}</span></h2><div class="card pad meter">
    <div class="small muted" style="margin-bottom:6px">Eating out, snacks and drinks, alcohol and entertainment since Monday${pct != null ? ` · <b>${pct}%</b> of a week's take-home pay` : ''}. Gas-station snacks are worked out automatically. <b>Tap any line to see every purchase behind it.</b></div>
    ${bars}
    ${who.length ? `<div class="small" style="margin-top:8px">${who.map(([w, v]) => w === UNKNOWN
      ? `<a href="#" data-act="whoUnknown" class="who-unknown"><b>${UNKNOWN}</b> ${fm(v)} (tap to sort)</a>`
      : `<a href="#" data-act="spDetail" data-cat="allfun" data-who="${esc(w)}" class="who-link"><b>${esc(sameName(w, me()) ? 'Me' : w)}</b> ${fm(v)}</a>`).join(' · ')}</div>` : ''}
    ${s.unsplit.length ? `<div class="small muted" style="margin-top:6px">${s.unsplit.length} gas-station purchase${s.unsplit.length === 1 ? '' : 's'} (${fm(sum(s.unsplit.map(p => p.amt)))}) not split into fuel and snacks yet. ${vehicles().length ? (profile() ? 'They will be the next time the bank data updates.' : 'Add your name under More › Profile first.') : 'Add your vehicles under More › Spending watch.'}</div>` : ''}
    <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="spDetail" data-cat="allfun">See every purchase</button><button class="btn small ghost" data-act="spLimits">Weekly limits</button></div></div>`;
}

/* ---------- vehicles and the gas price ---------- */
const vehicles = () => S.vehicles || [];
const findV = id => vehicles().find(v => v.id === id);
const fuelOn = () => !!(S && profile() && vehicles().length);
/* The current unleaded price (looked up once a day by the sync storage: the U.S. government's weekly average).
   Kept on this phone for 6 hours between checks. */
let localPriceCache = null;
async function loadLocalPrice() {
  try { const c = JSON.parse(localStorage.getItem('billplanner.localPrice')); if (c && Date.now() - c.got < 6 * HOUR) { localPriceCache = c; return c; } } catch (e) { }
  const cfg = syncCfg(); if (!cfg) return null;
  const k = await syncKeys(cfg);
  const r = await api('GET', `/v1/h/${cfg.id}/fuelprice?check=1`, k.token);
  if (r.status !== 200 || !r.j || !r.j.price) return localPriceCache;
  localPriceCache = { price: r.j.price, low: r.j.low, high: r.j.high, stations: r.j.stations, at: r.j.at, source: r.j.source, period: r.j.period, got: Date.now() };
  try { localStorage.setItem('billplanner.localPrice', JSON.stringify(localPriceCache)); } catch (e) { }
  return localPriceCache;
}
const localPrice = () => {
  if (!localPriceCache) { try { localPriceCache = JSON.parse(localStorage.getItem('billplanner.localPrice')); } catch (e) { } }
  // (The government price is weekly, so it stays good for 10 days; a daily local price for 4.)
  const maxAge = localPriceCache && localPriceCache.source === 'eia' ? 10 : 4;
  return localPriceCache && Date.now() - localPriceCache.at < maxAge * 86400000 ? localPriceCache.price : null;
};
const gasPrice = () => localPrice() || 3.5; // a sensible stand-in until the first price arrives

/* ---------- the automatic gas-station split ---------- */
const isRound = x => Math.abs(x - Math.round(x)) < 0.005;
const vehicleOf = who => (who && vehicles().find(v => sameName(v.driver, who))) || vehicles()[0] || null;
/* For each vehicle, go through its gas-station purchases in date order, keeping a running "fuel burned since the
   last stop" (its usual miles a day / its miles per gallon x the gas price, at most a full tank).
   - A correction tapped by someone wins.
   - A round-dollar charge is fuel prepaid at the counter.
   - Otherwise fuel is what was burned since the last stop (at most the charge and a full tank); the rest is snacks.
   Prepaid fuel beyond what was burned carries over to the next stop. */
let splitCache = null, splitKey = '';
function stationSplits() {
  const res = new Map(), vs = vehicles();
  if (!S || !vs.length) return res;
  const key = JSON.stringify([S.fuelQ, vs, S.cards, S.txEdit, S.txWho, gasPrice()]);
  if (splitCache && key === splitKey) return splitCache;
  const groups = {};
  for (const q of S.fuelQ || []) {
    const v = vehicleOf(((S.txEdit || {})[q.txId] || {}).who || (S.txWho || {})[q.txId] || whoOfRecord(q)); if (!v) continue;
    (groups[v.id] = groups[v.id] || { v, qs: [] }).qs.push(q);
  }
  const price = gasPrice();
  for (const { v, qs } of Object.values(groups)) {
    qs.sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
    const mpg = ((v.mpgLow || 18) + (v.mpgHigh || 20)) / 2, perDay = (v.milesPerDay || 30) / mpg * price, tankD = (v.tank || 20) * price;
    let burned = perDay * 5, last = qs.length ? qs[0].date : today(); // assume a few days' driving before the first stop
    for (const q of qs) {
      const ed = (S.txEdit || {})[q.txId] || {};
      if (ed.cat && ed.cat !== 'station') continue; // changed by hand: not a gas-station purchase
      burned = Math.min(burned + Math.max(0, diffDays(last, q.date)) * perDay, tankD); last = q.date;
      const total = ed.amount != null ? ed.amount : q.total;
      if (q.unrecognized) { res.set(q.txId, { fuel: 0, snacks: 0, unrecognized: true, v }); continue; }
      let fuel, how;
      if (q.override != null) { fuel = Math.min(q.override, total); how = 'set'; }
      else if (isRound(total) && total <= tankD + 1) { fuel = total; how = 'round'; }
      else { fuel = Math.max(0, Math.min(burned, total, tankD)); how = 'est'; }
      burned = Math.max(-tankD, burned - fuel);
      res.set(q.txId, { fuel: Math.round(fuel * 100) / 100, snacks: Math.round((total - fuel) * 100) / 100, how, v });
    }
  }
  splitCache = res; splitKey = key;
  return res;
}
// The little label on a gas-station purchase in the spending list.
function stationTag(t) {
  const s = stationSplits().get(t.id);
  if (!s) return 'Gas station';
  if (s.unrecognized) return 'Not recognized';
  const est = s.how === 'est' ? '~' : '';
  if (s.snacks < 0.005) return `Fuel ${est}${fm(s.fuel)}`;
  if (s.fuel < 0.005) return `Snacks ${fm(s.snacks)}`;
  return `Fuel ${est}${fm(s.fuel)} + snacks ${est}${fm(s.snacks)}`;
}

/* ---------- gas-station records, and the one question: whose card ---------- */
const openQs = () => (S.fuelQ || []).filter(q => !whoOfRecord(q) && !q.unrecognized);
const myQs = () => (me() ? openQs() : []);
// Every gas-station charge the bank shows (its last 5 weeks) gets a record, used for the split. (Records used to
// start only from the day the vehicles were added, which left that week's earlier purchases unsplit.)
function spendScan() {
  if (!fuelOn() || !bankOn()) return false;
  S.fuelQ = S.fuelQ || [];
  let added = false;
  for (const t of spendingTx(addDays(today(), -35), addDays(today(), 1))) {
    if (txCat(t) !== 'station' || S.fuelQ.some(q => q.txId === t.id)) continue;
    S.fuelQ.push({ id: 'q' + t.id, txId: t.id, txDate: t.date, date: t.date, merchant: storeName(t), total: Math.round(-t.amount * 100) / 100, card: cardOf(t.desc), created: Date.now() });
    added = true;
  }
  return added;
}
// Two phones may each have made a record for the same charge: keep one.
function fuelDedupe() {
  if (!S.fuelQ || S.fuelQ.length < 2) return;
  const keep = new Map();
  for (const q of S.fuelQ) { const o = keep.get(q.txId); if (!o || (!whoOfRecord(o) && whoOfRecord(q)) || (o.override == null && q.override != null)) keep.set(q.txId, q); }
  if (keep.size !== S.fuelQ.length) S.fuelQ = [...keep.values()];
}
// One tap: whose card is this? (or, for a shared card, who made this purchase).
function sheetWho(q) {
  const newCard = q.card && !(S.cards || {})[q.card];
  openSheet(`<h3>${newCard ? 'Whose card is this?' : 'Who made this purchase?'}</h3>
    <div class="fq-head"><div class="small muted">${nice(q.date)}</div><div class="fq-store">${esc(q.merchant)}</div><div class="fq-total num">${fm(q.total)}</div>${q.card ? `<div class="small muted">Card ending ${q.card}</div>` : ''}</div>
    <p class="hint">${newCard ? "One tap, once per card. After this, purchases on it are known to be that person's, and gas-station fuel and snacks are worked out automatically." : 'One tap. Fuel and snacks are then worked out automatically.'}</p>
    ${people().map(n => `<div class="btns"><button class="btn${sameName(n, me()) ? '' : ' ghost'}" data-act="whoSet" data-id="${q.id}" data-name="${esc(n)}">${newCard ? `${esc(n)}'s card` : esc(n)}</button></div>`).join('')}
    ${newCard ? `<div class="btns"><button class="btn small ghost" data-act="whoShared" data-id="${q.id}">We both use this card</button></div>` : ''}
    <p class="small" style="text-align:center;margin-top:14px"><a href="#" data-act="fqUnknown" data-id="${q.id}" class="muted">Neither of us made this purchase</a></p>`, { locked: true });
  document.getElementById('sheet').dataset.q = q.id;
}
function showFuelQuestion() {
  if (!fuelOn()) return false;
  const q = myQs().sort((a, b) => a.created - b.created)[0];
  if (!q) { if (sheetLocked()) closeSheet(true); return false; }
  const sh = document.getElementById('sheet');
  if (sheetLocked() && sh.dataset.q === q.id) return true;
  sheetWho(q);
  return true;
}
function whoSet(q, name) {
  if (q.card && !(S.cards || {})[q.card]) S.cards = Object.assign({}, S.cards, { [q.card]: name });
  else q.who = name;
  save(); closeSheet(true); render();
  toast(q.card && cardOwner(q.card) ? `Card ending ${q.card} is ${name}'s.` : 'Thanks.');
  setTimeout(showFuelQuestion, 300);
}
function fqUnknown(q) {
  openSheet(`<h3>Neither of you made it?</h3><p><b>${esc(q.merchant)}</b>, ${fm(q.total)} on ${nice(q.date)}${q.card ? `, card ending ${q.card}` : ''}.</p>
    <p>If neither of you made this purchase, someone else may be using the card. Both phones will be alerted, and you should call the bank.</p>
    <div class="btns"><button class="btn ghost" data-act="fqBack" data-id="${q.id}">Go back</button><button class="btn danger" data-act="fqUnknownYes" data-id="${q.id}">Neither of us made it</button></div>`, { locked: true });
}
function fqUnknownYes(q) {
  q.unrecognized = true;
  addFlag(`${me()} says neither of you made the ${q.merchant} purchase of ${fm(q.total)} on ${nice(q.date)}${q.card ? ` (card ending ${q.card})` : ''}. If that's right, call the bank about the card.`, 'q:' + q.id);
  save(); spendAlerts(); closeSheet(true); render(); showFuelQuestion();
}
// One-tap correction of a gas-station purchase (tap it in the spending list).
function sheetStationFix(t) {
  const q = (S.fuelQ || []).find(q => q.txId === t.id), s = stationSplits().get(t.id);
  if (!q || !s) { sheetTxWhat(t); return; }
  const total = q.total, steps = [];
  for (let x = 10; x < total && steps.length < 6; x += 10) steps.push(x);
  openSheet(`<h3>${esc(q.merchant)} · ${fm(total)}</h3>
    <p class="muted" style="margin-top:2px">${nice(q.date)}${whoOfRecord(q) ? ` · ${esc(whoOfRecord(q))}` : ''}</p>
    <div class="banner ${s.how === 'set' ? 'good' : 'warn'}" style="margin-top:6px">${s.how === 'set' ? 'Set by tapping' : s.how === 'round' ? 'A round amount, so counted as fuel paid at the counter' : `Worked out from the ${esc(s.v.name)}'s usual driving`}: <b>fuel ${fm(s.fuel)}</b>${s.snacks > 0.004 ? `, snacks and drinks ${fm(s.snacks)}` : ''}.</div>
    <p class="hint">Only if that's wrong, tap how much was fuel:</p>
    <div class="fix-grid"><button class="btn ghost" data-act="fixFuel" data-id="${q.id}" data-v="${total}">All fuel</button>
      ${steps.map(x => `<button class="btn ghost" data-act="fixFuel" data-id="${q.id}" data-v="${x}">${fm(x)}</button>`).join('')}
      <button class="btn ghost" data-act="fixFuel" data-id="${q.id}" data-v="0">No fuel</button></div>
    ${q.override != null ? `<div class="btns"><button class="btn small ghost" data-act="fixFuel" data-id="${q.id}" data-v="">Go back to the automatic split</button></div>` : ''}
    <div class="btns"><button class="btn small ghost" data-act="fixOther" data-id="${esc(t.id)}">It wasn't a gas-station purchase</button></div>`);
}
function addFlag(text, key) {
  S.fuelFlags = S.fuelFlags || [];
  if (S.fuelFlags.some(x => x.key === key)) return;
  S.fuelFlags.push({ id: uid(), key, text, at: Date.now(), seenBy: [] });
}
const openFlags = () => (S.fuelFlags || []).filter(x => !(x.seenBy || []).some(n => sameName(n, me() || '?')));

/* ---------- Home: alerts ---------- */
let offPhones = [];
function spendAttentionHtml() {
  if (!S) return '';
  let h = '';
  for (const x of openFlags()) h += `<div class="banner bad"><b>Spending watch:</b> ${esc(x.text)}
    <div class="btns" style="margin-top:8px"><button class="btn small ghost" data-act="flagSeen" data-id="${x.id}">Got it</button></div></div>`;
  for (const n of offPhones) h += `<div class="banner warn"><b>${esc(n)}'s phone isn't getting notifications</b>, so reminders won't reach ${esc(n)} until the app is opened. On ${esc(n)}'s phone: More › Phone notifications › Turn on.</div>`;
  return h;
}

/* ---------- alerts: limits, whose-card questions, flags (sent once each) ---------- */
const sentOnce = k => { S.sentAlerts = S.sentAlerts || []; if (S.sentAlerts.includes(k)) return false; S.sentAlerts = S.sentAlerts.concat([k]).slice(-500); return true; };
async function spendAlerts() {
  if (!S || !syncLinked() || typeof notifyNow !== 'function') return;
  const m = me(), out = [];
  for (const q of openQs()) for (const n of people().filter(n => !sameName(n, m)))
    if (sentOnce(`ask:${q.id}:${n}`)) out.push([{ title: q.card && !(S.cards || {})[q.card] ? `Whose card ends in ${q.card}?` : `${q.merchant}: who made it?`, body: `${fm(q.total)} at ${q.merchant} on ${nice(q.date)}. One tap in Bill Planner.`, tag: 'q-' + q.id }, n]);
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
  for (const q of openQs()) {
    // A gentle reminder each morning and evening until someone taps.
    for (let d = 0; d < 3; d++) for (const h of [9, 18]) {
      const [y, mo, dd] = addDays(today(), d).split('-').map(Number), at = new Date(y, mo - 1, dd, h, 0).getTime();
      if (at > now + 10 * 60000) out.push({ at, to: null, tag: 'q-' + q.id, title: q.card && !(S.cards || {})[q.card] ? `Whose card ends in ${q.card}?` : `${q.merchant}: who made it?`, body: `${fm(q.total)} on ${nice(q.date)}. One tap in Bill Planner.` });
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

/* ---------- More: limits, gas price, vehicles, cards ---------- */
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
    <div class="row" style="cursor:default"><span class="main"><div class="name">Unleaded gas price</div><div class="sub">${localPrice()
      ? (localPriceCache.source === 'eia'
        ? `${fm(localPrice())} a gallon: U.S. government weekly average for Oklahoma's and Arkansas's regions${localPriceCache.period ? `, week of ${nice(localPriceCache.period)}` : ''}`
        : `${fm(localPrice())} a gallon (typical of ${localPriceCache.stations} stations within about 30 miles, ${whenText(localPriceCache.at)})`)
      : 'Not available yet. Until it is, $3.50 a gallon is used.'}</div></span></div>
    ${vs.map(v => `<button class="row" data-act="spVehicle" data-id="${v.id}"><span class="main"><div class="name">${esc(v.name)}</div><div class="sub">${v.driver ? esc(v.driver) + ' · ' : ''}about ${v.milesPerDay || '?'} miles a day · ${v.mpgLow}-${v.mpgHigh} mpg · ${v.tank} gal tank</div></span></button>`).join('')}
    <button class="row" data-act="spVehicle"><span class="main"><div class="name">+ Add a vehicle</div><div class="sub">${vs.length ? 'Another vehicle' : 'Turns on the automatic gas-station split (fuel vs snacks)'}</div></span></button>
    ${cards.map(c => `<button class="row" data-act="spCard" data-id="${c}"><span class="main"><div class="name">Card ending ${c}</div><div class="sub">${(S.cards || {})[c] === SHARED ? 'Both of you use it' : (S.cards || {})[c] ? esc(S.cards[c]) + "'s card" : 'Whose card is this? Tap to choose'}</div></span></button>`).join('')}
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
    <label for="vMpd">Miles driven on a usual day</label><input id="vMpd" name="milesPerDay" inputmode="numeric" value="${x.milesPerDay || ''}" placeholder="For example: 40">
    <p class="hint">A rough guess is fine (work and back, errands, averaged over the week). It decides how much of each gas-station purchase counts as fuel, so it's better a little low than too high.</p>
    <div class="two"><div><label for="vLo">Miles per gallon, low</label><input id="vLo" name="mpgLow" inputmode="decimal" value="${x.mpgLow || ''}"></div>
    <div><label for="vHi">high</label><input id="vHi" name="mpgHigh" inputmode="decimal" value="${x.mpgHigh || ''}"></div></div>
    <label for="vTank">Fuel tank size (gallons)</label><input id="vTank" name="tank" inputmode="decimal" value="${x.tank || ''}" placeholder="For example: 19">
    <div class="btns">${cancelBtn}<button class="btn">Save</button></div>
    ${v ? `<div class="btns"><button type="button" class="btn danger" data-act="spVehicleDel" data-id="${v.id}">Remove vehicle</button></div>` : ''}</form>`);
}
function sheetCard(c) {
  openSheet(`<h3>Card ending ${c}</h3><p class="hint">Purchases on this card will show this person's name, and their gas-station purchases are split using their vehicle.</p>
    ${people().map(n => `<div class="btns"><button class="btn${sameName((S.cards || {})[c], n) ? '' : ' ghost'}" data-act="spCardSet" data-id="${c}" data-name="${esc(n)}">${esc(n)}'s card</button></div>`).join('')}
    <div class="btns"><button class="btn small ghost" data-act="spCardSet" data-id="${c}" data-name="${SHARED}">We both use this card</button></div>`);
}

/* ---------- "Not known yet": sort out whose purchases they were, one tap each ----------
   For a purchase on a card, the tap remembers the whole card (every purchase on it, before and after). For one
   with no card number (online purchases and the like), it's set for that purchase only. */
function unknownFun(from, to) {
  const out = [];
  for (const t of spendingTx(from, to)) {
    const c = txCat(t);
    if (!(c === 'station' || (CATS[c] && CATS[c].fun)) || whoOfTx(t)) continue;
    out.push({ t, card: cardOf(t.desc), name: storeName(t), amt: -t.amount });
  }
  for (const x of S.spending.filter(x => !x.txId && !x.who && x.date >= from && x.date < to && CATS[catKey(x.what)] && CATS[catKey(x.what)].fun))
    out.push({ x, name: x.what + (x.note ? ' · ' + x.note : ''), amt: x.amount });
  return out;
}
function sheetUnknownWho() {
  const ws = weekStart(today()), list = unknownFun(ws, addDays(ws, 7));
  if (!list.length) { closeSheet(); render(); toast('Everything this week is sorted.'); return; }
  openSheet(`<h3>Whose purchases were these?</h3>
    <p class="hint">One tap each. For a card, the whole card is remembered, so its other purchases are sorted too.</p>
    ${list.map(it => `<div class="pad" style="border-top:1px solid var(--line);padding-left:0;padding-right:0">
      <div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(it.name)}</b><span class="num" style="font-weight:600">${fm(it.amt)}</span></div>
      <div class="small muted">${nice(it.t ? it.t.date : it.x.date)}${it.card ? ` · card ending ${it.card}` : it.t ? ' · no card number shown' : ' · entered by hand'}</div>
      <div class="btns" style="margin-top:6px">${people().map(n => `<button class="btn small ghost" data-act="whoAssign" data-tx="${it.t ? esc(it.t.id) : ''}" data-sp="${it.x ? it.x.id : ''}" data-card="${it.card || ''}" data-name="${esc(n)}">${esc(n)}${it.card ? "'s card" : ''}</button>`).join('')}</div></div>`).join('')}
    <div class="btns"><button class="btn ghost block" data-act="close">Done</button></div>`);
}
function whoAssign(el) {
  const n = el.dataset.name, card = el.dataset.card;
  if (card) S.cards = Object.assign({}, S.cards, { [card]: n });
  else if (el.dataset.tx) S.txWho = Object.assign({}, S.txWho, { [el.dataset.tx]: n });
  else if (el.dataset.sp) { const x = S.spending.find(s => s.id === el.dataset.sp); if (x) x.who = n; }
  save(); render();
  toast(card ? `Card ending ${card} is ${n}'s.` : `Marked as ${n}'s.`);
  sheetUnknownWho();
}

/* ---------- what's behind a total, and changing any of it ----------
   Tapping a line in the weekly box lists every purchase that went into it, with where each number came from.
   Tapping a purchase opens it to change who, what, where, when or how much. */
let spCtx = { cat: 'allfun', who: '', wk: 0 };
// The same purchase as the app would see it without any change made by hand.
function withoutEdits(t, fn) {
  const keepE = S.txEdit, keepW = S.txWho;
  S.txEdit = Object.assign({}, keepE); delete S.txEdit[t.id];
  S.txWho = Object.assign({}, keepW); delete S.txWho[t.id];
  try { return fn(); } finally { S.txEdit = keepE; S.txWho = keepW; }
}
const catLabel = c => (c === 'station' ? 'Gas station (fuel and snacks worked out)' : c === 'none' ? 'Not spending (leave it out)' : CATS[c] ? CATS[c].name : c);
function whoWhy(it) {
  if (it.src === 'bill') return it.p.funWho ? 'set by hand' : 'a bill you both use';
  if (it.src === 'hand') return it.who ? 'entered on their phone' : '';
  const t = it.t;
  if (txEd(t).who || (S.txWho || {})[t.id]) return 'set by hand';
  const q = (S.fuelQ || []).find(q => q.txId === t.id);
  if (q && q.who) return 'answered on the phone';
  const c = cardOf(t.desc);
  return c ? (cardOwner(c) ? `card ending ${c}` : `card ending ${c} isn't known yet`) : 'no card number shown';
}
function whatWhy(it) {
  if (it.src === 'bill') return 'A bill payment that counts as entertainment.';
  if (it.src === 'hand') return 'Entered by hand.';
  const t = it.t, ed = txEd(t);
  if (it.part) {
    const s = it.s, est = s.how === 'set' ? 'set by tapping' : s.how === 'round' ? 'a round amount, so all counted as fuel'
      : `worked out from the ${s.v.name}'s usual driving since its last stop`;
    return `Gas-station charge of ${fm(it.total)}: ${fm(s.fuel)} counted as fuel (${est}), ${fm(s.snacks)} as snacks and drinks.`;
  }
  if (ed.cat) return 'Kind changed by hand.';
  if (labelFor(t) && labelFor(t).cat) return 'Your choice for this store.';
  return 'Sorted by the store name.';
}
function sheetSpendDetail(cat, who, wk) {
  spCtx = { cat: cat || 'allfun', who: who || '', wk: wk || 0 };
  const ws = addDays(weekStart(today()), 7 * spCtx.wk), we = addDays(ws, 7);
  const all = spendItems(ws, we);
  let items = all.items.filter(it => (spCtx.cat === 'allfun' ? FUN_CATS.includes(it.cat) : it.cat === spCtx.cat));
  if (spCtx.who) items = items.filter(it => (it.who || UNKNOWN) === spCtx.who);
  items.sort((a, b) => b.date.localeCompare(a.date) || b.amt - a.amt);
  const total = sum(items.map(i => i.amt));
  const title = (spCtx.cat === 'allfun' ? 'Fun spending' : CATS[spCtx.cat].name) + (spCtx.who ? ` · ${sameName(spCtx.who, me()) ? 'Me' : spCtx.who}` : '');
  const when = spCtx.wk === 0 ? 'This week' : spCtx.wk === -1 ? 'Last week' : 'Week';
  const unsplit = spCtx.cat === 'snacks' || spCtx.cat === 'allfun' ? all.unsplit : [];
  openSheet(`<h3>${esc(title)}</h3>
    <div class="small muted">${when}: ${nice(ws)} to ${nice(addDays(we, -1))}</div>
    <div class="banner" style="margin-top:6px">${items.length} purchase${items.length === 1 ? ' adds' : 's add'} up to <b>${fm(total)}</b>. Tap one to change it.</div>
    ${items.map(it => `<a href="#" class="sp-item" data-act="spEdit" data-src="${it.src}" data-id="${esc(it.id)}" data-due="${it.p ? it.p.due : ''}">
      <div class="sp-line"><b>${esc(it.name)}</b><span class="num"><b>${fm(it.amt)}</b></span></div>
      <div class="small">${nice(it.date)} · ${esc(it.who ? (sameName(it.who, me()) ? 'Me' : it.who) : UNKNOWN)}${whoWhy(it) ? ` <span class="muted">(${esc(whoWhy(it))})</span>` : ''}${spCtx.cat === 'allfun' ? ` · ${CATS[it.cat].name}` : ''}</div>
      <div class="small muted">${esc(whatWhy(it))}${it.t ? ` Bank: "${esc(it.t.desc)}"` : ''}</div></a>`).join('') || '<p class="muted">Nothing here for this week.</p>'}
    ${unsplit.length ? `<p class="small muted">Not counted yet: ${unsplit.length} gas-station purchase${unsplit.length === 1 ? '' : 's'} (${fm(sum(unsplit.map(u => u.amt)))}) waiting to be split into fuel and snacks.</p>` : ''}
    <div class="btns"><button class="btn small ghost" data-act="spWeek" data-wk="${spCtx.wk - 1}">‹ Week before</button>${spCtx.wk < 0 ? `<button class="btn small ghost" data-act="spWeek" data-wk="${spCtx.wk + 1}">Week after ›</button>` : ''}</div>
    <div class="btns"><button class="btn ghost block" data-act="close">Done</button></div>`);
}
const whoOpts = (cur, blank) => `<option value="">${esc(blank)}</option>` + people().map(n => `<option value="${esc(n)}"${sameName(n, cur) ? ' selected' : ''}>${esc(n)}</option>`).join('');
const editBtns = extra => `${extra || ''}<div class="btns"><button type="button" class="btn ghost" data-act="spBack">Back</button><button class="btn">Save</button></div>`;
function sheetPurchaseEdit(src, id, due) {
  if (src === 'tx') {
    const t = S.bank.tx.find(x => x.id === id); if (!t) return;
    const ed = txEd(t), autoWho = withoutEdits(t, () => whoOfTx(t)), cat = txCat(t) || 'none';
    const kinds = ['station', ...Object.keys(CATS), 'none'].filter(k => k !== 'station' || cat === 'station' || storeKind(t.desc) === 'station');
    const edited = Object.keys(ed).length || (S.txWho || {})[t.id];
    openSheet(`<form id="fSpEdit" data-src="tx" data-id="${esc(t.id)}"><h3>Change this purchase</h3>
      <div class="small muted">As the bank shows it: ${nice(t.date)} · ${fm(-t.amount)}</div><div class="small"><b>${esc(t.desc)}</b></div>
      <label for="seWho">Who</label><select id="seWho" name="who">${whoOpts(ed.who || (S.txWho || {})[t.id] || '', autoWho ? `Worked out: ${autoWho}` : UNKNOWN)}</select>
      <label for="seCat">What</label><select id="seCat" name="cat">${kinds.map(k => `<option value="${k}"${k === cat ? ' selected' : ''}>${esc(catLabel(k))}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" name="remember"> Do the same for every purchase the bank shows as "${esc(phraseOf(t.desc))}"</label>
      <label for="seStore">Where</label><input id="seStore" name="store" value="${esc(storeName(t))}">
      <label for="seDate">When</label><input id="seDate" name="date" type="date" value="${txDate(t)}">
      <label for="seAmt">How much${cat === 'station' ? ' (the whole charge)' : ''}</label><input id="seAmt" name="amount" inputmode="decimal" value="${money2(txAmt(t))}">
      ${cat === 'station' ? `<div class="btns"><button type="button" class="btn small ghost" data-act="txWhat" data-id="${esc(t.id)}">Change how much of it was fuel</button></div>` : ''}
      ${editBtns(edited ? `<div class="btns"><button type="button" class="btn small ghost" data-act="spEditReset" data-id="${esc(t.id)}">Undo my changes (go back to what the bank shows)</button></div>` : '')}</form>`);
    return;
  }
  if (src === 'hand') {
    const x = S.spending.find(s => s.id === id); if (!x) return;
    const cat = catKey(x.what) || 'other';
    openSheet(`<form id="fSpEdit" data-src="hand" data-id="${esc(x.id)}"><h3>Change this purchase</h3>
      <div class="small muted">Entered by hand${x.who ? ` by ${esc(x.who)}` : ''}.</div>
      <label for="seWho">Who</label><select id="seWho" name="who">${whoOpts(x.who || '', UNKNOWN)}</select>
      <label for="seCat">What</label><select id="seCat" name="cat">${Object.keys(CATS).map(k => `<option value="${k}"${k === cat ? ' selected' : ''}>${CATS[k].name}</option>`).join('')}</select>
      <label for="seStore">Where</label><input id="seStore" name="store" value="${esc(x.note || '')}">
      <label for="seDate">When</label><input id="seDate" name="date" type="date" value="${x.date}">
      <label for="seAmt">How much</label><input id="seAmt" name="amount" inputmode="decimal" value="${money2(x.amount)}">
      ${editBtns()}</form>`);
    return;
  }
  if (src === 'bill') {
    const b = findB(id), p = b && S.payments.find(p => p.billId === id && p.due === due); if (!p) return;
    openSheet(`<form id="fSpEdit" data-src="bill" data-id="${esc(id)}" data-due="${esc(due)}"><h3>${esc(b.name)}</h3>
      <div class="small muted">Bill payment, ${nice(p.paidOn || p.due)} · ${fm(p.amount)}. The amount and date are changed in the bill itself.</div>
      <label for="seWho">Who it's for</label><select id="seWho" name="who">${whoOpts(p.funWho || '', SHARED_BILLS + ' (you both use it)')}</select>
      <label class="check"><input type="checkbox" name="fun"${billIsFun(b) ? ' checked' : ''}> Counts as entertainment</label>
      ${editBtns()}</form>`);
  }
}
function spendEditSave(f) {
  const fd = new FormData(f), src = f.dataset.src, id = f.dataset.id;
  const amount = Math.round(num(fd.get('amount')) * 100) / 100;
  if (src !== 'bill' && !(amount > 0)) { formError(f, 'Enter how much it was, for example 12.50.', 'amount'); return; }
  if (src === 'tx') {
    const t = S.bank.tx.find(x => x.id === id); if (!t) return;
    const ed = Object.assign({}, txEd(t)), cat = fd.get('cat'), store = String(fd.get('store') || '').trim(), date = fd.get('date');
    const auto = withoutEdits(t, () => ({ cat: txCat(t) || 'none', store: storeName(t) }));
    if (fd.get('who')) ed.who = fd.get('who'); else delete ed.who;
    if (S.txWho && S.txWho[t.id]) { S.txWho = Object.assign({}, S.txWho); delete S.txWho[t.id]; }
    if (fd.get('remember') === 'on') {
      const phrase = phraseOf(t.desc), old = (S.bank.labels || []).find(l => l.words === phrase) || {};
      const lab = cat === 'none' ? { words: phrase, name: old.name || '', ignore: true } : { words: phrase, name: old.name || '', cat: cat === 'station' ? 'station' : CATS[cat].name };
      S.bank.labels = (S.bank.labels || []).filter(l => l.words !== phrase).concat([lab]);
      delete ed.cat;
    } else if (cat === auto.cat) delete ed.cat; else ed.cat = cat;
    if (!store || store === auto.store) delete ed.store; else ed.store = store;
    if (!date || date === t.date) delete ed.date; else ed.date = date;
    if (Math.abs(amount + t.amount) < 0.005) delete ed.amount; else ed.amount = amount;
    S.txEdit = Object.assign({}, S.txEdit, { [t.id]: ed });
    if (!Object.keys(ed).length) delete S.txEdit[t.id];
  } else if (src === 'hand') {
    const x = S.spending.find(s => s.id === id); if (!x) return;
    if (x.adjusted && amount !== x.amount) S.balances.checking = (S.balances.checking || 0) + x.amount - amount;
    Object.assign(x, { who: fd.get('who') || null, what: CATS[fd.get('cat')].name, note: String(fd.get('store') || '').trim(), date: fd.get('date') || x.date, amount });
  } else {
    const b = findB(id), p = b && S.payments.find(p => p.billId === id && p.due === f.dataset.due); if (!p) return;
    if (fd.get('who')) p.funWho = fd.get('who'); else delete p.funWho;
    const fun = fd.get('fun') === 'on'; if (fun !== billIsFun(b)) b.fun = fun;
  }
  save(); render(); toast('Saved.');
  sheetSpendDetail(spCtx.cat, spCtx.who, spCtx.wk);
}

/* ---------- one-time setup note ----------
   Settings prepared for the household (for example vehicles and cards) can be left in the sync storage. The first
   phone that opens the app picks them up (the note is deleted at that moment) and adds them; sharing then gives
   them to the other phone too. Existing entries with the same name aren't duplicated. */
async function checkInbox() {
  const cfg = syncCfg(); if (!cfg || !S) return false;
  const k = await syncKeys(cfg);
  const r = await api('GET', `/v1/h/${cfg.id}/inbox`, k.token);
  if (r.status !== 200 || !r.j || !r.j.data) return false;
  let d; try { d = JSON.parse(r.j.data); } catch (e) { return false; }
  const added = [];
  for (const v of (Array.isArray(d.vehicles) ? d.vehicles : [])) {
    if (!v || !v.name) continue;
    const o = { name: String(v.name), driver: v.driver || null, mpgLow: Number(v.mpgLow) || 18, mpgHigh: Number(v.mpgHigh) || 20, tank: Number(v.tank) || 20, milesPerDay: Number(v.milesPerDay) || 30 };
    const same = vehicles().find(x => sameName(x.name, o.name));
    if (same) Object.assign(same, o); else S.vehicles = vehicles().concat([Object.assign({ id: uid() }, o)]);
    added.push(o.name);
  }
  if (d.cards && typeof d.cards === 'object') S.cards = Object.assign({}, S.cards, d.cards);
  if (added.length && !S.fuelSince) S.fuelSince = addDays(today(), -7);
  if (d.limits && typeof d.limits === 'object') S.limits = Object.assign({}, S.limits, d.limits);
  spendScan(); save(); render();
  if (added.length) toast(`Added: ${added.join(' and ')}. Gas-station purchases are now split automatically.`);
  return true;
}

/* ---------- buttons and forms (the app passes these on) ---------- */
function spendAct(act, el) {
  const q = el.dataset.id && (S.fuelQ || []).find(x => x.id === el.dataset.id);
  switch (act) {
    case 'whoSet': if (q) whoSet(q, el.dataset.name); return true;
    case 'whoUnknown': sheetUnknownWho(); return true;
    case 'whoAssign': whoAssign(el); return true;
    case 'spDetail': sheetSpendDetail(el.dataset.cat, el.dataset.who, 0); return true;
    case 'spWeek': sheetSpendDetail(spCtx.cat, spCtx.who, Number(el.dataset.wk) || 0); return true;
    case 'spEdit': sheetPurchaseEdit(el.dataset.src, el.dataset.id, el.dataset.due); return true;
    case 'spBack': sheetSpendDetail(spCtx.cat, spCtx.who, spCtx.wk); return true;
    case 'spEditReset': { const id = el.dataset.id; S.txEdit = Object.assign({}, S.txEdit); delete S.txEdit[id]; if (S.txWho && S.txWho[id]) { S.txWho = Object.assign({}, S.txWho); delete S.txWho[id]; } save(); render(); toast('Back to what the bank shows.'); sheetSpendDetail(spCtx.cat, spCtx.who, spCtx.wk); return true; }
    case 'whoShared': if (q) { S.cards = Object.assign({}, S.cards, { [q.card]: SHARED }); save(); sheetWho(q); } return true;
    case 'fqUnknown': if (q) fqUnknown(q); return true;
    case 'fqUnknownYes': if (q) fqUnknownYes(q); return true;
    case 'fqBack': if (q) sheetWho(q); return true;
    case 'fixFuel': if (q) { q.override = el.dataset.v === '' ? null : Number(el.dataset.v); if (q.override == null) delete q.override; save(); closeSheet(); render(); toast('Updated.'); } return true;
    case 'fixOther': { const t = S.bank.tx.find(x => x.id === el.dataset.id); closeSheet(); if (t) sheetTxWhat(t); return true; }
    case 'flagSeen': { const x = (S.fuelFlags || []).find(f => f.id === el.dataset.id); if (x) { x.seenBy = [...new Set([...(x.seenBy || []), me() || '?'])]; save(); render(); } return true; }
    case 'spLimits': sheetLimits(); return true;
    case 'spVehicle': sheetVehicle(el.dataset.id ? findV(el.dataset.id) : null); return true;
    case 'spVehicleDel': S.vehicles = vehicles().filter(v => v.id !== el.dataset.id); save(); closeSheet(); render(); return true;
    case 'spCard': sheetCard(el.dataset.id); return true;
    case 'spCardSet': { const c = el.dataset.id, n = el.dataset.name; S.cards = Object.assign({}, S.cards, { [c]: n }); save(); closeSheet(); render(); toast(n === SHARED ? `Card ending ${c}: you both use it.` : `Card ending ${c} is now ${n}'s.`); return true; }
  }
  return false;
}
function spendSubmit(f) {
  const fd = new FormData(f);
  if (f.id === 'fSpEdit') { spendEditSave(f); return true; }
  if (f.id === 'fLimits') { S.limits = Object.fromEntries(FUN_CATS.map(c => [c, num(fd.get(c)) || 0])); save(); closeSheet(); render(); toast('Weekly limits saved.'); return true; }
  if (f.id === 'fVehicle') {
    const name = String(fd.get('name') || '').trim(); if (!name) { formError(f, 'Give the vehicle a name.', 'name'); return true; }
    const lo = num(fd.get('mpgLow')), hi = num(fd.get('mpgHigh')), tank = num(fd.get('tank')), mpd = num(fd.get('milesPerDay'));
    if (!(mpd > 0)) { formError(f, 'Enter a rough guess of the miles driven on a usual day (for example 40).', 'milesPerDay'); return true; }
    if (!(lo > 3 && hi >= lo)) { formError(f, 'Enter the miles per gallon, low and high (for example 18 and 20).', 'mpgLow'); return true; }
    if (!(tank > 3)) { formError(f, 'Enter the fuel tank size in gallons.', 'tank'); return true; }
    const o = { name, driver: fd.get('driver') || null, mpgLow: lo, mpgHigh: hi, tank, milesPerDay: mpd };
    S.vehicles = vehicles();
    if (f.dataset.id) Object.assign(findV(f.dataset.id), o); else S.vehicles = S.vehicles.concat([Object.assign({ id: uid() }, o)]);
    if (!S.fuelSince) S.fuelSince = addDays(today(), -7); // the past week's gas-station purchases are split too
    spendScan(); save(); closeSheet(); render(); toast('Vehicle saved.'); return true;
  }
  return false;
}
