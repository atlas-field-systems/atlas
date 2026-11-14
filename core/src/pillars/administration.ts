import * as entities from "./entities.ts";
import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { nextGlobalId } from "../store/runs.ts";
import { dropUnsettled } from "../store/events.ts";
import { refuse } from "../api/errors.ts";
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { ReadTx, TableDef, Tx } from "../store/db.ts";

type Contact = ProtocolTypes["contact"];
type PluginDescription = ProtocolTypes["plugin.description"];

export const TABLES: TableDef[] = [
  {
    owner: "administration",
    name: "identity_heard",
    runScoped: true,
    ddl: `CREATE TABLE IF NOT EXISTS identity_heard (
      run_id INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
      time INTEGER NOT NULL, PRIMARY KEY(run_id,kind,id)
    );`,
  },
  {
    owner: "administration",
    name: "asset_key_mismatches",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS asset_key_mismatches (
  run_id           INTEGER NOT NULL,
  key_id           TEXT NOT NULL,
  definitions_hash TEXT NOT NULL,
  PRIMARY KEY(run_id,key_id,definitions_hash)
);`,
  },

  {
    owner: "administration",
    name: "accounts",
    runScoped: false,
    ddl: `
CREATE TABLE IF NOT EXISTS accounts (
  operator_id   TEXT PRIMARY KEY,          -- 1..4 letters or digits (requested_by pattern)
  admin         INTEGER NOT NULL,          -- 1 admin, 0 operator
  password_hash TEXT NOT NULL              -- 'scrypt$N$r$p$<salt b64>$<hash b64>'
);`,
  },
  {
    owner: "administration",
    name: "sessions",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  run_id      INTEGER NOT NULL,            -- a session ends with its run; a crash ends none
  operator_id TEXT NOT NULL REFERENCES accounts(operator_id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  ended       INTEGER NOT NULL DEFAULT 0
);`,
  },
  {
    owner: "administration",
    name: "asset_keys",
    runScoped: false,
    ddl: `
CREATE TABLE IF NOT EXISTS asset_keys (
  key_id   TEXT PRIMARY KEY,               -- from the global short-ID sequence
  key_hash TEXT NOT NULL UNIQUE
);`,
  },
  {
    owner: "administration",
    name: "gateways",
    runScoped: false,
    ddl: `
CREATE TABLE IF NOT EXISTS gateways (
  gateway_id     TEXT PRIMARY KEY,         -- from the global short-ID sequence, never reused
  key_hash       TEXT UNIQUE,
  removed        INTEGER NOT NULL DEFAULT 0,
  contact_run_id INTEGER,                  -- contact belongs to a run: any other run reads as offline,
  contact        TEXT                      -- so a new run starts every gateway offline without a clear
);`,
  },
  {
    owner: "administration",
    name: "plugins",
    runScoped: false,
    ddl: `
CREATE TABLE IF NOT EXISTS plugins (
  plugin_id      TEXT PRIMARY KEY,
  key_hash       TEXT UNIQUE,
  removed        INTEGER NOT NULL DEFAULT 0,
  description    TEXT,                     -- latest plugin.description; carried over runs ("installed Plugin setup")
  contact_run_id INTEGER,
  contact        TEXT
);`,
  },
];

export type Caller =
  | { kind: "account"; operator_id: string; admin: boolean; token_hash: string }
  | { kind: "asset"; key_id: string } // the registered asset_id comes from Entities.assetForKey
  | { kind: "gateway"; gateway_id: string }
  | { kind: "plugin"; plugin_id: string }
  | { kind: "anonymous" };

export type Issued<Shown, Ack> = { shown: Shown; ack: Ack };

export function callerFor(
  tx: ReadTx,
  credential: { bearer: string } | { session: string } | null,
  includeEnded = false,
): Caller | undefined {
  if (!credential) return { kind: "anonymous" };
  if ("session" in credential) {
    const row = tx.get<{
      operator_id: string;
      admin: number;
      token_hash: string;
    }>(
      "SELECT a.operator_id,a.admin,s.token_hash FROM sessions s JOIN accounts a USING(operator_id) WHERE s.run_id=? AND s.token_hash=? AND (s.ended=0 OR ?)",
      tx.runId,
      digest(credential.session),
      includeEnded ? 1 : 0,
    );
    return row
      ? {
          kind: "account",
          operator_id: row.operator_id,
          admin: !!row.admin,
          token_hash: row.token_hash,
        }
      : undefined;
  }
  const hash = digest(credential.bearer);
  const asset = tx.get<{ key_id: string }>(
    "SELECT key_id FROM asset_keys WHERE key_hash=?",
    hash,
  );
  if (asset) return { kind: "asset", ...asset };
  const gateway = tx.get<{ gateway_id: string }>(
    "SELECT gateway_id FROM gateways WHERE key_hash=?",
    hash,
  );
  if (gateway) return { kind: "gateway", ...gateway };
  const plugin = tx.get<{ plugin_id: string }>(
    "SELECT plugin_id FROM plugins WHERE key_hash=?",
    hash,
  );
  if (plugin) return { kind: "plugin", ...plugin };
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64");
  const key = await derive(password, salt, 64);
  return `scrypt$16384$8$1$${salt}$${key.toString("base64")}`;
}
export async function verifyPassword(
  stored: string,
  password: string,
): Promise<boolean> {
  const [, n, r, p, salt, hash] = stored.split("$");
  if (n !== "16384" || r !== "8" || p !== "1" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function passwordHashOf(
  tx: ReadTx,
  operator_id: string,
): string | undefined {
  return tx.get<{ password_hash: string }>(
    "SELECT password_hash FROM accounts WHERE operator_id=?",
    operator_id,
  )?.password_hash;
}

export function createSession(
  tx: Tx,
  operator_id: string,
): Issued<{ cookie: string }, { operator_id: string; logged_in: true }> {
  requireRow(tx, "accounts", "operator_id", operator_id);
  const token = randomBytes(32).toString("base64url");
  tx.run(
    "INSERT INTO sessions(token_hash,run_id,operator_id,created_at) VALUES (?,?,?,?)",
    digest(token),
    tx.runId,
    operator_id,
    tx.now,
  );
  return {
    shown: {
      cookie: `atlas_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`,
    },
    ack: { operator_id, logged_in: true },
  };
}
export function endSession(tx: Tx, token_hash: string): void {
  tx.run(
    "UPDATE sessions SET ended=1 WHERE token_hash=? AND run_id=?",
    token_hash,
    tx.runId,
  );
}
export function me(
  tx: ReadTx,
  operator_id: string,
): { operator_id: string; admin: boolean } {
  const row = tx.get<{ operator_id: string; admin: number }>(
    "SELECT operator_id,admin FROM accounts WHERE operator_id=?",
    operator_id,
  );
  if (!row) refuse("not_found", "No such account");
  return { ...row, admin: !!row.admin };
}

export function addAccount(
  tx: Tx,
  body: { operator_id: string; admin: boolean },
  passwordHash: string,
): { operator_id: string } {
  if (
    tx.get("SELECT 1 FROM accounts WHERE operator_id=?", body.operator_id) ||
    tx.get(
      "SELECT 1 FROM gateways WHERE gateway_id=? AND removed=0",
      body.operator_id,
    ) ||
    tx.get(
      "SELECT 1 FROM plugins WHERE plugin_id=? AND removed=0",
      body.operator_id,
    ) ||
    tx.get("SELECT 1 FROM asset_keys WHERE key_id=?", body.operator_id) ||
    entities.assetIdInUse(tx, body.operator_id)
  )
    refuse("id_taken", "That identity is in use");
  tx.run(
    "INSERT INTO accounts VALUES (?,?,?)",
    body.operator_id,
    body.admin ? 1 : 0,
    passwordHash,
  );
  return { operator_id: body.operator_id };
}
export function removeAccount(tx: Tx, operator_id: string): void {
  requireRow(tx, "accounts", "operator_id", operator_id);
  tx.run("DELETE FROM accounts WHERE operator_id=?", operator_id);
}
export function ensureFirstAdmin(
  tx: Tx,
  operator_id: string,
  passwordHash: string,
): boolean {
  if (tx.get("SELECT 1 FROM accounts LIMIT 1")) return false;
  addAccount(tx, { operator_id, admin: true }, passwordHash);
  return true;
}

export function createAssetKey(
  tx: Tx,
): Issued<{ key_id: string; key: string }, { key_id: string; issued: true }> {
  const key_id = nextId(tx);
  const key = issue(tx, "asset_keys", "key_id", key_id);
  return { shown: { key_id, key }, ack: { key_id, issued: true } };
}
export function replaceAssetKey(
  tx: Tx,
  key_id: string,
): Issued<{ key_id: string; key: string }, { key_id: string; replaced: true }> {
  const key = replace(tx, "asset_keys", "key_id", key_id);
  return { shown: { key_id, key }, ack: { key_id, replaced: true } };
}
export function removeAssetKey(tx: Tx, key_id: string): void {
  requireRow(tx, "asset_keys", "key_id", key_id);
  tx.run("DELETE FROM asset_keys WHERE key_id=?", key_id);
}

export function provisionGateway(
  tx: Tx,
  by: string,
): Issued<
  { gateway_id: string; key: string; event_id: number },
  { gateway_id: string; event_id: number; issued: true }
> {
  const gateway_id = nextId(tx);
  const key = issue(tx, "gateways", "gateway_id", gateway_id);
  tx.run(
    "UPDATE gateways SET contact_run_id=? WHERE gateway_id=?",
    tx.runId,
    gateway_id,
  );
  const event_id = tx.append("gateway.provisioned", {
    time: tx.now,
    gateway_id,
    requested_by: by,
  });
  return {
    shown: { gateway_id, key, event_id },
    ack: { gateway_id, event_id, issued: true },
  };
}
export function replaceGatewayKey(
  tx: Tx,
  gateway_id: string,
): Issued<
  { gateway_id: string; key: string },
  { gateway_id: string; replaced: true }
> {
  const key = replace(tx, "gateways", "gateway_id", gateway_id);
  return { shown: { gateway_id, key }, ack: { gateway_id, replaced: true } };
}
export function removeGateway(
  tx: Tx,
  gateway_id: string,
  by: string,
): { event_id: number } {
  requireRow(tx, "gateways", "gateway_id", gateway_id);
  tx.run(
    "UPDATE gateways SET removed=1,key_hash=NULL,contact_run_id=?,contact=? WHERE gateway_id=?",
    tx.runId,
    JSON.stringify({
      time: lastIdentityHeard(tx, "gateway", gateway_id) ?? tx.now,
      gateway_id,
      contact: "offline",
    }),
    gateway_id,
  );
  const event_id = tx.append("gateway.removed", {
    time: tx.now,
    gateway_id,
    requested_by: by,
  });
  for (const asset_id of entities.carriedBy(tx, gateway_id))
    entities.applyContact(tx, asset_id, {
      time: entities.lastHeard(tx, asset_id) ?? tx.now,
      asset_id,
      contact: "offline",
    });
  return { event_id };
}

export function provisionPlugin(
  tx: Tx,
  by: string,
): Issued<
  { plugin_id: string; key: string; event_id: number },
  { plugin_id: string; event_id: number; issued: true }
> {
  const plugin_id = nextId(tx);
  const key = issue(tx, "plugins", "plugin_id", plugin_id);
  tx.run(
    "UPDATE plugins SET contact_run_id=? WHERE plugin_id=?",
    tx.runId,
    plugin_id,
  );
  const event_id = tx.append("plugin.provisioned", {
    time: tx.now,
    plugin_id,
    requested_by: by,
  });
  return {
    shown: { plugin_id, key, event_id },
    ack: { plugin_id, event_id, issued: true },
  };
}
export function replacePluginKey(
  tx: Tx,
  plugin_id: string,
): Issued<
  { plugin_id: string; key: string },
  { plugin_id: string; replaced: true }
> {
  const key = replace(tx, "plugins", "plugin_id", plugin_id);
  return { shown: { plugin_id, key }, ack: { plugin_id, replaced: true } };
}
export function removePlugin(
  tx: Tx,
  plugin_id: string,
  by: string,
): { event_id: number } {
  requireRow(tx, "plugins", "plugin_id", plugin_id);
  tx.run(
    "UPDATE plugins SET removed=1,key_hash=NULL,contact_run_id=?,contact=? WHERE plugin_id=?",
    tx.runId,
    JSON.stringify({
      time: lastIdentityHeard(tx, "plugin", plugin_id) ?? tx.now,
      plugin_id,
      contact: "offline",
    }),
    plugin_id,
  );
  const event_id = tx.append("plugin.removed", {
    time: tx.now,
    plugin_id,
    requested_by: by,
  });
  dropUnsettled(tx, { plugin_id });
  return { event_id };
}

export type ContactState = "online" | "offline";

export function gatewayContact(tx: ReadTx, gateway_id: string): Contact {
  const row = tx.get<{ contact_run_id: number; contact: string | null }>(
    "SELECT contact_run_id,contact FROM gateways WHERE gateway_id=? AND removed=0",
    gateway_id,
  );
  if (!row) refuse("not_found", "No such gateway");
  return row.contact_run_id === tx.runId && row.contact
    ? JSON.parse(row.contact)
    : { time: tx.now, gateway_id, contact: "offline" };
}
export function pluginContact(tx: ReadTx, plugin_id: string): Contact {
  const row = tx.get<{ contact_run_id: number; contact: string | null }>(
    "SELECT contact_run_id,contact FROM plugins WHERE plugin_id=? AND removed=0",
    plugin_id,
  );
  if (!row) refuse("not_found", "No such plugin");
  return row.contact_run_id === tx.runId && row.contact
    ? JSON.parse(row.contact)
    : { time: tx.now, plugin_id, contact: "offline" };
}
export function setGatewayContact(
  tx: Tx,
  gateway_id: string,
  state: ContactState,
  lastHeard: number,
): boolean {
  if (state === "online") noteIdentityHeard(tx, "gateway", gateway_id);
  if (gatewayContact(tx, gateway_id).contact === state) return false;
  const record = { time: lastHeard, gateway_id, contact: state };
  tx.run(
    "UPDATE gateways SET contact_run_id=?,contact=? WHERE gateway_id=?",
    tx.runId,
    JSON.stringify(record),
    gateway_id,
  );
  tx.append("gateway.contact", record);
  return true;
}
export function setPluginContact(
  tx: Tx,
  plugin_id: string,
  state: ContactState,
  lastHeard: number,
): boolean {
  if (state === "online") noteIdentityHeard(tx, "plugin", plugin_id);
  if (pluginContact(tx, plugin_id).contact === state) return false;
  const record = { time: lastHeard, plugin_id, contact: state };
  tx.run(
    "UPDATE plugins SET contact_run_id=?,contact=? WHERE plugin_id=?",
    tx.runId,
    JSON.stringify(record),
    plugin_id,
  );
  tx.append("plugin.contact", record);
  return true;
}
export function onlineGatewaysAndPlugins(tx: ReadTx): {
  gateway_ids: string[];
  plugin_ids: string[];
} {
  return {
    gateway_ids: tx
      .all<{
        gateway_id: string;
      }>(
        "SELECT gateway_id FROM gateways WHERE removed=0 AND contact_run_id=? AND json_extract(contact,'$.contact')='online'",
        tx.runId,
      )
      .map((r) => r.gateway_id),
    plugin_ids: tx
      .all<{
        plugin_id: string;
      }>(
        "SELECT plugin_id FROM plugins WHERE removed=0 AND contact_run_id=? AND json_extract(contact,'$.contact')='online'",
        tx.runId,
      )
      .map((r) => r.plugin_id),
  };
}

export function pluginDescription(
  tx: ReadTx,
  plugin_id: string,
): PluginDescription | undefined {
  const row = tx.get<{ description: string | null }>(
    "SELECT description FROM plugins WHERE plugin_id=? AND removed=0",
    plugin_id,
  );
  return row?.description ? JSON.parse(row.description) : undefined;
}
export function setPluginDescription(
  tx: Tx,
  description: PluginDescription,
): { event_id: number } {
  requireRow(tx, "plugins", "plugin_id", description.plugin_id);
  tx.run(
    "UPDATE plugins SET description=? WHERE plugin_id=?",
    JSON.stringify(description),
    description.plugin_id,
  );
  return { event_id: tx.append("plugin.described", description) };
}
export function listPlugins(tx: ReadTx): {
  plugin_id: string;
  description: PluginDescription | null;
  contact: Contact;
}[] {
  return tx
    .all<{
      plugin_id: string;
      description: string | null;
    }>("SELECT plugin_id,description FROM plugins WHERE removed=0")
    .map((r) => ({
      plugin_id: r.plugin_id,
      description: r.description ? JSON.parse(r.description) : null,
      contact: pluginContact(tx, r.plugin_id),
    }));
}

export function exportRows(tx: ReadTx): {
  gateways: unknown[];
  plugins: unknown[];
} {
  return {
    gateways: tx.all(
      "SELECT gateway_id,contact_run_id,contact FROM gateways WHERE removed=0",
    ),
    plugins: tx.all(
      "SELECT plugin_id,description,contact_run_id,contact FROM plugins WHERE removed=0",
    ),
  };
}

const derive = (
  password: string,
  salt: string,
  length: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, length, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function nextId(tx: Tx): string {
  return (
    nextGlobalId(tx) ??
    refuse("asset_ids_exhausted", "All short IDs have been assigned")
  );
}
function requireRow(
  tx: ReadTx,
  table: string,
  column: string,
  id: string,
): void {
  const active =
    table === "gateways" || table === "plugins" ? " AND removed=0" : "";
  if (!tx.get(`SELECT 1 FROM ${table} WHERE ${column}=?${active}`, id))
    refuse("not_found", "No such identity");
}
function issue(tx: Tx, table: string, column: string, id: string): string {
  const key = randomBytes(16).toString("base64url");
  tx.run(
    `INSERT INTO ${table}(${column},key_hash) VALUES (?,?)`,
    id,
    digest(key),
  );
  return key;
}
function replace(tx: Tx, table: string, column: string, id: string): string {
  requireRow(tx, table, column, id);
  const key = randomBytes(16).toString("base64url");
  tx.run(`UPDATE ${table} SET key_hash=? WHERE ${column}=?`, digest(key), id);
  return key;
}

export function unregisteredMismatch(
  tx: Tx,
  key_id: string,
  definitions_hash: string,
): void {
  const inserted = tx.run(
    "INSERT OR IGNORE INTO asset_key_mismatches VALUES (?,?,?)",
    tx.runId,
    key_id,
    definitions_hash,
  );
  if (!inserted.changes) return;
  tx.env.log.record({
    level: "warn",
    area: "definitions",
    msg: "Unregistered Asset definitions mismatch",
    key_id,
    definitions_hash,
  });
  process.stderr.write(
    `Unregistered Asset key ${key_id} uses definitions ${definitions_hash}\n`,
  );
}

function noteIdentityHeard(
  tx: Tx,
  kind: "gateway" | "plugin",
  id: string,
): void {
  tx.run(
    "INSERT INTO identity_heard VALUES (?,?,?,?) ON CONFLICT(run_id,kind,id) DO UPDATE SET time=excluded.time",
    tx.runId,
    kind,
    id,
    tx.now,
  );
}
export function lastIdentityHeard(
  tx: ReadTx,
  kind: "gateway" | "plugin",
  id: string,
): number | undefined {
  return tx.get<{ time: number }>(
    "SELECT time FROM identity_heard WHERE run_id=? AND kind=? AND id=?",
    tx.runId,
    kind,
    id,
  )?.time;
}
