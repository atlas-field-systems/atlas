import { commands, isCommand } from "./commands.ts";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { loadPackagedProtocol } from "@atlas/protocol";
import type {
  ProtocolTypes as P,
  ComponentsPosition,
  ComponentsSettings,
  ComponentsFailsafeResponse,
} from "@atlas/protocol/types";

const protocol = await loadPackagedProtocol();
function shared<T>(
  name: string,
  wrap: (value: unknown) => unknown = (value) => value,
) {
  return z.custom<T>(
    (value) => protocol.check(name, wrap(value)).ok,
    `invalid ${name}`,
  );
}
const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
const command = z.enum(Object.keys(commands).filter(isCommand));
const commandTimeouts = { takeoff: 60, move_to: 120, land: 120, hold: 10, return_to_home: 180 } satisfies Record<keyof typeof commands, number>;
const tolerance = z.strictObject({
  horizontal_m: nonnegative.default(2),
  altitude_m: nonnegative.default(0.5),
  stopped_mps: nonnegative.default(0.3),
});
const schema = z
  .strictObject({
    asset_key: z.string().min(1),
    link: z.strictObject({
      core_url: z.url(),
    }),
    description: shared<P["requests.asset"]>("requests.asset"),
    equipment: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("ardupilot"),
        host: z.string().min(1),
        port: z.int().min(1).max(65535),
        system_id: z.int().min(1).max(255),
        heartbeat_s: positive.default(1),
        stream_rate_hz: z.int().min(1).max(65535).default(5),
        extended_state_interval_us: z.int().min(1).max(2147483647).default(200000),
        subsystems: z.strictObject({ gps: z.string().optional(), flight_controller: z.string().optional() }).optional(),
      }),
      z.strictObject({
        kind: z.enum(["peripheral", "gpsd"]),
        host: z.string().min(1),
        port: z.int().min(1).max(65535),
        max_message_bytes: z.int().positive().default(65536),
        reconnect_s: positive.default(1),
      }),
      z.strictObject({
        kind: z.literal("simulated"),
        position: shared<ComponentsPosition>(
          "report.telemetry",
          (position) => ({
            type: "report.telemetry",
            time: 0,
            asset_id: "A",
            position,
          }),
        ),
      }),
    ]),
    initial_settings: z.custom<ComponentsSettings>(
      (value) => protocol.check("requests.settings", { settings: value }).ok ||
        (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0),
      "invalid requests.settings",
    ).optional(),
    safe_action: shared<ComponentsFailsafeResponse>(
      "report.failsafe",
      (response) => ({
        type: "report.failsafe",
        kind: "response",
        time: 0,
        asset_id: "A",
        task_state: "active",
        response,
      }),
    ).optional(),
    completion_tolerances: z.partialRecord(command, tolerance).default({}),
    command_timeouts: z.partialRecord(command, positive).default({}),
    default_ground_speed_mps: nonnegative.optional(),
    max_ground_speed_mps: positive.optional(),
    measurement_stale_after_s: positive.default(5),
    final_report_wait_s: nonnegative.default(30),
    control_tick_s: positive.default(0.1),
    reporting: z.strictObject({ heartbeat_s: positive.default(5) }).prefault({}),
    log_level: z.enum(["error", "warn", "info", "debug", "trace"]).default("trace"),
    log_directory: z.string().min(1).default("./asset-logs"),
    log_message_content: z.boolean().default(true),
    log_queue_limit: z.int().positive().default(4096),
    log_file_limit_bytes: z.int().positive().default(67108864),
    log_total_limit_bytes: z.int().positive().default(2147483648),
    archive_directory: z.string().min(1).default("./asset-archives"),
  })
  .transform((c, ctx) => {
    if (c.initial_settings === undefined &&
      (c.description.commands.length || c.description.settings?.length)) {
      ctx.addIssue({ code: "custom", path: ["initial_settings"], message: "required for control-capable equipment" });
    }
    const movement = c.description.commands.filter(isCommand);
    const reachable = new Set(movement);
    if (movement.length) reachable.add("hold");
    if (c.initial_settings?.failsafe_policy?.some(rule =>
      rule.conditions.some(condition => condition.kind === "battery_below" && condition.critical)))
      reachable.add("return_to_home");
    for (const kind of reachable) {
      c.completion_tolerances[kind] ??= tolerance.parse({});
      c.command_timeouts[kind] ??= commandTimeouts[kind];
    }
    if (movement.length) {
      c.default_ground_speed_mps ??= 3;
      c.max_ground_speed_mps ??= 8;
    }
    return { ...c, initial_settings: c.initial_settings ?? {} };
  })
  .superRefine((c, ctx) => {
    const fail = (path: string[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (
      c.description.commands.includes("takeoff") &&
      !(c.initial_settings.failsafe_policy ?? []).some((r) =>
        r.conditions.some(
          (condition) =>
            condition.kind === "battery_below" && condition.critical,
        ),
      )
    )
      fail(
        ["initial_settings", "failsafe_policy"],
        "flying equipment requires a critical battery rule",
      );
    if ((c.default_ground_speed_mps ?? 0) > (c.max_ground_speed_mps ?? Infinity))
      fail(["default_ground_speed_mps"], "exceeds max_ground_speed_mps");
    const movement = c.description.commands.filter(isCommand);
    for (const kind of c.description.commands)
      if (kind !== "failsafe" && !isCommand(kind))
        fail(["description", "commands"], `unsupported command ${kind}`);
    if (movement.length && (c.equipment.kind === "gpsd" || c.equipment.kind === "peripheral"))
      fail(["description", "commands"], "acquisition-only equipment cannot execute movement");
    if (c.equipment.kind === "ardupilot") {
      const ids = Object.values(c.equipment.subsystems ?? {});
      if (new Set(ids).size !== ids.length) fail(["equipment", "subsystems"], "duplicate subsystem mapping");
      for (const id of ids)
        if (!c.description.subsystems?.some(s => s.subsystem_id === id))
          fail(["equipment", "subsystems"], `undeclared subsystem ${id}`);
    }
    const identities = new Set<string>();
    const priorities = new Set<number>();
    const subsystems = new Set((c.description.subsystems ?? []).map(s => s.subsystem_id));
    for (const rule of c.initial_settings.failsafe_policy ?? []) {
      if (identities.has(rule.rule_id)) fail(["initial_settings", "failsafe_policy"], "duplicate rule_id");
      if (priorities.has(rule.priority)) fail(["initial_settings", "failsafe_policy"], "duplicate priority");
      identities.add(rule.rule_id);
      priorities.add(rule.priority);
      for (const condition of rule.conditions)
        if (condition.kind === "subsystem" && !subsystems.has(condition.subsystem_id))
          fail(["initial_settings", "failsafe_policy"], `undeclared subsystem ${condition.subsystem_id}`);
    }
    if (!c.description.commands.length) return;
    if (!c.safe_action) {
      fail(["safe_action"], "required for command-capable equipment");
      return;
    }
    for (const response of [
      c.safe_action,
      ...(c.initial_settings.failsafe_policy ?? []).map((r) => r.response),
    ]) {
      if (
        !isCommand(response.kind) ||
        !commands[response.kind].response ||
        !c.description.commands.includes(response.kind)
      )
        fail(
          ["initial_settings"],
          `response ${response.kind} is not supported`,
        );
    }
  });
export type Config = z.infer<typeof schema>;
export function parseConfig(value: unknown): Config {
  return schema.parse(value);
}
export async function readConfig(path: string): Promise<Config> {
  return parseConfig(JSON.parse(await readFile(path, "utf8")));
}
export function inspectConfig(config: Config) {
  const core = new URL(config.link.core_url);
  core.username = "";
  core.password = "";
  return { ...config, asset_key: "[removed]", link: { ...config.link, core_url: core.href } };
}
