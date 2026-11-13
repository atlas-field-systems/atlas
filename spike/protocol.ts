import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadProtocol } from '../protocol/lib/protocol.mjs';

const root = new URL('../protocol/definitions/', import.meta.url);
export const protocol = await loadProtocol(async (file: string) => JSON.parse(await readFile(new URL(file, root), 'utf8')), Ajv, addFormats);
// Hash stand-in: sorted file names plus source bytes. The docs do not specify canonicalization.
const hash = createHash('sha256');
for (const file of Object.keys(protocol.schemas).sort()) hash.update(file).update(await readFile(new URL(file, root)));
export const definitionsHash = hash.digest('hex');
export class Refusal extends Error {
  status: number; code: string;
  constructor(status: number, code: string, explanation = code) { super(explanation); this.status = status; this.code = code; }
}
export function validate<T>(file: string, value: unknown): T {
  const check = protocol.ajv.getSchema(`https://atlas-field-systems.github.io/protocol/definitions/${file}`);
  if (!check) throw new Refusal(400, 'invalid', 'Unknown Protocol definition');
  if (!check(value)) throw new Refusal(400, 'invalid', JSON.stringify(check.errors));
  return value as T; // Projection only after the authoritative validator accepts it.
}
// These are partial compile-time projections, not a second validator or exported contract.
export type Position = { latitude: number; longitude: number };
export type Command = { kind: string; geofeature_id?: string; destination?: Position; landing_position?: Position; settings?: Settings };
export type Task = Command & { asset_id: string; task_id: number; time: number; clear_count: number; send_last: number; now?: boolean; requested_by: string };
export type Condition = { kind: string; battery_percent?: number; critical?: boolean };
export type Rule = { rule_id: string; priority: number; conditions: Condition[]; response: Command; fallback?: Command };
export type Settings = { failsafe_policy?: Rule[]; run_state?: string };
export type Description = { time: number; asset_id: string; commands: string[]; reports: string[]; settings?: string[] };
export type Report = { type: string; asset_id: string; time: number; kind?: string; task_id?: number; task_state?: string; settings?: Settings; clear_count?: number; request_id?: number; task_ids?: number[] };
export const isFinal = (state: string) => ['completed', 'failed', 'cancelled'].includes(state);
export const critical = (rules: Rule[]) => rules.some(r => r.conditions.some(c => c.kind === 'battery_below' && c.critical));
