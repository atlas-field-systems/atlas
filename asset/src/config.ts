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
const command = z.enum([
  "takeoff",
  "move_to",
  "land",
  "hold",
  "return_to_home",
  "failsafe",
]);
const schema = z
  .strictObject({
    asset_key: z.string().min(1),
    link: z.strictObject({ core_url: z.url() }),
    description: shared<P["requests.asset"]>("requests.asset"),
    equipment: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("ardupilot"),
        host: z.string().min(1),
        port: z.int().min(1).max(65535),
        system_id: z.int().min(1).max(255),
        heartbeat_s: positive,
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
    initial_settings: shared<ComponentsSettings>(
      "requests.settings",
      (settings) => ({ settings }),
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
    completion_tolerances: z.strictObject({
      horizontal_m: nonnegative,
      altitude_m: nonnegative,
      stopped_mps: nonnegative,
    }),
    command_timeouts: z.record(command, positive),
    default_ground_speed_mps: nonnegative,
    max_ground_speed_mps: positive,
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
    if (c.default_ground_speed_mps > c.max_ground_speed_mps)
      fail(["default_ground_speed_mps"], "exceeds max_ground_speed_mps");
    for (const kind of c.description.commands) {
      if (!command.safeParse(kind).success)
        fail(["description", "commands"], `unsupported command ${kind}`);
    }
    for (const response of [
      c.safe_action,
      ...(c.initial_settings.failsafe_policy ?? []).map((r) => r.response),
    ]) {
      if (!c.description.commands.includes(response.kind))
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
