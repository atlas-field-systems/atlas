import { createConnection, type Socket } from "node:net";
import { z } from "zod";
import { loadPackagedProtocol } from "@atlas/protocol";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
import type { AssetFile, Clock } from "@atlas/sdk";
import type { Config } from "./config.ts";
import type { Vehicle, Measurements } from "./vehicle.ts";
const protocol = await loadPackagedProtocol();
type WithoutIdentity<T> = T extends unknown ? Omit<T, "asset_id"> : never;
export type Observation = WithoutIdentity<P["report.observation"]>;
const input = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("position"), source: z.string().min(1), time: z.number().nonnegative(), valid: z.boolean(),
    position: z.custom<P["report.telemetry"]["position"]>(value => protocol.check("report.telemetry", {
      type: "report.telemetry", asset_id: "A", time: 0, position: value,
    }).ok).optional() }),
  z.strictObject({ kind: z.literal("observation"), source: z.string().min(1),
    observation: z.custom<Observation>(value => value !== null && typeof value === "object" &&
      protocol.check("report.observation", { ...value, asset_id: "A" }).ok) }),
  z.strictObject({ kind: z.literal("file"), name: z.string().min(1), contentType: z.string().min(1), base64: z.base64(),
    place: z.custom<P["requests.geofeature"]>(value => protocol.check("requests.geofeature", value).ok).optional() }),
]);
const gps = z.object({
  class: z.literal("TPV"), mode: z.number().int().min(0).max(3),
  device: z.string().optional(), time: z.iso.datetime({ offset: true }).optional(),
  lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(),
  altMSL: z.number().finite().optional(),
});
export function peripheral(
  config: Extract<Config["equipment"], { kind: "peripheral" | "gpsd" }>, clock: Clock,
  output: { observation(value: Observation, source: string): void; file(value: AssetFile): Promise<void>; diagnostic(value: unknown): void },
): Vehicle {
  let socket: Socket | undefined;
  let observe: (value: Measurements) => void;
  let stopped = false;
  let retryAt = 0;
  let reading: Promise<void> | undefined;
  function connect() {
    const connection = createConnection({ host: config.host, port: config.port });
    socket = connection;
    if (config.kind === "gpsd") connection.on("connect", () => connection.write('?WATCH={"enable":true,"json":true};\n'));
    output.diagnostic({ kind: "peripheral_connecting", time: clock.now() });
    connection.on("error", error => output.diagnostic({ kind: "peripheral_error", time: clock.now(), explanation: error.message }));
    connection.on("close", () => { if (socket === connection) socket = undefined; retryAt = clock.now() + config.reconnect_s * 1000; });
    reading = (async () => {
      let pending = Buffer.alloc(0);
      for await (const chunk of connection) {
        pending = Buffer.concat([pending, Buffer.from(chunk)]);
        let end: number;
        while ((end = pending.indexOf(10)) >= 0) {
          if (end > config.max_message_bytes) throw new Error("peripheral message exceeds configured limit");
          const line = pending.subarray(0, end).toString("utf8");
          pending = pending.subarray(end + 1);
          const decoded: unknown = JSON.parse(line);
          if (stopped) return;
          if (config.kind === "gpsd") {
            const header = z.object({ class: z.string() }).parse(decoded);
            if (header.class !== "TPV") continue;
            const fix = gps.parse(decoded);
            observe({ position: fix.mode >= 2 && fix.lat !== undefined && fix.lon !== undefined ? {
              value: { latitude: fix.lat, longitude: fix.lon,
                ...(fix.mode === 3 && fix.altMSL !== undefined ? { altitudes: [{ altitude_m: fix.altMSL, altitude_reference: "msl" as const }] } : {}) },
              source: fix.device ?? null, time: fix.time ? Date.parse(fix.time) : null,
            } : undefined });
            continue;
          }
          const event = input.parse(decoded);
          switch (event.kind) {
            case "position":
              observe({ position: event.valid && event.position ? { value: event.position, source: event.source, time: event.time } : undefined });
              break;
            case "observation": output.observation(event.observation, event.source); break;
            case "file": await output.file({ name: event.name, contentType: event.contentType, bytes: Buffer.from(event.base64, "base64"), place: event.place }); break;
          }
        }
        if (pending.length > config.max_message_bytes) throw new Error("peripheral message exceeds configured limit");
      }
    })().catch(error => {
      output.diagnostic({ kind: "peripheral_failed", time: clock.now(), explanation: String(error) });
      connection.destroy();
    });
  }
  return {
    start(callback) { observe = callback; connect(); },
    tick(now) { if (!stopped && !socket && now >= retryAt) connect(); },
    async command() { throw new Error("acquisition equipment does not move"); },
    async stop() { stopped = true; socket?.destroy(); await reading; },
  };
}
