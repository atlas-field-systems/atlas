import type { ProtocolTypes as P } from "@atlas/protocol/types";
export type CallerKind = "account" | "asset" | "gateway" | "plugin";
type Spec = { method: string; path: string; who: readonly CallerKind[]; body?: keyof P; secret?: true };
const A = ["account"] as const, R = ["account","plugin"] as const, L = ["asset","gateway"] as const;
export const ROUTES = {
  about: { method: "GET", path: "/about", who: ["account","asset","gateway","plugin"] },
  me: { method: "GET", path: "/administration/me", who: A },
  logout: { method: "POST", path: "/administration/logout", who: A },
  entities: { method: "GET", path: "/entities", who: R },
  assets: { method: "GET", path: "/entities/assets", who: R },
  asset: { method: "GET", path: "/entities/assets/:asset_id", who: ["account","plugin","asset","gateway"] },
  tasks: { method: "GET", path: "/tasks/:asset_id", who: A },
  sendTasks: { method: "POST", path: "/tasks/:asset_id", who: A, body: "requests.tasks" },
  changeSettings: { method: "PATCH", path: "/entities/assets/:asset_id/settings", who: A, body: "requests.settings" },
  cancel: { method: "POST", path: "/tasks/:asset_id/:task_id/cancel", who: A },
  observations: { method: "GET", path: "/entities/observations", who: R },
  tracks: { method: "GET", path: "/entities/tracks", who: R },
  track: { method: "GET", path: "/entities/tracks/:track_id", who: R },
  geofeatures: { method: "GET", path: "/entities/geofeatures", who: R },
  geofeature: { method: "GET", path: "/entities/geofeatures/:geofeature_id", who: R },
  createGeofeature: { method: "POST", path: "/entities/geofeatures", who: ["account","plugin","asset","gateway"], body: "requests.geofeature" },
  replaceGeofeature: { method: "PUT", path: "/entities/geofeatures/:geofeature_id", who: A, body: "requests.geofeature" },
  deleteGeofeature: { method: "DELETE", path: "/entities/geofeatures/:geofeature_id", who: A },
  register: { method: "POST", path: "/entities/assets", who: ["asset"], body: "requests.asset" },
  registerRadio: { method: "POST", path: "/entities/assets/radios", who: ["gateway"], body: "requests.radio" },
  describeAsset: { method: "PUT", path: "/entities/assets/:asset_id/description", who: ["gateway"], body: "description" },
  sendReports: { method: "POST", path: "/entities/assets/:asset_id/reports", who: L, body: "requests.reports" },
  putContact: { method: "PUT", path: "/entities/assets/:asset_id/contact", who: ["gateway"], body: "contact" },
  objects: { method: "GET", path: "/objects", who: R },
  object: { method: "GET", path: "/objects/:object_id", who: R },
  attachObject: { method: "PATCH", path: "/objects/:object_id", who: A, body: "requests.attach" },
  deleteObject: { method: "DELETE", path: "/objects/:object_id", who: A },
  describePlugin: { method: "PUT", path: "/plugins/:plugin_id/description", who: ["plugin"], body: "plugin.description" },
  callPlugin: { method: "POST", path: "/plugins/:plugin_id/actions/:action", who: A, body: "requests.plugin_call" },
  plugins: { method: "GET", path: "/plugins", who: A },
  pluginCall: { method: "GET", path: "/plugins/:plugin_id/calls/:event_id", who: A },
  answerPlugin: { method: "POST", path: "/plugins/:plugin_id/answers", who: ["plugin"] },
  addAccount: { method: "POST", path: "/administration/accounts", who: A, body: "requests.account", secret: true },
  removeAccount: { method: "DELETE", path: "/administration/accounts/:operator_id", who: A },
  createAssetKey: { method: "POST", path: "/administration/asset-keys", who: A, secret: true },
  removeAssetKey: { method: "DELETE", path: "/administration/asset-keys/:key_id", who: A },
  replaceAssetKey: { method: "POST", path: "/administration/asset-keys/:key_id/key", who: A, secret: true },
  removeAsset: { method: "DELETE", path: "/administration/assets/:asset_id", who: A },
  provisionGateway: { method: "POST", path: "/administration/gateways", who: A, secret: true },
  removeGateway: { method: "DELETE", path: "/administration/gateways/:gateway_id", who: A },
  replaceGatewayKey: { method: "POST", path: "/administration/gateways/:gateway_id/key", who: A, secret: true },
  provisionPlugin: { method: "POST", path: "/administration/plugins", who: A, secret: true },
  removePlugin: { method: "DELETE", path: "/administration/plugins/:plugin_id", who: A },
  replacePluginKey: { method: "POST", path: "/administration/plugins/:plugin_id/key", who: A, secret: true },
} as const satisfies Record<string, Spec>;
export type RouteName = keyof typeof ROUTES;
export type RouteBody<N extends RouteName> = N extends "answerPlugin" ? P["plugin.result"] | P["plugin.failure"] : typeof ROUTES[N] extends { body: infer B extends keyof P } ? P[B] : undefined;
export type Allowed<C extends CallerKind> = { [N in RouteName]: C extends typeof ROUTES[N]["who"][number] ? N : never }[RouteName];
export type Params = Record<string, string | number>;
export type Query = Record<string, string | number | boolean | undefined>;
