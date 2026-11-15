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
