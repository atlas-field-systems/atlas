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

test("now retires early updates and preserves cancel evidence [sdk/docs/asset.md#the-queue-helper]", () => {
  const f = fixture();
  f.q.apply({ kind: "tasks.updated", event_id: 50, record: [f.task(1)] });
  f.cancel(4, 51);
  f.deliver([2], { now: true });
  f.q.finish(2, "completed");
  f.q.apply({ kind: "tasks.updated", event_id: 52, record: [f.task(1)] });
  f.deliver([3]);
  assert.equal(f.q.next()?.task_id, 3);
  f.q.finish(3, "completed");
  f.deliver([5], { now: true });
  f.deliver([4]);
  assert.ok(
    f.reports.some(
      (r) =>
        r.type === "report.status" &&
        r.kind === "task" &&
        r.task_id === 4 &&
        r.request_id === 51 &&
        r.task_state === "cancelled",
    ),
  );
  f.q.finish(5, "completed");
  f.deliver([7], { now: true });
  f.q.finish(7, "completed");
  f.q.apply({ kind: "tasks.updated", event_id: 53, record: [f.task(6)] });
  f.deliver([8]);
  assert.equal(
    f.q.next()?.task_id,
    8,
    "late unseen updates cannot recreate superseded slots",
  );
});

for (const mode of ["stop", "runNow"] as const) {
  test(`synchronous ${mode} finish leaves latest queue evidence current [sdk/docs/asset.md#the-queue-helper]`, () => {
    const f = fixture();
    const reports: Report[] = [];
    const q = createQueue({
      last_task_id: 0,
      asset_id: "A",
      clock: { now: () => 1000, after: () => ({ cancel() {} }) },
      emit: (r) => reports.push(r),
      host: {
        ready() {
          q.next();
        },
        stop(id) {
          q.finish(id, "cancelled");
        },
        runNow(t) {
          if (mode === "runNow") q.finish(t.task_id, "completed");
        },
        update() {},
      },
    });
    q.apply({
      kind: "tasks.requested",
      event_id: 60,
      record: [f.task(1), f.task(2)],
    });
    if (mode === "stop")
      q.apply({
        kind: "task.dropped",
        event_id: 61,
        record: { time: 1000, asset_id: "A", task_id: 1 },
      });
    else
      q.apply({
        kind: "tasks.requested",
        event_id: 62,
        record: [f.task(3, { now: true }), f.task(4)],
      });
    const last = reports
      .filter((r) => r.type === "report.status" && r.kind === "queue")
      .at(-1);
    assert.ok(last && last.type === "report.status" && last.kind === "queue");
    assert.deepEqual(last.task_ids, q.held());
  });
}

test("asset/docs/failsafes.md: the now callback identifies the request for an override report", () => {
  const requests: unknown[] = [];
  const q = createQueue({
    last_task_id: 0,
    asset_id: "A",
    clock: { now: () => 0, after: () => ({ cancel() {} }) },
    emit() {},
    host: {
      runNow(...args) {
        requests.push(args.at(1));
      },
      stop() {},
      update() {},
    },
  });
  q.apply({
    kind: "tasks.requested",
    event_id: 42,
    record: [
      {
        kind: "hold",
        task_id: 1,
        asset_id: "A",
        requested_by: "OP",
        time: 0,
        now: true,
      },
    ],
  });
  assert.deepEqual(requests, [42]);
});

test("peek observes exactly the work next can start without changing reports [sdk/docs/asset.md#the-queue-helper]", () => {
  const f = fixture();
  f.deliver([2], { send_last: 3 });
  assert.equal(f.q.peek(), undefined);
  f.deliver([1], { send_last: 3 });
  assert.equal(f.q.peek(), undefined);
  f.deliver([3], { send_last: 3 });
  const before = f.reports.length;
  assert.equal(f.q.peek()?.task_id, 1);
  assert.equal(f.q.peek()?.task_id, 1);
  assert.equal(f.reports.length, before);
  assert.equal(f.q.next()?.task_id, 1);
  assert.equal(f.q.peek(), undefined);
  f.q.finish(1, "completed");
  assert.equal(f.q.peek()?.task_id, 2);
});

for (const request of ["task", "cancel", "update"] as const)
  test(`asset/docs/failsafes.md: app refusal of ${request} answers without changing work`, () => {
    const reports: Report[] = [];
    const lock = { locked: false };
    const task: Task = { kind: "hold", time: 0, asset_id: "A", task_id: 1, requested_by: "OP" };
    const host = {
        lock,
        refuse() { return this.lock.locked ? "failsafe locks ordinary work" : undefined; },
        runNow() { assert.fail("refused work must not run"); },
        stop() { assert.fail("refused cancel must not stop work"); },
        update() { assert.fail("refused update must not change work"); },
    };
    const q = createQueue({
      last_task_id: 0, asset_id: "A",
      clock: { now: () => 0, after: () => ({ cancel() {} }) },
      emit: report => reports.push(report), host,
    });
    q.apply({ kind: "tasks.requested", event_id: 1, record: [task] });
    lock.locked = true;
    reports.length = 0;
    if (request === "task")
      q.apply({ kind: "tasks.requested", event_id: 42, record: [{ ...task, task_id: 2, now: true }] });
    else if (request === "cancel")
      q.apply({ kind: "cancel.requested", event_id: 42, record: { task_id: 1, time: 0, asset_id: "A", requested_by: "OP" } });
    else
      q.apply({ kind: "tasks.updated", event_id: 42, record: [{ ...task, kind: "land" }] });
    assert.deepEqual(q.held(), [1]);
    assert.ok(reports.some(r => "request_id" in r && r.request_id === 42));
    if (request === "task")
      assert.ok(reports.some(r => r.type === "report.status" && r.kind === "task" && r.task_id === 2 && r.task_state === "failed" && r.request_id === 42));
    else if (request === "cancel")
      assert.ok(reports.some(r => r.type === "report.status" && r.kind === "queue" && r.request_id === 42 && r.task_ids.includes(1)));
    else assert.equal(q.next()?.kind, "hold");
  });

test("asset/docs/failsafes.md: refused cancel answers an ended Task with its current state", () => {
  const reports: Report[] = [];
  let locked = false;
  const q = createQueue({
    last_task_id: 0, asset_id: "A",
    clock: { now: () => 0, after: () => ({ cancel() {} }) }, emit: r => reports.push(r),
    host: { refuse: () => locked ? "failsafe" : undefined, runNow() {}, stop() {}, update() {} },
  });
  q.apply({ kind: "tasks.requested", event_id: 1, record: [{ kind: "hold", task_id: 1, asset_id: "A", time: 0, requested_by: "OP" }] });
  q.next();
  q.finish(1, "completed");
  locked = true;
  reports.length = 0;
  q.apply({ kind: "cancel.requested", event_id: 42, record: { task_id: 1, asset_id: "A", time: 1, requested_by: "OP" } });
  assert.ok(reports.some(r => r.type === "report.status" && r.kind === "task" && r.task_state === "completed" && r.request_id === 42));
});

test("docs/asset.md: a cancel accepted before the Task still answers after the app locks work", () => {
  const reports: Report[] = [];
  let locked = false;
  const q = createQueue({
    last_task_id: 0, asset_id: "A", emit: r => reports.push(r),
    clock: { now: () => 0, after: () => ({ cancel() {} }) },
    host: { refuse: () => locked ? "failsafe" : undefined, runNow() {}, stop() {}, update() {} },
  });
  q.apply({ kind: "cancel.requested", event_id: 41, record: { task_id: 1, asset_id: "A", time: 0, requested_by: "OP" } });
  locked = true;
  q.apply({ kind: "tasks.requested", event_id: 42, record: [{ kind: "hold", task_id: 1, asset_id: "A", time: 0, requested_by: "OP" }] });
  assert.ok(reports.some(r => r.type === "report.status" && r.kind === "task" && r.task_state === "cancelled" && r.request_id === 41));
});
