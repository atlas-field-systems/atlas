import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, parseConfig } from "@atlas/asset";
import { unzipSync, strFromU8 } from "fflate";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";

scenario({
  name: "Asset control tick survives a transient equipment tick error",
  checks: ["asset/docs/failsafes.md#independent-flight-controller-protections"],
  async run(w) {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    w.onClose(() => { server.close(); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const connected = once(server, "connection");
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
      initial_settings: raw.initial_settings,
      control_tick_s: 0.137, equipment: { ...raw.equipment, port: address.port, heartbeat_s: 0.274 },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    let fail = false, inTick = false, failingTicks = false;
    const clock = {
      now() { if (fail && inTick) { fail = false; throw new Error("transient equipment clock failure"); } return w.clock.now(); },
      after(ms: number, fn: () => void) { return w.clock.after(Math.ceil(ms), () => {
        inTick = ms === config.control_tick_s * 1000;
        if (inTick && failingTicks) fail = true;
        try { fn(); } finally { inTick = false; }
      }); },
    };
    const app = await w.complete(startApp(config, { clock, fetch: w.network.fetchFor("app") }));
    const [peer] = await connected;
    w.onClose(() => peer.destroy());
    let received = 0;
    peer.on("data", (bytes: Buffer) => { received += bytes.length; });
    let archive: string;
    try {
      failingTicks = true;
      value(await w.complete(w.admin.call("changeSettings", { params: { asset_id: app.asset_id }, body: { settings: {
        failsafe_policy: [...raw.initial_settings.failsafe_policy, { rule_id: "IDLE", priority: 1, conditions: [{ kind: "idle", for_s: 1 }], response: { kind: "hold" } }],
      } } })));
      await assert.doesNotReject(w.advance(1000));
      await new Promise(resolve => setImmediate(resolve));
      const before = received;
      await w.advance(3000);
      failingTicks = false;
      assert.ok(w.events.some(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id === "IDLE"), "rules run even when every equipment tick throws");
      await w.advance(1000);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(received > before, "MAVLink heartbeats continue after the failed tick");
    } finally {
      archive = await w.complete(app.stop());
    }
    const zip = unzipSync(await readFile(archive));
    assert.ok(Object.entries(zip).some(([name, bytes]) => name.startsWith("diagnostics/") && strFromU8(bytes).includes("transient equipment clock failure")));
  },
});
