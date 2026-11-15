import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, Socket } from "node:net";
import { once } from "node:events";
import { send, common, minimal, MavLinkPacketSplitter, MavLinkPacketParser, MavLinkProtocolV2 } from "node-mavlink";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient, systemClock, follow, type AtlasEvent } from "@atlas/sdk";
import { loadPackagedProtocol } from "@atlas/protocol";
import { unzipSync, strFromU8 } from "fflate";
import { startApp, parseConfig } from "@atlas/asset";
import { spawnCore } from "../src/core-process.ts";
import { value } from "../src/world.ts";
import { checkAssetArchive } from "../src/asset-archive.ts";

async function equipmentPort() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return address.port;
}

for (const scenario of [
  "armed-startup",
  "equipment-drop",
  "equipment-refused",
  "equipment-timeout",
  "equipment-startup",
  "subsystem",
  "requests",
  "boundary",
  "takeover",
  "takeover-response",
  "crash",
  "flight",
  "battery",
  "link",
  "land-now",
  "idle-gap",
  "land-position",
  "atlas-home",
] as const)
  test(
    `atlas/first-flight.md and asset/docs/failsafes.md: ${scenario} on real Core, Asset and SITL`,
    { timeout: 180000 },
    async (t) => {
      const cleanup: Array<() => unknown | Promise<unknown>> = [];
      t.after(async () => {
        for (const close of cleanup.reverse()) await close();
      });
      const root = await mkdtemp(join(tmpdir(), "atlas-sitl-flight-"));
      console.log(`Evidence: ${root}`);
      const cache =
        process.env.ATLAS_SITL_DIRECTORY ??
        join(homedir(), ".cache/atlas-sitl");
      await writeFile(
        join(root, "flight.parm"),
        `FS_GCS_ENABLE 1\nFS_GCS_TIMEOUT 5\nSYSID_MYGCS 255\nBATT_CAPACITY ${scenario === "battery" ? 100 : 3300}\n`,
      );
      const equipment = await equipmentPort();
      const pilotPort = await equipmentPort();
      const sitl = spawn(
        join(cache, "arducopter"),
        [
          "--instance",
          "30",
          "--serial0",
          `tcp:${equipment}`,
          "--serial1",
          `tcp:${pilotPort}`,
          "--model",
          "+",
          "--speedup",
          "5",
          "--home",
          "-35.363261,149.165230,584,353",
          "--defaults",
          `${join(cache, "copter.parm")},${join(root, "flight.parm")}`,
        ],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      );
      const exited = once(sitl, "close");
      let diagnostics = "";
      sitl.stdout.on("data", (b) => {
        diagnostics += b;
      });
      sitl.stderr.on("data", (b) => {
        diagnostics += b;
      });
      cleanup.push(async () => {
        sitl.kill("SIGKILL");
        await exited;
        await writeFile(join(root, "sitl.log"), diagnostics);
      });
      await delay(1000);
      const core = await spawnCore(join(root, "core").replace(/\/core$/, ""), {
        offline_after_s: 10,
      });
      cleanup.push(() => core.stop());
      const until = async (predicate: () => boolean) => {
        const deadline = Date.now() + 90000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error(`${scenario} timeout`);
          await delay(50);
        }
      };
      let cookie = "";
      const accountFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        if (cookie) headers.set("cookie", cookie);
        const r = await fetch(input, { ...init, headers });
        const next = r.headers.get("set-cookie");
        if (next) cookie = next.split(";")[0];
        return r;
      };
      const admin = createClient({
        baseUrl: core.url,
        credential: { kind: "account" },
        protocol: await loadPackagedProtocol(),
        clock: systemClock,
        fetch: accountFetch,
      });
      cleanup.push(() => admin.close());
      value(await admin.connect());
      value(await admin.login("ADM", "simulation-password"));
      const issued = value(await admin.call("createAssetKey"));
      if (!("key" in issued)) throw new Error("no key");
      let linkController = new AbortController();
      let cutNextFrame = false;
      let abortedAt: number | undefined;
      let buffered = "";
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let reportGate: Promise<void> | undefined;
      const assetFetch: typeof fetch = async (input, init) => {
        if (new URL(String(input)).pathname.endsWith("/reports")) await reportGate;
        const response = await fetch(input, {
          ...init,
          signal: AbortSignal.any([
            linkController.signal,
            ...(init?.signal ? [init.signal] : []),
          ]),
        });
        if (new URL(String(input)).pathname !== "/events" || !response.body)
          return response;
        return new Response(
          response.body.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                if (scenario === "idle-gap") {
                  buffered += decoder.decode(chunk, { stream: true });
                  let end: number;
                  while ((end = buffered.indexOf("\n\n")) >= 0) {
                    let frame = buffered.slice(0, end);
                    buffered = buffered.slice(end + 2);
                    frame = frame.replace(/^data: (.+)$/m, (line, json) => {
                      const event = JSON.parse(json);
                      if (event.kind !== "tasks.requested") return line;
                      return `data: ${JSON.stringify({
                        ...event,
                        record: event.record.filter(
                          (task: { task_id: number }) => task.task_id !== 2,
                        ),
                      })}`;
                    });
                    controller.enqueue(encoder.encode(frame + "\n\n"));
                  }
                } else controller.enqueue(chunk);
                if (cutNextFrame) {
                  cutNextFrame = false;
                  abortedAt = Date.now();
                  linkController.abort();
                }
              },
            }),
          ),
          { status: response.status, headers: response.headers },
        );
      };
      const equipmentPeers = new Set<Socket>();
      let blocked = scenario === "equipment-startup";
      let failEquipment = false;
      let droppedAt = 0;
      let receivedAt = 0;
      let assetSocket: Socket | undefined;
      let proxyPort = 0;
      const emit = Socket.prototype.emit;
      if (scenario === "equipment-drop") t.mock.method(Socket.prototype, "emit", function (this: Socket, event: string | symbol, ...args: unknown[]) {
        const equipmentData = this.remotePort === proxyPort && event === "data";
        if (equipmentData) assetSocket = this;
        const emitted: boolean = Reflect.apply(emit, this, [event, ...args]);
        if (equipmentData) receivedAt = Date.now();
        return emitted;
      });
      const proxy = createServer(peer => {
        equipmentPeers.add(peer);
        peer.on("error", () => {});
        peer.on("close", () => equipmentPeers.delete(peer));
        if (blocked) { peer.destroy(); return; }
        const upstream = connect({ host: "127.0.0.1", port: equipment });
        equipmentPeers.add(upstream);
        upstream.on("error", () => peer.destroy());
        upstream.on("close", () => { equipmentPeers.delete(upstream); peer.destroy(); });
        peer.on("close", () => upstream.destroy());
        upstream.pipe(peer);
        const splitter = peer.pipe(new MavLinkPacketSplitter());
        const parser = new MavLinkPacketParser();
        splitter.on("data", frame => {
          parser.once("data", async packet => {
            if (failEquipment && packet.header.msgid === common.CommandLong.MSG_ID &&
                packet.protocol.data(packet.payload, common.CommandLong).command === 178) {
              if (scenario === "equipment-refused") {
                const ack = new common.CommandAck();
                Object.assign(ack, { command: 178, result: 2 });
                void send(peer, ack, new MavLinkProtocolV2(1, 1));
              }
              if (scenario === "equipment-refused" || scenario === "equipment-timeout") return;
            }
            if (failEquipment && scenario === "equipment-drop" && packet.header.msgid === common.SetPositionTargetGlobalInt.MSG_ID) {
              blocked = true;
              assert.ok(assetSocket);
              assetSocket.pause();
              const finalPosition = new common.GlobalPositionInt();
              Object.assign(finalPosition, { lat: -353632600, lon: 1491652300, alt: 589000, relativeAlt: 5000 });
              await send(peer, finalPosition, new MavLinkProtocolV2(1, 1));
              droppedAt = Date.now();
              for (const connection of equipmentPeers) connection.destroy();
              await delay(30);
              assetSocket.resume();
              return;
            }
            upstream.write(frame.buffer);
          });
          parser.write(frame);
        });
      });
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const proxyAddress = proxy.address();
      assert.ok(proxyAddress && typeof proxyAddress !== "string");
      proxyPort = proxyAddress.port;
      cleanup.push(async () => { for (const peer of equipmentPeers) peer.destroy(); await new Promise<void>(resolve => proxy.close(() => resolve())); });
      const example = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
      const config = parseConfig({
        ...example,
        description: { ...example.description, subsystems: [{ subsystem_id: "GPS", label: "GPS receiver" }] },
        equipment: {
          kind: "ardupilot",
          host: "127.0.0.1",
          port: proxyAddress.port,
          system_id: 255,
          heartbeat_s: 0.2,
          subsystems: { gps: "GPS" },
        },
        asset_key: issued.key,
        link: { core_url: core.url },
        log_directory: join(root, "asset"),
        archive_directory: join(root, "archives"),
      });
      if (scenario === "subsystem") {
        config.initial_settings.failsafe_policy!.push({
          rule_id: "GPS", priority: 50,
          conditions: [{ kind: "subsystem", subsystem_id: "GPS", trigger_condition: "degraded" }, { kind: "airborne" }],
          response: { kind: "land" },
        });
      }
      if (scenario === "boundary")
        config.initial_settings.failsafe_policy!.push({
          rule_id: "AREA", priority: 50,
          conditions: [{ kind: "outside_area", for_s: 2, area: [
            { latitude: -35.3635, longitude: 149.1650 },
            { latitude: -35.3631, longitude: 149.1650 },
            { latitude: -35.3631, longitude: 149.1655 },
            { latitude: -35.3635, longitude: 149.1655 },
          ] }], response: { kind: "land" },
        });
      if (scenario === "idle-gap")
        config.initial_settings.failsafe_policy!.push({
          rule_id: "IDLE",
          priority: 50,
          conditions: [{ kind: "idle", for_s: 1 }, { kind: "airborne" }],
          response: { kind: "land" },
        });
      if (scenario === "battery")
        config.initial_settings.failsafe_policy!.push({
          rule_id: "LB",
          priority: 50,
          conditions: [
            { kind: "battery_below", battery_percent: 99 },
            { kind: "airborne" },
          ],
          response: { kind: "land" },
        });
      if (scenario === "link") {
        config.initial_settings.link_loss_after_s = 12;
        config.initial_settings.failsafe_policy!.push({
          rule_id: "LINK",
          priority: 50,
          conditions: [{ kind: "contact_lost" }, { kind: "airborne" }],
          response: { kind: "land" },
        });
      }
      if (scenario === "equipment-timeout") config.command_timeouts.move_to = 2;
      const events: AtlasEvent[] = [];
      const audit = follow(admin, { after: 0 }, (event) => {
        events.push(event);
      });
      cleanup.push(() => audit.stop());
      const launchProcess = async () => {
        const path = join(root, "asset-config.json");
        await writeFile(path, JSON.stringify(config));
        const child = spawn(process.execPath, [fileURLToPath(new URL("../../asset/src/main.ts", import.meta.url)), "run", path], { stdio: ["ignore", "pipe", "pipe"] });
        const closed = once(child, "close");
        let output = "";
        child.stdout.on("data", chunk => { output += chunk; });
        child.stderr.on("data", chunk => { diagnostics += chunk; });
        cleanup.push(async () => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
          await closed;
        });
        await until(() => output.includes("asset_id") || child.exitCode !== null);
        assert.equal(child.exitCode, null, diagnostics);
        const { asset_id } = JSON.parse(output.trim());
        assert.equal(typeof asset_id, "string");
        return { asset_id: String(asset_id), child, closed, stop: async () => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
          await closed;
          return "";
        } };
      };
      if (scenario === "armed-startup") {
        const pilot = connect({ host: "127.0.0.1", port: pilotPort });
        cleanup.push(() => { pilot.destroy(); });
        await once(pilot, "connect");
        let observedMode = -1;
        let armed = false;
        pilot.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser()).on("data", (packet: import("node-mavlink").MavLinkPacket) => {
          if (packet.header.msgid !== minimal.Heartbeat.MSG_ID) return;
          const heartbeat = packet.protocol.data(packet.payload, minimal.Heartbeat);
          observedMode = heartbeat.customMode;
          armed = Boolean(heartbeat.baseMode & 128);
        });
        await delay(10000);
        const mode = new common.SetMode();
        Object.assign(mode, { targetSystem: 1, baseMode: 1, customMode: 5 });
        await send(pilot, mode, new MavLinkProtocolV2(254, 190));
        await until(() => observedMode === 5);
        const arm = new common.CommandLong();
        Object.assign(arm, { targetSystem: 1, targetComponent: 1, command: 400, _param1: 1, _param2: 21196 });
        await send(pilot, arm, new MavLinkProtocolV2(254, 190));
        await until(() => armed);
      }
      const app = scenario === "crash" ? await launchProcess() : await startApp(config, { fetch: assetFetch });
      cleanup.push(() => app.stop());
      if (scenario === "equipment-startup") {
        await until(() => events.some(e => e.kind === "report.settings"));
        value(await admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "takeoff", target_altitude: { altitude_m: 5, altitude_reference: "launch" } }, { kind: "hold" }] } }));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 1 && e.record.task_state === "failed" && e.record.explanation === "current vehicle state unavailable"));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 2 && e.record.task_state === "cancelled"));
        assert.equal(events.some(e => e.kind === "report.telemetry"), false);
        blocked = false;
        await until(() => events.some(e => e.kind === "report.telemetry"));
        await writeFile(join(root, "events.json"), JSON.stringify(events, null, 2));
        return;
      }
      await until(() => events.some((e) => e.kind === "report.telemetry"));
      if (scenario === "armed-startup") {
        await delay(1000);
        assert.ok(events.some(e => e.kind === "report.failsafe" && e.record.kind === "autopilot" && e.record.in_control), "armed Loiter before any Atlas command must be watch only");
        const refused = value(await admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "land" }], now: true } }));
        assert.ok("task_ids" in refused);
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === refused.task_ids[0] && e.record.task_state === "failed" && e.record.explanation === "flight controller is in control"));
        await writeFile(join(root, "events.json"), JSON.stringify(events, null, 2));
        return;
      }
      if (scenario === "equipment-drop" || scenario === "equipment-refused" || scenario === "equipment-timeout") {
        value(await admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "takeoff", target_altitude: { altitude_m: 5, altitude_reference: "launch" } }] } }));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 1 && e.record.task_state === "completed"));
        failEquipment = true;
        value(await admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "move_to", destination: { latitude: -35.362, longitude: 149.16523 } }, { kind: "hold" }] } }));
        const explanation = scenario === "equipment-drop" ? "equipment connection lost" : scenario === "equipment-timeout" ? "command timeout" : "ArduPilot command 178 refused (2)";
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 2 && e.record.task_state === "failed" && e.record.explanation === explanation));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 3 && e.record.task_state === "cancelled"));
        failEquipment = false;
        if (scenario === "equipment-drop") {
          await delay((config.measurement_stale_after_s + 0.5) * 1000);
          const telemetryTimes = events.flatMap(e => e.kind === "report.telemetry" ? [e.record.time] : []);
          await writeFile(join(root, "equipment-cut.json"), JSON.stringify({ droppedAt, receivedAt, telemetryTimes }, null, 2));
          assert.ok(receivedAt > droppedAt, "buffered equipment bytes arrive after the proxy destroys its connections");
          assert.ok(telemetryTimes.some(time => time > droppedAt), "the controlled race delivers a final measurement after proxy destruction");
          assert.equal(telemetryTimes.some(time => time > receivedAt), false, "telemetry never claims acquisition after the Asset last received equipment bytes");
          assert.equal(events.some(e => e.kind === "report.failsafe" && e.record.kind === "response"), false);
          const restoredAt = Date.now();
          blocked = false;
          await until(() => events.some(e => e.kind === "report.telemetry" && e.record.time > restoredAt));
        } else {
          value(await admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "land" }], now: true } }));
          await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 4 && e.record.task_state === "completed"));
        }
        await writeFile(join(root, "events.json"), JSON.stringify(events, null, 2));
        return;
      }
      if (scenario === "subsystem") {
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "subsystem" && e.record.condition === "healthy"));
        value(await admin.call("sendTasks", {
          params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "takeoff", target_altitude: { altitude_m: 5, altitude_reference: "launch" } }] },
        }));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 1 && e.record.task_state === "completed"));
        const pilot = connect({ host: "127.0.0.1", port: pilotPort });
        cleanup.push(() => { pilot.destroy(); });
        await once(pilot, "connect");
        const disable = new common.ParamSet();
        Object.assign(disable, { targetSystem: 1, targetComponent: 1, paramId: "SIM_GPS1_ENABLE", paramValue: 0, paramType: 9 });
        assert.equal(events.filter(e => e.kind === "report.status" && e.record.kind === "subsystem" && e.record.condition === "healthy").length, 1, "unchanged GPS health is not broadcast periodically");
        const disabledAt = Date.now();
        await send(pilot, disable, new MavLinkProtocolV2(254, 190));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "subsystem" && e.record.subsystem_id === "GPS" && e.record.condition === "faulted" && e.record.time >= disabledAt));
        await until(() => events.some(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id === "GPS" && e.record.task_state === "completed"));
        await writeFile(join(root, "events.json"), JSON.stringify(events, null, 2));
        return;
      }
      if (scenario === "requests") {
        const invalid = value(await admin.call("changeSettings", {
          params: { asset_id: app.asset_id }, body: { settings: { failsafe_policy: [
            ...config.initial_settings.failsafe_policy!,
            { rule_id: "BAD", priority: 99, conditions: [{ kind: "airborne" }],
              response: { kind: "land" } },
          ] } },
        }));
        assert.ok("event_id" in invalid);
        await until(() => events.some(e => e.kind === "report.settings" && e.record.request_id === invalid.event_id));
        const answer = events.find(e => e.kind === "report.settings" && e.record.request_id === invalid.event_id);
        assert.ok(answer?.kind === "report.settings");
        assert.deepEqual(answer.record.settings.failsafe_policy, config.initial_settings.failsafe_policy);
        value(await admin.call("sendTasks", {
          params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "takeoff", target_altitude: { altitude_m: 10, altitude_reference: "launch" } }] },
        }));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 1 && e.record.task_state === "completed"));
        value(await admin.call("sendTasks", {
          params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "failsafe" }], now: true },
        }));
        await until(() => events.some(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.task_state === "active"));
        let release!: () => void;
        reportGate = new Promise<void>(resolve => { release = resolve; });
        const task = value(await admin.call("sendTasks", {
          params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "hold" }] },
        }));
        assert.ok("task_ids" in task);
        const cancel = value(await admin.call("cancel", {
          params: { asset_id: app.asset_id, task_id: task.task_ids[0] },
        }));
        assert.ok("event_id" in cancel);
        release();
        reportGate = undefined;
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.request_id === cancel.event_id && e.record.task_state === "failed"));
        assert.ok("task_ids" in task && "event_id" in task);
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === task.task_ids[0] && e.record.task_state === "failed" && e.record.request_id === task.event_id));
        assert.equal(events.some(e => e.kind === "report.status" && e.record.kind === "queue" && e.record.task_ids.includes(task.task_ids[0])), false);
        await until(() => events.some(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.task_state === "completed"));
        await writeFile(join(root, "events.json"), JSON.stringify(events, null, 2));
        return;
      }
      if (scenario === "crash") {
        assert.ok("child" in app);
        const pilot = connect({ host: "127.0.0.1", port: pilotPort });
        cleanup.push(() => { pilot.destroy(); });
        await once(pilot, "connect");
        const samples: Array<{ time: number; mode: number; armed: boolean }> = [];
        let position: { latitude: number; longitude: number } | undefined;
        pilot.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser()).on("data", packet => {
          if (packet.header.msgid === minimal.Heartbeat.MSG_ID) {
            const heartbeat = packet.protocol.data(packet.payload, minimal.Heartbeat);
            samples.push({ time: Date.now(), mode: heartbeat.customMode, armed: !!(heartbeat.baseMode & 128) });
          }
          if (packet.header.msgid === common.GlobalPositionInt.MSG_ID) {
            const p = packet.protocol.data(packet.payload, common.GlobalPositionInt);
            position = { latitude: p.lat / 1e7, longitude: p.lon / 1e7 };
          }
        });
        const streams = new common.RequestDataStream();
        Object.assign(streams, { targetSystem: 1, targetComponent: 1, reqStreamId: 0, reqMessageRate: 10, startStop: 1 });
        await send(pilot, streams, new MavLinkProtocolV2(254, 190));
        value(await admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [
          { kind: "takeoff", target_altitude: { altitude_m: 10, altitude_reference: "launch" } },
          { kind: "move_to", destination: { latitude: -35.3618, longitude: 149.16523 } },
          { kind: "hold" },
        ] } }));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 2 && e.record.task_state === "active"));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "queue" && e.record.task_ids.includes(3)));
        const killedAt = Date.now();
        app.child.kill("SIGKILL");
        await app.closed;
        assert.equal(app.child.signalCode, "SIGKILL");
        await until(() => events.some(e => e.kind === "asset.contact" && e.record.asset_id === app.asset_id && e.record.contact === "offline"));
        await until(() => samples.some(s => s.time > killedAt && s.mode === 6));
        const rtl = samples.find(s => s.time > killedAt && s.mode === 6)!;
        assert.ok(rtl.time >= killedAt + 600, "GCS timeout precedes independent RTL at five times real time");
        assert.equal(samples.some(s => s.time <= killedAt && s.mode === 6), false);
        await until(() => samples.at(-1)?.armed === false);
        assert.ok(position);
        assert.ok(Math.hypot((position.latitude + 35.363261) * 111195, (position.longitude - 149.165230) * 90700) < 3, "independent RTL lands at the arming home");
        assert.equal(app.child.signalCode, "SIGKILL", "the app stays down throughout RTL");
        const restartedAt = Date.now();
        const restarted = await launchProcess();
        assert.equal(restarted.asset_id, app.asset_id);
        await until(() => [2, 3].every(id => events.some(e => e.kind === "task.dropped" && e.record.task_id === id)));
        await until(() => events.some(e => e.kind === "report.telemetry" && e.record.time >= restartedAt));
        assert.equal(events.some(e => e.kind === "report.status" && e.record.kind === "task" && [2, 3].includes(e.record.task_id) && e.record.time >= restartedAt), false, "restart never resumes or invents outcomes for earlier work");
        assert.equal(events.filter(e => e.kind === "asset.registered").length, 1);
        await restarted.stop();
        const archives = await readdir(config.archive_directory);
        assert.equal(archives.filter(name => name.endsWith(".zip")).length, 2);
        const checked = await Promise.all(archives.filter(name => name.endsWith(".zip")).map(async name => {
          const path = join(config.archive_directory, name);
          const manifest = JSON.parse(strFromU8(unzipSync(await readFile(path))["manifest.json"]));
          if (!manifest.normal) return checkAssetArchive(path, false);
        }));
        assert.equal(checked.filter(Boolean).length, 1, "the killed operation has a separate verified ZIP");
        await writeFile(join(root, "crash.json"), JSON.stringify({ killedAt, restartedAt, samples, position }, null, 2));
        await writeFile(join(root, "events.json"), JSON.stringify(events, null, 2));
        return;
      }
      if (scenario === "takeover" || scenario === "takeover-response") {
        value(await admin.call("sendTasks", {
          params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "takeoff", target_altitude: { altitude_m: 15, altitude_reference: "launch" } }] },
        }));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 1 && e.record.task_state === "completed"));
        const policy = value(await admin.call("changeSettings", { params: { asset_id: app.asset_id }, body: { settings: { failsafe_policy: [
          ...config.initial_settings.failsafe_policy!,
          { rule_id: "GPS", priority: 50, conditions: [{ kind: "subsystem", subsystem_id: "GPS", trigger_condition: "degraded" }], response: { kind: "land" } },
          { rule_id: "CMD", priority: 80, conditions: [{ kind: "commanded" }], response: { kind: "land", landing_position: { latitude: -35.362, longitude: 149.16523 } } },
        ] } } }));
        assert.ok("event_id" in policy);
        await until(() => events.some(e => e.kind === "report.settings" && e.record.request_id === policy.event_id));
        value(await admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: scenario === "takeover-response" ? [{ kind: "failsafe" }] : [{ kind: "move_to", destination: { latitude: -35.362, longitude: 149.16523 } }, { kind: "hold" }], now: scenario === "takeover-response" } }));
        await until(() => events.some(e => scenario === "takeover-response"
          ? e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id === "CMD" && e.record.task_state === "active"
          : e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 2 && e.record.task_state === "active"));
        await until(() => events.some(e => e.kind === "report.telemetry" && e.record.position.latitude > -35.36320));
        const pilot = connect({ host: "127.0.0.1", port: pilotPort });
        cleanup.push(() => { pilot.destroy(); });
        await once(pilot, "connect");
        const mode = async (customMode: number) => {
          const message = new common.SetMode();
          Object.assign(message, { targetSystem: 1, baseMode: 1, customMode });
          await send(pilot, message, new MavLinkProtocolV2(254, 190));
        };
        const gps = async (enabled: number) => {
          const message = new common.ParamSet();
          Object.assign(message, { targetSystem: 1, targetComponent: 1, paramId: "SIM_GPS1_ENABLE", paramValue: enabled, paramType: 9 });
          await send(pilot, message, new MavLinkProtocolV2(254, 190));
        };
        await mode(5);
        await until(() => events.some(e => e.kind === "report.failsafe" && e.record.kind === "autopilot" && e.record.in_control));
        await until(() => events.some(e => scenario === "takeover-response"
          ? e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id === "CMD" && e.record.task_state === "cancelled"
          : e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 2 && e.record.task_state === "cancelled"));
        if (scenario === "takeover")
          await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 3 && e.record.task_state === "cancelled"));
        const responseCount = events.filter(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id && e.record.task_state === "active").length;
        let release!: () => void;
        reportGate = new Promise<void>(resolve => { release = resolve; });
        const refused = value(await admin.call("sendTasks", {
          params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "land" }], now: true },
        }));
        assert.ok("task_ids" in refused && "event_id" in refused);
        const cancel = value(await admin.call("cancel", { params: { asset_id: app.asset_id, task_id: refused.task_ids[0] } }));
        assert.ok("event_id" in cancel);
        release();
        reportGate = undefined;
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === refused.task_ids[0] && e.record.task_state === "failed" && e.record.explanation === "flight controller is in control" && e.record.request_id === refused.event_id));
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === refused.task_ids[0] && e.record.request_id === cancel.event_id && e.record.task_state === "failed"));
        const setting = value(await admin.call("changeSettings", { params: { asset_id: app.asset_id }, body: { settings: { run_state: "paused" } } }));
        assert.ok("event_id" in setting);
        await until(() => events.some(e => e.kind === "report.settings" && e.record.request_id === setting.event_id && e.record.settings.run_state === "running"));
        const disabledAt = Date.now();
        await gps(0);
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "subsystem" && e.record.condition === "faulted" && e.record.time >= disabledAt));
        await delay(500);
        assert.equal(events.filter(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id && e.record.task_state === "active").length, responseCount, "no Atlas rule fires under flight-controller control");
        const restoredAt = Date.now();
        await gps(1);
        await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "subsystem" && e.record.condition === "healthy" && e.record.time >= restoredAt));
        await mode(4);
        await until(() => events.some(e => e.kind === "report.failsafe" && e.record.kind === "autopilot" && !e.record.in_control));
        await until(() => events.some(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.response?.kind === "hold" && e.record.task_state === "completed"));
        assert.equal(events.filter(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id && e.record.task_state === "active").length, responseCount, "handback holds with rules re-armed");
        await gps(0);
        await until(() => events.some(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.rule_id === "GPS" && e.record.task_state === "completed"));
        await writeFile(join(root, "events.json"), JSON.stringify(events, null, 2));
        return;
      }
      if (scenario === "land-position" || scenario === "atlas-home") {
        const target = { latitude: -35.36295, longitude: 149.16523 };
        if (scenario === "atlas-home")
          value(
            await admin.call("changeSettings", {
              params: { asset_id: app.asset_id },
              body: { settings: { home_position: target } },
            }),
          );
        value(
          await admin.call("sendTasks", {
            params: { asset_id: app.asset_id },
            body: {
              tasks: [
                {
                  kind: "takeoff",
                  target_altitude: {
                    altitude_m: 5,
                    altitude_reference: "launch",
                  },
                },
                scenario === "land-position"
                  ? {
                      kind: "land",
                      landing_position: target,
                      transit_altitude: {
                        altitude_m: 8,
                        altitude_reference: "launch",
                      },
                    }
                  : {
                      kind: "return_to_home",
                      transit_altitude: {
                        altitude_m: 8,
                        altitude_reference: "launch",
                      },
                    },
              ],
            },
          }),
        );
        await until(() =>
          events.some(
            (e) =>
              e.kind === "report.status" &&
              e.record.kind === "task" &&
              e.record.task_id === 2 &&
              e.record.task_state !== "active",
          ),
        );
        await writeFile(
          join(root, "events.json"),
          JSON.stringify(events, null, 2),
        );
        const archive = await app.stop();
        const entries = Object.entries(unzipSync(await readFile(archive)))
          .filter(([name]) => name.startsWith("diagnostics/"))
          .flatMap(([, data]) =>
            strFromU8(data)
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
          );
        assert.equal(
          entries
            .filter(
              (e) =>
                e.kind === "input" &&
                e.event.kind === "measurements" &&
                e.event.measurements.armed,
            )
            .at(-1)?.event.measurements.armed.value,
          false,
        );
        const last = events.filter((e) => e.kind === "report.telemetry").at(-1);
        assert.ok(last?.kind === "report.telemetry");
        const metres = Math.hypot(
          (last.record.position.latitude - target.latitude) * 111195,
          (last.record.position.longitude - target.longitude) * 90700,
        );
        assert.ok(
          metres < 3,
          `Core final position is ${metres} m from requested destination`,
        );
        assert.ok(
          events.some(
            (e) =>
              e.kind === "report.status" &&
              e.record.kind === "task" &&
              e.record.task_id === 2 &&
              e.record.task_state === "completed",
          ),
        );
        return;
      }
      if (scenario === "idle-gap") {
        value(
          await admin.call("sendTasks", {
            params: { asset_id: app.asset_id },
            body: {
              tasks: [
                {
                  kind: "takeoff",
                  target_altitude: {
                    altitude_m: 5,
                    altitude_reference: "launch",
                  },
                },
              ],
            },
          }),
        );
        await until(() =>
          events.some(
            (e) =>
              e.kind === "report.status" &&
              e.record.kind === "task" &&
              e.record.task_id === 1 &&
              e.record.task_state === "completed",
          ),
        );
        value(
          await admin.call("sendTasks", {
            params: { asset_id: app.asset_id },
            body: { tasks: [{ kind: "hold" }, { kind: "hold" }] },
          }),
        );
        await until(() =>
          events.some(
            (e) =>
              e.kind === "report.status" &&
              e.record.kind === "queue" &&
              e.record.task_ids.includes(3),
          ),
        );
        await delay(2000);
        assert.ok(
          events.some(
            (e) =>
              e.kind === "report.failsafe" &&
              e.record.kind === "response" &&
              e.record.rule_id === "IDLE" &&
              e.record.task_state === "active",
          ),
          "a held Task waiting for a missing predecessor must not suppress idle",
        );
        await until(() =>
          events.some(
            (e) =>
              e.kind === "report.failsafe" &&
              e.record.kind === "response" &&
              e.record.rule_id === "IDLE" &&
              e.record.task_state === "completed",
          ),
        );
        return;
      }
      if (scenario === "battery" || scenario === "link" || scenario === "boundary") {
        value(
          await admin.call("sendTasks", {
            params: { asset_id: app.asset_id },
            body: {
              tasks: [
                {
                  kind: "takeoff",
                  target_altitude: {
                    altitude_m: 5,
                    altitude_reference: "launch",
                  },
                },
              ],
            },
          }),
        );
        if (scenario === "boundary") {
          await until(() => events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 1 && e.record.task_state === "completed"));
          value(await admin.call("sendTasks", {
            params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "move_to", destination: {
              latitude: -35.3628, longitude: 149.16523,
              altitudes: [{ altitude_m: 5, altitude_reference: "launch" }],
            } }] },
          }));
        }
        if (scenario === "link")
          await until(() =>
            events.some(
              (e) =>
                e.kind === "report.telemetry" &&
                e.record.position.altitudes?.some(
                  (a) => a.altitude_reference === "launch" && a.altitude_m >= 3,
                ),
            ),
          );
        if (scenario === "link") {
          cutNextFrame = true;
          await until(() => abortedAt !== undefined);
          await delay(
            config.initial_settings.link_loss_after_s! * 1000 +
              config.control_tick_s * 2000,
          );
          linkController = new AbortController();
        }
        await until(() =>
          events.some(
            (e) =>
              e.kind === "report.failsafe" &&
              e.record.kind === "response" &&
              e.record.rule_id === (scenario === "battery" ? "LB" : scenario === "boundary" ? "AREA" : "LINK") &&
              e.record.task_state === "completed",
          ),
        );
        const responses = events.filter(
          (e) =>
            e.kind === "report.failsafe" &&
            e.record.kind === "response" &&
            e.record.rule_id === (scenario === "battery" ? "LB" : scenario === "boundary" ? "AREA" : "LINK"),
        );
        assert.ok(
          responses.some(
            (e) =>
              e.kind === "report.failsafe" &&
              e.record.kind === "response" &&
              e.record.task_state === "active",
          ),
        );
        const archive = await app.stop();
        const zipped = unzipSync(await readFile(archive));
        const entries = Object.entries(zipped)
          .filter(([name]) => name.startsWith("diagnostics/"))
          .flatMap(([, data]) =>
            strFromU8(data)
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
          );
        const armed = entries
          .filter(
            (entry) =>
              entry.kind === "input" &&
              entry.event.kind === "measurements" &&
              entry.event.measurements.armed,
          )
          .at(-1);
        assert.equal(
          armed?.event.measurements.armed.value,
          false,
          "last archived armed measurement must show disarmed",
        );
        const reports = entries
          .filter((entry) => entry.kind === "report")
          .map((entry) => entry.report);
        const response = reports.find(
          (r) =>
            r.type === "report.failsafe" &&
            r.kind === "response" &&
            r.rule_id === (scenario === "battery" ? "LB" : scenario === "boundary" ? "AREA" : "LINK") &&
            r.task_state === "active",
        );
        assert.ok(
          response,
          "archive must contain an emitted response, not startup configuration",
        );
        assert.ok(
          reports.some(
            (r) =>
              r.type === "report.failsafe" &&
              r.rule_id === response.rule_id &&
              r.task_state === "completed",
          ),
        );
        if (scenario === "boundary") {
          const outside = entries.find(e => e.kind === "input" && e.event.kind === "measurements" && e.event.measurements.position?.value.latitude > -35.3631);
          assert.ok(outside, "archive must show the vehicle outside the configured area");
          assert.ok(response.time >= outside.event.measurements.position.time + 2000, "boundary response must wait for the configured duration");
        }
        if (scenario === "link")
          assert.ok(
            response.time >=
              abortedAt! + config.initial_settings.link_loss_after_s! * 1000,
            `LINK started too early at ${response.time - abortedAt!} ms`,
          );
        console.log(JSON.stringify({ scenario, archive }));
        return;
      }
      const tasks = value(
        await admin.call("sendTasks", {
          params: { asset_id: app.asset_id },
          body: {
            tasks: [
              {
                kind: "takeoff",
                target_altitude: {
                  altitude_m: 5,
                  altitude_reference: "launch",
                },
              },
              { kind: "hold" },
              {
                kind: "move_to",
                destination: {
                  latitude: -35.3628,
                  longitude: 149.16523,
                  altitudes: [{ altitude_m: 5, altitude_reference: "launch" }],
                },
              },
              ...(scenario === "land-now" ? [] : [{ kind: "land" as const }]),
            ],
          },
        }),
      );
      await until(() =>
        events.some(
          (e) =>
            e.kind === "report.status" &&
            e.record.kind === "task" &&
            e.record.task_id === 3 &&
            e.record.task_state === "active",
        ),
      );
      if (scenario === "land-now") {
        value(
          await admin.call("sendTasks", {
            params: { asset_id: app.asset_id },
            body: { tasks: [{ kind: "land" }], now: true },
          }),
        );
      } else {
        value(
          await admin.call("changeSettings", {
            params: { asset_id: app.asset_id },
            body: { settings: { run_state: "paused" } },
          }),
        );
        await until(() =>
          events.some(
            (e) =>
              e.kind === "report.settings" &&
              e.record.settings.run_state === "paused",
          ),
        );
        await delay(500);
        value(
          await admin.call("changeSettings", {
            params: { asset_id: app.asset_id },
            body: { settings: { run_state: "running" } },
          }),
        );
      }
      async function waitForDone() {
        const end = Date.now() + 100000;
        while (Date.now() < end) {
          const reports = events
            .filter((e) => e.kind === "report.status")
            .map((e) => e.record);
          const finals = reports.filter(
            (r) =>
              "type" in r &&
              r.type === "report.status" &&
              "task_state" in r &&
              r.task_state !== "active",
          );
          if (finals.length >= 4) return finals;
          await delay(100);
        }
        throw new Error(
          `flight timeout: ${JSON.stringify(events.slice(-12))}\n${diagnostics.slice(-2000)}`,
        );
      }
      const finals = await waitForDone();
      for (const final of finals) {
        if (final.type !== "report.status" || final.kind !== "task") continue;
        assert.equal(events.filter(e => e.kind === "report.status" && e.record.kind === "task" &&
          e.record.task_id === final.task_id && e.record.task_state === "active").length, 1,
          "Core retains one active report before each Task's final outcome");
      }
      await writeFile(
        join(root, "events.json"),
        JSON.stringify(events, null, 2),
      );
      assert.deepEqual(
        finals.map((r) => ("task_state" in r ? r.task_state : null)),
        scenario === "land-now"
          ? ["completed", "completed", "cancelled", "completed"]
          : ["completed", "completed", "completed", "completed"],
      );
      if (scenario === "flight")
        assert.ok(
          events.some(
            (e) =>
              e.kind === "report.telemetry" &&
              Math.abs(e.record.position.latitude + 35.3628) < 0.00002 &&
              Math.abs(e.record.position.longitude - 149.16523) < 0.00002,
          ),
          "Core receives telemetry near the Move To destination",
        );
      const archive = await app.stop();
      if (scenario === "flight") await checkAssetArchive(archive, true);
      const entries = Object.entries(unzipSync(await readFile(archive)))
        .filter(([name]) => name.startsWith("diagnostics/"))
        .flatMap(([, data]) =>
          strFromU8(data)
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line)),
        );
      const armed = entries
        .filter(
          (entry) =>
            entry.kind === "input" &&
            entry.event.kind === "measurements" &&
            entry.event.measurements.armed,
        )
        .at(-1);
      assert.equal(
        armed?.event.measurements.armed.value,
        false,
        "last archived armed measurement must show disarmed",
      );
      console.log(JSON.stringify({ tasks, finals }));
    },
  );
