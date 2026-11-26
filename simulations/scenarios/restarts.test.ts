import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { assetApp } from "../src/asset-app.ts";
import { value } from "../src/world.ts";
scenario({
  name: "restarted Asset keeps identity drops unfinished work and runs new Tasks",
  checks: [
    "core/docs/api.md#operator-requests",
    "core/docs/api.md#asset-and-gateway-calls",
  ],
  async run(w) {
    const asset = await assetApp(w, { config: { safe_action: { kind: "hold" }, description: { entity_type: "ground_vehicle", commands: ["hold"], reports: ["status", "settings"], settings: ["run_state", "link_loss_after_s", "failsafe_policy"] }, initial_settings: { run_state: "paused", link_loss_after_s: 12, failsafe_policy: [] } } });
    const asset_id = asset.asset_id;
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "queue" && e.record.task_ids.includes(1)));
    await asset.restart();
    assert.equal(asset.asset_id, asset_id);
    const tasks = value(
      await w.complete(w.admin.call("tasks", { params: { asset_id } })),
    );
    assert.equal(tasks.items[0].state, "outcome_unknown");
    const sent = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "settings", settings: { run_state: "running" } }], now: true },
        }),
      ),
    );
    assert.deepEqual(sent.task_ids, [2]);
    await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 2 && e.record.task_state === "completed"));
    assert.equal(w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 1 && e.record.task_state === "active"), false);
  },
});
