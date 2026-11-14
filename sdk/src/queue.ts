import type { ProtocolTypes } from "@atlas/protocol/types";
import type { Clock } from "./clock.ts";

export type Task = ProtocolTypes["task"];
export type Report = ProtocolTypes["requests.reports"]["reports"][number];
export type AssetEvent =
  | { kind: "tasks.requested" | "tasks.updated"; event_id: number; record: Task[] }
  | { kind: "cancel.requested"; event_id: number; record: ProtocolTypes["cancel"] }
  | { kind: "task.dropped"; event_id: number; record: ProtocolTypes["drop"] }
  | { kind: "settings.requested"; event_id: number; record: ProtocolTypes["settings_change"] };
export interface QueueHost {
  ready?(): void;
  runNow(task: Task): void;
  stop(task_id: number, because: "cancel" | "now"): void;
  update(task: Task): void;
}
type FinishState = "completed" | "failed" | "cancelled";
export type FinishFields = { explanation?: string; object_ids?: string[] };
type Slot =
  | { at: "held" | "running"; task: Task }
  | { at: "stopping"; task: Task; requests: number[] }
  | { at: "cancel_first"; requests: number[] }
  | { at: "pending_update"; task: Task }
  | { at: "ended" };
type State = { floor: number; supersededBelow: number; slots: ReadonlyMap<number, Slot> };
type Input = AssetEvent | { kind: "start" | "clear" } | { kind: "finish"; task_id: number; state: FinishState; fields: FinishFields };
type Effect =
  | { kind: "report"; body: ProtocolTypes["report.status"] }
  | { kind: "run" | "runNow" | "update"; task: Task }
  | { kind: "stop"; id: number; because: "cancel" | "now" }
  | { kind: "ready" };
export interface Queue {
  apply(event: AssetEvent): void;
  next(): Task | undefined;
  finish(id: number, state: FinishState, fields?: FinishFields): void;
  clear(): void;
  held(): number[];
  active(): Task[];
  snapshot(): Report[];
}
function held(s: State): number[] {
  return [...s.slots].filter(([, v]) => v.at === "held").map(([id]) => id).sort((a,b) => a-b);
}
function available(s: State): Task | undefined {
  if ([...s.slots.values()].some(v => v.at === "running" || v.at === "stopping")) return;
  const id = held(s)[0];
  if (id === undefined) return;
  const slot = s.slots.get(id);
  if (slot?.at !== "held") return;
  for (let n = s.floor + 1; n <= Math.max(id, slot.task.send_last ?? id); n++) {
    const at = s.slots.get(n)?.at;
    if (n < s.supersededBelow && at === undefined) continue;
    if (n < id ? at !== "ended" && at !== "cancel_first" : at !== "held" && at !== "ended" && at !== "cancel_first") return;
  }
  return slot.task;
}
function reduce(previous: State, input: Input, asset_id: string, time: number): { state: State; effects: Effect[] } {
  const slots = new Map(previous.slots);
  const s = { ...previous, slots };
  const effects: Effect[] = [];
  const report = (body: ProtocolTypes["report.status"]) => effects.push({ kind: "report", body });
  const queue = (request_id?: number) => report({ type: "report.status", asset_id, time, kind: "queue", task_ids: held(s), ...(request_id === undefined ? {} : { request_id }) });
  const final = (id: number, state: FinishState, requests: number[] = [], fields: FinishFields = {}) => {
    for (const request_id of requests.length ? requests : [undefined])
      report({ type: "report.status", asset_id, time, kind: "task", task_id: id, task_state: state, ...fields, ...(request_id === undefined ? {} : { request_id }) });
    slots.set(id, { at: "ended" });
  };
  switch (input.kind) {
    case "tasks.requested":
      for (let task of [...input.record].sort((a,b) => a.task_id-b.task_id)) {
        const id = task.task_id, slot = slots.get(id);
        if (id <= s.floor || slot?.at === "ended" || slot?.at === "held" || slot?.at === "running" || slot?.at === "stopping") continue;
        if (slot?.at === "pending_update") task = slot.task;
        if (slot?.at === "cancel_first") { final(id, "cancelled", slot.requests); continue; }
        if (id < s.supersededBelow) { final(id, "cancelled"); continue; }
        if (task.now) {
          s.supersededBelow = Math.max(s.supersededBelow, id);
          for (const [lower, v] of slots) {
            if (lower >= id) continue;
            if (v.at === "held") final(lower, "cancelled");
            if (v.at === "running") {
              slots.set(lower, { at: "stopping", task: v.task, requests: [] });
              effects.push({ kind: "stop", id: lower, because: "now" });
            }
          }
          slots.set(id, { at: "running", task });
          effects.push({ kind: "runNow", task });
          report({ type: "report.status", time, asset_id, kind: "task", task_id: id, task_state: "active" });
        } else if (held(s).length >= 64) final(id, "cancelled", [], { explanation: "queue full" });
        else slots.set(id, { at: "held", task });
      }
      queue(input.event_id);
      break;
    case "tasks.updated":
      for (const task of input.record) {
        const slot = slots.get(task.task_id);
        if (task.task_id <= s.floor || slot?.at === "ended" || slot?.at === "cancel_first") continue;
        if (!slot || slot.at === "pending_update") slots.set(task.task_id, { at: "pending_update", task });
        else {
          slots.set(task.task_id, { ...slot, task });
          if (slot.at === "running" || slot.at === "stopping") effects.push({ kind: "update", task });
        }
      }
      queue(input.event_id);
      break;
    case "cancel.requested": {
      const id = input.record.task_id, slot = slots.get(id), request = input.event_id;
      if (id <= s.floor || slot?.at === "ended") queue(request);
      else if (slot?.at === "held") { final(id, "cancelled", [request]); queue(); }
      else if (slot?.at === "running" || slot?.at === "stopping") {
        slots.set(id, { at: "stopping", task: slot.task, requests: [...(slot.at === "stopping" ? slot.requests : []), request] });
        if (slot.at === "running") effects.push({ kind: "stop", id, because: "cancel" });
      } else slots.set(id, { at: "cancel_first", requests: [...(slot?.at === "cancel_first" ? slot.requests : []), request] });
      break;
    }
    case "task.dropped": {
      const id = input.record.task_id;
      if (id !== undefined && slots.get(id)?.at !== "running" && slots.get(id)?.at !== "stopping") { slots.set(id, { at: "ended" }); queue(); }
      break;
    }
    case "start": {
      const task = available(s);
      if (task) {
        slots.set(task.task_id, { at: "running", task });
        effects.push({ kind: "run", task });
        report({ type: "report.status", time, asset_id, kind: "task", task_id: task.task_id, task_state: "active" });
        queue();
      }
      break;
    }
    case "finish": {
      const slot = slots.get(input.task_id);
      if (slot?.at !== "running" && slot?.at !== "stopping") throw new Error("Only a running Task can finish");
      final(input.task_id, input.state, slot.at === "stopping" ? slot.requests : [], input.fields);
      break;
    }
    case "clear":
      for (const id of held(s)) final(id, "cancelled");
      queue();
      break;
    case "settings.requested": break;
  }
  if (available(s)) effects.push({ kind: "ready" });
  return { state: s, effects };
}
export function createQueue(o: { last_task_id: number; host: QueueHost; emit(report: Report): void; clock: Clock; asset_id: string }): Queue {
  let state: State = { floor: o.last_task_id, supersededBelow: 0, slots: new Map() };
  function apply(input: Input): Task | undefined {
    const result = reduce(state, input, o.asset_id, o.clock.now());
    state = result.state;
    let started: Task | undefined;
    for (const e of result.effects) {
      switch (e.kind) {
        case "report": o.emit(e.body); break;
        case "run": started = e.task; break;
        case "runNow": o.host.runNow(e.task); break;
        case "update": o.host.update(e.task); break;
        case "stop": o.host.stop(e.id, e.because); break;
        case "ready": o.host.ready?.(); break;
      }
    }
    return started;
  }
  return {
    apply,
    next: () => apply({ kind: "start" }),
    finish: (task_id, state, fields = {}) => { apply({ kind: "finish", task_id, state, fields }); },
    clear: () => { apply({ kind: "clear" }); },
    held: () => held(state),
    active: () => [...state.slots.values()].flatMap(s => s.at === "running" || s.at === "stopping" ? [s.task] : []),
    snapshot: () => [
      { type: "report.status", asset_id: o.asset_id, time: o.clock.now(), kind: "queue", task_ids: held(state) },
      ...[...state.slots.values()].flatMap(s => s.at === "running" || s.at === "stopping" ? [{ type: "report.status" as const, asset_id: o.asset_id, time: o.clock.now(), kind: "task" as const, task_id: s.task.task_id, task_state: "active" as const }] : []),
    ],
  };
}
