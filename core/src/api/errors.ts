export const REFUSALS = {
  invalid: 400, // api.md: body fails Protocol's validator (explanation lists paths)
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  asset_ids_exhausted: 409, // api.md
  definitions_mismatch: 409, // api.md
  no_critical_battery_rule: 409, // api.md
  queue_full: 409, // api.md
  asset_offline: 409,
  plugin_offline: 409,
  not_supported: 409, // command, setting, camera, or Plugin action not in the description
  task_ended: 409,
  task_ids_exhausted: 409, // doc gap G9
  call_settled: 409, // second answer, or answer to a dropped call
  not_a_point: 409, // move_to / land naming a place that is not a point
  not_geotiff: 409,
  imagery_fixed: 409, // a PUT on imagery other than its name, or into imagery
  object_shown: 409, // deleting an Object an imagery geo feature shows
  id_taken: 409, // an operator_id that names an Asset, gateway, Plugin, or account
  idempotency_conflict: 409, // same Idempotency-Key, different body
  deleted: 410, // api.md; body adds the deletion record
  too_large: 413, // api.md
  stopping: 503, // Core is stopping (doc gap G26)
  storage_full: 507, // api.md
} as const;

export type RefusalCode = keyof typeof REFUSALS;

export class Refusal extends Error {
  readonly code: RefusalCode;
  readonly status: number;
  readonly extra: Record<string, unknown> | undefined;
  constructor(
    code: RefusalCode,
    explanation: string,
    extra?: Record<string, unknown>,
  ) {
    super(explanation);
    this.code = code;
    this.status = REFUSALS[code];
    this.extra = extra;
  }
}

export function refuse(
  code: RefusalCode,
  explanation: string,
  extra?: Record<string, unknown>,
): never {
  throw new Refusal(code, explanation, extra);
}

export function checkOrRefuse<T>(
  protocol: {
    check(
      name: string,
      value: unknown,
    ):
      | { ok: true }
      | { ok: false; problems: { path: string; message: string }[] };
  },
  name: string,
  value: unknown,
): T {
  const result = protocol.check(name, value);
  if (!result.ok)
    refuse(
      "invalid",
      result.problems.map((p) => `${p.path}: ${p.message}`).join("; "),
    );
  return value as T;
}
