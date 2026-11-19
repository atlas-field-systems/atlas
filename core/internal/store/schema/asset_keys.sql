CREATE TABLE IF NOT EXISTS asset_keys (
  key_id   TEXT PRIMARY KEY,               -- from the global short-ID sequence
  key_hash TEXT NOT NULL UNIQUE
);
