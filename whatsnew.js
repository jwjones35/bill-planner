'use strict';
/* Bill Planner: what changed in each version, newest first.
   Shown once in a "What's new" pop-up the first time the app opens after an update, and under More › What's new.
   Every release adds an entry here, in plain words: added, changed, fixed, removed. */
const CHANGELOG = [
  {
    v: '2.0.0', date: '2026-10-31',
    added: ['Spending watch: every purchase is sorted (groceries, fuel, eating out, snacks and drinks, alcohol, entertainment, household).',
      'Weekly limits for eating out, snacks and drinks, alcohol and entertainment, with a meter on Home. Both phones get a notification at 75% and when a limit is passed, plus a report on Sunday evening.',
      'Cards are remembered: purchases on a known card show whose card it is, and totals are split per person. Set them under More › Spending watch.',
      'Gas-station questions: who made the purchase and exactly how much was fuel (gallons, cost, odometer). The rest counts as snacks and drinks.',
      'The question goes to the right phone by itself ("Not me" sends it to the other person), reminds every 2 hours until it\'s answered, and can\'t be closed or skipped.',
      'Fuel check: answers are checked against the tank size, recent prices per gallon, and the miles driven at each vehicle\'s miles per gallon. Anything that doesn\'t add up alerts both phones.',
      'A notice when the other person\'s phone isn\'t getting notifications.'],
    changed: ['To turn on the gas-station questions, add your vehicles under More › Spending watch.']
  },
  {
    v: '1.9.4', date: '2026-10-31',
    removed: ['The "everyday spending" estimate. Food, gas and fun are no longer guessed anywhere; what you really spend still lowers your balance as it happens.'],
    changed: ['Paydays: a week where one paycheck is less than that week\'s bills now says "Covered by your cushion" in grey instead of a red "Short by". Red only appears if the cushion itself would run out ("Not enough").',
      '"Expected cushion" is now "Cushion after this payday": checking plus everyone\'s paychecks, minus bills.',
      'The status at the top of Home warns if any of the next few paydays would run short.']
  },
  {
    v: '1.9.3', date: '2026-10-31',
    changed: ['A comic-book look everywhere: bold ink outlines, solid drop shadows, shading with a hard edge, and halftone dots in the shadows.',
      'Buttons press down into their shadow when tapped.',
      'The big money number has an inked drop shadow.'],
    removed: ['The green edge that was only on the "Available to spend" panel. Every panel is drawn the same way now.']
  },
  {
    v: '1.9.2', date: '2026-10-31',
    added: ['This "What\'s new" pop-up. It shows once after each update, and the full list is under More › What\'s new.']
  },
  {
    v: '1.9.1', date: '2026-10-31',
    changed: ['Richer, deeper colors: deep indigo in dark mode, warm paper in light mode, and jewel-toned teal, green, red and gold.',
      'The main money panel has a colored edge, and buttons have a little depth.']
  },
  {
    v: '1.9.0', date: '2026-10-31',
    added: ['A one-line status at the top of Home: green (on track), amber (tight) or red (short, or a bill is past due).',
      'Phone notifications (More › Phone notifications): the day before a bill is due, when a bill becomes past due, and when an autopay charge hasn\'t come out.'],
    changed: ['Home is tidier: status, then the money, then "Needs your attention", then "Coming up". Everything else is folded away under More.']
  },
  {
    v: '1.8.0', date: '2026-10-31',
    added: ['"Paid automatically (autopay)" setting for bills. After the due date, autopay bills wait for the bank instead of showing as past due.',
      'If an autopay charge still hasn\'t come out after 3 business days, a warning with "Remind me in X days" and "Keep waiting".']
  },
  {
    v: '1.7.1', date: '2026-10-31',
    changed: ['Stopping sharing now needs the word STOP typed (or DELETE, to stop it for every phone), so it can\'t happen by accident.']
  },
  {
    v: '1.7.0', date: '2026-10-31',
    added: ['Share the app between phones (More › Share with another phone). Changes show up on both phones by themselves.',
      'Join another phone\'s app with a one-time 8-letter code.']
  },
  {
    v: '1.6.1', date: '2026-10-31',
    added: ['Profile: each phone knows whose it is, so your own paychecks show as "Me" and everyone else\'s by name.']
  },
  {
    v: '1.6.0', date: '2026-10-31',
    fixed: ['Twelve problems found by a 6-month test run, including weekly bills counted twice, overdue bills disappearing after 60 days, and price changes not being recognized.'],
    added: ['A "Price change" notice when a bill starts charging a different amount.',
      '"Which bank charge was it?" when a payment you marked paid hasn\'t been matched.']
  },
  {
    v: '1.5.7', date: '2026-10-31',
    added: ['"One time only" bills.']
  },
  {
    v: '1.5.6', date: '2026-10-31',
    added: ['A red "past due" box on Home and a count on the Home tab.',
      'A notice when a bill you marked paid isn\'t showing at the bank yet.']
  }
];

const SEEN_KEY = 'billplanner.seenVersion';
const vNum = v => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
function whatsNewHtml(entries) {
  const part = (label, cls, items) => items && items.length ? `<div class="wn-part"><span class="wn-tag ${cls}">${label}</span><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` : '';
  return entries.map(e => `<div class="wn-ver"><div class="wn-head"><b>Version ${e.v}</b><span class="muted small">${nice(e.date)}</span></div>
    ${part('New', 'wn-new', e.added)}${part('Changed', 'wn-chg', e.changed)}${part('Fixed', 'wn-fix', e.fixed)}${part('Removed', 'wn-rem', e.removed)}</div>`).join('');
}
// Right after an update: show what changed since the version this phone last ran. Returns true if shown.
function showWhatsNewIfUpdated() {
  let seen = null; try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { }
  try { localStorage.setItem(SEEN_KEY, APP_VERSION); } catch (e) { }
  if (!S) return false;                     // a brand-new install has nothing to compare with
  if (seen === APP_VERSION) return false;
  const since = seen ? vNum(seen) : vNum('1.9.1'); // phones from before this pop-up existed were on 1.9.1
  const entries = CHANGELOG.filter(e => vNum(e.v) > since && vNum(e.v) <= vNum(APP_VERSION));
  if (!entries.length) return false;
  openSheet(`<div class="wn-splash"><div class="wn-badge">Updated</div>
    <h3>Bill Planner is now version ${APP_VERSION}</h3>
    <p class="muted" style="margin-top:2px">Here's what changed${entries.length > 1 ? ` since version ${esc(seen || '1.9.1')}` : ''}:</p></div>
    ${whatsNewHtml(entries)}
    <div class="btns"><button class="btn block" data-act="close">Got it</button></div>
    <p class="hint" style="text-align:center">See every version any time under More › What's new.</p>`);
  return true;
}
function sheetWhatsNew() {
  openSheet(`<h3>What's new</h3><p class="hint" style="margin-top:0">You're on version ${APP_VERSION}.</p>${whatsNewHtml(CHANGELOG)}
    <div class="btns"><button class="btn block" data-act="close">Done</button></div>`);
}
