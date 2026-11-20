import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLog } from "../src/log.ts";
import { simulatedClock } from "./harness.ts";

test("a torn record stays on disk and is counted once across restarts [core/docs/logging.md#when-logging-cannot-keep-up]", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-torn-log-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clock = simulatedClock();
  const openLog = async () => {
    const log = startLog(clock, {
      directory: join(root, "diagnostics"),
      gapDirectory: join(root, "gaps"),
      level: "info",
      content: false,
      fileLimit: 4096,
      totalLimit: 16384,
    });
    await log.openRun(1);
    return log;
  };
  const original = await openLog();
  original.record({ level: "info", area: "test", msg: "before crash" });
  await original.flush();
  const file = join(root, "diagnostics", "run-1", "core-0.jsonl");
  const fragment = '{"n":2,"msg":"crash';
  await appendFile(file, fragment);

  const expected = [{
    lost: 1, from_n: 2, to_n: 2, at: clock.now(),
    why: "truncated record; original bytes retained",
  }];
  const recovered = await openLog();
  assert.deepEqual(recovered.gaps(), expected);
  recovered.record({ level: "info", area: "test", msg: "after crash" });
  await recovered.flush();
  assert.equal((await readFile(file, "utf8")).endsWith(fragment), true);
  const restarted = await openLog();
  assert.deepEqual(restarted.gaps(), expected);
  const records = (await restarted.readAfter(1, 10)).map(line => JSON.parse(line));
  assert.equal(records.find(record => record.msg === "after crash")?.n, 3);
});
