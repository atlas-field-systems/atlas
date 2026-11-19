CREATE TABLE IF NOT EXISTS gateways (
  gateway_id     TEXT PRIMARY KEY,         -- from the global short-ID sequence, never reused
  key_hash       TEXT UNIQUE,
  removed        INTEGER NOT NULL DEFAULT 0,
  contact_run_id INTEGER,                  -- contact belongs to a run: any other run reads as offline,
  contact        TEXT                      -- so a new run starts every gateway offline without a clear
);
