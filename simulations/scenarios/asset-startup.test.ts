import { createServer } from "node:net";
import { once } from "node:events";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { startApp, parseConfig } from "@atlas/asset";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";

scenario({
  name: "Asset startup refusal seals diagnostics",
  checks: ["asset/docs/assets.md#startup-shutdown-and-installation"],
  async run(w) {
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/tracker.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: "not-provisioned", link: { core_url: w.core.url },
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    await assert.rejects(w.complete(startApp(config, { clock: w.clock, fetch: w.network.fetchFor("app") })));
    const archives = await readdir(config.archive_directory);
    assert.equal(archives.length, 1);
    const zip = unzipSync(await readFile(join(config.archive_directory, archives[0])));
    assert.match(strFromU8(zip["summary.md"]), /startup failed/);
    assert.deepEqual(await readdir(config.log_directory), []);
  },
});

scenario({
  name: "Asset evaluates protection while Core is unreachable and reports it after joining",
  checks: ["asset/docs/failsafes.md#configure-conditions-as-well-as-responses"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
      initial_settings: { ...raw.initial_settings, failsafe_policy: [...raw.initial_settings.failsafe_policy,
        { rule_id: "ID", priority: 1, conditions: [{ kind: "idle", for_s: 0 }], response: { kind: "hold" } }] },
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    w.network.cut("app");
    const start = w.clock.now();
    const connecting = Promise.withResolvers<void>();
    const networkFetch = w.network.fetchFor("app");
    const starting = startApp(config, { clock: { now: () => w.clock.now(), after: (ms, fn) => w.clock.after(Math.ceil(ms), fn) }, fetch: (input, init) => {
      connecting.resolve();
      return networkFetch(input, init);
    } });
    await w.complete(connecting.promise);
    await w.advance(2000);
    const directory = join(config.log_directory, String(start));
    let diagnostics = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      const names = await readdir(directory);
      diagnostics = (await Promise.all(names.map(name => readFile(join(directory, name), "utf8")))).join("");
      if (/"kind":"response".*"rule_id":"ID".*"status":"failed"/.test(diagnostics)) break;
    }
    w.network.heal("app");
    const app = await w.complete(starting);
    try {
      assert.match(diagnostics, /"kind":"response".*"rule_id":"ID".*"status":"failed"/);
      await w.until(() => w.events.some(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id === "ID"));
    } finally { await w.complete(app.stop()); }
  },
});

scenario({
  name: "Asset startup can be stopped before unreachable Core joins",
  checks: ["asset/docs/assets.md#startup-shutdown-and-installation"],
  async run(w) {
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/tracker.json", import.meta.url), "utf8"));
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const connected = once(server, "connection");
    w.onClose(() => { server.close(); });
    const config = parseConfig({ ...raw, link: { core_url: w.core.url },
      equipment: { kind: "peripheral", host: "127.0.0.1", port: address.port, max_message_bytes: 65536, reconnect_s: 1 },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    const controller = new AbortController();
    const connecting = Promise.withResolvers<void>();
    w.network.cut("app");
    const networkFetch = w.network.fetchFor("app");
    const starting = startApp(config, { signal: controller.signal,
      clock: { now: () => w.clock.now(), after: (ms, fn) => w.clock.after(Math.ceil(ms), fn) },
      fetch: (input, init) => { connecting.resolve(); return networkFetch(input, init); } });
    const rejected = assert.rejects(w.complete(starting), /Asset startup stopped/);
    await w.complete(connecting.promise);
    const [peer] = await connected;
    w.onClose(() => peer.destroy());
    const closed = once(peer, "close");
    controller.abort();
    await rejected;
    await w.complete(closed);
    assert.equal((await readdir(config.archive_directory)).length, 1);
    assert.deepEqual(await readdir(config.log_directory), []);
  },
});
