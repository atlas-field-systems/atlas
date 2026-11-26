import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseConfig, inspectConfig } from "../src/config.ts";

test("config.md: inspection validates Protocol values without equipment access and removes the key", async () => {
  const input = JSON.parse(
    await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"),
  );
  const config = parseConfig(input);
  assert.equal(inspectConfig(config).asset_key, "[removed]");
  assert.throws(
    () => parseConfig({ ...input, max_ground_speed_mps: 1 }),
    /exceeds/,
  );
  const { measurement_stale_after_s, ...missing } = input;
  assert.equal(inspectConfig(parseConfig(missing)).measurement_stale_after_s, 5);
  assert.throws(
    () => parseConfig({ ...input, initial_settings: { run_state: "go" } }),
    /invalid/,
  );
});

test("config.md: flying equipment requires a critical battery rule", async () => {
  const input = JSON.parse(
    await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"),
  );
  assert.throws(
    () =>
      parseConfig({
        ...input,
        initial_settings: { ...input.initial_settings, failsafe_policy: [] },
      }),
    /critical battery/,
  );
});

test("config.md: inspection fills omitted fields in per-command tolerance overrides", async () => {
  const input = JSON.parse(
    await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"),
  );
  input.completion_tolerances = { land: { horizontal_m: 4 } };
  assert.deepEqual(inspectConfig(parseConfig(input)).completion_tolerances.land, { horizontal_m: 4, altitude_m: 0.5, stopped_mps: 0.3 });
});

test("config.md: only command-capable equipment requires a safe action", async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  delete input.safe_action;
  assert.throws(() => parseConfig(input), /safe_action/);
  const tracker = JSON.parse(await readFile(new URL("../examples/tracker.json", import.meta.url), "utf8"));
  const effective = inspectConfig(parseConfig(tracker));
  assert.equal(effective.safe_action, undefined);
  assert.deepEqual(effective.completion_tolerances, {});
  assert.equal(effective.reporting.heartbeat_s, 5);
});

test("config.md: takeoff capability defines flying equipment independent of entity type", async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  delete input.description.entity_type;
  input.initial_settings.failsafe_policy = [];
  assert.throws(() => parseConfig(input), /critical battery/);
});

for (const kind of ["gpsd", "peripheral"]) test(`config.md: ${kind} acquisition cannot advertise movement`, async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  input.equipment = { kind, host: "127.0.0.1", port: 2947, max_message_bytes: 1024, reconnect_s: 1 };
  assert.throws(() => parseConfig(input), /acquisition-only equipment/);
});

for (const profile of ["completion_tolerances", "command_timeouts"] as const) test(`config.md: movement supplies the internal Hold ${profile}`, async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  input.description.commands = input.description.commands.filter((kind: string) => kind !== "hold");
  assert.ok(inspectConfig(parseConfig(input))[profile].hold);
});

test("config.md: inspection removes URL credentials", async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  input.link.core_url = "https://operator:example-secret@example.com";
  const inspected = inspectConfig(parseConfig(input));
  assert.equal(new URL(inspected.link.core_url).username, "");
  assert.equal(new URL(inspected.link.core_url).password, "");
});

test("config.md: ArduPilot observation rates have defaults and enforce wire limits", async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  delete input.equipment.stream_rate_hz;
  delete input.equipment.extended_state_interval_us;
  const defaults = parseConfig(input).equipment;
  assert.equal(defaults.kind, "ardupilot");
  if (defaults.kind !== "ardupilot") throw new Error("expected ArduPilot");
  assert.equal(defaults.stream_rate_hz, 5);
  assert.equal(defaults.extended_state_interval_us, 200000);
  for (const [field, invalid] of [
    ["stream_rate_hz", [0, -1, 1.5, 65536]],
    ["extended_state_interval_us", [0, -1, 1.5, 2147483648]],
  ] as const) for (const value of invalid)
    assert.throws(() => parseConfig({ ...input, equipment: { ...input.equipment, [field]: value } }), new RegExp(field));
});

test("config.md: reporting-only initial settings may be omitted but control settings remain required", async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  delete input.initial_settings;
  assert.throws(() => parseConfig(input), /initial_settings/);
  input.description = { commands: [], reports: ["telemetry"] };
  assert.deepEqual(parseConfig(input).initial_settings, {});
});

for (const profile of ["completion_tolerances", "command_timeouts"] as const) test(`config.md and docs/failsafes.md: critical fallback supplies internal Return to home ${profile}`, async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  input.description.commands = ["takeoff", "land", "hold", "failsafe"];
  input.safe_action = { kind: "land" };
  input.initial_settings.failsafe_policy = [{ rule_id: "CB", priority: 99, conditions: [{ kind: "battery_below", battery_percent: 10, critical: true }], response: { kind: "land" } }];
  assert.ok(inspectConfig(parseConfig(input))[profile].return_to_home);
});
