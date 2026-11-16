import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createQueue, type Task, type Report } from "@atlas/sdk";
import { parseConfig } from "../src/config.ts";
import { initial, reduce, refusal, type Event, type Effect } from "../src/control.ts";

const phases = ["ordinary", "paused", "failsafe", "override", "flight_controller"] as const;
const requests = ["task", "now", "cancel queued", "cancel running", "update", "settings", "pause", "resume", "land", "return_to_home", "hold", "failsafe", "settings task"] as const;
type Outcome = "queue" | "run" | "cancel" | "update" | "apply" | "refuse" | "complete";
const table: Record<typeof phases[number], Outcome[]> = {
  ordinary: ["queue", "run", "cancel", "cancel", "update", "apply", "apply", "apply", "run", "run", "run", "run", "complete"],
  paused: ["queue", "run", "cancel", "cancel", "update", "apply", "apply", "apply", "run", "run", "run", "run", "complete"],
  failsafe: ["refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "apply", "apply", "run", "run", "run", "refuse", "refuse"],
  override: ["refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "apply", "apply", "run", "run", "run", "refuse", "refuse"],
  flight_controller: ["refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "refuse", "refuse"],
};

for (const phase of phases)
  for (const [column, request] of requests.entries())
    test(`docs/README.md queue, updates, pause; docs/failsafes.md lock and watch only: ${phase} / ${request}`, async () => {
      const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
      let state = initial(config, 0);
      state.settings = { ...state.settings, home_position: { latitude: 1, longitude: 1 } };
      state.measurements = {
        position: { value: { latitude: 1, longitude: 1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] }, source: "vehicle", time: 0 },
        armed: { value: true, source: "vehicle", time: 0 },
      };
      const reports: Report[] = [];
      const effects: Effect[] = [];
      function dispatch(event: Event) {
        const result = reduce(state, event, config);
        state = result.state;
        effects.push(...result.effects);
        for (const e of result.effects) {
          if (e.kind === "task" && e.status !== "active") q.finish(e.task.task_id, e.status, { explanation: e.explanation });
          if (e.kind === "clear") q.clear();
        }
      }
      const q = createQueue({
        asset_id: "A", last_task_id: 0,
        clock: { now: () => 1, after: () => ({ cancel() {} }) }, emit: r => reports.push(r),
        host: {
          refuse: request => refusal(state, request),
          runNow: (task, request_id) => dispatch({ kind: "task", task, request_id, now: 1 }),
          stop: (id, because) => { if (because !== "now") dispatch({ kind: "cancel", id, now: 1 }); },
          update: task => dispatch({ kind: "update", task, now: 1 }),
        },
      });
      const task: Task = { kind: "move_to", destination: { latitude: 2, longitude: 2 }, asset_id: "A", task_id: 1, requested_by: "OP", time: 0 };
      q.apply({ kind: "tasks.requested", record: [task, { ...task, task_id: 2 }], event_id: 1 });
      dispatch({ kind: "task", task: q.next()!, now: 0 });
      if (phase === "paused") dispatch({ kind: "settings", settings: { run_state: "paused" }, now: 0 });
      if (phase === "failsafe" || phase === "override") state.phase = "failsafe";
      if (phase === "override") state.override = "stand";
      if (phase === "flight_controller") state.phase = "flight_controller";
      const before = structuredClone(state);
      effects.length = 0;
      reports.length = 0;
      if (request === "pause" || request === "resume" || request === "settings") {
        dispatch({ kind: "settings", now: 1, request_id: 42, settings: request === "settings" ? { link_loss_after_s: 50 } : { run_state: request === "pause" ? "paused" : "running" } });
        const answer = effects.find(e => e.kind === "settings");
        assert.ok(answer?.kind === "settings" && answer.request_id === 42);
        if (table[phase][column] === "refuse") {
          assert.deepEqual(answer.settings, before.settings);
          assert.deepEqual(state.execution, before.execution);
          assert.equal(effects.some(e => e.kind === "vehicle"), false);
        }
        else if (request === "settings") assert.equal(answer.settings.link_loss_after_s, 50);
        else assert.equal(answer.settings.run_state, request === "pause" ? "paused" : "running");
      } else {
        if (request === "cancel queued" || request === "cancel running")
          q.apply({ kind: "cancel.requested", event_id: 42, record: { time: 1, asset_id: "A", requested_by: "OP", task_id: request === "cancel queued" ? 2 : 1 } });
        else if (request === "update")
          q.apply({ kind: "tasks.updated", event_id: 42, record: [{ ...task, destination: { latitude: 3, longitude: 3 } }] });
        else {
          const next: Task = request === "settings task"
            ? { ...task, task_id: 3, kind: "settings", settings: { link_loss_after_s: 50 }, now: true }
            : request === "task" || request === "now"
            ? { ...task, task_id: 3, now: request === "now" }
            : { ...task, task_id: 3, kind: request, now: true };
          q.apply({ kind: "tasks.requested", event_id: 42, record: [next] });
        }
        assert.ok(reports.some(r => "request_id" in r && r.request_id === 42));
        const outcome = table[phase][column];
        if (outcome === "refuse") {
          assert.deepEqual(state.execution, before.execution);
          assert.deepEqual(q.held(), [2]);
          if (!["cancel queued", "cancel running", "update"].includes(request))
            assert.ok(reports.some(r => r.type === "report.status" && r.kind === "task" && r.task_id === 3 && r.task_state === "failed" && r.request_id === 42));
        } else if (outcome === "queue") assert.deepEqual(q.held(), [2, 3]);
        else if (outcome === "complete") {
          assert.equal(state.execution, null);
          assert.equal(state.settings.link_loss_after_s, 50);
          assert.ok(reports.some(r => r.type === "report.status" && r.kind === "task" && r.task_id === 1 && r.task_state === "cancelled"));
          assert.ok(reports.some(r => r.type === "report.status" && r.kind === "task" && r.task_id === 3 && r.task_state === "completed"));
          assert.ok(effects.some(e => e.kind === "vehicle" && e.command.kind === "hold"));
        }
        else if (outcome === "run") {
          assert.ok(effects.some(e => e.kind === "vehicle"));
          assert.equal(state.execution?.execution.kind, request === "now" ? "move_to" : request === "failsafe" ? "return_to_home" : request);
          assert.deepEqual(q.held(), []);
          for (const id of [1, 2])
            assert.ok(reports.some(r => r.type === "report.status" && r.kind === "task" && r.task_id === id && r.task_state === "cancelled"));
        }
        else if (outcome === "cancel") {
          assert.ok(reports.some(r => r.type === "report.status" && r.kind === "task" && r.task_state === "cancelled" && r.request_id === 42));
          assert.deepEqual(q.held(), request === "cancel queued" ? [] : [2]);
          assert.deepEqual(state.execution, request === "cancel queued" ? before.execution : null);
        }
        else if (outcome === "update") {
          assert.equal(state.execution?.execution.destination?.latitude, 3);
          if (phase === "paused") {
            assert.equal(effects.some(e => e.kind === "vehicle"), false);
            dispatch({ kind: "settings", settings: { run_state: "running" }, now: 2 });
            assert.ok(effects.some(e => e.kind === "vehicle" && e.command.kind === "move_to" && e.command.position.latitude === 3));
          }
        }
      }
    });
