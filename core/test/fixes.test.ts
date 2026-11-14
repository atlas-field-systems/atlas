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
