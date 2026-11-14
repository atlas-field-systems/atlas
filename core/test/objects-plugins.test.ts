import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { startHarness, protocol, clock } from "./harness.ts";
import { readZip } from "../src/reset/zip.ts";

type Harness = Awaited<ReturnType<typeof startHarness>>;
async function upload(
  h: Harness,
  bytes: Uint8Array,
  query = "",
  key?: string,
  idem = crypto.randomUUID(),
  contentType = "application/octet-stream",
) {
  const r = await fetch(h.core.url + "/objects?name=test.bin" + query, {
    method: "POST",
    headers: {
      "atlas-definitions": protocol.hash,
      "idempotency-key": idem,
      "content-type": contentType,
      ...(key ? { authorization: `Bearer ${key}` } : { cookie: h.admin }),
    },
    body: Buffer.from(bytes),
  });
  return { status: r.status, body: await r.json() };
}
test("19. Object size boundary, attachments, imagery deletion and archived deleted files [api.md#objects, reset.md#cores-reset-zip]", async () => {
  const h = await startHarness(clock, { max_object_bytes: 26 });
  try {
    const idem = crypto.randomUUID();
    const exact = await upload(h, new Uint8Array(26), "", undefined, idem);
    assert.equal(exact.status, 201, JSON.stringify(exact));
    assert.equal((await upload(h, new Uint8Array(27))).status, 413);
    assert.deepEqual(
      await upload(h, new Uint8Array(26), "", undefined, idem),
      exact,
    );
    const download = await fetch(
      h.core.url + `/objects/${exact.body.object_id}/file`,
      { headers: { cookie: h.admin, "atlas-definitions": protocol.hash } },
    );
    assert.equal(download.status, 200);
    assert.deepEqual(
      Buffer.from(await download.arrayBuffer()),
      Buffer.alloc(26),
    );
    const id = exact.body.object_id;
    const place = await h.call("POST", "/entities/geofeatures", {
      cookie: h.admin,
      body: { kind: "point", position: { latitude: 0, longitude: 0 } },
    });
    const attach = await h.call("PATCH", `/objects/${id}`, {
      cookie: h.admin,
      body: { geofeature_id: place.body.geofeature.geofeature_id },
    });
    assert.equal(attach.status, 200);
    assert.equal(
      (
        await h.call("PATCH", `/objects/${id}`, {
          cookie: h.admin,
          body: { geofeature_id: place.body.geofeature.geofeature_id },
        })
      ).body.event_id,
      attach.body.event_id,
    );
    assert.equal(
      (
        await h.call("PATCH", `/objects/${id}`, {
          cookie: h.admin,
          body: { geofeature_id: null },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.call("POST", "/entities/geofeatures", {
          cookie: h.admin,
          body: { kind: "imagery", object_id: id },
        })
      ).body.error,
      "not_geotiff",
    );
    const tiff = Buffer.alloc(26);
    tiff.write("II");
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(34735, 10);
    const image = await upload(
      h,
      tiff,
      "",
      undefined,
      crypto.randomUUID(),
      "image/tiff",
    );
    assert.equal(image.status, 201);
    const imagery = await h.call("POST", "/entities/geofeatures", {
      cookie: h.admin,
      body: { kind: "imagery", object_id: image.body.object_id },
    });
    assert.equal(imagery.status, 200, JSON.stringify(imagery.body));
    assert.equal(
      (
        await h.call("DELETE", `/objects/${image.body.object_id}`, {
          cookie: h.admin,
        })
      ).body.error,
      "object_shown",
    );
    await h.call(
      "DELETE",
      `/entities/geofeatures/${imagery.body.geofeature.geofeature_id}`,
      { cookie: h.admin },
    );
    assert.equal(
      (
        await h.call("DELETE", `/objects/${image.body.object_id}`, {
          cookie: h.admin,
        })
      ).status,
      200,
    );
    const deleted = await h.call("GET", `/objects/${image.body.object_id}`, {
      cookie: h.admin,
    });
    assert.equal(deleted.status, 410);
    assert.equal(deleted.body.deletion.object_id, image.body.object_id);
    assert.equal(
      (
        await fetch(h.core.url + `/objects/${image.body.object_id}/file`, {
          headers: { cookie: h.admin, "atlas-definitions": protocol.hash },
        })
      ).status,
      410,
    );
    const stopped = await h.stop();
    assert.equal(stopped.archived, true);
    if (!stopped.archived) return;
    const entries = await readZip(stopped.zip);
    assert.ok(
      entries.some((e) => e.name === `objects/${image.body.object_id}`),
    );
    assert.deepEqual(
      await readdir(join(h.dataDir, "objects", `run-${h.core.runId}`)).catch(
        () => [],
      ),
      [],
    );
  } finally {
    await h.close();
  }
});
test("20. Plugin answers once, validates call ownership, and drops offline calls [api.md#plugins-answer, api.md#a-plugin-goes-offline-or-is-removed]", async () => {
  let now = clock.now();
  let timer: (() => void) | undefined;
  const c = {
    now: () => now,
    advance(ms: number) {
      now += ms;
      const fn = timer;
      timer = undefined;
      fn?.();
    },
    after(_ms: number, fn: () => void) {
      timer = fn;
      return {
        cancel() {
          timer = undefined;
        },
      };
    },
  };
  const h = await startHarness(c);
  try {
    const issued = await h.call("POST", "/administration/plugins", {
      cookie: h.admin,
    });
    const { plugin_id, key } = issued.body;
    const base = `/plugins/${plugin_id}`;
    assert.equal(
      (
        await h.call("POST", base + "/actions/find", {
          cookie: h.admin,
          body: { inputs: [] },
        })
      ).body.error,
      "plugin_offline",
    );
    assert.equal(
      (
        await h.call("PUT", base + "/description", {
          key,
          body: {
            type: "plugin.description",
            time: now,
            plugin_id,
            name: "Lookup",
            actions: [{ action: "find", label: "Find", inputs: [] }],
          },
        })
      ).status,
      200,
    );
    const invoke = () =>
      h.call("POST", base + "/actions/find", {
        cookie: h.admin,
        body: { inputs: [] },
      });
    const first = await invoke(),
      second = await invoke();
    const object = await upload(
      h,
      new Uint8Array([1]),
      `&request_id=${first.body.event_id}`,
      key,
    );
    assert.equal(object.status, 201, JSON.stringify(object));
    const result = {
      type: "plugin.result",
      time: now,
      plugin_id,
      request_id: second.body.event_id,
      object_ids: [object.body.object_id],
    };
    assert.equal(
      (await h.call("POST", base + "/answers", { key, body: result })).status,
      400,
    );
    result.request_id = first.body.event_id;
    assert.equal(
      (await h.call("POST", base + "/answers", { key, body: result })).status,
      200,
    );
    assert.equal(
      (await h.call("POST", base + "/answers", { key, body: result })).body
        .error,
      "call_settled",
    );
    now += 31000;
    timer?.();
    const dropped = await h.call(
      "GET",
      base + `/calls/${second.body.event_id}`,
      { cookie: h.admin },
    );
    assert.equal(dropped.body.answer.kind, "plugin.dropped");
    assert.equal(
      (
        await h.call("POST", base + "/answers", {
          key,
          body: { ...result, request_id: second.body.event_id },
        })
      ).body.error,
      "call_settled",
    );
    const third = await invoke();
    await h.call("DELETE", `/administration/plugins/${plugin_id}`, {
      cookie: h.admin,
    });
    assert.equal(
      (
        await h.call("GET", base + `/calls/${third.body.event_id}`, {
          cookie: h.admin,
        })
      ).body.answer.kind,
      "plugin.dropped",
    );
  } finally {
    await h.close();
  }
});
