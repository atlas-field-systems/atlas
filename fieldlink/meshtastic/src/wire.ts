import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { Protocol } from "@atlas/protocol";
import type { AssetEvent, Report } from "@atlas/sdk";
import type { Description, Registration } from "./gateway-host.ts";
import { z } from "zod";

export const frameBytes = 180;
// Two relayed ShortTurbo reply frames fit the existing reply window.
export const maxReplyFrames = 2;
const header = 11;
const chunkBytes = frameBytes - header;
const maxParts = 24;
const maxJson = 128 * 1024;
const marker = 0x42;
// Both hosts supply these common JSON strings locally. The marker identifies
// the format and dictionary together.
const dictionary = Buffer.from(
  '{"kind":"reply","session":"","seq":,"boot":"","cursor":,"submission":{"id":,"reports":[' +
  '{"type":"report.status","asset_id":"","time":,"kind":"queue","task_ids":[],"request_id":},' +
  '{"type":"report.status","asset_id":"","time":,"kind":"task","task_id":,"task_state":"active"},' +
  '{"type":"report.status","asset_id":"","time":,"kind":"task","task_id":,"task_state":"completed"},' +
  '{"type":"report.settings","asset_id":"","time":,"settings":{"run_state":"paused","link_loss_after_s":}},' +
  '{"type":"report.telemetry","asset_id":"","time":,"position":{"latitude":,"longitude":}}]}}' +
  '{"kind":"poll","session":"","seq":,"boot":"","receipt":,"event":' +
  '{"kind":"tasks.requested","event_id":,"record":[{"kind":"settings","settings":{"run_state":"paused"},' +
  '"time":,"asset_id":"","task_id":,"send_last":,"requested_by":"ADM"}]}}' +
  '{"kind":"profile","session":"","seq":,"boot":"","hash":"sha256:","description":{"entity_type":"drone",' +
  '"commands":["takeoff","move_to","land","hold","return_to_home","failsafe"],' +
  '"reports":["telemetry","battery","status","settings","failsafe"],' +
  '"settings":["run_state","home_position","failsafe_policy","link_loss_after_s"]}}',
);
const token = z.string().regex(/^[a-f0-9]{16}$/);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const submitted = z.object({ id: counter, reports: z.array(z.unknown()).max(1000) });
const registration = z.object({
  run: counter, assetId: z.string().regex(/^[A-Za-z0-9]{1,4}$/), after: counter, lastTaskId: counter,
}) satisfies z.ZodType<Registration>;
const turn = { session: token, seq: counter, boot: token };
const envelope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("register"), ...turn }),
  z.object({
    kind: z.literal("profile"), ...turn,
    hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), description: z.unknown(), resume: registration.optional(),
  }),
  z.object({ kind: z.literal("registered"), ...turn, registration }),
  z.object({ kind: z.literal("refused"), ...turn, reason: z.enum(["definitions", "removed"]) }),
  z.object({
    kind: z.literal("poll"), ...turn,
    roomBytes: counter.positive().max(frameBytes),
    receipt: z.object({ kind: z.enum(["stored", "refused"]), id: counter }).optional(),
    event: z.unknown().optional(),
  }),
  z.object({ kind: z.literal("reply"), ...turn, cursor: counter, waiting: z.literal(true).optional(), submission: submitted.optional() }),
]);
export type Envelope = z.infer<typeof envelope>;

export function isDescription(protocol: Protocol, value: unknown): value is Description {
  return protocol.check("requests.asset", value).ok;
}

export function isReport(protocol: Protocol, value: unknown): value is Report {
  return typeof value === "object" && value !== null && "type" in value &&
    typeof value.type === "string" && value.type.startsWith("report.") &&
    protocol.names.includes(value.type) && protocol.check(value.type, value).ok;
}

const eventEnvelope = z.object({ kind: z.string(), event_id: counter, record: z.unknown() });
export function isEvent(protocol: Protocol, assetId: string, value: unknown): value is AssetEvent {
  const parsed = eventEnvelope.safeParse(value);
  if (!parsed.success) return false;
  const { kind, record } = parsed.data;
  const belongsToAsset = (item: unknown) =>
    typeof item === "object" && item !== null && "asset_id" in item && item.asset_id === assetId;
  switch (kind) {
    case "tasks.requested":
    case "tasks.updated":
      return Array.isArray(record) && record.length > 0 && (kind === "tasks.updated" || record.length <= 64) &&
        record.every(task => belongsToAsset(task) && protocol.check("task", task).ok);
    case "cancel.requested": return belongsToAsset(record) && protocol.check("cancel", record).ok;
    case "task.dropped": return belongsToAsset(record) && typeof record === "object" && record !== null &&
      "task_id" in record && protocol.check("drop", record).ok;
    case "settings.requested": return belongsToAsset(record) && protocol.check("settings_change", record).ok;
    default: return false;
  }
}

function compressed(message: Envelope) {
  const body = Buffer.from(JSON.stringify(message));
  if (body.length > maxJson) return;
  const data = deflateRawSync(body, { dictionary });
  if (data.length <= chunkBytes * maxParts) return data;
}

export function wireSize(message: Envelope) {
  const data = compressed(message);
  if (!data) return Infinity;
  return data.length + header * Math.ceil(data.length / chunkBytes);
}

export function encodeFrames(message: Envelope, id: Buffer) {
  const data = compressed(message);
  if (!data) throw new RangeError("Fieldlink message exceeds its transfer limit");
  const parts = Math.ceil(data.length / chunkBytes);
  return Array.from({ length: parts }, (_, index) => Buffer.concat([
    Buffer.from([marker]), id, Buffer.from([index, parts]),
    data.subarray(index * chunkBytes, (index + 1) * chunkBytes),
  ]));
}

export function readFrame(raw: Uint8Array) {
  if (raw[0] !== marker || raw.length <= header || raw.length > frameBytes) return;
  const index = raw[9], total = raw[10];
  if (!total || total > maxParts || index >= total || (index + 1 < total && raw.length !== frameBytes)) return;
  return { id: Buffer.from(raw.subarray(1, 9)).toString("hex"), total, index, body: raw.subarray(header) };
}

export function decodeFrames(chunks: Uint8Array[]): Envelope | undefined {
  let value: unknown;
  try {
    value = JSON.parse(inflateRawSync(Buffer.concat(chunks), {
      dictionary, maxOutputLength: maxJson,
    }).toString());
  } catch {
    return;
  }
  const parsed = envelope.safeParse(value);
  if (parsed.success) return parsed.data;
}
