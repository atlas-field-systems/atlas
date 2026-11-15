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
