/**
 * The deliberate stop and the Reset ZIP (core/docs/reset.md). Rules are in
 * runs-and-identity.md; this module carries them out.
 *
 * stopRun, in order. Nothing before step 6 changes the database, so a crash
 * anywhere before it resumes the run (reset.md#when-core-stops-unexpectedly).
 *
 *  1. server.close(): new requests get 503; streams end; requests in flight finish.
 *  2. contact.stop(); fusion.drain(), so every stored Observation is fused
 *     and the ZIP's tracks match its events; fusion.stop().
 *  3. log.flush(); the run's diagnostics are complete on disk.
 *  4. Write <final>.partial (zip.ts): README.md, summary.md, events.jsonl
 *     (paged from disk in event_id order, never all in memory), state/*.jsonl
 *     from each pillar's exportRows, objects/<object_id> streamed from disk,
 *     diagnostics/*, config.json (redacted), versions.json, and last
 *     manifest.json with every file's size and SHA-256, each resume from
 *     runs.resumes, and every gap (log gaps, resumes).
 *     The final name exists already → fail (never overwrite a ZIP).
 *  5. fsync, then read the .partial back and check every entry against the
 *     manifest (size, SHA-256 of the decompressed bytes). Then rename to the
 *     final name and fsync the directory.
 *  6. clearRun: one transaction deletes every run-scoped row (TableDef.runScoped)
 *     of the run and sets runs.ended_at, outcome 'archived', zip_name.
 *  7. Delete objects/run-<id>/ and the run's diagnostics folder. A crash between
 *     6 and 7 leaves files no row names; startCore sweeps them.
 *  8. store.close().
 *
 * Any failure in 4-5: delete the .partial, set runs.ended_at with outcome
 * 'archive_failed', keep every row and file, log and print the failure
 * (reset.md#when-the-zip-fails). No retry at a later start.
 */
import type { Env, StopResult } from "../core.ts";
import type { Store, TableDef } from "../store/db.ts";

export interface StopParts {
  closeServer(): Promise<void>;
  stopContact(): void;
  drainFusion(): Promise<void>;
}

export async function stopRun(
  env: Env,
  store: Store,
  tables: readonly TableDef[],
  parts: StopParts,
): Promise<StopResult> {
  throw new Error("not implemented");
}

/** Step 6, also used by runs.beginOrResume to finish a clear a crash interrupted. */
export function clearRun(
  store: Store,
  tables: readonly TableDef[],
  runId: number,
  zipName: string,
): void {
  throw new Error("not implemented");
}

/** Check a finished ZIP against its own manifest.json. Used at step 5 and at start. */
export async function checkZip(
  path: string,
): Promise<{ ok: true } | { ok: false; why: string }> {
  throw new Error("not implemented");
}

/**
 * summary.md (reset.md#cores-reset-zip), plain words, from the stored run:
 * run ID, start, end, each unexpected stop with how long Core was down;
 * each Asset with its gateway, first and last heard (first and last event
 * naming it); each Asset's Tasks in task_id order with their final reported
 * outcome or "no reported outcome" (dropped Tasks say dropped, claiming no
 * outcome); Plugin calls and how each ended; every gap.
 */
export function writeSummary(store: Store, runId: number): string {
  throw new Error("not implemented");
}
