import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { assetApp } from "../src/asset-app.ts";
import { value } from "../src/world.ts";
scenario({
  name: "offline Asset skips unanswered Tasks settings and cancels",
  checks: ["core/docs/api.md#operator-requests", "core/docs/api.md#contact"],
  async run(w) {
    w.network.once("asset", "/events", { kind: "blackholeStream" });
    const asset = await assetApp(w, { config: { description: { commands: [], reports: ["status", "settings"], settings: ["run_state"] }, initial_settings: { run_state: "running" } } });
    const asset_id = asset.asset_id;
    await w.until(() => w.events.some(e => e.kind === "asset.contact" && e.record.asset_id === asset_id && e.record.command_stream_open));
    const task = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "settings", settings: { run_state: "running" } }] },
        }),
      ),
    );
    const setting = value(
      await w.complete(
        w.admin.call("changeSettings", {
          params: { asset_id },
          body: { settings: { run_state: "paused" } },
        }),
      ),
    );
    const cancel = value(
      await w.complete(
        w.admin.call("cancel", { params: { asset_id, task_id: 1 } }),
      ),
    );
    w.network.cut("asset");
    await w.advance(31000);
    await w.until(
      () => w.events.filter((e) => e.kind === "request.dropped").length >= 3,
    );
    assert.deepEqual(
      w.events
        .filter((e) => e.kind === "request.dropped")
        .map((e) => e.record.request_id),
      [task.event_id, setting.event_id, cancel.event_id],
    );
    w.network.heal("asset");
    await w.until(() =>
      w.events.some(
        (e) =>
          e.kind === "asset.contact" &&
          e.record.contact === "online" && e.record.command_stream_open &&
          e.event_id > cancel.event_id,
      ),
    );
    assert.equal(w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 1 && e.record.task_state === "active"), false, "dropped Task never runs late");
    const next = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "settings", settings: { run_state: "running" } }] },
        }),
      ),
    );
    assert.deepEqual(next.task_ids, [2]);
    await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 2 && e.record.task_state === "completed"));
  },
});
