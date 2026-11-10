import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadProtocol, validate } from '../../protocol/lib/protocol.mjs';
import type { SpikeClient } from '../client/client.ts';

type Position = {latitude: number; longitude: number; altitudes?: {altitude_m: number; altitude_reference: string}[]};
type Settings = {run_state?: 'running' | 'paused'; lights?: 'on' | 'off'; landing_gear?: 'up' | 'down'; link_loss_after_s?: number; link_loss_response?: string; low_battery_response?: string; home_position?: Position; telemetry_every_s?: number};
type TaskBase = {time: number; asset_id: string; task_id: number; clear_count: number; requested_by: string; send_last?: number; now?: boolean};
export type Task = TaskBase & ({kind: 'takeoff'; target_altitude: {altitude_m: number; altitude_reference: string}} | {kind: 'move_to'; destination: Position} | {kind: 'land'; landing_position: Position; transit_altitude?: {altitude_m: number; altitude_reference: string}} | {kind: 'return_to_home'} | {kind: 'settings'; settings: Settings});
type Outcome = 'active' | 'completed' | 'failed' | 'cancelled';
type Event = {event_id: number; kind: string; record: unknown};
// Local-only policy stand-in. Protocol cannot represent policy/rule IDs or local response Task IDs yet.
export type Condition = {kind: 'contact_lost'; afterMs: number} | {kind: 'idle'; afterMs: number} | {kind: 'battery_below'; percent: number} | {kind: 'airborne'} | {kind: 'equipment_fault'} | {kind: 'outside'; polygon: Position[]; distanceM: number; afterMs: number; maxAgeMs?: number} | {kind: 'position_missing'; afterMs: number} | {kind: 'position_stale'; maxAgeMs: number};
export type Rule = {id: string; priority: number; conditions: Condition[]; response: 'land' | 'return_to_home'; fallback?: 'land' | 'return_to_home'};
type LocalResponse = {id: string; action: 'land' | 'return_to_home'; destination?: Position; outcome: Outcome; fallback: boolean};

// Local tangent-plane geometry for small field polygons; geographic edge cases stay provisional.
// null means inside or on the boundary, a number means horizontal metres outside.
function outsideDistance(position: Position, polygon: Position[]): number | null {
  const earthM = 6371000;
  const radians = Math.PI / 180;
  const project = (point: Position) => ({x: (point.longitude - position.longitude) * radians * earthM * Math.cos(position.latitude * radians), y: (point.latitude - position.latitude) * radians * earthM});
  const points = polygon.map(project);
  let inside = false; let closest = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    if ((a.y > 0) !== (b.y > 0) && 0 < (b.x - a.x) * (-a.y) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const along = length2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / length2)) : 0;
    closest = Math.min(closest, Math.hypot(a.x + along * dx, a.y + along * dy));
  }
  return inside || closest < 1e-6 ? null : closest;
}

export async function createAsset(config: {asset_id: string; now?: () => number; settings?: Settings; commands?: string[]; reportingOnly?: boolean}) {
  const protocol = await loadProtocol(async (file: string) => JSON.parse(await readFile(new URL(`../../protocol/definitions/${file}`, import.meta.url), 'utf8')), Ajv, addFormats);
  return new AssetDouble(config, protocol);
}

/** In-memory protocol-accurate double; equipment results must be supplied explicitly. */
export class AssetDouble {
  asset_id: string;
  now: () => number;
  settings: Settings;
  commands: string[];
  reportingOnly: boolean;
  tasks = new Map<number, Task>();
  states = new Map<number, Outcome>();
  active: number | null = null;
  clear_count = 0;
  lastEvent = 0;
  nowFloor = 0;
  diagnostics: object[] = [];
  pending: object[] = [];
  batch: {key: string; reports: object[]} | null = null;
  rules: Rule[] = [];
  failsafe: {priority: number; rule: Rule; response: LocalResponse | null} | null = null;
  stopped = false;
  equipmentReady = true;
  equipmentFault = false;
  position: {value: Position; time: number; source: string} | null = null;
  positionAvailable = false;
  missingSince: number | null;
  outsideSince = new Map<string, number>();
  executions: {id: number | string; kind: string; destination?: Position}[] = [];
  airborne = false;
  battery: number | null = null;
  lastContact: number;
  idleSince: number | null;
  private protocol: Awaited<ReturnType<typeof loadProtocol>>;
  constructor(config: {asset_id: string; now?: () => number; settings?: Settings; commands?: string[]; reportingOnly?: boolean}, protocol: Awaited<ReturnType<typeof loadProtocol>>) {
    this.asset_id = config.asset_id; this.now = config.now ?? Date.now;
    this.settings = {...(config.reportingOnly ? {} : {run_state: 'running'}), ...config.settings};
    this.commands = config.commands ?? (config.reportingOnly ? [] : ['takeoff', 'move_to', 'land', 'return_to_home']);
    this.reportingOnly = config.reportingOnly ?? false;
    this.protocol = protocol; this.lastContact = this.now(); this.idleSince = this.now(); this.missingSince = this.now();
  }
  private checked<T>(file: string, value: unknown): T {
    const result = validate(this.protocol, file, value);
    if (!result.ok) throw new Error(result.errors.join('; '));
    return value as T;
  }
  private log(kind: string, detail: object = {}) { this.diagnostics.push({time: this.now(), kind, ...detail}); }
  private report(file: string, value: object) { this.checked(file, value); this.pending.push(value); }
  private taskReport(task_id: number, task_state: Outcome, explanation?: string, request_id?: number) {
    this.report('records/report/status.json', {type: 'report.status', time: this.now(), asset_id: this.asset_id, kind: 'task', task_id, task_state,
      ...(explanation ? {explanation} : {}), ...(request_id ? {request_id} : {})});
    this.log('task', {task_id, task_state, explanation});
  }
  private state(id: number, outcome: Outcome, reason?: string, request?: number) {
    this.states.set(id, outcome); if (this.active === id && outcome !== 'active') this.active = null;
    this.taskReport(id, outcome, reason, request);
  }
  queue() { return [...this.tasks.keys()].filter(id => !this.states.has(id)).sort((a,b) => a-b); }
  private queueReport(request_id?: number) {
    if (this.reportingOnly) return;
    this.report('records/report/status.json', {type: 'report.status', time: this.now(), asset_id: this.asset_id, kind: 'queue', task_ids: this.queue(), clear_count: this.clear_count, ...(request_id ? {request_id} : {})});
  }
  private settingsReport(request_id?: number) {
    if (!Object.keys(this.settings).length) return;
    this.report('records/report/settings.json', {type: 'report.settings', time: this.now(), asset_id: this.asset_id, settings: {...this.settings}, ...(request_id ? {request_id} : {})});
  }
  receive(event: Event) {
    if (event.event_id <= this.lastEvent || this.stopped) return;
    const record = event.record;
    if (event.kind === 'tasks.requested') {
      if (!record || typeof record !== 'object' || !('tasks' in record) || !Array.isArray(record.tasks)) throw new Error('tasks envelope');
      // Validate the whole batch before accepting any member.
      const tasks = record.tasks.map(value => this.checked<Task>('records/task.json', value));
      if (tasks.some(task => task.asset_id !== this.asset_id)) throw new Error('cross-Asset Task');
      for (const task of tasks) this.receiveTask(task);
      this.queueReport(event.event_id);
    } else if (event.kind === 'cancel.requested') {
      const cancel = this.checked<{asset_id: string; task_id: number}>('records/cancel.json', record);
      if (cancel.asset_id !== this.asset_id) throw new Error('cross-Asset cancel');
      this.cancel(cancel.task_id, event.event_id);
    } else if (event.kind === 'settings.requested') {
      const change = this.checked<{asset_id: string; settings: Settings}>('records/settings_change.json', record);
      if (change.asset_id !== this.asset_id) throw new Error('cross-Asset settings');
      this.applySettings(change.settings, event.event_id);
    }
    this.lastEvent = event.event_id;
    this.pump(); this.tick();
  }
  private receiveTask(task: Task) {
    if (this.tasks.has(task.task_id) || this.states.has(task.task_id)) return;
    this.tasks.set(task.task_id, structuredClone(task));
    if (task.task_id < this.nowFloor || (!task.now && task.clear_count !== this.clear_count)) {
      this.state(task.task_id, 'cancelled', 'Work was superseded or queue was cleared'); return;
    }
    if (this.failsafe && !(task.now && (task.kind === 'land' || task.kind === 'return_to_home'))) {
      this.state(task.task_id, 'failed', 'Failsafe is latched'); return;
    }
    if (task.now) {
      for (let id = 1; id < task.task_id; id++) if (!this.ended(id)) this.state(id, 'cancelled', 'Superseded by now');
      this.nowFloor = task.task_id;
      if (this.failsafe?.response?.outcome === 'active') { this.failsafe.response.outcome = 'cancelled'; this.log('failsafe.override', {response: this.failsafe.response}); }
      this.start(task);
    }
  }
  private ended(id: number) { const state = this.states.get(id); return state !== undefined && state !== 'active'; }
  cancel(id: number, request_id?: number) {
    if (this.failsafe) {
      this.taskReport(id, this.states.get(id) ?? 'cancelled', 'Failsafe refuses cancellation', request_id); return;
    }
    if (this.ended(id)) { if (request_id) this.taskReport(id, this.states.get(id)!, undefined, request_id); return; }
    this.state(id, 'cancelled', 'Cancelled by request', request_id); this.queueReport(); this.pump();
  }
  private applySettings(settings: Settings, request_id?: number) {
    if (!this.failsafe || Object.keys(settings).every(key => key === 'run_state')) Object.assign(this.settings, settings);
    else this.log('settings.refused', {reason: 'failsafe'});
    this.settingsReport(request_id); this.pump();
  }
  private ready(task: Task) {
    for (let id = 1; id < task.task_id; id++) if (!this.ended(id)) return false;
    for (let id = task.task_id; id <= (task.send_last ?? task.task_id); id++) if (!this.tasks.has(id) && !this.ended(id)) return false;
    return true;
  }
  private pump() {
    if (this.active !== null || this.failsafe || this.stopped || this.settings.run_state === 'paused') return;
    const id = this.queue()[0]; const task = id === undefined ? undefined : this.tasks.get(id);
    if (task && this.ready(task)) this.start(task);
  }
  private start(task: Task) {
    this.active = task.task_id; this.state(task.task_id, 'active'); this.queueReport();
    if (task.kind === 'settings') { this.applySettings(task.settings); this.complete('completed'); }
    else if (!this.equipmentReady) this.complete('failed', 'Required equipment is unavailable');
    else if (task.kind === 'return_to_home' && !this.settings.home_position) this.complete('failed', 'Home is unknown');
    else this.execute(task.task_id, task.kind, task.kind === 'return_to_home' ? this.settings.home_position : task.kind === 'land' ? task.landing_position : task.kind === 'move_to' ? task.destination : undefined);
    // Completion is deliberately driven by observed equipment, never acceptance.
  }
  complete(outcome: 'completed' | 'failed' = 'completed', explanation?: string) {
    if (this.active === null) throw new Error('No active Task');
    const task = this.tasks.get(this.active);
    this.state(this.active, outcome, explanation);
    if (outcome === 'failed') this.clear('Previous Task failed');
    if (outcome === 'completed' && task?.kind === 'takeoff') this.airborne = true;
    if (outcome === 'completed' && task?.kind === 'land') { this.airborne = false; if (this.failsafe) this.stopped = true; }
    this.queueReport(); this.pump(); this.tick();
  }
  private clear(reason: string) {
    this.clear_count++;
    for (const id of this.queue()) this.state(id, 'cancelled', reason);
    if (this.active !== null) this.state(this.active, 'cancelled', reason);
    this.queueReport();
  }
  private execute(id: number | string, kind: string, destination?: Position) {
    this.executions.push({id, kind, ...(destination ? {destination: structuredClone(destination)} : {})});
    this.log('equipment.requested', {id, kind});
  }
  observePosition(value: Position | null, time: number, source: string) {
    if (!value) { if (this.positionAvailable) this.missingSince = this.now(); this.positionAvailable = false; this.log('position.missing', {source}); this.tick(); return; }
    this.checked('components/position.json', value);
    if (!this.position || time >= this.position.time) {
      this.position = {value: structuredClone(value), time, source}; this.positionAvailable = true; this.missingSince = null;
    }
    this.report('records/report/telemetry.json', {type: 'report.telemetry', time, asset_id: this.asset_id, position: structuredClone(value)});
    if (!this.reportingOnly && !this.settings.home_position) {
      this.settings.home_position = structuredClone(value); this.settingsReport();
    }
    this.tick();
  }
  contact() { this.lastContact = this.now(); }
  autopilotTakeover() {
    this.clear('Independent autopilot protection took control');
    if (this.failsafe?.response?.outcome === 'active') this.failsafe.response.outcome = 'cancelled';
    // Local-only marker: no Protocol record exists for this trigger/identity.
    this.failsafe = {priority: Infinity, rule: {id: 'AUTO', priority: Infinity, conditions: [{kind: 'equipment_fault'}], response: 'land'}, response: null};
    this.log('autopilot.takeover');
  }
  replacePolicy(rules: Rule[]) {
    if (this.failsafe) throw new Error('Failsafe policy is locked');
    const ids = new Set<string>(); const priorities = new Set<number>();
    for (const rule of rules) {
      if (!rule.id || ids.has(rule.id) || !Number.isFinite(rule.priority) || priorities.has(rule.priority) || !rule.conditions.length || !this.commands.includes(rule.response) || (rule.fallback && !this.commands.includes(rule.fallback))) throw new Error('Invalid policy');
      for (const c of rule.conditions) if (('afterMs' in c && (!Number.isFinite(c.afterMs) || c.afterMs < 0)) || ('percent' in c && (!Number.isFinite(c.percent) || c.percent < 0 || c.percent > 100))) throw new Error('Invalid condition');
      for (const c of rule.conditions) {
        if ('maxAgeMs' in c && c.maxAgeMs !== undefined && (!Number.isFinite(c.maxAgeMs) || c.maxAgeMs < 0)) throw new Error('Invalid measurement age');
        if (c.kind === 'outside') {
          if (c.polygon.length < 3 || !Number.isFinite(c.distanceM) || c.distanceM < 0) throw new Error('Invalid polygon condition');
          for (const point of c.polygon) this.checked('components/position.json', point);
        }
      }
      ids.add(rule.id); priorities.add(rule.priority);
    }
    this.rules = structuredClone(rules); this.tick();
  }
  tick() {
    const queuedWork = this.queue().some(id => {const task = this.tasks.get(id); return task && this.ready(task);});
    if (this.active !== null || queuedWork) this.idleSince = null;
    else if (this.idleSince === null) this.idleSince = this.now();
    const matches = (condition: Condition) => {
      switch (condition.kind) {
        case 'contact_lost': return this.now() - this.lastContact >= condition.afterMs;
        case 'idle': return this.idleSince !== null && this.now() - this.idleSince >= condition.afterMs;
        case 'battery_below': return this.battery !== null && this.battery <= condition.percent;
        case 'airborne': return this.airborne;
        case 'equipment_fault': return this.equipmentFault;
        case 'position_missing': return !this.positionAvailable && this.missingSince !== null && this.now() - this.missingSince >= condition.afterMs;
        case 'position_stale': return this.positionAvailable && this.position !== null && this.now() - this.position.time >= condition.maxAgeMs;
        case 'outside': {
          const key = JSON.stringify(condition.polygon);
          const position = this.position;
          if (!this.positionAvailable || !position || (condition.maxAgeMs !== undefined && this.now() - position.time > condition.maxAgeMs)) {
            this.outsideSince.delete(key); return false;
          }
          const distance = outsideDistance(position.value, condition.polygon);
          if (distance === null) { this.outsideSince.delete(key); return false; }
          if (!this.outsideSince.has(key)) this.outsideSince.set(key, this.now());
          const since = this.outsideSince.get(key) ?? this.now();
          return distance >= condition.distanceM && this.now() - since >= condition.afterMs;
        }
      }
    };
    const rule = this.rules.filter(rule => rule.conditions.map(matches).every(Boolean)).sort((a,b) => b.priority-a.priority)[0];
    if (!rule || (this.failsafe && rule.priority <= this.failsafe.priority) || this.stopped) return;
    if (this.failsafe?.response?.outcome === 'active') this.failsafe.response.outcome = 'cancelled';
    this.clear('Failsafe activated');
    this.failsafe = {priority: rule.priority, rule, response: null};
    this.startResponse(rule.response, false);
  }
  private startResponse(action: 'land' | 'return_to_home', fallback: boolean) {
    if (!this.failsafe) return;
    const response: LocalResponse = {id: randomUUID(), action, outcome: 'active', fallback,
      ...(action === 'return_to_home' && this.settings.home_position ? {destination: structuredClone(this.settings.home_position)} : {})};
    this.failsafe.response = response;
    this.execute(response.id, action, response.destination);
    this.log('failsafe.response', {rule: this.failsafe.rule.id, response: structuredClone(response)});
    const trigger = this.failsafe.rule.conditions.some(c => c.kind === 'battery_below') ? 'low_battery' : this.failsafe.rule.conditions.some(c => c.kind === 'contact_lost') ? 'link_loss' : null;
    if (trigger) this.report('records/report/failsafe.json', {type: 'report.failsafe', time: this.now(), asset_id: this.asset_id, kind: trigger, response: action});
    if (!this.equipmentReady || (action === 'return_to_home' && !response.destination)) this.completeResponse('failed');
  }
  completeResponse(outcome: 'completed' | 'failed', safelyStopped = false) {
    const state = this.failsafe; if (!state?.response || state.response.outcome !== 'active') throw new Error('No response');
    state.response.outcome = outcome; this.log('failsafe.outcome', {response: structuredClone(state.response)});
    if (outcome === 'failed' && !state.response.fallback && state.rule.fallback) this.startResponse(state.rule.fallback, true);
    else if (outcome === 'completed' && safelyStopped) this.stopped = true;
  }
  snapshotReports() { this.settingsReport(); this.queueReport(); if (this.active !== null) this.taskReport(this.active, 'active'); }
  reports() { return [...this.batch?.reports ?? [], ...this.pending]; }
  takeBatch() { if (!this.batch) this.batch = {key: randomUUID(), reports: this.pending.splice(0)}; return this.batch; }
  ackBatch(key: string) { if (this.batch?.key !== key) throw new Error('Wrong batch acknowledgment'); this.batch = null; }
  async flush(client: SpikeClient) { const batch = this.takeBatch(); await client.request('POST', `/entities/assets/${this.asset_id}/reports`, {reports: batch.reports}, batch.key); this.ackBatch(batch.key); }
  async reconnect(client: SpikeClient) {
    const about = await client.request('GET', '/about');
    if (!about.body || typeof about.body !== 'object' || !('definitions_hash' in about.body) || about.body.definitions_hash !== client.definitionsHash) throw new Error('definitions_mismatch');
    await client.request('PUT', `/entities/assets/${this.asset_id}/description`, {time: this.now(), asset_id: this.asset_id, reports: this.reportingOnly ? ['telemetry'] : ['status', 'settings', 'failsafe', 'telemetry'], commands: this.commands});
    this.snapshotReports(); await this.flush(client);
    while (this.pending.length) await this.flush(client);
    if (!this.lastEvent && about.body && 'as_of' in about.body && typeof about.body.as_of === 'number') this.lastEvent = about.body.as_of;
  }
  async follow(client: SpikeClient, signal: AbortSignal) {
    for await (const value of client.events({after: this.lastEvent, signal, onAlive: () => this.contact()})) {
      if (!value || typeof value !== 'object' || !('event_id' in value) || !('kind' in value) || !('record' in value) || typeof value.event_id !== 'number' || typeof value.kind !== 'string') throw new Error('Invalid event envelope');
      this.receive({event_id: value.event_id, kind: value.kind, record: value.record}); await this.flush(client);
    }
  }
}
