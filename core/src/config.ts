import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
export interface CoreConfig {
  listen_address: string;
  port: number;
  tls_certificate: string | null;
  tls_key: string | null;
  data_directory: string;
  first_admin: { operator_id: string; password_file: string } | null;
  offline_after_s: number;
  max_object_bytes: number;
  clock_ahead_s: number;
  log_level: "error" | "warn" | "info" | "debug" | "trace";
  log_directory: string;
  log_message_content: boolean;
  log_file_limit_bytes: number;
  log_total_limit_bytes: number;
  debug_endpoint: boolean;
  archive_directory: string;
}

export const CONFIG_DEFAULTS: Omit<
  CoreConfig,
  "log_directory" | "archive_directory"
> = {
  listen_address: "0.0.0.0",
  port: 8443,
  tls_certificate: null,
  tls_key: null,
  data_directory: "/var/lib/atlas-core",
  first_admin: null,
  offline_after_s: 30,
  max_object_bytes: 100_000_000,
  clock_ahead_s: 10,
  log_level: "trace",
  log_message_content: true,
  log_file_limit_bytes: 64 * 1024 * 1024,
  log_total_limit_bytes: 2 * 1024 * 1024 * 1024,
  debug_endpoint: false,
};

export type ConfigProblem = { key: string; explanation: string };

export function resolveConfig(
  partial: Partial<CoreConfig>,
): { ok: true; config: CoreConfig } | { ok: false; problems: ConfigProblem[] } {
  const dataDirectory = resolve(
    partial.data_directory ?? CONFIG_DEFAULTS.data_directory,
  );
  const config = {
    ...CONFIG_DEFAULTS,
    log_directory: join(dataDirectory, "diagnostics"),
    archive_directory: `${dataDirectory}-archive`,
    ...partial,
  };
  const problems: ConfigProblem[] = [];
  const fail = (key: string, explanation: string) =>
    problems.push({ key, explanation });
  for (const [key, value] of Object.entries(partial)) {
    if (
      !(key in config) ||
      !(
        key in CONFIG_DEFAULTS ||
        key === "log_directory" ||
        key === "archive_directory"
      )
    )
      fail(key, "unknown option");
    else if (
      key !== "first_admin" &&
      key !== "tls_certificate" &&
      key !== "tls_key" &&
      typeof value !== typeof configDefault(key)
    )
      fail(key, "wrong type");
  }
  function configDefault(key: string): unknown {
    return Reflect.get(
      { ...CONFIG_DEFAULTS, log_directory: "", archive_directory: "" },
      key,
    );
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535)
    fail("port", "must be an integer from 0 to 65535");
  for (const key of [
    "offline_after_s",
    "clock_ahead_s",
    "max_object_bytes",
    "log_file_limit_bytes",
    "log_total_limit_bytes",
  ] as const)
    if (!Number.isFinite(config[key]) || config[key] <= 0)
      fail(key, "must be positive");
  for (const key of [
    "listen_address",
    "data_directory",
    "log_directory",
    "archive_directory",
  ] as const)
    if (typeof config[key] !== "string" || !config[key])
      fail(key, "must be a nonempty path or address");
  for (const key of ["tls_certificate", "tls_key"] as const)
    if (
      config[key] !== null &&
      (typeof config[key] !== "string" || !config[key])
    )
      fail(key, "must be a PEM path or null");
  if (!!config.tls_certificate !== !!config.tls_key)
    fail("tls_key", "both TLS paths must be set");
  if (
    !config.tls_key &&
    !["127.0.0.1", "::1", "localhost"].includes(config.listen_address)
  )
    fail("listen_address", "plain HTTP requires loopback");
  if (!["error", "warn", "info", "debug", "trace"].includes(config.log_level))
    fail("log_level", "unknown level");
  if (
    config.first_admin !== null &&
    (typeof config.first_admin !== "object" ||
      !/^[a-zA-Z0-9]{1,4}$/.test(config.first_admin.operator_id) ||
      typeof config.first_admin.password_file !== "string")
  )
    fail("first_admin", "requires operator_id and password_file");
  return problems.length ? { ok: false, problems } : { ok: true, config };
}

export async function readConfigFile(
  path: string,
  env: NodeJS.ProcessEnv,
): Promise<Partial<CoreConfig>> {
  const input: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("config must be an object");
  const config = { ...input };
  for (const [key, value] of Object.entries(env))
    if (key.startsWith("ATLAS_CORE_") && value !== undefined) {
      const name = key.slice(11).toLowerCase();
      let parsed: unknown = value;
      try {
        parsed = JSON.parse(value);
      } catch {}
      Object.assign(config, { [name]: parsed });
    }
  return config;
}

export function redactConfig(config: CoreConfig): Record<string, unknown> {
  return {
    ...config,
    first_admin: config.first_admin
      ? {
          operator_id: config.first_admin.operator_id,
          password_file: "[redacted]",
        }
      : null,
  };
}

export interface Paths {
  database: string; // <data_directory>/core.sqlite (+ -wal, -shm)
  objectsDir(runId: number): string; // <data_directory>/objects/run-<run_id>/
  uploadsDir: string; // <data_directory>/uploads/ (partial uploads; swept at start)
  logDir(runId: number): string; // <log_directory>/run-<run_id>/
  zipFinal(runId: number, startedAt: number): string; // <archive_directory>/core-run-<id>-<YYYYMMDDTHHMMSSZ>.zip
  zipPartial(runId: number, startedAt: number): string; // same name + '.partial'
}

export function pathsFor(config: CoreConfig): Paths {
  const zip = (id: number, at: number) =>
    join(
      config.archive_directory,
      `core-run-${id}-${new Date(at)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z/, "Z")}.zip`,
    );
  return {
    database: join(config.data_directory, "core.sqlite"),
    uploadsDir: join(config.data_directory, "uploads"),
    objectsDir: (id) => join(config.data_directory, "objects", `run-${id}`),
    logDir: (id) => join(config.log_directory, `run-${id}`),
    zipFinal: zip,
    zipPartial: (id, at) => zip(id, at) + ".partial",
  };
}
