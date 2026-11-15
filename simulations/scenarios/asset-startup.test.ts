import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
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
    const directory = join(config.log_directory, String(start), "diagnostics");
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

scenario({
  name: "Asset CLI exits unsuccessfully when shutdown cannot archive evidence",
  checks: ["asset/docs/logging.md#export-the-assets-reset-zip"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/tracker.json", import.meta.url), "utf8"));
    const archive = join(w.root, "not-a-directory");
    await writeFile(archive, "archive destination unavailable");
    const configPath = join(w.root, "asset.json");
    await writeFile(configPath, JSON.stringify({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
      log_directory: join(w.root, "asset-logs"), archive_directory: archive }));
    const child = spawn(process.execPath, [fileURLToPath(new URL("../../asset/src/main.ts", import.meta.url)), "run", configPath]);
    w.onClose(() => child.kill("SIGKILL"));
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    const closed = once(child, "close");
    const [ready] = await once(child.stdout, "data");
    assert.ok(JSON.parse(String(ready)).asset_id);
    child.kill("SIGTERM");
    const [code] = await closed;
    assert.match(stderr, /EEXIST/);
    assert.equal(code, 1);
    assert.equal((await readdir(join(w.root, "asset-logs"))).length, 1);
  },
});

for (const threshold of [6, 7, 8]) scenario({
  name: `Asset startup compares link-loss ${threshold}s with Core keepalive 7s`,
  checks: ["core/docs/api.md#contact"],
  config: { stream_keepalive_s: 7 },
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
      initial_settings: { ...raw.initial_settings, link_loss_after_s: threshold },
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    const result = await w.complete(startApp(config, { clock: w.clock, fetch: w.network.fetchFor("app") })
      .then(app => ({ app }), error => ({ error })));
    if ("app" in result) {
      await w.complete(result.app.stop());
      assert.ok(threshold > 7, "startup must refuse a threshold at or below Core keepalive");
    } else {
      assert.ok(threshold <= 7);
      assert.match(String(result.error), /link_loss_after_s.*stream_keepalive_s/);
    }
  },
});

scenario({
  name: "Asset bounds pre-registration reports and archives their gap",
  checks: ["asset/docs/logging.md#when-logging-cannot-keep-up"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    w.onClose(() => { server.close(); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const connected = once(server, "connection");
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/tracker.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url }, log_queue_limit: 2,
      description: { commands: [], reports: ["observation"] }, initial_settings: {},
      equipment: { kind: "peripheral", host: "127.0.0.1", port: address.port, max_message_bytes: 65536, reconnect_s: 1 },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    w.network.cut("app");
    const attempting = Promise.withResolvers<void>();
    const net = w.network.fetchFor("app");
    const start = w.clock.now();
    const starting = startApp(config, { clock: { now: () => w.clock.now(), after: (ms, fn) => w.clock.after(Math.ceil(ms), fn) }, fetch: (input, init) => { attempting.resolve(); return net(input, init); } });
    await w.complete(attempting.promise);
    const [peer] = await connected;
    w.onClose(() => peer.destroy());
    const operation = join(config.log_directory, String(start), "reports", "history.jsonl");
    for (let i = 0; i < 10; i++) {
      peer.write(JSON.stringify({ kind: "observation", source: "detector", observation: {
      type: "report.observation", kind: "coordinates", observation_id: String(i), time: w.clock.now(), position: { latitude: 1, longitude: 2 },
      } }) + "\n");
      let acquired = false;
      for (let attempt = 0; attempt < 100 && !acquired; attempt++) {
        const history = await readFile(operation, "utf8").catch(() => "");
        acquired = history.includes(`"observation_id":"${i}"`);
        if (!acquired) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(acquired, `the peripheral acquired observation ${i} before Core registration`);
    }
    await w.advance(1000);
    w.network.heal("app");
    const app = await w.complete(starting);
    await w.advance(1000);
    const zip = unzipSync(await readFile(await w.complete(app.stop())));
    const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
    const gap = manifest.gaps.find((g: { reason: string }) => g.reason === "pre-registration report queue full");
    assert.equal(gap?.dropped, 8);
    assert.equal(w.events.filter(e => e.kind === "report.observation").length, 2);
  },
});
