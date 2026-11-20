import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLog, type DiagnosticLog } from "../src/log.ts";
import { simulatedClock } from "./harness.ts";

const notice = { level: "info", area: "test", msg: "after crash" } as const;
const truncated = "truncated record; original bytes retained";

async function logFixture(t: TestContext, savedGap: { from_n: number; to_n: number; why: string }) {
  const root = await mkdtemp(join(tmpdir(), "atlas-torn-log-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clock = simulatedClock();
  const directory = join(root, "diagnostics");
  const run = join(directory, "run-1");
  const gapDirectory = join(root, "gaps");
  const gap = (from_n: number, to_n: number, why: string) => ({
    lost: to_n - from_n + 1, from_n, to_n, at: clock.now(), why,
  });
  await mkdir(run, { recursive: true });
  await mkdir(gapDirectory);
  await writeFile(join(gapDirectory, "run-1.json"),
    JSON.stringify([gap(savedGap.from_n, savedGap.to_n, savedGap.why)]));
  const file = join(run, "core-0.jsonl");
  await writeFile(file, JSON.stringify({ n: 1, at: clock.now(), ...notice, msg: "before crash" }) + "\n");
  const openLog = async () => {
    const log = startLog(clock, {
      directory,
      gapDirectory,
      level: "info",
      content: false,
      fileLimit: 2_000_000,
      totalLimit: 2_000_000,
    });
    await log.openRun(1);
    return log;
  };
  return { file, gap, openLog, at: clock.now() };
}

async function gapRecords(log: DiagnosticLog) {
  return (await log.readAfter(0, 20_000))
    .map(line => JSON.parse(line)).filter(record => record.msg === "diagnostic gaps")
    .map(record => record.gaps);
}

test("a torn record after a saved gap is counted once and its number stays reserved [core/docs/logging.md#when-logging-cannot-keep-up]", async t => {
  const { file, gap, openLog } = await logFixture(t, { from_n: 2, to_n: 2, why: "queue full" });
  const fragment = '{"n":3,"msg":"crash';
  await appendFile(file, fragment);

  const expected = [gap(2, 2, "queue full"), gap(3, 3, truncated)];
  const recovered = await openLog();
  assert.deepEqual(recovered.gaps(), expected);
  recovered.record(notice);
  await recovered.flush();
  assert.equal((await readFile(file, "utf8")).endsWith(fragment), true);
  const restarted = await openLog();
  assert.deepEqual(restarted.gaps(), expected);
  const records = (await restarted.readAfter(1, 10)).map(line => JSON.parse(line));
  assert.equal(records.find(record => record.msg === notice.msg)?.n, 4);
  assert.deepEqual((await gapRecords(restarted)).flat(), expected);
});

test("a partial write and the record appended to it are visible as losses [core/docs/logging.md#when-logging-cannot-keep-up]", async t => {
  const { file, gap, openLog, at } = await logFixture(t, { from_n: 2, to_n: 2, why: "write failure" });
  await appendFile(file, '{"n":2,"at":' + JSON.stringify({ n: 3, at, ...notice, msg: "appended" }) + "\n");

  const recovered = await openLog();
  assert.deepEqual(recovered.gaps(), [gap(2, 2, "write failure"), gap(2, 3, truncated)]);
  recovered.record(notice);
  const records = (await recovered.readAfter(1, 10)).map(line => JSON.parse(line));
  assert.equal(records.find(record => record.msg === notice.msg)?.n, 4);
});

test("gap records contain only losses they have not reported before [core/docs/logging.md#when-logging-cannot-keep-up]", async t => {
  const { file, gap, openLog } = await logFixture(t, { from_n: 50, to_n: 52, why: "queue full" });
  await appendFile(file, '{"n":2,"msg":"crash');
  const recovered = await openLog();
  recovered.record(notice);
  await recovered.flush();
  assert.deepEqual((await gapRecords(recovered)).flat().sort((a, b) => a.from_n - b.from_n),
    [gap(2, 2, truncated), gap(50, 52, "queue full")]);

  for (let i = 0; i < 10_002; i++) recovered.record(notice);
  await recovered.flush();
  const records = await gapRecords(recovered);
  assert.equal(records.length, 2);
  assert.deepEqual(records[1], [gap(10_056, 10_056, "queue full")]);
});
