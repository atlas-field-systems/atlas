import { internal } from "./internal.ts";
import { EVENT_KINDS } from "@atlas/core/event-kinds";
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { Client } from "./client.ts";
import { backoffDelay, defaultBackoff, type Timer } from "./clock.ts";
// Counted in UTF-16 code units, which never exceed a string's UTF-8 bytes.
const MAX_SSE_FRAME = 16 * 1024 * 1024 + 1024;

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
// Error text and even names can carry credentials, so only a fixed category reaches the observer.
const errorCategories = new Set(["TypeError", "AbortError", "TimeoutError", "SyntaxError", "RangeError"]);
function errorCategory(error: unknown) {
  const name: unknown = error instanceof Error ? error.name : undefined;
  return typeof name === "string" && errorCategories.has(name) ? name : "Error";
}

export function follow(
  client: Client,
  options: {
    after: number;
    asset_id?: string;
    everything?: boolean;
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
    opening: Timer | undefined,
    wake: (() => void) | undefined;
  let lastHeard: number | null = null;
  const heard = () => {
    lastHeard = clock.now();
    options.onContact?.({ open: true, last_heard: lastHeard });
  };
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
          const { signal } = controller;
          try {
            await options.beforeOpen?.();
            if (terminal()) break;
            opening = clock.after(
              internal(client).options.requestTimeoutMs ?? 10000,
              () => {
                if (signal.aborted) return;
                internal(client).emit("stream.open_timeout", { cursor });
                controller?.abort();
              },
            );
            const response = await internal(client).streamFetch(
              cursor,
              { asset_id: options.asset_id, everything: options.everything },
              signal,
            );
            opening.cancel();
            if (!response.ok) {
              await internal(client).streamResponse(response);
            } else if (!response.body)
              return { reason: "invalid_event", error: "Missing stream body" };
            else {
              stale = false;
              attempts = 0;
              internal(client).emit("stream.open");
              const reader = response.body.getReader(),
                decoder = new TextDecoder();
              let buffer = "",
                data: string[] = [],
                frameLength = 0;
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
              let interrupted = false;
              try {
                heard();
                while (!terminal()) {
                  const chunk = await reader.read().catch((error: unknown) => {
                    interrupted = true;
                    throw error;
                  });
                  if (chunk.done) break;
                  resetIdle();
                  buffer += decoder.decode(chunk.value, { stream: true });
                  let index: number;
                  while (!terminal() && (index = buffer.indexOf("\n")) >= 0) {
                    frameLength += index + 1;
                    if (frameLength > MAX_SSE_FRAME)
                      return {
                        reason: "invalid_event",
                        error: "SSE frame too large",
                      };
                    const line = buffer.slice(0, index).replace(/\r$/, "");
                    buffer = buffer.slice(index + 1);
                    if (line === "") frameLength = 0;
                    if (line.startsWith(":")) {
                      internal(client).emit("stream.alive");
                      heard();
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
                      heard();
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
                  if (frameLength + buffer.length > MAX_SSE_FRAME)
                    return {
                      reason: "invalid_event",
                      error: "SSE frame too large",
                    };
                }
              } finally {
                idle?.cancel();
                // An errored stream cannot be cancelled; every other exit releases its source.
                if (interrupted) reader.releaseLock();
                else {
                  // A source that never settles its cancellation must not hold up a stop, and
                  // the outer cleanup aborts the signal before a rejection lands, so decide now.
                  const report = !signal.aborted && !terminal();
                  const at = cursor;
                  void reader.cancel().catch(() => {
                    if (report) internal(client).emit("stream.reader_cancel_failed", { cursor: at });
                  });
                }
              }
            }
          } catch (error) {
            if (!signal.aborted && !terminal())
              internal(client).emit("stream.interrupted", { cursor, error: errorCategory(error) });
          } finally {
            opening?.cancel();
            stale = true;
            controller?.abort();
            options.onContact?.({ open: false, last_heard: lastHeard });
            internal(client).emit("stream.close", { cursor });
          }
        }
        if (terminal()) break;
        const delay = backoffDelay(
          attempts++,
          internal(client).options.backoff ?? defaultBackoff,
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
      opening?.cancel();
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
