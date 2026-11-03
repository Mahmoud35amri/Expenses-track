-- Spendly sync database (Cloudflare D1). Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS vaults (
  vault      TEXT PRIMARY KEY,          -- SHA-256 of the device sync key (the key itself is never stored)
  rev        INTEGER NOT NULL DEFAULT 0, -- last revision number handed out for this vault
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  vault      TEXT    NOT NULL,
  kind       TEXT    NOT NULL,          -- expense | category | settings
  id         TEXT    NOT NULL,
  data       TEXT,                      -- JSON payload, NULL when deleted
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,          -- client edit time (ms), used for last-write-wins
  rev        INTEGER NOT NULL,          -- server revision, used as the pull cursor
  PRIMARY KEY (vault, kind, id)
);

CREATE INDEX IF NOT EXISTS records_by_rev ON records (vault, rev);
