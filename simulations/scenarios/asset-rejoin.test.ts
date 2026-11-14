import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
import { ipAsset } from "../src/actors.ts";

scenario({
  name: "Asset sends one startup and one reconnect batch",
  checks: ["core/docs/api.md#asset-and-gateway-calls"],
  async run(w) {
    const asset = await ipAsset(w);
    const path = `/entities/assets/${asset.session.asset_id}/reports`;
    await w.until(() => w.diagnostics.some((e) => e.name === "stream.open"));
    assert.equal(
      w.network.traffic.filter((t) => t.path === path).length,
      1,
      "step 3 runs once on startup",
    );
    w.network.dropStreams("asset");
    await w.until(
      () => w.network.traffic.filter((t) => t.path === path).length === 2,
    );
    assert.equal(
      w.network.traffic.filter((t) => t.path === path).length,
      2,
      "step 3 runs once before reopening",
    );
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id: asset.session.asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => asset.session.queue!.held().length === 1);
    asset.session.queue!.next();
    w.network.once("asset", path, { kind: "loseResponse" });
    asset.session.queue!.finish(1, "completed");
    w.network.dropStreams("asset");
    await w.complete(asset.session.rejoin());
    const finals = w.network.traffic.filter(
      (t) =>
        t.path === path &&
        JSON.stringify(t.body).includes('"task_state":"completed"'),
    );
    assert.ok(finals.length >= 2, "final requires a retry");
    assert.ok(
      finals.every(
        (t) => JSON.stringify(t.body) === JSON.stringify(finals[0].body),
      ),
      "final bytes never change",
    );
    assert.equal(finals.at(-1)?.status, 200, "final acknowledged");
    assert.equal(
      new Set(finals.map((t) => t.key)).size,
      1,
      "unacknowledged final stays in its original immutable batch",
    );
  },
});
