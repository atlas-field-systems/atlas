import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseConfig } from "../src/config.ts";
import { initial, reduce, type State } from "../src/control.ts";

test("docs/failsafes.md: critical battery replaces Hold immediately, then failed critical Land falls back once", async () => {
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
    {
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
