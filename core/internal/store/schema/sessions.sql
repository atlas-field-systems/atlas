CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  run_id      INTEGER NOT NULL,            -- a session ends with its run; a crash ends none
  operator_id TEXT NOT NULL REFERENCES accounts(operator_id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  ended       INTEGER NOT NULL DEFAULT 0
);
