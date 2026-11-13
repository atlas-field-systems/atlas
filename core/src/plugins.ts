/**
 * The Plugin interface (api.md#plugins). Not a pillar: it owns no table.
 * Plugin keys, descriptions, and contact live in Administration's `plugins`
 * table; calls and answers are only events (pillars.md). A call is a request
 * in store/events.ts terms, so "unanswered", "already answered", and "dropped"
 * are the same settlement rule Tasks use.
 */
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { ReadTx, Tx } from "./store/db.ts";
import type { AtlasEvent, Cursor } from "./store/events.ts";

type PluginCall = ProtocolTypes["plugin.call"];
type Answer = ProtocolTypes["plugin.result"] | ProtocolTypes["plugin.failure"];

/** PUT /plugins/{plugin_id}/description, that Plugin. Checked as plugin.description (400); plugin_id must match. */
export function describe(
  tx: Tx,
  plugin_id: string,
  record: ProtocolTypes["plugin.description"],
): { event_id: number } {
  throw new Error("not implemented");
}

/**
 * POST /plugins/{plugin_id}/actions/{action}, an account, body requests.plugin_call.
 *   Plugin exists (404); online (409 plugin_offline, nothing waits);
 *   description lists the action (409 not_supported);
 *   matchInputs(action, body.inputs) problems → 400 invalid;
 *   record = {type: 'plugin.call', time, plugin_id, action, inputs, requested_by: by}
 *   → plugin.called; its event_id names the call. 202 {event_id}.
 */
export function call(
  tx: Tx,
  plugin_id: string,
  action: string,
  body: ProtocolTypes["requests.plugin_call"],
  by: string,
): { event_id: number } {
  throw new Error("not implemented");
}

/**
 * Pure (api.md#operators-call-actions): each value names one of the action's
 * inputs with the same kind; a choice is one the Plugin listed; every input not
 * marked optional is given exactly once. Returns problems as {path, message}.
 */
export function matchInputs(
  action: ProtocolTypes["plugin.description"]["actions"][number],
  inputs: PluginCall["inputs"],
): { path: string; message: string }[] {
  throw new Error("not implemented");
}

/**
 * POST /plugins/{plugin_id}/answers, that Plugin, one plugin.result or
 * plugin.failure (checked by its `type`; 400). The call must exist and be
 * addressed to this Plugin (404) and be unsettled (409 call_settled: answered
 * or dropped). Adds plugin.result or plugin.failed. 200 {event_id}.
 */
export function answer(
  tx: Tx,
  plugin_id: string,
  record: Answer,
): { event_id: number } {
  throw new Error("not implemented");
}

/** GET /plugins: every Plugin with description, contact, and its unsettled calls; as_of. */
export function list(tx: ReadTx): {
  as_of: number;
  items: {
    plugin_id: string;
    description: ProtocolTypes["plugin.description"] | null;
    contact: ProtocolTypes["contact"];
    unanswered: AtlasEvent<"plugin.called">[];
  }[];
} {
  throw new Error("not implemented");
}
export type CallEntry = {
  call: AtlasEvent<"plugin.called">;
  answer: AtlasEvent<
    "plugin.result" | "plugin.failed" | "plugin.dropped"
  > | null;
};
/** GET /plugins/{plugin_id}/calls, newest first, ≤ 1000 per page. */
export function calls(
  tx: ReadTx,
  plugin_id: string,
  cursor: Cursor | null,
  limit: number,
): { as_of: number; items: CallEntry[]; next_cursor: Cursor | null } {
  throw new Error("not implemented");
}
/** GET /plugins/{plugin_id}/calls/{event_id}. */
export function getCall(
  tx: ReadTx,
  plugin_id: string,
  event_id: number,
): CallEntry {
  throw new Error("not implemented");
}
