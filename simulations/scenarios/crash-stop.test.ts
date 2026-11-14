import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPackagedProtocol } from "@atlas/protocol";
import { createClient, systemClock } from "@atlas/sdk";
import { spawnCore } from "../src/core-process.ts";
import { Network } from "../src/network.ts";
import { SimClock } from "../src/clock.ts";
import { value } from "../src/world.ts";

test("crash resumes and deliberate stop archives then starts an empty run [core/docs/reset.md#when-core-stops-unexpectedly]", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-process-"));
  const core = await spawnCore(root);
  const protocol = await loadPackagedProtocol();
  const network = new Network(new SimClock());
  function account() {
    return createClient({
      protocol,
      credential: { kind: "account" },
      clock: systemClock,
      fetch: network.fetchFor("operator"),
      baseUrl: core.url,
    });
  }
  let admin = account();
  try {
    const initial = value(await admin.connect());
    value(await admin.login("ADM", "simulation-password"));
    const place = value(
      await admin.call("createGeofeature", {
        body: {
          kind: "point",
          name: "Before crash",
          position: { latitude: 1, longitude: 2 },
        },
      }),
    );
    const object = value(
      await admin.uploadObject(
        new Uint8Array([1, 2, 3]),
        "application/octet-stream",
        { name: "evidence" },
      ),
    );
    await core.kill();
    await core.start();
    admin.close();
    admin = account();
    assert.equal(value(await admin.connect()).run_id, initial.run_id);
    value(await admin.login("ADM", "simulation-password"));
    assert.equal(
      value(
        await admin.call("geofeature", {
          params: { geofeature_id: place.geofeature.geofeature_id },
        }),
      ).item.name,
      "Before crash",
    );
    assert.equal((await readdir(join(root, "archive"))).length, 0);
    const stopped = await core.stop();
    assert.equal(stopped.code, 0);
    assert.equal(stopped.zips.length, 1);
    const archive = (
      await promisify(execFile)(
        "unzip",
        ["-p", join(root, "archive", stopped.zips[0])],
        { encoding: "buffer" },
      )
    ).stdout;
    for (const secret of network.secrets)
      assert.ok(
        !archive.includes(Buffer.from(secret)),
        "Reset ZIP contains no issued credential",
      );
    assert.ok(
      archive.includes(Buffer.from("Before crash")),
      "ZIP holds old run evidence",
    );
    assert.ok(
      archive.includes(Buffer.from("evidence")),
      "ZIP holds Object file",
    );
    await core.start();
    admin.close();
    admin = account();
    assert.equal(value(await admin.connect()).run_id, initial.run_id + 1);
    value(await admin.login("ADM", "simulation-password"));
    assert.deepEqual(value(await admin.call("entities")).geofeatures, []);
    assert.deepEqual(value(await admin.call("objects")).items, []);
  } finally {
    admin.close();
    network.close();
    await core.stop();
    await rm(root, { recursive: true, force: true });
  }
});
