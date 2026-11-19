CREATE TABLE IF NOT EXISTS asset_ids (
  only     INTEGER PRIMARY KEY CHECK (only = 1),
  last_seq INTEGER NOT NULL                 -- the global short-ID sequence; never goes back
);
