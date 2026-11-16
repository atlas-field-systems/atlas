import assert from "node:assert/strict";
import { startAsset } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { description } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "IP current-state reporting waits for change or heartbeat after acknowledgement",
  checks: ["asset/docs/communications.md#report-from-local-state", "sdk/docs/asset.md#report-outbox"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    let offers = 0;
    let asset_id = "";
    const session = value(await w.complete(startAsset(w.client("current", { kind: "asset", key: key.key }), {
      clock: w.clock, description, settings: () => ({}),
      current: () => {
        if (!asset_id) return [];
        offers++;
        assert.ok(offers <= 2, "IP must wait rather than repeatedly asking for the same current sample");
        return [{ type: "report.battery", asset_id, time: w.clock.now(), battery_percent: 80 }];
      },
    })));
    w.onClose(() => session.stop());
    asset_id = session.asset_id;
    session.outbox.changed();
    await w.settle();
    assert.equal(offers, 1);
    session.outbox.changed();
    await w.settle();
    assert.equal(offers, 2);
  },
});
