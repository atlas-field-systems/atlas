import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "admission uses latest reported queue and admits now at capacity",
  checks: [
    "core/docs/requests.md#scenario-paused-work-at-capacity",
    "core/docs/requests.md#scenario-now-at-capacity",
  ],
  async run(w) {
    const asset = await ipAsset(w);
    const params = { asset_id: asset.session.asset_id };
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: {
            tasks: Array.from({ length: 63 }, () => ({
              kind: "hold" as const,
            })),
          },
        }),
      ),
    );
    await w.until(() => asset.session.queue!.held().length === 63);
    await w.complete(asset.session.outbox.flush());
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => asset.session.queue!.held().length === 64);
    await w.complete(asset.session.outbox.flush());
    const full = await w.complete(
      w.admin.call("sendTasks", {
        params,
        body: { tasks: [{ kind: "hold" }] },
      }),
    );
    assert.ok(!full.ok && full.error === "queue_full" && full.status === 409);
    value(
      await w.complete(
        w.admin.call("cancel", { params: { ...params, task_id: 1 } }),
      ),
    );
    await w.until(() => asset.session.queue!.held().length === 63);
    await w.complete(asset.session.outbox.flush());
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => asset.session.queue!.held().length === 64);
    await w.complete(asset.session.outbox.flush());
    const now = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "return_to_home" }], now: true },
        }),
      ),
    );
    assert.deepEqual(now.task_ids, [66], "refusal assigns no Task ID");
    await w.until(() => asset.starts.length === 1);
    assert.deepEqual(asset.starts, [66]);
    assert.deepEqual(asset.session.queue!.held(), []);
    asset.session.queue!.finish(66, "completed");
  },
});
