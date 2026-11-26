import { createLivePicture } from "@atlas/sdk";
import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { radioAsset } from "../src/actors.ts";
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
    assert.equal(picture.item.settings.run_state, undefined);
    assert.equal(
      live.assets().items.find((a) => a.asset_id === asset_id)?.settings.run_state,
      undefined,
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


scenario({
  name: "settings follow arrival when a radio Asset corrects its clock",
  checks: ["core/docs/api.md#reads"],
  async run(w) {
    const radio = await radioAsset(w);
    const params = { asset_id: radio.asset_id };
    const live = createLivePicture(w.admin);
    w.onClose(() => live.stop());
    await w.until(() => live.assets().ready);
    const now = w.clock.now();
    for (const [time, lights] of [[now, "on"], [now - 1000, "off"]] as const) {
      value(await w.complete(radio.client.call("sendReports", {
        params, body: { reports: [{ type: "report.settings", ...params, time, settings: { lights } }] },
      })));
      await w.until(() => live.assets().items.find(a => a.asset_id === radio.asset_id)?.settings.lights?.value === lights);
      const snapshot = value(await w.complete(w.admin.call("asset", { params })));
      assert.deepEqual(snapshot.item.settings.lights, { value: lights, time });
    }
  },
});
