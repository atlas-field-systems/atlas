import type { Store } from "../store/db.ts";
import { refuse } from "./errors.ts";
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { ReadTx, Tx } from "../store/db.ts";
import type { Principal, Who, ActsFor } from "./auth.ts";
import * as entities from "../pillars/entities.ts";
import * as tasks from "../pillars/tasks.ts";
import * as objects from "../pillars/objects.ts";
import * as admin from "../pillars/administration.ts";
import * as plugins from "../plugins.ts";
import type { Issued } from "../pillars/administration.ts";

export type Req<B = undefined> = {
  params: Record<string, string>;
  query: URLSearchParams;
  body: B;
  who: Principal;
};
export type Reply = {
  status: 200 | 201 | 202 | 409;
  body: unknown;
  headers?: Record<string, string>;
};

export type CoreBodies = {
  login: ProtocolTypes["requests.login"];
  account: ProtocolTypes["requests.account"];
  reports: ProtocolTypes["requests.reports"]; // each report is checked by its own `type` in storeReports
  attach: ProtocolTypes["requests.attach"];
  answer: ProtocolTypes["plugin.result"] | ProtocolTypes["plugin.failure"]; // checked by its `type`
};
export type BodySpec =
  | { kind: "none" }
  | { kind: "protocol"; name: keyof ProtocolTypes }
  | { kind: "core"; name: keyof CoreBodies }
  | { kind: "file" };

type Common = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  doc: string;
  who: readonly Who[];
  actsFor?: ActsFor;
};

export type ReadRoute = Common & {
  kind: "read";
  serve: (tx: ReadTx, req: Req) => unknown;
};
export type StreamRoute = Common & { kind: "stream" };
export type FileRoute = Common & {
  kind: "file";
  serve: (
    tx: ReadTx,
    req: Req,
  ) => { path: string; content_type: string; size_bytes: number };
};
export type ChangeRoute = Common & {
  kind: "change";
  body: BodySpec;
  prepare?: (req: Req<any>, store: Store) => Promise<unknown>;
  commit: (
    tx: Tx,
    req: Req<any>,
    prepared: any,
  ) => Reply | { first: Reply; ack: Reply };
  secret: boolean;
};
export type Route = ReadRoute | StreamRoute | FileRoute | ChangeRoute;

type Body<S> = S extends {
  kind: "protocol";
  name: infer N extends keyof ProtocolTypes;
}
  ? ProtocolTypes[N]
  : S extends { kind: "core"; name: infer N extends keyof CoreBodies }
    ? CoreBodies[N]
    : S extends { kind: "file" }
      ? objects.ReceivedFile
      : undefined;

function read(r: Omit<ReadRoute, "kind">): ReadRoute {
  return { kind: "read", ...r };
}
function change<S extends BodySpec, P = undefined>(
  r: Common & {
    body: S;
    prepare?: (req: Req<Body<S>>, store: Store) => Promise<P>;
    commit: (tx: Tx, req: Req<Body<S>>, prepared: P) => Reply;
  },
): ChangeRoute {
  return { kind: "change", secret: false, ...r };
}
function secret<S extends BodySpec, P = undefined>(
  r: Common & {
    body: S;
    prepare?: (req: Req<Body<S>>, store: Store) => Promise<P>;
    commit: (
      tx: Tx,
      req: Req<Body<S>>,
      prepared: P,
    ) => { first: Reply; ack: Reply };
  },
): ChangeRoute {
  return { kind: "change", secret: true, ...r };
}
const issued = <A, K>(status: 200 | 201, i: Issued<A, K>) => ({
  first: { status, body: i.shown },
  ack: { status, body: i.ack },
});

const ok = (body: unknown): Reply => ({ status: 200, body });
const created = (body: unknown): Reply => ({ status: 201, body });
const accepted = (body: unknown): Reply => ({ status: 202, body });
const P = <N extends keyof ProtocolTypes>(name: N) =>
  ({ kind: "protocol", name }) as const;
const C = <N extends keyof CoreBodies>(name: N) =>
  ({ kind: "core", name }) as const;
const NONE = { kind: "none" } as const;
const ACCOUNTS = ["account"] as const;
const ADMIN = ["admin"] as const;
const READERS = ["account", "plugin"] as const; // "Accounts and Plugins read the picture"

function about(tx: ReadTx): unknown {
  return { ...tx.env.versions, run_id: tx.runId };
}
function debugLog(): unknown {
  return refuse("not_found", "No such debug endpoint");
}
function page(q: URLSearchParams) {
  return {
    cursor: q.get("cursor"),
    limit: Math.min(1000, Number(q.get("limit") ?? 1000)),
  };
}
async function verifyLogin(
  req: Req<CoreBodies["login"]>,
  store: Store,
): Promise<string> {
  const hash = store.read((tx) =>
    admin.passwordHashOf(tx, req.body.operator_id),
  );
  if (!hash || !(await admin.verifyPassword(hash, req.body.password)))
    refuse("unauthenticated", "Invalid account or password");
  return hash;
}
async function hashNewPassword(
  req: Req<CoreBodies["account"]>,
): Promise<string> {
  return admin.hashPassword(req.body.password);
}
function creatingCall(tx: ReadTx, r: Req<unknown>): number | null {
  if (r.who.caller.kind !== "plugin") return null;
  const id = Number(r.query.get("request_id"));
  if (!Number.isSafeInteger(id) || id < 1)
    refuse("invalid", "Plugin writes require request_id");
  plugins.requireOpenCall(tx, r.who.caller.plugin_id, id);
  return id;
}

const a = (r: { params: Record<string, string> }) => r.params.asset_id!;

export const ROUTES: readonly Route[] = [
  read({
    method: "GET",
    path: "/about",
    doc: "basics",
    who: ["public", "asset", "gateway", "plugin", "account"],
    serve: about,
  }),
  {
    kind: "stream",
    method: "GET",
    path: "/events",
    doc: "the-event-log-and-live-stream",
    who: ["account", "asset", "gateway", "plugin"],
  },
  read({
    method: "GET",
    path: "/history",
    doc: "reads",
    who: READERS,
    serve: (tx, r) =>
      entities.history(tx, "reports", r.query, page(r.query).cursor),
  }),
  read({
    method: "GET",
    path: "/history/tracks",
    doc: "reads",
    who: READERS,
    serve: (tx, r) =>
      entities.history(tx, "tracks", r.query, page(r.query).cursor),
  }),
  read({
    method: "GET",
    path: "/history/geofeatures",
    doc: "reads",
    who: READERS,
    serve: (tx, r) =>
      entities.history(tx, "geofeatures", r.query, page(r.query).cursor),
  }),
  read({
    method: "GET",
    path: "/debug/:segment/log",
    doc: "debug-log",
    who: ["public"],
    serve: debugLog,
  }),
  change({
    method: "POST",
    path: "/tasks/:asset_id",
    doc: "operator-requests",
    who: ACCOUNTS,
    body: P("requests.tasks"),
    commit: (tx, r) => accepted(tasks.requestTasks(tx, a(r), r.body, r.who.by)),
  }),
  change({
    method: "PATCH",
    path: "/entities/assets/:asset_id/settings",
    doc: "operator-requests",
    who: ACCOUNTS,
    body: P("requests.settings"),
    commit: (tx, r) =>
      accepted(entities.requestSettings(tx, a(r), r.body, r.who.by)),
  }),
  change({
    method: "POST",
    path: "/tasks/:asset_id/:task_id/cancel",
    doc: "operator-requests",
    who: ACCOUNTS,
    body: NONE,
    commit: (tx, r) =>
      accepted(tasks.cancelTask(tx, a(r), Number(r.params.task_id), r.who.by)),
  }),
  read({
    method: "GET",
    path: "/tasks/:asset_id",
    doc: "reads",
    who: ACCOUNTS,
    serve: (tx, r) => tasks.readTasks(tx, a(r)),
  }),
  read({
    method: "GET",
    path: "/entities",
    doc: "read-the-picture",
    who: READERS,
    serve: (tx) => entities.picture(tx),
  }),
  read({
    method: "GET",
    path: "/entities/assets",
    doc: "reads",
    who: READERS,
    serve: (tx) => entities.listAssets(tx),
  }),
  read({
    method: "GET",
    path: "/entities/assets/:asset_id",
    doc: "reads",
    who: ["account", "plugin", "asset", "gateway"],
    actsFor: "path:asset_id",
    serve: (tx, r) => entities.getAsset(tx, a(r)),
  }),
  read({
    method: "GET",
    path: "/entities/observations",
    doc: "observations",
    who: READERS,
    serve: (tx) => entities.listObservations(tx),
  }),
  read({
    method: "GET",
    path: "/entities/tracks",
    doc: "tracks",
    who: READERS,
    serve: (tx) => entities.listTracks(tx),
  }),
  read({
    method: "GET",
    path: "/entities/tracks/:track_id",
    doc: "tracks",
    who: READERS,
    serve: (tx, r) => entities.getTrack(tx, r.params.track_id!),
  }),
  read({
    method: "GET",
    path: "/entities/geofeatures",
    doc: "geo-features",
    who: READERS,
    serve: (tx) => entities.listGeofeatures(tx),
  }),
  read({
    method: "GET",
    path: "/entities/geofeatures/:geofeature_id",
    doc: "geo-features",
    who: READERS,
    serve: (tx, r) => entities.getGeofeature(tx, r.params.geofeature_id!),
  }),
  change({
    method: "POST",
    path: "/entities/assets",
    doc: "asset-and-gateway-calls",
    who: ["asset"],
    body: P("requests.asset"),
    commit: (tx, r) =>
      created(
        entities.registerAsset(
          tx,
          r.who.caller.kind === "asset" ? r.who.caller.key_id : "",
          r.body,
        ),
      ),
  }),
  change({
    method: "POST",
    path: "/entities/assets/radios",
    doc: "radio-assets",
    who: ["gateway"],
    body: P("requests.radio"),
    commit: (tx, r) => {
      const out = entities.registerRadio(tx, r.who.by, r.body);
      return out.registered
        ? created({ asset_id: out.asset_id })
        : {
            status: 409,
            body: {
              error: "definitions_mismatch",
              explanation: "The radio uses different Protocol definitions.",
            },
          };
    },
  }),
  change({
    method: "PUT",
    path: "/entities/assets/:asset_id/description",
    doc: "radio-assets",
    who: ["gateway"],
    actsFor: "path:asset_id",
    body: P("description"),
    commit: (tx, r) => ok(entities.signUpRadio(tx, a(r), r.body)),
  }),
  change({
    method: "POST",
    path: "/entities/assets/:asset_id/reports",
    doc: "asset-and-gateway-calls",
    who: ["asset", "gateway"],
    actsFor: "path:asset_id",
    body: C("reports"),
    commit: (tx, r) => ok(entities.storeReports(tx, a(r), r.body.reports)),
  }),
  change({
    method: "PUT",
    path: "/entities/assets/:asset_id/contact",
    doc: "asset-and-gateway-calls",
    who: ["gateway"],
    actsFor: "path:asset_id",
    body: P("contact"),
    commit: (tx, r) => ok(entities.applyContact(tx, a(r), r.body)),
  }),
  change({
    method: "POST",
    path: "/entities/geofeatures",
    doc: "geo-features",
    who: ["account", "plugin", "asset", "gateway"],
    actsFor: "query:asset_id",
    body: P("requests.geofeature"),
    commit: (tx, r) =>
      ok(entities.createGeofeature(tx, r.body, r.who.by, creatingCall(tx, r))),
  }),
  change({
    method: "PUT",
    path: "/entities/geofeatures/:geofeature_id",
    doc: "geo-features",
    who: ACCOUNTS,
    body: P("requests.geofeature"),
    commit: (tx, r) =>
      ok(
        entities.replaceGeofeature(
          tx,
          r.params.geofeature_id!,
          r.body,
          r.query.get("update_tasks") === "true",
          r.who.by,
        ),
      ),
  }),
  change({
    method: "DELETE",
    path: "/entities/geofeatures/:geofeature_id",
    doc: "geo-features",
    who: ACCOUNTS,
    body: NONE,
    commit: (tx, r) =>
      ok(entities.deleteGeofeature(tx, r.params.geofeature_id!, r.who.by)),
  }),
  change({
    method: "POST",
    path: "/objects",
    doc: "objects",
    who: ["account", "plugin", "asset", "gateway"],
    actsFor: "query:asset_id",
    body: { kind: "file" },
    commit: (tx, r) =>
      created(
        objects.store(
          tx,
          r.body,
          {
            name: r.query.get("name") ?? "",
            ...(r.query.has("geofeature_id")
              ? { geofeature_id: r.query.get("geofeature_id")! }
              : {}),
          },
          r.who.by,
          creatingCall(tx, r),
        ),
      ),
  }),
  read({
    method: "GET",
    path: "/objects",
    doc: "objects",
    who: READERS,
    serve: (tx, r) => objects.list(tx, r.query.get("geofeature_id")),
  }),
  read({
    method: "GET",
    path: "/objects/:object_id",
    doc: "objects",
    who: READERS,
    serve: (tx, r) => objects.get(tx, r.params.object_id!),
  }),
  {
    kind: "file",
    method: "GET",
    path: "/objects/:object_id/file",
    doc: "objects",
    who: READERS,
    serve: (tx, r) => objects.fileOf(tx, r.params.object_id!),
  },
  change({
    method: "PATCH",
    path: "/objects/:object_id",
    doc: "objects",
    who: ACCOUNTS,
    body: C("attach"),
    commit: (tx, r) =>
      ok(objects.attach(tx, r.params.object_id!, r.body.geofeature_id)),
  }),
  change({
    method: "DELETE",
    path: "/objects/:object_id",
    doc: "objects",
    who: ACCOUNTS,
    body: NONE,
    commit: (tx, r) => ok(objects.remove(tx, r.params.object_id!, r.who.by)),
  }),
  change({
    method: "PUT",
    path: "/plugins/:plugin_id/description",
    doc: "a-plugin-starts",
    who: ["plugin"],
    actsFor: "path:plugin_id",
    body: P("plugin.description"),
    commit: (tx, r) => ok(plugins.describe(tx, r.params.plugin_id!, r.body)),
  }),
  change({
    method: "POST",
    path: "/plugins/:plugin_id/actions/:action",
    doc: "operators-call-actions",
    who: ACCOUNTS,
    body: P("requests.plugin_call"),
    commit: (tx, r) =>
      accepted(
        plugins.call(
          tx,
          r.params.plugin_id!,
          r.params.action!,
          r.body,
          r.who.by,
        ),
      ),
  }),
  read({
    method: "GET",
    path: "/plugins",
    doc: "operators-call-actions",
    who: ACCOUNTS,
    serve: (tx) => plugins.list(tx),
  }),
  read({
    method: "GET",
    path: "/plugins/:plugin_id/calls",
    doc: "operators-call-actions",
    who: ACCOUNTS,
    serve: (tx, r) =>
      plugins.calls(
        tx,
        r.params.plugin_id!,
        page(r.query).cursor,
        page(r.query).limit,
      ),
  }),
  read({
    method: "GET",
    path: "/plugins/:plugin_id/calls/:event_id",
    doc: "operators-call-actions",
    who: ACCOUNTS,
    serve: (tx, r) =>
      plugins.getCall(tx, r.params.plugin_id!, Number(r.params.event_id)),
  }),
  change({
    method: "POST",
    path: "/plugins/:plugin_id/answers",
    doc: "plugins-answer",
    who: ["plugin"],
    actsFor: "path:plugin_id",
    body: C("answer"),
    commit: (tx, r) => ok(plugins.answer(tx, r.params.plugin_id!, r.body)),
  }),
  secret({
    method: "POST",
    path: "/administration/login",
    doc: "callers-and-credentials",
    who: ["public"],
    body: C("login"),
    prepare: verifyLogin,
    commit: (tx, r, verifiedHash) => {
      if (admin.passwordHashOf(tx, r.body.operator_id) !== verifiedHash)
        refuse("unauthenticated", "Account changed during login");
      const s = admin.createSession(tx, r.body.operator_id);
      return {
        first: {
          status: 200,
          body: s.ack,
          headers: { "set-cookie": s.shown.cookie },
        },
        ack: ok(s.ack),
      };
    },
  }),
  change({
    method: "POST",
    path: "/administration/logout",
    doc: "accounts-and-provisioning",
    who: ACCOUNTS,
    body: NONE,
    commit: (tx, r) => {
      if (r.who.caller.kind === "account")
        admin.endSession(tx, r.who.caller.token_hash);
      return ok({});
    },
  }),
  read({
    method: "GET",
    path: "/administration/me",
    doc: "accounts-and-provisioning",
    who: ACCOUNTS,
    serve: (tx, r) => admin.me(tx, r.who.by),
  }),
  change({
    method: "POST",
    path: "/administration/accounts",
    doc: "accounts-and-provisioning",
    who: ADMIN,
    body: C("account"),
    prepare: hashNewPassword,
    commit: (tx, r, hash) => created(admin.addAccount(tx, r.body, hash)),
  }),
  change({
    method: "DELETE",
    path: "/administration/accounts/:operator_id",
    doc: "accounts-and-provisioning",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) => {
      admin.removeAccount(tx, r.params.operator_id!);
      return ok({});
    },
  }),
  secret({
    method: "POST",
    path: "/administration/asset-keys",
    doc: "callers-and-credentials",
    who: ADMIN,
    body: NONE,
    commit: (tx) => issued(201, admin.createAssetKey(tx)),
  }),
  change({
    method: "DELETE",
    path: "/administration/asset-keys/:key_id",
    doc: "accounts-and-provisioning",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) => {
      admin.removeAssetKey(tx, r.params.key_id!);
      return ok({});
    },
  }),
  secret({
    method: "POST",
    path: "/administration/asset-keys/:key_id/key",
    doc: "callers-and-credentials",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) => issued(200, admin.replaceAssetKey(tx, r.params.key_id!)),
  }),
  change({
    method: "DELETE",
    path: "/administration/assets/:asset_id",
    doc: "accounts-and-provisioning",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) => ok(entities.removeAsset(tx, a(r), r.who.by)),
  }),
  secret({
    method: "POST",
    path: "/administration/gateways",
    doc: "callers-and-credentials",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) => issued(201, admin.provisionGateway(tx, r.who.by)),
  }),
  change({
    method: "DELETE",
    path: "/administration/gateways/:gateway_id",
    doc: "radio-assets",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) =>
      ok(admin.removeGateway(tx, r.params.gateway_id!, r.who.by)),
  }),
  secret({
    method: "POST",
    path: "/administration/gateways/:gateway_id/key",
    doc: "callers-and-credentials",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) =>
      issued(200, admin.replaceGatewayKey(tx, r.params.gateway_id!)),
  }),
  secret({
    method: "POST",
    path: "/administration/plugins",
    doc: "callers-and-credentials",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) => issued(201, admin.provisionPlugin(tx, r.who.by)),
  }),
  change({
    method: "DELETE",
    path: "/administration/plugins/:plugin_id",
    doc: "a-plugin-goes-offline-or-is-removed",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) =>
      ok(admin.removePlugin(tx, r.params.plugin_id!, r.who.by)),
  }),
  secret({
    method: "POST",
    path: "/administration/plugins/:plugin_id/key",
    doc: "callers-and-credentials",
    who: ADMIN,
    body: NONE,
    commit: (tx, r) =>
      issued(200, admin.replacePluginKey(tx, r.params.plugin_id!)),
  }),
];

export function match(
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | { status: 404 | 405 } {
  const candidates = ROUTES.map((route) => {
    const keys: string[] = [];
    const pattern = route.path
      .split("/")
      .map((s) => {
        if (s.startsWith(":")) {
          keys.push(s.slice(1));
          return "([^/]+)";
        }
        return s;
      })
      .join("/");
    const found = pathname.match(new RegExp(`^${pattern}$`));
    return { route, keys, found };
  })
    .filter((r) => r.found)
    .sort((a, b) => a.keys.length - b.keys.length);
  if (!candidates.length) return { status: 404 };
  const best = candidates.filter(
    (r) => r.route.path === candidates[0].route.path,
  );
  const selected = best.find((r) => r.route.method === method);
  if (!selected) return { status: 405 };
  return {
    route: selected.route,
    params: Object.fromEntries(
      selected.keys.map((key, i) => [
        key,
        decodePathSegment(selected.found![i + 1]),
      ]),
    ),
  };
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    refuse("invalid", "Malformed path escape");
  }
}
