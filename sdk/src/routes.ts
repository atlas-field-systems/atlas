import type { AtlasEvent } from "./stream.ts";
import type { AssetView } from "./picture.ts";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
export type CallerKind = "account" | "asset" | "gateway" | "plugin";
type Spec = {
  method: string;
  path: string;
  who: readonly CallerKind[];
  body?: keyof P;
};
const accounts = ["account"] as const,
  readers = ["account", "plugin"] as const,
  reporters = ["asset", "gateway"] as const;
export const ROUTES = {
  me: { method: "GET", path: "/administration/me", who: accounts },
  logout: { method: "POST", path: "/administration/logout", who: accounts },
  entities: { method: "GET", path: "/entities", who: readers },
  assets: { method: "GET", path: "/entities/assets", who: readers },
  asset: {
    method: "GET",
    path: "/entities/assets/:asset_id",
    who: ["account", "plugin", "asset", "gateway"],
  },
  tasks: { method: "GET", path: "/tasks/:asset_id", who: accounts },
  sendTasks: {
    method: "POST",
    path: "/tasks/:asset_id",
    who: accounts,
    body: "requests.tasks",
  },
  changeSettings: {
    method: "PATCH",
    path: "/entities/assets/:asset_id/settings",
    who: accounts,
    body: "requests.settings",
  },
  cancel: {
    method: "POST",
    path: "/tasks/:asset_id/:task_id/cancel",
    who: accounts,
  },
  observations: { method: "GET", path: "/entities/observations", who: readers },
  tracks: { method: "GET", path: "/entities/tracks", who: readers },
  track: { method: "GET", path: "/entities/tracks/:track_id", who: readers },
  geofeatures: { method: "GET", path: "/entities/geofeatures", who: readers },
  geofeature: {
    method: "GET",
    path: "/entities/geofeatures/:geofeature_id",
    who: readers,
  },
  createGeofeature: {
    method: "POST",
    path: "/entities/geofeatures",
    who: ["account", "plugin", "asset", "gateway"],
    body: "requests.geofeature",
  },
  replaceGeofeature: {
    method: "PUT",
    path: "/entities/geofeatures/:geofeature_id",
    who: accounts,
    body: "requests.geofeature",
  },
  deleteGeofeature: {
    method: "DELETE",
    path: "/entities/geofeatures/:geofeature_id",
    who: accounts,
  },
  register: {
    method: "POST",
    path: "/entities/assets",
    who: ["asset"],
    body: "requests.asset",
  },
  registerRadio: {
    method: "POST",
    path: "/entities/assets/radios",
    who: ["gateway"],
    body: "requests.radio",
  },
  describeAsset: {
    method: "PUT",
    path: "/entities/assets/:asset_id/description",
    who: ["gateway"],
    body: "description",
  },
  sendReports: {
    method: "POST",
    path: "/entities/assets/:asset_id/reports",
    who: reporters,
    body: "requests.reports",
  },
  putContact: {
    method: "PUT",
    path: "/entities/assets/:asset_id/contact",
    who: ["gateway"],
    body: "contact",
  },
  objects: { method: "GET", path: "/objects", who: readers },
  object: { method: "GET", path: "/objects/:object_id", who: readers },
  attachObject: {
    method: "PATCH",
    path: "/objects/:object_id",
    who: accounts,
    body: "requests.attach",
  },
  deleteObject: {
    method: "DELETE",
    path: "/objects/:object_id",
    who: accounts,
  },
  describePlugin: {
    method: "PUT",
    path: "/plugins/:plugin_id/description",
    who: ["plugin"],
    body: "plugin.description",
  },
  callPlugin: {
    method: "POST",
    path: "/plugins/:plugin_id/actions/:action",
    who: accounts,
    body: "requests.plugin_call",
  },
  plugins: { method: "GET", path: "/plugins", who: accounts },
  pluginCall: {
    method: "GET",
    path: "/plugins/:plugin_id/calls/:event_id",
    who: accounts,
  },
  answerPlugin: {
    method: "POST",
    path: "/plugins/:plugin_id/answers",
    who: ["plugin"],
  },
  addAccount: {
    method: "POST",
    path: "/administration/accounts",
    who: accounts,
    body: "requests.account",
  },
  removeAccount: {
    method: "DELETE",
    path: "/administration/accounts/:operator_id",
    who: accounts,
  },
  createAssetKey: {
    method: "POST",
    path: "/administration/asset-keys",
    who: accounts,
  },
  removeAssetKey: {
    method: "DELETE",
    path: "/administration/asset-keys/:key_id",
    who: accounts,
  },
  replaceAssetKey: {
    method: "POST",
    path: "/administration/asset-keys/:key_id/key",
    who: accounts,
  },
  removeAsset: {
    method: "DELETE",
    path: "/administration/assets/:asset_id",
    who: accounts,
  },
  provisionGateway: {
    method: "POST",
    path: "/administration/gateways",
    who: accounts,
  },
  removeGateway: {
    method: "DELETE",
    path: "/administration/gateways/:gateway_id",
    who: accounts,
  },
  replaceGatewayKey: {
    method: "POST",
    path: "/administration/gateways/:gateway_id/key",
    who: accounts,
  },
  provisionPlugin: {
    method: "POST",
    path: "/administration/plugins",
    who: accounts,
  },
  removePlugin: {
    method: "DELETE",
    path: "/administration/plugins/:plugin_id",
    who: accounts,
  },
  replacePluginKey: {
    method: "POST",
    path: "/administration/plugins/:plugin_id/key",
    who: accounts,
  },
} as const satisfies Record<string, Spec>;
export type RouteName = keyof typeof ROUTES;
export type RouteBody<N extends RouteName> = N extends "answerPlugin"
  ? P["plugin.result"] | P["plugin.failure"]
  : (typeof ROUTES)[N] extends { body: infer B extends keyof P }
    ? P[B]
    : undefined;
export type Allowed<C extends CallerKind> = {
  [N in RouteName]: C extends (typeof ROUTES)[N]["who"][number] ? N : never;
}[RouteName];
export type Params = Record<string, string | number>;
export type Query = Record<string, string | number | boolean | undefined>;

export type TaskView = {
  task: P["task"];
  state:
    | "sent"
    | "queued"
    | "active"
    | "completed"
    | "failed"
    | "cancelled"
    | "dropped";
  state_time: number;
  object_ids?: string[];
};
export type CallEntry = {
  call: AtlasEvent<"plugin.called">;
  answer: AtlasEvent<
    "plugin.result" | "plugin.failed" | "plugin.dropped"
  > | null;
};
type Cut<T> = { as_of: number; items: T[] };
type EventAck = { event_id: number };
type PlaceAck = EventAck & { geofeature: P["geofeature"] };
type Empty = Record<string, never>;
type Issue<K extends string> = Record<K, string> &
  ({ key: string } | { issued: true } | { replaced: true });
type Responses = {
  me: { operator_id: string; admin: boolean };
  logout: Empty;
  entities: {
    as_of: number;
    assets: AssetView[];
    observations: P["report.observation"][];
    tracks: P["track"][];
    geofeatures: P["geofeature"][];
  };
  assets: Cut<AssetView> & { gateways: P["contact"][] };
  asset: { as_of: number; item: AssetView };
  tasks: Cut<TaskView> & { held: number[] };
  sendTasks: EventAck & { task_ids: number[] };
  changeSettings: EventAck;
  cancel: EventAck;
  observations: Cut<P["report.observation"]>;
  tracks: Cut<P["track"]>;
  track: { as_of: number; item: P["track"] };
  geofeatures: Cut<P["geofeature"]>;
  geofeature: { as_of: number; item: P["geofeature"] };
  createGeofeature: PlaceAck;
  replaceGeofeature: PlaceAck & {
    updated_task_ids?: { asset_id: string; task_id: number }[];
    not_updated_task_ids?: { asset_id: string; task_id: number }[];
  };
  deleteGeofeature: EventAck;
  register: { asset_id: string; as_of: number; last_task_id: number };
  registerRadio: { asset_id: string; as_of: number };
  describeAsset: EventAck;
  sendReports: { stored: number };
  putContact: { changed: boolean };
  objects: Cut<P["object"]>;
  object: P["object"];
  attachObject: EventAck;
  deleteObject: EventAck;
  describePlugin: EventAck;
  callPlugin: EventAck;
  plugins: Cut<{
    plugin_id: string;
    description: P["plugin.description"] | null;
    contact: P["contact"];
    unanswered: number[];
  }>;
  pluginCall: CallEntry;
  answerPlugin: EventAck;
  addAccount: { operator_id: string };
  removeAccount: Empty;
  createAssetKey: Issue<"key_id">;
  removeAssetKey: Empty;
  replaceAssetKey: Issue<"key_id">;
  removeAsset: EventAck;
  provisionGateway: Issue<"gateway_id">;
  removeGateway: EventAck;
  replaceGatewayKey: Issue<"gateway_id">;
  provisionPlugin: Issue<"plugin_id">;
  removePlugin: EventAck;
  replacePluginKey: Issue<"plugin_id">;
};
export type ResponseOf<N extends RouteName> = Responses[N];
