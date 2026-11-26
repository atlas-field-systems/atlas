import * as entities from "../pillars/entities.ts";
import type { Contact } from "../contact.ts";
import { pageAfter } from "../store/events.ts";
import type { ServerResponse } from "node:http";
import type { Clock } from "../clock.ts";
import type { DiagnosticLog } from "../log.ts";
import type { Store } from "../store/db.ts";
import type { Audience } from "../store/events.ts";
import type { Principal } from "./auth.ts";

export function audienceFor(
  principal: Principal,
  query: URLSearchParams,
): Audience {
  const caller = principal.caller;
  if (caller.kind === "account" || query.get("everything") === "true")
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
  open(
    res: ServerResponse,
    audience: Audience,
    after: number | "latest",
    valid: () => boolean,
  ): void;
  closeAll(): void;
}

export function startStreams(
  store: Store,
  clock: Clock,
  keepaliveMs: number,
  log: DiagnosticLog,
  contact: Contact,
): Streams {
  const pendingOffline = store.read(tx => tx.env.pendingOffline);
  const closers = new Set<() => void>();
  const pluginStreams = new Map<string, () => void>();
  return {
    closeAll() {
      for (const close of closers) close();
    },
    open(res, audience, after, valid) {
      const pluginId = audience.kind === "plugin" ? audience.plugin_id : undefined;
      let cursor = pluginId ? 0 : after === "latest" ? store.read((tx) => tx.asOf()) : after,
        closed = false,
        blocked = false;
      let deadline: ReturnType<Clock["after"]> | undefined;
      let keepalive: ReturnType<Clock["after"]> | undefined;
      const close = (replaced = false) => {
        if (closed) return;
        closed = true;
        unsubscribe();
        deadline?.cancel();
        keepalive?.cancel();
        closers.delete(close);
        log.record({
          level: "info",
          area: "api",
          msg: "event stream disconnected",
          route: "/events",
        });
        if (pluginId && !replaced) {
          pluginStreams.delete(pluginId);
          contact.pluginStream(pluginId, false);
        }
        if (replaced) res.end("event: plugin.stream_replaced\n\n");
        else res.destroy();
      };
      const pump = () => {
        if (closed) return;
        if (!valid()) {
          close();
          return;
        }
        if (blocked) return;
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
        } catch (error) {
          log.record({
            level: "error",
            area: "api",
            msg: "event stream failed",
            route: "/events",
            error: String(error),
          });
          close();
        }
      };
      if (pluginId) {
        contact.pluginStream(pluginId, true);
        pluginStreams.get(pluginId)?.();
        pluginStreams.set(pluginId, () => close(true));
      }
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
        const token = !blocked && audience.kind === "everything" && entities.contactStorageToken(pendingOffline);
        if (!blocked && !res.write(token ? `: contact-storage ${token}\n\n` : ": alive\n\n")) {
          blocked = true;
          deadline = clock.after(30000, close);
        }
        keepalive = clock.after(keepaliveMs, alive);
      };
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.flushHeaders();
      log.record({
        level: "info",
        area: "api",
        msg: "event stream connected",
        route: "/events",
      });
      pump();
      keepalive = clock.after(keepaliveMs, alive);
    },
  };
}
