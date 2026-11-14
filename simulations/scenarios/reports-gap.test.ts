import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "reports after a gap keep original times and history order",
  checks: [
    "core/docs/api.md#asset-and-gateway-calls",
    "core/docs/api.md#reads",
  ],
  async run(w) {
    const asset = await ipAsset(w);
    const asset_id = asset.session.asset_id;
    const original = w.clock.now();
    w.network.cut("asset");
    await w.advance(31000);
    w.network.heal("asset");
    for (const offset of [200, 0, 100]) {
      value(
        await w.complete(
          asset.client.call("sendReports", {
            params: { asset_id },
            body: {
              reports: [
                {
                  type: "report.settings",
                  time: original + offset,
                  asset_id,
                  settings: { lights: offset ? "on" : "off" },
                },
              ],
            },
          }),
        ),
      );
    }
    const times: number[] = [];
    const pages = w.admin
      .history({ asset_id, report: "settings", limit: 1 })
      [Symbol.asyncIterator]();
    for (;;) {
      const page = await w.complete(pages.next());
      if (page.done) break;
      times.push(...value(page.value).items.map((e) => e.record.time));
    }
    assert.deepEqual(
      times,
      [original, original + 100, original + 200],
      "history report time order across pages",
    );
    assert.equal(
      value(await w.complete(w.admin.call("asset", { params: { asset_id } })))
        .item.settings.lights.time,
      original + 200,
    );
  },
});
