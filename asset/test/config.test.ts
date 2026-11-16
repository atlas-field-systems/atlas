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
  assert.throws(() => parseConfig(missing), /measurement_stale_after_s/);
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

test("config.md: inspection names a missing per-command completion tolerance", async () => {
  const input = JSON.parse(
    await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"),
  );
  delete input.completion_tolerances.land;
  assert.throws(() => parseConfig(input), /completion_tolerances[\s\S]*land/);
});

test("config.md: reporting-only configuration needs no movement settings", async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  input.description = { commands: [], reports: ["telemetry"] };
  input.initial_settings = {};
  delete input.completion_tolerances;
  delete input.command_timeouts;
  delete input.default_ground_speed_mps;
  delete input.max_ground_speed_mps;
  assert.doesNotThrow(() => parseConfig(input));
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

for (const profile of ["completion_tolerances", "command_timeouts"]) test(`config.md: movement requires the internal Hold ${profile}`, async () => {
  const input = JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"));
  input.description.commands = input.description.commands.filter((kind: string) => kind !== "hold");
  delete input[profile].hold;
  assert.throws(() => parseConfig(input), new RegExp(`${profile}[\\s\\S]*hold`));
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
