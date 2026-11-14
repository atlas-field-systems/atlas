import { test } from "node:test";
import assert from "node:assert/strict";
import { startHarness, protocol } from "./harness.ts";
import type { Clock } from "../src/clock.ts";

function simulatedClock() {
  let time = 1794560400000;
  const timers = new Set<{ at: number; fn: () => void }>();
  return {
    now: () => time,
    after(ms: number, fn: () => void) {
      const t = { at: time + ms, fn };
      timers.add(t);
      return {
        cancel() {
          timers.delete(t);
        },
      };
    },
    advance(ms: number) {
      time += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at))
        if (t.at <= time && timers.delete(t)) t.fn();
    },
  } satisfies Clock & { advance(ms: number): void };
}
type Harness = Awaited<ReturnType<typeof startHarness>>;
const description = {
  reports: ["status", "settings", "telemetry", "observation"],
  commands: ["hold", "move_to", "land", "capture", "failsafe"],
  settings: ["run_state", "lights", "failsafe_policy"],
};
async function asset(h: Harness, body: unknown = description) {
  const issued = await h.call("POST", "/administration/asset-keys", {
    cookie: h.admin,
  });
  const registered = await h.call("POST", "/entities/assets", {
    key: issued.body.key,
    body,
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  return {
    id: registered.body.asset_id as string,
    key: issued.body.key as string,
  };
}
async function report(
  h: Harness,
  a: { id: string; key: string },
  reports: unknown[],
) {
  const r = await h.call("POST", `/entities/assets/${a.id}/reports`, {
    key: a.key,
    body: { reports },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
}
const task = (
  h: Harness,
  id: string,
  body: unknown = { tasks: [{ kind: "hold" }] },
) => h.call("POST", `/tasks/${id}`, { cookie: h.admin, body });
const queue = (a: string, time: number, n: number, request_id?: number) => ({
  type: "report.status",
  kind: "queue",
  time,
  asset_id: a,
  task_ids: Array.from({ length: n }, (_, i) => i + 1),
  ...(request_id ? { request_id } : {}),
});

async function events(h: Harness) {
  const end = (await h.call("GET", "/entities", { cookie: h.admin })).body
    .as_of;
  const ac = new AbortController();
  const r = await fetch(h.core.url + "/events?after=0", {
    headers: { cookie: h.admin, "atlas-definitions": protocol.hash },
    signal: ac.signal,
  });
  const reader = r.body!.getReader();
  let text = "";
  try {
    while (!text.includes(`id: ${end}\n`))
      text += new TextDecoder().decode((await reader.read()).value);
  } finally {
    ac.abort();
    await reader.cancel().catch(() => {});
  }
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}
async function plugin(h: Harness) {
  const p = (
    await h.call("POST", "/administration/plugins", { cookie: h.admin })
  ).body;
  await h.call("PUT", `/plugins/${p.plugin_id}/description`, {
    key: p.key,
    body: {
      type: "plugin.description",
      time: 1794560400000,
      plugin_id: p.plugin_id,
      name: "Lookup",
      actions: [{ action: "find", label: "Find", inputs: [] }],
    },
  });
  return p;
}
test("F1 only recipient and answering kind settle requests [api.md#operator-requests, api.md#plugins]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h),
      b = await asset(h),
      p = await plugin(h);
    const call = await h.call("POST", `/plugins/${p.plugin_id}/actions/find`, {
      cookie: h.admin,
      body: { inputs: [] },
    });
    const setting = await h.call("PATCH", `/entities/assets/${b.id}/settings`, {
      cookie: h.admin,
      body: { settings: { lights: "on" } },
    });
    for (const request_id of [call.body.event_id, setting.body.event_id])
      await report(h, a, [
        {
          type: "report.settings",
          time: c.now(),
          asset_id: a.id,
          request_id,
          settings: { lights: "off" },
        },
      ]);
    const answer = await h.call("POST", `/plugins/${p.plugin_id}/answers`, {
      key: p.key,
      body: {
        type: "plugin.result",
        time: c.now(),
        plugin_id: p.plugin_id,
        request_id: call.body.event_id,
      },
    });
    assert.equal(answer.status, 200);
    assert.equal(
      (
        await h.call("GET", `/plugins/${p.plugin_id}/calls`, {
          cookie: h.admin,
        })
      ).status,
      200,
    );
    await report(h, b, [queue(b.id, c.now(), 0, setting.body.event_id)]);
    c.advance(31000);
    assert.ok(
      (await events(h)).some(
        (e) =>
          e.kind === "request.dropped" &&
          e.record.request_id === setting.body.event_id,
      ),
    );
  } finally {
    await h.close();
  }
});
test("F2 ahead queues confirm Tasks without affecting cap [api.md#asset-and-gateway-calls]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h),
      sent = await task(h, a.id);
    await report(h, a, [queue(a.id, c.now() + 11000, 1, sent.body.event_id)]);
    assert.equal(
      (await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin })).body.items[0]
        .state,
      "queued",
    );
    c.advance(31000);
    const read = (await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin }))
      .body;
    assert.equal(read.items[0].state, "queued");
    assert.deepEqual(read.held, []);
  } finally {
    await h.close();
  }
});
test(
  "F3 stop bounds stalled HTTP requests [reset.md#stopping-core-ends-the-run]",
  { timeout: 10000 },
  async () => {
    const { connect } = await import("node:net");
    const c = simulatedClock(),
      h = await startHarness(c),
      socket = connect(Number(new URL(h.core.url).port), "127.0.0.1");
    socket.on("error", () => {});
    try {
      await new Promise<void>((r) => socket.once("connect", r));
      socket.write(
        `POST /objects?name=slow HTTP/1.1\r\nHost: localhost\r\nCookie: ${h.admin}\r\nAtlas-Definitions: ${protocol.hash}\r\nIdempotency-Key: slow\r\nContent-Type: application/octet-stream\r\nContent-Length: 1000\r\n\r\nx`,
      );
      await h.call("GET", "/about");
      const stopping = h.core.stop();
      c.advance(5000);
      assert.equal((await stopping).archived, true);
    } finally {
      socket.destroy();
      await h.close();
    }
  },
);
test("F4 diagnostics obey total limit including gaps [logging.md#when-logging-cannot-keep-up]", async () => {
  const { readdir, readFile } = await import("node:fs/promises"),
    { join } = await import("node:path");
  const h = await startHarness(undefined, {
    log_total_limit_bytes: 2048,
    log_file_limit_bytes: 2048,
    debug_endpoint: true,
  });
  try {
    for (let i = 0; i < 25; i++) {
      await h.call("GET", "/about");
      await (await fetch(h.core.debugUrl!)).text();
    }
    const dir = join(h.dataDir, "diagnostics/run-1");
    const bytes = (
      await Promise.all((await readdir(dir)).map((n) => readFile(join(dir, n))))
    ).reduce((n, b) => n + b.length, 0);
    assert.ok(bytes <= 2048, `${bytes} bytes exceeds 2048`);
    const result = await h.core.stop();
    assert.equal(result.archived, true);
    if (result.archived) {
      const { readZip } = await import("../src/reset/zip.ts");
      const entry = (await readZip(result.zip)).find(
        (e) => e.name === "manifest.json",
      )!;
      const chunks: Buffer[] = [];
      for await (const chunk of entry.open()) chunks.push(Buffer.from(chunk));
      const manifest = JSON.parse(Buffer.concat(chunks).toString());
      assert.ok(manifest.gaps.some((g: { lost: number }) => g.lost > 0));
    }
  } finally {
    await h.close();
  }
});
test("F5 only registered Assets create places and Objects [api.md#geo-features, api.md#objects]", async () => {
  const h = await startHarness();
  try {
    const issued = (
      await h.call("POST", "/administration/asset-keys", { cookie: h.admin })
    ).body;
    const place = () =>
      h.call("POST", "/entities/geofeatures", {
        key: issued.key,
        body: { kind: "point", position: { latitude: 0, longitude: 0 } },
      });
    const upload = () =>
      fetch(h.core.url + "/objects?name=photo", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.key}`,
          "atlas-definitions": protocol.hash,
          "idempotency-key": crypto.randomUUID(),
          "content-type": "image/jpeg",
        },
        body: "x",
      });
    assert.equal((await place()).status, 403);
    const denied = await upload();
    await denied.text();
    assert.equal(denied.status, 403);
    const a = (
      await h.call("POST", "/entities/assets", {
        key: issued.key,
        body: description,
      })
    ).body.asset_id;
    assert.equal((await place()).status, 200);
    const stored = await upload();
    assert.equal(stored.status, 201);
    const id = (await stored.json()).object_id;
    assert.equal(
      (await h.call("GET", `/objects/${id}`, { cookie: h.admin })).body
        .requested_by,
      a,
    );
    assert.equal(
      (await events(h)).find((e) => e.kind === "geofeature.created")
        .requested_by,
      a,
    );
  } finally {
    await h.close();
  }
});
test("F6 about records each differing definitions hash once per caller [api.md#basics]", async () => {
  const h = await startHarness();
  try {
    const a = await asset(h),
      g = (
        await h.call("POST", "/administration/gateways", { cookie: h.admin })
      ).body,
      p = await plugin(h);
    for (const key of [a.key, g.key, p.key])
      for (const hash of [
        "sha256:ab",
        "sha256:ab",
        "sha256:" + "0".repeat(64),
      ]) {
        const r = await fetch(h.core.url + "/about", {
          headers: {
            authorization: `Bearer ${key}`,
            "atlas-definitions": hash,
          },
        });
        await r.text();
        assert.equal(r.status, 200);
      }
    const refusals = (await events(h)).filter(
      (e) => e.kind === "definitions.refused",
    );
    assert.equal(refusals.length, 6);
    assert.equal(
      refusals.filter((e) => e.record.definitions_hash === "sha256:ab").length,
      3,
    );
  } finally {
    await h.close();
  }
});
test("F8 diagnostics identify routes, refusals, validation paths and streams [logging.md#record-the-whole-path-through-core]", async () => {
  const h = await startHarness(undefined, { debug_endpoint: true });
  try {
    await h.call("POST", "/entities/geofeatures", {
      cookie: h.admin,
      body: { kind: "point", position: { latitude: "bad", longitude: 0 } },
    });
    await asset(h);
    await events(h);
    const log = await (await fetch(h.core.debugUrl!)).text();
    const rows = log
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.ok(
      rows.some(
        (r) =>
          r.route === "/entities/geofeatures" &&
          r.error === "invalid" &&
          r.explanation.includes("/position/latitude"),
      ),
    );
    assert.ok(rows.some((r) => r.msg === "event stream connected"));
    assert.ok(rows.some((r) => r.msg === "event stream disconnected"));
  } finally {
    await h.close();
  }
});
test("F9 registration announces initial contact [api.md#contact, api.md#reads]", async () => {
  const h = await startHarness();
  try {
    const a = await asset(h),
      g = (
        await h.call("POST", "/administration/gateways", { cookie: h.admin })
      ).body;
    const radio = (
      await h.call("POST", "/entities/assets/radios", {
        key: g.key,
        body: { definitions_hash: protocol.hash },
      })
    ).body.asset_id;
    const contact = (await events(h))
      .filter((e) => e.kind === "asset.contact")
      .map((e) => [e.record.asset_id, e.record.contact]);
    assert.deepEqual(contact, [
      [a.id, "online"],
      [radio, "offline"],
    ]);
  } finally {
    await h.close();
  }
});
test("F10 login retry keys bind the complete body across accounts [api.md#basics, api.md#callers-and-credentials]", async () => {
  const h = await startHarness();
  try {
    const body = { operator_id: "ADM", password: "contract-password-unique" },
      idem = "login-retry";
    assert.equal(
      (await h.call("POST", "/administration/login", { idem, body })).status,
      200,
    );
    for (const changed of [
      { ...body, password: body.password + "x" },
      { operator_id: "OP1", password: body.password },
    ])
      assert.equal(
        (await h.call("POST", "/administration/login", { idem, body: changed }))
          .body.error,
        "idempotency_conflict",
      );
    assert.equal(
      (await h.call("POST", "/administration/login", { idem, body })).status,
      200,
    );
  } finally {
    await h.close();
  }
});
test("F11 removed Plugin call history remains readable [api.md#plugins]", async () => {
  const h = await startHarness();
  try {
    const p = await plugin(h),
      base = `/plugins/${p.plugin_id}`;
    const call = await h.call("POST", base + "/actions/find", {
      cookie: h.admin,
      body: { inputs: [] },
    });
    await h.call("DELETE", `/administration/plugins/${p.plugin_id}`, {
      cookie: h.admin,
    });
    const list = await h.call("GET", base + "/calls", { cookie: h.admin });
    assert.equal(list.status, 200);
    assert.equal(list.body.items[0].call.event_id, call.body.event_id);
    assert.equal(list.body.items[0].answer.kind, "plugin.dropped");
  } finally {
    await h.close();
  }
});
test("F12 malformed path escapes use listed errors [api.md#basics]", async () => {
  const h = await startHarness();
  try {
    assert.equal(
      (await h.call("GET", "/entities/assets/%E0%A4%A", { cookie: h.admin }))
        .body.error,
      "invalid",
    );
  } finally {
    await h.close();
  }
});
test("F13 logout clears cookies and stale cookies allow public routes [api.md#callers-and-credentials]", async () => {
  const h = await startHarness();
  try {
    const logout = await h.call("POST", "/administration/logout", {
      cookie: h.admin,
    });
    assert.match(
      logout.headers.get("set-cookie") ?? "",
      /atlas_session=;.*Max-Age=0/,
    );
    assert.equal(
      (await h.call("GET", "/about", { cookie: h.admin })).status,
      200,
    );
    assert.equal(
      (
        await h.call("POST", "/administration/login", {
          cookie: h.admin,
          body: { operator_id: "ADM", password: "contract-password-unique" },
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.call("GET", "/entities", { cookie: h.admin })).status,
      401,
    );
  } finally {
    await h.close();
  }
});
