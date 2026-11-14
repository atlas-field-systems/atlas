import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "offline Asset skips unanswered Tasks settings and cancels",
  checks: ["core/docs/api.md#operator-requests", "core/docs/api.md#contact"],
  async run(w) {
    const asset = await ipAsset(w);
    const asset_id = asset.session.asset_id;
    await w.until(() => w.diagnostics.some((e) => e.name === "stream.open"));
    w.network.cut("asset");
    const task = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    const setting = value(
      await w.complete(
        w.admin.call("changeSettings", {
          params: { asset_id },
          body: { settings: { lights: "on" } },
        }),
      ),
    );
    const cancel = value(
      await w.complete(
        w.admin.call("cancel", { params: { asset_id, task_id: 1 } }),
      ),
    );
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
          e.record.contact === "online" &&
          e.event_id > cancel.event_id,
      ),
    );
    assert.equal(
      asset.session.queue!.next(),
      undefined,
      "dropped Task never runs late",
    );
    const next = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    assert.deepEqual(next.task_ids, [2]);
    await w.until(() => asset.session.queue!.held().includes(2));
    assert.equal(
      asset.session.queue!.next()!.task_id,
      2,
      "drop unblocks later work",
    );
    asset.session.queue!.finish(2, "completed");
  },
});
