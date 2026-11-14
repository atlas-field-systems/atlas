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

test("4. paused work counts reported holdings, refusals consume no IDs [requests.md#scenario-paused-work-at-capacity]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    await report(h, a, [
      {
        type: "report.settings",
        time: c.now(),
        asset_id: a.id,
        settings: { run_state: "paused" },
      },
      queue(a.id, c.now(), 63),
    ]);
    assert.deepEqual((await task(h, a.id)).body.task_ids, [1]);
    await report(h, a, [queue(a.id, c.now(), 64)]);
    assert.equal((await task(h, a.id)).body.error, "queue_full");
    assert.equal(
      (await h.call("POST", `/tasks/${a.id}/1/cancel`, { cookie: h.admin }))
        .status,
      202,
    );
    await report(h, a, [queue(a.id, c.now(), 63)]);
    assert.deepEqual((await task(h, a.id)).body.task_ids, [2]);
    assert.deepEqual((await task(h, a.id)).body.task_ids, [3]);
  } finally {
    await h.close();
  }
});
test("5. now bypasses capacity; failsafe must be alone and now [requests.md#scenario-now-at-capacity, api.md#operator-requests]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    await report(h, a, [queue(a.id, c.now(), 64)]);
    assert.equal((await task(h, a.id)).body.error, "queue_full");
    assert.equal(
      (await task(h, a.id, { tasks: [{ kind: "land" }], now: true })).status,
      202,
    );
    assert.equal(
      (await task(h, a.id, { tasks: [{ kind: "failsafe" }] })).status,
      400,
    );
    assert.equal(
      (await task(h, a.id, { tasks: [{ kind: "failsafe" }], now: true }))
        .status,
      202,
    );
  } finally {
    await h.close();
  }
});
test("6. admission refuses offline, unsupported commands, settings, cameras and unsafe flying policies [api.md#operator-requests]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    assert.equal(
      (await task(h, a.id, { tasks: [{ kind: "return_to_home" }] })).body.error,
      "not_supported",
    );
    assert.equal(
      (
        await task(h, a.id, {
          tasks: [{ kind: "capture", camera_id: "CAM", media: "photo" }],
        })
      ).body.error,
      "not_supported",
    );
    assert.equal(
      (
        await h.call("PATCH", `/entities/assets/${a.id}/settings`, {
          cookie: h.admin,
          body: { settings: { landing_gear: "up" } },
        })
      ).body.error,
      "not_supported",
    );
    const flying = await asset(h, {
      ...description,
      commands: ["takeoff", "hold", "land"],
    });
    assert.equal(
      (await task(h, flying.id)).body.error,
      "no_critical_battery_rule",
    );
    assert.equal(
      (
        await task(h, flying.id, {
          tasks: [{ kind: "settings", settings: { failsafe_policy: [] } }],
        })
      ).body.error,
      "no_critical_battery_rule",
    );
    const policy = [
      {
        rule_id: "BAT",
        priority: 1,
        conditions: [
          { kind: "battery_below", battery_percent: 10, critical: true },
        ],
        response: { kind: "land" },
      },
    ];
    assert.equal(
      (
        await h.call("PATCH", `/entities/assets/${flying.id}/settings`, {
          cookie: h.admin,
          body: { settings: { failsafe_policy: policy } },
        })
      ).status,
      202,
    );
    assert.equal(
      (await task(h, flying.id)).body.error,
      "no_critical_battery_rule",
    );
    await report(h, flying, [
      {
        type: "report.settings",
        time: c.now(),
        asset_id: flying.id,
        settings: { failsafe_policy: policy },
      },
    ]);
    assert.equal((await task(h, flying.id)).status, 202);
    assert.equal(
      (
        await h.call("PATCH", `/entities/assets/${flying.id}/settings`, {
          cookie: h.admin,
          body: { settings: { failsafe_policy: [] } },
        })
      ).body.error,
      "no_critical_battery_rule",
    );
    c.advance(30000);
    assert.equal((await task(h, a.id)).body.error, "asset_offline");
  } finally {
    await h.close();
  }
});
test("7. numbering, send_last, forward states and app restart drops [api.md#operator-requests]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    const sent = await task(h, a.id, {
      tasks: [{ kind: "hold" }, { kind: "hold" }],
    });
    assert.deepEqual(sent.body.task_ids, [1, 2]);
    await report(h, a, [
      queue(a.id, c.now(), 2, sent.body.event_id),
      {
        type: "report.status",
        kind: "task",
        time: c.now(),
        asset_id: a.id,
        task_id: 1,
        task_state: "completed",
      },
      {
        type: "report.status",
        kind: "task",
        time: c.now() - 100,
        asset_id: a.id,
        task_id: 1,
        task_state: "active",
      },
    ]);
    let read = await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin });
    assert.equal(read.body.items[0].task.send_last, 2);
    assert.equal(read.body.items[0].state, "completed");
    const restart = await h.call("POST", "/entities/assets", {
      key: a.key,
      body: description,
    });
    assert.equal(restart.body.asset_id, a.id);
    assert.equal(restart.body.last_task_id, 2);
    read = await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin });
    assert.equal(read.body.items[1].state, "dropped");
    assert.deepEqual((await task(h, a.id)).body.task_ids, [3]);
    assert.equal(
      (await h.call("POST", `/tasks/${a.id}/1/cancel`, { cookie: h.admin }))
        .body.error,
      "task_ended",
    );
    assert.equal(
      (await h.call("POST", `/tasks/${a.id}/999/cancel`, { cookie: h.admin }))
        .status,
      404,
    );
  } finally {
    await h.close();
  }
});
test("8. offline drops are durable evidence and keyed stream skips dropped requests [api.md#operator-requests]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    const sent = await task(h, a.id);
    await h.call("PATCH", `/entities/assets/${a.id}/settings`, {
      cookie: h.admin,
      body: { settings: { lights: "on" } },
    });
    c.advance(30000);
    assert.equal(
      (await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin })).body.items[0]
        .state,
      "dropped",
    );
    const controller = new AbortController();
    const response = await fetch(
      h.core.url + `/events?after=${sent.body.event_id - 1}`,
      {
        headers: {
          authorization: `Bearer ${a.key}`,
          "atlas-definitions": protocol.hash,
        },
        signal: controller.signal,
      },
    );
    const reader = response.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(chunk, /event: task.dropped/);
    assert.doesNotMatch(chunk, /event: (tasks.requested|settings.requested)/);
    controller.abort();
    await reader.cancel().catch(() => {});
  } finally {
    await h.close();
  }
});
test("9. quiet or removed gateway takes radios offline at their own last-heard time; reports alone do not revive radio contact [api.md#contact]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const g = (
      await h.call("POST", "/administration/gateways", { cookie: h.admin })
    ).body;
    const radio = await h.call("POST", "/entities/assets/radios", {
      key: g.key,
      body: { definitions_hash: protocol.hash },
    });
    assert.equal(radio.status, 201);
    const id = radio.body.asset_id;
    await h.call("PUT", `/entities/assets/${id}/description`, {
      key: g.key,
      body: { ...description, time: c.now(), asset_id: id },
    });
    await h.call("PUT", `/entities/assets/${id}/contact`, {
      key: g.key,
      body: { time: c.now(), asset_id: id, contact: "online" },
    });
    const heardAt = c.now();
    assert.equal((await task(h, id)).status, 202);
    c.advance(10000);
    await h.call("GET", "/about", { key: g.key });
    c.advance(30000);
    const contact = async () =>
      (await h.call("GET", `/entities/assets/${id}`, { cookie: h.admin })).body
        .item.contact;
    assert.deepEqual(await contact(), {
      time: heardAt,
      asset_id: id,
      contact: "offline",
    });
    assert.equal((await task(h, id)).body.error, "asset_offline");
    await h.call("GET", "/about", { key: g.key });
    assert.equal((await task(h, id)).body.error, "asset_offline");
    const backAt = c.now();
    await h.call("PUT", `/entities/assets/${id}/contact`, {
      key: g.key,
      body: { time: backAt, asset_id: id, contact: "online" },
    });
    c.advance(5000);
    await h.call("DELETE", `/administration/gateways/${g.gateway_id}`, {
      cookie: h.admin,
    });
    assert.deepEqual(await contact(), {
      time: backAt,
      asset_id: id,
      contact: "offline",
    });
  } finally {
    await h.close();
  }
});
test("15. clock-ahead evidence is marked and settles requests without becoming latest [api.md#asset-and-gateway-calls]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    const sent = await task(h, a.id);
    await report(h, a, [
      {
        type: "report.telemetry",
        time: c.now(),
        asset_id: a.id,
        position: { latitude: 1, longitude: 2 },
      },
      {
        type: "report.telemetry",
        time: c.now() + 11000,
        asset_id: a.id,
        position: { latitude: 3, longitude: 4 },
      },
      queue(a.id, c.now() + 11000, 64, sent.body.event_id),
      {
        type: "report.status",
        kind: "task",
        time: c.now() + 11000,
        asset_id: a.id,
        task_id: 1,
        task_state: "completed",
      },
    ]);
    const entry = (
      await h.call("GET", `/entities/assets/${a.id}`, { cookie: h.admin })
    ).body.item;
    assert.equal(entry.reports["report.telemetry"].position.latitude, 1);
    assert.equal(
      (await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin })).body.items[0]
        .state,
      "completed",
    );
    assert.equal((await task(h, a.id)).status, 202);
    const history = (
      await h.call("GET", `/history?asset_id=${a.id}&report=telemetry`, {
        cookie: h.admin,
      })
    ).body.items;
    assert.equal(history.length, 2);
    assert.equal(history[1].clock_ahead, true);
    c.advance(30000);
    const fresh = await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin });
    assert.equal(fresh.body.items[0].state, "completed");
  } finally {
    await h.close();
  }
});
test("16. settings keep independent latest values by report time, ties use event ID [api.md#reads]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    await report(h, a, [
      {
        type: "report.settings",
        time: c.now(),
        asset_id: a.id,
        settings: { lights: "on" },
      },
      {
        type: "report.settings",
        time: c.now() - 100,
        asset_id: a.id,
        settings: { lights: "off", run_state: "paused" },
      },
      {
        type: "report.settings",
        time: c.now(),
        asset_id: a.id,
        settings: { lights: "off" },
      },
    ]);
    const settings = (
      await h.call("GET", `/entities/assets/${a.id}`, { cookie: h.admin })
    ).body.item.settings;
    assert.deepEqual(settings.lights, { value: "off", time: c.now() });
    assert.deepEqual(settings.run_state, {
      value: "paused",
      time: c.now() - 100,
    });
  } finally {
    await h.close();
  }
});

test("place copies, optional updates, imagery kind rules and Fusion freshness [api.md#geo-features, fusion.md#temporary-first-iteration]", async () => {
  const c = simulatedClock(),
    h = await startHarness(c);
  try {
    const a = await asset(h);
    const create = await h.call("POST", "/entities/geofeatures", {
      cookie: h.admin,
      body: { kind: "point", position: { latitude: 1, longitude: 2 } },
    });
    assert.equal(create.status, 200);
    const place = create.body.geofeature.geofeature_id;
    const sent = await task(h, a.id, {
      tasks: [{ kind: "move_to", geofeature_id: place }],
    });
    assert.equal(sent.status, 202);
    let read = (await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin }))
      .body;
    assert.equal(read.items[0].task.destination.latitude, 1);
    await h.call("PUT", `/entities/geofeatures/${place}`, {
      cookie: h.admin,
      body: { kind: "point", position: { latitude: 3, longitude: 4 } },
    });
    read = (await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin })).body;
    assert.equal(read.items[0].task.destination.latitude, 1);
    const edited = await h.call(
      "PUT",
      `/entities/geofeatures/${place}?update_tasks=true`,
      {
        cookie: h.admin,
        body: { kind: "point", position: { latitude: 5, longitude: 6 } },
      },
    );
    assert.deepEqual(edited.body.updated_task_ids, [
      { asset_id: a.id, task_id: 1 },
    ]);
    read = (await h.call("GET", `/tasks/${a.id}`, { cookie: h.admin })).body;
    assert.equal(read.items[0].task.destination.latitude, 5);
    const line = {
      kind: "line",
      line: [
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 1 },
      ],
    };
    const nonpoint = await h.call(
      "PUT",
      `/entities/geofeatures/${place}?update_tasks=true`,
      { cookie: h.admin, body: line },
    );
    assert.deepEqual(nonpoint.body.not_updated_task_ids, [
      { asset_id: a.id, task_id: 1 },
    ]);
    assert.equal(
      (
        await task(h, a.id, {
          tasks: [{ kind: "move_to", geofeature_id: place }],
        })
      ).body.error,
      "not_a_point",
    );
    assert.equal(
      (
        await h.call("PUT", `/entities/geofeatures/${place}`, {
          cookie: h.admin,
          body: { kind: "imagery", object_id: "OBJ" },
        })
      ).body.error,
      "imagery_fixed",
    );
    assert.equal(
      (await h.call("GET", "/entities/geofeatures", { key: a.key })).status,
      403,
    );
    const other = await asset(h);
    assert.equal(
      (await h.call("GET", `/entities/assets/${other.id}`, { key: a.key }))
        .status,
      403,
    );
    await report(h, a, [
      {
        type: "report.observation",
        kind: "coordinates",
        time: c.now(),
        asset_id: a.id,
        observation_id: "OBS",
        position: { latitude: 10, longitude: 20 },
        entity_type: "person",
      },
    ]);
    let tracks = (await h.call("GET", "/entities/tracks", { cookie: h.admin }))
      .body.items;
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].position.latitude, 10);
    await report(h, a, [
      {
        type: "report.observation",
        kind: "bearing",
        time: c.now() - 100,
        asset_id: a.id,
        observation_id: "OBS",
        origin: { latitude: 0, longitude: 0 },
        bearing_deg: 90,
      },
    ]);
    tracks = (await h.call("GET", "/entities/tracks", { cookie: h.admin })).body
      .items;
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].time, c.now());
    await h.call("DELETE", `/entities/geofeatures/${place}`, {
      cookie: h.admin,
    });
    assert.equal(
      (await task(h, a.id, { tasks: [{ kind: "land", geofeature_id: place }] }))
        .status,
      404,
    );
  } finally {
    await h.close();
  }
});
