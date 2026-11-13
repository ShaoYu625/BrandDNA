-- Merchant accounts: one food truck = one account (store name, username, password).
-- The Worker also creates these tables on first use, so applying this migration is optional.
CREATE TABLE IF NOT EXISTS truck_accounts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  flagship INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS truck_account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS truck_account_sessions_account ON truck_account_sessions (account_id);
