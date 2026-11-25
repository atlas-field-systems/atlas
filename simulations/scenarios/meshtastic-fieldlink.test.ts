import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { parseConfig, startApp } from "@atlas/asset";
import { createGatewayCore, createGatewayHost, requireValue } from "@atlas/gateway/core-host";
import { openAsset, serveGateway, type Radio } from "@atlas/meshtastic-fieldlink";
import { loadPackagedProtocol } from "@atlas/protocol";
import type { GatewayHost } from "@atlas/meshtastic-fieldlink/gateway-host";
import { receiveEnvelopes } from "@atlas/meshtastic-fieldlink/radio";
import type { AssetEvent, Batch } from "@atlas/sdk";
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
  lastReply: Map<string, number>;
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
  const lastReply = new Map<string, number>();
  function startGateway() {
    const stop = new AbortController();
    const radio = mesh.radio(gateway);
    const unobserve = receiveEnvelopes(radio, () => true, (peer, packet) => {
      if (packet.kind === "reply") lastReply.set(peer, Date.now());
    });
    const lifetime = AbortSignal.any([signal, stop.signal]);
    const host = createGatewayHost(core, run_id, AbortSignal.any([lifetime, radio.failure]));
    const done = serveGateway({ radio, host,
      signal: lifetime, now: () => w.clock.now(), onError: error => errors.push(error) }).finally(() => {
      unobserve();
      host.close();
    });
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
      contacts, online, ready: () => readyApps, restart, gateway, lastReply, serving: () => serving.done, errors });
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
    let silentAsset: string | undefined;
    let offlineAt: number | undefined;
    await withMesh(w, async ({ mesh, keys, start, until, contacts, online, ready, errors, gateway, lastReply }) => {
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
      silentAsset = second;
      mesh.silence(keys[1]);
      await until(() => offlineAfterJoin(second).length > 0, cut + 16_000, "operator saw the silent Asset go offline");
      const heardAt = lastReply.get(keys[1]);
      assert.ok(heardAt !== undefined && offlineAt !== undefined);
      const elapsed = offlineAt - heardAt;
      assert.ok(elapsed >= 14_900 && elapsed <= 15_000, `Core marked the Asset offline ${elapsed} ms after its last reply`);
      const observedOffline = performance.now();
      const healthyPolls = [keys[0], keys[2]].map(key => polls.get(key) ?? []);
      await until(() => healthyPolls.every(times => times.some(at => at >= observedOffline)),
        observedOffline + 10_000, "both healthy Assets were polled after expiry");
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
      if (silentAsset && response.ok && String(input).endsWith(`/entities/assets/${silentAsset}/contact`) &&
          typeof init?.body === "string" && init.body.includes('"contact":"offline"')) offlineAt ??= Date.now();
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
      await withMesh(w, async ({ keys, start, waitForOnline, online, restart, until, ready }) => {
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
        for (const id of ids) {
          const asset = value(await w.complete(w.admin.call("asset", { params: { asset_id: id } })));
          assert.equal(asset.item.contact.contact, "online", id);
        }
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
        assert.ok(lastHeard !== undefined);
        const heard = lastHeard;
        await until(() => w.clock.now() >= heard + 7_000, performance.now() + 8_000,
          "the gateway returned seven seconds after the last radio reply");
      });
      const servingAt = performance.now();
      await until(() => contacts(assetId, "offline").some(event => event.event_id > onlineAt),
        servingAt + 9_000, "the operator stream delivered offline without resetting the deadline");
      const offline = contacts(assetId, "offline").find(event => event.event_id > onlineAt);
      assert.ok(lastHeard !== undefined);
      assert.ok(offline?.kind === "asset.contact");
      assert.equal(offline.record.time, lastHeard);
      assert.ok(offlineAt !== undefined && Math.abs(offlineAt - servingAt - 7_900) < 500,
        `Core committed offline about 14.9 seconds after the last reply (observed ${offlineAt === undefined ? "no write" : offlineAt - servingAt} ms after restart)`);
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
  const receipted = Promise.withResolvers<void>();
  const explanation = Array.from({ length: 4 }, (_, i) => createHash("sha256").update(String(i)).digest("hex")).join("");
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
    next(_, after) {
      if (after === event.event_id) delivered.resolve();
      else return event;
    },
    async store(_, __, reports) {
      assert.deepEqual(reports, batch.reports);
    },
    async contact() {},
  };
  const batch: Batch = {
    priority: "must_arrive",
    reports: [{ type: "report.status", kind: "task", asset_id: "B", time: 1, task_id: 1, task_state: "failed", explanation }],
    settle(result) { if (result.ok) receipted.resolve(); else receipted.reject(new Error(result.explanation)); },
  };
  const gatewayServing = serveGateway({ radio: mesh.radio(gateway), host, signal });
  try {
    await openAsset({
      openRadio: async () => mesh.radio(asset), gateway, signal, profile: { hash, description: {
        commands: [], reports: ["status"], settings: ["lights"],
      } },
      onRegister(registration, link) {
        const events = link.events(registration.after)[Symbol.asyncIterator]();
        let waiting = true;
        const stop = link.serve({
          get mustArriveWaiting() { return waiting; },
          take() {
            if (!waiting) return;
            waiting = false;
            return batch;
          },
          onWaiting: () => () => {},
        });
        void events.next().catch(delivered.reject);
        return () => {
          stop();
          void events.return?.().catch(delivered.reject);
        };
      },
    });
    await Promise.race([Promise.all([delivered.promise, receipted.promise]), delay(8_000, undefined, { signal }).then(() => {
      throw new Error("Gateway missed the reply after the final downlink frame");
    })]);
    assert.ok(mesh.multiFrame.has(asset), "Task used multiple frames");
    assert.ok(mesh.multiFrame.has(gateway), "report used both reply frames");
  } finally {
    controller.abort();
    await gatewayServing;
  }
});

scenario({
  name: "Meshtastic replay excludes a request dropped while its radio was offline",
  checks: ["core/docs/api.md#operator-requests", "core/docs/api.md#radio-assets"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key });
    const { run_id } = requireValue(await core.client.connect());
    let host = createGatewayHost(core, run_id);
    try {
      const peer = "b".repeat(64);
      const profile = { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } } satisfies Parameters<GatewayHost["bind"]>[1];
      const binding = await host.bind(peer, profile);
      const asset = { asset_id: binding.assetId };
      await host.contact(binding.assetId, true, w.clock.now());
      const prefetched = Promise.withResolvers<void>();
      const stop = host.onEvent(() => {
        if (host.next(binding.assetId, binding.after)?.kind === "settings.requested") prefetched.resolve();
      });
      value(await w.complete(w.admin.call("changeSettings", {
        params: asset, body: { settings: { lights: "off" } },
      })));
      await prefetched.promise;
      stop();
      await host.contact(binding.assetId, false, w.clock.now());
      assert.equal(host.next(binding.assetId, binding.after), undefined);
      host.close();

      // No radio cursor advanced before restart. A later valid request gives
      // the stream a positive completion marker, regardless of timing.
      host = createGatewayHost(core, run_id);
      await host.carried();
      const available = Promise.withResolvers<AssetEvent | undefined>();
      host.onEvent(() => available.resolve(host.next(binding.assetId, binding.after)));
      await host.bind(peer, { ...profile, resume: binding });
      await host.contact(binding.assetId, true, w.clock.now());
      value(await w.complete(w.admin.call("changeSettings", {
        params: asset, body: { settings: { lights: "on" } },
      })));
      const work = await w.complete(available.promise);
      assert.equal(work?.kind, "settings.requested");
      assert.equal(work.record.settings.lights, "on");
    } finally {
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic clears prefetched work after a gateway uplink outage",
  checks: ["core/docs/api.md#contact", "core/docs/api.md#operator-requests"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    let disconnected = false;
    const cut = new AbortController();
    const attempted = Promise.withResolvers<void>();
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, fetch(input, init) {
      if (disconnected) {
        attempted.resolve();
        throw new TypeError("Gateway uplink disconnected");
      }
      if (!cut.signal.aborted && new URL(String(input)).pathname === "/events")
        return fetch(input, { ...init, signal: AbortSignal.any([init?.signal ?? new AbortController().signal, cut.signal]) });
      return fetch(input, init);
    } });
    const { run_id } = requireValue(await core.client.connect());
    const host = createGatewayHost(core, run_id);
    try {
      const binding = await host.bind("radio", { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } });
      const { assetId, after } = binding;
      await host.contact(assetId, true, w.clock.now());
      const available = Promise.withResolvers<void>();
      const stop = host.onEvent(() => available.resolve());
      const change = (lights: "on" | "off") => w.complete(w.admin.call("changeSettings", {
        params: { asset_id: assetId }, body: { settings: { lights } },
      }));
      value(await change("off"));
      await available.promise;
      stop();
      assert.equal(host.next(assetId, after)?.kind, "settings.requested");
      disconnected = true;
      cut.abort();
      await attempted.promise;
      await w.advance(31_000);
      assert.ok(w.events.some(event => event.kind === "asset.contact" &&
        event.record.asset_id === assetId && event.record.contact === "offline"));
      const duringOutage = host.next(assetId, after);

      const replayed = Promise.withResolvers<void>();
      const unsubscribe = host.onEvent(() => replayed.resolve());
      disconnected = false;
      // Only the first stream was cut. A new request marks the end of replay.
      await host.contact(assetId, true, w.clock.now());
      value(await change("on"));
      await replayed.promise;
      unsubscribe();
      const work = host.next(assetId, after);
      assert.equal(work?.kind, "settings.requested");
      assert.equal(work.record.settings.lights, "on");
      assert.equal(duringOutage, undefined);
    } finally {
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic roster keeps the radio time through delayed writes and older replays",
  checks: ["core/docs/api.md#radio-assets"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key });
    const { run_id } = requireValue(await core.client.connect());
    const host = createGatewayHost(core, run_id);
    try {
      const { assetId } = await host.bind("radio", { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } });
      const heardAt = w.clock.now() + 100;
      await w.advance(12_100);
      await host.contact(assetId, true, heardAt);
      await host.store(assetId, 1, [{ type: "report.settings", time: w.clock.now(), asset_id: assetId, settings: { lights: "off" } }]);
      await host.contact(assetId, true, heardAt - 1);
      assert.deepEqual(await host.carried(), [{ assetId, lastHeard: heardAt }]);
    } finally {
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic confirms a contact write while a newer reading is still in flight",
  checks: ["gateway/README.md#gateway-contact"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const releaseSecond = Promise.withResolvers<void>();
    let writes = 0;
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, async fetch(input, init) {
      if (String(input).endsWith("/contact") && typeof init?.body === "string" &&
          init.body.includes('"contact":"online"')) {
        if (++writes === 1) {
          first.resolve();
          await releaseFirst.promise;
        } else {
          second.resolve();
          await releaseSecond.promise;
        }
      }
      return fetch(input, init);
    } });
    const { run_id } = requireValue(await core.client.connect());
    const host = createGatewayHost(core, run_id);
    try {
      const { assetId } = await host.bind("radio", { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } });
      const time = w.clock.now();
      let confirmed = false;
      const online = host.contact(assetId, true, time).then(() => { confirmed = true; });
      await first.promise;
      const newer = host.contact(assetId, true, time + 1);
      releaseFirst.resolve();
      await second.promise;
      // Let the first caller observe confirmation while Core holds the newer reply.
      await w.settle();
      assert.ok(confirmed);
      releaseSecond.resolve();
      await Promise.all([online, newer]);
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic stream recovery restores online contact after a lost confirmation",
  checks: ["core/docs/api.md#radio-assets", "gateway/README.md#gateway-contact"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const opened = Promise.withResolvers<void>();
    const reopened = Promise.withResolvers<void>();
    const reconnecting = Promise.withResolvers<void>();
    const stored = Promise.withResolvers<void>();
    const loseConfirmation = Promise.withResolvers<void>();
    const cut = new AbortController();
    const errors: unknown[] = [];
    let streams = 0;
    let onlineWrites = 0;
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, async fetch(input, init) {
      const path = new URL(String(input)).pathname;
      if (path === "/events") {
        if (++streams === 1) {
          const response = await fetch(input, { ...init, signal: AbortSignal.any([init?.signal ?? cut.signal, cut.signal]) });
          opened.resolve();
          return response;
        }
        const response = await fetch(input, init);
        reopened.resolve();
        return response;
      }
      const response = await fetch(input, init);
      if (path === "/about" && cut.signal.aborted) reconnecting.resolve();
      if (path.endsWith("/contact") && typeof init?.body === "string" &&
          init.body.includes('"contact":"online"') && ++onlineWrites === 1) {
        assert.ok(response.ok);
        await response.body?.cancel();
        stored.resolve();
        await loseConfirmation.promise;
        throw new TypeError("Lost contact response");
      }
      return response;
    } });
    const { run_id } = requireValue(await core.client.connect());
    const host = createGatewayHost(core, run_id, undefined, error => errors.push(error));
    try {
      const { assetId } = await host.bind("radio", { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } });
      await opened.promise;
      const online = host.contact(assetId, true, w.clock.now());
      await stored.promise;
      await w.advance(31_000);
      const contact = async () => value(await w.complete(w.admin.call("asset", { params: { asset_id: assetId } }))).item.contact.contact;
      assert.equal(await contact(), "offline");
      cut.abort();
      await reconnecting.promise;
      await w.settle();
      loseConfirmation.resolve();
      await online;
      await reopened.promise;
      assert.equal(await contact(), "online");
      const streamErrors = errors.filter(error => /event stream/.test(String(error)));
      assert.equal(streamErrors.length, 1);
      assert.equal(String(streamErrors[0]), `Error: Core event stream for Asset ${assetId} failed and will reconnect`);
      assert.equal(errors.filter(error => /contact write/.test(String(error))).length, 1);
    } finally {
      loseConfirmation.resolve();
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic re-registers a radio removed before its initial tasks snapshot",
  checks: ["core/docs/api.md#radio-assets"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    let removed: string | undefined;
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, async fetch(input, init) {
      const tasks = /^\/tasks\/([^/]+)$/.exec(new URL(String(input)).pathname);
      if (!removed && tasks) {
        removed = tasks[1];
        value(await w.complete(w.admin.call("removeAsset", { params: { asset_id: removed } })));
      }
      return fetch(input, init);
    } });
    const { run_id } = requireValue(await core.client.connect());
    const host = createGatewayHost(core, run_id);
    try {
      const { assetId } = await host.bind("radio", { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } });
      assert.ok(removed);
      assert.notEqual(assetId, removed);
    } finally {
      host.close();
      core.client.close();
    }
  },
});

for (const [bound, failure] of [[false, ""], [true, ""], [true, "offline"], [true, "online"]] as const) scenario({
  name: failure ? `Meshtastic retries a failed ${failure} transition before the next state`
    : `Meshtastic preserves queued contact transitions for a ${bound ? "bound" : "carried"} Asset`,
  checks: ["fieldlink/meshtastic/README.md#first-implementation"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writes: { contact: string; time: number }[] = [];
    let stalled = false;
    let lateOnline: (() => Promise<Response>) | undefined;
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, async fetch(input, init) {
      if (stalled && String(input).endsWith("/contact") && typeof init?.body === "string") {
        writes.push(JSON.parse(init.body));
        if (writes.length === 1) {
          started.resolve();
          await release.promise;
          if (failure === "online") lateOnline = () => fetch(input, { ...init, signal: undefined });
          if (failure) return new Response(null, { status: 503 });
        }
      }
      return fetch(input, init);
    } });
    const { run_id } = requireValue(await core.client.connect());
    const original = createGatewayHost(core, run_id);
    const host = bound ? original : createGatewayHost(core, run_id);
    try {
      const { assetId } = await original.bind("radio", { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } });
      if (!bound) await host.carried();
      await host.contact(assetId, failure !== "online", w.clock.now());
      const time = w.clock.now() + 10;
      stalled = true;
      const first = host.contact(assetId, failure !== "offline", time);
      void first.catch(() => {});
      await started.promise;
      let taskId: number | undefined;
      if (!failure) {
        // The Asset must be online to accept a Task while the refresh is blocked.
        const sent = value(await w.complete(w.admin.call("sendTasks", {
          params: { asset_id: assetId }, body: { tasks: [{ kind: "settings", settings: { lights: "on" } }] },
        })));
        taskId = sent.task_ids[0];
      }
      const refreshes = failure === "online" ? [] :
        [host.contact(assetId, true, time + 1), host.contact(assetId, true, time + 2)];
      const queued = [...refreshes, host.contact(assetId, false, time + 2)];
      if (failure !== "online") queued.push(host.contact(assetId, true, time + 3));
      release.resolve();
      await Promise.all([first, ...queued]);
      if (taskId !== undefined) {
        const tasks = requireValue(await core.client.call("tasks", { params: { asset_id: assetId } }));
        assert.equal(tasks.items.find(item => item.task.task_id === taskId)?.state, "dropped");
      }
      assert.deepEqual(writes.map(({ contact, time }) => [contact, time]),
        [...(failure === "offline" ? [["offline", time], ["offline", time], ["online", time + 2]]
          : failure === "online" ? [["online", time], ["online", time]] : [["online", time], ["online", time + 2]]),
          ["offline", time + 2], ...(failure === "online" ? [] : [["online", time + 3]])]);
      if (failure === "online") {
        assert.ok(lateOnline);
        const late = await lateOnline();
        assert.ok(late.ok);
        await late.body?.cancel();
        const asset = value(await w.complete(w.admin.call("asset", { params: { asset_id: assetId } })));
        assert.equal(asset.item.contact.contact, "offline", "a delayed retry must leave the last state intact");
        await w.until(() => w.events.filter(event => event.kind === "asset.contact" &&
          event.record.asset_id === assetId && event.record.time >= time).length === 2);
        assert.deepEqual(w.events.flatMap(event => event.kind === "asset.contact" &&
          event.record.asset_id === assetId && event.record.time >= time ? [event.record.contact] : []),
        ["online", "offline"]);
      }
    } finally {
      release.resolve();
      host.close();
      original.close();
      core.client.close();
    }
  },
});

for (const timeout of [false, true]) scenario({
  name: timeout ? "Meshtastic resolves a retired app's timed-out report before signing up"
    : "Meshtastic drains a retired app's reports before the replacement signs up",
  checks: ["core/docs/api.md#radio-assets", "core/docs/api.md#operator-requests"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const storing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const described = Promise.withResolvers<void>();
    const late = Promise.withResolvers<void>();
    const errors: unknown[] = [];
    const reportKeys: (string | null)[] = [];
    let replacing = false;
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, async fetch(input, init) {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/reports")) {
        reportKeys.push(new Headers(init?.headers).get("Idempotency-Key"));
        if (reportKeys.length === 1) {
          storing.resolve();
          await release.promise;
          // The first request was already on its way to Core when the SDK timed out.
          const response = await fetch(input, { ...init, signal: undefined });
          late.resolve();
          return response;
        }
        if (timeout && reportKeys.length === 2)
          return Response.json({ error: "storage_full", explanation: "temporary failure" }, { status: 507 });
      }
      const response = await fetch(input, init);
      if (replacing && path.endsWith("/description")) described.resolve();
      return response;
    } });
    const { run_id } = requireValue(await core.client.connect());
    const host = createGatewayHost(core, run_id, undefined, error => errors.push(error));
    const profile = { hash: core.hash, description: {
      commands: [], reports: ["status"], settings: ["lights"],
    } } satisfies Omit<Parameters<GatewayHost["bind"]>[1], "session">;
    try {
      const { assetId } = await host.bind("radio", { ...profile, session: "old" });
      await host.contact(assetId, true, w.clock.now());
      const sent = value(await w.complete(w.admin.call("sendTasks", {
        params: { asset_id: assetId }, body: { tasks: [{ kind: "settings", settings: { lights: "on" } }] },
      })));
      const taskId = sent.task_ids[0];
      const report = host.store(assetId, 1, [{
        type: "report.status", kind: "queue", asset_id: assetId, time: w.clock.now(), task_ids: [taskId],
      }]);
      await storing.promise;
      if (timeout) await assert.rejects(report, /unknown/);
      replacing = true;
      const replacement = host.bind("radio", { ...profile, session: "new" });
      // Let an unsynchronized description reach Core while the old report is blocked.
      if (!timeout) {
        await Promise.race([described.promise, delay(500)]);
        release.resolve();
        await report;
      }
      const registered = await replacement;
      release.resolve();
      await late.promise;
      assert.equal(registered.assetId, assetId);
      const tasks = requireValue(await core.client.call("tasks", { params: { asset_id: assetId } }));
      assert.equal(tasks.items.find(item => item.task.task_id === taskId)?.state, "dropped");
      assert.deepEqual(tasks.held, []);
      if (timeout) {
        assert.equal(reportKeys.length, 3);
        assert.ok(reportKeys[0]);
        assert.ok(reportKeys.every(key => key === reportKeys[0]));
        assert.equal(errors.length, 1);
        assert.match(String(errors[0]), /report write.*storage_full/);
      }
    } finally {
      release.resolve();
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic commits queued silence when a replacement signup fails",
  checks: ["gateway/README.md#gateway-contact"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const holding = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let replacing = false;
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, async fetch(input, init) {
      const path = new URL(String(input)).pathname;
      if (replacing && path.endsWith("/contact") && typeof init?.body === "string" &&
          init.body.includes('"contact":"online"')) {
        holding.resolve();
        await release.promise;
      }
      if (replacing && path.endsWith("/description"))
        return Response.json({ error: "storage_full", explanation: "signup failed" }, { status: 507 });
      return fetch(input, init);
    } });
    const { run_id } = requireValue(await core.client.connect());
    const host = createGatewayHost(core, run_id);
    const profile = { hash: core.hash, description: { commands: [], reports: ["settings"], settings: ["lights"] } } satisfies Omit<Parameters<GatewayHost["bind"]>[1], "session">;
    try {
      const { assetId } = await host.bind("radio", { ...profile, session: "old" });
      await host.contact(assetId, true, w.clock.now());
      replacing = true;
      const refreshing = host.contact(assetId, true, w.clock.now());
      await holding.promise;
      const offline = host.contact(assetId, false, w.clock.now());
      const replacement = assert.rejects(host.bind("radio", { ...profile, session: "new" }), /signup failed/);
      release.resolve();
      await Promise.all([refreshing, offline, replacement]);
      const asset = value(await w.complete(w.admin.call("asset", { params: { asset_id: assetId } })));
      assert.equal(asset.item.contact.contact, "offline");
    } finally {
      release.resolve();
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic resume waits for an unheard offline write before replaying work",
  checks: ["core/docs/api.md#operator-requests", "gateway/README.md#gateway-contact"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const holding = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const seen = Promise.withResolvers<AssetEvent>();
    let restarting = false;
    let attempts = 0;
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, async fetch(input, init) {
      if (restarting && String(input).endsWith("/contact") && typeof init?.body === "string" &&
          init.body.includes('"contact":"offline"')) {
        if (++attempts === 1) {
          holding.resolve();
          await release.promise;
          return Response.json({ error: "storage_full", explanation: "temporary failure" }, { status: 507 });
        }
      }
      return fetch(input, init);
    } });
    const { run_id } = requireValue(await core.client.connect());
    let host = createGatewayHost(core, run_id);
    const profile = { hash: core.hash, session: "boot",
      description: { commands: [], reports: ["settings"], settings: ["lights"] },
    } satisfies Parameters<GatewayHost["bind"]>[1];
    try {
      const binding = await host.bind("radio", profile);
      const { assetId, after } = binding;
      await host.contact(assetId, true, w.clock.now());
      const change = (lights: "on" | "off") => w.complete(w.admin.call("changeSettings", {
        params: { asset_id: assetId }, body: { settings: { lights } },
      }));
      value(await change("off"));
      host.close();

      host = createGatewayHost(core, run_id);
      await host.carried();
      restarting = true;
      const offline = host.contact(assetId, false, w.clock.now());
      void offline.catch(() => {});
      await holding.promise;
      host.onEvent(() => {
        const event = host.next(assetId, after);
        if (event?.kind === "settings.requested") seen.resolve(event);
      });
      await host.bind("radio", { ...profile, resume: binding });
      const deliveredEarly = await Promise.race([seen.promise, delay(250)]);
      release.resolve();
      assert.equal(deliveredEarly, undefined, "the radio received a request pending offline removal");
      await offline;
      await host.contact(assetId, true, w.clock.now());
      value(await change("on"));
      const event = await w.complete(seen.promise);
      assert.equal(event.kind, "settings.requested");
      assert.equal(event.record.settings.lights, "on");
    } finally {
      release.resolve();
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic reports a terminal stream error once and resumes delivery",
  checks: ["gateway/README.md#the-gateway-interface"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    let invalid = true;
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, fetch(input, init) {
      if (invalid && new URL(String(input)).pathname === "/events") {
        invalid = false;
        return Promise.resolve(new Response("data: invalid JSON\n\n", { headers: { "Content-Type": "text/event-stream" } }));
      }
      return fetch(input, init);
    } });
    const { run_id } = requireValue(await core.client.connect());
    const reported = Promise.withResolvers<unknown>();
    const errors: unknown[] = [];
    const host = createGatewayHost(core, run_id, undefined, error => {
      errors.push(error);
      reported.resolve(error);
    });
    try {
      const { assetId, after } = await host.bind("radio", { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } });
      await host.contact(assetId, true, w.clock.now());
      value(await w.complete(w.admin.call("changeSettings", {
        params: { asset_id: assetId }, body: { settings: { lights: "off" } },
      })));
      const error = await reported.promise;
      assert.match(String(error), /invalid_event/);
      assert.doesNotThrow(() => host.next(assetId, after));
      const recovered = Promise.withResolvers<void>();
      const unsubscribe = host.onEvent(() => recovered.resolve());
      try {
        await Promise.race([recovered.promise, delay(2_000, undefined, { ref: false })]);
        const event = host.next(assetId, after);
        assert.equal(event?.kind, "settings.requested");
        assert.equal(event.record.settings.lights, "off");
        assert.equal(errors.length, 1);
      } finally {
        unsubscribe();
      }
    } finally {
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic stays quiet when a Core event stream ends during shutdown",
  checks: ["gateway/README.md#the-gateway-interface"],
  async run(w) {
    const provisioned = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in provisioned);
    const opened = Promise.withResolvers<void>();
    const reply = Promise.withResolvers<Response>();
    const core = await createGatewayCore({ url: w.core.url, key: provisioned.key, fetch(input, init) {
      if (new URL(String(input)).pathname === "/events") {
        opened.resolve();
        return reply.promise;
      }
      return fetch(input, init);
    } });
    const { run_id } = requireValue(await core.client.connect());
    const lifetime = new AbortController();
    const errors: unknown[] = [];
    const host = createGatewayHost(core, run_id, lifetime.signal, error => errors.push(error));
    try {
      await host.bind("radio", { session: "boot", hash: core.hash, description: {
        commands: [], reports: ["settings"], settings: ["lights"],
      } });
      await w.complete(opened.promise);
      lifetime.abort();
      reply.resolve(new Response("data: invalid JSON\n\n", { headers: { "Content-Type": "text/event-stream" } }));
      await w.settle();
      assert.deepEqual(errors, []);
    } finally {
      host.close();
      core.client.close();
    }
  },
});

scenario({
  name: "Meshtastic retries an unheard Asset's failed offline write",
  checks: ["core/docs/api.md#contact", "fieldlink/meshtastic/README.md#first-implementation"],
  timeout: 38_000,
  async run(w) {
    let afterRestart = false;
    let attempts = 0;
    await withMesh(w, async ({ mesh, keys, start, waitForOnline, online, contacts, restart, until }) => {
      start(keys[0]);
      await waitForOnline(1);
      const [assetId] = online();
      const onlineAt = contacts(assetId, "online")[0].event_id;
      mesh.silence(keys[0]);
      await restart(async () => { afterRestart = true; });
      await until(() => contacts(assetId, "offline").some(e => e.event_id > onlineAt),
        performance.now() + 17_000, "Core recovered from its failed offline write");
      assert.equal(attempts, 2);
    }, (input, init) => {
      if (afterRestart && String(input).endsWith("/contact") && typeof init?.body === "string" &&
          init.body.includes('"contact":"offline"') && ++attempts === 1)
        return Promise.resolve(new Response(JSON.stringify({ error: "storage_full", explanation: "temporary failure" }),
          { status: 507, headers: { "content-type": "application/json" } }));
      return fetch(input, init);
    });
  },
});

scenario({
  name: "Meshtastic polls another Asset while Core is storing reports",
  checks: ["fieldlink/meshtastic/README.md#first-implementation"],
  timeout: 50_000,
  async run(w) {
    const finish = Promise.withResolvers<void>();
    let stalledAsset: string | undefined;
    let writes = 0;
    await withMesh(w, async ({ keys, start, waitForOnline, ready, online, until, gateway, mesh }) => {
      const polls = keys.slice(0, 2).map(() => 0);
      function observePolls(index: number) {
        start(keys[index], undefined, async () => {
          const radio = mesh.radio(keys[index]);
          receiveEnvelopes(radio, peer => peer === gateway, (_, packet) => {
            if (packet.kind === "poll") polls[index] = performance.now();
          });
          return radio;
        });
      }
      try {
        observePolls(0);
        await waitForOnline(1);
        observePolls(1);
        await waitForOnline(2);
        await until(() => ready() === 2, performance.now() + 15_000, "both startup batches were acknowledged");
        stalledAsset = online()[0];
        value(await w.complete(w.admin.call("sendTasks", {
          params: { asset_id: stalledAsset }, body: { tasks: [{ kind: "settings", settings: { lights: "on" } }] },
        })));
        await until(() => writes > 0, performance.now() + 10_000, "Core received the first Asset's report");
        const since = performance.now();
        await until(() => polls[1] >= since, since + 7_500, "other Asset polled before Core replied");
        await until(() => polls[0] >= since, since + 7_500, "the submitting Asset was polled again");
        await until(() => performance.now() >= polls[0] + 1_250, since + 9_000, "the retransmission reached the gateway");
        assert.equal(writes, 1, "a pending submission has one Core write");
      } finally {
        finish.resolve();
      }
    }, async (input, init) => {
      if (stalledAsset && String(input).endsWith(`/entities/assets/${stalledAsset}/reports`) &&
          !init?.signal?.aborted) {
        writes++;
        await finish.promise;
      }
      return fetch(input, init);
    });
  },
});

scenario({
  name: "Meshtastic startup abort waits for the radio bridge to close",
  checks: ["asset/docs/README.md#start-and-connect"],
  async run(w) {
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const controller = new AbortController();
    const announced = Promise.withResolvers<void>();
    const closing = Promise.withResolvers<void>();
    const finishClose = Promise.withResolvers<void>();
    const closingRadio: Radio = {
      failure: new AbortController().signal,
      async send() { assert.fail("no gateway"); },
      async announce() { announced.resolve(); },
      receive: () => () => {},
      discover: () => () => {},
      async close() { closing.resolve(); await finishClose.promise; },
    };
    const config = parseConfig({
      ...raw, asset_key: undefined, initial_settings: { link_loss_after_s: 15 },
      description: { commands: [], reports: ["status"] },
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
      link: { kind: "meshtastic", port: "simulated", gateway: "a".repeat(64) },
      log_directory: join(w.root, "asset", "logs"), archive_directory: join(w.root, "asset", "archives"),
    });
    let ended = false;
    const app = startApp(config, { clock: w.clock, signal: controller.signal, openRadio: async () => closingRadio });
    const stopped = assert.rejects(app, /startup stopped/).then(() => { ended = true; });
    try {
      await announced.promise;
      controller.abort();
      await closing.promise;
      await delay(100);
      assert.equal(ended, false, "startup cleanup returned with the radio still open");
    } finally {
      finishClose.resolve();
      await stopped;
    }
  },
});

scenario({
  name: "Meshtastic polls a resumed Asset promptly",
  checks: ["fieldlink/meshtastic/README.md#first-implementation"],
  timeout: 35_000,
  async run(w) {
    let restarted = false;
    let resumedAt: number | undefined;
    let pollAt: number | undefined;
    await withMesh(w, async ({ start, keys, mesh, gateway, until, ready, restart }) => {
      start(keys[0], undefined, async () => {
        const radio = mesh.radio(keys[0]);
        receiveEnvelopes(radio, peer => peer === gateway, (_, packet) => {
          if (packet.kind === "poll" && restarted) pollAt ??= performance.now();
        });
        return radio;
      });
      await until(() => ready() === 1, performance.now() + 15_000, "Asset startup completed");
      await restart(async () => { restarted = true; });
      await until(() => resumedAt !== undefined, performance.now() + 10_000, "gateway received the resume profile");
      assert.ok(resumedAt !== undefined);
      await until(() => pollAt !== undefined, resumedAt + 4_500, "gateway polled promptly after resume");
    }, async (input, init) => {
      if (restarted && String(input).endsWith("/contact") && typeof init?.body === "string" &&
          init.body.includes('"contact":"online"')) resumedAt ??= performance.now();
      return fetch(input, init);
    });
  },
});

scenario({
  name: "Meshtastic startup counts polls while its first reports wait for Core",
  checks: ["fieldlink/meshtastic/README.md#first-implementation", "asset/docs/README.md#start-and-connect"],
  timeout: 22_000,
  async run(w) {
    let storing = false;
    const release = Promise.withResolvers<void>();
    await withMesh(w, async ({ keys, start, mesh, gateway, until, ready }) => {
      let polls = 0;
      start(keys[0], { initial_settings: { link_loss_after_s: 15, failsafe_policy: [{
        rule_id: "LINK", priority: 1, conditions: [{ kind: "contact_lost" }], response: { kind: "hold" },
      }] } }, async () => {
        const radio = mesh.radio(keys[0]);
        receiveEnvelopes(radio, peer => peer === gateway, (_, packet) => {
          if (packet.kind === "poll") polls++;
        });
        return radio;
      });
      try {
        await until(() => storing, performance.now() + 12_000, "startup reports reached Core");
        const first = polls;
        await w.advance(8_000);
        await until(() => polls > first, performance.now() + 7_500, "the gateway kept polling");
        await w.advance(8_000);
        assert.equal(ready(), 0, "startup was still waiting for a receipt");
        const logs = join(w.root, keys[0], "logs");
        const [run] = await readdir(logs);
        const history = await readFile(join(logs, run, "history.jsonl"), "utf8").catch(error => {
          if (error.code !== "ENOENT") throw error;
          return "";
        });
        assert.doesNotMatch(history, /"kind":"response".*"rule_id":"LINK"/, "authenticated polls kept the failsafe inactive");
        assert.match(history, /"kind":"contact".*"open":true/, "the app recorded authenticated polls during startup");
      } finally {
        release.resolve();
      }
    }, async (input, init) => {
      if (String(input).endsWith("/reports")) {
        storing = true;
        await release.promise;
      }
      return fetch(input, init);
    });
  },
});
