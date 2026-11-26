import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startLog } from "../src/log.ts";
import { DatabaseSync } from "node:sqlite";
import { startHarness, simulatedClock, stopCore } from "./harness.ts";
import { startCore } from "../src/core.ts";
import { systemClock } from "../src/clock.ts";

test("a damaged diagnostic segment and loss ledger allow new records and leave a gap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atlas-diagnostic-recovery-"));
  try {
    const gapDirectory = join(directory, "gaps");
    const run = join(directory, "run-1");
    await mkdir(join(run, "core-0.jsonl"), { recursive: true });
    await mkdir(gapDirectory);
    await writeFile(join(gapDirectory, "run-1.json"), "{");
    const log = startLog(systemClock, {
      directory, gapDirectory, level: "trace", fileLimit: 120, totalLimit: 10000,
    });
    assert.equal(log.lastRecordTime(1), null);
    await log.openRun(1);
    assert.equal(log.gaps().length, 2);
    for (const msg of ["first ✓", "second ✓", "third ✓"]) log.record({ level: "info", area: "test", msg });
    const first = (await log.readAfter(0, 1)).map(line => JSON.parse(line));
    assert.deepEqual(first.map(record => record.msg), ["first ✓"]);
    const rest = (await log.readAfter(first[0].n, 5)).map(line => JSON.parse(line));
    assert.deepEqual(rest.map(record => record.msg), ["second ✓", "third ✓"]);
    assert.deepEqual(await log.readAfter(rest[1].n, 5), []);
    log.record({ level: "info", area: "test", msg: "fourth" });
    assert.equal(JSON.parse((await log.readAfter(rest[1].n, 5))[0]!).msg, "fourth");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rolled back report batches leave no success diagnostic; expired contact remains visible through storage failure", async (t) => {
  let db: DatabaseSync | undefined;
  const exec = DatabaseSync.prototype.exec;
  const capture = t.mock.method(DatabaseSync.prototype, "exec", function(this: DatabaseSync, sql: string) {
    db = this;
    return exec.call(this, sql);
  });
  const clock = simulatedClock();
  const h = await startHarness(clock, { debug_endpoint: true, offline_after_s: 2 });
  capture.mock.restore();
  assert.ok(db);
  try {
    const key = await h.call("POST", "/administration/asset-keys", { cookie: h.admin });
    const registration = await h.call("POST", "/entities/assets", {
      key: key.body.key, body: { reports: ["settings"], commands: ["hold"], settings: ["lights"] },
    });
    assert.equal(registration.status, 201, JSON.stringify(registration.body));
    const id = registration.body.asset_id;
    const report = { type: "report.settings", time: clock.now(), asset_id: id, settings: { lights: "on" } };
    const submit = (reports: unknown[]) => h.call("POST", `/entities/assets/${id}/reports`, { key: key.body.key, body: { reports } });
    assert.equal((await submit([report, { ...report, asset_id: "ZZ" }])).status, 403);
    assert.equal((await submit([report])).status, 200);
    const logs = await (await fetch(h.core.debugUrl!)).text();
    const stored = logs.trim().split("\n").map(line => JSON.parse(line)).filter(line => line.msg === "Report stored");
    assert.equal(stored.length, 1);

    db.exec("CREATE TEMP TRIGGER block_offline BEFORE UPDATE OF contact ON assets BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
    const heard = clock.now();
    clock.advance(2000);
    const read = async () => (await h.call("GET", `/entities/assets/${id}`, { cookie: h.admin })).body.item;
    const expired = await read();
    assert.deepEqual(expired.contact, { contact: "offline", time: heard, asset_id: id });
    assert.equal(expired.contact_storage_pending, true);
    db.exec("DROP TRIGGER block_offline");
    clock.advance(1000);
    const durable = await read();
    assert.deepEqual(durable.contact, expired.contact);
    assert.equal(durable.contact_storage_pending, undefined);
  } finally { await h.close(); }
});

test("failed Reset explains when a rejected failure record will resume the picture", async (t) => {
  let db: DatabaseSync | undefined;
  const exec = DatabaseSync.prototype.exec;
  const capture = t.mock.method(DatabaseSync.prototype, "exec", function(this: DatabaseSync, sql: string) {
    db = this;
    return exec.call(this, sql);
  });
  const clock = simulatedClock();
  const h = await startHarness(clock);
  capture.mock.restore();
  assert.ok(db);
  let resumed: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    db.exec("CREATE TEMP TRIGGER fail_marker BEFORE UPDATE OF outcome ON runs BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
    await rm(h.dataDir + "-archive", { recursive: true });
    const result = await h.stop();
    assert.equal(result.archived, false);
    assert.match(result.explanation, /next start resumes the existing picture/);
    resumed = await startCore({ clock, config: h.config });
    assert.equal(resumed.runId, h.core.runId);
  } finally {
    if (resumed) await stopCore(resumed, clock);
    await h.close();
  }
});
