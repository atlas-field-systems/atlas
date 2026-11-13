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
  | { asset_id: string }
  | { gateway_id: string }
  | { plugin_id: string };

export interface Contact {
  /**
   * Every authenticated request from an Asset key (with a registered Asset), a
   * gateway key, or a Plugin key, including GET /about. Records the time; if
   * the stored state is offline, writes the online transition now, before the
   * request's own change, so its event comes first.
   */
  heard(who: Subject): void;
  /** At start: every subject the current run shows online gets lastHeard = now. */
  resume(): void;
  stop(): void;
}

export function startContact(
  store: Store,
  clock: Clock,
  offlineAfterMs: number,
): Contact {
  // TODO: lastHeard = new Map<string, number>() keyed 'asset:<id>' | 'gateway:<id>' | 'plugin:<id>';
  //   one Timer; reschedule(min deadline) after every heard() that sets a new minimum and after each sweep.
  //   sweep(): now = clock.now(); for each key with lastHeard + offlineAfterMs <= now:
  //     asset   → store.write(tx => Entities.applyContact(tx, id, {time: lastHeard, asset_id: id, contact: 'offline'}))
  //     gateway → store.write(tx => { if (Administration.setGatewayContact(tx, id, 'offline', lastHeard))
  //                 for (a of Entities.carriedBy(tx, id)) Entities.applyContact(tx, a, offline record) })
  //     plugin  → store.write(tx => { if (Administration.setPluginContact(tx, id, 'offline', lastHeard))
  //                 dropUnsettled(tx, {plugin_id: id}) })
  //     delete the key.
  //   A Refusal('storage_full') during a sweep is logged and retried at the next sweep: the subject stays
  //   online in storage until the drop can be written, so no change is half-made.
  throw new Error("not implemented");
}
