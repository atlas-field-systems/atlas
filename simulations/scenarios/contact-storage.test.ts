import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createLivePicture } from "@atlas/sdk";
import { assetApp } from "../src/asset-app.ts";
import { createWorld } from "../src/world.ts";

test("an open operator picture shows expired contact during a failed offline write", async (t) => {
  let database: DatabaseSync | undefined;
  const exec = DatabaseSync.prototype.exec;
  const capture = t.mock.method(DatabaseSync.prototype, "exec", function(this: DatabaseSync, sql: string) {
    database = this;
    return exec.call(this, sql);
  });
  const w = await createWorld({ offline_after_s: 5, stream_keepalive_s: 1 });
  capture.mock.restore();
  assert.ok(database);
  t.after(() => w.close());
  const app = await assetApp(w, { config: {
    description: { commands: [], reports: ["telemetry"] }, initial_settings: {},
  } });
  const picture = createLivePicture(w.admin);
  w.onClose(() => picture.stop());
  const item = () => picture.assets().items.find(a => a.asset_id === app.asset_id);
  await w.until(() => item()?.contact.contact === "online");
  database.exec("CREATE TEMP TRIGGER fail_contact BEFORE UPDATE OF contact ON assets BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END");
  w.network.cut("asset");
  await w.advance(7000);
  await w.until(() => item()?.contact_storage_pending === true);
  assert.equal(item()?.contact.contact, "offline");
  assert.equal(w.events.some(e => e.kind === "asset.contact" && e.record.contact === "offline"), false);
  database.exec("DROP TRIGGER fail_contact");
  await w.advance(2000);
  await w.until(() => item()?.contact.contact === "offline" && !item()?.contact_storage_pending);
  assert.ok(w.events.some(e => e.kind === "asset.contact" && e.record.contact === "offline"));
});
