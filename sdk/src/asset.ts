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
  emit = diagnostics(clock, observer),
) {
  const live: Report[] = [],
    retained: Report[] = [];
  let stopped = false,
    blocked: LinkResult | undefined,
    blockedBatch: Report[] | undefined,
    flight: Promise<void> | undefined;
  const listeners = new Set<(result: LinkResult) => void>();
  const acknowledged = new Map<Report, () => void>();
  function releaseWaiters() {
    for (const resolve of acknowledged.values()) resolve();
    acknowledged.clear();
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
          blockedBatch = batch;
          releaseWaiters();
          for (const cb of listeners) cb(result);
          break;
        }
        emit("batch.acknowledged", { count: batch.length });
        lane.splice(0, batch.length);
        for (const report of batch) {
          acknowledged.get(report)?.();
          acknowledged.delete(report);
        }
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
      if (stopped || !reports.length) return Promise.resolve();
      const copies = structuredClone(reports);
      (lane === "live" ? live : retained).push(...copies);
      if (blocked) return Promise.resolve();
      const sent = waitFor(copies[copies.length - 1]);
      void flush();
      return sent;
    },
    flush,
    flushLive() {
      if (stopped || blocked) return Promise.resolve();
      const last = live.at(-1);
      if (last) return waitFor(last);
      return retained.length ? Promise.resolve() : flush(true);
    },
    get blocked() {
      return blocked;
    },
    get blockedBatch() {
      return blockedBatch && structuredClone(blockedBatch);
    },
    onBlocked(cb: (r: LinkResult) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    stop() {
      stopped = true;
      releaseWaiters();
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
  emit = diagnostics(options.clock, options.observer),
) {
  const { asset_id } = registration;
  const outbox = createOutbox(
    link,
    options.clock,
    options.heartbeatMs,
    options.observer,
    emit,
  );
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
  const ready = rejoin().then(async (): Promise<LinkResult> => {
    await outbox.flush();
    return outbox.blocked ?? { ok: true };
  });
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
    async sendReports(reports) {
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
