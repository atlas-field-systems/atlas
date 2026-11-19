CREATE TABLE IF NOT EXISTS assets (
  run_id      INTEGER NOT NULL,
  asset_id    TEXT    NOT NULL,
  key_id      TEXT,                        -- the Asset key that registered it (Asset on IP)
  gateway_id  TEXT,                        -- the gateway carrying it (radio Asset); requested_by of its registration
  description TEXT,                        -- latest description record; NULL for a radio not yet signed up
  contact     TEXT    NOT NULL,            -- contact record as of its last change
  removed     INTEGER NOT NULL DEFAULT 0,  -- kept, not listed (storage.md)
  PRIMARY KEY (run_id, asset_id)
);
-- "A key registers at most one Asset at a time" (api.md)
CREATE UNIQUE INDEX IF NOT EXISTS assets_key ON assets(run_id, key_id) WHERE key_id IS NOT NULL AND removed = 0;
CREATE INDEX IF NOT EXISTS assets_gateway ON assets(run_id, gateway_id) WHERE gateway_id IS NOT NULL;
