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
-- One-time codes for adding a phone: the encrypted household key, gone after one use or 15 minutes.
CREATE TABLE IF NOT EXISTS pairs (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
);
