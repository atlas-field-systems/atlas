import { once } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import { startHarness, protocol, stopCore, simulatedClock } from "./harness.ts";
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
    const result = await h.stop();
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
    assert.equal(
      (await h.call("GET", "/plugins/ZZZZ/calls", { cookie: h.admin })).status,
      404,
    );
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
      idem: "logout-retry",
    });
    assert.match(
      logout.headers.get("set-cookie") ?? "",
      /atlas_session=;.*Max-Age=0/,
    );
    const retry = await h.call("POST", "/administration/logout", {
      cookie: h.admin,
      idem: "logout-retry",
    });
    assert.equal(retry.status, logout.status);
    assert.deepEqual(retry.body, logout.body);
    assert.equal(
      retry.headers.get("set-cookie"),
      logout.headers.get("set-cookie"),
    );
    assert.equal(
      (await h.call("POST", "/administration/logout", { cookie: h.admin }))
        .status,
      401,
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
test("F14 startup refuses archives within data including symlink aliases [config.md, reset.md#check-then-clear]", async () => {
  const { startCore } = await import("../src/core.ts"),
    { mkdtemp, rm, mkdir, symlink } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const c = simulatedClock();
  const dir = await mkdtemp(join(tmpdir(), "atlas-paths-"));
  try {
    await mkdir(join(dir, "objects"));
    await symlink(join(dir, "objects"), dir + "-alias");
    for (const archive_directory of [
      join(dir, "objects/run-1"),
      dir + "-alias/archives",
    ]) {
      let started: Awaited<ReturnType<typeof startCore>> | undefined;
      try {
        await assert.rejects(async () => {
          started = await startCore({
            clock: c,
            config: {
              data_directory: dir,
              archive_directory,
              listen_address: "127.0.0.1",
              port: 0,
            },
          });
        }, /archive_directory.*outside.*data_directory/);
      } finally {
        if (started) await stopCore(started, c);
      }
    }
    const started = await startCore({
      clock: c,
      config: {
        data_directory: dir + "/",
        listen_address: "127.0.0.1",
        port: 0,
      },
    });
    const stopped = await stopCore(started, c);
    assert.ok(stopped.archived);
    assert.ok(stopped.zip.startsWith(dir + "-archive/"));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(dir + "-alias", { force: true });
    await rm(dir + "-archive", { recursive: true, force: true });
  }
});
test("F15 streams end when their credential is revoked [api.md#callers-and-credentials]", async () => {
  const h = await startHarness();
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  try {
    const issued = (
      await h.call("POST", "/administration/asset-keys", { cookie: h.admin })
    ).body;
    const open = async (headers: Record<string, string>) => {
      const r = await fetch(h.core.url + "/events", {
        headers: { ...headers, "atlas-definitions": protocol.hash },
      });
      const reader = r.body!.getReader();
      readers.push(reader);
      return reader;
    };
    const id = (
      await h.call("POST", "/entities/assets", {
        key: issued.key,
        body: description,
      })
    ).body.asset_id;
    const assetReader = await open({ authorization: `Bearer ${issued.key}` });
    await h.call("POST", `/administration/asset-keys/${issued.key_id}/key`, {
      cookie: h.admin,
    });
    await task(h, id);
    await assert.rejects(assetReader.read(), { message: "terminated" });
    const accountReader = await open({ cookie: h.admin });
    await h.call("POST", "/administration/logout", { cookie: h.admin });
    await assert.rejects(accountReader.read(), { message: "terminated" });
  } finally {
    for (const reader of readers) await reader.cancel().catch(() => {});
    await h.close();
  }
});
test("F16 equal-time later Observations update Tracks and bearings clear positions [api.md#reads, fusion.md#temporary-first-iteration]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    for (const position of [
      { latitude: 1, longitude: 0 },
      { latitude: 2, longitude: 0 },
    ])
      await report(h, a, [
        {
          type: "report.observation",
          kind: "coordinates",
          time: c.now(),
          asset_id: a.id,
          observation_id: "O1",
          position,
        },
      ]);
    const beforeRepeat = (await events(h)).filter(
      (e) => e.kind === "track.updated",
    ).length;
    await report(h, a, [
      {
        type: "report.observation",
        kind: "coordinates",
        time: c.now(),
        asset_id: a.id,
        observation_id: "O1",
        position: { latitude: 2, longitude: 0 },
      },
    ]);
    assert.equal(
      (await events(h)).filter((e) => e.kind === "track.updated").length,
      beforeRepeat,
    );
    let tracks = (await h.call("GET", "/entities/tracks", { cookie: h.admin }))
      .body.items;
    assert.equal(tracks[0].position.latitude, 2);
    await report(h, a, [
      {
        type: "report.observation",
        kind: "bearing",
        time: c.now(),
        asset_id: a.id,
        observation_id: "O1",
        origin: { latitude: 0, longitude: 0 },
        bearing_deg: 90,
      },
    ]);
    tracks = (await h.call("GET", "/entities/tracks", { cookie: h.admin })).body
      .items;
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].position, undefined);
  } finally {
    await h.close();
  }
});
test("F17 failsafe responses must name supported commands [api.md#operator-requests]", async () => {
  const h = await startHarness();
  try {
    const a = await asset(h, {
      reports: ["status", "settings"],
      commands: ["hold"],
      settings: ["failsafe_policy"],
    });
    const settings = {
      failsafe_policy: [
        {
          rule_id: "R1",
          priority: 1,
          conditions: [{ kind: "commanded" }],
          response: { kind: "land" },
        },
      ],
    };
    const patch = await h.call("PATCH", `/entities/assets/${a.id}/settings`, {
      cookie: h.admin,
      body: { settings },
    });
    const queued = await task(h, a.id, {
      tasks: [{ kind: "settings", settings }],
    });
    assert.deepEqual(
      [patch.body.error, queued.body.error],
      ["not_supported", "not_supported"],
    );
    const captureSettings = {
      failsafe_policy: [
        {
          rule_id: "R2",
          priority: 1,
          conditions: [{ kind: "commanded" }],
          response: { kind: "capture", camera_id: "NOPE", media: "photo" },
        },
      ],
    };
    const cameraAsset = await asset(h);
    for (const result of [
      await h.call("PATCH", `/entities/assets/${cameraAsset.id}/settings`, {
        cookie: h.admin,
        body: { settings: captureSettings },
      }),
      await task(h, cameraAsset.id, {
        tasks: [{ kind: "settings", settings: captureSettings }],
      }),
    ])
      assert.equal(result.body.error, "not_supported");
  } finally {
    await h.close();
  }
});
test("F18 Reset summary uses contact with no domain event [reset.md#cores-reset-zip]", async () => {
  const { readZip } = await import("../src/reset/zip.ts");
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    c.advance(10000);
    await report(h, a, []);
    const heard = c.now();
    c.advance(31000);
    const stopped = await h.stop();
    assert.equal(stopped.archived, true);
    if (!stopped.archived) return;
    const entry = (await readZip(stopped.zip)).find(
      (e) => e.name === "summary.md",
    )!;
    const chunks: Buffer[] = [];
    for await (const chunk of entry.open()) chunks.push(Buffer.from(chunk));
    assert.ok(
      Buffer.concat(chunks)
        .toString()
        .includes(
          `Asset ${a.id}, gateway none, first heard 1794560400000, last heard ${heard}.`,
        ),
    );
  } finally {
    await h.close();
  }
});
test("F19 bootstrap removes only one trailing newline [config.md]", async () => {
  const { startCore } = await import("../src/core.ts"),
    { mkdtemp, writeFile, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const c = simulatedClock();
  const dir = await mkdtemp(join(tmpdir(), "atlas-password-"));
  let core: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    const exact = "bootstrap-password-with-space ";
    await writeFile(join(dir, "pw"), exact + "\n");
    core = await startCore({
      clock: c,
      config: {
        data_directory: dir,
        listen_address: "127.0.0.1",
        port: 0,
        first_admin: { operator_id: "ADM", password_file: join(dir, "pw") },
      },
    });
    for (const [password, status] of [
      [exact, 200],
      [exact.trimEnd(), 401],
    ] as const) {
      const r: Response = await fetch(core.url + "/administration/login", {
        method: "POST",
        headers: {
          "atlas-definitions": protocol.hash,
          "idempotency-key": crypto.randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ operator_id: "ADM", password }),
      });
      await r.text();
      assert.equal(r.status, status);
    }
  } finally {
    if (core) await stopCore(core, c);
    await rm(dir, { recursive: true, force: true });
    await rm(dir + "-archive", { recursive: true, force: true });
  }
});
test("F20 event streams never renew Asset or Plugin contact [api.md#contact, api.md#plugins]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c),
    controllers: AbortController[] = [];
  const open = async (key: string) => {
    const ac = new AbortController();
    controllers.push(ac);
    const r = await fetch(h.core.url + "/events", {
      headers: {
        authorization: `Bearer ${key}`,
        "atlas-definitions": protocol.hash,
      },
      signal: ac.signal,
    });
    assert.equal(r.status, 200);
  };
  try {
    const a = await asset(h);
    c.advance(31000);
    await open(a.key);
    assert.equal((await task(h, a.id)).body.error, "asset_offline");
    const p = await plugin(h);
    const call = await h.call("POST", `/plugins/${p.plugin_id}/actions/find`, {
      cookie: h.admin,
      body: { inputs: [] },
    });
    c.advance(20000);
    await open(p.key);
    c.advance(15000);
    assert.equal(
      (
        await h.call(
          "GET",
          `/plugins/${p.plugin_id}/calls/${call.body.event_id}`,
          { cookie: h.admin },
        )
      ).body.answer.kind,
      "plugin.dropped",
    );
  } finally {
    for (const ac of controllers) ac.abort();
    await h.close();
  }
});

test("R2-3 summary uses recipient and answer-kind settlement [reset.md#cores-reset-zip]", async () => {
  const h = await startHarness();
  try {
    const p = await plugin(h),
      a = await asset(h);
    const call = await h.call("POST", `/plugins/${p.plugin_id}/actions/find`, {
      cookie: h.admin,
      body: { inputs: [] },
    });
    await report(h, a, [queue(a.id, 1794560400000, 0, call.body.event_id)]);
    assert.equal(
      (
        await h.call("POST", `/plugins/${p.plugin_id}/answers`, {
          key: p.key,
          body: {
            type: "plugin.result",
            time: 1794560400000,
            plugin_id: p.plugin_id,
            request_id: call.body.event_id,
          },
        })
      ).status,
      200,
    );
    const stopped = await h.stop();
    assert.ok(stopped.archived);
    const { execFileSync } = await import("node:child_process");
    assert.ok(
      execFileSync("unzip", ["-p", stopped.zip, "summary.md"], {
        encoding: "utf8",
      }).includes(`Plugin call ${call.body.event_id}: plugin.result.`),
    );
  } finally {
    await h.close();
  }
});

test(
  "R2-9 uploads admitted before stop finish in grace [reset.md#stopping-core-ends-the-run]",
  { timeout: 10000 },
  async () => {
    const { connect } = await import("node:net");
    const c = simulatedClock(),
      h = await startHarness(c);
    const socket = connect(Number(new URL(h.core.url).port), "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (response += chunk));
    const ended = new Promise<void>((resolve) => socket.on("end", resolve));
    try {
      await new Promise<void>((resolve) => socket.once("connect", resolve));
      socket.write(
        `POST /objects?name=grace HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nCookie: ${h.admin}\r\nAtlas-Definitions: ${protocol.hash}\r\nIdempotency-Key: grace\r\nContent-Type: application/octet-stream\r\nContent-Length: 2\r\n\r\nx`,
      );
      await h.call("GET", "/about");
      const stop = h.core.stop();
      socket.write("y");
      await ended;
      assert.match(response, /^HTTP\/1.1 201 /);
      c.advance(5000);
      assert.ok((await stop).archived);
    } finally {
      socket.destroy();
      c.advance(5000);
      await h.close();
    }
  },
);

test("R2-10 unregistered key mismatches are diagnostics once per hash [api.md#basics]", async () => {
  const h = await startHarness(undefined, { debug_endpoint: true });
  try {
    const issued = (
      await h.call("POST", "/administration/asset-keys", { cookie: h.admin })
    ).body;
    for (const hash of ["sha256:ab", "sha256:ab", "sha256:cd"]) {
      const response = await fetch(h.core.url + "/about", {
        headers: {
          authorization: `Bearer ${issued.key}`,
          "atlas-definitions": hash,
        },
      });
      assert.equal(response.status, 200);
      await response.text();
    }
    const rows = (await (await fetch(h.core.debugUrl!)).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      rows
        .filter((r) => r.msg === "Unregistered Asset definitions mismatch")
        .map((r) => [r.key_id, r.definitions_hash]),
      [
        [issued.key_id, "sha256:ab"],
        [issued.key_id, "sha256:cd"],
      ],
    );
    const snapshot = await h.call("GET", "/entities", { cookie: h.admin });
    assert.equal(snapshot.body.as_of, 0);
  } finally {
    await h.close();
  }
});

async function crashCore(config: Record<string, unknown>) {
  const { mkdtemp, writeFile, rm, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawn, execFileSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "atlas-round2-crash-"));
  await writeFile(join(dir, "pw"), "crash-contract-password");
  await writeFile(
    join(dir, "config.json"),
    JSON.stringify({
      data_directory: dir,
      listen_address: "127.0.0.1",
      port: 0,
      first_admin: { operator_id: "ADM", password_file: join(dir, "pw") },
      ...config,
    }),
  );
  let url = "",
    debugUrl = "";
  let child: ReturnType<typeof spawn>;
  async function start() {
    child = spawn(process.execPath, ["src/main.ts", join(dir, "config.json")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      errors = "";
    child.stderr!.on("data", (chunk) => (errors += chunk));
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Core exited ${code}: ${errors}`)),
      );
      child.stdout!.on("data", (chunk) => {
        output += chunk;
        if (output.includes("\n")) {
          const ready = JSON.parse(output.split("\n")[0]);
          url = ready.url;
          debugUrl = ready.debug_url;
          resolve();
        }
      });
    });
  }
  async function kill(signal: "SIGTERM" | "SIGKILL") {
    const exited = once(child, "exit");
    child.kill(signal);
    await exited;
  }
  await start();
  const call = async (
    path: string,
    body?: unknown,
    key?: string,
    cookie?: string,
  ) => {
    const response = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "atlas-definitions": protocol.hash,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, await response.clone().text());
    return { body: await response.json(), headers: response.headers };
  };
  const login = await call("/administration/login", {
    operator_id: "ADM",
    password: "crash-contract-password",
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  return {
    call,
    cookie,
    async flush() {
      await (await fetch(debugUrl)).text();
    },
    async crash() {
      await kill("SIGKILL");
      await start();
    },
    async archive() {
      await kill("SIGTERM");
      const [file] = await readdir(dir + "-archive");
      return (name: string) =>
        execFileSync("unzip", ["-p", join(dir + "-archive", file), name], {
          encoding: "utf8",
        });
    },
    async close() {
      if (child!.exitCode === null && child!.signalCode === null)
        await kill("SIGKILL");
      await rm(dir, { recursive: true, force: true });
      await rm(dir + "-archive", { recursive: true, force: true });
    },
  };
}

test("R2-1 diagnostic losses survive SIGKILL at total limit [logging.md#when-logging-cannot-keep-up]", async () => {
  const h = await crashCore({
    log_total_limit_bytes: 2048,
    log_file_limit_bytes: 2048,
    debug_endpoint: true,
  });
  try {
    for (let i = 0; i < 60; i++) await h.call("/about");
    await h.flush();
    await h.crash();
    const zip = await h.archive(),
      manifest = JSON.parse(zip("manifest.json"));
    const written = Object.keys(manifest.files)
      .filter((name) => name.startsWith("diagnostics/"))
      .reduce((n, name) => n + zip(name).trim().split("\n").length, 0);
    assert.ok(
      manifest.gaps.reduce(
        (n: number, gap: { lost: number }) => n + (gap.lost ?? 0),
        0,
      ) >=
        60 - written,
      "pre-crash losses must survive",
    );
  } finally {
    await h.close();
  }
});

test("R2-2 Reset preserves actual last heard across SIGKILL [reset.md#cores-reset-zip]", async () => {
  const h = await crashCore({ offline_after_s: 1 });
  try {
    const issued = (
      await h.call("/administration/asset-keys", {}, undefined, h.cookie)
    ).body;
    const registered = (
      await h.call("/entities/assets", description, issued.key)
    ).body;
    const gateway = (
      await h.call("/administration/gateways", {}, undefined, h.cookie)
    ).body;
    const plugin = (
      await h.call("/administration/plugins", {}, undefined, h.cookie)
    ).body;
    const before = Date.now();
    await h.call(
      `/entities/assets/${registered.asset_id}/reports`,
      { reports: [] },
      issued.key,
    );
    await h.call("/about", undefined, gateway.key);
    await h.call("/about", undefined, plugin.key);
    const after = Date.now();
    await h.crash();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const snapshot = await h.call(
      `/entities/assets/${registered.asset_id}`,
      undefined,
      undefined,
      h.cookie,
    );
    assert.equal(snapshot.body.item.contact.contact, "offline");
    const contacts = [
      snapshot.body.item.contact,
      (
        await h.call("/entities/assets", undefined, undefined, h.cookie)
      ).body.gateways.find(
        (g: { gateway_id: string }) => g.gateway_id === gateway.gateway_id,
      ),
      (
        await h.call("/plugins", undefined, undefined, h.cookie)
      ).body.items.find(
        (p: { plugin_id: string }) => p.plugin_id === plugin.plugin_id,
      ).contact,
    ];
    for (const contact of contacts) {
      assert.equal(contact.contact, "offline");
      assert.ok(
        contact.time >= before && contact.time <= after,
        `${contact.time} outside last arrival bounds ${before}..${after}`,
      );
    }
    const zip = await h.archive();
    const line = zip("summary.md")
      .split("\n")
      .find((line) => line.startsWith(`Asset ${registered.asset_id},`))!;
    const last = Number(line.match(/last heard (\d+)/)![1]);
    assert.ok(
      last >= before && last <= after,
      `${last} must be between ${before} and ${after}`,
    );
  } finally {
    await h.close();
  }
});

test("R3-2 gateway and radio refusals count separately [api.md#basics]", async () => {
  const h = await startHarness();
  try {
    const g = (
      await h.call("POST", "/administration/gateways", { cookie: h.admin })
    ).body;
    const hash = "sha256:" + "0".repeat(64);
    await h.call("POST", "/entities/assets/radios", {
      key: g.key,
      body: { definitions_hash: hash },
    });
    for (let i = 0; i < 2; i++) {
      const r = await fetch(h.core.url + "/about", {
        headers: {
          authorization: `Bearer ${g.key}`,
          "atlas-definitions": hash,
        },
      });
      await r.text();
    }
    const refusals = (await events(h)).filter(
      (e) => e.kind === "definitions.refused",
    );
    assert.equal(refusals.length, 2);
    assert.deepEqual(
      refusals.map((e) => e.record.radio ?? false),
      [true, false],
    );
  } finally {
    await h.close();
  }
});

test("R3-3 diagnostics cover versions, contact, downloads, Tracks and drops [logging.md#record-the-whole-path-through-core]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c, { debug_endpoint: true });
  try {
    const g = (
      await h.call("POST", "/administration/gateways", { cookie: h.admin })
    ).body;
    await h.call("GET", "/about", { key: g.key });
    const p = await plugin(h),
      a = await asset(h);
    await task(h, a.id);
    await h.call("POST", `/plugins/${p.plugin_id}/actions/find`, {
      cookie: h.admin,
      body: { inputs: [] },
    });
    await report(h, a, [
      {
        type: "report.observation",
        kind: "coordinates",
        time: c.now(),
        asset_id: a.id,
        observation_id: "O1",
        position: { latitude: 1, longitude: 2 },
      },
    ]);
    const uploaded = await fetch(h.core.url + "/objects?name=diagnostic", {
      method: "POST",
      headers: {
        cookie: h.admin,
        "atlas-definitions": protocol.hash,
        "idempotency-key": "diagnostic",
        "content-type": "application/octet-stream",
      },
      body: "file",
    });
    const object = await uploaded.json();
    const download = await fetch(
      h.core.url + `/objects/${object.object_id}/file`,
      { headers: { cookie: h.admin, "atlas-definitions": protocol.hash } },
    );
    await download.arrayBuffer();
    c.advance(31000);
    const rows = (await (await fetch(h.core.debugUrl!)).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const missing: string[] = [];
    if (
      !rows.some(
        (r) =>
          r.versions?.definitions_hash === protocol.hash &&
          r.versions.core_version &&
          r.versions.protocol_version,
      )
    )
      missing.push("versions");
    for (const [kind, id, column] of [
      ["Asset", a.id, "asset_id"],
      ["Gateway", g.gateway_id, "gateway_id"],
      ["Plugin", p.plugin_id, "plugin_id"],
    ])
      for (const contact of ["online", "offline"])
        if (
          !rows.some(
            (r) =>
              r.msg === `${kind} contact changed` &&
              r[column] === id &&
              r.contact === contact,
          )
        )
          missing.push(`${kind} ${contact}`);
    if (
      !rows.some(
        (r) =>
          r.msg === "file downloaded" &&
          r.route === "/objects/:object_id/file" &&
          r.object_id === object.object_id,
      )
    )
      missing.push("download");
    for (const kind of [
      "track.updated",
      "task.dropped",
      "request.dropped",
      "plugin.dropped",
    ])
      if (!rows.some((r) => r.kind === kind && r.event_id)) missing.push(kind);
    assert.deepEqual(missing, []);
  } finally {
    await h.close();
  }
});

test("R3-4 fresh connections get stopping throughout grace [reset.md#stopping-core-ends-the-run]", async () => {
  const { request } = await import("node:http");
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const stopping = h.core.stop();
    const response = await new Promise<{
      status: number | undefined;
      body: string;
    }>((resolve, reject) => {
      const req = request(h.core.url + "/about", { agent: false }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.body).error, "stopping");
    c.advance(5000);
    assert.ok((await stopping).archived);
  } finally {
    c.advance(5000);
    await h.close();
  }
});

test("R3-6 only event streams accept query definitions [api.md#basics, api.md#objects]", async () => {
  const h = await startHarness();
  try {
    for (const [method, path, body] of [
      ["GET", "/entities", undefined],
      ["POST", "/objects?name=query", "file"],
      [
        "POST",
        "/administration/login",
        JSON.stringify({
          operator_id: "ADM",
          password: "contract-password-unique",
        }),
      ],
    ] as const) {
      const r = await fetch(
        h.core.url +
          path +
          (path.includes("?") ? "&" : "?") +
          `definitions=${protocol.hash}`,
        {
          method,
          headers: {
            cookie: h.admin,
            "idempotency-key": crypto.randomUUID(),
            "content-type": path.startsWith("/objects")
              ? "application/octet-stream"
              : "application/json",
          },
          body,
        },
      );
      assert.equal(r.status, 409, path);
      assert.equal((await r.json()).error, "definitions_mismatch");
    }
    const ac = new AbortController();
    const stream = await fetch(
      h.core.url + `/events?definitions=${protocol.hash}`,
      { headers: { cookie: h.admin }, signal: ac.signal },
    );
    assert.equal(stream.status, 200);
    ac.abort();
    await stream.body?.cancel().catch(() => {});
  } finally {
    await h.close();
  }
});

test("R3-7 Reset state retains removed gateways and Plugins [reset.md#cores-reset-zip]", async () => {
  const h = await startHarness();
  try {
    const g = (
      await h.call("POST", "/administration/gateways", { cookie: h.admin })
    ).body;
    const neverHeard = (
      await h.call("POST", "/administration/gateways", { cookie: h.admin })
    ).body;
    await h.call("GET", "/about", { key: g.key });
    const p = await plugin(h);
    for (const [kind, id] of [
      ["gateways", g.gateway_id],
      ["gateways", neverHeard.gateway_id],
      ["plugins", p.plugin_id],
    ])
      assert.equal(
        (
          await h.call("DELETE", `/administration/${kind}/${id}`, {
            cookie: h.admin,
          })
        ).status,
        200,
      );
    assert.equal(
      (await h.call("GET", "/entities/assets", { cookie: h.admin })).body
        .gateways.length,
      0,
    );
    assert.equal(
      (await h.call("GET", "/plugins", { cookie: h.admin })).body.items.length,
      0,
    );
    assert.equal((await h.call("GET", "/about", { key: g.key })).status, 401);
    const stopped = await h.stop();
    assert.ok(stopped.archived);
    const { execFileSync } = await import("node:child_process");
    for (const [table, column, ids] of [
      ["gateways", "gateway_id", [g.gateway_id, neverHeard.gateway_id]],
      ["plugins", "plugin_id", [p.plugin_id]],
    ] as const) {
      const rows: Record<string, unknown>[] = execFileSync(
        "unzip",
        ["-p", stopped.zip, `state/${table}.jsonl`],
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        rows.map((row) => [row[column], row.removed]).sort(),
        ids.map((id) => [id, 1]).sort(),
      );
    }
  } finally {
    await h.close();
  }
});

test("R3-8 default listen starts on loopback without TLS [config.md#defaults]", async () => {
  const h = await crashCore({ listen_address: undefined });
  try {
    await h.call("/about");
    const { startCore } = await import("../src/core.ts");
    await assert.rejects(
      startCore({
        clock: simulatedClock(),
        config: { listen_address: "0.0.0.0" },
      }),
      /plain HTTP requires loopback/,
    );
  } finally {
    await h.close();
  }
});

test("Plugin inline imagery requires GeoTIFF and leaves refused calls open [api.md#objects]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const p = await plugin(h);
    const called = await h.call(
      "POST",
      `/plugins/${p.plugin_id}/actions/find`,
      { cookie: h.admin, body: { inputs: [] } },
    );
    assert.equal(called.status, 202);
    const request_id = called.body.event_id;
    const upload = async (bytes: Buffer<ArrayBuffer>) => {
      const response = await fetch(
        h.core.url + `/objects?name=imagery&request_id=${request_id}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${p.key}`,
            "Atlas-Definitions": protocol.hash,
            "Idempotency-Key": crypto.randomUUID(),
            "Content-Type": "image/tiff",
          },
          body: bytes,
        },
      );
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      return body.object_id;
    };
    const tagged = Buffer.alloc(26);
    tagged.write("II");
    tagged.writeUInt16LE(42, 2);
    tagged.writeUInt32LE(8, 4);
    tagged.writeUInt16LE(1, 8);
    tagged.writeUInt16LE(34735, 10);
    const text = await upload(Buffer.from("not a TIFF")),
      good = await upload(tagged);
    const answer = (object_id: string) =>
      h.call("POST", `/plugins/${p.plugin_id}/answers`, {
        key: p.key,
        body: {
          type: "plugin.result",
          time: c.now(),
          plugin_id: p.plugin_id,
          request_id,
          places: [{ kind: "imagery", object_id }],
        },
      });
    const refused = await answer(text);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, "not_geotiff");
    assert.equal(
      (
        await h.call("GET", `/plugins/${p.plugin_id}/calls/${request_id}`, {
          cookie: h.admin,
        })
      ).body.answer,
      null,
    );
    assert.equal((await answer(good)).status, 200);
  } finally {
    await h.close();
  }
});

test("imagery requires GeoKeyDirectory in the first image directory [api.md#objects]", async () => {
  const h = await startHarness();
  try {
    for (const little of [true, false]) {
      for (const first of [true, false]) {
        const bytes = Buffer.alloc(32);
        bytes.write(little ? "II" : "MM");
        const u16 = (v: number, at: number) =>
          little ? bytes.writeUInt16LE(v, at) : bytes.writeUInt16BE(v, at);
        const u32 = (v: number, at: number) =>
          little ? bytes.writeUInt32LE(v, at) : bytes.writeUInt32BE(v, at);
        u16(42, 2);
        u32(8, 4);
        if (first) {
          u16(1, 8);
          u16(34735, 10);
        } else {
          u32(14, 10);
          u16(1, 14);
          u16(34735, 16);
        }
        const response = await fetch(h.core.url + "/objects?name=directory", {
          method: "POST",
          headers: {
            cookie: h.admin,
            "Atlas-Definitions": protocol.hash,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: bytes,
        });
        assert.equal(response.status, 201);
        const object = await response.json();
        const imagery = await h.call("POST", "/entities/geofeatures", {
          cookie: h.admin,
          body: { kind: "imagery", object_id: object.object_id },
        });
        assert.equal(imagery.status, first ? 200 : 409);
        if (!first) assert.equal(imagery.body.error, "not_geotiff");
      }
    }
  } finally {
    await h.close();
  }
});

test("PR53-3 startup cursor includes work accepted before subscribing [api.md#asset-and-gateway-calls]", async () => {
  const h = await startHarness();
  const abort = new AbortController();
  try {
    const issued = (
      await h.call("POST", "/administration/asset-keys", { cookie: h.admin })
    ).body;
    const registered = (
      await h.call("POST", "/entities/assets", {
        key: issued.key,
        body: description,
      })
    ).body;
    assert.ok(
      Number.isSafeInteger(registered.as_of),
      "registration returns a stream cursor",
    );
    const sent = await task(h, registered.asset_id);
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const r = await fetch(h.core.url + "/events?after=" + registered.as_of, {
      headers: {
        authorization: `Bearer ${issued.key}`,
        "atlas-definitions": protocol.hash,
      },
      signal: abort.signal,
    });
    assert.equal(r.status, 200);
    const reader = r.body!.getReader();
    let text = "";
    while (!text.includes(`id: ${sent.body.event_id}\n`)) {
      text += new TextDecoder().decode((await reader.read()).value);
    }
    abort.abort();
    await reader.cancel().catch(() => {});
    assert.ok(text.includes("event: tasks.requested"));
  } finally {
    abort.abort();
    await h.close();
  }
});

test("PR53-8 successful no-op retries preserve a later attachment [api.md#basics]", async () => {
  const h = await startHarness();
  try {
    const upload = await fetch(h.core.url + "/objects?name=retry", {
      method: "POST",
      headers: {
        cookie: h.admin,
        "atlas-definitions": protocol.hash,
        "idempotency-key": "upload",
        "content-type": "application/octet-stream",
      },
      body: "file",
    });
    assert.equal(upload.status, 201);
    const path = "/objects/" + (await upload.json()).object_id;
    const opts = {
      cookie: h.admin,
      idem: "detach",
      body: { geofeature_id: null },
    };
    const first = await h.call("PATCH", path, opts);
    assert.equal(first.status, 200);
    const place = await h.call("POST", "/entities/geofeatures", {
      cookie: h.admin,
      body: { kind: "point", position: { latitude: 0, longitude: 0 } },
    });
    const id = place.body.geofeature.geofeature_id;
    assert.equal(
      (
        await h.call("PATCH", path, {
          cookie: h.admin,
          body: { geofeature_id: id },
        })
      ).status,
      200,
    );
    assert.deepEqual((await h.call("PATCH", path, opts)).body, first.body);
    assert.equal(
      (await h.call("GET", path, { cookie: h.admin })).body.geofeature_id,
      id,
    );
  } finally {
    await h.close();
  }
});

test("PR53-11 administration diagnostics name actor, target and retries without secrets [api.md#callers-and-credentials]", async () => {
  const h = await startHarness(undefined, { debug_endpoint: true });
  try {
    const created = await h.call("POST", "/administration/accounts", {
      cookie: h.admin,
      body: {
        operator_id: "AD2",
        admin: true,
        password: "second-admin-password",
      },
    });
    assert.equal(created.status, 201);
    const login = await h.call("POST", "/administration/login", {
      body: { operator_id: "AD2", password: "second-admin-password" },
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const issued = await h.call("POST", "/administration/asset-keys", {
      cookie: h.admin,
    });
    const route = `/administration/asset-keys/${issued.body.key_id}/key`;
    const opts = { cookie, idem: "rotate" };
    const rotated = await h.call("POST", route, opts);
    await h.call("POST", route, opts);
    const text = await (await fetch(h.core.debugUrl!)).text();
    const rows = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter(
        (r) =>
          r.msg === "request completed" &&
          r.route === "/administration/asset-keys/:key_id/key",
      );
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.deepEqual(row.actor, { kind: "account", operator_id: "AD2" });
      assert.deepEqual(row.params, { key_id: issued.body.key_id });
      assert.equal(row.acknowledgment.key_id, issued.body.key_id);
      assert.equal(row.acknowledgment.replaced, true);
    }
    assert.deepEqual(
      rows.map((r) => r.replayed),
      [false, true],
    );
    for (const secret of [
      issued.body.key,
      rotated.body.key,
      cookie.slice(14),
      "second-admin-password",
    ])
      assert.equal(text.includes(secret), false);
  } finally {
    await h.close();
  }
});

test("PR53-16 slow stream deadline destroys its socket [api.md#the-event-log-and-live-stream]", async () => {
  const { channel } = await import("node:diagnostics_channel");
  const { connect } = await import("node:net");
  const c = simulatedClock();
  const h = await startHarness(c);
  const opened = Promise.withResolvers<import("node:http").ServerResponse>();
  const requests = channel("http.server.request.start");
  const observe = (message: unknown) => {
    const event = message as {
      request: import("node:http").IncomingMessage;
      response: import("node:http").ServerResponse;
    };
    if (event.request.url?.startsWith("/events"))
      opened.resolve(event.response);
  };
  let socket: ReturnType<typeof connect> | undefined;
  requests.subscribe(observe);
  try {
    const body = {
      kind: "line",
      line: Array.from({ length: 32 }, () => ({
        latitude: 42.2746123456789,
        longitude: -71.8063123456789,
      })),
    };
    const first = await h.call("POST", "/entities/geofeatures", {
      cookie: h.admin,
      body,
    });
    const id = first.body.geofeature.geofeature_id;
    for (let i = 0; i < 125; i++)
      for (const result of await Promise.all(
        Array.from({ length: 32 }, () =>
          h.call("PUT", "/entities/geofeatures/" + id, {
            cookie: h.admin,
            body,
          }),
        ),
      ))
        assert.equal(result.status, 200);
    socket = connect(Number(new URL(h.core.url).port), "127.0.0.1");
    await once(socket, "connect");
    socket.pause();
    socket.write(
      `GET /events?after=0 HTTP/1.1\r\nHost: localhost\r\nCookie: ${h.admin}\r\nAtlas-Definitions: ${protocol.hash}\r\n\r\n`,
    );
    const response = await opened.promise;
    const transport = response.socket!;
    await h.call("GET", "/about");
    assert.equal(
      response.writableNeedDrain,
      true,
      "stream reached backpressure",
    );
    c.advance(30000);
    assert.equal(
      transport.destroyed,
      true,
      "deadline releases queued output and transport",
    );
  } finally {
    socket?.destroy();
    requests.unsubscribe(observe);
    await h.close();
  }
});
