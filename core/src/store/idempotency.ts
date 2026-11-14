import { createHash } from "node:crypto";
import type { ReadTx, TableDef, Tx } from "./db.ts";

export const TABLES: TableDef[] = [
  {
    owner: "shared",
    name: "idempotency_keys",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  run_id      INTEGER NOT NULL,
  scope       TEXT    NOT NULL,   -- who: 'account:<operator_id>', 'asset_key:<key_id>', 'gateway:<id>', 'plugin:<id>', 'login:<operator_id>'
  key         TEXT    NOT NULL,   -- the Idempotency-Key header, 1..64 characters
  fingerprint TEXT    NOT NULL,   -- see fingerprint()
  status      INTEGER NOT NULL,
  response    TEXT    NOT NULL,   -- JSON body; for secret_once routes, the non-secret acknowledgment
  PRIMARY KEY (run_id, scope, key)
);`,
  },
];

export type Retained = { status: number; body: unknown };

export function fingerprint(parts: {
  method: string;
  route: string;
  params: Record<string, string>;
  query: string;
  body: Uint8Array | { fileSha256: string } | { operator_id: string };
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...parts,
        body:
          parts.body instanceof Uint8Array
            ? Buffer.from(parts.body).toString("base64")
            : parts.body,
      }),
    )
    .digest("hex");
}

export type Lookup =
  | { found: false }
  | { found: true; same: true; retained: Retained }
  | { found: true; same: false }; // → 409 idempotency_conflict, no effect

export function lookup(
  tx: ReadTx,
  scope: string,
  key: string,
  fp: string,
): Lookup {
  const row = tx.get<{ fingerprint: string; status: number; response: string }>(
    "SELECT * FROM idempotency_keys WHERE run_id=? AND scope=? AND key=?",
    tx.runId,
    scope,
    key,
  );
  return !row
    ? { found: false }
    : row.fingerprint !== fp
      ? { found: true, same: false }
      : {
          found: true,
          same: true,
          retained: { status: row.status, body: JSON.parse(row.response) },
        };
}

export function retain(
  tx: Tx,
  scope: string,
  key: string,
  fp: string,
  r: Retained,
): void {
  tx.run(
    "INSERT INTO idempotency_keys VALUES (?,?,?,?,?,?)",
    tx.runId,
    scope,
    key,
    fp,
    r.status,
    JSON.stringify(r.body),
  );
}
