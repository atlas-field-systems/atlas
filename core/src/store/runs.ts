import { readdirSync, unlinkSync } from "node:fs";
import { encodeShortId, SHORT_ID_CAPACITY } from "../ids.ts";
import type { Store, TableDef, Tx } from "./db.ts";
import type { Env } from "../core.ts";

export const TABLES: TableDef[] = [
  {
    owner: "shared",
    name: "runs",
    runScoped: false,
    ddl: `
CREATE TABLE IF NOT EXISTS runs (
  run_id     INTEGER PRIMARY KEY,           -- MAX+1; rows are never deleted, so a run_id is never reused
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,                       -- NULL: running, or stopped unexpectedly
  outcome    TEXT CHECK (outcome IN ('archived', 'archive_failed')),
  zip_name   TEXT,
  resumes    TEXT NOT NULL DEFAULT '[]',    -- JSON [{last_sign_of_life, resumed_at}], one per unexpected stop
  last_track_seq      INTEGER NOT NULL DEFAULT 0,   -- per-run ID counters (ids.ts): survive deletes,
  last_geofeature_seq INTEGER NOT NULL DEFAULT 0,   -- start again next run
  last_object_seq     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS single_open_run ON runs((1)) WHERE ended_at IS NULL;`,
  },
  {
    owner: "shared",
    name: "asset_ids",
    runScoped: false,
    ddl: `
CREATE TABLE IF NOT EXISTS asset_ids (
  only     INTEGER PRIMARY KEY CHECK (only = 1),
  last_seq INTEGER NOT NULL                 -- the global short-ID sequence (ids.ts); never goes back
);`,
  },
];

export type RunStart =
  | { kind: "new"; runId: number; startedAt: number }
  | {
      kind: "resumed";
      runId: number;
      startedAt: number;
      lastSignOfLife: number;
    };

export function beginOrResume(env: Env, store: Store): RunStart {
  for (const file of readdirSync(env.config.archive_directory))
    if (file.endsWith(".partial"))
      unlinkSync(`${env.config.archive_directory}/${file}`);
  const result = store.write((tx) => {
    const open = tx.get<{
      run_id: number;
      started_at: number;
      resumes: string;
    }>("SELECT * FROM runs WHERE ended_at IS NULL");
    if (open) {
      const last = Math.max(
        open.started_at,
        tx.get<{ at: number }>(
          "SELECT MAX(time) at FROM events WHERE run_id=?",
          open.run_id,
        )?.at ?? 0,
        env.log.lastRecordTime(open.run_id) ?? 0,
      );
      const resumes = JSON.parse(open.resumes);
      resumes.push({ last_sign_of_life: last, resumed_at: tx.now });
      tx.run(
        "UPDATE runs SET resumes=? WHERE run_id=?",
        JSON.stringify(resumes),
        open.run_id,
      );
      return {
        kind: "resumed",
        runId: open.run_id,
        startedAt: open.started_at,
        lastSignOfLife: last,
      } as const;
    }
    const id = tx.get<{ id: number }>(
      "SELECT COALESCE(MAX(run_id),0)+1 id FROM runs",
    )!.id;
    tx.run("INSERT INTO runs(run_id,started_at) VALUES (?,?)", id, tx.now);
    return { kind: "new", runId: id, startedAt: tx.now } as const;
  });
  store.setRun(result.runId);
  return result;
}

export function nextRunSeq(
  tx: Tx,
  which: "track" | "geofeature" | "object",
): number {
  const column = {
    track: "last_track_seq",
    geofeature: "last_geofeature_seq",
    object: "last_object_seq",
  }[which];
  return tx.get<{ n: number }>(
    `UPDATE runs SET ${column}=${column}+1 WHERE run_id=? RETURNING ${column} n`,
    tx.runId,
  )!.n;
}

export function nextGlobalId(tx: Tx): string | null {
  tx.run("INSERT OR IGNORE INTO asset_ids VALUES (1,0)");
  while (true) {
    const n =
      tx.get<{ n: number }>("SELECT last_seq n FROM asset_ids WHERE only=1")!
        .n + 1;
    if (n > SHORT_ID_CAPACITY) {
      tx.env.log.record({
        level: "error",
        area: "identity",
        msg: "Asset IDs exhausted",
      });
      process.stderr.write(
        "Asset IDs exhausted; new registrations are refused\n",
      );
      return null;
    }
    tx.run("UPDATE asset_ids SET last_seq=? WHERE only=1", n);
    const id = encodeShortId(n);
    if (!tx.get("SELECT 1 FROM accounts WHERE operator_id=?", id)) return id;
  }
}
