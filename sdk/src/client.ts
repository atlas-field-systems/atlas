import { validReply, type ReplyKind } from "./responses.ts";
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
import {
  backoffDelay,
  defaultBackoff,
  type Backoff,
  type Clock,
} from "./clock.ts";
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
  stream_keepalive_s: number;
  run_id: number;
  definitions_hash: string;
  core_version: string;
  protocol_version: string;
};
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Page<T> = { as_of: number; items: T[]; next_cursor: string | null };
export function createClient<C extends Credential>(options: ClientOptions<C>) {
  const { protocol, credential, clock } = options;
  const baseUrl = new URL(options.baseUrl ?? globalThis.location?.href);
  if (
    baseUrl.protocol === "http:" &&
    baseUrl.hostname !== "localhost" &&
    baseUrl.hostname !== "[::1]" &&
    !/^127\.\d+\.\d+\.\d+$/.test(baseUrl.hostname)
  )
    throw new Error("HTTP Core baseUrl must use loopback");
  const emit = diagnostics(clock, options.observer);
  const timeout = options.requestTimeoutMs ?? 10000;
  const backoff = options.backoff ?? defaultBackoff;
  let status: Status = { phase: "new" },
    epoch = 0,
    session = 0,
    lastSent = clock.now();
  let needsVerify = false,
    verification: Promise<Result<About>> | undefined;
  const listeners = new Set<(s: Status) => void>();
  const controllers = new Set<AbortController>();
  const responseSessions = new WeakMap<
    Response,
    { session: number; epoch: number }
  >();
  function setStatus(next: Status) {
    if (status.phase === "closed") return;
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
    const u = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }
  async function raw(
    path: string,
    init: RequestInit,
    query?: Query,
    budget = timeout,
  ): Promise<Response> {
    const sentSession = { session, epoch };
    const controller = new AbortController();
    controllers.add(controller);
    const external = init.signal;
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) controller.abort();
    const timer = clock.after(Math.min(timeout, budget), abort);
    lastSent = clock.now();
    emit("request.attempt", {
      method: init.method ?? "GET",
      path: new URL(path, baseUrl).pathname.startsWith("/administration")
        ? "/administration"
        : new URL(path, baseUrl).pathname,
    });
    try {
      if (controller.signal.aborted || isClosed())
        throw new Error("Client closed");
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Request aborted")),
          { once: true },
        );
      });
      const response = await Promise.race([
        options.fetch(url(path, query), {
          ...init,
          headers: headers(init.headers),
          credentials: credential.kind === "account" ? "include" : "omit",
          signal: controller.signal,
        }),
        aborted,
      ]);
      const bytes = await Promise.race([response.arrayBuffer(), aborted]);
      const buffered = new Response(response.status === 204 ? null : bytes, {
        status: response.status,
        headers: response.headers,
      });
      responseSessions.set(buffered, sentSession);
      return buffered;
    } finally {
      timer.cancel();
      controllers.delete(controller);
      external?.removeEventListener("abort", abort);
    }
  }
  async function parse<T>(
    response: Response,
    path: string,
    reply?: ReplyKind | "file",
  ): Promise<Result<T>> {
    let body: unknown;
    try {
      body =
        reply === "file" && response.ok ? await response.blob() : await response.json();
    } catch {
      return {
        ok: false,
        error: "invalid_response",
        explanation: "Core returned invalid JSON",
      };
    }
    emit("request.response", { status: response.status });
    if (response.status === 401) emit("authentication.401");
    if (response.ok && reply && reply !== "file" && !validReply(protocol, reply, body))
      return { ok: false, status: response.status, error: "invalid_response", explanation: `Invalid Core response for ${reply}` };
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
    const sent = responseSessions.get(response);
    const current = !sent || (sent.session === session && sent.epoch === epoch);
    if (
      current &&
      body.error === "definitions_mismatch" &&
      // connect() confirmed this client's hash for the run, so a refusal
      // here is the radio's own hash.
      path !== "/entities/assets/radios"
    )
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
      current &&
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
  async function about(budget = timeout): Promise<Result<About>> {
    const boundEpoch = epoch;
    try {
      const result = await parse<About>(
        await raw("/about", {}, undefined, budget),
        "/about", "about",
      );
      if (boundEpoch !== epoch)
        return {
          ok: false,
          error: "run_ended",
          explanation: "Connection changed during handshake",
        };
      if (isClosed())
        return { ok: false, error: "closed", explanation: "Client closed" };
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
  async function verifyRun(budget = timeout): Promise<Result<About>> {
    const stop = blocked<About>();
    if (stop) return stop;
    const boundEpoch = epoch;
    const pending = (verification ??= (async () => {
      try {
        const result = await about(budget);
        if (boundEpoch !== epoch)
          return {
            ok: false,
            error: "run_ended",
            explanation: "Connection changed during verification",
          };
        if (status.phase === "closed")
          return { ok: false, error: "closed", explanation: "Client closed" };
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
    let timer: ReturnType<Clock["after"]> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<Result<About>>((resolve) => {
          timer = clock.after(budget, () =>
            resolve({
              ok: false,
              error: "unknown",
              explanation: "Run verification timed out",
            }),
          );
        }),
      ]);
    } finally {
      timer?.cancel();
    }
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
    reply: ReplyKind | "file",
    body?: unknown,
    query?: Query,
    contentType?: string,
  ): Promise<Result<T>> {
    if (status.phase === "new" || status.phase === "closed")
      throw new Error("Client must be connected");
    const boundSession = session;
    const boundEpoch = epoch,
      key = method === "GET" ? undefined : crypto.randomUUID();
    const bytes =
      body instanceof Uint8Array
        ? new Uint8Array(body)
        : body === undefined
          ? undefined
          : JSON.stringify(body);
    const target = url(path, query);
    let flight: Promise<Result<T>> | undefined;
    let reportAttempts = 0;
    let verifyRetry = false;
    function fence(): Result<T> | undefined {
      if (boundEpoch !== epoch)
        return {
          ok: false,
          error: "run_ended",
          explanation: "Attempt belongs to another connection",
        };
      if (status.phase === "closed")
        return { ok: false, error: "closed", explanation: "Client closed" };
      const stop = blocked<T>();
      if (stop) return stop;
      if (boundSession !== session)
        return {
          ok: false,
          error: "session_changed",
          explanation: "Attempt belongs to another session",
        };
    }
    function retryRequest(): Promise<Result<T>> {
      verifyRetry = true;
      return send();
    }
    function unknown(): Result<T> {
      emit("request.unknown", { key: key ?? "" });
      return {
        ok: false,
        error: "unknown",
        explanation: "Core may have accepted the request",
        retry: retryRequest,
      };
    }
    const send = (): Promise<Result<T>> =>
      (flight ??= (async () => {
        const deadline = clock.now() + timeout;
        let attempt = 0;
        try {
          while (true) {
            const stop = fence();
            if (stop) return stop;
            if (clock.now() >= deadline) return unknown();
            if (needsVerify || verifyRetry) {
              const verified = await verifyRun(deadline - clock.now());
              const stopped = fence();
              if (stopped) return stopped;
              if (clock.now() >= deadline) return unknown();
              if (verified.ok) verifyRetry = false;
              else if (verified.status === 507)
                return { ...verified, retry: retryRequest };
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
              if (needsVerify || verifyRetry) throw new Error("Core unavailable");
              const h = new Headers();
              if (key) h.set("Idempotency-Key", key);
              if (method !== "GET")
                h.set("Content-Type", contentType ?? "application/json");
              if (path.endsWith("/reports") && reportAttempts++ > 0)
                emit("batch.resent", { key: key ?? "" });
              const stopped = fence();
              if (stopped) return stopped;
              if (clock.now() >= deadline) return unknown();
              const response = await raw(
                target,
                { method, headers: h, body: bytes },
                undefined,
                deadline - clock.now(),
              );
              const afterSend = fence();
              if (afterSend) return afterSend;
              if (response.status < 500 || response.status === 507) {
                const result = await parse<T>(response, path, reply);
                const afterParse = fence();
                if (afterParse) return afterParse;
                return !result.ok && response.status === 507
                  ? { ...result, retry: retryRequest }
                  : result;
              }
              emit("request.retry_status", { status: response.status });
              await response.arrayBuffer();
              needsVerify = true;
            } catch {
              needsVerify = true;
            }
            const stopped = fence();
            if (stopped) return stopped;
            const remaining = deadline - clock.now();
            if (remaining <= 0) return unknown();
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
    if (name === "logout") session++;
    return request<ResponseOf<N>>(route.method, path, name, args.body, args.query);
  }
  function isClosed() {
    return status.phase === "closed";
  }
  async function connect(): Promise<Result<About>> {
    if (status.phase === "closed") throw new Error("Client closed");
    if (status.phase === "definitions_mismatch") return blocked<About>()!;
    const result = await about();
    if (isClosed())
      return {
        ok: false,
        error: "closed",
        explanation: "Client closed",
      };
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
    session++;
    let recovery = 0;
    let result = await request<Json>("POST", "/administration/login", "login", body);
    const deadline = clock.now() + timeout;
    let unconfirmed = false;
    while (result.ok || result.error === "unknown") {
      const me = await request<Json>("GET", "/administration/me", "me");
      result = me;
      const confirmed =
        me.ok &&
        me.value !== null &&
        typeof me.value === "object" &&
        !Array.isArray(me.value) &&
        me.value.operator_id === operator_id;
      unconfirmed = (me.ok && !confirmed) || (!me.ok && me.status === 401);
      if (confirmed || !unconfirmed || clock.now() >= deadline) break;
      await new Promise<void>((resolve) =>
        clock.after(
          Math.min(backoffDelay(recovery++, backoff), deadline - clock.now()),
          resolve,
        ),
      );
      if (clock.now() >= deadline) break;
      result = await request<Json>("POST", "/administration/login", "login", body);
      unconfirmed = false;
    }
    if (result.ok && status.phase === "unauthenticated")
      setStatus({ phase: "connected", run_id: status.run_id });
    if (unconfirmed)
      return {
        ok: false,
        error: "session_not_confirmed",
        explanation:
          "Login recovery could not confirm a session before its timeout.",
      };
    return result;
  }
  async function* pages<T>(
    reply: ReplyKind,
    path: string,
    query: Query = {},
  ): AsyncIterable<Result<Page<T>>> {
    let cursor: string | undefined;
    do {
      const result = await request<Page<T>>("GET", path, reply, undefined, {
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
      pages<AtlasEvent<Extract<EventKind, `report.${string}`>>>("historyPage", "/history", q),
    trackHistory: (q?: Query) =>
      pages<AtlasEvent<"track.updated" | "track.removed">>(
        "trackPage", "/history/tracks",
        q,
      ),
    geofeatureHistory: (q?: Query) =>
      pages<
        AtlasEvent<
          "geofeature.created" | "geofeature.replaced" | "geofeature.deleted"
        >
      >("placePage", "/history/geofeatures", q),
    pluginCalls: (plugin_id: string, q?: Query) =>
      pages<CallEntry>("callPage", `/plugins/${encodeURIComponent(plugin_id)}/calls`, q),
    uploadObject: (bytes: Uint8Array, contentType: string, query: Query) =>
      request<{ object_id: string; event_id: number }>(
        "POST",
        "/objects",
        "upload",
        bytes,
        query,
        contentType,
      ),
    objectFile: (object_id: string) => {
      return request<Blob>(
        "GET",
        `/objects/${encodeURIComponent(object_id)}/file`,
        "file",
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
    streamFetch: async (
      after: number,
      filter: { asset_id?: string; everything?: boolean },
      signal: AbortSignal,
    ) => {
      const sentSession = { session, epoch };
      const response = await options.fetch(
        url("/events", {
          after,
          asset_id: filter.asset_id,
          everything: filter.everything ? "true" : undefined,
          definitions: protocol.hash,
        }),
        {
          signal,
          headers: headers(),
          credentials: credential.kind === "account" ? "include" : "omit",
        },
      );
      responseSessions.set(response, sentSession);
      return response;
    },
    streamResponse: (r: Response) => parse<Json>(r, "/events"),
  });
  return client;
}
export type Client<C extends Credential = Credential> = ReturnType<
  typeof createClient<C>
>;
