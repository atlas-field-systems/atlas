import { test } from "node:test";
import assert from "node:assert/strict";
import { follow } from "@atlas/sdk";
import { reportingPeripheral } from "../src/peripheral.ts";
import { createWorld } from "../src/world.ts";

test("sdk/docs/live.md: data and keepalives advance contact; closing retains the last hear-time", async (t) => {
  const w = await createWorld({ stream_keepalive_s: 2 });
  t.after(() => w.close());
  let contact = { open: false, last_heard: null as number | null };
  const stream = follow(w.admin, {
    after: 0,
    onContact: (next) => { contact = next; },
  }, () => {});
  t.after(() => stream.stop());
  await w.until(() => contact.open);
  const opened = contact.last_heard!;
  await w.advance(1000);
  await reportingPeripheral(w, { name: "contact-asset", config: {
    description: { commands: [], reports: ["telemetry"] }, initial_settings: {},
  } });
  await w.settle();
  assert.ok(contact.last_heard! > opened, "data frame must advance contact before a keepalive");
  const dataHeard = contact.last_heard!;
  await w.advance(2000);
  assert.ok(contact.last_heard! > dataHeard, "keepalive advances contact after registration data");
  assert.ok(contact.last_heard! <= w.clock.now());
  const heard = contact.last_heard;
  stream.stop();
  await w.complete(stream.done);
  assert.equal(contact.open, false);
  assert.equal(contact.last_heard, heard, "close must preserve contact evidence");
});
