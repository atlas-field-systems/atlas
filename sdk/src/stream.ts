import { internal } from "./internal.ts";
import { EVENT_KINDS } from "@atlas/core/event-kinds";
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { Client } from "./client.ts";
import { backoffDelay, type Timer } from "./clock.ts";
export type EventKind = keyof typeof EVENT_KINDS;
type RecordOf<K extends EventKind> = (typeof EVENT_KINDS)[K] extends {
  many: true;
}
  ? ProtocolTypes[(typeof EVENT_KINDS)[K]["record"]][]
  : ProtocolTypes[(typeof EVENT_KINDS)[K]["record"]];
export type AtlasEvent<K extends EventKind = EventKind> = K extends EventKind
  ? {
      event_id: number;
      time: number;
      kind: K;
      record: RecordOf<K>;
      clock_ahead?: true;
      requested_by?: string;
    }
  : never;
export type FollowEnd = {
  reason:
    | "stopped"
    | "closed"
    | "unauthenticated"
    | "definitions_mismatch"
    | "run_ended"
    | "handler_failed"
    | "invalid_event";
  error?: unknown;
};
export interface Follow {
  readonly cursor: number;
  readonly stale: boolean;
  done: Promise<FollowEnd>;
  stop(): void;
}
export function follow(
  client: Client,
  options: {
    after: number;
    asset_id?: string;
    beforeOpen?(): Promise<void>;
    onContact?(contact: { open: boolean; last_heard: number | null }): void;
  },
  handler: (event: AtlasEvent) => void | Promise<void>,
): Follow {
  const { clock, protocol } = internal(client).options;
  let cursor = options.after,
    stale = true,
    stopped = false,
    controller: AbortController | undefined,
    idle: Timer | undefined,
    wake: (() => void) | undefined;
  const boundEpoch = internal(client).epoch;
  const terminal = (): FollowEnd["reason"] | undefined => {
    if (stopped) return "stopped";
    if (internal(client).epoch !== boundEpoch) return "run_ended";
    switch (client.status.phase) {
      case "closed":
      case "unauthenticated":
      case "definitions_mismatch":
      case "run_ended":
        return client.status.phase;
    }
  };
  const unsubscribe = client.onStatus(() => {
    if (terminal()) {
      controller?.abort();
      wake?.();
    }
  });
  const done = (async (): Promise<FollowEnd> => {
    let attempts = 0;
    try {
      while (!terminal()) {
        const checked = await internal(client).verifyRun();
        if (terminal()) break;
        if (checked.ok) {
          controller = new AbortController();
          try {
            await options.beforeOpen?.();
            if (terminal()) break;
            const response = await internal(client).streamFetch(
              cursor,
              options.asset_id,
              controller.signal,
            );
            if (!response.ok) {
              await internal(client).streamResponse(response);
            } else if (!response.body)
              return { reason: "invalid_event", error: "Missing stream body" };
            else {
              stale = false;
              attempts = 0;
              internal(client).emit("stream.open");
              options.onContact?.({ open: true, last_heard: clock.now() });
              const reader = response.body.getReader(),
                decoder = new TextDecoder();
              let buffer = "",
                data: string[] = [];
              const resetIdle = () => {
                idle?.cancel();
                idle = clock.after(
                  internal(client).options.streamIdleMs ?? 30000,
                  () => {
                    internal(client).emit("stream.idle");
                    controller?.abort();
                  },
                );
              };
              resetIdle();
              try {
                while (!terminal()) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  resetIdle();
                  buffer += decoder.decode(chunk.value, { stream: true });
                  let index: number;
                  while (!terminal() && (index = buffer.indexOf("\n")) >= 0) {
                    const line = buffer.slice(0, index).replace(/\r$/, "");
                    buffer = buffer.slice(index + 1);
                    if (line.startsWith(":")) {
                      internal(client).emit("stream.alive");
                      options.onContact?.({
                        open: true,
                        last_heard: clock.now(),
                      });
                    } else if (line.startsWith("data:"))
                      data.push(line.slice(5).replace(/^ /, ""));
                    else if (line === "" && data.length) {
                      let event: AtlasEvent;
                      try {
                        const input: unknown = JSON.parse(data.join("\n"));
                        data = [];
                        if (
                          !input ||
                          typeof input !== "object" ||
                          !("event_id" in input) ||
                          !Number.isSafeInteger(input.event_id) ||
                          !("time" in input) ||
                          typeof input.time !== "number" ||
                          !("kind" in input) ||
                          typeof input.kind !== "string" ||
                          !(input.kind in EVENT_KINDS) ||
                          !("record" in input)
                        )
                          throw new Error("Invalid event envelope");
                        const spec = EVENT_KINDS[input.kind as EventKind];
                        const records =
                          "many" in spec ? input.record : [input.record];
                        if (!Array.isArray(records))
                          throw new Error("Expected record array");
                        for (const record of records) {
                          const valid = protocol.check(spec.record, record);
                          if (!valid.ok) {
                            internal(client).emit("validation.failed", {
                              name: spec.record,
                              problems: JSON.stringify(valid.problems),
                            });
                            throw new Error(JSON.stringify(valid.problems));
                          }
                        }
                        event = input as AtlasEvent;
                      } catch (error) {
                        return { reason: "invalid_event", error };
                      }
                      if (event.event_id <= cursor) continue;
                      try {
                        idle?.cancel();
                        await handler(event);
                        resetIdle();
                      } catch (error) {
                        return { reason: "handler_failed", error };
                      }
                      cursor = event.event_id;
                      internal(client).emit("stream.handled", { cursor });
                    }
                  }
                }
              } finally {
                idle?.cancel();
                await reader.cancel().catch(() => {});
              }
            }
          } catch {
            /* Network loss is recovered from the last handled cursor. */
          } finally {
            stale = true;
            controller?.abort();
            options.onContact?.({ open: false, last_heard: null });
            internal(client).emit("stream.close", { cursor });
          }
        }
        if (terminal()) break;
        const delay = backoffDelay(
          attempts++,
          internal(client).options.backoff ?? {
            minMs: 500,
            maxMs: 30000,
            factor: 2,
            jitter: 0.2,
          },
        );
        internal(client).emit("stream.reconnect", { delay });
        await new Promise<void>((resolve) => {
          const t = clock.after(delay, resolve);
          wake = () => {
            t.cancel();
            resolve();
          };
        });
        wake = undefined;
      }
      return { reason: terminal() ?? "stopped" };
    } finally {
      idle?.cancel();
      controller?.abort();
      unsubscribe();
    }
  })();
  return {
    get cursor() {
      return cursor;
    },
    get stale() {
      return stale;
    },
    done,
    stop() {
      stopped = true;
      controller?.abort();
      wake?.();
    },
  };
}
