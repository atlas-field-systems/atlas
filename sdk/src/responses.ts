import { EVENT_KINDS } from "@atlas/core/event-kinds";
import type { Protocol } from "@atlas/protocol/browser";
import type { RouteName } from "./routes.ts";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const string = (value: unknown) =>
  typeof value === "string" && value.length > 0;
const list = (value: unknown, valid: (item: unknown) => boolean) =>
  Array.isArray(value) && value.every(valid);

export type ReplyKind =
  | RouteName
  | "login"
  | "about"
  | "upload"
  | "historyPage"
  | "trackPage"
  | "placePage"
  | "callPage";

export function validReply(
  protocol: Protocol,
  kind: ReplyKind,
  body: unknown,
): boolean {
  if (!object(body)) return false;
  const record = (name: string) => (value: unknown) =>
    protocol.check(name, value).ok;
  const entries = (value: unknown, valid: (item: unknown) => boolean) =>
    object(value) && Object.values(value).every(valid);
  const asset = (a: unknown) =>
    object(a) &&
    string(a.asset_id) &&
    (a.gateway_id === null || string(a.gateway_id)) &&
    (a.description === null || record("description")(a.description)) &&
    record("contact")(a.contact) &&
    object(a.reports) &&
    Object.entries(a.reports).every(
      ([name, r]) =>
        name.startsWith("report.") &&
        protocol.names.includes(name) &&
        record(name)(r),
    ) &&
    object(a.settings) &&
    Object.entries(a.settings).every(
      ([name, s]) =>
        object(s) &&
        count(s.time) &&
        record("requests.settings")({ settings: { [name]: s.value } }),
    ) &&
    entries(a.subsystems, record("report.status")) &&
    entries(a.gimbals, record("report.gimbal"));
  const cut = (valid: (item: unknown) => boolean) =>
    count(body.as_of) && list(body.items, valid);
  const event = (e: unknown, accepts: (name: string) => boolean) => {
    if (
      !object(e) ||
      !count(e.event_id) ||
      !count(e.time) ||
      typeof e.kind !== "string" ||
      !accepts(e.kind) ||
      !Object.hasOwn(EVENT_KINDS, e.kind)
    )
      return false;
    const spec = EVENT_KINDS[e.kind as keyof typeof EVENT_KINDS];
    return "many" in spec
      ? list(e.record, record(spec.record))
      : record(spec.record)(e.record);
  };
  const call = (v: unknown) =>
    object(v) &&
    event(v.call, (k) => k === "plugin.called") &&
    (v.answer === null ||
      event(v.answer, (k) =>
        ["plugin.result", "plugin.failed", "plugin.dropped"].includes(k),
      ));
  const page = (valid: (item: unknown) => boolean) =>
    cut(valid) && (body.next_cursor === null || string(body.next_cursor));
  const ack = count(body.event_id);
  const issue = (key: string) =>
    string(body[key]) &&
    (string(body.key) || body.issued === true || body.replaced === true);
  switch (kind) {
    case "about":
      return (
        count(body.run_id) &&
        string(body.definitions_hash) &&
        string(body.core_version) &&
        string(body.protocol_version) &&
        typeof body.stream_keepalive_s === "number" &&
        Number.isFinite(body.stream_keepalive_s) &&
        body.stream_keepalive_s > 0
      );
    case "entities":
      return (
        count(body.as_of) &&
        list(body.assets, asset) &&
        list(body.observations, record("report.observation")) &&
        list(body.tracks, record("track")) &&
        list(body.geofeatures, record("geofeature"))
      );
    case "assets":
      return cut(asset) && list(body.gateways, record("contact"));
    case "asset":
      return count(body.as_of) && asset(body.item);
    case "tasks":
      return (
        list(body.held, count) &&
        cut(
          (t) =>
            object(t) &&
            record("task")(t.task) &&
            [
              "sent",
              "queued",
              "active",
              "completed",
              "failed",
              "cancelled",
              "dropped",
            ].some((state) => state === t.state) &&
            count(t.state_time) &&
            (t.object_ids === undefined || list(t.object_ids, string)),
        )
      );
    case "sendTasks":
      return ack && list(body.task_ids, count);
    case "register":
    case "registerRadio":
      return (
        string(body.asset_id) && count(body.as_of) && count(body.last_task_id)
      );
    case "describeAsset":
      return count(body.as_of) && count(body.last_task_id) && ack;
    case "sendReports":
      return count(body.stored);
    case "putContact":
      return typeof body.changed === "boolean";
    case "observations":
      return cut(record("report.observation"));
    case "tracks":
      return cut(record("track"));
    case "track":
      return count(body.as_of) && record("track")(body.item);
    case "geofeatures":
      return cut(record("geofeature"));
    case "geofeature":
      return count(body.as_of) && record("geofeature")(body.item);
    case "createGeofeature":
    case "replaceGeofeature":
      return (
        ack &&
        record("geofeature")(body.geofeature) &&
        [body.updated_task_ids, body.not_updated_task_ids].every(
          (v) =>
            v === undefined ||
            list(v, (t) => object(t) && string(t.asset_id) && count(t.task_id)),
        )
      );
    case "objects":
      return cut(record("object"));
    case "object":
      return record("object")(body);
    case "upload":
      return ack && string(body.object_id);
    case "plugins":
      return cut(
        (p) =>
          object(p) &&
          string(p.plugin_id) &&
          record("contact")(p.contact) &&
          (p.description === null ||
            record("plugin.description")(p.description)) &&
          list(p.unanswered, count),
      );
    case "pluginCall":
      return call(body);
    case "callPage":
      return page(call);
    case "historyPage":
      return page((e) => event(e, (k) => k.startsWith("report.")));
    case "trackPage":
      return page((e) =>
        event(e, (k) => k === "track.updated" || k === "track.removed"),
      );
    case "placePage":
      return page((e) => event(e, (k) => k.startsWith("geofeature.")));
    case "me":
      return string(body.operator_id) && typeof body.admin === "boolean";
    case "addAccount":
      return string(body.operator_id);
    case "createAssetKey":
    case "replaceAssetKey":
      return issue("key_id");
    case "provisionGateway":
    case "replaceGatewayKey":
      return issue("gateway_id");
    case "provisionPlugin":
    case "replacePluginKey":
      return issue("plugin_id");
    case "login":
      return string(body.operator_id) && body.logged_in === true;
    case "logout":
    case "removeAccount":
    case "removeAssetKey":
      return true;
    case "changeSettings":
    case "cancel":
    case "deleteGeofeature":
    case "attachObject":
    case "deleteObject":
    case "describePlugin":
    case "callPlugin":
    case "answerPlugin":
    case "removeAsset":
    case "removeGateway":
    case "removePlugin":
      return ack;
  }
}
