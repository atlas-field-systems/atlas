import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { Refusal, validate, definitionsHash, critical, isFinal } from './protocol.ts';
import type { Description, Report, Settings, Task, Command, Position } from './protocol.ts';

type AssetRow = { id: string; owner: string; gateway: string | null; heard: number; online?: boolean; removed?: boolean; description?: Description; settings: Settings & Record<string, unknown>; settingTimes?: Record<string, number>; next: number; clear_count: number; last_event?: number };
type Store = {
  assets: AssetRow;
  tasks: { body: Task; state: string };
  places: Command & { position?: Position; time: number; geofeature_id: string };
  place_ids: Record<string, never>;
  objects: { object_id: string; name: string | null; requested_by: string; bytes: string; deleted: boolean };
};
export type Caller = { role: 'operator' | 'asset' | 'gateway' | 'plugin'; id: string };
export class Core {
  db: DatabaseSync;
  run: number;
  directory: string; maxObjectBytes: number;
  constructor(directory: string, maxObjectBytes = 100_000_000) {
    this.directory = directory; this.maxObjectBytes = maxObjectBytes;
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'core.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS counters(kind TEXT PRIMARY KEY, value INTEGER);
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, phase TEXT, started INTEGER);
      CREATE TABLE IF NOT EXISTS state(run INTEGER, kind TEXT, id TEXT, body TEXT, PRIMARY KEY(run,kind,id));
      CREATE TABLE IF NOT EXISTS events(event_id INTEGER PRIMARY KEY AUTOINCREMENT, run INTEGER, time INTEGER, kind TEXT, asset_id TEXT, record TEXT);
      CREATE TABLE IF NOT EXISTS retries(run INTEGER, caller TEXT, key TEXT, signature TEXT, status INTEGER, body TEXT, PRIMARY KEY(run,caller,key));`);
    for (const row of this.db.prepare("SELECT id FROM runs WHERE phase='stopping'").all()) {
      this.run = Number(row.id);
      try { this.archive(); } catch { /* Held run is never served. Retry on next start. */ }
    }
    const active = this.db.prepare("SELECT id FROM runs WHERE phase='active'").get();
    if (active) {
      this.run = Number(active.id);
      this.tx(() => this.event('spike.recovery', { explanation: 'Unexpected Core stop; timing not known' }));
    } else {
      this.run = Number(this.db.prepare("INSERT INTO runs(phase,started) VALUES('active',?)").run(Date.now()).lastInsertRowid);
    }
  }
  tx<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  rows<K extends keyof Store>(kind: K): Store[K][] { return this.db.prepare('SELECT body FROM state WHERE run=? AND kind=? ORDER BY rowid').all(this.run, kind).map(r => JSON.parse(String(r.body))); }
  get<K extends keyof Store>(kind: K, id: string): Store[K] {
    const row = this.db.prepare('SELECT body FROM state WHERE run=? AND kind=? AND id=?').get(this.run, kind, id);
    if (!row) throw new Refusal(404, 'not_found');
    return JSON.parse(String(row.body));
  }
  put<K extends keyof Store>(kind: K, id: string, value: Store[K]) { this.db.prepare('INSERT OR REPLACE INTO state VALUES(?,?,?,?)').run(this.run, kind, id, JSON.stringify(value)); }
  next(kind: keyof Store) { const value = kind === 'assets' ? Number(this.db.prepare("INSERT INTO counters VALUES('asset',1) ON CONFLICT(kind) DO UPDATE SET value=value+1 RETURNING value").get()!.value) : this.rows(kind).length + 1; if (value > 46655) throw new Refusal(409, 'id_space'); return value.toString(36).toUpperCase(); }
  event(kind: string, record: unknown, asset_id: string | null = null) {
    return Number(this.db.prepare('INSERT INTO events(run,time,kind,asset_id,record) VALUES(?,?,?,?,?)').run(this.run, Date.now(), kind, asset_id, JSON.stringify(record)).lastInsertRowid);
  }
  events(after = 0) { return this.db.prepare('SELECT * FROM events WHERE run=? AND event_id>? ORDER BY event_id').all(this.run, after).map(r => ({ event_id: Number(r.event_id), time: Number(r.time), kind: String(r.kind), asset_id: r.asset_id === null ? null : String(r.asset_id), record: JSON.parse(String(r.record)) })); }
  asset(caller: Caller, id: string) {
    const asset = this.get('assets', id);
    if (caller.role !== 'operator' && asset.owner !== caller.id) throw new Refusal(403, 'forbidden');
    return asset;
  }
  online(asset: AssetRow) { return Date.now() - asset.heard < 60_000 && asset.online !== false; }
  request(caller: Caller, method: string, target: string, input: unknown, key?: string): [number, unknown] {
    return this.tx(() => {
      const signature = createHash('sha256').update(method + target).update(input instanceof Uint8Array ? input : JSON.stringify(input)).digest('hex');
      if (method !== 'GET') {
        if (!key || key.length > 64) throw new Refusal(400, 'idempotency_key');
        const old = this.db.prepare('SELECT * FROM retries WHERE run=? AND caller=? AND key=?').get(this.run, caller.id, key);
        if (old) { if (old.signature !== signature) throw new Refusal(409, 'idempotency_conflict'); return [Number(old.status), JSON.parse(String(old.body))]; }
      }
      const result = this.dispatch(caller, method, new URL(target, 'http://spike'), input);
      if (method !== 'GET') this.db.prepare('INSERT INTO retries VALUES(?,?,?,?,?,?)').run(this.run, caller.id, key!, signature, result[0], JSON.stringify(result[1]));
      return result;
    });
  }
  dispatch(c: Caller, method: string, url: URL, input: unknown): [number, unknown] {
    const p = url.pathname.split('/').filter(Boolean);
    const as_of = this.events().at(-1)?.event_id ?? 0;
    const operator = () => { if (c.role !== 'operator') throw new Refusal(403, 'forbidden'); };
    if (url.pathname === '/about') return [200, { run_id: this.run, definitions_hash: definitionsHash, core_version: 'throwaway', protocol_version: 'unpublished' }];
    if (url.pathname === '/entities/assets' && method === 'POST' || url.pathname === '/entities/assets/radios' && method === 'POST') {
      const radio = p[2] === 'radios';
      if (radio ? c.role !== 'gateway' : c.role !== 'asset') throw new Refusal(403, 'forbidden');
      let description: Description | undefined;
      if (radio) {
        const body = validate<{ definitions_hash: string }>('requests/radio.json', input);
        if (body.definitions_hash !== definitionsHash) throw new Refusal(409, 'definitions_mismatch');
      } else description = validate<Description>('records/description.json', input);
      const old = !radio && this.rows('assets').find(a => a.owner === c.id && !a.removed);
      if (old) { old.heard = Date.now(); this.put('assets', old.id, old); return [201, { asset_id: old.id }]; }
      const id = this.next('assets');
      this.put('assets', id, { id, owner: c.id, gateway: radio ? c.id : null, heard: Date.now(), description: description && { ...description, asset_id: id }, settings: {}, next: 1, clear_count: 0 });
      this.event('asset.registered', { asset_id: id, time: Date.now(), requested_by: c.id }, id);
      return [201, { asset_id: id }];
    }
    if (p[0] === 'entities' && p[1] === 'assets' && p[2]) {
      const a = this.asset(c, p[2]);
      if (c.role !== 'operator') { a.heard = Date.now(); this.put('assets', a.id, a); }
      if (method === 'PUT' && p[3] === 'description') { if (c.role === 'operator') throw new Refusal(403, 'forbidden'); a.description = validate<Description>('records/description.json', input); this.put('assets', a.id, a); return [200, {}]; }
      if (method === 'PUT' && p[3] === 'contact') {
        if (c.role !== 'gateway') throw new Refusal(403, 'forbidden');
        const contact = validate<{ contact: string }>('records/contact.json', input);
        a.online = contact.contact === 'online'; this.put('assets', a.id, a); return [200, {}];
      }
      if (method === 'POST' && p[3] === 'reports') {
        if (c.role === 'operator') throw new Refusal(403, 'forbidden');
        if (!input || typeof input !== 'object' || !('reports' in input) || !Array.isArray(input.reports)) throw new Refusal(400, 'invalid');
        for (const raw of input.reports) {
          if (!raw || typeof raw.type !== 'string') throw new Refusal(400, 'invalid');
          const report = validate<Report>(`records/${raw.type.replace('.', '/')}.json`, raw);
          if (report.asset_id !== a.id) throw new Refusal(403, 'forbidden');
          const event = this.event(report.type, report, a.id);
          if (report.time > Date.now() + 60_000) continue;
          if (report.type === 'report.settings') {
            for (const [name, value] of Object.entries(report.settings!)) {
              const last = a.settingTimes?.[name] ?? -1;
              if (report.time >= last) { a.settings[name] = value; a.settingTimes ??= {}; a.settingTimes[name] = report.time; }
            }
          }
          if (report.type === 'report.status' && report.kind === 'task') {
            const task = this.get('tasks', `${a.id}:${report.task_id}`);
            if (!isFinal(task.state) && !(task.state === 'active' && report.task_state === 'queued')) { task.state = report.task_state!; this.put('tasks', `${a.id}:${report.task_id}`, task); }
          }
          if (report.kind === 'queue') a.clear_count = Math.max(a.clear_count, report.clear_count!);
          a.last_event = event;
        }
        this.put('assets', a.id, a); return [200, {}];
      }
      if (method === 'PATCH' && p[3] === 'settings') {
        operator(); const body = validate<{ settings: Settings }>('requests/settings.json', input);
        if (!this.online(a)) throw new Refusal(409, 'offline');
        if (a.description?.commands.includes('takeoff') && body.settings.failsafe_policy && !critical(body.settings.failsafe_policy)) throw new Refusal(409, 'no_critical_battery_rule');
        return [202, { event_id: this.event('settings.requested', { asset_id: a.id, ...body, requested_by: c.id }, a.id) }];
      }
      if (method === 'GET') return [200, { as_of, ...a }];
    }
    if (p[0] === 'tasks' && p[1]) {
      const a = this.asset(c, p[1]);
      if (method === 'GET') return [200, { as_of, items: this.rows('tasks').filter(t => t.body.asset_id === a.id) }];
      operator();
      if (!this.online(a)) throw new Refusal(409, 'offline');
      if (method === 'POST' && p.length === 2) {
        const body = validate<{ tasks: Command[]; now?: boolean }>('requests/tasks.json', input);
        if (a.description?.commands.includes('takeoff') && !critical(a.settings.failsafe_policy ?? [])) throw new Refusal(409, 'no_critical_battery_rule');
        if (body.tasks.some(t => t.kind !== 'settings' && !a.description?.commands.includes(t.kind))) throw new Refusal(409, 'unsupported');
        for (const task of body.tasks) {
          if (task.settings?.failsafe_policy && a.description?.commands.includes('takeoff') && !critical(task.settings.failsafe_policy)) throw new Refusal(409, 'no_critical_battery_rule');
          for (const name of Object.keys(task.settings ?? {})) if (!a.description?.settings?.includes(name)) throw new Refusal(409, 'unsupported');
        }
        const count = this.rows('tasks').filter(t => t.body.asset_id === a.id && !isFinal(t.state)).length;
        if (!body.now && count + body.tasks.length > 64) throw new Refusal(409, 'queue_full');
        const tasks = body.tasks.map(t => {
          let copy = { ...t };
          if (t.geofeature_id) {
            const place = this.get('places', t.geofeature_id);
            if (place.kind !== 'point') throw new Refusal(409, 'not_point');
            copy = { ...copy, [t.kind === 'land' ? 'landing_position' : 'destination']: place.position };
          }
          return validate<Task>('records/task.json', { ...copy, time: Date.now(), asset_id: a.id, task_id: a.next++, send_last: 1, clear_count: a.clear_count, requested_by: c.id, ...(body.now ? { now: true } : {}) });
        });
        for (const task of tasks) { task.send_last = tasks.at(-1)!.task_id; this.put('tasks', `${a.id}:${task.task_id}`, { body: task, state: 'queued' }); }
        this.put('assets', a.id, a);
        return [202, { task_ids: tasks.map(t => t.task_id), event_id: this.event('tasks.requested', tasks, a.id) }];
      }
      if (method === 'POST' && p[3] === 'cancel') { this.get('tasks', `${a.id}:${p[2]}`); return [202, { event_id: this.event('cancel.requested', { asset_id: a.id, task_id: Number(p[2]), requested_by: c.id }, a.id) }]; }
    }
    if (p[0] === 'entities' && p[1] === 'geofeatures') {
      operator();
      if (method === 'GET') return [200, { as_of, items: this.rows('places') }];
      if (method === 'DELETE') { const old = this.get('places', p[2]); this.db.prepare('DELETE FROM state WHERE run=? AND kind=? AND id=?').run(this.run, 'places', p[2]); return [200, { event_id: this.event('geofeature.deleted', old) }]; }
      const body = validate<Command & { position?: Position }>('requests/geofeature.json', input);
      const id = method === 'POST' ? this.next('place_ids') : p[2];
      if (method !== 'POST') this.get('places', id);
      this.put('place_ids', id, {});
      const place = { ...body, time: Date.now(), geofeature_id: id };
      this.put('places', id, place);
      const event_id = this.event(method === 'POST' ? 'geofeature.created' : 'geofeature.replaced', place);
      const updated_task_ids = [], not_updated_task_ids = [];
      if (url.searchParams.get('update_tasks') === 'true') {
        for (const a of this.rows('assets')) {
          const updates = [];
          for (const task of this.rows('tasks').filter(t => t.body.asset_id === a.id && t.body.geofeature_id === id && !isFinal(t.state))) {
            if (!this.online(a) || body.kind !== 'point') { not_updated_task_ids.push(task.body.task_id); continue; }
            task.body[task.body.kind === 'land' ? 'landing_position' : 'destination'] = body.position;
            this.put('tasks', `${a.id}:${task.body.task_id}`, task); updates.push(task.body); updated_task_ids.push(task.body.task_id);
          }
          if (updates.length) this.event('tasks.updated', updates, a.id);
        }
      }
      return [200, { geofeature: place, event_id, updated_task_ids, not_updated_task_ids }];
    }
    if (p[0] === 'objects') {
      if (!['operator', 'plugin'].includes(c.role)) throw new Refusal(403, 'forbidden');
      if (method === 'POST') {
        if (!(input instanceof Uint8Array)) throw new Refusal(400, 'invalid');
        if (input.length > this.maxObjectBytes) throw new Refusal(413, 'too_large');
        const id = this.next('objects');
        this.put('objects', id, { object_id: id, name: url.searchParams.get('name'), requested_by: c.id, bytes: Buffer.from(input).toString('base64'), deleted: false });
        return [201, { object_id: id, event_id: this.event('object.stored', { object_id: id }) }];
      }
      if (!p[1]) return [200, { as_of, items: this.rows('objects').filter(o => !o.deleted).map(({ bytes, ...o }) => o) }];
      const object = this.get('objects', p[1]); if (object.deleted) throw new Refusal(404, 'not_found');
      if (method === 'DELETE') { operator(); object.deleted = true; this.put('objects', p[1], object); return [200, { event_id: this.event('object.deleted', { object_id: p[1], requested_by: c.id }) }]; }
      return [200, p[2] === 'file' ? Buffer.from(object.bytes, 'base64') : { ...object, bytes: undefined }];
    }
    if (p[0] === 'history') {
      operator(); const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 1000)));
      const items = this.events(Number(url.searchParams.get('cursor') ?? 0)).filter(e => String(e.kind).startsWith('report.')).slice(0, limit);
      return [200, { as_of, items, next_cursor: items.at(-1)?.event_id ?? null }];
    }
    throw new Refusal(404, 'not_implemented');
  }
  stop() { this.db.prepare("UPDATE runs SET phase='stopping' WHERE id=?").run(this.run); this.archive(); }
  archive() {
    const files: Record<string, Uint8Array> = {};
    const assets = this.rows('assets').map(({ owner, ...a }) => a);
    for (const kind of ['tasks', 'places', 'objects'] as const) {
      const rows = kind === 'objects' ? this.rows('objects').map(({ bytes, ...r }) => r) : this.rows(kind);
      files[`state/${kind}.jsonl`] = strToU8(rows.map(r => JSON.stringify(r)).join('\n'));
    }
    files['state/assets.jsonl'] = strToU8(assets.map(a => JSON.stringify(a)).join('\n'));
    files['events.jsonl'] = strToU8(this.events().map(e => JSON.stringify(e)).join('\n'));
    for (const o of this.rows('objects')) files[`objects/${o.object_id}`] = Buffer.from(o.bytes, 'base64');
    files['README.md'] = strToU8('Disposable spike archive; see spike shortcuts in lessons.md.');
    files['summary.md'] = strToU8(`Run ${this.run}. Task outcomes in state/tasks.jsonl. Recovery gaps in events.jsonl.`);
    files['versions.json'] = strToU8(JSON.stringify({ definitions_hash: definitionsHash }));
    files['config.json'] = strToU8(JSON.stringify({ max_object_bytes: this.maxObjectBytes }));
    const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const manifest = Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { size: data.length, sha256: sha(data) }]));
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    const filename = join(this.directory, `core-run-${this.run}.zip`);
    writeFileSync(filename + '.tmp', zipSync(files));
    if (process.env.SPIKE_CRASH_DURING_ARCHIVE === '1') process.kill(process.pid, 'SIGKILL');
    const restored = unzipSync(readFileSync(filename + '.tmp'));
    for (const [name, meta] of Object.entries(manifest)) if (!restored[name] || restored[name].length !== meta.size || sha(restored[name]) !== meta.sha256) throw new Error('archive check failed');
    renameSync(filename + '.tmp', filename);
    this.tx(() => { for (const table of ['state', 'events', 'retries']) this.db.prepare(`DELETE FROM ${table} WHERE run=?`).run(this.run); this.db.prepare("UPDATE runs SET phase='cleared' WHERE id=?").run(this.run); });
  }
  close() { this.db.close(); }
}
