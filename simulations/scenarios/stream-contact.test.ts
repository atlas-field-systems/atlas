import { test } from "node:test";
import assert from "node:assert/strict";
import { follow } from "@atlas/sdk";
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
  const issued = value(await w.complete(w.admin.call("createAssetKey")));
  if (!("key" in issued)) throw new Error("missing key");
  const asset = w.client("contact-asset", { kind: "asset", key: issued.key });
  value(await w.complete(asset.connect()));
  value(await w.complete(asset.call("register", { body: { entity_type: "drone", commands: [], reports: ["telemetry"], settings: ["home_position"] } })));
  await w.settle();
  assert.ok(contact.last_heard! > opened, "data frame must advance contact before a keepalive");
  await w.advance(2000);
  assert.equal(contact.last_heard, opened + 2000);
  const heard = contact.last_heard;
  stream.stop();
  await w.complete(stream.done);
  assert.equal(contact.open, false);
  assert.equal(contact.last_heard, heard, "close must preserve contact evidence");
});
