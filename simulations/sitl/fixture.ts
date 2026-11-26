import { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, Socket } from "node:net";
import { once } from "node:events";
import {
  send,
  common,
  minimal,
  MavLinkPacketSplitter,
  MavLinkPacketParser,
  MavLinkProtocolV2,
} from "node-mavlink";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient, systemClock, follow, type AtlasEvent } from "@atlas/sdk";
import { loadPackagedProtocol } from "@atlas/protocol";

import { startApp, parseConfig } from "@atlas/asset";
import { spawnCore } from "../src/core-process.ts";
import { value } from "../src/world.ts";
import { closeAll } from "../src/cleanup.ts";
import { equipmentWire } from "../src/equipment-wire.ts";

async function equipmentPorts() {
  const reservations = [createServer(), createServer()];
  const ports = await Promise.all(
    reservations.map(async (reservation) => {
      reservation.listen(0, "127.0.0.1");
      await once(reservation, "listening");
      const address = reservation.address();
      assert.ok(address && typeof address !== "string");
      return address.port;
    }),
  );
  await Promise.all(
    reservations.map(
      (reservation) =>
        new Promise<void>((resolve, reject) =>
          reservation.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
  return ports;
}
export const linkLossSeconds = 12;

export async function flightFixture(t: TestContext, scenario: Scenario) {
  const cleanup: Array<() => unknown | Promise<unknown>> = [];
  t.after(() => closeAll(cleanup));
  const root = await mkdtemp(join(tmpdir(), "atlas-sitl-flight-"));
  console.log(`Evidence: ${root}`);
  const cache = resolve(
    process.env.ATLAS_SITL_DIRECTORY ?? join(homedir(), ".cache/atlas-sitl"),
  );
  await writeFile(
    join(root, "flight.parm"),
    `DISARM_DELAY ${scenario === "armed-startup" ? 0 : 10}\n${scenario === "rc-late-guided" ? "FLTMODE1 4\nFLTMODE4 5\n" : ""}${["subsystem", "takeover", "takeover-response"].includes(scenario) ? "FS_EKF_THRESH 0\n" : ""}FS_GCS_ENABLE 1\nFS_GCS_TIMEOUT 5\nMAV_GCS_SYSID 255\nFS_OPTIONS 0\nBATT_CAPACITY ${scenario === "battery" ? 100 : scenario === "battery-layers" ? 1000 : 3300}\nBATT_LOW_MAH ${scenario === "battery" ? 15 : scenario === "battery-layers" ? 150 : 495}\nBATT_CRT_MAH ${scenario === "battery" ? 10 : scenario === "battery-layers" ? 100 : 330}\nBATT_LOW_VOLT 0\nBATT_CRT_VOLT 0\nBATT_FS_LOW_ACT 2\nBATT_FS_CRT_ACT 1\n`,
  );
  const [equipment, pilotPort] = await equipmentPorts();
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
  let hiddenBatteryMode = 6;
  let criticalReleasedAt = Infinity;
  let receivedChargeState = common.MavBatteryChargeState.UNDEFINED;
  const batteryWire: unknown[] = [];
  const equipmentPeers = new Set<Socket>();
  let blocked = scenario === "equipment-startup";
  let failEquipment = false;
  let droppedAt = 0;
  let receivedAt = 0;
  let assetSocket: Socket | undefined;
  let proxyPort = 0;
  const emit = Socket.prototype.emit;
  if (scenario === "equipment-drop")
    t.mock.method(
      Socket.prototype,
      "emit",
      function (this: Socket, event: string | symbol, ...args: unknown[]) {
        const equipmentData = this.remotePort === proxyPort && event === "data";
        if (equipmentData) assetSocket = this;
        const emitted: boolean = Reflect.apply(emit, this, [event, ...args]);
        if (equipmentData) receivedAt = Date.now();
        return emitted;
      },
    );
  const proxy = createServer((peer) => {
    equipmentPeers.add(peer);
    peer.on("error", () => {});
    peer.on("close", () => equipmentPeers.delete(peer));
    if (blocked) {
      peer.destroy();
      return;
    }
    const upstream = connect({ host: "127.0.0.1", port: equipment });
    equipmentPeers.add(upstream);
    upstream.on("error", () => peer.destroy());
    upstream.on("close", () => {
      equipmentPeers.delete(upstream);
      peer.destroy();
    });
    peer.on("close", () => upstream.destroy());
    if (scenario === "battery-layers") {
      const parser = new MavLinkPacketParser();
      upstream.pipe(new MavLinkPacketSplitter()).on("data", (frame) => {
        parser.once("data", (packet) => {
          if (
            packet.header.msgid === minimal.Heartbeat.MSG_ID &&
            packet.protocol.data(packet.payload, minimal.Heartbeat)
              .customMode === hiddenBatteryMode
          )
            return;
          if (
            packet.header.msgid === common.BatteryStatus.MSG_ID &&
            packet.protocol.data(packet.payload, common.BatteryStatus)
              .chargeState === common.MavBatteryChargeState.CRITICAL
          ) {
            if (criticalReleasedAt === Infinity)
              criticalReleasedAt = Date.now() + 1500;
            if (Date.now() < criticalReleasedAt) return;
          }
          peer.write(frame.buffer);
        });
        parser.write(frame);
      });
    } else upstream.pipe(peer);
    const splitter = peer.pipe(new MavLinkPacketSplitter());
    const parser = new MavLinkPacketParser();
    splitter.on("data", (frame) => {
      parser.once("data", async (packet) => {
        if (
          scenario === "land-refused" &&
          failEquipment &&
          packet.header.msgid === common.SetMode.MSG_ID &&
          packet.protocol.data(packet.payload, common.SetMode).customMode === 9
        ) {
          const ack = new common.CommandAck();
          ack.command = common.MavCmd.DO_SET_MODE;
          ack.result = common.MavResult.DENIED;
          failEquipment = false;
          await send(peer, ack, new MavLinkProtocolV2(1, 1));
          return;
        }
        if (
          failEquipment &&
          packet.header.msgid === common.CommandLong.MSG_ID &&
          packet.protocol.data(packet.payload, common.CommandLong).command ===
            178
        ) {
          if (scenario === "equipment-refused") {
            const ack = new common.CommandAck();
            Object.assign(ack, { command: 178, result: 2 });
            void send(peer, ack, new MavLinkProtocolV2(1, 1));
          }
          if (
            scenario === "equipment-refused" ||
            scenario === "equipment-timeout"
          )
            return;
        }
        if (
          failEquipment &&
          scenario === "equipment-drop" &&
          packet.header.msgid === common.SetPositionTargetGlobalInt.MSG_ID
        ) {
          blocked = true;
          assert.ok(assetSocket);
          assetSocket.pause();
          const finalPosition = new common.GlobalPositionInt();
          Object.assign(finalPosition, {
            lat: -353632600,
            lon: 1491652300,
            alt: 589000,
            relativeAlt: 5000,
          });
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
  if (scenario === "battery-layers") {
    cleanup.push(
      equipmentWire(proxyPort, (direction, packet) => {
        const id = packet.header.msgid;
        if (id === minimal.Heartbeat.MSG_ID)
          batteryWire.push({
            time: Date.now(),
            direction,
            heartbeat: packet.protocol.data(packet.payload, minimal.Heartbeat)
              .customMode,
          });
        if (id === common.BatteryStatus.MSG_ID && direction === "received") {
          receivedChargeState = packet.protocol.data(
            packet.payload,
            common.BatteryStatus,
          ).chargeState;
          batteryWire.push({
            time: Date.now(),
            direction,
            chargeState: receivedChargeState,
          });
        }
        if (id === common.SetMode.MSG_ID)
          batteryWire.push({
            time: Date.now(),
            direction,
            selected: packet.protocol.data(packet.payload, common.SetMode)
              .customMode,
          });
      }),
    );
    cleanup.push(() =>
      writeFile(
        join(root, "battery-wire.json"),
        JSON.stringify(batteryWire, null, 2),
      ),
    );
  }
  cleanup.push(async () => {
    for (const peer of equipmentPeers) peer.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });
  const example = JSON.parse(
    await readFile(
      new URL("../../asset/examples/copter.json", import.meta.url),
      "utf8",
    ),
  );
  const config = parseConfig({
    ...example,
    description: {
      ...example.description,
      subsystems: [{ subsystem_id: "GPS", label: "GPS receiver" }],
    },
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
      rule_id: "GPS",
      priority: 50,
      conditions: [
        {
          kind: "subsystem",
          subsystem_id: "GPS",
          trigger_condition: "degraded",
        },
        { kind: "airborne" },
      ],
      response: { kind: "land" },
    });
  }
  if (scenario === "boundary")
    config.initial_settings.failsafe_policy!.push({
      rule_id: "AREA",
      priority: 50,
      conditions: [
        {
          kind: "outside_area",
          for_s: 2,
          area: [
            { latitude: -35.3635, longitude: 149.165 },
            { latitude: -35.3631, longitude: 149.165 },
            { latitude: -35.3631, longitude: 149.1655 },
            { latitude: -35.3635, longitude: 149.1655 },
          ],
        },
      ],
      response: { kind: "land" },
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
    config.initial_settings.failsafe_policy!.push({
      rule_id: "LINK",
      priority: 50,
      conditions: [{ kind: "contact_lost", for_s: linkLossSeconds }, { kind: "airborne" }],
      response: { kind: "land" },
    });
  }
  if (scenario === "equipment-timeout") config.command_timeouts.move_to = 2;
  if (scenario === "land-refused") config.command_timeouts.land = 2;
  const events: AtlasEvent[] = [];
  const audit = follow(admin, { after: 0 }, (event) => {
    events.push(event);
  });
  cleanup.push(() => audit.stop());
  const launchProcess = async () => {
    const path = join(root, "asset-config.json");
    await writeFile(path, JSON.stringify(config));
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../../asset/src/main.ts", import.meta.url)),
        "run",
        path,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk;
    });
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      await closed;
    });
    await until(() => output.includes("asset_id") || child.exitCode !== null);
    assert.equal(child.exitCode, null, diagnostics);
    const { asset_id } = JSON.parse(output.trim());
    assert.equal(typeof asset_id, "string");
    return {
      asset_id: String(asset_id),
      child,
      closed,
      stop: async () => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGTERM");
        await closed;
        return "";
      },
    };
  };
  if (scenario === "armed-startup") {
    const pilot = connect({ host: "127.0.0.1", port: pilotPort });
    cleanup.push(() => {
      pilot.destroy();
    });
    await once(pilot, "connect");
    let observedMode = -1;
    let armed = false;
    pilot
      .pipe(new MavLinkPacketSplitter())
      .pipe(new MavLinkPacketParser())
      .on("data", (packet: import("node-mavlink").MavLinkPacket) => {
        if (packet.header.msgid !== minimal.Heartbeat.MSG_ID) return;
        const heartbeat = packet.protocol.data(
          packet.payload,
          minimal.Heartbeat,
        );
        observedMode = heartbeat.customMode;
        armed = Boolean(heartbeat.baseMode & 128);
      });
    await delay(10000);
    const mode = new common.SetMode();
    Object.assign(mode, { targetSystem: 1, baseMode: 1, customMode: 5 });
    await send(pilot, mode, new MavLinkProtocolV2(254, 190));
    await until(() => observedMode === 5);
    const arm = new common.CommandLong();
    Object.assign(arm, {
      targetSystem: 1,
      targetComponent: 1,
      command: 400,
      _param1: 1,
      _param2: 21196,
    });
    await send(pilot, arm, new MavLinkProtocolV2(254, 190));
    await until(() => armed);
  }
  const app =
    scenario === "crash"
      ? await launchProcess()
      : await startApp(config, { fetch: assetFetch });
  cleanup.push(() => app.stop());
  if (scenario !== "equipment-startup") {
    await until(() => events.some((e) => e.kind === "report.telemetry"));
    if (scenario !== "armed-startup") {
      const observer = connect({ host: "127.0.0.1", port: pilotPort });
      observer.on("error", () => {});
      await once(observer, "connect");
      let armable = false;
      observer
        .pipe(new MavLinkPacketSplitter())
        .pipe(new MavLinkPacketParser())
        .on("data", (packet) => {
          if (
            packet.header.compid === 1 &&
            packet.header.msgid === common.SysStatus.MSG_ID
          )
            armable =
              (packet.protocol.data(packet.payload, common.SysStatus)
                .onboardControlSensorsHealth &
                0x10000000) !==
              0;
        });
      try {
        await until(() => armable);
      } finally {
        observer.destroy();
      }
    }
  }
  return {
    until,
    events,
    admin,
    app,
    get blocked() {
      return blocked;
    },
    set blocked(value: typeof blocked) {
      blocked = value;
    },
    root,
    pilotPort,
    cleanup,
    t,
    get receivedChargeState() {
      return receivedChargeState;
    },
    set receivedChargeState(value: typeof receivedChargeState) {
      receivedChargeState = value;
    },
    get hiddenBatteryMode() {
      return hiddenBatteryMode;
    },
    set hiddenBatteryMode(value: typeof hiddenBatteryMode) {
      hiddenBatteryMode = value;
    },
    scenario,
    get failEquipment() {
      return failEquipment;
    },
    set failEquipment(value: typeof failEquipment) {
      failEquipment = value;
    },
    config,
    get droppedAt() {
      return droppedAt;
    },
    set droppedAt(value: typeof droppedAt) {
      droppedAt = value;
    },
    get receivedAt() {
      return receivedAt;
    },
    set receivedAt(value: typeof receivedAt) {
      receivedAt = value;
    },
    get reportGate() {
      return reportGate;
    },
    set reportGate(value: typeof reportGate) {
      reportGate = value;
    },
    launchProcess,
    get cutNextFrame() {
      return cutNextFrame;
    },
    set cutNextFrame(value: typeof cutNextFrame) {
      cutNextFrame = value;
    },
    get abortedAt() {
      return abortedAt;
    },
    set abortedAt(value: typeof abortedAt) {
      abortedAt = value;
    },
    get linkController() {
      return linkController;
    },
    set linkController(value: typeof linkController) {
      linkController = value;
    },
    get diagnostics() {
      return diagnostics;
    },
    set diagnostics(value: typeof diagnostics) {
      diagnostics = value;
    },
  };
}
export type FlightContext = Awaited<ReturnType<typeof flightFixture>>;
export type Scenario =
  | "equipment-startup"
  | "battery-layers"
  | "armed-startup"
  | "equipment-drop"
  | "land-refused"
  | "equipment-refused"
  | "equipment-timeout"
  | "subsystem"
  | "requests"
  | "crash"
  | "failsafe-signal"
  | "rc-late-guided"
  | "takeover"
  | "takeover-response"
  | "land-position"
  | "atlas-home"
  | "idle-gap"
  | "battery"
  | "link"
  | "boundary"
  | "flight"
  | "land-now";
