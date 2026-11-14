import type { ProtocolTypes as P } from "@atlas/protocol/types";
import type { Client } from "./client.ts";
import { follow, type AtlasEvent, type Follow } from "./stream.ts";
import type { Task } from "./queue.ts";
export type AssetView = {
  asset_id: string;
  gateway_id: string | null;
  description: P["description"] | null;
  contact: P["contact"];
  reports: Record<string, P["requests.reports"]["reports"][number]>;
  settings: Record<string, { value: unknown; time: number }>;
  subsystems: Record<string, P["report.status"]>;
  gimbals: Record<string, P["report.gimbal"]>;
};
type TaskView = {
  task: Task;
  state: string;
  state_time: number;
  object_ids?: string[];
};
export function createLivePicture(
  client: Client,
  options: { asset_id?: string } = {},
) {
  let ready = false,
    stream: Follow | undefined,
    stopped = false,
    generation = 0;
  const assets = new Map<string, AssetView>(),
    observations = new Map<string, P["report.observation"]>(),
    tracks = new Map<string, P["track"]>(),
    geofeatures = new Map<string, P["geofeature"]>();
  const tasks = new Map<string, Map<number, TaskView>>(),
    marks = new Map<string, number>(),
    latest = new Map<string, [number, number]>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of listeners) cb();
  };
  function newer(key: string, time: number, id: number) {
    const old = latest.get(key);
    if (old && (time < old[0] || (time === old[0] && id <= old[1])))
      return false;
    latest.set(key, [time, id]);
    return true;
  }
  function clear() {
    ready = false;
    assets.clear();
    observations.clear();
    tracks.clear();
    geofeatures.clear();
    tasks.clear();
    marks.clear();
    latest.clear();
    notify();
  }
  async function load() {
    const current = ++generation;
    stream?.stop();
    clear();
    const result = await client.call("entities");
    if (!result.ok || stopped || current !== generation) return;
    const snapshot = result.value,
      after = [snapshot.as_of];
    marks.set("entities", snapshot.as_of);
    for (const a of snapshot.assets) {
      if (options.asset_id && a.asset_id !== options.asset_id) continue;
      assets.set(a.asset_id, a);
      for (const [key, value] of Object.entries(a.settings))
        latest.set(`setting:${a.asset_id}:${key}`, [
          value.time,
          snapshot.as_of,
        ]);
      for (const [key, value] of Object.entries(a.subsystems))
        latest.set(`subsystem:${a.asset_id}:${key}`, [
          value.time,
          snapshot.as_of,
        ]);
      for (const [key, value] of Object.entries(a.reports))
        latest.set(`report:${a.asset_id}:${key}`, [value.time, snapshot.as_of]);
      const t = await client.call("tasks", {
        params: { asset_id: a.asset_id },
      });
      if (!t.ok || stopped || current !== generation) return;
      marks.set(a.asset_id, t.value.as_of);
      after.push(t.value.as_of);
      tasks.set(
        a.asset_id,
        new Map(t.value.items.map((v) => [v.task.task_id, v])),
      );
    }
    for (const o of snapshot.observations) {
      observations.set(`${o.asset_id}:${o.observation_id}`, o);
      latest.set(`observation:${o.asset_id}:${o.observation_id}`, [
        o.time,
        snapshot.as_of,
      ]);
    }
    for (const t of snapshot.tracks) tracks.set(t.track_id, t);
    for (const g of snapshot.geofeatures) geofeatures.set(g.geofeature_id, g);
    ready = true;
    stream = follow(
      client,
      { after: Math.min(...after), asset_id: options.asset_id },
      apply,
    );
    notify();
  }
  function apply(e: AtlasEvent) {
    if (e.event_id > (marks.get("entities") ?? 0)) {
      switch (e.kind) {
        case "asset.registered": {
          const id = e.record.asset_id;
          assets.set(id, {
            asset_id: id,
            gateway_id: null,
            description: null,
            contact: { time: e.time, asset_id: id, contact: "online" },
            reports: {},
            settings: {},
            subsystems: {},
            gimbals: {},
          });
          tasks.set(id, new Map());
          break;
        }
        case "asset.removed":
          assets.delete(e.record.asset_id);
          tasks.delete(e.record.asset_id);
          break;
        case "asset.described": {
          const a = assets.get(e.record.asset_id!);
          if (a) a.description = e.record;
          break;
        }
        case "asset.contact": {
          const a = assets.get(e.record.asset_id!);
          if (a) a.contact = e.record;
          break;
        }
        case "report.observation": {
          const r = e.record,
            key = `${r.asset_id}:${r.observation_id}`;
          if (!e.clock_ahead && newer("observation:" + key, r.time, e.event_id))
            observations.set(key, r);
          break;
        }
        case "track.updated":
          tracks.set(e.record.track_id, e.record);
          break;
        case "track.removed":
          tracks.delete(e.record.track_id);
          break;
        case "geofeature.created":
        case "geofeature.replaced":
          geofeatures.set(e.record.geofeature_id, e.record);
          break;
        case "geofeature.deleted":
          geofeatures.delete(e.record.geofeature_id);
          break;
        default:
          if (
            e.kind.startsWith("report.") &&
            !e.clock_ahead &&
            "asset_id" in e.record &&
            !Array.isArray(e.record)
          ) {
            const a = assets.get(e.record.asset_id!);
            if (!a) break;
            if (e.kind === "report.settings") {
              for (const [key, value] of Object.entries(e.record.settings))
                if (
                  newer(
                    `setting:${a.asset_id}:${key}`,
                    e.record.time,
                    e.event_id,
                  )
                )
                  a.settings[key] = { value, time: e.record.time };
            } else if (
              e.kind === "report.status" &&
              e.record.kind === "subsystem"
            ) {
              if (
                newer(
                  `subsystem:${a.asset_id}:${e.record.subsystem_id}`,
                  e.record.time,
                  e.event_id,
                )
              )
                a.subsystems[e.record.subsystem_id] = e.record;
            } else if (e.kind === "report.gimbal") {
              if (
                newer(
                  `gimbal:${a.asset_id}:${e.record.camera_id}`,
                  e.record.time,
                  e.event_id,
                )
              )
                a.gimbals[e.record.camera_id] = e.record;
            }
            if (
              e.kind.startsWith("report.") &&
              "type" in e.record &&
              newer(`report:${a.asset_id}:${e.kind}`, e.record.time, e.event_id)
            )
              a.reports[e.kind] =
                e.record as P["requests.reports"]["reports"][number];
          }
      }
    }
    if (e.kind === "tasks.requested" || e.kind === "tasks.updated") {
      for (const task of e.record) {
        if (e.event_id <= (marks.get(task.asset_id) ?? 0)) continue;
        let part = tasks.get(task.asset_id);
        if (!part) {
          part = new Map();
          tasks.set(task.asset_id, part);
        }
        const old = part.get(task.task_id);
        part.set(task.task_id, {
          task,
          state: old?.state ?? "requested",
          state_time: old?.state_time ?? task.time,
        });
      }
    } else if (
      e.kind === "report.status" &&
      e.record.kind === "task" &&
      e.event_id > (marks.get(e.record.asset_id) ?? 0)
    ) {
      const task = tasks.get(e.record.asset_id)?.get(e.record.task_id);
      if (task)
        Object.assign(task, {
          state: e.record.task_state,
          state_time: e.record.time,
          object_ids: e.record.object_ids,
        });
    } else if (
      e.kind === "task.dropped" &&
      e.record.task_id !== undefined &&
      e.event_id > (marks.get(e.record.asset_id!) ?? 0)
    ) {
      const task = tasks.get(e.record.asset_id!)?.get(e.record.task_id);
      if (task)
        Object.assign(task, { state: "dropped", state_time: e.record.time });
    }
    notify();
  }
  const unsubscribe = client.onStatus((s) => {
    if (s.phase === "connected") void load();
    else if (s.phase === "run_ended") {
      generation++;
      stream?.stop();
      clear();
    } else notify();
  });
  if (client.status.phase === "connected") void load();
  function view<T>(items: T[]) {
    return {
      ready,
      stale: !stream || stream.stale || client.status.phase !== "connected",
      items: structuredClone(items),
    };
  }
  return {
    assets: () => view([...assets.values()]),
    observations: () => view([...observations.values()]),
    tracks: () => view([...tracks.values()]),
    geofeatures: () => view([...geofeatures.values()]),
    tasks: (id: string) => view([...(tasks.get(id)?.values() ?? [])]),
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    stop() {
      stopped = true;
      generation++;
      stream?.stop();
      unsubscribe();
    },
  };
}
