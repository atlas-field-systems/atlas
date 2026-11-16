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

test("current state goes once per change, so waiting history still drains [sdk/docs/asset.md#report-outbox]", () => {
  const report = (time: number) =>
    ({
      type: "report.status",
      time,
      asset_id: "A",
      kind: "subsystem",
      subsystem_id: "GPS",
      condition: "healthy",
    }) as const;
  const room = { bytes: Infinity, size: () => 0 };
  let reads = 0;
  const outbox = createOutbox(
    { now: () => 0, after: () => ({ cancel() {} }) },
    10000,
    undefined,
    undefined,
    () => [report(1000 + reads++)],
  );
  const times = (b?: Batch) => b?.reports.map((r) => r.time);
  void outbox.add([report(1)], "retained");
  const first = outbox.take(room)!;
  assert.deepEqual(times(first), [1000], "current state goes first");
  first.settle({ ok: true });
  const history = outbox.take(room)!;
  assert.deepEqual(times(history), [1], "unchanged state is not sent again ahead of history");
  history.settle({ ok: true });
  assert.equal(outbox.take(room), undefined, "nothing waits");
  outbox.changed();
  const changed = outbox.take(room)!;
  assert.deepEqual(times(changed), [1001], "a change makes current state due");
  changed.settle({ ok: false, error: "lost", explanation: "no ack" });
  assert.deepEqual(times(outbox.take(room)), [1002], "a lost batch reads current state afresh");
});

test("a throw from current rejects done and stops the outbox [sdk/docs/asset.md#running-over-any-link]", async () => {
  const failure = new Error("sensor read failed");
  const link: AssetLink = {
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<never>>(() => {}),
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
      current() {
        throw failure;
      },
    },
  );
  await assert.rejects(s.done, failure);
  await s.outbox.add([
    { type: "report.status", time: 1, asset_id: "A", kind: "subsystem", subsystem_id: "GPS", condition: "healthy" },
  ]);
  assert.equal(s.outbox.take({ bytes: Infinity, size: () => 0 }), undefined, "the outbox stopped");
});
