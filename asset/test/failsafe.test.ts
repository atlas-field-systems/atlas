import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseConfig } from "../src/config.ts";
import { initial, reduce, type State } from "../src/control.ts";

for (const override of ["hold", "pause"] as const)
  test(`docs/failsafes.md: critical battery replaces ${override} immediately, then failed critical Land falls back once`, async () => {
  const config = parseConfig(
    JSON.parse(
      await readFile(
        new URL("../examples/copter.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  let state: State = {
    ...initial(config, 0),
    settings: {
      ...config.initial_settings,
      home_position: { latitude: 1, longitude: 1 },
    },
    measurements: {
      position: {
        value: {
          latitude: 1,
          longitude: 1,
          altitudes: [{ altitude_m: 5, altitude_reference: "launch" }],
        },
        source: "vehicle",
        time: 0,
      },
      battery: { value: 5, source: "vehicle", time: 0 },
      armed: { value: true, source: "vehicle", time: 0 },
      airborne: { value: true, source: "vehicle", time: 0 },
    },
  };
  state = reduce(state, { kind: "tick", now: 0, hasWork: false }, config).state;
  state = reduce(
    state,
    override === "pause" ? { kind: "settings", settings: { run_state: "paused" }, now: 1 } : {
      kind: "task",
      now: 1,
      task: {
        requested_by: "OP",
        kind: "hold",
        time: 1,
        task_id: 1,
        asset_id: "A",
        now: true,
      },
    },
    config,
  ).state;
  const response = reduce(
    state,
    { kind: "tick", now: 2, hasWork: false },
    config,
  );
  assert.ok(
    response.effects.some(
      (e) => e.kind === "vehicle" && e.command.kind === "land",
    ),
  );
  const fallback = reduce(
    response.state,
    {
      kind: "command_failed",
      execution_id: response.state.commandId,
      now: 3,
      explanation: "landing unavailable",
    },
    config,
  );
  assert.ok(
    fallback.effects.some(
      (e) => e.kind === "vehicle" && e.command.kind === "return_to_home",
    ),
  );
  const failed = reduce(
    fallback.state,
    {
      kind: "command_failed",
      execution_id: fallback.state.commandId,
      now: 4,
      explanation: "return unavailable",
    },
    config,
  );
  assert.equal(
    failed.effects.some(
      (e) => e.kind === "vehicle" && e.command.kind === "return_to_home",
    ),
    false,
  );
});

test("docs/failsafes.md: boundary margin and continuous duration reset on return inside", async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.initial_settings.failsafe_policy = [{ rule_id: "AREA", priority: 50,
    conditions: [{ kind: "outside_area", area: [
      { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 },
      { latitude: 0.001, longitude: 0.001 }, { latitude: 0.001, longitude: 0 },
    ], margin_m: 10, for_s: 2 }], response: { kind: "hold" } }];
  let state = initial(config, 0);
  const sample = (latitude: number, now: number) => {
    state = reduce(state, { kind: "measurements", measurements: {
      position: { value: { latitude, longitude: 0.0005 }, source: "gps", time: now },
      armed: { value: true, source: "vehicle", time: now },
    } }, config).state;
    const result = reduce(state, { kind: "tick", now, hasWork: false }, config);
    state = result.state;
    return result;
  };
  assert.equal(sample(0.00105, 0).state.phase, "ordinary");
  assert.equal(sample(0.002, 100).state.phase, "ordinary");
  assert.equal(sample(0.0005, 2000).state.phase, "ordinary");
  assert.equal(sample(0.002, 2100).state.phase, "ordinary");
  assert.equal(sample(0.002, 4099).state.phase, "ordinary");
  assert.ok(sample(0.002, 4100).effects.some(e => e.kind === "response" && e.rule?.rule_id === "AREA" && e.status === "active"));
});

test("docs/failsafes.md: known height can violate a boundary without a matching height reference", async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.initial_settings.failsafe_policy = [{ rule_id: "HEIGHT", priority: 50, conditions: [{ kind: "outside_area",
    area: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }, { latitude: 1, longitude: 0 }],
    max_altitude: { altitude_m: 10, altitude_reference: "launch" },
    min_altitude: { altitude_m: 5, altitude_reference: "ground" }, margin_m: 2,
  }], response: { kind: "land" } }];
  let state = initial(config, 0);
  state.measurements.position = { value: { latitude: 0.1, longitude: 0.1, altitudes: [{ altitude_m: 13, altitude_reference: "launch" }] }, source: "gps", time: 0 };
  assert.equal(reduce(state, { kind: "tick", now: 0, hasWork: false }, config).state.phase, "failsafe");
  assert.equal(reduce(state, { kind: "tick", now: 6000, hasWork: false }, config).state.phase, "ordinary");
});

test("docs/failsafes.md: invalid live policy keeps the previous policy", async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  const state = initial(config, 0);
  const result = reduce(state, { kind: "settings", now: 0, request_id: 10, settings: {
    failsafe_policy: [...config.initial_settings.failsafe_policy!, { rule_id: "BAD", priority: 1, conditions: [{ kind: "airborne" }], response: { kind: "capture", camera_id: "C1", media: "photo" } }],
  } }, config);
  assert.deepEqual(result.state.settings, state.settings);
});

for (const defect of ["priority", "identity", "subsystem"] as const)
  test(`docs/failsafes.md: live policy rejects invalid ${defect} before replacement`, async () => {
    const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
    const state = initial(config, 0);
    const policy = [...config.initial_settings.failsafe_policy!, {
      rule_id: defect === "identity" ? "CB" : "NEW",
      priority: defect === "priority" ? 99 : 50,
      conditions: defect === "subsystem"
        ? [{ kind: "subsystem" as const, subsystem_id: "NONE", trigger_condition: "faulted" as const }]
        : [{ kind: "airborne" as const }],
      response: { kind: "land" as const },
    }];
    const result = reduce(state, { kind: "settings", now: 0, request_id: 11, settings: { failsafe_policy: policy } }, config);
    assert.deepEqual(result.state.settings, state.settings);
  });

for (const priority of [40, 50, 60])
  test(`docs/failsafes.md: priority ${priority} versus a running priority 50 response`, async () => {
    const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
    const state = initial(config, 0);
    state.settings = { ...state.settings, failsafe_policy: [
      { rule_id: "FIRST", priority: 50, conditions: [{ kind: "commanded" }], response: { kind: "land" } },
      { rule_id: "NEXT", priority, conditions: [{ kind: "battery_below", battery_percent: 30 }], response: { kind: "land" } },
    ] };
    state.measurements.position = { value: { latitude: 0.1, longitude: 0.1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] }, source: "gps", time: 0 };
    state.measurements.armed = { value: true, source: "vehicle", time: 0 };
    const running = reduce(state, { kind: "task", now: 0, task: { kind: "failsafe", asset_id: "A", task_id: 1, requested_by: "OP", time: 0, now: true } }, config).state;
    running.measurements.battery = { value: 20, source: "vehicle", time: 1 };
    const result = reduce(running, { kind: "tick", now: 1, hasWork: false }, config);
    assert.equal(result.effects.some(e => e.kind === "response" && e.rule?.rule_id === "NEXT" && e.status === "active"), priority > 50);
    assert.equal(result.effects.some(e => e.kind === "response" && e.rule?.rule_id === "FIRST" && e.status === "cancelled"), priority > 50);
  });

for (const override of ["hold", "pause"] as const)
  test(`docs/failsafes.md: ${override} re-arms contact and boundary rules and a lower critical level fires`, async () => {
    const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
    let state = initial(config, 0);
    state.settings = { ...state.settings, link_loss_after_s: 1, failsafe_policy: [
      { rule_id: "CONTACT", priority: 50, conditions: [{ kind: "contact_lost" }], response: { kind: "land" } },
      { rule_id: "AREA", priority: 60, conditions: [{ kind: "outside_area", area: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }, { latitude: 1, longitude: 0 }] }], response: { kind: "land" } },
      { rule_id: "LOW", priority: 10, conditions: [{ kind: "battery_below", battery_percent: 5, critical: true }], response: { kind: "land" } },
    ] };
    state.measurements.position = { value: { latitude: 0.1, longitude: 0.1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] }, source: "gps", time: 0 };
    state.measurements.armed = { value: true, source: "vehicle", time: 0 };
    state = reduce(state, { kind: "tick", now: 1000, hasWork: false }, config).state;
    const applyOverride = (now: number) => {
      state = reduce(state, override === "hold"
        ? { kind: "task", now, task: { kind: "hold", now: true, asset_id: "A", task_id: now, requested_by: "OP", time: now } }
        : { kind: "settings", now, settings: { run_state: "paused" } }, config).state;
    };
    applyOverride(1001);
    state = reduce(state, { kind: "contact", contact: { open: true, last_heard: 1002 } }, config).state;
    state = reduce(state, { kind: "tick", now: 1002, hasWork: false }, config).state;
    let result = reduce(state, { kind: "tick", now: 2002, hasWork: false }, config);
    assert.ok(result.effects.some(e => e.kind === "response" && e.rule?.rule_id === "CONTACT" && e.status === "active"));
    state = result.state;
    applyOverride(2003);
    state.measurements.position = { value: { latitude: 2, longitude: 2 }, source: "gps", time: 2004 };
    result = reduce(state, { kind: "tick", now: 2004, hasWork: false }, config);
    assert.ok(result.effects.some(e => e.kind === "response" && e.rule?.rule_id === "AREA" && e.status === "active"));
    state = result.state;
    applyOverride(2005);
    state.measurements.battery = { value: 4, source: "vehicle", time: 2006 };
    result = reduce(state, { kind: "tick", now: 2006, hasWork: false }, config);
    assert.ok(result.effects.some(e => e.kind === "response" && e.rule?.rule_id === "LOW" && e.status === "active"));
  });

test("docs/failsafes.md: simultaneous critical rules select the higher priority and failures never retry", async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  let state = initial(config, 0);
  state.settings = { ...state.settings, failsafe_policy: [
    { rule_id: "LOW", priority: 10, conditions: [{ kind: "battery_below", battery_percent: 10, critical: true }], response: { kind: "land" } },
    { rule_id: "HIGH", priority: 20, conditions: [{ kind: "battery_below", battery_percent: 10, critical: true }], response: { kind: "land" } },
  ] };
  state.measurements.position = { value: { latitude: 0.1, longitude: 0.1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] }, source: "gps", time: 0 };
  state.measurements.battery = { value: 5, source: "vehicle", time: 0 };
  state.measurements.armed = { value: true, source: "vehicle", time: 0 };
  const result = reduce(state, { kind: "tick", now: 0, hasWork: false }, config);
  assert.deepEqual(result.effects.filter(e => e.kind === "response" && e.status === "active").map(e => e.kind === "response" && e.rule?.rule_id), ["HIGH"]);
  state = result.state;
  state.measurements.position = { value: { latitude: 0.1, longitude: 0.1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] }, source: "gps", time: 0 };
  state.measurements.battery = { value: 50, source: "vehicle", time: 1 };
  state = reduce(state, { kind: "command_failed", execution_id: state.commandId, now: 1, explanation: "refused" }, config).state;
  for (const now of [2, 3]) {
    const next = reduce(state, { kind: "tick", now, hasWork: false }, config);
    assert.equal(next.effects.some(e => e.kind === "response" && e.status === "active"), false);
    state = next.state;
  }
});

for (const critical of [false, true])
  for (const action of ["land", "return_to_home"] as const)
    for (const stillCritical of [false, true])
      test(`docs/failsafes.md: ${action} failure, critical=${critical}, still below=${stillCritical} falls back only once`, async () => {
        const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
        let state = initial(config, 0);
        state.settings = { ...state.settings, home_position: { latitude: 1, longitude: 1 }, failsafe_policy: [
          { rule_id: "BAT", priority: 50, conditions: [{ kind: "battery_below", battery_percent: 10, critical }], response: { kind: action } },
        ] };
        state.measurements = {
          position: { value: { latitude: 2, longitude: 2, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] }, source: "gps", time: 0 },
          armed: { value: true, source: "vehicle", time: 0 },
          battery: { value: 5, source: "vehicle", time: 0 },
        };
        state = reduce(state, { kind: "tick", now: 0, hasWork: false }, config).state;
        state.measurements.battery = { value: stillCritical ? 5 : 50, source: "vehicle", time: 1 };
        const failed = reduce(state, { kind: "command_failed", execution_id: state.commandId, now: 1, explanation: "equipment refused" }, config);
        assert.equal(failed.effects.some(e => e.kind === "response" && e.status === "active" && e.action.kind === "return_to_home"), critical && stillCritical && action === "land");
        state = failed.state;
        if (state.execution)
          state = reduce(state, { kind: "command_failed", execution_id: state.commandId, now: 2, explanation: "fallback refused" }, config).state;
        for (const now of [3, 4]) {
          const tick = reduce(state, { kind: "tick", now, hasWork: false }, config);
          assert.equal(tick.effects.some(e => e.kind === "response" && e.status === "active"), false);
          state = tick.state;
        }
      });

for (const kind of ["land", "return_to_home"] as const)
  test(`docs/failsafes.md: ${kind} override stands while a critical battery rule matches`, async () => {
    const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
    let state = initial(config, 0);
    state.phase = "failsafe";
    state.settings = { ...state.settings, home_position: { latitude: 1, longitude: 1 } };
    state.measurements = {
      position: { value: { latitude: 2, longitude: 2, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] }, source: "gps", time: 0 },
      armed: { value: true, source: "vehicle", time: 0 },
      battery: { value: 5, source: "vehicle", time: 0 },
    };
    state = reduce(state, { kind: "task", now: 0, task: { kind, task_id: 1, asset_id: "A", requested_by: "OP", time: 0, now: true } }, config).state;
    for (const now of [1, 2]) {
      const result = reduce(state, { kind: "tick", now, hasWork: false }, config);
      assert.equal(result.effects.some(e => e.kind === "response" && e.status === "active"), false);
      assert.equal(result.state.execution?.task?.task_id, 1);
      state = result.state;
    }
  });

test("docs/failsafes.md: subsystem thresholds use fresh evidence and unknown never triggers", async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.initial_settings.failsafe_policy = [{ rule_id: "GPS", priority: 50,
    conditions: [{ kind: "subsystem", subsystem_id: "GPS", trigger_condition: "degraded" }], response: { kind: "land" } }];
  for (const condition of ["unknown", "healthy", "degraded", "faulted"] as const) {
    for (const stale of [false, true]) {
      const state = initial(config, 0);
      Object.assign(state.measurements, { armed: { value: true, source: "equipment", time: 0 }, position: { value: { latitude: 1, longitude: 1 }, source: "equipment", time: 0 }, subsystems: { GPS: { value: { condition }, source: "equipment", time: 0 } } });
      const result = reduce(state, { kind: "tick", now: stale ? 6000 : 0, hasWork: false }, config);
      assert.equal(result.effects.some(e => e.kind === "response" && e.status === "active"),
        !stale && (condition === "degraded" || condition === "faulted"), `${condition}, stale=${stale}`);
    }
  }
});

test("docs/failsafes.md: a lost equipment link fails active movement even after its command was accepted", async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  let state = initial(config, 0);
  state.measurements = {
    position: { value: { latitude: 1, longitude: 1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] }, time: 0, source: "equipment" },
    armed: { value: true, time: 0, source: "equipment" },
  };
  state = reduce(state, { kind: "task", now: 0, task: { kind: "move_to", destination: { latitude: 2, longitude: 2 }, task_id: 1, asset_id: "A", requested_by: "OP", time: 0 } }, config).state;
  state = reduce(state, { kind: "measurements", measurements: { connected: { value: false, source: "equipment", time: 1 } } }, config).state;
  const result = reduce(state, { kind: "tick", now: 1, hasWork: true }, config);
  assert.ok(result.effects.some(e => e.kind === "task" && e.status === "failed" && e.explanation === "equipment connection lost"));
  assert.ok(result.effects.some(e => e.kind === "clear"));
  assert.equal(result.state.phase, "ordinary");
});

for (const [west, east, longitude, outside] of [
  [-1, 1, 179.9, true], [-1, 1, -179.9, true], [-1, 1, 0, false],
  [179, -179, 179.9, false], [179, -179, -179.9, false], [179, -179, 0, true],
] as const) test(`docs/failsafes.md: polygon ${west} to ${east} at longitude ${longitude}`, async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.initial_settings.failsafe_policy = [{ rule_id: "AREA", priority: 1,
    conditions: [{ kind: "outside_area", area: [
      { latitude: -1, longitude: west }, { latitude: -1, longitude: east },
      { latitude: 1, longitude: east }, { latitude: 1, longitude: west },
    ] }], response: { kind: "land" } }];
  let state = initial(config, 0);
  state.measurements = { position: { value: { latitude: 0, longitude }, source: "vehicle", time: 0 },
    armed: { value: true, source: "vehicle", time: 0 } };
  assert.equal(reduce(state, { kind: "tick", now: 0, hasWork: false }, config).state.phase === "failsafe", outside);
});
