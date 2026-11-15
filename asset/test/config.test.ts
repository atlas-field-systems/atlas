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

test("config.md: link loss must exceed the configured Core keepalive interval", async () => {
  const input = JSON.parse(
    await readFile(new URL("../examples/copter.json", import.meta.url), "utf8"),
  );
  assert.throws(
    () =>
      parseConfig({
        ...input,
        initial_settings: { ...input.initial_settings, link_loss_after_s: 10 },
      }),
    /keepalive/,
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
