CREATE TABLE IF NOT EXISTS asset_key_mismatches (
  run_id           INTEGER NOT NULL,
  key_id           TEXT NOT NULL,
  definitions_hash TEXT NOT NULL,
  PRIMARY KEY(run_id,key_id,definitions_hash)
);
