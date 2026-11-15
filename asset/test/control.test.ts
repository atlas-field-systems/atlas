import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseConfig } from "../src/config.ts";
import { initial, reduce } from "../src/control.ts";

test("docs/failsafes.md: a closed stream cannot reset the local contact-loss deadline", async () => {
  const config = parseConfig(
    JSON.parse(
      await readFile(
        new URL("../examples/copter.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  config.initial_settings.link_loss_after_s = 12;
  config.initial_settings.failsafe_policy = [
    {
      rule_id: "LINK",
      priority: 50,
      conditions: [{ kind: "contact_lost" }],
      response: { kind: "land" },
    },
  ];
  let state = initial(config, 0);
  state = reduce(
    state,
    { kind: "contact", contact: { open: true, last_heard: 1000 } },
    config,
  ).state;
  state = reduce(
    state,
    { kind: "contact", contact: { open: false, last_heard: null } },
    config,
  ).state;
  assert.equal(
    reduce(state, { kind: "tick", now: 12999, hasWork: false }, config).state
      .phase,
    "ordinary",
  );
  assert.equal(
    reduce(state, { kind: "tick", now: 13000, hasWork: false }, config).state
      .phase,
    "failsafe",
  );
});

test("docs/README.md: updating active work changes its destination without finishing the Task", async () => {
  const config = parseConfig(
    JSON.parse(
      await readFile(
        new URL("../examples/copter.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  let state = initial(config, 0);
  state.measurements = {
    position: {
      value: { latitude: 1, longitude: 1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] },
      source: "vehicle",
      time: 0,
    },
    armed: { value: true, source: "vehicle", time: 0 },
  };
  const task = {
    kind: "move_to",
    task_id: 1,
    requested_by: "OP",
    asset_id: "A",
    time: 0,
    destination: { latitude: 2, longitude: 2 },
  } as const;
  state = reduce(state, { kind: "task", task, now: 0 }, config).state;
  const updated = reduce(
    state,
    {
      kind: "update",
      task: { ...task, destination: { latitude: 3, longitude: 3 } },
      now: 1,
    },
    config,
  );
  assert.equal(
    updated.effects.some((e) => e.kind === "task"),
    false,
  );
  assert.ok(
    updated.effects.some(
      (e) =>
        e.kind === "vehicle" &&
        e.command.kind === "move_to" &&
        e.command.position.latitude === 3,
    ),
  );
});

test("docs/failsafes.md: an old equipment refusal cannot fail superseding work", async () => {
  const config = parseConfig(
    JSON.parse(
      await readFile(
        new URL("../examples/copter.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  let state = initial(config, 0);
  state.measurements = {
    position: {
      value: { latitude: 1, longitude: 1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] },
      source: "vehicle",
      time: 0,
    },
    armed: { value: true, source: "vehicle", time: 0 },
  };
  state = reduce(
    state,
    {
      kind: "task",
      task: {
        kind: "hold",
        time: 0,
        asset_id: "A",
        requested_by: "OP",
        task_id: 1,
      },
      now: 0,
    },
    config,
  ).state;
  const result = reduce(
    state,
    {
      kind: "command_failed",
      execution_id: 0,
      explanation: "old refusal",
      now: 1,
    },
    config,
  );
  assert.equal(result.effects.length, 0);
  assert.equal(result.state.phase, "ordinary");
});

async function setup() {
  const config = parseConfig(
    JSON.parse(
      await readFile(
        new URL("../examples/copter.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  let state = initial(config, 0);
  state.measurements = {
    position: {
      value: { latitude: 1, longitude: 1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] },
      source: "vehicle",
      time: 0,
    },
    armed: { value: true, source: "vehicle", time: 0 },
    airborne: { value: true, source: "vehicle", time: 0 },
    speed: { value: 0, source: "vehicle", time: 0 },
  };
  return { config, state };
}
const hold = {
  kind: "hold",
  task_id: 10,
  asset_id: "A",
  requested_by: "OP",
  time: 0,
  now: true,
} as const;

test("docs/README.md: now work completes while paused and repeating running settings does not reissue it", async () => {
  const { config, state: start } = await setup();
  let state = reduce(
    start,
    { kind: "settings", settings: { run_state: "paused" }, now: 0 },
    config,
  ).state;
  state = reduce(state, { kind: "task", task: hold, now: 1 }, config).state;
  const repeated = reduce(
    state,
    { kind: "settings", settings: { run_state: "paused" }, now: 2 },
    config,
  );
  assert.equal(repeated.effects.filter((e) => e.kind === "vehicle").length, 0);
  const done = reduce(
    repeated.state,
    { kind: "tick", now: 3, hasWork: false },
    config,
  );
  assert.ok(
    done.effects.some((e) => e.kind === "task" && e.status === "completed"),
  );
  state = reduce(start, { kind: "task", task: hold, now: 0 }, config).state;
  assert.equal(
    reduce(
      state,
      { kind: "settings", settings: { run_state: "running" }, now: 1 },
      config,
    ).effects.length,
    0,
  );
});

test("docs/failsafes.md: commanded activation overrides pause and selects the commanded rule", async () => {
  const { config, state: start } = await setup();
  start.settings.failsafe_policy = [
    {
      rule_id: "COMMAND",
      priority: 1,
      conditions: [{ kind: "commanded" }],
      response: { kind: "hold" },
    },
  ];
  let state = reduce(
    start,
    { kind: "settings", settings: { run_state: "paused" }, now: 0 },
    config,
  ).state;
  const activated = reduce(
    state,
    { kind: "task", task: { ...hold, kind: "failsafe" }, now: 1 },
    config,
  );
  assert.ok(
    activated.effects.some(
      (e) =>
        e.kind === "response" &&
        e.rule?.rule_id === "COMMAND" &&
        e.status === "active",
    ),
  );
  assert.equal(activated.state.settings.run_state, "running");
  const done = reduce(
    activated.state,
    { kind: "tick", now: 2, hasWork: false },
    config,
  );
  assert.ok(
    done.effects.some((e) => e.kind === "response" && e.status === "completed"),
  );
});

test("docs/README.md: pause time does not consume the command timeout", async () => {
  const { config, state: start } = await setup();
  let state = reduce(
    start,
    {
      kind: "task",
      task: {
        ...hold,
        kind: "move_to",
        destination: { latitude: 2, longitude: 2 },
      },
      now: 0,
    },
    config,
  ).state;
  state = reduce(
    state,
    { kind: "settings", settings: { run_state: "paused" }, now: 1000 },
    config,
  ).state;
  state = reduce(
    state,
    { kind: "settings", settings: { run_state: "running" }, now: 200000 },
    config,
  ).state;
  const tick = reduce(
    state,
    { kind: "tick", now: 200001, hasWork: false },
    config,
  );
  assert.equal(
    tick.effects.some((e) => e.kind === "task" && e.status === "failed"),
    false,
  );
});

test("docs/failsafes.md: a new lower-priority condition interrupts a paused response", async () => {
  const { config, state: start } = await setup();
  start.settings.failsafe_policy = [
    {
      rule_id: "FIRST",
      priority: 90,
      conditions: [{ kind: "battery_below", battery_percent: 30 }],
      response: { kind: "land" },
    },
    {
      rule_id: "LATER",
      priority: 1,
      conditions: [{ kind: "contact_lost" }],
      response: { kind: "hold" },
    },
  ];
  start.settings.link_loss_after_s = 12;
  start.measurements.battery = { value: 20, source: "vehicle", time: 0 };
  let state = reduce(
    start,
    { kind: "tick", now: 0, hasWork: false },
    config,
  ).state;
  state = reduce(
    state,
    { kind: "settings", settings: { run_state: "paused" }, now: 1 },
    config,
  ).state;
  state = reduce(
    state,
    {
      kind: "measurements",
      measurements: {
        position: { ...start.measurements.position!, time: 12000 },
        armed: { value: true, source: "vehicle", time: 12000 },
      },
    },
    config,
  ).state;
  const fired = reduce(
    state,
    { kind: "tick", now: 12000, hasWork: false },
    config,
  );
  assert.ok(
    fired.effects.some(
      (e) =>
        e.kind === "response" &&
        e.rule?.rule_id === "LATER" &&
        e.status === "active",
    ),
  );
});

test("docs/failsafes.md: critical fallback keeps its priority against a later lower-priority rule", async () => {
  const { config, state: start } = await setup();
  start.settings.home_position = { latitude: 1, longitude: 1 };
  start.settings.failsafe_policy = [
    {
      rule_id: "CRITICAL",
      priority: 90,
      conditions: [
        { kind: "battery_below", battery_percent: 10, critical: true },
      ],
      response: { kind: "land" },
    },
    {
      rule_id: "LOW",
      priority: 1,
      conditions: [{ kind: "contact_lost" }],
      response: { kind: "hold" },
    },
  ];
  start.settings.link_loss_after_s = 12;
  start.measurements.battery = { value: 5, source: "vehicle", time: 0 };
  let state = reduce(
    start,
    { kind: "tick", now: 0, hasWork: false },
    config,
  ).state;
  state = reduce(
    state,
    {
      kind: "command_failed",
      execution_id: state.commandId,
      now: 1,
      explanation: "refused",
    },
    config,
  ).state;
  const later = reduce(
    state,
    { kind: "tick", now: 12000, hasWork: false },
    config,
  );
  assert.equal(
    later.effects.some(
      (e) => e.kind === "response" && e.rule?.rule_id === "LOW",
    ),
    false,
  );
});

test("docs/README.md: a now Task can complete without resuming the paused queue", async () => {
  const { config, state: start } = await setup();
  let state = reduce(
    start,
    { kind: "settings", settings: { run_state: "paused" }, now: 0 },
    config,
  ).state;
  state = reduce(state, { kind: "task", task: hold, now: 1 }, config).state;
  const done = reduce(state, { kind: "tick", now: 2, hasWork: true }, config);
  assert.ok(
    done.effects.some((e) => e.kind === "task" && e.status === "completed"),
  );
  assert.equal(done.state.settings.run_state, "paused");
});

test("docs/failsafes.md: preparation failure stops superseded movement and critical preparation failure falls back", async () => {
  const { config, state: start } = await setup();
  let state = reduce(
    start,
    {
      kind: "task",
      task: {
        ...hold,
        kind: "move_to",
        destination: { latitude: 2, longitude: 2 },
      },
      now: 0,
    },
    config,
  ).state;
  const failed = reduce(
    state,
    { kind: "task", task: { ...hold, task_id: 11, kind: "move_to" }, now: 1 },
    config,
  );
  assert.ok(
    failed.effects.some(
      (e) => e.kind === "vehicle" && e.command.kind === "hold",
    ),
  );
  start.settings.home_position = { latitude: 1, longitude: 1 };
  start.settings.failsafe_policy = [
    {
      rule_id: "CB",
      priority: 90,
      conditions: [
        { kind: "battery_below", battery_percent: 10, critical: true },
      ],
      response: { kind: "move_to" },
    },
  ];
  start.measurements.battery = { value: 5, source: "vehicle", time: 0 };
  const fallback = reduce(
    start,
    { kind: "tick", now: 1, hasWork: false },
    config,
  );
  assert.ok(
    fallback.effects.some(
      (e) =>
        e.kind === "response" &&
        e.status === "active" &&
        e.action.kind === "return_to_home" &&
        e.rule?.rule_id === "CB",
    ),
  );
});

test("docs/failsafes.md: override reports name the Hold and pause requests", async () => {
  const { config, state: start } = await setup();
  let state = reduce(
    start,
    { kind: "task", task: { ...hold, kind: "failsafe" }, now: 0 },
    config,
  ).state;
  const held = reduce(
    state,
    { kind: "task", task: hold, now: 1, request_id: 42 },
    config,
  );
  assert.ok(
    held.effects.some((e) => e.kind === "override" && e.request_id === 42),
  );
  const paused = reduce(
    held.state,
    {
      kind: "settings",
      settings: { run_state: "paused" },
      now: 2,
      request_id: 43,
    },
    config,
  );
  assert.ok(
    paused.effects.some((e) => e.kind === "override" && e.request_id === 43),
  );
});

for (const override of ["hold", "pause"] as const)
  test(`docs/failsafes.md: ${override} preserves a condition already true between ticks`, async () => {
    const { config, state: start } = await setup();
    start.settings.failsafe_policy = [{
      rule_id: "LB",
      priority: 50,
      conditions: [{ kind: "battery_below", battery_percent: 30 }],
      response: { kind: "land" },
    }];
    start.measurements.battery = { value: 50, source: "vehicle", time: 0 };
    let state = reduce(start, {
      kind: "task", task: { ...hold, kind: "failsafe" }, now: 0,
    }, config).state;
    state = reduce(state, { kind: "tick", now: 1, hasWork: false }, config).state;
    state = reduce(state, {
      kind: "measurements",
      measurements: { battery: { value: 20, source: "vehicle", time: 2 } },
    }, config).state;
    state = reduce(state, override === "hold"
      ? { kind: "task", task: hold, now: 3 }
      : { kind: "settings", settings: { run_state: "paused" }, now: 3 }, config).state;
    const held = reduce(state, { kind: "tick", now: 4, hasWork: false }, config);
    assert.equal(held.effects.some(e => e.kind === "response" && e.status === "active"), false,
      "an already-true noncritical condition must not replace the override");
    state = reduce(held.state, {
      kind: "measurements",
      measurements: { battery: { value: 50, source: "vehicle", time: 5 } },
    }, config).state;
    state = reduce(state, { kind: "tick", now: 5, hasWork: false }, config).state;
    state = reduce(state, {
      kind: "measurements",
      measurements: { battery: { value: 20, source: "vehicle", time: 6 } },
    }, config).state;
    const fired = reduce(state, { kind: "tick", now: 6, hasWork: false }, config);
    assert.ok(fired.effects.some(e => e.kind === "response" && e.rule?.rule_id === "LB" && e.status === "active"));
  });

test("docs/README.md: an unresolved place update keeps the prior execution and records why", async () => {
  const { config, state: start } = await setup();
  const task = { ...hold, kind: "move_to", destination: { latitude: 2, longitude: 2 } } as const;
  const state = reduce(start, { kind: "task", task, now: 0 }, config).state;
  const result = reduce(state, { kind: "update", task: { ...task, destination: undefined }, now: 1 }, config);
  assert.deepEqual(result.state.execution, state.execution);
  assert.ok(result.effects.some(e => e.kind === "diagnostic" && e.explanation.includes("destination unavailable")));
  assert.equal(result.effects.some(e => e.kind === "task"), false);
});

test("docs/failsafes.md: stale position on resuming Return to home fails safely", async () => {
  const { config, state: start } = await setup();
  start.settings.home_position = { latitude: 2, longitude: 2 };
  let state = reduce(start, { kind: "task", task: { ...hold, kind: "return_to_home" }, now: 0 }, config).state;
  state = reduce(state, { kind: "settings", settings: { run_state: "paused" }, now: 1 }, config).state;
  const result = reduce(state, { kind: "settings", settings: { run_state: "running" }, now: 100000 }, config);
  assert.equal(result.state.execution, null);
  assert.ok(result.effects.some(e => e.kind === "task" && e.status === "failed" && e.explanation?.includes("transit altitude unavailable")));
  assert.ok(result.effects.some(e => e.kind === "vehicle" && e.command.kind === "hold"));
});

for (const condition of ["battery", "contact"] as const)
  test(`docs/failsafes.md: handback samples ${condition} before selecting rules and tracks Hold refusal`, async () => {
    const { config, state } = await setup();
    state.phase = "flight_controller";
    state.settings.link_loss_after_s = 12;
    state.settings.failsafe_policy = [{ rule_id: "NEW", priority: 50,
      conditions: condition === "battery" ? [{ kind: "battery_below", battery_percent: 30 }] : [{ kind: "contact_lost" }],
      response: { kind: "land" } }];
    state.measurements.mode = { value: 4, source: "vehicle", time: 12000 };
    state.measurements.position!.time = 12000;
    state.measurements.armed!.time = 12000;
    state.measurements.battery = { value: 20, source: "vehicle", time: 12000 };
    const result = reduce(state, { kind: "tick", now: 12000, hasWork: false }, config);
    assert.equal(result.effects.some(e => e.kind === "response" && e.rule?.rule_id === "NEW"), false);
    assert.equal(result.state.execution?.execution.kind, "hold");
    const failed = reduce(result.state, { kind: "command_failed", execution_id: result.state.commandId, explanation: "Hold refused", now: 12001 }, config);
    assert.ok(failed.effects.some(e => e.kind === "response" && e.status === "failed" && e.explanation === "Hold refused"));
    const next = reduce(result.state, { kind: "tick", now: 12001, hasWork: false }, config);
    assert.equal(next.effects.some(e => e.kind === "response" && e.rule?.rule_id === "NEW"), false);
  });

for (const kind of ["land", "return_to_home"] as const)
  test(`docs/failsafes.md: failed ${kind} override allows a later critical rule`, async () => {
    const { config, state: start } = await setup();
    start.settings.home_position = { latitude: 2, longitude: 2 };
    start.phase = "failsafe";
    start.settings.failsafe_policy = [{ rule_id: "CB", priority: 90,
      conditions: [{ kind: "battery_below", battery_percent: 10, critical: true }], response: { kind: "land" } }];
    let state = reduce(start, { kind: "task", task: { ...hold, kind }, now: 0 }, config).state;
    state = reduce(state, { kind: "command_failed", execution_id: state.commandId, explanation: "refused", now: 1 }, config).state;
    state.measurements.battery = { value: 5, source: "vehicle", time: 2 };
    const result = reduce(state, { kind: "tick", now: 2, hasWork: false }, config);
    assert.ok(result.effects.some(e => e.kind === "response" && e.rule?.rule_id === "CB" && e.status === "active"));
  });

test("docs/failsafes.md: repeated running is not an override", async () => {
  const { config, state } = await setup();
  state.phase = "failsafe";
  state.settings.run_state = "running";
  const result = reduce(state, { kind: "settings", settings: { run_state: "running" }, now: 0, request_id: 42 }, config);
  assert.equal(result.effects.some(e => e.kind === "override"), false);
});

test("docs/failsafes.md: unexpected raw mode during a pending Land gives control to the flight controller", async () => {
  const { config, state: start } = await setup();
  const state = reduce(start, { kind: "task", task: { ...hold, kind: "land" }, now: 0 }, config).state;
  state.measurements.mode = { value: 6, source: "vehicle", time: 1 };
  const result = reduce(state, { kind: "tick", now: 1, hasWork: true }, config);
  assert.equal(result.state.phase, "flight_controller");
  assert.equal(result.effects.some(e => e.kind === "vehicle"), false);
  const refused = reduce(result.state, { kind: "task", task: hold, now: 2 }, config);
  assert.ok(refused.effects.some(e => e.kind === "task" && e.status === "failed" && e.explanation === "flight controller is in control"));
});

test("docs/README.md: updating a descending Land preserves transit height, speed and start time", async () => {
  const { config, state: start } = await setup();
  const task = { ...hold, kind: "land", landing_position: { latitude: 2, longitude: 2 } } as const;
  const state = reduce(start, { kind: "task", task, now: 0 }, config).state;
  state.execution!.execution.step = 2;
  state.measurements.position!.value.altitudes = [{ altitude_m: 2, altitude_reference: "launch" }];
  const result = reduce(state, { kind: "update", task: { ...task, landing_position: { latitude: 3, longitude: 3 } }, now: 1 }, config);
  assert.equal(result.state.execution!.execution.transit_altitude?.altitude_m, 5);
  assert.equal(result.state.execution!.execution.step, 1);
  assert.equal(result.state.execution!.execution.started, 0);
  assert.equal(result.state.execution!.execution.speed, state.execution!.execution.speed);
});
