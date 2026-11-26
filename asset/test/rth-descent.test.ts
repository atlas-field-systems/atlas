import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseConfig } from "../src/config.ts";
import { initial, reduce } from "../src/control.ts";
import type { Measurements } from "../src/vehicle.ts";

test("docs/failsafes.md: critical Return to home timeout during Land-mode descent keeps landing", async () => {
  const raw = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  raw.initial_settings.failsafe_policy = [{ rule_id: "CB", priority: 99, conditions: [{ kind: "battery_below", battery_percent: 10, critical: true }], response: { kind: "return_to_home" } }];
  raw.initial_settings.home_position = { latitude: 0.001, longitude: 0.001 };
  const config = parseConfig(raw);
  let state = initial(config, 0);
  const sample = (t: number): Measurements => ({
    position: { value: { latitude: 0, longitude: 0, altitudes: [{ altitude_m: 20, altitude_reference: "launch" }] }, source: "t", time: t },
    armed: { value: true, source: "t", time: t }, airborne: { value: true, source: "t", time: t },
    in_control: { value: true, source: "t", time: t }, connected: { value: true, source: "t", time: t },
    battery: { value: 5, source: "t", time: t }, speed: { value: 0, source: "t", time: t },
  });
  state = reduce(state, { kind: "measurements", measurements: sample(0) }, config).state;
  let r = reduce(state, { kind: "tick", now: 0, hasWork: false }, config);
  state = r.state;
  assert.equal(state.execution?.execution.kind, "return_to_home");
  state = reduce(state, { kind: "tick", now: 1, hasWork: false }, config).state;
  state = reduce(state, { kind: "measurements", measurements: {
    ...sample(2), position: { value: { ...config.initial_settings.home_position!, altitudes: [{ altitude_m: 20, altitude_reference: "launch" }] }, source: "vehicle", time: 2 },
  } }, config).state;
  r = reduce(state, { kind: "tick", now: 2, hasWork: false }, config);
  state = r.state;
  assert.ok(r.effects.some(e => e.kind === "vehicle" && e.command.kind === "land"));
  state = reduce(state, { kind: "command_accepted", execution_id: state.commandId, now: 2 }, config).state;
  const timeout = config.command_timeouts.return_to_home;
  assert.ok(timeout);
  const t = timeout * 1000 + 1;
  state = reduce(state, { kind: "measurements", measurements: sample(t) }, config).state;
  r = reduce(state, { kind: "tick", now: t, hasWork: false }, config);
  assert.ok(r.effects.some(e => e.kind === "response" && e.status === "failed"));
  assert.equal(r.effects.some(e => e.kind === "vehicle"), false, "timeout must not interrupt the Land descent");
});
