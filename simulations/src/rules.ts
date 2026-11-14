import type { AtlasEvent } from "@atlas/sdk";
export type RunTrace = {
  events: AtlasEvent[];
  starts: { asset_id: string; task_id: number }[];
  accepted: number[];
  handled: Record<string, number[]>;
  secrets: string[];
  stored: string;
};
export function oncePerTask(t: RunTrace) {
  const ids = t.starts.map((s) => `${s.asset_id}:${s.task_id}`);
  return new Set(ids).size === ids.length;
}
export function requestsSettled(t: RunTrace) {
  return t.accepted.every((id) =>
    t.events.some(
      (e) =>
        !Array.isArray(e.record) &&
        "request_id" in e.record &&
        e.record.request_id === id,
    ),
  );
}
export function readersOrdered(t: RunTrace) {
  return Object.values(t.handled).every((ids) =>
    ids.every((id, i) => i === 0 || id > ids[i - 1]),
  );
}
export function noSecrets(t: RunTrace) {
  return t.secrets.every((s) => !t.stored.includes(s));
}
export function tasksSettled(t: RunTrace) {
  return t.starts.every((s) =>
    t.events.some(
      (e) =>
        (e.kind === "task.dropped" &&
          e.record.asset_id === s.asset_id &&
          e.record.task_id === s.task_id) ||
        (e.kind === "report.status" &&
          e.record.kind === "task" &&
          e.record.asset_id === s.asset_id &&
          e.record.task_id === s.task_id &&
          e.record.task_state !== "active"),
    ),
  );
}
export function changesHaveEvents(changes: number[], events: AtlasEvent[]) {
  const ids = new Set(events.map((e) => e.event_id));
  return changes.every((id) => ids.has(id));
}
export function retriesHaveOneEffect(
  responses: { key: string; event_id: number }[],
) {
  const byKey = new Map<string, number>();
  return responses.every((r) => {
    const old = byKey.get(r.key);
    byKey.set(r.key, r.event_id);
    return old === undefined || old === r.event_id;
  });
}
