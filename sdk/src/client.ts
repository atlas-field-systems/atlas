import type { AtlasEvent, EventKind } from "./stream.ts";
import { internals } from "./internal.ts";
import type { Protocol } from "@atlas/protocol/browser";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
import {
  ROUTES,
  type Allowed,
  type CallerKind,
  type Params,
  type Query,
  type RouteBody,
  type RouteName,
  type ResponseOf,
  type CallEntry,
} from "./routes.ts";
import { backoffDelay, type Backoff, type Clock } from "./clock.ts";
import { diagnostics, type Observer } from "./diagnostics.ts";

export type Credential =
  | { kind: "account" }
  | { kind: "asset" | "gateway"; key: string }
  | { kind: "plugin"; key: string; plugin_id: string };
export type Result<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: string;
      status?: number;
      explanation: string;
      retry?: () => Promise<Result<T>>;
    };
export type Status =
  | { phase: "new" | "closed" }
  | { phase: "connected" | "unauthenticated"; run_id: number }
  | { phase: "run_ended"; old_run_id: number; new_run_id: number }
  | { phase: "definitions_mismatch"; ours: string; core: string };
export interface ClientOptions<C extends Credential> {
  protocol: Protocol;
  credential: C;
  clock: Clock;
  fetch: typeof globalThis.fetch;
  baseUrl?: string;
  observer?: Observer;
  requestTimeoutMs?: number;
  backoff?: Backoff;
  streamIdleMs?: number;
  heartbeatMs?: number;
}
export type About = {
  run_id: number;
  definitions_hash: string;
  core_version: string;
  protocol_version: string;
};
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Page<T> = { as_of: number; items: T[]; next_cursor: string | null };
export function createClient<C extends Credential>(options: ClientOptions<C>) {
  const { protocol, credential, clock } = options;
  const emit = diagnostics(clock, options.observer);
  const timeout = options.requestTimeoutMs ?? 10000;
  const backoff = options.backoff ?? {
    minMs: 500,
    maxMs: 30000,
    factor: 2,
    jitter: 0.2,
  };
  let status: Status = { phase: "new" },
    epoch = 0,
    lastSent = clock.now();
  let needsVerify = false,
    verification: Promise<Result<About>> | undefined;
  const listeners = new Set<(s: Status) => void>();
  const controllers = new Set<AbortController>();
  function setStatus(next: Status) {
    status = next;
    if (next.phase === "definitions_mismatch")
      emit("definitions.mismatch", { ours: next.ours, core: next.core });
    for (const cb of listeners) cb(next);
  }
  function blocked<T>(): Result<T> | undefined {
    if (status.phase === "run_ended")
      return {
        ok: false,
        error: "run_ended",
        explanation: "Core began another run; connect again.",
      };
    if (status.phase === "definitions_mismatch")
      return {
        ok: false,
        error: "definitions_mismatch",
        explanation: `SDK ${status.ours}; Core ${status.core}`,
      };
  }
  function headers(extra?: HeadersInit) {
    const h = new Headers(extra);
    h.set("Atlas-Definitions", protocol.hash);
    if (credential.kind !== "account")
      h.set("Authorization", `Bearer ${credential.key}`);
    return h;
  }
  function url(path: string, query: Query = {}) {
    const u = new URL(path, options.baseUrl ?? globalThis.location?.href);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }
  async function raw(
    path: string,
    init: RequestInit,
    query?: Query,
  ): Promise<Response> {
    const controller = new AbortController();
    controllers.add(controller);
    const external = init.signal;
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) controller.abort();
    const timer = clock.after(timeout, abort);
    lastSent = clock.now();
    emit("request.attempt", {
      method: init.method ?? "GET",
      path: path.startsWith("/administration") ? "/administration" : path,
    });
    try {
      const response = await options.fetch(url(path, query), {
        ...init,
        headers: headers(init.headers),
        credentials: credential.kind === "account" ? "include" : "omit",
        signal: controller.signal,
      });
      const bytes = await response.arrayBuffer();
      return new Response(response.status === 204 ? null : bytes, {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      timer.cancel();
      controllers.delete(controller);
      external?.removeEventListener("abort", abort);
    }
  }
  async function parse<T>(
    response: Response,
    path: string,
    file = false,
  ): Promise<Result<T>> {
    let body: unknown;
    try {
      body =
        file && response.ok ? await response.blob() : await response.json();
    } catch {
      return {
        ok: false,
        error: "invalid_response",
        explanation: "Core returned invalid JSON",
      };
    }
    emit("request.response", { status: response.status });
    if (response.status === 401) emit("authentication.401");
    if (response.ok) return { ok: true, value: body as T };
    if (
      !body ||
      typeof body !== "object" ||
      !("error" in body) ||
      typeof body.error !== "string" ||
      !("explanation" in body) ||
      typeof body.explanation !== "string"
    )
      return {
        ok: false,
        error: "invalid_response",
        status: response.status,
        explanation: "Core returned an invalid error response",
      };
    if (body.error === "definitions_mismatch")
      setStatus({
        phase: "definitions_mismatch",
        ours: protocol.hash,
        core:
          "definitions_hash" in body &&
          typeof body.definitions_hash === "string"
            ? body.definitions_hash
            : "unknown",
      });
    if (
      response.status === 401 &&
      path !== "/administration/login" &&
      (status.phase === "connected" || status.phase === "unauthenticated")
    )
      setStatus({ phase: "unauthenticated", run_id: status.run_id });
    return {
      ok: false,
      error: String(body.error ?? "invalid_response"),
      status: response.status,
      explanation: String(body.explanation ?? "Invalid response"),
    };
  }
  async function about(): Promise<Result<About>> {
    try {
      const result = await parse<About>(await raw("/about", {}), "/about");
      if (result.ok)
        emit("definitions.checked", {
          ours: protocol.hash,
          core: result.value.definitions_hash,
        });
      if (result.ok && result.value.definitions_hash !== protocol.hash) {
        setStatus({
          phase: "definitions_mismatch",
          ours: protocol.hash,
          core: result.value.definitions_hash,
        });
        return blocked<About>()!;
      }
      return result;
    } catch {
      return {
        ok: false,
        error: "unknown",
        explanation: "No response from Core",
      };
    }
  }
  async function verifyRun(): Promise<Result<About>> {
    const stop = blocked<About>();
    if (stop) return stop;
    return (verification ??= (async () => {
      try {
        const result = await about();
        if (
          result.ok &&
          (status.phase === "connected" ||
            status.phase === "unauthenticated") &&
          status.run_id !== result.value.run_id
        ) {
          setStatus({
            phase: "run_ended",
            old_run_id: status.run_id,
            new_run_id: result.value.run_id,
          });
          return blocked<About>()!;
        }
        if (result.ok) needsVerify = false;
        return result;
      } finally {
        verification = undefined;
      }
    })());
  }
  function validate(name: string, value: unknown) {
    const checked = protocol.check(name, value);
    if (!checked.ok)
      emit("validation.failed", {
        name,
        problems: JSON.stringify(checked.problems),
      });
    return checked;
  }
  function assertValid(name: string, value: unknown) {
    const checked = validate(name, value);
    if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
  }
  function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
    file = false,
    contentType?: string,
  ): Promise<Result<T>> {
    if (status.phase === "new" || status.phase === "closed")
      throw new Error("Client must be connected");
    const boundEpoch = epoch,
      key = method === "GET" ? undefined : crypto.randomUUID();
    const bytes =
      body instanceof Uint8Array
        ? body.slice()
        : body === undefined
          ? undefined
          : JSON.stringify(body);
    let flight: Promise<Result<T>> | undefined;
    const send = (): Promise<Result<T>> =>
      (flight ??= (async () => {
        const deadline = clock.now() + timeout;
        let attempt = 0;
        try {
          while (true) {
            if (boundEpoch !== epoch)
              return {
                ok: false,
                error: "run_ended",
                explanation: "Attempt belongs to another connection",
              };
            if (status.phase === "closed")
              return {
                ok: false,
                error: "closed",
                explanation: "Client closed",
              };
            const stop = blocked<T>();
            if (stop) return stop;
            if (needsVerify) {
              const verified = await verifyRun();
              if (
                !verified.ok &&
                verified.error !== "unknown" &&
                (verified.status === undefined || verified.status < 500)
              )
                return {
                  ok: false,
                  error: verified.error,
                  status: verified.status,
                  explanation: verified.explanation,
                };
            }
            try {
              if (needsVerify) throw new Error("Core unavailable");
              const h = new Headers();
              if (key) h.set("Idempotency-Key", key);
              if (method !== "GET")
                h.set("Content-Type", contentType ?? "application/json");
              if (attempt > 0 && path.endsWith("/reports"))
                emit("batch.resent", { key: key ?? "" });
              const response = await raw(
                path,
                { method, headers: h, body: bytes },
                query,
              );
              if (response.status < 500 || response.status === 507) {
                const result = await parse<T>(response, path, file);
                return !result.ok && response.status === 507
                  ? { ...result, retry: send }
                  : result;
              }
              emit("request.retry_status", { status: response.status });
              await response.arrayBuffer();
              needsVerify = true;
            } catch {
              needsVerify = true;
            }
            const remaining = deadline - clock.now();
            if (remaining <= 0) {
              emit("request.unknown", { key: key ?? "" });
              return {
                ok: false,
                error: "unknown",
                explanation: "Core may have accepted the request",
                retry: send,
              };
            }
            const delay = Math.min(remaining, backoffDelay(attempt++, backoff));
            emit("request.retry", { key: key ?? "", delay });
            await new Promise<void>((resolve) => clock.after(delay, resolve));
          }
        } finally {
          flight = undefined;
        }
      })());
    return send();
  }
  function call<N extends Allowed<C["kind"]>>(
    name: N,
    args: { params?: Params; query?: Query; body?: RouteBody<N> } = {},
  ): Promise<Result<ResponseOf<N>>> {
    const route: {
      method: string;
      path: string;
      who: readonly CallerKind[];
      body?: keyof P;
    } = ROUTES[name];
    if (!route.who.includes(credential.kind))
      throw new Error("Credential cannot call this route");
    if (route.body) assertValid(route.body, args.body);
    if (name === "sendReports") {
      const body = args.body as P["requests.reports"];
      for (const report of body.reports) assertValid(report.type, report);
    }
    if (name === "answerPlugin") {
      const answer = args.body as P["plugin.result"] | P["plugin.failure"];
      assertValid(answer.type, answer);
    }
    const path = route.path.replace(/:([a-z_]+)/g, (_, k: string) => {
      const value = args.params?.[k];
      if (value === undefined) throw new Error(`Missing ${k}`);
      return encodeURIComponent(String(value));
    });
    return request<ResponseOf<N>>(route.method, path, args.body, args.query);
  }
  async function connect() {
    if (status.phase === "closed") throw new Error("Client closed");
    if (status.phase === "definitions_mismatch") return blocked<About>()!;
    const result = await about();
    if (result.ok) {
      const oldRun =
        "run_id" in status
          ? status.run_id
          : status.phase === "run_ended"
            ? status.old_run_id
            : undefined;
      if (oldRun !== result.value.run_id) epoch++;
      needsVerify = false;
      setStatus({ phase: "connected", run_id: result.value.run_id });
    }
    return result;
  }
  async function login(
    operator_id: string,
    password: string,
  ): Promise<Result<Json>> {
    if (credential.kind !== "account")
      throw new Error("Only account clients log in");
    const body = { operator_id, password };
    assertValid("requests.login", body);
    const deadline = clock.now() + timeout;
    let recovery = 0;
    let result = await request<Json>("POST", "/administration/login", body);
    while (result.ok || result.error === "unknown") {
      const me = await request<Json>("GET", "/administration/me");
      result = me;
      if (me.ok || me.status !== 401 || clock.now() >= deadline) break;
      await new Promise<void>((resolve) =>
        clock.after(
          Math.min(backoffDelay(recovery++, backoff), deadline - clock.now()),
          resolve,
        ),
      );
      if (clock.now() >= deadline) break;
      result = await request<Json>("POST", "/administration/login", body);
    }
    if (result.ok && status.phase === "unauthenticated")
      setStatus({ phase: "connected", run_id: status.run_id });
    return result;
  }
  async function* pages<T>(
    path: string,
    query: Query = {},
  ): AsyncIterable<Result<Page<T>>> {
    requireCaller(["account", "plugin"]);
    let cursor: string | undefined;
    do {
      const result = await request<Page<T>>("GET", path, undefined, {
        ...query,
        cursor,
      });
      yield result;
      if (!result.ok) return;
      cursor = result.value.next_cursor ?? undefined;
    } while (cursor);
  }
  function holdContact() {
    if (credential.kind !== "gateway" && credential.kind !== "plugin")
      throw new Error("Only gateways and Plugins hold contact");
    let stopped = false;
    let timer = clock.after(
      Math.max(0, lastSent + (options.heartbeatMs ?? 10000) - clock.now()),
      beat,
    );
    async function beat() {
      if (stopped || status.phase !== "connected") return;
      if (clock.now() - lastSent >= (options.heartbeatMs ?? 10000))
        await verifyRun();
      if (!stopped && status.phase === "connected")
        timer = clock.after(
          Math.max(0, lastSent + (options.heartbeatMs ?? 10000) - clock.now()),
          beat,
        );
    }
    return {
      stop() {
        stopped = true;
        timer.cancel();
      },
    };
  }
  function requireCaller(kinds: readonly CallerKind[]) {
    if (!kinds.includes(credential.kind))
      throw new Error("Credential cannot call this route");
  }
  const client = {
    get status() {
      return status;
    },
    connect,
    call,
    login,
    validate,
    holdContact,
    onStatus(cb: (s: Status) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    history: (q?: Query) =>
      pages<AtlasEvent<Extract<EventKind, `report.${string}`>>>("/history", q),
    trackHistory: (q?: Query) =>
      pages<AtlasEvent<"track.updated" | "track.removed">>(
        "/history/tracks",
        q,
      ),
    geofeatureHistory: (q?: Query) =>
      pages<
        AtlasEvent<
          "geofeature.created" | "geofeature.replaced" | "geofeature.deleted"
        >
      >("/history/geofeatures", q),
    pluginCalls: (plugin_id: string, q?: Query) =>
      pages<CallEntry>(`/plugins/${encodeURIComponent(plugin_id)}/calls`, q),
    uploadObject: (bytes: Uint8Array, contentType: string, query: Query) =>
      request<{ object_id: string; event_id: number }>(
        "POST",
        "/objects",
        bytes,
        query,
        false,
        contentType,
      ),
    objectFile: (object_id: string) => {
      requireCaller(["account", "plugin"]);
      return request<Blob>(
        "GET",
        `/objects/${encodeURIComponent(object_id)}/file`,
        undefined,
        undefined,
        true,
      );
    },
    close() {
      setStatus({ phase: "closed" });
      for (const c of controllers) c.abort();
    },
  };
  internals.set(client, {
    options,
    emit,
    verifyRun,
    get epoch() {
      return epoch;
    },
    streamFetch: (
      after: number,
      asset_id: string | undefined,
      signal: AbortSignal,
    ) =>
      options.fetch(
        url("/events", { after, asset_id, definitions: protocol.hash }),
        {
          signal,
          headers: headers(),
          credentials: credential.kind === "account" ? "include" : "omit",
        },
      ),
    streamResponse: (r: Response) => parse<Json>(r, "/events"),
  });
  return client;
}
export type Client<C extends Credential = Credential> = ReturnType<
  typeof createClient<C>
>;
