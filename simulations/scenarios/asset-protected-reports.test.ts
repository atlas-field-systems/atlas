import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { minimal, common, ardupilotmega, MavLinkPacketParser, MavLinkPacketSplitter, MavLinkProtocolV2, send, type MavLinkPacket } from "node-mavlink";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
import { startApp, parseConfig } from "../../asset/src/index.ts";

scenario({
  name: "pre-registration overflow preserves takeover and subsystem faults",
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
      description: { ...raw.description, subsystems: [{ subsystem_id: "GPS", label: "GPS" }] },
      equipment: { ...raw.equipment, port: address.port, subsystems: { gps: "GPS" } },
      log_directory: join(w.root, "asset-logs"), archive_directory: join(w.root, "asset-archives") });
    const protocol = new MavLinkProtocolV2(1, 1);
    let mode = 4;
    let peer: Socket | undefined;
    const out = (m: Parameters<typeof send>[1]) => { if (peer && !peer.destroyed) void send(peer, m, protocol).catch(() => {}); };
    const hb = () => { const m = new minimal.Heartbeat(); Object.assign(m, { type: 2, autopilot: 3, baseMode: 129, customMode: mode, systemStatus: 4, mavlinkVersion: 3 }); out(m); };
    const telemetry = () => {
      hb();
      const g = new common.GpsRawInt(); Object.assign(g, { timeUsec: 0n, fixType: 3, lat: -353632620, lon: 1491652370, alt: 584000, eph: 100, epv: 100, vel: 0, cog: 0, satellitesVisible: 10 }); out(g);
      const e = new ardupilotmega.EkfStatusReport(); Object.assign(e, { flags: 0x3ff, velocityVariance: 0, posHorizVariance: 0, posVertVariance: 0, compassVariance: 0, terrainAltVariance: 0 }); out(e);
      const p = new common.GlobalPositionInt(); Object.assign(p, { timeBootMs: 0, lat: -353632620, lon: 1491652370, alt: 584000, relativeAlt: 0, vx: 0, vy: 0, vz: 0, hdg: 0 }); out(p);
      const s = new common.SysStatus(); Object.assign(s, { batteryRemaining: 80 }); out(s);
      const x = new common.ExtendedSysState(); Object.assign(x, { vtolState: 0, landedState: 1 }); out(x);
    };
    server.on("connection", (socket: Socket) => {
      peer = socket;
      const reader = socket.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser());
      reader.on("data", (packet: MavLinkPacket) => {
        const id = packet.header.msgid;
        if (id === minimal.Heartbeat.MSG_ID) { telemetry(); return; }

      });
      telemetry();
    });
    const clock = { now: () => w.clock.now(), after: (ms: number, fn: () => void) => w.clock.after(Math.ceil(ms), fn) };
    w.network.cut("app");
    const attempting = Promise.withResolvers<void>();
    const net = w.network.fetchFor("app");
    const starting = startApp({ ...config, log_queue_limit: 1 }, { clock, fetch: (input, init) => { attempting.resolve(); return net(input, init); } });
    await w.complete(attempting.promise);
    await w.advance(2000);
    await new Promise(r => setTimeout(r, 60));
    mode = 6; hb();
    const fault = new common.GpsRawInt();
    Object.assign(fault, { timeUsec: 0n, fixType: 1 });
    out(fault);
    await new Promise(r => setTimeout(r, 60));
    await w.advance(2000);
    w.network.heal("app");
    const app = await w.complete(starting);
    try {
      await w.advance(2000);
      assert.ok(w.events.some(e => e.kind === "report.failsafe" && e.record.kind === "autopilot" && e.record.in_control), "takeover survives pre-registration overflow");
      assert.ok(w.events.some(e => e.kind === "report.status" && e.record.kind === "subsystem" && e.record.condition === "faulted"), "subsystem fault survives pre-registration overflow");
    } finally {
      await w.complete(app.stop());
    }
  },
});
