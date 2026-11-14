import * as entities from "./entities.ts";
import { refuse } from "../api/errors.ts";
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

export function requestTasks(
  tx: Tx,
  asset_id: string,
  body: ProtocolTypes["requests.tasks"],
  by: string,
): { task_ids: number[]; event_id: number } {
  const v = entities.admissionView(tx, asset_id);
  if (!v.online) refuse("asset_offline", "Asset is offline");
  if (
    (body.now && body.tasks.length !== 1) ||
    body.tasks.some(
      (t) => t.kind === "failsafe" && (!body.now || body.tasks.length !== 1),
    )
  )
    refuse("invalid", "Failsafe must be the only Task and use now");
  if (v.flying && !v.hasCriticalBatteryRule)
    refuse(
      "no_critical_battery_rule",
      "Report a critical battery rule before sending Tasks",
    );
  for (const t of body.tasks) {
    if (t.kind === "settings") entities.checkSettings(v, t.settings);
    else entities.checkCommand(v.description, t);
  }
  if (!body.now && latestQueue(tx, asset_id).length + body.tasks.length > CAP)
    refuse("queue_full", "Reported queue is full");
  const first = lastTaskId(tx, asset_id) + 1;
  const last = first + body.tasks.length - 1;
  if (last > MAX_TASK_ID) refuse("task_ids_exhausted", "Task IDs exhausted");
  const records: TaskRecord[] = body.tasks.map((t, i) => ({
    ...t,
    ...placeCopy(tx, t),
    time: tx.now,
    asset_id,
    task_id: first + i,
    send_last: last,
    ...(body.now ? { now: true } : {}),
    requested_by: by,
  }));
  const event_id = tx.append("tasks.requested", records);
  for (const t of records)
    tx.run(
      "INSERT INTO tasks(run_id,asset_id,task_id,body,requested_by,request_event,state,state_time) VALUES (?,?,?,?,?,?,'sent',?)",
      tx.runId,
      asset_id,
      t.task_id,
      JSON.stringify(t),
      by,
      event_id,
      tx.now,
    );
  tx.env.log.record({
    level: "trace",
    area: "tasks",
    msg: "Tasks admitted",
    asset_id,
    event_id,
    task_ids: records.map((t) => t.task_id),
  });
  return { task_ids: records.map((t) => t.task_id), event_id };
}

export function cancelTask(
  tx: Tx,
  asset_id: string,
  task_id: number,
  by: string,
): { event_id: number } {
  if (!entities.admissionView(tx, asset_id).online)
    refuse("asset_offline", "Asset is offline");
  const row = tx.get<{ state: TaskState }>(
    "SELECT state FROM tasks WHERE run_id=? AND asset_id=? AND task_id=?",
    tx.runId,
    asset_id,
    task_id,
  );
  if (!row) refuse("not_found", "No such Task");
  if (!unfinished(row.state)) refuse("task_ended", "Task already ended");
  return {
    event_id: tx.append("cancel.requested", {
      time: tx.now,
      asset_id,
      task_id,
      requested_by: by,
    }),
  };
}

export function applyTaskReport(
  tx: Tx,
  asset_id: string,
  report: StatusTask,
): void {
  const row = tx.get<{ state: TaskState }>(
    "SELECT state FROM tasks WHERE run_id=? AND asset_id=? AND task_id=?",
    tx.runId,
    asset_id,
    report.task_id,
  );
  if (
    !row ||
    !unfinished(row.state) ||
    rank[report.task_state] <= rank[row.state]
  )
    return;
  tx.run(
    "UPDATE tasks SET state=?,state_time=?,object_ids=? WHERE run_id=? AND asset_id=? AND task_id=?",
    report.task_state,
    report.time,
    report.task_state === "completed" && report.object_ids
      ? JSON.stringify(report.object_ids)
      : null,
    tx.runId,
    asset_id,
    report.task_id,
  );
}
export function applyQueueReport(
  tx: Tx,
  asset_id: string,
  report: StatusQueue,
  event_id: number,
  ahead = false,
): void {
  for (const id of report.task_ids)
    tx.run(
      "UPDATE tasks SET state='queued',state_time=? WHERE run_id=? AND asset_id=? AND task_id=? AND state='sent'",
      report.time,
      tx.runId,
      asset_id,
      id,
    );
  if (ahead) return;
  const prior = tx.get<{ report_time: number; event_id: number }>(
    "SELECT report_time,event_id FROM queues WHERE run_id=? AND asset_id=?",
    tx.runId,
    asset_id,
  );
  if (
    prior &&
    (prior.report_time > report.time ||
      (prior.report_time === report.time && prior.event_id >= event_id))
  )
    return;
  tx.run(
    "INSERT INTO queues VALUES (?,?,?,?,?) ON CONFLICT(run_id,asset_id) DO UPDATE SET task_ids=excluded.task_ids,report_time=excluded.report_time,event_id=excluded.event_id",
    tx.runId,
    asset_id,
    JSON.stringify(report.task_ids),
    report.time,
    event_id,
  );
}

export function dropUnconfirmed(tx: Tx, asset_id: string): number[] {
  return drop(tx, asset_id, ["sent"]);
}
export function dropUnfinished(tx: Tx, asset_id: string): number[] {
  return drop(tx, asset_id, ["sent", "queued", "active"]);
}
export function lastTaskId(tx: ReadTx, asset_id: string): number {
  return tx.get<{ n: number }>(
    "SELECT COALESCE(MAX(task_id),0) n FROM tasks WHERE run_id=? AND asset_id=?",
    tx.runId,
    asset_id,
  )!.n;
}

export function updatePlace(
  tx: Tx,
  place: Geofeature,
): {
  updated_task_ids: { asset_id: string; task_id: number }[];
  not_updated_task_ids: { asset_id: string; task_id: number }[];
} {
  const result: ReturnType<typeof updatePlace> = {
    updated_task_ids: [],
    not_updated_task_ids: [],
  };
  const groups = new Map<string, TaskRecord[]>();
  for (const row of tx.all<{ asset_id: string; task_id: number; body: string }>(
    "SELECT * FROM tasks WHERE run_id=? AND geofeature_id=? AND state IN ('sent','queued','active') ORDER BY asset_id,task_id",
    tx.runId,
    place.geofeature_id,
  )) {
    const id = { asset_id: row.asset_id, task_id: row.task_id };
    if (
      place.kind !== "point" ||
      !entities.admissionView(tx, row.asset_id).online
    ) {
      result.not_updated_task_ids.push(id);
      continue;
    }
    const task: TaskRecord = JSON.parse(row.body);
    const updated = { ...task, ...placeCopy(tx, task), time: tx.now };
    tx.run(
      "UPDATE tasks SET body=? WHERE run_id=? AND asset_id=? AND task_id=?",
      JSON.stringify(updated),
      tx.runId,
      row.asset_id,
      row.task_id,
    );
    const group = groups.get(row.asset_id) ?? [];
    group.push(updated);
    groups.set(row.asset_id, group);
    result.updated_task_ids.push(id);
  }
  for (const records of groups.values()) tx.append("tasks.updated", records);
  return result;
}

export type TaskEntry = {
  task: TaskRecord;
  state: TaskState;
  state_time: number;
  object_ids?: string[];
};
export function readTasks(
  tx: ReadTx,
  asset_id: string,
): { as_of: number; items: TaskEntry[]; held: number[] } {
  entities.requireAsset(tx, asset_id);
  return {
    as_of: tx.asOf(),
    held: latestQueue(tx, asset_id),
    items: tx
      .all<{
        body: string;
        state: TaskState;
        state_time: number;
        object_ids: string | null;
      }>(
        "SELECT * FROM tasks WHERE run_id=? AND asset_id=? ORDER BY task_id",
        tx.runId,
        asset_id,
      )
      .map((r) => ({
        task: JSON.parse(r.body),
        state: r.state,
        state_time: r.state_time,
        ...(r.object_ids ? { object_ids: JSON.parse(r.object_ids) } : {}),
      })),
  };
}
export function latestQueue(tx: ReadTx, asset_id: string): number[] {
  const row = tx.get<{ task_ids: string }>(
    "SELECT task_ids FROM queues WHERE run_id=? AND asset_id=?",
    tx.runId,
    asset_id,
  );
  return row ? JSON.parse(row.task_ids) : [];
}

export function exportRows(tx: ReadTx): {
  tasks: unknown[];
  queues: unknown[];
} {
  return {
    tasks: tx.all("SELECT * FROM tasks WHERE run_id=?", tx.runId),
    queues: tx.all("SELECT * FROM queues WHERE run_id=?", tx.runId),
  };
}

const rank: Record<TaskState, number> = {
  sent: 0,
  queued: 1,
  active: 2,
  completed: 3,
  failed: 3,
  cancelled: 3,
  dropped: 3,
};
function unfinished(state: TaskState): boolean {
  return rank[state] < 3;
}
function placeCopy(tx: ReadTx, task: ProtocolTypes["requests.task"]): object {
  if ((task.kind === "move_to" || task.kind === "land") && task.geofeature_id) {
    const point = entities.pointOf(tx, task.geofeature_id);
    return task.kind === "move_to"
      ? { destination: point }
      : { landing_position: point };
  }
  return {};
}
function drop(tx: Tx, asset_id: string, states: TaskState[]): number[] {
  const rows = tx.all<{ task_id: number }>(
    `SELECT task_id FROM tasks WHERE run_id=? AND asset_id=? AND state IN (${states.map(() => "?")}) ORDER BY task_id`,
    tx.runId,
    asset_id,
    ...states,
  );
  for (const { task_id } of rows) {
    tx.run(
      "UPDATE tasks SET state='dropped',state_time=? WHERE run_id=? AND asset_id=? AND task_id=?",
      tx.now,
      tx.runId,
      asset_id,
      task_id,
    );
    tx.append("task.dropped", { time: tx.now, asset_id, task_id });
  }
  return rows.map((r) => r.task_id);
}
