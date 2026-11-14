import * as objects from "../pillars/objects.ts";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import * as entities from "../pillars/entities.ts";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { match } from "./routes.ts";
import type { Req } from "./routes.ts";
import { credentialOf, authorize } from "./auth.ts";
import {
  hashPassword,
  verifyPassword,
  callerFor,
  unregisteredMismatch,
} from "../pillars/administration.ts";
import { Refusal, refuse, checkOrRefuse } from "./errors.ts";
import { fingerprint, lookup, retain } from "../store/idempotency.ts";
import { audienceFor } from "./stream.ts";
import type { Env } from "../core.ts";
import type { Store } from "../store/db.ts";
import type { Contact } from "../contact.ts";
import type { Streams } from "./stream.ts";

export interface Server {
  readonly url: string;
  readonly debugUrl: string | null;
  close(): Promise<void>;
}

export async function startServer(
  env: Env,
  store: Store,
  contact: Contact,
  streams: Streams,
): Promise<Server> {
  let stopping = false;
  const passwordRetries = new Map<string, Promise<void>>();
  const segment = env.config.debug_endpoint
    ? randomBytes(24).toString("base64url")
    : null;
  const handler: import("node:http").RequestListener = async (req, res) => {
    let releaseLogin: (() => void) | undefined;
    let loginKey: string | undefined;
    let loginGate: Promise<void> | undefined;
    let routePath = req.url?.split("?")[0] ?? "/";
    const send = (
      status: number,
      body: unknown,
      headers: Record<string, string> = {},
    ) => {
      env.log.record({
        level: "info",
        area: "api",
        msg: "request completed",
        method: req.method,
        route: routePath,
        status,
        ...(status >= 400 && body && typeof body === "object" ? body : {}),
      });
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      if (stopping) refuse("stopping", "Core is stopping");
      const url = new URL(req.url ?? "/", "http://core");
      const selected = match(req.method ?? "GET", url.pathname);
      if ("status" in selected) {
        send(selected.status, {
          error: selected.status === 404 ? "not_found" : "method_not_allowed",
        });
        return;
      }
      const { route, params } = selected;
      routePath = route.path;
      if (route.path === "/debug/:segment/log") {
        if (!segment || params.segment !== segment)
          refuse("not_found", "No such debug endpoint");
        const after = Number(url.searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0)
          refuse("invalid", "after must be nonnegative");
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.end((await env.log.readAfter(after, 1000)).join("\n") + "\n");
        return;
      }
      const credential = credentialOf(req.headers);
      const logout = route.path === "/administration/logout";
      const resolveCaller = (tx: import("../store/db.ts").ReadTx) =>
        callerFor(tx, credential, logout) ??
        (credential && "session" in credential && route.who.includes("public")
          ? { kind: "anonymous" as const }
          : null);
      const caller = store.read(resolveCaller);
      if (!caller) refuse("unauthenticated", "Invalid credential");
      if (
        url.pathname === "/about" &&
        (caller.kind === "gateway" ||
          caller.kind === "plugin" ||
          caller.kind === "asset")
      ) {
        const hash = req.headers["atlas-definitions"];
        if (typeof hash === "string" && hash !== env.protocol.hash)
          store.write((tx) => {
            const id =
              caller.kind === "gateway"
                ? { gateway_id: caller.gateway_id }
                : caller.kind === "plugin"
                  ? { plugin_id: caller.plugin_id }
                  : {
                      asset_id:
                        entities.assetForKey(tx, caller.key_id) ?? undefined,
                    };
            const column =
              caller.kind === "gateway"
                ? "gateway_id"
                : caller.kind === "plugin"
                  ? "plugin_id"
                  : "asset_id";
            const value =
              caller.kind === "gateway"
                ? caller.gateway_id
                : caller.kind === "plugin"
                  ? caller.plugin_id
                  : entities.assetForKey(tx, caller.key_id);
            if (!value) {
              if (caller.kind === "asset")
                unregisteredMismatch(tx, caller.key_id, hash);
              return;
            }
            const record = { time: tx.now, ...id, definitions_hash: hash };
            if (!env.protocol.check("refusal", record).ok) return;
            if (
              !tx.get(
                `SELECT 1 FROM events WHERE run_id=? AND kind='definitions.refused' AND json_extract(record,'$.${column}')=? AND json_extract(record,'$.definitions_hash')=? AND COALESCE(json_extract(record,'$.radio'),0)=0`,
                tx.runId,
                value,
                hash,
              )
            )
              tx.append("definitions.refused", record);
          });
      }
      const principal = store.read((tx) =>
        authorize(
          tx,
          caller,
          route.who,
          route.actsFor,
          params,
          url.searchParams,
        ),
      );
      if (
        url.pathname !== "/about" &&
        !url.pathname.startsWith("/debug/") &&
        (req.headers["atlas-definitions"] ??
          (route.kind === "stream"
            ? url.searchParams.get("definitions")
            : null)) !== env.protocol.hash
      )
        refuse(
          "definitions_mismatch",
          "Use the definitions hash reported by GET /about",
        );
      const request: Req<any> = {
        params,
        query: url.searchParams,
        body: undefined,
        who: principal,
      };
      if (route.kind === "stream") {
        const raw =
          req.headers["last-event-id"] ?? url.searchParams.get("after");
        const after =
          raw === null || raw === undefined ? "latest" : Number(raw);
        if (after !== "latest" && (!Number.isSafeInteger(after) || after < 0))
          refuse("invalid", "after must be a nonnegative event ID");
        streams.open(res, audienceFor(principal, url.searchParams), after, () =>
          store.read((tx) => !!callerFor(tx, credential)),
        );
        return;
      }
      if (principal.heard) contact.heard(principal.heard);
      else if (caller.kind === "asset") {
        const asset_id = store.read((tx) =>
          entities.assetForKey(tx, caller.key_id),
        );
        if (asset_id) contact.heard({ asset_id });
      }
      if (route.kind === "read") {
        send(
          200,
          store.read((tx) => route.serve(tx, request)),
        );
        return;
      }
      if (route.kind === "file") {
        const file = store.read((tx) => route.serve(tx, request));
        res.writeHead(200, {
          "content-type": file.content_type,
          "content-length": file.size_bytes,
        });
        await pipeline(createReadStream(file.path), res);
        env.log.record({
          level: "info",
          area: "api",
          msg: "file downloaded",
          method: req.method,
          route: routePath,
          object_id: params.object_id,
          status: 200,
          size_bytes: file.size_bytes,
        });
        return;
      }
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !key.length || key.length > 64)
        refuse("invalid", "Idempotency-Key must contain 1 to 64 characters");
      let bytes: Buffer;
      let upload: objects.ReceivedFile | undefined;
      const runId = store.read((tx) => tx.runId);
      if (route.body.kind === "file") {
        upload = await objects.receive(
          env,
          req,
          req.headers["content-type"]?.split(";")[0] ??
            "application/octet-stream",
        );
        try {
          await objects.placeFile(env, runId, upload);
        } catch (error) {
          await objects.abandon(env, runId, upload);
          throw error;
        }
        request.body = upload;
        bytes = Buffer.from(
          JSON.stringify({
            sha256: upload.sha256,
            content_type: upload.content_type,
          }),
        );
      } else {
        if (req.headers["content-type"]?.split(";")[0] !== "application/json")
          refuse("invalid", "State changes require application/json");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024)
            refuse("too_large", "JSON body exceeds 16 MiB");
          chunks.push(chunk);
        }
        bytes = Buffer.concat(chunks);
        let value: unknown;
        try {
          value = bytes.length ? JSON.parse(bytes.toString()) : undefined;
        } catch {
          refuse("invalid", "Malformed JSON");
        }
        if (route.body.kind === "protocol")
          request.body = checkOrRefuse(env.protocol, route.body.name, value);
        else if (route.body.kind === "core") {
          const name = route.body.name;
          if (name === "answer") {
            const type =
              value && typeof value === "object" && "type" in value
                ? value.type
                : null;
            if (type !== "plugin.result" && type !== "plugin.failure")
              refuse("invalid", "Expected a Plugin answer");
            request.body = checkOrRefuse(env.protocol, type, value);
          } else
            request.body = checkOrRefuse(
              env.protocol,
              `requests.${name}`,
              value,
            );
        } else if (
          value !== undefined &&
          value !== null &&
          JSON.stringify(value) !== "{}"
        )
          refuse("invalid", "This route takes no body");
      }
      const login = url.pathname === "/administration/login";
      const scope = login ? "login" : principal.scope;
      const passwordRequest = login || route.path === "/administration/accounts";
      let fp: string;
      if (passwordRequest) {
        loginKey = JSON.stringify([scope, key]);
        const previous = passwordRetries.get(loginKey);
        loginGate = new Promise<void>((resolve) => {
          releaseLogin = resolve;
        });
        passwordRetries.set(loginKey, loginGate);
        await previous;
        const prior = store.read((tx) =>
          tx.get<{ fingerprint: string }>(
            "SELECT fingerprint FROM idempotency_keys WHERE run_id=? AND scope=? AND key=?",
            tx.runId,
            scope,
            key,
          ),
        );
        const body = JSON.stringify(request.body);
        if (prior && !(await verifyPassword(prior.fingerprint, body)))
          refuse(
            "idempotency_conflict",
            "This key was used for another request",
          );
        fp = prior?.fingerprint ?? (await hashPassword(body));
      } else
        fp = fingerprint({
          method: route.method,
          route: route.path,
          params,
          query: url.searchParams.toString(),
          body: bytes,
        });
      const prepared = await route.prepare?.(request, store);
      let storedUpload = false;
      let reply;
      try {
        reply = store.write((tx) => {
          const current = resolveCaller(tx);
          if (!current) refuse("unauthenticated", "Invalid credential");
          authorize(
            tx,
            current,
            route.who,
            route.actsFor,
            params,
            url.searchParams,
          );
          const prior = lookup(tx, scope, key, fp);
          if (prior.found) {
            if (!prior.same)
              refuse(
                "idempotency_conflict",
                "This key was used for another request",
              );
            return prior.retained;
          }
          if (logout && !callerFor(tx, credential))
            refuse("unauthenticated", "Session has ended");
          const before = tx.get<{ n: number }>("SELECT total_changes() n")!.n;
          const result = route.commit(tx, request, prepared);
          const first = "first" in result ? result.first : result;
          const keep = "ack" in result ? result.ack : result;
          if (tx.get<{ n: number }>("SELECT total_changes() n")!.n > before)
            retain(tx, scope, key, fp, keep);
          storedUpload = true;
          return first;
        });
      } catch (error) {
        storedUpload = false;
        throw error;
      } finally {
        if (upload && !storedUpload) await objects.abandon(env, runId, upload);
      }
      if (route.path === "/entities/assets" && caller.kind === "asset") {
        const asset_id = store.read((tx) =>
          entities.assetForKey(tx, caller.key_id),
        );
        if (asset_id) contact.heard({ asset_id });
      }
      send(reply.status, reply.body, {
        ...("headers" in reply
          ? (reply.headers as Record<string, string>)
          : {}),
        ...(route.path === "/administration/logout"
          ? {
              "set-cookie":
                "atlas_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
            }
          : {}),
      });
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (
        e instanceof Error &&
        ["ENOSPC", "EDQUOT", "EIO"].includes(String(Reflect.get(e, "code")))
      ) {
        send(507, {
          error: "storage_full",
          explanation: "Core could not store the file",
        });
        return;
      }
      if (e instanceof Refusal)
        send(e.status, { error: e.code, explanation: e.message, ...e.extra });
      else {
        env.log.record({
          level: "error",
          area: "api",
          msg: e instanceof Error ? e.message : "Request failed",
        });
        send(500, { error: "internal_error" });
      }
    } finally {
      releaseLogin?.();
      if (loginKey && passwordRetries.get(loginKey) === loginGate)
        passwordRetries.delete(loginKey);
    }
  };
  const server =
    env.config.tls_certificate && env.config.tls_key
      ? httpsServer(
          {
            cert: readFileSync(env.config.tls_certificate),
            key: readFileSync(env.config.tls_key),
          },
          handler,
        )
      : httpServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.config.port, env.config.listen_address, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No bound address");
  const host = address.address.includes(":")
    ? `[${address.address}]`
    : address.address;
  const url = `${env.config.tls_key ? "https" : "http"}://${host}:${address.port}`;
  let renewal: ReturnType<Env["clock"]["after"]> | undefined;
  if ("setSecureContext" in server) {
    const reload = () => {
      try {
        server.setSecureContext({
          cert: readFileSync(env.config.tls_certificate!),
          key: readFileSync(env.config.tls_key!),
        });
      } catch {
        env.log.record({
          level: "error",
          area: "tls",
          msg: "TLS renewal failed",
        });
      }
      renewal = env.clock.after(3600000, reload);
    };
    renewal = env.clock.after(3600000, reload);
  }
  return {
    url,
    debugUrl: segment ? `${url}/debug/${segment}/log` : null,
    close() {
      stopping = true;
      renewal?.cancel();
      streams.closeAll();
      return new Promise<void>((resolve, reject) => {
        env.clock.after(5000, () => {
          server.close((e) => {
            if (e) reject(e);
            else resolve();
          });
          server.closeAllConnections();
        });
      });
    },
  };
}
