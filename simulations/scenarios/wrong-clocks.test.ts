import { createLivePicture, startAsset } from "@atlas/sdk";
import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset, description } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "clock-ahead reports remain history and never latest",
  checks: [
    "core/docs/api.md#asset-and-gateway-calls",
    "core/docs/api.md#reads",
  ],
  async run(w) {
    const shifted = w.clock.shifted(60000);
    const asset = await ipAsset(w, "asset", w.clock, description, {
      lights: "off",
    });
    asset.session.stop();
    const live = createLivePicture(w.admin);
    w.onClose(() => live.stop());
    await w.until(() => live.assets().ready);
    const asset_id = asset.session.asset_id;
    const params = { asset_id };
    const future = value(
      await w.complete(
        startAsset(asset.client, {
          clock: shifted,
          description,
          settings: () => ({ lights: "on" }),
        }),
      ),
    );
    w.onClose(() => future.stop());
    await w.until(() =>
      w.events.some(
        (e) => e.kind === "report.settings" && e.clock_ahead === true,
      ),
    );
    const picture = value(await w.complete(w.admin.call("asset", { params })));
    assert.equal(picture.item.settings.lights.value, "off");
    assert.equal(
      live.assets().items.find((a) => a.asset_id === asset_id)?.settings.lights
        .value,
      "off",
    );
    const history = [];
    const pages = w.admin
      .history({ asset_id, report: "settings" })
      [Symbol.asyncIterator]();
    for (;;) {
      const page = await w.complete(pages.next());
      if (page.done) break;
      history.push(...value(page.value).items);
    }
    const futureReport = history.find(
      (e) => e.kind === "report.settings" && e.clock_ahead,
    );
    assert.ok(futureReport && futureReport.kind === "report.settings");
    assert.equal(futureReport.record.time, shifted.now());
    assert.equal(futureReport.record.settings.lights, "on");
    assert.equal(
      history.filter((e) => e.clock_ahead).length,
      1,
      "future evidence is retained",
    );
  },
});
