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
        heartbeat_s: positive,
        subsystems: z.strictObject({ gps: z.string().optional(), flight_controller: z.string().optional() }).optional(),
      }),
      z.strictObject({
        kind: z.enum(["peripheral", "gpsd"]),
        host: z.string().min(1),
        port: z.int().min(1).max(65535),
        max_message_bytes: z.int().positive(),
        reconnect_s: positive,
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
    ),
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
    ),
    completion_tolerances: z.partialRecord(
      command,
      z.strictObject({
        horizontal_m: nonnegative,
        altitude_m: nonnegative,
        stopped_mps: nonnegative,
      }),
    ).default({}),
    command_timeouts: z.partialRecord(command, positive).default({}),
    default_ground_speed_mps: nonnegative.optional(),
    max_ground_speed_mps: positive.optional(),
    measurement_stale_after_s: positive,
    final_report_wait_s: nonnegative,
    control_tick_s: positive,
    reporting: z.strictObject({ heartbeat_s: positive }),
    log_level: z.enum(["error", "warn", "info", "debug", "trace"]),
    log_directory: z.string().min(1),
    log_message_content: z.boolean(),
    log_queue_limit: z.int().positive(),
    log_file_limit_bytes: z.int().positive(),
    log_total_limit_bytes: z.int().positive(),
    archive_directory: z.string().min(1),
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
    for (const kind of c.description.commands) {
      if (kind !== "failsafe" && !isCommand(kind))
        fail(["description", "commands"], `unsupported command ${kind}`);
      if (isCommand(kind)) {
        if (!c.completion_tolerances[kind]) fail(["completion_tolerances", kind], "required for movement");
        if (!c.command_timeouts[kind]) fail(["command_timeouts", kind], "required for movement");
      }
    }
    if (c.description.commands.some(isCommand)) {
      if (c.default_ground_speed_mps === undefined) fail(["default_ground_speed_mps"], "required for movement");
      if (c.max_ground_speed_mps === undefined) fail(["max_ground_speed_mps"], "required for movement");
    }
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
  return { ...config, asset_key: "[removed]" };
}
