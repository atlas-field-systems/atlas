import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { startApp, parseConfig } from "@atlas/asset";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
scenario({
  name: "Asset archives a blocked outbox and session end",
  checks: ["asset/docs/logging.md#record-decisions-and-observed-equipment-behavior", "sdk/docs/asset.md#running-over-any-link"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 1 } },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    const app = await w.complete(startApp(config, { clock: w.clock, fetch: w.network.fetchFor("app") }));
    w.network.once("app", `/entities/assets/${app.asset_id}/reports`, { kind: "refuse", status: 400 });
    await w.advance(config.reporting.heartbeat_s * 1000 + 1);
    const path = await w.complete(app.stop());
    const zip = unzipSync(await readFile(path));
    const diagnostics = Object.entries(zip).filter(([name]) => name.startsWith("diagnostics/")).map(([, bytes]) => strFromU8(bytes)).join("");
    assert.match(diagnostics, /"kind":"outbox_blocked"/);
    assert.match(diagnostics, /"kind":"session_ended"/);
  },
});
