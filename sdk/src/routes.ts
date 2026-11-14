import type { ProtocolTypes as P } from "@atlas/protocol/types";
export type CallerKind = "account" | "asset" | "gateway" | "plugin";
type Spec = {
  method: string;
  path: string;
  who: readonly CallerKind[];
  body?: keyof P;
  secret?: true;
};
const accounts = ["account"] as const,
  readers = ["account", "plugin"] as const,
  reporters = ["asset", "gateway"] as const;
export const ROUTES = {
  about: {
    method: "GET",
    path: "/about",
    who: ["account", "asset", "gateway", "plugin"],
  },
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
  cancel: { method: "POST", path: "/tasks/:asset_id/:task_id/cancel", who: accounts },
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
  deleteObject: { method: "DELETE", path: "/objects/:object_id", who: accounts },
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
    secret: true,
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
    secret: true,
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
    secret: true,
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
    secret: true,
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
    secret: true,
  },
  provisionPlugin: {
    method: "POST",
    path: "/administration/plugins",
    who: accounts,
    secret: true,
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
    secret: true,
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
