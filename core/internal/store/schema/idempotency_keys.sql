CREATE TABLE IF NOT EXISTS idempotency_keys (
  run_id      INTEGER NOT NULL,
  scope       TEXT    NOT NULL,   -- who: 'account:<operator_id>', 'asset_key:<key_id>', 'gateway:<id>', 'plugin:<id>', 'login'
  key         TEXT    NOT NULL,   -- the Idempotency-Key header, 1..64 characters
  fingerprint TEXT    NOT NULL,   -- ordinary request digest or salted credential-request hash
  status      INTEGER NOT NULL,
  response    TEXT    NOT NULL,   -- JSON body; for secret_once routes, the non-secret acknowledgment
  PRIMARY KEY (run_id, scope, key)
);
