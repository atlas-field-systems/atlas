import assert from "node:assert/strict";
import { startAsset } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { ipAsset, description } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "restarted Asset keeps identity drops unfinished work and runs new Tasks",
  checks: [
    "core/docs/api.md#operator-requests",
    "core/docs/api.md#asset-and-gateway-calls",
  ],
  async run(w) {
    const asset = await ipAsset(w);
    const asset_id = asset.session.asset_id;
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => asset.session.queue!.held().length === 1);
    asset.session.stop();
    const restarted = value(
      await w.complete(
        startAsset(asset.client, {
          description,
          clock: w.clock,
          settings: () => ({}),
          queue: { runNow() {}, stop() {}, update() {} },
        }),
      ),
    );
    w.onClose(() => restarted.stop());
    assert.equal(restarted.asset_id, asset_id);
    const tasks = value(
      await w.complete(w.admin.call("tasks", { params: { asset_id } })),
    );
    assert.equal(tasks.items[0].state, "dropped");
    const sent = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    assert.deepEqual(sent.task_ids, [2]);
    await w.until(() => restarted.queue!.held().length === 1);
    assert.equal(restarted.queue!.next()!.task_id, 2);
    restarted.queue!.finish(2, "completed");
  },
});
