import type { AtlasEvent } from "@atlas/sdk";
import type { Traffic } from "./network.ts";
export type RunTrace = {
  events: AtlasEvent[];
  starts: { asset_id: string; task_id: number }[];
  handled: Record<string, number[]>;
  network: Traffic[];
  accepted: number[];
  secrets: string[];
  stored: Uint8Array[];
  reportIds: number[];
  tasks: { asset_id: string; task_id: number; state: string }[];
  places: { geofeature_id: string; name?: string }[];
};
const final = (e: AtlasEvent, asset_id: string, task_id: number) =>
  (e.kind === "task.dropped" &&
    e.record.asset_id === asset_id &&
    e.record.task_id === task_id) ||
  (e.kind === "report.status" &&
    e.record.kind === "task" &&
    e.record.asset_id === asset_id &&
    e.record.task_id === task_id &&
    e.record.task_state !== "active");
export const rules = [
  {
    name: "Tasks run once and settle",
    checks: "sdk/docs/asset.md#the-queue-helper",
    check(t: RunTrace) {
      const ids = t.starts.map((s) => `${s.asset_id}:${s.task_id}`);
      const tasks = t.events.flatMap((e) =>
        e.kind === "tasks.requested" ? e.record : [],
      );
      return (
        ids.length > 0 &&
        tasks.length > 0 &&
        new Set(ids).size === ids.length &&
        tasks.every((task) =>
          t.events.some((e) => final(e, task.asset_id, task.task_id)),
        )
      );
    },
  },
  {
    name: "Accepted requests answer or drop",
    checks: "core/docs/api.md#operator-requests",
    check(t: RunTrace) {
      return (
        t.accepted.length > 0 &&
        t.accepted.every((id) =>
          t.events.some(
            (e) =>
              !Array.isArray(e.record) &&
              "request_id" in e.record &&
              e.record.request_id === id,
          ),
        )
      );
    },
  },
  {
    name: "Readers handle every event once in order",
    checks: "core/docs/api.md#the-event-log-and-live-stream",
    check(t: RunTrace) {
      const expected = t.events.map((e) => e.event_id);
      return (
        expected.length > 0 &&
        Object.keys(t.handled).length > 0 &&
        Object.values(t.handled).every(
          (ids) =>
            ids.length === expected.length &&
            ids.every(
              (id, i) => id === expected[i] && (i === 0 || id > ids[i - 1]),
            ),
        )
      );
    },
  },
  {
    name: "Accepted changes have events and stored state agrees",
    checks: "core/docs/storage.md#every-change-writes-one-event",
    check(t: RunTrace) {
      const changes = t.network.filter(
        (n) =>
          n.method !== "GET" &&
          n.response &&
          typeof n.response === "object" &&
          "event_id" in n.response,
      );
      const latest = new Map<string, string | undefined>();
      for (const e of t.events) {
        if (e.kind === "geofeature.created" || e.kind === "geofeature.replaced")
          latest.set(e.record.geofeature_id, e.record.name);
        if (e.kind === "geofeature.deleted")
          latest.delete(e.record.geofeature_id);
      }
      return (
        changes.length > 0 &&
        latest.size > 0 &&
        changes.every((n) =>
          t.events.some(
            (e) => e.event_id === (n.response as { event_id: number }).event_id,
          ),
        ) &&
        t.tasks.length > 0 &&
        t.tasks.every((task) => {
          const requested = t.events.some(
            (e) =>
              e.kind === "tasks.requested" &&
              e.record.some(
                (r) =>
                  r.asset_id === task.asset_id && r.task_id === task.task_id,
              ),
          );
          const last = t.events
            .filter((e) => final(e, task.asset_id, task.task_id))
            .at(-1);
          const state =
            last?.kind === "task.dropped"
              ? "dropped"
              : last?.kind === "report.status" && last.record.kind === "task"
                ? last.record.task_state
                : undefined;
          return requested && state === task.state;
        }) &&
        t.events
          .filter((e) => e.kind.startsWith("report."))
          .every((e) => t.reportIds.includes(e.event_id)) &&
        t.reportIds.every((id) =>
          t.events.some(
            (e) => e.event_id === id && e.kind.startsWith("report."),
          ),
        ) &&
        latest.size === t.places.length &&
        t.places.every(
          (p) =>
            latest.has(p.geofeature_id) &&
            latest.get(p.geofeature_id) === p.name,
        )
      );
    },
  },
  {
    name: "Retries have one effect",
    checks: "core/docs/api.md#basics",
    check(t: RunTrace) {
      const keyed = new Map<string, Traffic[]>();
      for (const n of t.network)
        if (n.key) {
          const entries = keyed.get(n.key) ?? [];
          entries.push(n);
          keyed.set(n.key, entries);
        }
      const retried = [...keyed.values()].filter(
        (entries) =>
          entries.length > 1 && entries.some((n) => n.status && n.status < 300),
      );
      return (
        retried.length > 0 &&
        retried.every((entries) => {
          const first = entries.find((n) => n.response)?.response;
          if (!first) return false;
          if (typeof first === "object" && "event_id" in first) {
            const effect = t.events.find((e) => e.event_id === first.event_id);
            if (!effect) return false;
            const sameEffect = (e: AtlasEvent) =>
              e.kind === effect.kind &&
              JSON.stringify(e.record) === JSON.stringify(effect.record);
            const expected = [...keyed.values()].filter((group) => {
              const response = group.find(
                (n) => n.status && n.status < 300 && n.response,
              )?.response;
              return (
                response &&
                typeof response === "object" &&
                "event_id" in response &&
                t.events.some(
                  (e) => e.event_id === response.event_id && sameEffect(e),
                )
              );
            }).length;
            return (
              entries.every(
                (n) =>
                  !n.response ||
                  JSON.stringify(n.response) === JSON.stringify(first),
              ) &&
              t.events.filter((e) => e.event_id === first.event_id).length ===
                1 &&
              t.events.filter(sameEffect).length === expected
            );
          }
          const body = entries[0].body;
          if (
            body &&
            typeof body === "object" &&
            "reports" in body &&
            Array.isArray(body.reports)
          )
            return body.reports.every((report) => {
              const fingerprint = JSON.stringify(report);
              const expected = [...keyed.values()]
                .filter((group) =>
                  group.some((n) => n.status && n.status < 300),
                )
                .flatMap((group) => {
                  const sent = group[0].body;
                  return sent &&
                    typeof sent === "object" &&
                    "reports" in sent &&
                    Array.isArray(sent.reports)
                    ? sent.reports
                    : [];
                })
                .filter((r) => JSON.stringify(r) === fingerprint).length;
              return (
                t.events.filter((e) => JSON.stringify(e.record) === fingerprint)
                  .length === expected
              );
            });
          return false;
        })
      );
    },
  },
  {
    name: "Stored bytes contain no credentials",
    checks: "core/docs/api.md#credential-retry-scenarios",
    check(t: RunTrace) {
      return (
        t.secrets.length > 0 &&
        t.stored.length > 0 &&
        t.secrets.every(
          (secret) =>
            secret.length > 0 &&
            t.stored.every(
              (bytes) => !new TextDecoder().decode(bytes).includes(secret),
            ),
        )
      );
    },
  },
];
