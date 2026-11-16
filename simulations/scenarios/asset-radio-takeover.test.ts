import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { minimal, common, ardupilotmega, MavLinkPacketParser, MavLinkPacketSplitter, MavLinkProtocolV2, send, type MavLinkPacket } from "node-mavlink";
import { equipmentWire } from "../src/equipment-wire.ts";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
import { startApp, parseConfig } from "../../asset/src/index.ts";

for (const options of [0, 4]) scenario({
  name: `radio failsafe persists without its RTL heartbeat, FS_OPTIONS=${options}`,
  checks: ["asset/docs/failsafes.md#while-the-flight-controller-is-in-control"],
  async run(w) {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    w.onClose(() => server.close());
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
      equipment: { ...raw.equipment, port: address.port },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    let observedMode = -1;
    let lateGuidedReceived = false;
    const receivedModes: number[] = [];
    let unsolicitedRtlHeartbeats = 0;
    w.onClose(equipmentWire(address.port, (direction, packet) => {
      if (direction === "received" && packet.header.msgid === minimal.Heartbeat.MSG_ID) {
        observedMode = packet.protocol.data(packet.payload, minimal.Heartbeat).customMode;
        receivedModes.push(observedMode);
        if (observedMode === 4 && pilotArmed) lateGuidedReceived = true;
        if (observedMode === 6 && !writes.includes("SET_MODE 6 pilotArmed=true")) unsolicitedRtlHeartbeats++;
      }
    }));
    const protocol = new MavLinkProtocolV2(1, 1);
    let mode = 4, armed = true, pilotArmed = false, landing = false;
    const writes: string[] = [];
    let peer: Socket | undefined;
    const out = (m: Parameters<typeof send>[1]) => { if (peer && !peer.destroyed) void send(peer, m, protocol).catch(() => {}); };
    let hideTransition = false;
    const hb = () => { if (hideTransition) return; const m = new minimal.Heartbeat(); Object.assign(m, { type: 2, autopilot: 3, baseMode: armed ? 129 : 1, customMode: mode, systemStatus: pilotArmed ? 5 : 4, mavlinkVersion: 3 }); out(m); };
    const rc = () => { const m = new common.RcChannels(); Object.assign(m, { chancount: 8, chan5Raw: 1000 }); out(m); };
    const telemetry = () => {
      rc();
      hb();
      const g = new common.GpsRawInt(); Object.assign(g, { timeUsec: 0n, fixType: 3, lat: -353632620, lon: 1491652370, alt: 584000, eph: 100, epv: 100, vel: 0, cog: 0, satellitesVisible: 10 }); out(g);
      const e = new ardupilotmega.EkfStatusReport(); Object.assign(e, { flags: 0x3ff, velocityVariance: 0, posHorizVariance: 0, posVertVariance: 0, compassVariance: 0, terrainAltVariance: 0 }); out(e);
      const p = new common.GlobalPositionInt(); Object.assign(p, { timeBootMs: 0, lat: -353632620, lon: 1491652370, alt: 584000, relativeAlt: 10000, vx: 0, vy: 0, vz: 0, hdg: 0 }); out(p);
      const s = new common.SysStatus(); Object.assign(s, { batteryRemaining: 80, onboardControlSensorsPresent: 65536, onboardControlSensorsEnabled: 65536, onboardControlSensorsHealth: pilotArmed ? 0 : 65536 }); out(s);
      const x = new common.ExtendedSysState(); Object.assign(x, { vtolState: 0, landedState: 2 }); out(x);
    };
    server.on("connection", (socket: Socket) => {
      socket.on("error", () => {});
      peer = socket;
      const reader = socket.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser());
      reader.on("data", (packet: MavLinkPacket) => {
        const id = packet.header.msgid;
        if (id === common.ParamRequestRead.MSG_ID) {
          const request = packet.protocol.data(packet.payload, common.ParamRequestRead);
          const values: Record<string, number> = { FS_THR_ENABLE: 1, FS_OPTIONS: options, FLTMODE_CH: 5, FLTMODE1: 4, FLTMODE2: 0, FLTMODE3: 5, FLTMODE4: 2, FLTMODE5: 6, FLTMODE6: 9 };
          if (request.paramId in values) { const m = new common.ParamValue(); Object.assign(m, { paramId: request.paramId, paramValue: values[request.paramId], paramType: 9, paramCount: 7, paramIndex: 0 }); out(m); }
          return;
        }
        if (id === minimal.Heartbeat.MSG_ID) { telemetry(); return; }
        if (id === common.SetMode.MSG_ID) {
          const m = packet.protocol.data(packet.payload, common.SetMode);
          writes.push(`SET_MODE ${m.customMode} pilotArmed=${pilotArmed}`);
          if (m.customMode === 9) landing = true;
          if (landing && m.customMode === 4 && !pilotArmed) {
            pilotArmed = true; mode = 6;
            hideTransition = true;
            w.clock.after(30, () => { mode = m.customMode; hideTransition = false; telemetry(); });
            return;
          }
          mode = m.customMode; hb();
          return;
        }
        if (id === common.CommandLong.MSG_ID) {
          const m = packet.protocol.data(packet.payload, common.CommandLong);
          writes.push(`COMMAND_LONG ${m.command} pilotArmed=${pilotArmed}`);
          const ack = new common.CommandAck(); Object.assign(ack, { command: m.command, result: 0, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190 }); out(ack);
          return;
        }
        if (id === common.SetPositionTargetGlobalInt.MSG_ID) writes.push(`SET_POSITION_TARGET pilotArmed=${pilotArmed}`);
      });
      telemetry();
    });
    const clock = { now: () => w.clock.now(), after: (ms: number, fn: () => void) => w.clock.after(Math.ceil(ms), fn) };
    const app = await w.complete(startApp(config, { clock, fetch: w.network.fetchFor("app") }));
    try {
      await w.advance(2000);
      value(await w.complete(w.admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "land" }] } })));
      await w.until(() => landing);
      await w.advance(500);
      value(await w.complete(w.admin.call("cancel", { params: { asset_id: app.asset_id, task_id: 1 } })));
      await w.until(() => pilotArmed);
      await w.until(() => lateGuidedReceived);
      if (options !== 4) await w.until(() => receivedModes.includes(6));
      await w.advance(6000);
      assert.ok(w.events.some(e => e.kind === "report.failsafe" && e.record.kind === "autopilot" && e.record.in_control));
      assert.equal(w.events.some(e => e.kind === "report.failsafe" && e.record.kind === "autopilot" && !e.record.in_control), false, "Atlas's late Guided is not a person's handback");
      assert.equal(unsolicitedRtlHeartbeats, 0, "no RTL heartbeat escaped before corrective mode selection");
      assert.equal(receivedModes.includes(6), options !== 4, "RTL heartbeat appears only after Atlas explicitly restores RTL");
      assert.equal(mode, options === 4 ? 4 : 6, "Atlas restores the pilot mode after its late Guided request");
      assert.deepEqual(writes.filter(s => s.endsWith("pilotArmed=true")), options === 4 ? [] : ["SET_MODE 6 pilotArmed=true"], "only the corrective mode selection is sent");
      pilotArmed = false; mode = 2; hb();
      await w.until(() => observedMode === mode);
      await w.advance(1000);
      mode = 4; hb();
      await w.until(() => observedMode === mode);
      await w.advance(1000);
      assert.ok(w.events.some(e => e.kind === "report.failsafe" && e.record.kind === "autopilot" && !e.record.in_control), "a fresh mode cycle hands control back");
    } finally {
      await w.complete(app.stop());
    }
  },
});
