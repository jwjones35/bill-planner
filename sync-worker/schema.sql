CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  auth TEXT NOT NULL,
  ver INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL
);
-- Phones that want notifications (their push address and keys), per household.
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  household TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created INTEGER NOT NULL,
  who TEXT
);
-- Each household's upcoming reminders: times plus text the phones encrypted (the storage can't read it).
CREATE TABLE IF NOT EXISTS sched (
  household TEXT PRIMARY KEY,
  items TEXT NOT NULL,
  updated INTEGER NOT NULL
);
-- Today's typical unleaded price near home (public prices from Google; no personal data).
CREATE TABLE IF NOT EXISTS prices (
  area TEXT PRIMARY KEY,
  price REAL,
  low REAL,
  high REAL,
  stations INTEGER,
  at INTEGER NOT NULL,
  source TEXT,
  period TEXT
);
-- A one-time setup note for a household (for example vehicles), written only by the owner with Wrangler.
-- The app reads it once and it's deleted at that moment.
CREATE TABLE IF NOT EXISTS inbox (
  household TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  at INTEGER NOT NULL
);
-- Around-the-clock bank check. access: the household's read-only SimpleFIN key (it can only read balances,
-- never move money). broken/fixed: the two notifications, encrypted by the phones (the storage can't read them).
-- state: 'ok', 'broken' or 'unknown'; strikes: errors in a row that don't clearly need a sign-in.
-- No balances or transactions are kept here.
CREATE TABLE IF NOT EXISTS bankwatch (
  household TEXT PRIMARY KEY,
  access TEXT NOT NULL,
  broken TEXT NOT NULL,
  fixed TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unknown',
  strikes INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  changed INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL,
  -- While broken, the "sign in again" notification repeats every hour (7 AM to 10 PM home time) to each phone
  -- that hasn't acknowledged it. acked: hashes of the phones that did; tz: the phones' minutes behind UTC.
  acked TEXT NOT NULL DEFAULT '[]',
  nagged INTEGER NOT NULL DEFAULT 0,
  tz INTEGER NOT NULL DEFAULT 360
);
-- One-time codes for adding a phone: the encrypted household key, gone after one use or 15 minutes.
CREATE TABLE IF NOT EXISTS pairs (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
);

-- Automatic backups: the last copy saved on each day (home time), still encrypted so the storage can't read it.
-- Only the newest 8 days are kept per household; older ones are deleted whenever a new copy is saved.
CREATE TABLE IF NOT EXISTS snaps (
  household TEXT NOT NULL,
  day TEXT NOT NULL,
  data TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (household, day)
);

-- Live balance (Plaid). token: the household's Plaid access token (read-only balances; it can never move money).
-- It never leaves the storage. cache: the last answer, reused for 30 seconds; last: when it was asked.
CREATE TABLE IF NOT EXISTS plaid (
  household TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  item TEXT,
  institution TEXT,
  created INTEGER NOT NULL,
  last INTEGER NOT NULL DEFAULT 0,
  cache TEXT
);

-- Recent purchases from Plaid, kept for 2 minutes so both phones share one answer.
CREATE TABLE IF NOT EXISTS plaidtx (
  household TEXT PRIMARY KEY,
  last INTEGER NOT NULL DEFAULT 0,
  cache TEXT
);
