CREATE TABLE IF NOT EXISTS plugins (
  plugin_id      TEXT PRIMARY KEY,
  key_hash       TEXT UNIQUE,
  removed        INTEGER NOT NULL DEFAULT 0,
  description    TEXT,                     -- latest plugin.description; carried over runs ("installed Plugin setup")
  contact_run_id INTEGER,
  contact        TEXT
);
