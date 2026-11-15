import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOutbox,
  runAsset,
  type AssetLink,
  type Batch,
} from "../src/asset.ts";

test("stop interrupts an idle AssetLink read and closes its iterator [sdk/docs/asset.md#running-over-any-link]", async () => {
  let returned = 0;
  let read!: () => void;
  const reading = new Promise<void>((resolve) => {
    read = resolve;
  });
  const link: AssetLink = {
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next() {
          read();
          return new Promise<IteratorResult<never>>(() => {});
        },
        async return() {
          returned++;
          return { done: true, value: undefined };
        },
      }),
    }),
    serve(source) {
      const answer = () =>
        source.take({ bytes: Infinity, size: () => 0 })?.settle({ ok: true });
      answer();
      return source.onWaiting(answer);
    },
    onContact: () => () => {},
    async storeFile() {
      throw new Error("unused");
    },
  };
  const s = runAsset(
    link,
    { asset_id: "A", after: 0, last_task_id: 0 },
    {
      clock: { now: () => 1000, after: () => ({ cancel() {} }) },
      settings: () => ({}),
    },
  );
  await reading;
  s.stop();
  let end: unknown;
  void s.done.then((v) => {
    end = v;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.deepEqual(end, { reason: "stopped" });
  assert.equal(returned, 1);
});

test("the link asks with its room; live reports, then current state, then history, and a lost batch is offered again [sdk/docs/asset.md#the-asset-link]", async () => {
  const report = (time: number) =>
    ({
      type: "report.status",
      time,
      asset_id: "A",
      kind: "subsystem",
      subsystem_id: "GPS",
      condition: "healthy",
    }) as const;
  const room = { bytes: 2, size: (r: unknown[]) => r.length };
  let current = 0;
  const outbox = createOutbox(
    { now: () => 0, after: () => ({ cancel() {} }) },
    10000,
    undefined,
    undefined,
    ({ bytes }) => (bytes > 0 ? [report(1000 + current++)] : []),
  );
  const times = (b?: Batch) => b?.reports.map((r) => r.time);
  void outbox.add([report(3), report(4), report(5)]);
  void outbox.add([report(1)], "retained");
  const first = outbox.take(room);
  assert.deepEqual(times(first), [3, 4]);
  assert.equal(outbox.take(room), undefined, "one batch in flight");
  first!.settle({ ok: false, error: "lost", explanation: "no ack" });
  const again = outbox.take(room)!;
  assert.deepEqual(times(again), [3, 4], "lost reports are offered again");
  again.settle({ ok: true });
  const next = outbox.take(room)!;
  assert.deepEqual(times(next), [5, 1000], "current state fills the room");
  next.settle({ ok: true });
  const rest = outbox.take({ bytes: 0, size: room.size })!;
  assert.deepEqual(times(rest), [1], "history goes when nothing live waits");
  rest.settle({ ok: true });
  assert.equal(outbox.take({ bytes: 0, size: room.size }), undefined);
});

test("final failsafe response reports must arrive [sdk/docs/asset.md#the-asset-link]", () => {
  const outbox = createOutbox({ now: () => 0, after: () => ({ cancel() {} }) });
  void outbox.add([{ type: "report.failsafe", kind: "response", time: 1, asset_id: "A", rule_id: "LINK", task_state: "completed", response: { kind: "land" } }]);
  assert.equal(outbox.take({ bytes: Infinity, size: () => 1 })?.priority, "must_arrive");
  outbox.stop();
});

test("bounded ordinary evidence preserves finals, in-flight batches and acknowledgement waits [sdk/docs/asset.md#the-asset-link]", async () => {
  const gaps: number[] = [];
  const outbox = createOutbox({ now: () => 0, after: () => ({ cancel() {} }) }, 10000, undefined,
    (name, detail) => { if (name === "reports.gap") gaps.push(Number(detail?.dropped)); });
  const sample = (time: number) => ({ type: "report.battery", asset_id: "A", time, battery_percent: 50 }) as const;
  let droppedSettled = false;
  const old = outbox.add([sample(0)]).then(() => { droppedSettled = true; });
  const first = outbox.take({ bytes: 1, size: r => r.length })!;
  const finals = [
    { type: "report.status", kind: "task", asset_id: "A", time: 1, task_id: 1, task_state: "completed" },
    { type: "report.failsafe", kind: "response", asset_id: "A", time: 2, response: { kind: "hold" }, task_state: "completed" },
  ] as const;
  let evictedSettled = false;
  void outbox.add([sample(-1)]).then(() => { evictedSettled = true; });
  void outbox.add([...finals]);
  for (let i = 1; i <= 1100; i++) void outbox.add([sample(i)]);
  first.settle({ ok: false, error: "lost", explanation: "no contact" });
  const retry = outbox.take({ bytes: 1, size: r => r.length })!;
  assert.deepEqual(retry.reports, [sample(0)], "in-flight report survives overflow");
  retry.settle({ ok: true });
  await old;
  assert.ok(droppedSettled);
  assert.ok(evictedSettled, "dropping an ordinary report releases its acknowledgement wait");
  const reports = [];
  for (;;) {
    const batch = outbox.take({ bytes: Infinity, size: () => 0 });
    if (!batch) break;
    reports.push(...batch.reports);
    batch.settle({ ok: true });
  }
  assert.equal(reports.filter(r => r.type === "report.battery").length, 1024);
  for (const final of finals) assert.ok(reports.some(r => JSON.stringify(r) === JSON.stringify(final)));
  assert.equal(gaps.reduce((a, b) => a + b, 0), 77);
  await outbox.flush();
  outbox.stop();
});

test("takeover, faults and active responses survive overflow [sdk/docs/asset.md#the-asset-link]", () => {
  const outbox = createOutbox({ now: () => 0, after: () => ({ cancel() {} }) });
  const essential = [
    { type: "report.failsafe", kind: "autopilot", asset_id: "A", time: 1, in_control: true },
    { type: "report.status", kind: "subsystem", asset_id: "A", time: 2, subsystem_id: "GPS", condition: "faulted", explanation: "no fix" },
    { type: "report.failsafe", kind: "response", asset_id: "A", time: 3, response: { kind: "land" }, task_state: "active" },
  ] as const;
  void outbox.add([...essential]);
  for (let time = 4; time < 1100; time++) void outbox.add([{ type: "report.battery", asset_id: "A", time, battery_percent: 50 }]);
  const reports = outbox.take({ bytes: Infinity, size: () => 0 })!.reports;
  for (const report of essential) assert.ok(reports.some(r => JSON.stringify(r) === JSON.stringify(report)), JSON.stringify(report));
  assert.equal(outbox.take({ bytes: Infinity, size: () => 0 }), undefined);
  outbox.stop();
});

test("overflow drops retained history before live reports [sdk/docs/asset.md#the-asset-link]", () => {
  const outbox = createOutbox({ now: () => 0, after: () => ({ cancel() {} }) });
  const sample = (time: number) => ({ type: "report.battery", asset_id: "A", time, battery_percent: 50 }) as const;
  void outbox.add([sample(2000)]);
  void outbox.add(Array.from({ length: 1024 }, (_, i) => sample(i)), "retained");
  const first = outbox.take({ bytes: Infinity, size: () => 0 })!;
  assert.deepEqual(first.reports, [sample(2000)]);
  first.settle({ ok: true });
  assert.equal(outbox.take({ bytes: Infinity, size: () => 0 })!.reports[0].time, 1);
  outbox.stop();
});
