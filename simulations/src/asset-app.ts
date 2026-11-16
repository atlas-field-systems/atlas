import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig, startApp } from "@atlas/asset";
import type { Clock } from "@atlas/sdk";
import { value, type World } from "./world.ts";

import { ardupilotPeer } from "./ardupilot-peer.ts";

type Config = ReturnType<typeof parseConfig>;
export interface AssetAppOptions {
  name?: string;
  equipment?: "ardupilot";
  clock?: Clock;
  config?: Partial<Omit<Config, "asset_key" | "link" | "log_directory" | "archive_directory">>;
}
export type SimulatedAssetApp = Awaited<ReturnType<typeof assetApp>>;

/** A production app with world-owned time, transport, storage and equipment. */
export async function assetApp(w: World, options: AssetAppOptions = {}) {
  const name = options.name ?? "asset";
  const issued = value(await w.complete(w.admin.call("createAssetKey")));
  if (!("key" in issued)) throw new Error("Issuance returned no key");
  const raw: unknown = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
  const defaults = parseConfig(raw);
  const equipment = options.equipment === "ardupilot" ? await ardupilotPeer(w) : undefined;
  let config = parseConfig({
    ...defaults,
    ...(equipment
      ? { equipment: equipment.config }
      : { equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } }, control_tick_s: 1 }),
    ...options.config,
    asset_key: issued.key,
    link: { core_url: w.core.url },
    log_directory: join(w.root, `${name}-logs`),
    archive_directory: join(w.root, `${name}-archives`),
  });
  let clock = options.clock ?? w.clock;
  function start() {
    return w.complete(startApp(config, {
      clock: { now: () => clock.now(), after: (ms, fn) => clock.after(Math.ceil(ms), fn) },
      fetch: w.network.fetchFor(name),
    }));
  }
  let app = await start();
  async function stop() { return w.complete(app.stop()); }
  w.onClose(async () => { await stop(); });
  return {
    equipment,
    get config() { return config; },
    get asset_id() { return app.asset_id; },
    get done() { return app.done; },
    stop,
    async restart(next: Omit<AssetAppOptions, "name" | "equipment"> = {}) {
      await stop();
      clock = next.clock ?? clock;
      config = parseConfig({ ...config, ...next.config });
      app = await start();
    },
    // A separate SDK reader exercises public read permissions; the app owns writes.
    reader() {
      return w.client(`${name}-reader`, { kind: "asset", key: issued.key });
    },
  };
}
