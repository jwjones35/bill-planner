CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  auth TEXT NOT NULL,
  ver INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL
);
-- One-time codes for adding a phone: the encrypted household key, gone after one use or 15 minutes.
CREATE TABLE IF NOT EXISTS pairs (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
);
