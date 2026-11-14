import * as entities from "./pillars/entities.ts";
import * as admin from "./pillars/administration.ts";
import { dropUnsettled } from "./store/events.ts";
import { Refusal } from "./api/errors.ts";
/**
 * Core's view of contact (api.md#contact) for Assets on IP, gateways, and
 * Plugins. Not a pillar: it holds no stored state. The stored online/offline
 * state lives in the owning pillars' tables and changes only through
 * Entities.applyContact, Administration.setGatewayContact, and
 * Administration.setPluginContact, each in a transaction with its event.
 *
 * What it keeps is in memory: when each subject was last heard. That is
 * deliberate. reset.md#when-core-stops-unexpectedly says a resumed run starts
 * its contact view again ("not heard within offline_after_s of the start shows
 * offline"), so last-heard times need not survive a crash, and keeping them in
 * memory saves a database write on every request a gateway, Plugin, or Asset makes.
 *
 * One timer, on the injected clock, set for the earliest deadline
 * (lastHeard + offline_after_s). When it fires, every subject past its
 * deadline goes offline in one transaction each, then the timer is set again.
 * That is the only timer behind "unanswered requests end when the Asset goes
 * offline" and "Core ends every call [a Plugin] has not answered": the drops
 * are written by the offline transition, so they survive a crash with it.
 *
 * Radio Assets have no deadline here: their gateway's contact records decide,
 * and when the gateway goes offline, every Asset it carries goes offline in
 * the gateway's transaction.
 */
import type { Clock } from "./clock.ts";
import type { Store } from "./store/db.ts";

export type Subject =
  { asset_id: string } | { gateway_id: string } | { plugin_id: string };

export interface Contact {
  /**
   * Every authenticated request from an Asset key (with a registered Asset), a
   * gateway key, or a Plugin key, including GET /about, excluding event streams.
   * Records the time; if
   * the stored state is offline, writes the online transition now, before the
   * request's own change, so its event comes first.
   */
  heard(who: Subject): void;
  /** At start: every subject the current run shows online gets lastHeard = now. */
  resume(): void;
  stop(): void;
  lastHeard(asset_id: string): number | undefined;
}

export function startContact(
  store: Store,
  clock: Clock,
  offlineAfterMs: number,
): Contact {
  const heard = new Map<
    string,
    { who: Subject; at: number; retryAt?: number }
  >();
  const lastHeard = new Map<string, number>();
  let timer: ReturnType<Clock["after"]> | undefined;
  let stopped = false;
  const key = (who: Subject) =>
    "asset_id" in who
      ? `asset:${who.asset_id}`
      : "gateway_id" in who
        ? `gateway:${who.gateway_id}`
        : `plugin:${who.plugin_id}`;
  function transition(
    who: Subject,
    state: "online" | "offline",
    at: number,
  ): void {
    store.write((tx) => {
      if ("asset_id" in who)
        entities.applyContact(tx, who.asset_id, {
          time: at,
          ...who,
          contact: state,
        });
      else if ("gateway_id" in who) {
        if (
          admin.setGatewayContact(tx, who.gateway_id, state, at) &&
          state === "offline"
        )
          for (const asset_id of entities.carriedBy(tx, who.gateway_id))
            entities.applyContact(tx, asset_id, {
              time: at,
              asset_id,
              contact: state,
            });
      } else if (
        admin.setPluginContact(tx, who.plugin_id, state, at) &&
        state === "offline"
      )
        dropUnsettled(tx, who);
    });
  }
  function schedule(): void {
    timer?.cancel();
    if (stopped || !heard.size) return;
    const deadline = Math.min(
      ...Array.from(heard.values(), (v) => v.retryAt ?? v.at + offlineAfterMs),
    );
    timer = clock.after(Math.max(1, deadline - clock.now()), () => {
      for (const [id, v] of heard)
        if ((v.retryAt ?? v.at + offlineAfterMs) <= clock.now()) {
          try {
            transition(v.who, "offline", v.at);
            heard.delete(id);
          } catch (error) {
            if (error instanceof Refusal && error.code === "not_found")
              heard.delete(id);
            else {
              store.read((tx) =>
                tx.env.log.record({
                  level: "error",
                  area: "contact",
                  msg: "Offline transition failed",
                  error: String(error),
                }),
              );
              v.retryAt = clock.now() + Math.min(1000, offlineAfterMs);
            }
          }
        }
      schedule();
    });
  }
  return {
    heard(who) {
      if (stopped) return;
      transition(who, "online", clock.now());
      if ("asset_id" in who) lastHeard.set(who.asset_id, clock.now());
      heard.set(key(who), { who, at: clock.now() });
      schedule();
    },
    resume() {
      const subjects = store.read((tx) => {
        const ids = admin.onlineGatewaysAndPlugins(tx);
        return [
          ...entities.onlineAssetsOnIp(tx).map((asset_id) => ({ asset_id })),
          ...ids.gateway_ids.map((gateway_id) => ({ gateway_id })),
          ...ids.plugin_ids.map((plugin_id) => ({ plugin_id })),
        ];
      });
      for (const who of subjects) heard.set(key(who), { who, at: clock.now() });
      schedule();
    },
    lastHeard(asset_id) {
      return lastHeard.get(asset_id);
    },
    stop() {
      stopped = true;
      timer?.cancel();
      heard.clear();
    },
  };
}
