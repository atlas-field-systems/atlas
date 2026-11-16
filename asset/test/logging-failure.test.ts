import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { parseConfig } from "../src/config.ts";
import { createLog } from "../src/logging.ts";

for (const target of ["gaps.jsonl", "operation.json", "files/1-image.bin"]) {
  test(`docs/logging.md: interrupted ${target} write preserves honest archive evidence`, { timeout: 10000 }, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "atlas-write-failure-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const config = parseConfig(JSON.parse(await fs.readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
    config.log_directory = join(root, "logs");
    config.archive_directory = join(root, "archives");
    const log = await createLog(config, 1000);
    log.gap(1000, "first gap");
    log.record({ kind: "flush" });
    const directory = join(config.log_directory, "1000");
    while (true) {
      try { await fs.access(join(directory, "gaps.jsonl")); break; }
      catch { await new Promise(resolve => setImmediate(resolve)); }
    }
    const original = fs.writeFile;
    let failed = false;
    t.mock.method(fs, "writeFile", async (...args: Parameters<typeof fs.writeFile>) => {
      if (!failed && String(args[0]).startsWith(join(directory, target))) {
        failed = true;
        await original(args[0], "{", args[2]);
        throw new Error("simulated disk full after partial write");
      }
      return original(...args);
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    if (target.startsWith("files/")) {
      await assert.rejects(log.capture({ name: "image.bin", bytes: Uint8Array.of(1, 2, 3) }));
    } else if (target === "operation.json") {
      log.identify("A");
    } else {
      log.gap(2000, "second gap");
      log.record({ kind: "flush-again" });
    }
    while (!failed) await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    if (target === "operation.json") assert.equal(JSON.parse(await fs.readFile(join(directory, target), "utf8")).start, 1000);
    if (target === "gaps.jsonl") assert.equal(JSON.parse((await fs.readFile(join(directory, target), "utf8")).trim()).reason, "first gap");
    const zip = unzipSync(await fs.readFile(await log.close("A", "stopped")));
    if (target.startsWith("files/")) {
      assert.ok(!Object.keys(zip).some(name => name.startsWith("files/")));
      assert.match(strFromU8(zip["summary.md"]), /capture write failure/);
    }
  });
}

test("docs/logging.md: recovery retains malformed gap bytes and explains the gap", { timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "atlas-torn-gap-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await fs.readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "archives");
  await createLog(config, 1000);
  while (true) {
    try { await fs.access(join(config.log_directory, "1000", "diagnostics", "diagnostics-0.jsonl")); break; }
    catch { await new Promise(resolve => setImmediate(resolve)); }
  }
  await fs.writeFile(join(config.log_directory, "1000", "gaps.jsonl"), '{"start":1000,"end":1000,"dropped":2,"reason":"known"}\n{"start":');
  const next = await createLog(config, 2000);
  await next.close("B", "stopped");
  const names = await fs.readdir(config.archive_directory);
  assert.equal(names.length, 2);
  const zip = unzipSync(await fs.readFile(join(config.archive_directory, names.find(name => name.includes("unregistered"))!)));
  assert.match(strFromU8(zip["summary.md"]), /known/);
  assert.match(strFromU8(zip["summary.md"]), /incomplete gap record/);
  assert.ok(strFromU8(zip["gaps.jsonl"]).endsWith('{"start":'));
});
