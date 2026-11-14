import { checkAnchors, recordFailure } from "../src/scenario.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAsset } from "@atlas/sdk";
import { description } from "../src/actors.ts";
import { value } from "../src/world.ts";
import { createWorld } from "../src/world.ts";
const execute = promisify(execFile);
test("full disk refuses a change without a partial event [core/docs/storage.md#memory-and-full-disks]", async (t) => {
  const checks = ["core/docs/storage.md#memory-and-full-disks"];
  await checkAnchors(checks);
  const mount = await mkdtemp(join(tmpdir(), "atlas-full-"));
  try {
    await execute("sudo", [
      "-n",
      "mount",
      "-t",
      "tmpfs",
      "-o",
      "size=8m",
      "tmpfs",
      mount,
    ]);
  } catch (error) {
    await rm(mount, { recursive: true });
    t.skip(`tmpfs unavailable: ${String(error)}`);
    return;
  }
  const w = await createWorld({ data_directory: join(mount, "data") });
  const issued = value(await w.complete(w.admin.call("createAssetKey")));
  assert.ok("key" in issued);
  const asset = w.client("full-disk-asset", { kind: "asset", key: issued.key });
  const filler = await open(join(mount, "fill"), "w");
  try {
    try {
      while (true) await filler.write(new Uint8Array(65536));
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOSPC");
    }
    const result = await w.complete(
      w.admin.call("createGeofeature", {
        body: { kind: "point", position: { latitude: 1, longitude: 2 } },
      }),
    );
    assert.ok(
      !result.ok && result.status === 507 && result.error === "storage_full",
    );
    const before = w.clock.now();
    const startup = await w.complete(
      startAsset(asset, {
        clock: w.clock,
        description,
        settings: () => ({}),
      }),
    );
    assert.ok(
      !startup.ok &&
        "status" in startup &&
        startup.status === 507 &&
        startup.error === "storage_full",
    );
    assert.equal(
      w.clock.now(),
      before,
      "a definitive refusal returns without retrying",
    );
    assert.equal(
      w.network.traffic.filter(
        (t) => t.caller === "full-disk-asset" && t.path === "/entities/assets",
      ).length,
      1,
    );
    await w.settle();
    assert.equal(
      w.events.filter((e) => e.kind === "geofeature.created").length,
      0,
    );
  } catch (error) {
    await recordFailure("full-disk", checks, error, w.root, w.trace);
    throw error;
  } finally {
    await filler.close();
    await rm(join(mount, "fill"));
    await w.close();
    await execute("sudo", ["-n", "umount", mount]);
    await rm(mount, { recursive: true });
  }
});
