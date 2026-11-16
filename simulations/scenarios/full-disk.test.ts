import { checkAnchors, recordFailure } from "../src/scenario.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetApp } from "../src/asset-app.ts";
import { reportingPeripheral } from "../src/peripheral.ts";
import { value } from "../src/world.ts";
import type { Traffic } from "../src/network.ts";
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
  let w: Awaited<ReturnType<typeof createWorld>> | undefined;
  let filler: Awaited<ReturnType<typeof open>> | undefined;
  try {
    w = await createWorld({ data_directory: join(mount, "data") });
    const files = await reportingPeripheral(w, { name: "files" });
    const startup = await assetApp(w, { name: "full-disk-asset" });
    await startup.stop();
    const attempts = w.network.traffic.length;
    filler = await open(join(mount, "fill"), "w");
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
    await assert.rejects(() => startup.restart(), /Core could not store the change/);
    const startupTraffic = w.network.traffic.slice(attempts).filter(t => t.caller === "full-disk-asset");
    assert.equal(startupTraffic.length, 1, "a definitive startup refusal is not retried");
    assert.equal(startupTraffic[0].status, 507);
    assert.ok(JSON.stringify(startupTraffic[0].response).includes("storage_full"));
    for (const [place, path] of [
      [undefined, "/objects"],
      [{ kind: "point" as const, position: { latitude: 1, longitude: 2 } }, "/entities/geofeatures"],
    ] as const) {
      const count = w.network.traffic.length;
      files.send({ kind: "file", name: "capture.txt", contentType: "text/plain",
        base64: Buffer.from("field evidence").toString("base64"), place });
      const isRefused = (t: Traffic) => t.caller === "files" && t.path === path && t.status === 507;
      await w.until(() => w!.network.traffic.slice(count).some(isRefused));
      const refused = w.network.traffic.slice(count).find(isRefused);
      assert.ok(JSON.stringify(refused?.response).includes("storage_full"));
    }
    assert.equal(
      w.network.traffic.filter(
        (t) => t.caller === "files" && t.path === "/objects",
      ).length,
      1,
    );
    assert.equal(
      w.network.traffic.filter(
        (t) => t.caller === "files" && t.path === "/entities/geofeatures",
      ).length,
      1,
    );
    await w.settle();
    assert.equal(
      w.events.filter((e) => e.kind === "geofeature.created").length,
      0,
    );
  } catch (error) {
    if (w) await recordFailure("full-disk", checks, error, w.root, w.trace);
    throw error;
  } finally {
    try {
      try {
        await filler?.close();
      } finally {
        try {
          await rm(join(mount, "fill"), { force: true });
        } finally {
          await w?.close();
        }
      }
    } finally {
      await execute("sudo", ["-n", "umount", mount]);
      await rm(mount, { recursive: true });
    }
  }
});
