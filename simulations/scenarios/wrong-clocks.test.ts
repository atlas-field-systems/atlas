import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "clock-ahead reports remain history and never latest",
  checks: [
    "core/docs/api.md#asset-and-gateway-calls",
    "core/docs/api.md#reads",
  ],
  async run(w) {
    const asset = await ipAsset(w);
    const asset_id = asset.session.asset_id;
    const params = { asset_id };
    const now = w.clock.now();
    value(
      await w.complete(
        asset.client.call("sendReports", {
          params,
          body: {
            reports: [
              {
                type: "report.settings",
                time: now,
                asset_id,
                settings: { lights: "off" },
              },
              {
                type: "report.settings",
                time: w.clock.shifted(60000).now(),
                asset_id,
                settings: { lights: "on" },
              },
            ],
          },
        }),
      ),
    );
    await w.until(() =>
      w.events.some(
        (e) => e.kind === "report.settings" && e.clock_ahead === true,
      ),
    );
    const picture = value(await w.complete(w.admin.call("asset", { params })));
    assert.equal(picture.item.settings.lights.value, "off");
    const history = [];
    const pages = w.admin
      .history({ asset_id, report: "settings" })
      [Symbol.asyncIterator]();
    for (;;) {
      const page = await w.complete(pages.next());
      if (page.done) break;
      history.push(...value(page.value).items);
    }
    assert.equal(
      history.filter((e) => e.clock_ahead).length,
      1,
      "future evidence is retained",
    );
  },
});
