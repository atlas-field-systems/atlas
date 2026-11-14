import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue, type Task, type Report } from "../src/queue.ts";

function fixture(floor = 0) {
  const reports: Report[] = [],
    now: number[] = [],
    stops: number[] = [],
    updates: Task[] = [];
  let ready = 0;
  const q = createQueue({
    last_task_id: floor,
    asset_id: "A",
    clock: { now: () => 1000, after: () => ({ cancel() {} }) },
    emit: (r) => reports.push(r),
    host: {
      ready() {
        ready++;
      },
      runNow: (t) => now.push(t.task_id),
      stop: (id) => stops.push(id),
      update: (t) => updates.push(t),
    },
  });
  const task = (task_id: number, fields: Partial<Task> = {}): Task =>
    ({
      kind: "hold",
      time: 1000,
      asset_id: "A",
      task_id,
      requested_by: "OP",
      ...fields,
    }) as Task;
  const deliver = (ids: number[], fields: Partial<Task> = {}) =>
    q.apply({
      kind: "tasks.requested",
      event_id: 10,
      record: ids.map((id) => task(id, fields)),
    });
  const cancel = (task_id: number, event_id: number) =>
    q.apply({
      kind: "cancel.requested",
      event_id,
      record: { time: 1000, asset_id: "A", task_id, requested_by: "OP" },
    });
  return {
    q,
    reports,
    now,
    stops,
    updates,
    task,
    deliver,
    cancel,
    ready: () => ready,
  };
}

test("orders, waits for send_last and never repeats [sdk/docs/asset.md#the-queue-helper: Orders, Never runs]", () => {
  const f = fixture();
  f.deliver([2], { send_last: 3 });
  assert.equal(f.q.next(), undefined, "missing lower Task blocks");
  f.deliver([1], { send_last: 3 });
  assert.equal(f.q.next(), undefined, "whole request must be held");
  f.deliver([3], { send_last: 3 });
  assert.ok(f.ready() > 0, "ready fires when work becomes available");
  assert.equal(f.q.next()?.task_id, 1);
  assert.equal(f.q.next(), undefined, "only one ordinary Task runs");
  f.q.finish(1, "completed");
  assert.equal(f.q.next()?.task_id, 2);
  f.q.finish(2, "failed");
  f.q.clear();
  f.deliver([1, 2, 3]);
  assert.equal(
    f.q.next(),
    undefined,
    "ended and cleared Tasks never run twice",
  );
});
test("floor and drops unblock later work [sdk/docs/asset.md#the-queue-helper: Holds, Skips]", () => {
  const f = fixture(3);
  f.deliver([1, 4, 5]);
  f.q.apply({
    kind: "task.dropped",
    event_id: 12,
    record: { time: 1000, asset_id: "A", task_id: 4 },
  });
  assert.equal(f.q.next()?.task_id, 5);
});
test("64 held Tasks refuse more; now cancels lower work [sdk/docs/asset.md#the-queue-helper: Refuses, The app pulls]", () => {
  const f = fixture();
  f.deliver(Array.from({ length: 65 }, (_, i) => i + 1));
  assert.equal(f.q.held().length, 64);
  assert.ok(
    f.reports.some(
      (r) =>
        r.type === "report.status" &&
        r.kind === "task" &&
        r.task_id === 65 &&
        r.task_state === "cancelled",
    ),
  );
  assert.equal(f.q.next()?.task_id, 1);
  f.deliver([67], { now: true });
  assert.deepEqual(f.stops, [1]);
  assert.deepEqual(f.now, [67]);
  f.deliver([66]);
  assert.deepEqual(f.q.held(), []);
  f.q.finish(1, "cancelled");
  f.q.finish(67, "completed");
  f.deliver([67], { now: true });
  assert.deepEqual(f.now, [67], "now also runs once");
});
test("all early cancels answered; running cancel waits for finish [sdk/docs/asset.md#the-queue-helper: Cancel]", () => {
  const f = fixture();
  f.cancel(1, 21);
  f.cancel(1, 22);
  f.deliver([1, 2]);
  const answers = f.reports.flatMap((r) =>
    r.type === "report.status" && r.kind === "task" && r.task_id === 1
      ? [r.request_id]
      : [],
  );
  assert.deepEqual(answers, [21, 22]);
  assert.equal(f.q.next()?.task_id, 2);
  f.cancel(2, 23);
  assert.deepEqual(f.stops, [2]);
  f.q.finish(2, "cancelled");
  assert.ok(f.reports.some((r) => "request_id" in r && r.request_id === 23));
  f.cancel(2, 24);
  assert.ok(
    f.reports.some(
      (r) =>
        r.type === "report.status" && r.kind === "queue" && r.request_id === 24,
    ),
  );
});
test("place updates precede delivery and reach running app [sdk/docs/asset.md#the-queue-helper: Applies place updates]", () => {
  const f = fixture();
  f.q.apply({
    kind: "tasks.updated",
    event_id: 30,
    record: [f.task(1, { kind: "return_to_home" })],
  });
  f.deliver([1]);
  assert.equal(f.q.next()?.kind, "return_to_home");
  f.q.apply({ kind: "tasks.updated", event_id: 31, record: [f.task(1)] });
  assert.equal(f.updates[0].kind, "hold");
  assert.ok(
    f.reports.some(
      (r) =>
        r.type === "report.status" && r.kind === "queue" && r.request_id === 31,
    ),
  );
});

test("drop ends running slot but preserves late evidence [sdk/docs/asset.md#the-queue-helper]", () => {
  const f = fixture();
  f.deliver([1, 2]);
  assert.equal(f.q.next()?.task_id, 1);
  f.q.apply({
    kind: "task.dropped",
    event_id: 40,
    record: { time: 1000, asset_id: "A", task_id: 1 },
  });
  assert.deepEqual(f.stops, [1]);
  assert.equal(f.q.next()?.task_id, 2);
  f.q.finish(1, "completed");
  assert.deepEqual(
    f.q.active().map((t) => t.task_id),
    [2],
  );
  assert.ok(
    f.reports.some(
      (r) =>
        r.type === "report.status" &&
        r.kind === "task" &&
        r.task_id === 1 &&
        r.task_state === "completed",
    ),
  );
});
