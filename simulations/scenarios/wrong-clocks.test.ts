import { createLivePicture } from "@atlas/sdk";
import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { assetApp } from "../src/asset-app.ts";
import { value } from "../src/world.ts";
scenario({
  name: "clock-ahead reports remain history and never latest",
  checks: [
    "core/docs/api.md#asset-and-gateway-calls",
    "core/docs/api.md#reads",
  ],
  async run(w) {
    const shifted = w.clock.shifted(60000);
    const asset = await assetApp(w, { config: {
      description: { commands: [], reports: ["settings"], settings: ["run_state"] },
      initial_settings: { run_state: "paused" },
    } });
    await asset.stop();
    const live = createLivePicture(w.admin);
    w.onClose(() => live.stop());
    await w.until(() => live.assets().ready);
    const asset_id = asset.asset_id;
    const params = { asset_id };
    await asset.restart({ clock: shifted, config: { initial_settings: { run_state: "running" } } });
    await w.until(() =>
      w.events.some(
        (e) => e.kind === "report.settings" && e.clock_ahead === true,
      ),
    );
    const picture = value(await w.complete(w.admin.call("asset", { params })));
    assert.equal(picture.item.settings.run_state.value, "paused");
    assert.equal(
      live.assets().items.find((a) => a.asset_id === asset_id)?.settings.run_state
        .value,
      "paused",
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
    assert.equal(futureReport.record.settings.run_state, "running");
    assert.equal(
      history.filter((e) => e.clock_ahead).length,
      1,
      "future evidence is retained",
    );
  },
});
