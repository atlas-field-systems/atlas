import type { ProtocolTypes } from "@atlas/protocol/types";
import type { ReadTx, Tx } from "./store/db.ts";
import { getEvent, settlement, unsettledRequests } from "./store/events.ts";
import type { AtlasEvent, Cursor } from "./store/events.ts";
import * as admin from "./pillars/administration.ts";
import * as entities from "./pillars/entities.ts";
import * as objects from "./pillars/objects.ts";
import { refuse } from "./api/errors.ts";

type PluginCall = ProtocolTypes["plugin.call"];
type Answer = ProtocolTypes["plugin.result"] | ProtocolTypes["plugin.failure"];
export function describe(
  tx: Tx,
  plugin_id: string,
  record: ProtocolTypes["plugin.description"],
): { event_id: number } {
  if (record.plugin_id !== plugin_id)
    refuse("invalid", "plugin_id must match the path");
  return admin.setPluginDescription(tx, record);
}
export function call(
  tx: Tx,
  plugin_id: string,
  action: string,
  body: ProtocolTypes["requests.plugin_call"],
  by: string,
): { event_id: number } {
  if (admin.pluginContact(tx, plugin_id).contact !== "online")
    refuse("plugin_offline", "Plugin is offline");
  const offered = admin
    .pluginDescription(tx, plugin_id)
    ?.actions.find((a) => a.action === action);
  if (!offered) refuse("not_supported", "Plugin does not offer this action");
  const problems = matchInputs(offered, body.inputs);
  if (problems.length)
    refuse(
      "invalid",
      problems.map((p) => `${p.path}: ${p.message}`).join("; "),
    );
  return {
    event_id: tx.append("plugin.called", {
      type: "plugin.call",
      time: tx.now,
      plugin_id,
      action,
      inputs: body.inputs,
      requested_by: by,
    }),
  };
}
export function matchInputs(
  action: ProtocolTypes["plugin.description"]["actions"][number],
  inputs: PluginCall["inputs"],
): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const [i, value] of inputs.entries()) {
    const spec = action.inputs.find((s) => s.input === value.input);
    if (
      !spec ||
      spec.input_kind !== value.kind ||
      seen.has(value.input) ||
      (value.kind === "choice" && !spec.choices?.includes(value.choice))
    )
      problems.push({
        path: `/inputs/${i}`,
        message: "Unknown, repeated, or mismatched input",
      });
    seen.add(value.input);
  }
  for (const spec of action.inputs)
    if (!spec.optional && !seen.has(spec.input))
      problems.push({ path: "/inputs", message: `Missing ${spec.input}` });
  return problems;
}
export function requireOpenCall(
  tx: ReadTx,
  plugin_id: string,
  id: number,
): AtlasEvent<"plugin.called"> {
  const event = getEvent(tx, id);
  if (
    !event ||
    event.kind !== "plugin.called" ||
    event.record.plugin_id !== plugin_id
  )
    refuse("not_found", "No such call for this Plugin");
  if (settlement(tx, id).state !== "unsettled")
    refuse("call_settled", "Call already answered or dropped");
  return event;
}
export function answer(
  tx: Tx,
  plugin_id: string,
  record: Answer,
): { event_id: number } {
  if (record.plugin_id !== plugin_id)
    refuse("invalid", "plugin_id must match the path");
  requireOpenCall(tx, plugin_id, record.request_id);
  for (const id of record.geofeature_ids ?? [])
    if (!entities.createdFor(tx, id, record.request_id))
      refuse("invalid", "Geo feature was not created by this call");
  const ids = [...(record.object_ids ?? [])];
  if (record.type === "plugin.result")
    for (const place of record.places ?? [])
      if (place.kind === "imagery") ids.push(place.object_id);
  for (const id of ids)
    if (!objects.createdFor(tx, id, record.request_id))
      refuse("invalid", "Object was not created by this call");
  return {
    event_id:
      record.type === "plugin.result"
        ? tx.append("plugin.result", record)
        : tx.append("plugin.failed", record),
  };
}
export function list(tx: ReadTx) {
  return {
    as_of: tx.asOf(),
    items: admin
      .listPlugins(tx)
      .map((p) => ({
        ...p,
        unanswered: unsettledRequests(tx, { plugin_id: p.plugin_id }),
      })),
  };
}
export type CallEntry = {
  call: AtlasEvent<"plugin.called">;
  answer: AtlasEvent<
    "plugin.result" | "plugin.failed" | "plugin.dropped"
  > | null;
};
export function getCall(
  tx: ReadTx,
  plugin_id: string,
  event_id: number,
): CallEntry {
  const call = getEvent(tx, event_id);
  if (
    !call ||
    call.kind !== "plugin.called" ||
    call.record.plugin_id !== plugin_id
  )
    refuse("not_found", "No such call");
  const settled = settlement(tx, event_id);
  if (settled.state === "unsettled") return { call, answer: null };
  const answer = settled.by;
  if (
    answer.kind !== "plugin.result" &&
    answer.kind !== "plugin.failed" &&
    answer.kind !== "plugin.dropped"
  )
    throw new Error("Invalid Plugin settlement");
  return { call, answer };
}
export function calls(
  tx: ReadTx,
  plugin_id: string,
  cursor: Cursor | null,
  limit: number,
) {
  const before = cursor === null ? Number.MAX_SAFE_INTEGER : Number(cursor);
  if (
    !Number.isSafeInteger(before) ||
    before < 1 ||
    !Number.isInteger(limit) ||
    limit < 1
  )
    refuse("invalid", "Invalid page");
  const size = Math.min(1000, limit);
  const rows = tx.all<{ event_id: number }>(
    "SELECT event_id FROM events WHERE run_id=? AND plugin_id=? AND kind='plugin.called' AND event_id<? ORDER BY event_id DESC LIMIT ?",
    tx.runId,
    plugin_id,
    before,
    size + 1,
  );
  const items = rows
    .slice(0, size)
    .map((r) => getCall(tx, plugin_id, r.event_id));
  return {
    as_of: tx.asOf(),
    items,
    next_cursor:
      rows.length > size ? String(items.at(-1)!.call.event_id) : null,
  };
}
