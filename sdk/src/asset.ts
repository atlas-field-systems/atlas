import { internal } from "./internal.ts";
import { diagnostics, type Observer } from "./diagnostics.ts";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
import type { Client, Result } from "./client.ts";
import { backoffDelay, defaultBackoff, type Clock } from "./clock.ts";
import { follow, type FollowEnd } from "./stream.ts";
import {
  createQueue,
  type AssetEvent,
  type QueueHost,
  type Report,
} from "./queue.ts";
export type LinkFailure = {
  ok: false;
  error:
    | "run_ended"
    | "unauthenticated"
    | "definitions_mismatch"
    | "closed"
    | "refused";
  explanation: string;
};
export type LinkResult =
  | { ok: true }
  | LinkFailure
  | { ok: false; error: "lost"; explanation: string };
export interface AssetFile {
  name: string;
  contentType: string;
  bytes: Uint8Array;
  place?: P["requests.geofeature"];
}
export interface Room {
  bytes: number;
  size(reports: Report[]): number;
}
export interface Batch {
  reports: Report[];
  priority: "must_arrive" | "can_skip";
  settle(result: LinkResult): void;
}
export interface ReportSource {
  take(room: Room): Batch | undefined;
  onWaiting(cb: () => void): () => void;
}
export interface AssetLink {
  events(after: number): AsyncIterable<AssetEvent>;
  serve(source: ReportSource): () => void;
  onContact(
    cb: (c: { open: boolean; last_heard: number | null }) => void,
  ): () => void;
  storeFile(file: AssetFile): Promise<Result<{ object_id: string }>>;
}
const mustArrive = (r: Report) =>
  ("request_id" in r && r.request_id !== undefined) ||
  (r.type === "report.status" &&
    r.kind === "task" &&
    r.task_state !== "active") ||
  r.type === "report.failsafe" ||
  (r.type === "report.status" && r.kind === "subsystem" && r.condition !== "healthy");
const batchLimit = 1000;
export function createOutbox(
  clock: Clock,
  heartbeatMs = 10000,
  observer?: Observer,
  emit = diagnostics(clock, observer),
  current?: (room: Room) => Report[],
  onReports?: (reports: Report[]) => void,
) {
  function recorded(reports: Report[]) {
    try { onReports?.(structuredClone(reports)); }
    catch { emit("reports.recording_failed", { count: reports.length }); }
  }
  const live: Report[] = [],
    retained: Report[] = [];
  let stopped = false,
    beat = false,
    blocked: LinkFailure | undefined,
    blockedBatch: Report[] | undefined,
    inFlight = false;
  let protectedReports = new Set<Report>();
  const listeners = new Set<(result: LinkFailure) => void>();
  const waiting = new Set<() => void>();
  const acknowledged = new Map<Report, () => void>();
  const beats: (() => void)[] = [];
  const idle: (() => void)[] = [];
  function notify() {
    if (stopped || blocked) return;
    for (const cb of waiting) cb();
  }
  function settleIdle() {
    if (!stopped && !blocked && (inFlight || live.length || retained.length))
      return;
    for (const resolve of idle.splice(0)) resolve();
  }
  function release() {
    for (const resolve of acknowledged.values()) resolve();
    acknowledged.clear();
    for (const resolve of beats.splice(0)) resolve();
    settleIdle();
  }
  function waitFor(report: Report) {
    return new Promise<void>((resolve) => {
      const previous = acknowledged.get(report);
      acknowledged.set(report, () => {
        previous?.();
        resolve();
      });
    });
  }
  let timer = clock.after(heartbeatMs, due);
  function due() {
    beat = true;
    notify();
  }
  function fill(lane: Report[], room: Room) {
    const batch: Report[] = [];
    for (const report of lane) {
      if (batch.length >= batchLimit) break;
      if (batch.length && room.size([...batch, report]) > room.bytes) break;
      batch.push(report);
    }
    return batch;
  }
  function take(room: Room): Batch | undefined {
    if (stopped || blocked || inFlight) return;
    let lane = live,
      queued = fill(live, room),
      reports = queued;
    if (current && queued.length < batchLimit) {
      const bytes = room.bytes - (queued.length ? room.size(queued) : 0);
      if (bytes > 0 || !queued.length) {
        const samples = current({ bytes, size: room.size });
        recorded(samples);
        reports = [
          ...queued,
          ...samples.slice(
            0,
            batchLimit - queued.length,
          ),
        ];
      }
    }
    if (!reports.length && retained.length) {
      lane = retained;
      reports = queued = fill(retained, room);
    }
    if (!reports.length && !beat) return;
    beat = false;
    inFlight = true;
    protectedReports = new Set(queued);
    timer.cancel();
    const priority = reports.some(mustArrive) ? "must_arrive" : "can_skip";
    emit("batch.sent", { count: reports.length, priority });
    let settled = false;
    return {
      reports: structuredClone(reports),
      priority,
      settle(result) {
        if (settled) return;
        settled = true;
        inFlight = false;
        protectedReports.clear();
        if (stopped) return release();
        if (result.ok) {
          emit("batch.acknowledged", { count: reports.length });
          lane.splice(0, queued.length);
          for (const report of queued) {
            acknowledged.get(report)?.();
            acknowledged.delete(report);
          }
          for (const resolve of beats.splice(0)) resolve();
        } else if (result.error === "lost") {
          emit("batch.lost", { count: reports.length });
          beat ||= !reports.length;
        } else {
          blocked = result;
          blockedBatch = reports;
          release();
          for (const cb of listeners) cb(result);
          return;
        }
        timer = clock.after(heartbeatMs, due);
        settleIdle();
        if (live.length || retained.length || beat) notify();
      },
    };
  }
  return {
    take,
    onWaiting(cb: () => void) {
      waiting.add(cb);
      return () => {
        waiting.delete(cb);
      };
    },
    add(reports: Report[], lane: "live" | "retained" = "live") {
      if (stopped || !reports.length) return Promise.resolve();
      recorded(reports);
      const copies = structuredClone(reports);
      (lane === "live" ? live : retained).push(...copies);
      const sent = blocked ? Promise.resolve() : waitFor(copies[copies.length - 1]);
      const ordinary = [...retained, ...live].filter(r => !mustArrive(r) && !protectedReports.has(r));
      const dropped = new Set(ordinary.slice(0, Math.max(0, ordinary.length - 1024)));
      for (const queue of [live, retained]) {
        for (let i = queue.length - 1; i >= 0; i--) {
          const report = queue[i];
          if (!dropped.has(report)) continue;
          queue.splice(i, 1);
          acknowledged.get(report)?.();
          acknowledged.delete(report);
        }
      }
      if (dropped.size) emit("reports.gap", { dropped: dropped.size });
      if (blocked) return Promise.resolve();
      notify();
      return sent;
    },
    changed: notify,
    flush() {
      return new Promise<void>((resolve) => {
        idle.push(resolve);
        settleIdle();
        notify();
      });
    },
    flushLive() {
      if (stopped || blocked) return Promise.resolve();
      const last = live.at(-1);
      if (last) return waitFor(last);
      if (retained.length) return Promise.resolve();
      return new Promise<void>((resolve) => {
        beats.push(resolve);
        due();
      });
    },
    get blocked() {
      return blocked;
    },
    get blockedBatch() {
      return blockedBatch && structuredClone(blockedBatch);
    },
    onBlocked(cb: (r: LinkFailure) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    stop() {
      stopped = true;
      timer.cancel();
      release();
    },
  };
}
export interface AssetOptions {
  clock: Clock;
  heartbeatMs?: number;
  observer?: Observer;
  queue?: QueueHost;
  current?(room: Room): Report[];
  onReports?(reports: Report[]): void;
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
  emit = diagnostics(options.clock, options.observer),
) {
  const { asset_id } = registration;
  const outbox = createOutbox(
    options.clock,
    options.heartbeatMs,
    options.observer,
    emit,
    options.current,
    options.onReports,
  );
  const stopServing = link.serve(outbox);
  const queue = options.queue
    ? createQueue(
        {
          asset_id,
          observer: options.observer,
          last_task_id: registration.last_task_id,
          clock: options.clock,
          host: options.queue,
          emit: (r) => outbox.add([r]),
        },
        emit,
      )
    : undefined;
  let stopped = false;
  let wakeStop: (() => void) | undefined;
  function untilStopped<T>(pending: Promise<T>): Promise<T | undefined> {
    return Promise.race([
      pending,
      new Promise<undefined>((resolve) => {
        wakeStop = () => resolve(undefined);
      }),
    ]);
  }
  async function rejoin() {
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
    if (reports.length) await outbox.add(reports);
    // Reopening must not wait for retained history to drain.
    if (!reports.length) await outbox.flushLive();
  }
  const ready = rejoin().then(
    async (): Promise<{ ok: true } | LinkFailure> => {
      await outbox.flush();
      return outbox.blocked ?? { ok: true };
    },
  );
  const done = (async (): Promise<FollowEnd> => {
    try {
      const initial = await untilStopped(ready);
      if (!initial) return { reason: "stopped" };
      if (!initial.ok)
        return {
          reason: initial.error === "refused" ? "closed" : initial.error,
        };
      const iterator = link.events(registration.after)[Symbol.asyncIterator]();
      try {
        while (!stopped) {
          const next = await untilStopped(iterator.next());
          if (!next || stopped || next.done) break;
          const event = next.value;
          if (event.kind === "settings.requested")
            await untilStopped(
              Promise.resolve(
                options.onSettings?.(event.record, event.event_id),
              ),
            );
          else queue?.apply(event);
        }
      } finally {
        // A link may leave next() pending even after return().
        void iterator.return?.().catch(() => {});
      }
      return { reason: stopped ? "stopped" : "closed" };
    } finally {
      outbox.stop();
      stopServing();
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
      wakeStop?.();
      outbox.stop();
      stopServing();
    },
  };
}
async function known<T>(initial: Promise<Result<T>>): Promise<Result<T>> {
  let result = await initial;
  while (!result.ok && result.retry && result.error === "unknown")
    result = await result.retry();
  return result;
}
export async function startAsset(
  client: Client<{ kind: "asset"; key: string }>,
  options: Omit<AssetOptions, "observer"> & {
    description: P["requests.asset"];
  },
) {
  let connected = await client.connect();
  let attempt = 0;
  while (!connected.ok && connected.error === "unknown") {
    await new Promise<void>((resolve) =>
      options.clock.after(
        backoffDelay(
          attempt++,
          internal(client).options.backoff ?? defaultBackoff,
        ),
        resolve,
      ),
    );
    connected = await client.connect();
  }
  if (!connected.ok) return connected;
  const threshold = options.settings().link_loss_after_s;
  if (threshold !== undefined && threshold <= connected.value.stream_keepalive_s)
    return { ok: false as const, error: "refused" as const, explanation: "initial_settings.link_loss_after_s must exceed Core stream_keepalive_s" };
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
  let ending: FollowEnd | undefined;
  let stopped = false;
  let wakeEvent: (() => void) | undefined;
  let acknowledge: (() => void) | undefined;
  let wakeRetry: (() => void) | undefined;
  const stopLink = () => {
    stopped = true;
    wakeRetry?.();
    wakeEvent?.();
    acknowledge?.();
    stream?.stop();
    session?.stop();
  };
  async function send(reports: Report[]): Promise<LinkResult> {
    if (stopped)
      return {
        ok: false,
        error: "closed",
        explanation: "Asset session stopped",
      };
    let attempt = 0;
    let result = await client.call("sendReports", {
      params: { asset_id },
      body: { reports },
    });
    while (
      !stopped &&
      !result.ok &&
      result.retry &&
      (result.error === "unknown" || (result.status ?? 0) >= 500)
    ) {
      const delay = backoffDelay(
        attempt++,
        internal(client).options.backoff ?? defaultBackoff,
      );
      await new Promise<void>((resolve) => {
        const timer = options.clock.after(delay, resolve);
        wakeRetry = () => {
          timer.cancel();
          resolve();
        };
      });
      wakeRetry = undefined;
      if (stopped) break;
      result = await result.retry();
    }
    if (stopped)
      return {
        ok: false,
        error: "closed",
        explanation: "Asset session stopped",
      };
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
  }
  const link: AssetLink = {
    async *events(after) {
      let pending: AssetEvent | undefined;
      let ended = false;
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
        async (event) => {
          if (stopped) return;
          if (
            event.kind === "tasks.requested" ||
            event.kind === "tasks.updated" ||
            event.kind === "cancel.requested" ||
            event.kind === "settings.requested" ||
            event.kind === "task.dropped"
          ) {
            pending = event;
            const consumed = new Promise<void>((resolve) => {
              acknowledge = resolve;
            });
            wakeEvent?.();
            await consumed;
            acknowledge = undefined;
          }
        },
      );
      void stream.done.then((end) => {
        if (!stopped) ending = end;
        ended = true;
        wakeEvent?.();
      });
      try {
        while (!ended && !stopped) {
          if (pending) {
            const event = pending;
            pending = undefined;
            yield event;
            acknowledge?.();
          } else
            await new Promise<void>((resolve) => {
              wakeEvent = resolve;
            });
        }
      } finally {
        pending = undefined;
        acknowledge?.();
        stream.stop();
      }
    },
    serve(source) {
      let open = true,
        pending = true,
        wake: (() => void) | undefined;
      const unsubscribe = source.onWaiting(() => {
        pending = true;
        wake?.();
      });
      void (async () => {
        while (open && !stopped) {
          const batch = pending
            ? source.take({ bytes: Infinity, size: () => 0 })
            : undefined;
          if (batch) {
            pending = false;
            batch.settle(await send(batch.reports));
          }
          else if (pending) pending = false;
          else
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          wake = undefined;
        }
      })();
      return () => {
        open = false;
        unsubscribe();
        wake?.();
      };
    },
    onContact(cb) {
      contacts.add(cb);
      return () => {
        contacts.delete(cb);
      };
    },
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
            status: result.status,
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
    { ...options, observer: internal(client).options.observer },
    internal(client).emit,
  );
  const running = session;
  const unsubscribe = client.onStatus((status) => {
    if (
      status.phase === "closed" ||
      status.phase === "run_ended" ||
      status.phase === "unauthenticated" ||
      status.phase === "definitions_mismatch"
    ) {
      ending = { reason: status.phase };
      stopLink();
    }
  });
  const done = running.done.then(
    (end) => {
      stopLink();
      unsubscribe();
      return ending ?? end;
    },
    (error: unknown) => {
      stopLink();
      unsubscribe();
      throw error;
    },
  );
  const ready = await running.ready;
  if (!ready.ok) {
    stopLink();
    await done;
    return ready;
  }
  return {
    ok: true as const,
    value: {
      ...running,
      done,
      stop() {
        ending = { reason: "stopped" };
        stopLink();
      },
      link,
    },
  };
}
