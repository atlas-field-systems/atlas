import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, parseConfig } from "@atlas/asset";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
scenario({
  name: "A reporting-only stationary Asset keeps its installed position current",
  checks: ["asset/docs/README.md#position-and-home", "asset/docs/README.md#start-and-connect"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
      description: { reports: ["telemetry"], commands: [] }, initial_settings: {},
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
      log_directory: join(w.root, "stationary"), archive_directory: join(w.root, "archives") });
    const app = await w.complete(startApp(config, { clock: w.clock, fetch: w.network.fetchFor("stationary") }));
    try {
      await w.advance(config.measurement_stale_after_s * 2000);
      const picture = value(await w.complete(w.admin.call("entities")));
      assert.equal(picture.assets.length, 1);
      const telemetry = w.events.filter(e => e.kind === "report.telemetry").at(-1);
      assert.ok(telemetry && telemetry.record.type === "report.telemetry");
      assert.deepEqual(telemetry.record.position, { latitude: 1, longitude: 2 });
      assert.ok(telemetry.record.time > w.clock.now() - config.measurement_stale_after_s * 1000);
      assert.equal(w.events.some(e => e.kind === "report.settings" || e.kind === "report.queue"), false);
    } finally { await w.complete(app.stop()); }
  },
});
