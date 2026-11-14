import assert from "node:assert/strict";
import { follow, type AtlasEvent } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { radioAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "Tasks arrive late reordered and duplicated across radio",
  checks: [
    "simulations/docs/core-and-sdk.md#scenarios",
    "sdk/docs/asset.md#the-queue-helper",
    "core/docs/api.md#asset-and-gateway-calls",
  ],
  async run(w) {
    const radio = await radioAsset(w);
    const requests: AtlasEvent<"tasks.requested">[] = [];
    const stream = follow(radio.client, { after: 0 }, (e) => {
      if (e.kind === "tasks.requested") requests.push(e);
    });
    await w.settle();
    const sent = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id: radio.asset_id },
          body: {
            tasks: [
              { kind: "hold" },
              { kind: "hold" },
              { kind: "return_to_home" },
            ],
          },
        }),
      ),
    );
    assert.deepEqual(sent.task_ids, [1, 2, 3]);
    await w.until(() => requests.length === 1);
    const request = requests[0],
      [one, two, three] = request.record;
    radio.deliver({ ...request, record: [three] });
    await w.advance(100);
    assert.equal(
      radio.session.queue!.next(),
      undefined,
      "late lower Task blocks the radio queue",
    );
    radio.deliver({ ...request, record: [one] });
    await w.advance(100);
    assert.equal(
      radio.session.queue!.next(),
      undefined,
      "send_last blocks before full request arrives",
    );
    radio.deliver({ ...request, record: [two, two] });
    await w.settle();
    const starts: number[] = [];
    for (const expected of [1, 2, 3]) {
      const task = radio.session.queue!.next();
      assert.equal(task?.task_id, expected, "app pulls in task_id order");
      starts.push(task!.task_id);
      radio.session.queue!.finish(expected, "completed");
      await w.settle();
    }
    radio.deliver(request);
    await w.advance(100);
    assert.equal(
      radio.session.queue!.next(),
      undefined,
      "duplicate radio delivery cannot execute again",
    );
    assert.deepEqual(starts, [1, 2, 3]);
    assert.ok(
      radio.reports.some(
        (r) =>
          r.type === "report.status" &&
          r.kind === "queue" &&
          r.request_id === request.event_id,
      ),
      "queue answers the carried request",
    );
    stream.stop();
    radio.close();
  },
});
