CREATE TABLE IF NOT EXISTS accounts (
  operator_id   TEXT PRIMARY KEY,          -- 1..4 letters or digits (requested_by pattern)
  admin         INTEGER NOT NULL,          -- 1 admin, 0 operator
  password_hash TEXT NOT NULL              -- 'scrypt$N$r$p$<salt b64>$<hash b64>'
);
