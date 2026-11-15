import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { systemClock } from "@atlas/sdk";
import { parseConfig } from "../src/config.ts";
import { createLog } from "../src/logging.ts";

test("docs/logging.md: the archive uses the injected clock and seals diagnostics", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-log-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "archives");
  let now = 1000;
  const log = await createLog(config, 1000, { ...systemClock, now: () => now });
  log.record({ kind: "before" });
  now = 2000;
  const closing = log.close("A", "stopped");
  log.record({ kind: "during" });
  const path = await closing;
  const zip = unzipSync(await readFile(path));
  assert.match(strFromU8(zip["summary.md"]), /Operation 1000 to 2000/);
  assert.ok(Object.entries(zip).some(([name, bytes]) => name.startsWith("diagnostics/") && strFromU8(bytes).includes('"during"')));
  assert.doesNotThrow(() => log.record({
    toJSON() { throw new Error("late record processed after archive"); },
  }));
  log.record({ kind: "after" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await readdir(config.log_directory), []);
});

test("docs/logging.md: archives preserve versions, gaps, captures and recover interrupted evidence", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "archives");
  config.log_total_limit_bytes = 1;
  let now = 1000;
  const clock = { ...systemClock, now: () => now };
  const interrupted = await createLog(config, now, clock);
  interrupted.record({ kind: "first", time: now });
  now = 2000;
  interrupted.record({ kind: "last", time: now });
  await interrupted.capture({ name: "image.bin", bytes: Uint8Array.of(1, 2, 3) });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const gap = JSON.parse(await readFile(join(config.log_directory, "1000", "gap.json"), "utf8"));
      if (gap.end === 2000) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  now = 3000;
  const next = await createLog(config, now, clock);
  await next.close("B", "stopped");
  const archives = await readdir(config.archive_directory);
  assert.equal(archives.length, 2);
  const zipped = await Promise.all(archives.map(async name => unzipSync(await readFile(join(config.archive_directory, name)))));
  const old = zipped.find(zip => JSON.parse(strFromU8(zip["manifest.json"])).normal === false);
  assert.ok(old, "the interrupted operation has its own abnormal archive");
  const manifest = JSON.parse(strFromU8(old["manifest.json"]));
  const { createHash } = await import("node:crypto");
  assert.deepEqual(Object.keys(old).sort(), [...manifest.files.map((file: { path: string }) => file.path), "manifest.json"].sort());
  for (const file of manifest.files) {
    assert.equal(old[file.path].length, file.size);
    assert.equal(createHash("sha256").update(old[file.path]).digest("hex"), file.sha256);
  }
  assert.ok(manifest.gaps.some((gap: { start: number; end: number; reason: string }) => gap.start === 1000 && gap.end === 2000 && gap.reason === "total limit"));
  assert.match(strFromU8(old["summary.md"]), /stopped unexpectedly/);
  assert.deepEqual([...old["files/1-image.bin"]], [1, 2, 3]);
  const versions = JSON.parse(strFromU8(old["versions.json"]));
  assert.equal(versions.app, "0.1.0");
  assert.equal(versions.sdk, "0.1.0");
  assert.match(versions.definitions_hash, /^sha256:[a-f0-9]{64}$/);
});

test("docs/logging.md: a failed archive is retained and never retried on restart", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-failed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "blocked");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(config.archive_directory, "blocked");
  const log = await createLog(config, 1000);
  await assert.rejects(log.close("A", "stopped"));
  assert.ok((await readdir(join(config.log_directory, "1000"))).includes("archive-failed.json"));
  await rm(config.archive_directory);
  const next = await createLog(config, 2000);
  await next.close("B", "stopped");
  assert.equal((await readdir(config.archive_directory)).length, 1);
  assert.ok((await readdir(config.log_directory)).includes("1000"));
});

test("docs/logging.md: detail and message filters remove diagnostic content and credentials", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-filter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "archives");
  config.log_level = "warn";
  config.log_message_content = false;
  const log = await createLog(config, 1000);
  log.record({ kind: "quiet", level: "info", body: { text: "quiet-message" } });
  log.record({ kind: "visible", level: "error", body: { text: "hidden-message" }, password: "sensitive", explanation: `refused ${config.asset_key}` });
  const zip = unzipSync(await readFile(await log.close("A", "stopped")));
  const diagnostics = Object.entries(zip).filter(([name]) => name.startsWith("diagnostics/")).map(([, bytes]) => strFromU8(bytes)).join("");
  assert.match(diagnostics, /visible/);
  assert.doesNotMatch(diagnostics, /quiet-message|hidden-message|sensitive/);
  for (const bytes of Object.values(zip)) assert.ok(!strFromU8(bytes).includes(config.asset_key));
});

test("docs/logging.md: SDK gaps and shutdown diagnostic gaps are listed with intervals", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-gaps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "archives");
  const log = await createLog(config, 1000, { ...systemClock, now: () => 2000 });
  log.record({ name: "diagnostics.gap", at: 1500, detail: { dropped: 7 } });
  const zip = unzipSync(await readFile(await log.close("A", "stopped")));
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
  assert.ok(manifest.gaps.some((gap: { start: number; end: number; dropped: number }) => gap.start === 1500 && gap.end === 1500 && gap.dropped === 7));
  assert.match(strFromU8(zip["summary.md"]), /SDK diagnostic queue full/);
  assert.ok(Object.entries(zip).some(([name, bytes]) => name.startsWith("diagnostics/") && strFromU8(bytes).includes('"dropped":7')));
});

test("docs/logging.md: an identity diagnostic write failure never becomes an unhandled rejection", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "archives");
  const log = await createLog(config, 1000);
  const operation = join(config.log_directory, "1000", "operation.json");
  const { mkdir } = await import("node:fs/promises");
  await rm(operation);
  await mkdir(operation);
  log.identify("A");
  await new Promise(resolve => setTimeout(resolve, 50));
  await rm(operation, { recursive: true });
  const zip = unzipSync(await readFile(await log.close("A", "stopped")));
  assert.match(strFromU8(zip["summary.md"]), /evidence write failure/);
});

test("docs/logging.md: crash recovery preserves a torn final report line as incomplete evidence", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-torn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "archives");
  await createLog(config, 1000);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(config.log_directory, "1000", "reports", "history.jsonl"), '{"type":"report.status","task_id":');
  const next = await createLog(config, 2000);
  await next.close("B", "stopped");
  const names = await readdir(config.archive_directory);
  assert.equal(names.length, 2);
  const recovered = unzipSync(await readFile(join(config.archive_directory, names.find(name => name.includes("unregistered"))!)));
  assert.equal(strFromU8(recovered["reports/history.jsonl"]), '{"type":"report.status","task_id":');
  assert.match(strFromU8(recovered["summary.md"]), /incomplete report line/);
});
