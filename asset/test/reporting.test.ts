import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runAsset, systemClock, type AssetLink, type ReportSource, type Room } from "@atlas/sdk";
import { parseConfig } from "../src/config.ts";
import { currentReports } from "../src/app.ts";

test("sdk/docs/asset.md: a lost current-state batch is offered again with original time, then replaced or expires", async t => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  let now = 1000;
  const clock = { ...systemClock, now: () => now };
  let source: ReportSource | undefined;
  const link: AssetLink = {
    async *events() {},
    serve(s) { source = s; return () => {}; },
    onContact() { return () => {}; },
    async storeFile() { throw new Error("unused"); },
  };
  const measurements = { battery: { value: 80, source: "equipment", time: 1000 } };
  const session = runAsset(link, { asset_id: "A", after: 0, last_task_id: 0 }, {
    clock, settings: () => ({}), current: currentReports(config, clock, () => measurements, () => "A"),
  });
  t.after(() => session.stop());
  const room: Room = { bytes: Infinity, size: () => 0 };
  const first = source!.take(room)!;
  assert.ok(first.reports.some(r => r.type === "report.battery" && r.time === 1000));
  first.settle({ ok: false, error: "lost", explanation: "radio batch lost" });
  const again = source!.take(room);
  assert.ok(again);
  assert.ok(again.reports.some(r => r.type === "report.battery" && r.time === 1000));
  again.settle({ ok: false, error: "lost", explanation: "lost again" });
  now = 2000;
  measurements.battery = { value: 70, source: "equipment", time: now };
  const newer = source!.take(room)!;
  assert.ok(newer.reports.some(r => r.type === "report.battery" && r.time === 2000));
  newer.settle({ ok: true });
  now += (config.measurement_stale_after_s + 1) * 1000;
  assert.equal(source!.take(room), undefined);
});
