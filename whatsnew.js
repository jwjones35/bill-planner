'use strict';
/* Bill Planner: what changed in each version, newest first.
   Shown once in a "What's new" pop-up the first time the app opens after an update, and under More › What's new.
   Every release adds an entry here, in plain words: added, changed, fixed, removed. */
const CHANGELOG = [
  {
    v: '2.7.0', date: '2026-11-05',
    fixed: [
      'The app kept saying the bank was disconnected when it wasn\'t. Any small hiccup (a moment without internet, SimpleFIN being busy) was treated as a broken connection. Now those are retried quietly by the app, and you only get asked to fix something when SimpleFIN really needs you: to sign in to the bank again, a new setup token, or a payment. Each one says plainly what happened and what to do.',
      'The app now checks SimpleFIN less often (every 3 hours, shared by both phones). SimpleFIN only gets new numbers from the bank about once a day, and it turns an app\'s key off if the app checks too often. That would force a full reconnect.',
      'When you open the app, "Available to spend" says "Updating..." until today\'s balance arrives, instead of showing an old number for a moment.',
      'When the live balance is working, a SimpleFIN sign-in problem no longer blocks the screen or sends hourly reminders, because your balance is still right.'
    ]
  },
  {
    v: '2.6.1', date: '2026-11-02',
    fixed: ['"Just in" purchases didn\'t show, because Plaid only updated its list of purchases now and then (it was 3 days behind). The app now asks Plaid to check the bank for new purchases (at most every 15 minutes), and checks for them every 2 minutes while it\'s open.']
  },
  {
    v: '2.6.0', date: '2026-11-02',
    added: ['"Spending since..." on Home now shows purchases made today, straight from the bank through the live balance connection (marked "Just in"). Before, they only showed once SimpleFIN listed them, usually the next day, even though the balance already had them taken out. When SimpleFIN catches up, the full entry replaces the "Just in" one, so nothing is counted twice.']
  },
  {
    v: '2.5.0', date: '2026-11-01',
    added: ['On the bill form, under "How the bank shows it", the app now lists charges from your bank that look like the bill (the same amount, or a word from its name). Tap one to fill it in, tap it again to take it out. "See every charge from the last 35 days" shows the rest. No more copying from the bank\'s app.']
  },
  {
    v: '2.4.0', date: '2026-11-01',
    added: [
      'Live balance: under More › Bank connection you can connect your bank through Plaid as well. Then the app gets the balance straight from the bank every time it opens, and when you tap "Update now", instead of waiting for SimpleFIN\'s once-a-day copy. Both phones share it; connect it once, from one phone.',
      'If the live balance stops working (for example the bank wants you to sign in again), the app says so and has a "Sign in again" button. Until then it uses SimpleFIN\'s balance, with the age warning.'
    ]
  },
  {
    v: '2.3.1', date: '2026-11-01',
    added: [
      'Under "Available to spend" the app now always says when the bank\'s balance is from, for example "as of today at 11:43 AM (6 hours ago)". The bank connection only gets new numbers from the bank now and then, so anything spent since that time isn\'t included yet.',
      'When the balance is more than 3 hours old, an orange warning says to check the bank\'s own app before spending, with a button to enter today\'s balance.'
    ],
    changed: ['"Update now" now says plainly whether the bank sent anything new, instead of "Updated a moment ago already".']
  },
  {
    v: '2.3.0', date: '2026-11-01',
    added: [
      'When the bank disconnects, the notification now repeats every hour on each phone until that phone acknowledges it (no repeats between 10 PM and 7 AM). Tapping the notification counts as acknowledging it, and opens the fix steps.',
      'A pop-up in the app that can\'t be closed or swiped away until you tap "Fix it now" or "I understand, fix it later". It shows on every phone, once for each time the bank disconnects.'
    ]
  },
  {
    v: '2.2.9', date: '2026-11-01',
    added: ['The bank connection is now checked around the clock, even when the app is closed on both phones. If it stops working, both phones get a notification: tap it and the app opens straight to the fix. When it works again, you get a "working again" notification.'],
    changed: ['To do this, your sync storage keeps a copy of the read-only SimpleFIN key. It can only read balances, never move money, and the storage keeps no balances or transactions. Disconnecting the bank under More turns the around-the-clock check off.']
  },
  {
    v: '2.2.8', date: '2026-11-01',
    added: ['A big red warning at the top of Home whenever the bank connection stops working or the bank hasn\'t sent anything new for more than a day. While it\'s showing, "Available to spend" is marked NOT CURRENT, so an old number is never mistaken for today\'s.', 'A "Fix the connection" button on that warning. It walks you through reconnecting on SimpleFIN one step at a time, and checks the connection by itself when you come back to the app.']
  },
  {
    v: '2.2.7', date: '2026-11-01',
    changed: ['A new app icon in the comic colors: a calendar page with a teal dollar sign on dark purple. (The icon already on your Home Screen stays the old one. That\'s normal for iPhone, and nothing else changes.)']
  },
  {
    v: '2.2.6', date: '2026-11-01',
    fixed: ['A gas-station purchase on a card the app didn\'t know yet was counted against the first vehicle. That used up its fuel, so its owner\'s next stop looked like snacks. Now each purchase only counts for the vehicle of whoever\'s card it was. One on an unknown card waits on Home ("tap to say whose") and is split once you tap a name.']
  },
  {
    v: '2.2.5', date: '2026-11-01',
    added: [
      'On Home, tap any line in the fun-spending box (Eating out, Snacks & drinks, Alcohol, Entertainment, or a name) to see every purchase behind that total, and where each number came from.',
      'Tap a purchase in that list to change who, what, where, when or how much. "Undo my changes" puts it back to what the bank shows. Changes show on both phones.',
      'Gas-station purchases show how much was counted as fuel and how much as snacks, and why.'
    ]
  },
  {
    v: '2.2.4', date: '2026-11-01',
    added: ['On Home, "Not known yet" in the fun-spending box can now be tapped. It lists each purchase the app could not match to a person, and one tap on a name sorts it. Tapping a name for a card remembers that card for every purchase after it.'],
    fixed: ['Streaming and game bills (Netflix, Blizzard and the like) used to count as "Not known yet". They now show as "Shared bills", because you both use them.']
  },
  {
    v: '2.2.3', date: '2026-11-01',
    fixed: ['Gas-station purchases from before the vehicles were added showed as "not split yet" with a message to add vehicles. Every gas-station purchase the bank shows is now split into fuel and snacks.']
  },
  {
    v: '2.2.2', date: '2026-10-31',
    added: ['Streaming bills (Netflix, Disney+, Hulu, Spotify and the like) now count toward the weekly entertainment limit. They\'re still bills for "Available to spend".',
      'Each bill has a "Counts as entertainment" switch. Amazon Prime is off, since it\'s mostly used for household shopping.',
      'Anything from Blizzard (Battle.net, World of Warcraft, Activision) counts as entertainment.']
  },
  {
    v: '2.2.1', date: '2026-10-31',
    added: ['Settings can be prepared for you and picked up by the app automatically, such as your two vehicles with their miles a day worked out from your usual drives.']
  },
  {
    v: '2.2.0', date: '2026-10-31',
    changed: ['Gas-station purchases are now split into fuel and snacks automatically, with no typing.',
      'A round-dollar charge ($20.00, $30.00) counts as fuel paid at the counter. Other amounts count as fuel up to what that vehicle has burned since its last stop (its usual miles a day, its miles per gallon and the current gas price); the rest counts as snacks and drinks.',
      'The only question left is a one-tap "Whose card is this?" the first time a new card is used.',
      'If a split looks wrong, tap the purchase on Home and pick how much was fuel (one tap).'],
    removed: ['The "How much was fuel?" question, the fuel-cost box, and the reminders to answer it.',
      'Gallons, odometer and "filled the tank" entries.']
  },
  {
    v: '2.1.1', date: '2026-10-31',
    changed: ['The gas price now comes from the U.S. government\'s free weekly average for Oklahoma\'s and Arkansas\'s regions, so no card or sign-up with Google is needed.']
  },
  {
    v: '2.1.0', date: '2026-10-31',
    added: ['The current unleaded gas price is looked up automatically (the U.S. government\'s weekly average for Oklahoma\'s and Arkansas\'s regions). See it under More › Spending watch.',
      'Each vehicle has a "miles driven on a usual day" guess, used to check that the fuel bought over 4 weeks matches the driving.'],
    changed: ['The gas-station question only needs the fuel cost now. Gallons are worked out from the local price, and gallons and the odometer are optional.',
      'An odometer reading entered now and then replaces the miles-a-day guess with the real miles.'],
    removed: ['Having to type the gallons and the odometer every time.']
  },
  {
    v: '2.0.1', date: '2026-10-31',
    added: ['If notifications aren\'t on for this phone, a pop-up offers a one-button setup each time the app opens.',
      'If they were turned off in iPhone Settings, the pop-up says exactly where to turn them back on.',
      'When one person\'s phone has notifications off, the other person gets a notification about it (once a day).']
  },
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
