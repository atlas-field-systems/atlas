import assert from "node:assert/strict";
import { createLivePicture, follow } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { ipAsset, plugin, radioAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "Reset fences old attempts clears live picture and rebinds Plugin",
  checks: [
    "core/docs/reset.md#stopping-core-ends-the-run",
    "sdk/docs/client.md#run-changes-and-idle-contact",
    "sdk/docs/live.md#live-picture",
  ],
  async run(w) {
    const asset = await ipAsset(w);
    const radio = await radioAsset(w);
    const p = await plugin(w, () => {});
    const picture = createLivePicture(w.admin);
    w.onClose(() => picture.stop());
    const reader = follow(radio.client, { after: 0 }, () => {});
    w.onClose(() => reader.stop());
    await w.until(
      () => picture.assets().ready && picture.assets().items.length === 2,
    );
    const oldRun = w.core.runId;
    w.network.always("admin", "/entities/geofeatures", {
      kind: "loseResponse",
    });
    // The original attempt commits, then cannot obtain its acknowledgment.
    const pending = w.admin.call("createGeofeature", {
      body: { kind: "point", position: { latitude: 1, longitude: 2 } },
    });
    await w.until(() =>
      w.network.traffic.some(
        (t) => t.path === "/entities/geofeatures" && t.status === 200,
      ),
    );
    let result = await w.complete(pending);
    assert.ok(!result.ok && result.error === "unknown" && result.retry);
    await w.restartCore();
    const boundary = w.network.traffic.length;
    if (!result.ok && result.retry) result = await w.complete(result.retry());
    assert.ok(
      !result.ok && result.error === "run_ended",
      JSON.stringify(result),
    );
    assert.equal((await w.complete(asset.session.done)).reason, "run_ended");
    assert.equal((await w.complete(reader.done)).reason, "run_ended");
    assert.equal(w.admin.status.phase, "run_ended");
    assert.deepEqual(picture.assets().items, []);
    assert.equal(picture.assets().ready, false);
    await w.until(
      () =>
        p.client.status.phase === "connected" &&
        p.client.status.run_id === oldRun + 1,
    );
    assert.ok(
      !w.network.traffic
        .slice(boundary)
        .some((t) => t.path === "/entities/geofeatures"),
      "old attempt never reaches new run",
    );
  },
});
