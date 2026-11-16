import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
import { reportingPeripheral } from "../src/peripheral.ts";

scenario({
  name: "Asset sends one startup and one reconnect batch",
  checks: ["core/docs/api.md#asset-and-gateway-calls", "sdk/docs/asset.md#report-outbox"],
  demo: [
    "The Asset registers and sends its startup reports once.",
    "After its event stream drops, the Asset sends one reconnect batch.",
    "An operator sends a settings Task, and the Asset reports completion.",
    "The network loses the acknowledgement of that final report, then drops the stream again.",
    "The Asset retries the unchanged report batch across reconnection; Core records the completion once.",
  ],
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
    const streams = () => w.network.traffic.filter(t => t.caller === "asset" && t.path === "/events");
    await w.until(() => streams().length === 2 && streams().at(-1)?.status === 200);
    // Keep the final in its own batch, then hold its retry across rejoin.
    w.network.once("asset", path, { kind: "delay", ms: 1000 });
    w.network.once("asset", path, { kind: "loseResponse" });
    w.network.once("asset", path, { kind: "delay", ms: 5000 });
    value(await w.complete(w.admin.call("sendTasks", {
      params: { asset_id: asset.asset_id },
      body: { tasks: [{ kind: "settings", settings: { run_state: "running" } }] },
    })));
    const finals = () => batches().filter(t => JSON.stringify(t.body).includes('"task_state":"completed"'));
    await w.until(() => finals().length === 1 && finals()[0].status === 200);
    assert.equal(finals()[0].fault?.kind, "loseResponse", "final is committed but unacknowledged");
    w.network.dropStreams("asset");
    await w.until(() => streams().length === 3 && streams().at(-1)?.status === 200);
    const sent = finals();
    assert.ok(sent.length >= 2, "final requires a retry across reconnect");
    assert.equal(sent.at(-1)?.status, 200, "final acknowledged before stream reopens");
    assert.ok(sent.every(t => JSON.stringify(t.body) === JSON.stringify(sent[0].body)), "final bytes never change");
    assert.equal(new Set(sent.map(t => t.key)).size, 1, "unacknowledged final stays in its original immutable batch");
    await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_state === "completed"));
    assert.equal(w.events.filter(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_state === "completed").length, 1, "Core records the final once");
  },
});
