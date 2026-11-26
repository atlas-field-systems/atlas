import { test } from "node:test";
import assert from "node:assert/strict";
import { follow } from "@atlas/sdk";
import { reportingPeripheral } from "../src/peripheral.ts";
import { sdkAssetCaller } from "../src/actors.ts";
import { assetApp } from "../src/asset-app.ts";
import { scenario } from "../src/scenario.ts";
import { createWorld, value } from "../src/world.ts";

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

test("sdk/docs/asset.md: late contact subscribers see the current IP stream immediately", async t => {
  const w = await createWorld();
  t.after(() => w.close());
  const { session } = await sdkAssetCaller(w);
  await w.settle();
  const contacts: { open: boolean; last_heard: number | null }[] = [];
  const unsubscribe = session.link.onContact(contact => contacts.push(contact));
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].open, true);
  assert.equal(typeof contacts[0].last_heard, "number");
  unsubscribe();
});

scenario({
  name: "an IP Asset with no link-loss timeout holds after 30 seconds without contact",
  checks: ["core/docs/api.md#contact", "asset/docs/failsafes.md#configure-conditions-as-well-as-responses"],
  async run(w) {
    const app = await assetApp(w, { equipment: "ardupilot", config: {
      initial_settings: { failsafe_policy: [{
        rule_id: "CB", priority: 99, conditions: [{ kind: "battery_below", critical: true, battery_percent: 5 }],
        response: { kind: "land" },
      }] },
    } });
    const params = { asset_id: app.asset_id };
    await w.until(() => w.events.some(e => e.kind === "report.telemetry" && e.record.asset_id === app.asset_id));
    const takeoff = value(await w.complete(w.admin.call("sendTasks", { params, body: { tasks: [
      { kind: "takeoff", target_altitude: { altitude_reference: "launch", altitude_m: 10 } },
    ] } })));
    await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "task" &&
      e.record.task_id === takeoff.task_ids[0] && e.record.task_state === "completed"));

    const sentAt = w.clock.now();
    value(await w.complete(w.admin.call("changeSettings", { params, body: { settings: { failsafe_policy: [
      ...(app.config.initial_settings.failsafe_policy ?? []),
      { rule_id: "LINK", priority: 10, conditions: [{ kind: "contact_lost" }], response: { kind: "hold" } },
    ] } } })));
    await w.until(() => w.events.some(e => e.kind === "report.settings" &&
      e.record.settings.failsafe_policy?.some(r => r.rule_id === "LINK")));
    const cutAt = w.clock.now();
    w.network.cut("asset");
    await w.advance(32000);
    w.network.heal("asset");
    await w.advance(10000);

    const responses = w.events.flatMap(e => e.kind === "report.failsafe" && e.record.kind === "response" &&
      e.record.rule_id === "LINK" ? [e.record] : []);
    assert.deepEqual(responses.map(r => r.task_state), ["active", "completed"]);
    assert.ok(responses[0]!.time >= sentAt + 30000, "a fresh command reset the contact clock");
    assert.ok(responses[0]!.time <= cutAt + 30000 + app.config.control_tick_s * 1000,
      "the next control tick after 30 seconds without contact fired the rule");
  },
});
