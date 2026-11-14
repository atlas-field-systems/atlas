import { refuse } from "./errors.ts";
import * as entities from "../pillars/entities.ts";
import type { IncomingHttpHeaders } from "node:http";
import type { ReadTx } from "../store/db.ts";
import type { Caller } from "../pillars/administration.ts";
import type { Subject } from "../contact.ts";

export function credentialOf(
  headers: IncomingHttpHeaders,
): { bearer: string } | { session: string } | null {
  const bearer = headers.authorization?.match(
    /^Bearer ([A-Za-z0-9_-]{22})$/,
  )?.[1];
  if (headers.authorization) return { bearer: bearer ?? "" };
  const session = headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("atlas_session="))
    ?.slice(14);
  return session ? { session } : null;
}

export type Who =
  "admin" | "account" | "asset" | "gateway" | "plugin" | "public";

export type ActsFor = "path:asset_id" | "query:asset_id" | "path:plugin_id";

export type Principal = {
  caller: Caller;
  asset_id: string | null;
  by: string;
  scope: string;
  heard: Subject | null;
};

export function authorize(
  tx: ReadTx,
  caller: Caller,
  who: readonly Who[],
  actsFor: ActsFor | undefined,
  params: Record<string, string>,
  query: URLSearchParams,
): Principal {
  if (caller.kind === "anonymous" && !who.includes("public"))
    refuse("unauthenticated", "A credential is required");
  if (
    !who.includes("public") &&
    !who.includes(caller.kind === "anonymous" ? "public" : caller.kind) &&
    !(caller.kind === "account" && caller.admin && who.includes("admin"))
  )
    refuse("forbidden", "This caller may not use this route");
  let asset_id: string | null = null;
  if (actsFor && caller.kind !== "account" && caller.kind !== "anonymous") {
    if (actsFor === "path:plugin_id") {
      if (caller.kind !== "plugin" || caller.plugin_id !== params.plugin_id)
        refuse("forbidden", "This Plugin is not yours");
    } else {
      const named =
        actsFor === "path:asset_id" ? params.asset_id : query.get("asset_id");
      if (caller.kind === "asset") {
        const own = entities.assetForKey(tx, caller.key_id);
        if (named && own !== named)
          refuse("forbidden", "This Asset is not yours");
        asset_id = own ?? null;
      } else if (caller.kind === "gateway") {
        if (
          !named ||
          !entities.carriedBy(tx, caller.gateway_id).includes(named)
        )
          refuse("forbidden", "This gateway does not carry that Asset");
        asset_id = named;
      }
    }
  }
  if (caller.kind === "asset" && actsFor === "query:asset_id" && !asset_id)
    refuse("forbidden", "Register an Asset before creating shared data");
  const by =
    caller.kind === "account"
      ? caller.operator_id
      : caller.kind === "asset"
        ? (asset_id ?? caller.key_id)
        : caller.kind === "gateway"
          ? (asset_id ?? caller.gateway_id)
          : caller.kind === "plugin"
            ? caller.plugin_id
            : "";
  const scope =
    caller.kind === "account"
      ? `account:${by}`
      : caller.kind === "asset"
        ? `asset_key:${caller.key_id}`
        : caller.kind === "gateway"
          ? `gateway:${caller.gateway_id}`
          : caller.kind === "plugin"
            ? `plugin:${caller.plugin_id}`
            : "anonymous";
  return {
    caller,
    asset_id,
    by,
    scope,
    heard:
      caller.kind === "gateway"
        ? { gateway_id: caller.gateway_id }
        : caller.kind === "plugin"
          ? { plugin_id: caller.plugin_id }
          : asset_id
            ? { asset_id }
            : null,
  };
}
