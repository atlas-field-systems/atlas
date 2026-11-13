/**
 * Tasks pillar (pillars.md): Tasks, each Asset's queue, and cancels. Owns
 * `tasks` and `queues`. The rules are api.md#operator-requests and
 * core/docs/requests.md.
 *
 * A Task's state in Core:
 *
 *   sent ──queue report lists it──▶ queued ──▶ active ──▶ completed | failed | cancelled
 *    │                                 (any reported state may come first)
 *    └─ Asset offline, or app restarted, with no report of it ──▶ dropped
 *   queued / active ── app restarted ──▶ dropped
 *
 * Reported states only move forward (sent < queued < active < final), so a
 * retained report delivered after a gap never moves a Task back. Final states
 * never change. 'sent' and 'dropped' are Core's own; the rest are the Asset's
 * task_state. "Unfinished" = sent | queued | active (api.md: "A Task is
 * unfinished until its final Asset report is stored").
 */
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { ReadTx, TableDef, Tx } from "../store/db.ts";

type TaskRecord = ProtocolTypes["task"];
type StatusTask = Extract<ProtocolTypes["report.status"], { kind: "task" }>;
type StatusQueue = Extract<ProtocolTypes["report.status"], { kind: "queue" }>;
type Geofeature = ProtocolTypes["geofeature"];

export type TaskState =
  | "sent"
  | "queued"
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "dropped";
export const CAP = 64; // decision log 2026-11-10
export const MAX_TASK_ID = 9999; // Protocol law 10

export const TABLES: TableDef[] = [
  {
    owner: "tasks",
    name: "tasks",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS tasks (
  run_id        INTEGER NOT NULL,
  asset_id      TEXT    NOT NULL,
  task_id       INTEGER NOT NULL,          -- 1, 2, 3 ... per Asset per run; next = MAX+1 (rows never deleted in a run)
  body          TEXT    NOT NULL,          -- the task record as last sent (tasks.updated replaces it)
  requested_by  TEXT    NOT NULL,
  request_event INTEGER NOT NULL,          -- event_id of its tasks.requested
  state         TEXT    NOT NULL CHECK (state IN ('sent','queued','active','completed','failed','cancelled','dropped')),
  state_time    INTEGER NOT NULL,          -- report time of the state, or Core's time for sent / dropped
  object_ids    TEXT,                      -- from a completed report, JSON
  geofeature_id TEXT GENERATED ALWAYS AS (json_extract(body, '$.geofeature_id')) VIRTUAL,
  PRIMARY KEY (run_id, asset_id, task_id)
);
CREATE INDEX IF NOT EXISTS tasks_place ON tasks(run_id, geofeature_id) WHERE geofeature_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_unfinished ON tasks(run_id, asset_id, state);`,
  },
  {
    owner: "tasks",
    name: "queues",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS queues (
  run_id      INTEGER NOT NULL,
  asset_id    TEXT    NOT NULL,
  task_ids    TEXT    NOT NULL,            -- JSON array from the latest queue report
  report_time INTEGER NOT NULL,
  event_id    INTEGER NOT NULL,            -- the report's event; ties on report_time break by it
  PRIMARY KEY (run_id, asset_id)
);`,
  },
];

// --- requests (api.md#operator-requests) --------------------------------------

/**
 * POST /tasks/{asset_id}, an account, body requests.tasks (already checked).
 * Accepted or refused whole. In order (every check reads; nothing is written
 * until all pass, so a refusal leaves no trace even before the rollback):
 *
 *   v = Entities.admissionView(tx, asset_id)               // 404
 *   if (!v.online) refuse asset_offline                   // no exception, Fail-safe included
 *   failsafe kind anywhere → must be the only Task and now → else 400 invalid
 *   now with more than one Task → 400 invalid
 *   each Task: kind 'settings' → each setting in v.description.settings,
 *              otherwise kind in v.description.commands  → else 409 not_supported
 *   capture: camera_id in v.description.cameras         → else 409 not_supported
 *   v.flying: !v.hasCriticalBatteryRule → 409 no_critical_battery_rule; any settings Task whose
 *             failsafe_policy has none → 409 no_critical_battery_rule
 *   move_to / land with geofeature_id: position = Entities.pointOf (404 / 409 not_a_point),
 *             copied into destination / landing_position beside the id
 *   !now: held = latestQueue(asset).length; held + tasks.length > CAP → 409 queue_full
 *   first = lastTaskId(asset) + 1; last = first + n - 1; last > MAX_TASK_ID → 409 task_ids_exhausted (see core/docs/api.md)
 *   records = tasks.map((t, i) => ({ time: tx.now, asset_id, task_id: first + i, send_last: last,
 *                                    ...(now && { now: true }), requested_by: by, ...t }))
 *   event_id = tx.append('tasks.requested', records)      // append checks each against 'task'
 *   insert rows state 'sent', request_event = event_id
 *   → 202 {task_ids, event_id}
 */
export function requestTasks(
  tx: Tx,
  asset_id: string,
  body: ProtocolTypes["requests.tasks"],
  by: string,
): { task_ids: number[]; event_id: number } {
  throw new Error("not implemented");
}

/**
 * POST /tasks/{asset_id}/{task_id}/cancel, an account, no body.
 * Asset must exist (404) and be online (409 asset_offline: a cancel is a
 * request like any other). task_id never assigned → 404 not_found.
 * A Task already ended → 409 task_ended. Adds cancel.requested
 * {time, asset_id, task_id, requested_by}.
 */
export function cancelTask(
  tx: Tx,
  asset_id: string,
  task_id: number,
  by: string,
): { event_id: number } {
  throw new Error("not implemented");
}

// --- Asset reports (called by Entities.storeReports in the same transaction) --

/** Move the Task's state forward only; record object_ids of a completed Task. Unknown task_id: stored as evidence, no row changes. */
export function applyTaskReport(
  tx: Tx,
  asset_id: string,
  report: StatusTask,
): void {
  throw new Error("not implemented");
}
/**
 * Replace `queues` when this report is newer (report time, then event_id).
 * Every 'sent' Task it lists becomes 'queued'.
 */
export function applyQueueReport(
  tx: Tx,
  asset_id: string,
  report: StatusQueue,
  event_id: number,
): void {
  throw new Error("not implemented");
}

// --- drops -------------------------------------------------------------------

/**
 * The Asset went offline (Entities.applyContact): task.dropped {time,
 * asset_id, task_id} for every Task still 'sent', i.e. one the Asset never
 * reported holding (api.md#operator-requests). Called after the request
 * drops, in the same transaction.
 */
export function dropUnconfirmed(tx: Tx, asset_id: string): number[] {
  throw new Error("not implemented");
}
/** The Asset's app started again (registration or radio sign-up): task.dropped for every unfinished Task. */
export function dropUnfinished(tx: Tx, asset_id: string): number[] {
  throw new Error("not implemented");
}
/** The highest task_id given to the Asset in this run, or 0 (registration's last_task_id). */
export function lastTaskId(tx: ReadTx, asset_id: string): number {
  throw new Error("not implemented");
}

// --- place edits (api.md#geo-features, "An edit updates Tasks only when asked") -

/**
 * Called by Entities.replaceGeofeature with update_tasks=true. For each
 * unfinished Task whose body names the place: an online Asset's Tasks get a new
 * copy of the position, grouped into one tasks.updated per Asset in task_id
 * order, rows' bodies replaced; an offline Asset's Tasks are listed as not
 * updated. A replacement that is not a point: doc gap G12, provisionally every
 * such Task is listed as not updated.
 */
export function updatePlace(
  tx: Tx,
  place: Geofeature,
): {
  updated_task_ids: { asset_id: string; task_id: number }[];
  not_updated_task_ids: { asset_id: string; task_id: number }[];
} {
  throw new Error("not implemented");
}

// --- reads (api.md#reads) -------------------------------------------------------

export type TaskEntry = {
  task: TaskRecord;
  state: TaskState;
  state_time: number;
  object_ids?: string[];
};
/** GET /tasks/{asset_id}: Task bodies, latest states, and the Tasks the Asset reports holding. as_of added (see core/docs/api.md). */
export function readTasks(
  tx: ReadTx,
  asset_id: string,
): { as_of: number; items: TaskEntry[]; held: number[] } {
  throw new Error("not implemented");
}
/** The task_ids of the latest queue report, or [] before the first one. What the cap counts. */
export function latestQueue(tx: ReadTx, asset_id: string): number[] {
  throw new Error("not implemented");
}

/** Reset ZIP state/ and summary.md: every Task with its final state. */
export function exportRows(tx: ReadTx): {
  tasks: unknown[];
  queues: unknown[];
} {
  throw new Error("not implemented");
}
