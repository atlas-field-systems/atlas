import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
import { reportingPeripheral } from "../src/peripheral.ts";

scenario({
  name: "Asset sends one startup and one reconnect batch",
  checks: ["core/docs/api.md#asset-and-gateway-calls"],
  async run(w) {
    const { app: asset } = await reportingPeripheral(w, { config: {
      description: { commands: [], reports: ["status", "settings"], settings: ["run_state"] },
      initial_settings: { run_state: "running" },
    } });
    const path = `/entities/assets/${asset.asset_id}/reports`;
    const batches = () => w.network.traffic.filter(t => t.path === path);
    await w.until(() => w.network.traffic.some(t => t.caller === "asset" && t.path === "/events"));
    assert.equal(batches().length, 1, "step 3 runs once on startup");
    w.network.dropStreams("asset");
    await w.until(() => batches().length === 2);
    assert.equal(batches().length, 2, "step 3 runs once before reopening");
    // Hold the request answer while the app executes the settings Task.
    w.network.once("asset", path, { kind: "delay", ms: 1000 });
    w.network.once("asset", path, { kind: "loseResponse" });
    value(await w.complete(w.admin.call("sendTasks", {
      params: { asset_id: asset.asset_id },
      body: { tasks: [{ kind: "settings", settings: { run_state: "running" } }] },
    })));
    const finals = () => batches().filter(t => JSON.stringify(t.body).includes('"task_state":"completed"'));
    await w.until(() => finals().length >= 2 && finals().at(-1)?.status === 200);
    const sent = finals();
    assert.ok(sent.every(t => JSON.stringify(t.body) === JSON.stringify(sent[0].body)), "final bytes never change");
    assert.equal(new Set(sent.map(t => t.key)).size, 1, "unacknowledged final stays in its original immutable batch");
  },
});
