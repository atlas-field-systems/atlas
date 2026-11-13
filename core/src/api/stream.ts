import * as entities from "../pillars/entities.ts";
import { pageAfter } from "../store/events.ts";
import type { ServerResponse } from "node:http";
import type { Clock } from "../clock.ts";
import type { Store } from "../store/db.ts";
import type { Audience } from "../store/events.ts";
import type { Principal } from "./auth.ts";

export function audienceFor(
  principal: Principal,
  query: URLSearchParams,
): Audience {
  const caller = principal.caller;
  if (caller.kind === "account")
    return {
      kind: "everything",
      ...(query.has("asset_id") ? { asset_id: query.get("asset_id")! } : {}),
    };
  if (caller.kind === "plugin")
    return { kind: "plugin", plugin_id: caller.plugin_id };
  return {
    kind: "assets",
    assetIds: (tx) =>
      caller.kind === "gateway"
        ? entities.carriedBy(tx, caller.gateway_id)
        : caller.kind === "asset"
          ? [entities.assetForKey(tx, caller.key_id)].filter(
              (id): id is string => !!id,
            )
          : [],
  };
}

export interface Streams {
  open(res: ServerResponse, audience: Audience, after: number | "latest"): void;
  closeAll(): void;
}

export function startStreams(store: Store, clock: Clock): Streams {
  const closers = new Set<() => void>();
  return {
    closeAll() {
      for (const close of closers) close();
    },
    open(res, audience, after) {
      let cursor = after === "latest" ? store.read((tx) => tx.asOf()) : after,
        closed = false,
        blocked = false;
      let deadline: ReturnType<Clock["after"]> | undefined;
      let keepalive: ReturnType<Clock["after"]> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        deadline?.cancel();
        keepalive?.cancel();
        closers.delete(close);
        res.end();
      };
      const pump = () => {
        if (closed || blocked) return;
        try {
          while (!blocked) {
            const page = store.read((tx) =>
              pageAfter(tx, audience, cursor, 256),
            );
            for (const event of page) {
              const writable = res.write(
                `id: ${event.event_id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
              );
              cursor = event.event_id;
              if (res.writableLength > 1024 * 1024) {
                close();
                return;
              }
              if (!writable) {
                blocked = true;
                deadline = clock.after(30000, close);
                break;
              }
            }
            if (page.length < 256) break;
          }
        } catch {
          close();
        }
      };
      const unsubscribe = store.onCommit(pump);
      closers.add(close);
      res.on("close", close);
      res.on("drain", () => {
        blocked = false;
        deadline?.cancel();
        pump();
      });
      const alive = () => {
        if (closed) return;
        if (!blocked) res.write(": alive\n\n");
        keepalive = clock.after(10000, alive);
      };
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.flushHeaders();
      pump();
      keepalive = clock.after(10000, alive);
    },
  };
}
