import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { parseConfig, startApp } from "@atlas/asset";
import { createGatewayCore, createGatewayHost, requireValue } from "@atlas/gateway/core-host";
import { openAsset, serveGateway, type Radio } from "@atlas/meshtastic-fieldlink";
import { loadPackagedProtocol } from "@atlas/protocol";
import type { GatewayHost } from "@atlas/meshtastic-fieldlink/gateway-host";
import { receiveEnvelopes } from "@atlas/meshtastic-fieldlink/radio";
import type { AssetEvent } from "@atlas/sdk";
import { ardupilotPeer } from "../src/ardupilot-peer.ts";
import { scenario } from "../src/scenario.ts";
import { type World, value } from "../src/world.ts";

function singleRelay(slowFragmentsFrom?: string) {
  const receivers = new Map<string, Set<Parameters<Radio["receive"]>[0]>>();
  const discoveries = new Map<string, Parameters<Radio["discover"]>[0]>();
  const silent = new Set<string>();
  const announced = new Set<string>();
  const failures = new Map<string, AbortController>();
  const multiFrame = new Set<string>();
  const relayQueue = new Map<string, number>();
  async function forward(sender: string, bytes: number, deliver: () => void) {
    // ShortTurbo airtime plus the firmware's scheduling delay on each hop.
    const airtime = 365 + bytes / 2;
    await delay(airtime);
    if (silent.has(sender)) return;
    const now = performance.now();
    const deliveredAt = Math.max(now, relayQueue.get(sender) ?? now) + airtime;
    relayQueue.set(sender, deliveredAt);
    setTimeout(deliver, deliveredAt - now);
  }
  function radio(key: string): Radio {
    const failure = new AbortController();
    failures.set(key, failure);
    const listeners = new Set<Parameters<Radio["receive"]>[0]>();
    receivers.set(key, listeners);
    return {
      failure: failure.signal,
      async send(peer, bytes) {
        assert.ok(bytes.length <= 180);
        if (bytes[10] > 1) multiFrame.add(peer);
        if (key === slowFragmentsFrom && bytes[9] > 0) await delay(1_200);
        await forward(key, bytes.length, () => {
          for (const receive of receivers.get(peer) ?? []) receive(key, bytes.slice());
        });
      },
      announce(nonce, gateway) {
        return forward(key, gateway ? 41 : 9, () => {
          if (gateway) {
            announced.add(key);
            discoveries.get(gateway)?.(key, nonce, "discovery");
          } else {
            for (const discover of discoveries.values()) discover(key, nonce, "beacon");
          }
        });
      },
      receive(callback) {
        listeners.add(callback);
        return () => { listeners.delete(callback); };
      },
      discover(callback) {
        discoveries.set(key, callback);
        return () => { discoveries.delete(key); };
      },
      async close() {
        receivers.delete(key);
        discoveries.delete(key);
      },
    };
  }
  return {
    radio, announced, multiFrame, silence: (key: string) => silent.add(key),
    fail: (key: string) => failures.get(key)?.abort(new Error("Radio bridge failed")),
  };
}

async function withMesh(w: World, run: (mesh: {
  mesh: ReturnType<typeof singleRelay>; keys: string[];
  start(key: string, config?: Partial<ReturnType<typeof parseConfig>>,
    openRadio?: NonNullable<Parameters<typeof startApp>[1]>["openRadio"]): ReturnType<typeof startApp>;
  until(check: () => boolean, deadline: number, description: string): Promise<void>;
  waitForOnline(count: number): Promise<void>;
  contacts(id: string, state: "online" | "offline"): World["events"];
  online(): string[];
  carried(): Promise<{ asset_id: string; last_heard?: number }[]>;
  ready(): number;
  restart(duringOutage?: () => Promise<void>): Promise<void>;
  gateway: string;
  serving(): Promise<void>;
  errors: unknown[];
}) => Promise<void>, request?: typeof fetch) {
  const gateway = "a".repeat(64);
  const mesh = singleRelay();
  const controller = new AbortController();
  const { signal } = controller;
  const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
  assert.ok("key" in provisioned);
  const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, fetch: request });
  const { run_id } = requireValue(await core.client.connect());
  const heartbeat = core.client.holdContact();
  const errors: unknown[] = [];
  function startGateway() {
    const host = createGatewayHost(core, run_id);
    const stop = new AbortController();
    const done = serveGateway({ radio: mesh.radio(gateway), host,
      signal: AbortSignal.any([signal, stop.signal]), onError: error => errors.push(error) }).finally(() => host.close());
    void done.catch(() => {});
    return { done, stop: () => stop.abort() };
  }
  let serving = startGateway();
  const restart = async (duringOutage?: () => Promise<void>) => {
    serving.stop();
    await serving.done;
    await duringOutage?.();
    serving = startGateway();
  };
  const apps: ReturnType<typeof startApp>[] = [];
  let readyApps = 0;
  try {
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    function start(key: string, overrides?: Partial<ReturnType<typeof parseConfig>>,
        openRadio: NonNullable<Parameters<typeof startApp>[1]>["openRadio"] = async () => mesh.radio(key)) {
      const config = parseConfig({
        ...raw, asset_key: undefined, initial_settings: { link_loss_after_s: 15 }, final_report_wait_s: 1,
        description: { commands: [], reports: ["settings", "status", "telemetry"],
          settings: ["lights", "run_state", "link_loss_after_s"] },
        equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
        ...overrides,
        link: { kind: "meshtastic", port: "simulated", gateway },
        log_directory: join(w.root, key, "logs"), archive_directory: join(w.root, key, "archives"),
      });
      const app = startApp(config, { clock: w.clock, signal, openRadio });
      apps.push(app);
      void app.then(() => { readyApps++; }, error => controller.abort(error));
      return app;
    }
    let advancedAt = performance.now();
    async function until(check: () => boolean, deadline: number, description: string) {
      while (!check()) {
        signal.throwIfAborted();
        assert.ok(performance.now() < deadline, description);
        await delay(15);
        const elapsed = Math.floor(performance.now() - advancedAt);
        await w.advance(elapsed);
        advancedAt += elapsed;
      }
      assert.ok(performance.now() <= deadline, description);
    }
    const contacts = (id: string, state: "online" | "offline") => w.events.filter(event =>
      event.kind === "asset.contact" && event.record.asset_id === id && event.record.contact === state);
    const online = () => [...new Set(w.events.flatMap(event =>
      event.kind === "asset.contact" && event.record.contact === "online" && event.record.asset_id ? [event.record.asset_id] : []))];
    async function waitForOnline(count: number) {
      await until(() => online().length === count, performance.now() + 17_000, `Asset ${count} came online`);
    }
    const carried = async () => requireValue(await core.client.call("carriedRadios")).assets;
    await run({ mesh, keys: ["b", "c", "d"].map(key => key.repeat(64)), start, until, waitForOnline, carried,
      contacts, online, ready: () => readyApps, restart, gateway, serving: () => serving.done, errors });
  } finally {
    controller.abort();
    heartbeat.stop();
    try {
      const settled = await w.complete(Promise.allSettled(apps));
      await w.complete(Promise.all(settled.flatMap(started => started.status === "fulfilled" ? [started.value.stop()] : [])));
      await Promise.allSettled([serving.done]);
    } finally {
      core.client.close();
    }
  }
}

scenario({
  name: "Meshtastic delivers Tasks during join and detects silence",
  checks: ["fieldlink/meshtastic/README.md#first-implementation"],
  timeout: 145_000,
  async run(w) {
    let activeSubmissions = 0;
    await withMesh(w, async ({ mesh, keys, start, until, contacts, online, ready, errors, gateway }) => {
      const polls = new Map<string, number[]>();
      function startObserved(key: string) {
        const times: number[] = [];
        polls.set(key, times);
        start(key, undefined, async () => {
          const radio = mesh.radio(key);
          receiveEnvelopes(radio, peer => peer === gateway, (_, packet) => {
            if (packet.kind === "poll") times.push(performance.now());
          });
          return radio;
        });
      }
      const lightOn = { kind: "settings", settings: { lights: "on" } } as const;
      async function startTask(assetId: string) {
        const sentAt = performance.now();
        const { task_ids: [taskId] } = value(await w.complete(w.admin.call("sendTasks", {
          params: { asset_id: assetId }, body: { tasks: [lightOn] },
        })));
        const started = () => w.events.filter(event => event.kind === "report.status" && event.record.kind === "task" &&
          event.record.asset_id === assetId && event.record.task_id === taskId && event.record.task_state === "active");
        await until(() => started().length > 0, sentAt + 10_000, `Task started on ${assetId} within 10 seconds`);
        return started;
      }
      for (const [index, key] of keys.slice(0, 2).entries()) {
        startObserved(key);
        await until(() => online().length === index + 1, performance.now() + 15_000, `Asset ${index + 1} came online`);
      }
      const [first, second] = online();
      assert.ok(first && second);
      startObserved(keys[2]);
      await until(() => mesh.announced.has(keys[2]), performance.now() + 3_000, "third Asset announced");
      const starts = [await startTask(first)];
      await until(() => online().length === 3, performance.now() + 17_000, "third Asset came online");
      const third = online()[2];
      assert.ok(third);
      await until(() => ready() === 3, performance.now() + 14_000, "all Asset apps are ready for Tasks");
      starts.push(await startTask(third), await startTask(second));

      const ids = [first, second, third];
      const offlineAfterJoin = (id: string) => contacts(id, "offline")
        .filter(e => e.event_id > contacts(id, "online")[0].event_id);
      for (const id of ids) assert.equal(offlineAfterJoin(id).length, 0, `Asset ${id} stayed online through the Task burst`);
      const cut = performance.now();
      mesh.silence(keys[1]);
      await until(() => offlineAfterJoin(second).length > 0, cut + 15_000, "silent Asset went offline within 15 seconds");
      const offlineAt = performance.now();
      const healthyPolls = [keys[0], keys[2]].map(key => polls.get(key) ?? []);
      await until(() => healthyPolls.every(times => times.some(at => at >= offlineAt)),
        offlineAt + 10_000, "both healthy Assets were polled after expiry");
      for (const times of healthyPolls) {
        assert.ok(times.some(at => at < cut), "healthy Asset was polled before the cut");
        for (const [index, at] of times.slice(1).entries()) {
          if (at >= cut) assert.ok(at - times[index] <= 13_000, `healthy poll gap was ${at - times[index]} ms`);
        }
      }
      for (const id of [first, third]) assert.equal(offlineAfterJoin(id).length, 0, `healthy Asset ${id} stayed online`);
      assert.ok(activeSubmissions >= 4, "the unconfirmed submission was retried");
      for (const started of starts) assert.equal(started().length, 1, "Core stores each Task start once");
      const messages = errors.map(String);
      assert.ok(messages.every(message => message.includes("Radio join deferred for capacity")), messages.join("\n"));

    }, async (input, init) => {
      const response = await fetch(input, init);
      if (response.ok && String(input).endsWith("/reports") &&
          typeof init?.body === "string" && init.body.includes('"task_state":"active"') &&
          ++activeSubmissions === 1) {
        await response.body?.cancel();
        throw new Error("Lost Core response");
      }
      return response;
    });
  },
});

const taskLatencySeed = 7;
const singleTaskCount = Number(process.env.ATLAS_MESHTASTIC_TASKS ?? 8);
scenario({
  name: "Meshtastic starts single Tasks and a three-Asset burst on a clean link",
  checks: ["fieldlink/meshtastic/README.md#first-implementation"],
  seed: taskLatencySeed,
  timeout: 65_000 + 18_000 * singleTaskCount,
  async run(w) {
    await withMesh(w, async ({ keys, start, until, waitForOnline, online, ready }) => {
      for (const [i, key] of keys.entries()) {
        start(key);
        await waitForOnline(i + 1);
      }
      await until(() => ready() === 3, performance.now() + 24_000, "startup reports drained");
      const ids = online();
      let seed = taskLatencySeed;
      const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
      async function send(assetId: string, lights: "on" | "off") {
        const { task_ids: [taskId] } = value(await w.admin.call("sendTasks", {
          params: { asset_id: assetId }, body: { tasks: [{ kind: "settings", settings: { lights } }] },
        }));
        return { assetId, taskId };
      }
      async function measure(recipients: string[], lights: "on" | "off", limit: number) {
        const sentAt = performance.now();
        const tasks = await w.complete(Promise.all(recipients.map(id => send(id, lights))));
        const started = new Map<number, number>();
        await until(() => {
          for (const [index, { assetId, taskId }] of tasks.entries()) {
            if (!started.has(index) && w.events.some(e => e.kind === "report.status" && e.record.kind === "task" &&
                e.record.asset_id === assetId && e.record.task_id === taskId && e.record.task_state === "active"))
              started.set(index, Math.round(performance.now() - sentAt));
          }
          return started.size === tasks.length;
        }, sentAt + limit, `Tasks on ${recipients.join(", ")} started within ${limit} ms`);
        return tasks.map((_, index) => started.get(index));
      }
      const singles: (number | undefined)[] = [];
      for (let i = 0; i < singleTaskCount; i++) {
        const at = performance.now() + 500 + rand() * 7_000;
        await until(() => performance.now() >= at, at + 2_000, "next seeded Task time");
        singles.push(...await measure([ids[Math.floor(rand() * ids.length)]], i % 2 ? "on" : "off", 10_000));
      }
      const burst = await measure(ids, "on", 15_000);
      process.stdout.write(`Meshtastic Task start ms (seed ${taskLatencySeed}) ${JSON.stringify({ singles, burst })}\n`);
    });
  },
});

scenario({
  name: "Meshtastic preserves an active Task and its final report across gateway restart",
  checks: ["atlas/runs-and-identity.md#radio-assets", "core/docs/api.md#radio-assets"],
  timeout: 100_000,
  async run(w) {
    const equipment = await ardupilotPeer(w);
    const config = parseConfig(JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8")));
    await withMesh(w, async ({ keys, start, until, ready, contacts, restart, online }) => {
      const app = start(keys[0], { equipment: equipment.config, description: config.description,
        initial_settings: config.initial_settings, command_timeouts: { ...config.command_timeouts, hold: 60 } });
      await until(() => ready() === 1, performance.now() + 20_000, "the Asset app was ready");
      const { asset_id: assetId } = await app;
      async function send(task: import("@atlas/protocol/types").ProtocolTypes["requests.tasks"]["tasks"][number]) {
        return value(await w.complete(w.admin.call("sendTasks", {
          params: { asset_id: assetId }, body: { tasks: [task] },
        }))).task_ids[0];
      }
      const taskReports = (taskId: number, state: "active" | "completed") => w.events.filter(e =>
        e.kind === "report.status" && e.record.kind === "task" && e.record.asset_id === assetId &&
        e.record.task_id === taskId && e.record.task_state === state);
      const takeoff = await send({ kind: "takeoff", target_altitude: { altitude_m: 10, altitude_reference: "launch" } });
      await until(() => taskReports(takeoff, "completed").length === 1, performance.now() + 12_000, "takeoff completed");
      equipment.setVerticalSpeedCms(300);
      await w.advance(300);
      const hold = await send({ kind: "hold" });
      await until(() => taskReports(hold, "active").length === 1, performance.now() + 12_000, "hold was active");
      assert.equal(taskReports(hold, "completed").length, 0);
      await restart(async () => {
        equipment.setVerticalSpeedCms(0);
        await w.advance(800);
        assert.equal(taskReports(hold, "completed").length, 0, "the gateway was down as the hold finished");
      });
      await until(() => taskReports(hold, "completed").length === 1, performance.now() + 24_000, "the retained final report arrived");
      const described = w.events.filter(e => e.kind === "asset.described" && e.record.asset_id === assetId);
      assert.equal(described.length, 1, "Core sees one app startup");
      assert.ok(contacts(assetId, "offline").every(e => e.event_id < contacts(assetId, "online")[0].event_id));
      assert.deepEqual(online(), [assetId]);
      const tasks = value(await w.complete(w.admin.call("tasks", { params: { asset_id: assetId } })));
      assert.equal(tasks.items.find(item => item.task.task_id === hold)?.state, "completed");
    });
  },
});

for (const outageMs of [0, 30_000]) {
  scenario({
    name: `Meshtastic resumes three healthy Assets after a ${outageMs / 1_000} s gateway outage`,
    checks: ["core/docs/api.md#radio-assets"],
    timeout: 110_000 + outageMs,
    async run(w) {
      let restarted = false;
      const resumed = new Set<string>();
      await withMesh(w, async ({ keys, start, waitForOnline, online, contacts, restart, until, ready }) => {
        for (const [i, key] of keys.entries()) {
          start(key, { initial_settings: { link_loss_after_s: 30 } });
          await waitForOnline(i + 1);
        }
        await until(() => ready() === 3, performance.now() + 22_000, "startup reports drained");
        const ids = online();
        await restart(async () => {
          const downAt = performance.now();
          if (outageMs) await until(() => performance.now() - downAt >= outageMs,
            downAt + outageMs + 1_000, "the gateway remained down for 30 seconds");
          restarted = true;
        });
        await until(() => ids.every(id => resumed.has(id)), performance.now() + 14_900, "all three Assets renewed contact");
        for (const id of ids)
          assert.ok(contacts(id, "offline").every(e => e.event_id < contacts(id, "online")[0].event_id), id);
      }, async (input, init) => {
        const response = await fetch(input, init);
        if (restarted && response.ok && String(input).endsWith("/contact") &&
            typeof init?.body === "string" && init.body.includes('"contact":"online"')) {
          const assetId = new URL(String(input)).pathname.split("/").at(-2);
          if (assetId) resumed.add(assetId);
        }
        return response;
      });
    },
  });
}

scenario({
  name: "Meshtastic reports a failed gateway bridge",
  checks: ["fieldlink/meshtastic/README.md#first-implementation"],
  timeout: 10_000,
  async run(w) {
    await withMesh(w, async ({ mesh, gateway, serving }) => {
      mesh.fail(gateway);
      await assert.rejects(serving(), /Radio bridge failed/);
    });
  },
});

scenario({
  name: "Meshtastic reopens the Asset bridge and delivers work to the same app",
  checks: ["fieldlink/meshtastic/README.md#first-implementation"],
  timeout: 55_000,
  async run(w) {
    await withMesh(w, async ({ mesh, keys, start, until, ready }) => {
      let opens = 0;
      const app = start(keys[0], undefined, async () => {
        if (++opens === 2) throw new Error("radio still unplugged");
        return mesh.radio(keys[0]);
      });
      await until(() => ready() === 1, performance.now() + 15_000, "the Asset app was ready");
      const running = await app;
      const assetId = running.asset_id;
      mesh.fail(keys[0]);
      const recovered = until(() => opens === 3, performance.now() + 7_000, "the bridge reopened after a retry");
      await Promise.race([recovered, running.done.then(() => assert.fail("the Asset app session ended"))]);
      const { task_ids: [taskId] } = value(await w.complete(w.admin.call("sendTasks", {
        params: { asset_id: assetId }, body: { tasks: [{ kind: "settings", settings: { lights: "on" } }] },
      })));
      await until(() => w.events.some(event => event.kind === "report.status" && event.record.kind === "task" &&
        event.record.asset_id === assetId && event.record.task_id === taskId && event.record.task_state === "completed"),
      performance.now() + 12_000, "the same Asset completed a Task");
      assert.equal(w.events.filter(e => e.kind === "asset.described" && e.record.asset_id === assetId).length, 1);
      assert.equal(running.asset_id, assetId);
    });
  },
});

scenario({
  name: "Meshtastic marks an Asset silenced across restart offline",
  checks: ["core/docs/api.md#radio-assets"],
  timeout: 50_000,
  async run(w) {
    let offlineAt: number | undefined;
    await withMesh(w, async ({ mesh, keys, start, waitForOnline, online, contacts, restart, until, carried }) => {
      start(keys[0]);
      await waitForOnline(1);
      const [assetId] = online();
      const onlineAt = contacts(assetId, "online")[0].event_id;
      mesh.silence(keys[0]);
      let lastHeard: number | undefined;
      await restart(async () => {
        lastHeard = (await carried()).find(asset => asset.asset_id === assetId)?.last_heard;
      });
      const servingAt = performance.now();
      await until(() => contacts(assetId, "offline").some(event => event.event_id > onlineAt),
        servingAt + 16_000, "the operator stream delivered the offline event");
      const offline = contacts(assetId, "offline").find(event => event.event_id > onlineAt);
      assert.ok(lastHeard !== undefined);
      assert.ok(offline?.kind === "asset.contact");
      assert.equal(offline.record.time, lastHeard);
      assert.ok(offlineAt !== undefined && offlineAt - servingAt <= 15_000,
        `Core committed offline within 15 seconds (observed ${offlineAt === undefined ? "no write" : offlineAt - servingAt} ms)`);
    }, async (input, init) => {
      const response = await fetch(input, init);
      if (response.ok && String(input).endsWith("/contact") && typeof init?.body === "string" &&
          init.body.includes('"contact":"offline"')) offlineAt = performance.now();
      return response;
    });
  },
});

test("Meshtastic gives a multi-frame Task its full reply window", { timeout: 25_000 }, async () => {
  const { hash } = await loadPackagedProtocol();
  const gateway = "a".repeat(64), asset = "b".repeat(64);
  // Delay the final downlink frame so the gateway must start its clock after submission.
  const mesh = singleRelay(gateway);
  const controller = new AbortController();
  const { signal } = controller;
  const delivered = Promise.withResolvers<void>();
  const event: AssetEvent = {
    kind: "tasks.requested", event_id: 2, record: Array.from({ length: 32 }, (_, i) => ({
      kind: "settings", settings: { lights: "on" }, asset_id: "B", time: 1,
      task_id: i + 1, send_last: 32, requested_by: "ADM",
    })),
  };
  const host: GatewayHost = {
    async carried() { return []; },
    onEvent: () => () => {},
    async bind() { return { run: 1, assetId: "B", after: 1, lastTaskId: 0 }; },
    async refuseDefinitions() { throw new Error("unexpected refusal"); },
    async next(_, after) {
      if (after === event.event_id) delivered.resolve();
      else return event;
    },
    async store() {},
    async contact() {},
  };
  const gatewayServing = serveGateway({ radio: mesh.radio(gateway), host, signal });
  try {
    await openAsset({
      openRadio: async () => mesh.radio(asset), gateway, signal, profile: { hash, description: {
        commands: [], reports: ["status"], settings: ["lights"],
      } },
      onRegister(registration, link) {
        const events = link.events(registration.after)[Symbol.asyncIterator]();
        void events.next().catch(delivered.reject);
        return () => { void events.return?.().catch(delivered.reject); };
      },
    });
    await Promise.race([delivered.promise, delay(8_000, undefined, { signal }).then(() => {
      throw new Error("Gateway missed the reply after the final downlink frame");
    })]);
    assert.ok(mesh.multiFrame.has(asset));
  } finally {
    controller.abort();
    await gatewayServing;
  }
});
