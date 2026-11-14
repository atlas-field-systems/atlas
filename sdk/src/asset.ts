import { internal } from "./internal.ts";
import { diagnostics, type Observer } from "./diagnostics.ts";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
import type { Client, Result } from "./client.ts";
import type { Clock } from "./clock.ts";
import { follow, type FollowEnd, type AtlasEvent } from "./stream.ts";
import {
  createQueue,
  type AssetEvent,
  type QueueHost,
  type Report,
} from "./queue.ts";
export type LinkResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "run_ended"
        | "unauthenticated"
        | "definitions_mismatch"
        | "closed"
        | "refused";
      explanation: string;
    };
export interface AssetFile {
  name: string;
  contentType: string;
  bytes: Uint8Array;
  place?: P["requests.geofeature"];
}
export interface AssetLink {
  events(after: number): AsyncIterable<AssetEvent>;
  sendReports(
    reports: Report[],
    priority: "must_arrive" | "can_skip",
  ): Promise<LinkResult>;
  onContact(
    cb: (c: { open: boolean; last_heard: number | null }) => void,
  ): () => void;
  capacity(): number | undefined;
  storeFile(file: AssetFile): Promise<Result<{ object_id: string }>>;
}
const mustArrive = (r: Report) =>
  ("request_id" in r && r.request_id !== undefined) ||
  (r.type === "report.status" &&
    r.kind === "task" &&
    r.task_state !== "active");
export function createOutbox(
  link: AssetLink,
  clock: Clock,
  heartbeatMs = 10000,
  observer?: Observer,
) {
  const emit = diagnostics(clock, observer);
  const live: Report[] = [],
    retained: Report[] = [];
  let stopped = false,
    blocked: LinkResult | undefined,
    flight: Promise<void> | undefined;
  const listeners = new Set<(result: LinkResult) => void>();
  let timer = clock.after(heartbeatMs, beat);
  function beat() {
    void flush(true);
  }
  function flush(heartbeat = false): Promise<void> {
    if (flight) return flight;
    if (stopped || blocked) return Promise.resolve();
    flight = (async () => {
      do {
        const lane = live.length ? live : retained;
        if (!lane.length && !heartbeat) break;
        const batch = lane.slice(0, 1000);
        emit("batch.sent", { count: batch.length });
        const result = await link.sendReports(
          batch,
          batch.some(mustArrive) ? "must_arrive" : "can_skip",
        );
        if (!result.ok) {
          blocked = result;
          for (const cb of listeners) cb(result);
          break;
        }
        emit("batch.acknowledged", { count: batch.length });
        lane.splice(0, batch.length);
        heartbeat = false;
      } while (!stopped && (live.length || retained.length));
    })().finally(() => {
      flight = undefined;
      timer.cancel();
      if (!stopped && !blocked) {
        timer = clock.after(heartbeatMs, beat);
        if (live.length || retained.length) void flush();
      }
    });
    return flight;
  }
  return {
    add(reports: Report[], lane: "live" | "retained" = "live") {
      (lane === "live" ? live : retained).push(...structuredClone(reports));
      void flush();
    },
    flush,
    get blocked() {
      return blocked;
    },
    onBlocked(cb: (r: LinkResult) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    stop() {
      stopped = true;
      timer.cancel();
    },
  };
}
export interface AssetOptions {
  clock: Clock;
  heartbeatMs?: number;
  observer?: Observer;
  queue?: QueueHost;
  settings(): P["report.settings"]["settings"];
  onSettings?(
    settings: P["settings_change"],
    request_id: number,
  ): void | Promise<void>;
}
export function runAsset(
  link: AssetLink,
  registration: { asset_id: string; after: number; last_task_id: number },
  options: AssetOptions,
) {
  const { asset_id } = registration;
  const outbox = createOutbox(
    link,
    options.clock,
    options.heartbeatMs,
    options.observer,
  );
  const queue = options.queue
    ? createQueue({
        asset_id,
        observer: options.observer,
        last_task_id: registration.last_task_id,
        clock: options.clock,
        host: options.queue,
        emit: (r) => outbox.add([r]),
      })
    : undefined;
  let stopped = false;
  async function rejoin() {
    await outbox.flush();
    const settings: Report = {
      type: "report.settings",
      time: options.clock.now(),
      asset_id,
      settings: options.settings(),
    };
    const reports = [
      ...(Object.keys(settings.settings).length ? [settings] : []),
      ...(queue && queue.held().length
        ? queue.snapshot()
        : (queue
            ?.snapshot()
            .filter((r) => r.type === "report.status" && r.kind === "task") ??
          [])),
    ];
    if (reports.length) outbox.add(reports);
    await outbox.flush(!reports.length);
  }
  const ready = rejoin().then((): LinkResult => outbox.blocked ?? { ok: true });
  const done = (async (): Promise<FollowEnd> => {
    try {
      const initial = await ready;
      if (!initial.ok)
        return {
          reason: initial.error === "refused" ? "closed" : initial.error,
        };
      for await (const event of link.events(registration.after)) {
        if (stopped) return { reason: "stopped" };
        if (event.kind === "settings.requested")
          await options.onSettings?.(event.record, event.event_id);
        else queue?.apply(event);
      }
      return { reason: stopped ? "stopped" : "closed" };
    } finally {
      outbox.stop();
    }
  })();
  return {
    asset_id,
    queue,
    outbox,
    rejoin,
    ready,
    done,
    stop() {
      stopped = true;
      outbox.stop();
    },
  };
}
async function known<T>(initial: Promise<Result<T>>): Promise<Result<T>> {
  let result = await initial;
  while (
    !result.ok &&
    result.retry &&
    (result.error === "unknown" || (result.status ?? 0) >= 500)
  )
    result = await result.retry();
  return result;
}
export async function startAsset(
  client: Client<{ kind: "asset"; key: string }>,
  options: AssetOptions & { description: P["requests.asset"] },
) {
  const connected = await client.connect();
  if (!connected.ok) return connected;
  const registered = await known(
    client.call("register", { body: options.description }),
  );
  if (!registered.ok) return registered;
  const { asset_id, as_of, last_task_id } = registered.value;
  const contacts = new Set<
    (c: { open: boolean; last_heard: number | null }) => void
  >();
  let session: ReturnType<typeof runAsset> | undefined;
  let stream: ReturnType<typeof follow> | undefined;
  let ending: FollowEnd = { reason: "closed" };
  const link: AssetLink = {
    async *events(after) {
      const events: AssetEvent[] = [];
      let wake: (() => void) | undefined,
        ended = false;
      let firstOpen = true;
      stream = follow(
        client as Client,
        {
          after,
          beforeOpen: async () => {
            if (firstOpen) firstOpen = false;
            else await session?.rejoin();
          },
          onContact: (c) => {
            for (const cb of contacts) cb(c);
          },
        },
        (event) => {
          if (
            event.kind === "tasks.requested" ||
            event.kind === "tasks.updated" ||
            event.kind === "cancel.requested" ||
            event.kind === "settings.requested" ||
            event.kind === "task.dropped"
          )
            events.push(event as AssetEvent);
          wake?.();
        },
      );
      void stream.done.then((end) => {
        ending = end;
        ended = true;
        wake?.();
      });
      while (!ended || events.length) {
        if (events.length) yield events.shift()!;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
    },
    async sendReports(reports) {
      let result = await client.call("sendReports", {
        params: { asset_id },
        body: { reports },
      });
      while (
        !result.ok &&
        result.retry &&
        (result.error === "unknown" || (result.status ?? 0) >= 500)
      ) {
        internal(client).emit("batch.resent", {
          count: reports.length,
          status: result.status ?? 0,
        });
        await new Promise<void>((resolve) => options.clock.after(500, resolve));
        result = await result.retry();
      }
      if (result.ok) return { ok: true };
      return {
        ok: false,
        error:
          result.error === "run_ended" ||
          result.error === "unauthenticated" ||
          result.error === "definitions_mismatch" ||
          result.error === "closed"
            ? result.error
            : "refused",
        explanation: result.explanation,
      };
    },
    onContact(cb) {
      contacts.add(cb);
      return () => {
        contacts.delete(cb);
      };
    },
    capacity: () => undefined,
    async storeFile(file) {
      let geofeature_id: string | undefined;
      if (file.place) {
        const result = await known(
          client.call("createGeofeature", { body: file.place }),
        );
        if (!result.ok)
          return {
            ok: false,
            error: result.error,
            explanation: result.explanation,
          };
        geofeature_id = result.value.geofeature.geofeature_id;
      }
      return known(
        client.uploadObject(file.bytes, file.contentType, {
          name: file.name,
          geofeature_id,
        }),
      );
    },
  };
  session = runAsset(
    link,
    { asset_id, after: as_of, last_task_id },
    {
      ...options,
      observer: options.observer ?? internal(client).options.observer,
    },
  );
  const running = session;
  const ready = await running.ready;
  if (!ready.ok) {
    running.stop();
    return ready;
  }
  return {
    ok: true as const,
    value: {
      ...running,
      done: running.done.then(() => ending),
      stop() {
        stream?.stop();
        running.stop();
      },
      link,
    },
  };
}
