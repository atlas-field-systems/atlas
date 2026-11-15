import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseConfig } from "../src/config.ts";
import { initial, reduce } from "../src/control.ts";

test("docs/failsafes.md: a closed stream cannot reset the local contact-loss deadline", async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  config.initial_settings.link_loss_after_s = 12;
  config.initial_settings.failsafe_policy = [{ rule_id: "LINK", priority: 50, conditions: [{ kind: "contact_lost" }], response: { kind: "land" } }];
  let state = initial(config, 0);
  state = reduce(state, { kind: "contact", contact: { open: true, last_heard: 1000 } }, config).state;
  state = reduce(state, { kind: "contact", contact: { open: false, last_heard: null } }, config).state;
  assert.equal(reduce(state, { kind: "tick", now: 12999, hasWork: false }, config).state.locked, false);
  assert.equal(reduce(state, { kind: "tick", now: 13000, hasWork: false }, config).state.locked, true);
});

test("docs/README.md: updating active work changes its destination without finishing the Task", async () => {
  const config = parseConfig(JSON.parse(await readFile(new URL("../examples/copter.json", import.meta.url), "utf8")));
  let state = initial(config, 0);
  state.measurements = {
    position: { value: { latitude: 1, longitude: 1 }, source: "vehicle", time: 0 },
    armed: { value: true, source: "vehicle", time: 0 },
  };
  const task = { kind: "move_to", task_id: 1, requested_by: "OP", asset_id: "A", time: 0, destination: { latitude: 2, longitude: 2 } } as const;
  state = reduce(state, { kind: "task", task, now: 0 }, config).state;
  const updated = reduce(state, { kind: "update", task: { ...task, destination: { latitude: 3, longitude: 3 } }, now: 1 }, config);
  assert.equal(updated.effects.some((e) => e.kind === "task"), false);
  assert.ok(updated.effects.some((e) => e.kind === "vehicle" && e.command.kind === "move_to" && e.command.position.latitude === 3));
});
