import { createServer } from 'node:https';
import type { ServerResponse, IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadProtocol, validate } from '../../protocol/lib/protocol.mjs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
type Principal = { kind: 'account'; id: string; role: string } | { kind: 'asset' | 'gateway'; id: string };
export type CoreConfig = {
  database: string; tls: { key: string | Buffer; cert: string | Buffer };
  firstAdmin: { operator_id: string; password: string };
  now?: () => number; offlineAfterMs?: number; clockAheadMs?: number;
  supportedSettings?: string[]; diagnostics?: (entry: ObjectValue) => void;
};
class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, explanation: string) { super(explanation); this.status = status; this.code = code; }
}
const fail = (status: number, code: string, explanation: string): never => { throw new ApiError(status, code, explanation); };
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(400, 'invalid', 'Expected JSON object');
  return value as ObjectValue;
}
function string(value: unknown, name: string): string {
  if (typeof value !== 'string') return fail(400, 'invalid', `${name} must be a string`);
  return value;
}
function integer(value: unknown, name: string): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return fail(400, 'invalid', `${name} must be a nonnegative safe integer`);
  return n;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(16).toString('base64url');
const final = (state: string) => ['completed', 'failed', 'cancelled'].includes(state);
const encode = (value: unknown) => JSON.stringify(value);

export async function createCore(config: CoreConfig) {
  const protocol = await loadProtocol(async (file: string) => JSON.parse(await readFile(new URL(`../../protocol/definitions/${file}`, import.meta.url), 'utf8')), Ajv, addFormats);
  // Provisional canonical hash: sorted indexed file paths followed by their parsed JSON.
  const definitionsHash = hash(encode(Object.entries(protocol.schemas).sort(([a], [b]) => a.localeCompare(b))));
  const now = config.now ?? Date.now;
  const db = new DatabaseSync(config.database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS runs(run_id INTEGER PRIMARY KEY, started INTEGER NOT NULL);
    INSERT OR IGNORE INTO runs VALUES(1,0);
    CREATE TABLE IF NOT EXISTS events(event_id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INTEGER NOT NULL DEFAULT 1,time INTEGER NOT NULL,kind TEXT NOT NULL,asset_id TEXT,record TEXT NOT NULL,report_time INTEGER,clock_ahead INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS event_asset ON events(asset_id,event_id);
    CREATE INDEX IF NOT EXISTS report_history ON events(report_time,event_id);
    CREATE INDEX IF NOT EXISTS latest_asset_reports ON events(asset_id,kind,report_time DESC,event_id DESC) WHERE clock_ahead=0;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,role TEXT NOT NULL,password TEXT NOT NULL,salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS gateways(id TEXT PRIMARY KEY,key_hash TEXT NOT NULL,assets TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS asset_keys(id TEXT PRIMARY KEY,key_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,type TEXT NOT NULL,description TEXT,last_heard INTEGER,online INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tasks(run_id INTEGER NOT NULL DEFAULT 1,asset_id TEXT NOT NULL,task_id INTEGER NOT NULL,body TEXT NOT NULL,state TEXT,held INTEGER NOT NULL DEFAULT 0,dropped INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(run_id,asset_id,task_id));
    CREATE TABLE IF NOT EXISTS queues(run_id INTEGER NOT NULL DEFAULT 1,asset_id TEXT PRIMARY KEY,event_id INTEGER NOT NULL,clear_count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(run_id INTEGER NOT NULL DEFAULT 1,event_id INTEGER PRIMARY KEY,asset_id TEXT NOT NULL,answered INTEGER NOT NULL DEFAULT 0,dropped INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS idempotency_keys(run_id INTEGER NOT NULL DEFAULT 1,caller TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,status INTEGER NOT NULL,response TEXT NOT NULL,headers TEXT NOT NULL,PRIMARY KEY(run_id,caller,key));
    CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY,record TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'append only'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'append only'); END;`);
  const get = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).get(...params);
  const all = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params);
  const run = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);
  function transaction<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function event(kind: string, assetId: string | null, record: unknown, reportTime: number | null = null, ahead = false): number {
    return Number(run('INSERT INTO events(time,kind,asset_id,record,report_time,clock_ahead) VALUES(?,?,?,?,?,?)', now(), kind, assetId, encode(record), reportTime, Number(ahead)).lastInsertRowid);
  }
  function addAccount(id: string, role: string, password: string) {
    const salt = randomBytes(16).toString('hex');
    run('INSERT INTO accounts VALUES(?,?,?,?)', id, role, scryptSync(password, salt, 32).toString('hex'), salt);
  }
  if (!get('SELECT id FROM accounts LIMIT 1')) transaction(() => addAccount(config.firstAdmin.operator_id, 'admin', config.firstAdmin.password));
  const asOf = () => Number(get('SELECT COALESCE(MAX(event_id),0) AS id FROM events')?.id);
  const asset = (id: string) => get('SELECT * FROM assets WHERE id=?', id) ?? fail(404, 'not_found', 'No such Asset');
  function allowed(principal: Principal, id: string) {
    if (principal.kind === 'asset' && principal.id !== id) fail(403, 'forbidden', 'Cross-Asset access');
    if (principal.kind === 'gateway') {
      const row = get('SELECT assets FROM gateways WHERE id=?', principal.id);
      if (!row || !JSON.parse(String(row.assets)).includes(id)) fail(403, 'forbidden', 'Asset not provisionally assigned to gateway');
    }
  }
  function operator(principal: Principal) { if (principal.kind !== 'account') fail(403, 'forbidden', 'Account required'); }
  function admin(principal: Principal) { if (principal.kind !== 'account' || principal.role !== 'admin') fail(403, 'forbidden', 'Admin required'); }
  function authenticate(req: IncomingMessage): Principal | null {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (bearer) {
      const keyHash = hash(bearer);
      const key = get('SELECT id FROM asset_keys WHERE key_hash=?', keyHash);
      if (key) return { kind: 'asset', id: String(key.id) };
      const gateway = get('SELECT id FROM gateways WHERE key_hash=?', keyHash);
      if (gateway) return { kind: 'gateway', id: String(gateway.id) };
      return null;
    }
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)atlas_session=([^;]+)/)?.[1];
    const row = cookie && get('SELECT a.id,a.role FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=?', hash(cookie));
    return row ? { kind: 'account', id: String(row.id), role: String(row.role) } : null;
  }
  function protocolCheck(file: string, value: unknown) {
    const result = validate(protocol, file, value);
    if (!result.ok) fail(400, 'invalid', result.errors.join('; '));
  }
  const supportedSettings = config.supportedSettings ?? Object.keys(protocol.schemas['components/settings.json'].properties);
  function checkSettings(settings: Json | undefined) {
    const value = object(settings);
    if (Object.keys(value).some(key => !supportedSettings.includes(key))) fail(409, 'unsupported_setting', 'Setting not supported by provisional Core configuration');
  }
  function touch(id: string) {
    const row = asset(id);
    run('UPDATE assets SET last_heard=?,online=1 WHERE id=?', now(), id);
    if (!row.online) event('asset.contact', id, { asset_id: id, contact: 'online', last_heard: now() });
  }
  function dropOutstanding(id: string) {
    for (const request of all('SELECT event_id FROM requests WHERE asset_id=? AND answered=0 AND dropped=0', id)) {
      run('UPDATE requests SET dropped=1 WHERE event_id=?', Number(request.event_id));
      event('request.dropped', id, { asset_id: id, request_id: request.event_id });
      const requested = get('SELECT record,kind FROM events WHERE event_id=?', Number(request.event_id));
      if (requested?.kind === 'tasks.requested') for (const task of JSON.parse(String(requested.record)).tasks) {
        const stored = get('SELECT held,state FROM tasks WHERE asset_id=? AND task_id=?', id, task.task_id);
        if (stored && !stored.held && !stored.state) {
          run('UPDATE tasks SET dropped=1 WHERE asset_id=? AND task_id=?', id, task.task_id);
          event('task.dropped', id, { asset_id: id, task_id: task.task_id });
        }
      }
    }
  }
  function sweep() {
    transaction(() => {
      for (const row of all('SELECT id,last_heard FROM assets WHERE online=1 AND last_heard<?', now() - (config.offlineAfterMs ?? 30000))) {
        const id = String(row.id);
        run('UPDATE assets SET online=0 WHERE id=?', id);
        event('asset.contact', id, { asset_id: id, contact: 'offline', last_heard: row.last_heard });
        dropOutstanding(id);
      }
    });
  }
  function latest(id: string) {
    const reports: ObjectValue = {}, settings: ObjectValue = {};
    // SQLite selects the latest rows; the process never materializes report history.
    for (const row of all(`SELECT record,kind FROM (
      SELECT record,kind,ROW_NUMBER() OVER (PARTITION BY kind,json_extract(record,'$.kind') ORDER BY report_time DESC,event_id DESC) AS rank
      FROM events WHERE asset_id=? AND report_time IS NOT NULL AND clock_ahead=0
    ) WHERE rank=1`, id)) {
      const record = JSON.parse(String(row.record));
      reports[String(row.kind) + (record.kind ? `.${record.kind}` : '')] = record;
    }
    for (const row of all(`SELECT record,setting FROM (
      SELECT e.record,j.key AS setting,ROW_NUMBER() OVER (PARTITION BY j.key ORDER BY e.report_time DESC,e.event_id DESC) AS rank
      FROM events e,json_each(e.record,'$.settings') j
      WHERE e.asset_id=? AND e.kind='report.settings' AND e.clock_ahead=0
    ) WHERE rank=1`, id)) settings[String(row.setting)] = JSON.parse(String(row.record)).settings[String(row.setting)];
    return { reports, settings };
  }
  function assetView(id: string) { const row = asset(id); return { asset_id: id, type: row.type, description: row.description ? JSON.parse(String(row.description)) : null, contact: row.online ? 'online' : 'offline', last_heard: row.last_heard, ...latest(id) }; }
  function requestEvent(kind: string, id: string, record: unknown) {
    const eventId = event(kind, id, record); run('INSERT INTO requests(event_id,asset_id) VALUES(?,?)', eventId, id); return eventId;
  }
  function answerReports(id: string, reports: ObjectValue[]) {
    for (const record of reports) {
      if (record.asset_id !== id) fail(403, 'forbidden', 'Report Asset does not match path');
      const type = string(record.type, 'type');
      if (!/^report\.(status|settings|failsafe|telemetry|battery)$/.test(type)) fail(400, 'invalid', 'Unknown report type');
      protocolCheck(`records/report/${type.slice(7)}.json`, record);
      if (record.kind === 'task' && !get('SELECT task_id FROM tasks WHERE asset_id=? AND task_id=?', id, integer(record.task_id, 'task_id'))) fail(409, 'unknown_task', 'Report names unknown Task');
      if (record.request_id !== undefined && !get('SELECT event_id FROM requests WHERE event_id=? AND asset_id=?', integer(record.request_id, 'request_id'), id)) fail(409, 'unknown_request', 'Report names unknown request');
    }
    const eventIds = [];
    for (const record of reports) {
      const time = integer(record.time, 'time');
      const ahead = time > now() + (config.clockAheadMs ?? 5000);
      const eventId = event(String(record.type), id, record, time, ahead); eventIds.push(eventId);
      if (ahead) continue;
      if (record.request_id !== undefined) {
        const requestId = integer(record.request_id, 'request_id');
        const requestRow = get('SELECT kind,record FROM events WHERE event_id=?', requestId);
        const requested = requestRow && JSON.parse(String(requestRow.record));
        const matches = requestRow?.kind === 'tasks.requested' && record.kind === 'queue'
          || requestRow?.kind === 'settings.requested' && record.type === 'report.settings'
          || requestRow?.kind === 'cancel.requested' && record.kind === 'task' && requested.task_id === record.task_id;
        if (matches) run('UPDATE requests SET answered=1 WHERE event_id=? AND asset_id=?', requestId, id);
      }
      if (record.type === 'report.status' && record.kind === 'queue') {
        const previous = get('SELECT e.report_time,e.event_id FROM queues q JOIN events e ON e.event_id=q.event_id WHERE q.asset_id=?', id);
        if (!previous || time >= Number(previous.report_time)) {
          run('INSERT INTO queues(asset_id,event_id,clear_count) VALUES(?,?,?) ON CONFLICT(asset_id) DO UPDATE SET event_id=excluded.event_id,clear_count=excluded.clear_count', id, eventId, integer(record.clear_count, 'clear_count'));
          run('UPDATE tasks SET held=0 WHERE asset_id=?', id);
          for (const taskId of record.task_ids as number[]) run('UPDATE tasks SET held=1 WHERE asset_id=? AND task_id=?', id, taskId);
        }
      }
      if (record.type === 'report.status' && record.kind === 'task') {
        const taskId = integer(record.task_id, 'task_id');
        const stored = get('SELECT state FROM tasks WHERE asset_id=? AND task_id=?', id, taskId);
        if (stored && !final(String(stored.state)) && !(stored.state === 'active' && record.task_state === 'queued')) run('UPDATE tasks SET state=?,held=0 WHERE asset_id=? AND task_id=?', string(record.task_state, 'task_state'), id, taskId);
      }
    }
    // Reconcile dropped gaps only after reconnect's complete queue snapshot is supplied.
    const queue = reports.find(record => record.type === 'report.status' && record.kind === 'queue' && Number(record.time) <= now() + (config.clockAheadMs ?? 5000));
    if (queue) for (const task of all('SELECT task_id FROM tasks WHERE asset_id=? AND dropped=1 AND held=0 AND state IS NULL', id)) {
      const taskId = Number(task.task_id);
      const already = get("SELECT 1 FROM requests r JOIN events e ON e.event_id=r.event_id WHERE r.asset_id=? AND e.kind='cancel.requested' AND json_extract(e.record,'$.task_id')=? AND r.dropped=0", id, taskId);
      if (!already) requestEvent('cancel.requested', id, { time: now(), asset_id: id, task_id: taskId, requested_by: 'CORE' });
    }
    return eventIds;
  }
  async function body(req: IncomingMessage) {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) fail(413, 'too_large', 'Body limit is 1 MiB'); chunks.push(chunk); }
    if (!chunks.length) return {};
    try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { if (error instanceof ApiError) throw error; return fail(400, 'invalid', 'Malformed JSON'); }
  }
  type Response = { status: number; value: unknown; headers?: Record<string, string> };
  function route(method: string, path: string, url: URL, data: ObjectValue, principal: Principal | null, req: IncomingMessage): Response {
    if (method === 'POST' && path === '/administration/login') {
      const id = string(data.operator_id, 'operator_id'), password = string(data.password, 'password');
      const account = get('SELECT * FROM accounts WHERE id=?', id);
      if (!account || !timingSafeEqual(scryptSync(password, String(account.salt), 32), Buffer.from(String(account.password), 'hex'))) fail(401, 'unauthorized', 'Invalid login');
      const session = token(); run('INSERT INTO sessions VALUES(?,?)', hash(session), id);
      return { status: 200, value: { operator_id: id, role: account.role }, headers: { 'Set-Cookie': `atlas_session=${session}; Path=/; HttpOnly; Secure; SameSite=Strict` } };
    }
    if (!principal) fail(401, 'unauthorized', 'Valid session or key required');
    if (method === 'GET' && path === '/administration/me') return { status: 200, value: { ...principal, as_of: asOf() } };
    if (method === 'POST' && path === '/administration/logout') {
      const cookie = req.headers.cookie?.match(/(?:^|;\s*)atlas_session=([^;]+)/)?.[1]; if (cookie) run('DELETE FROM sessions WHERE hash=?', hash(cookie));
      return { status: 200, value: {}, headers: { 'Set-Cookie': 'atlas_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' } };
    }
    if (path.startsWith('/administration/')) {
      admin(principal);
      if (method === 'POST' && path === '/administration/accounts') {
        const id = string(data.operator_id, 'operator_id'); protocolCheck('variables/operator_id.json', id);
        const role = string(data.role, 'role'); if (!['admin', 'operator'].includes(role)) fail(400, 'invalid', 'role must be admin or operator');
        if (get('SELECT id FROM accounts WHERE id=?', id)) fail(409, 'exists', 'Account exists');
        addAccount(id, role, string(data.password, 'password')); return { status: 201, value: { operator_id: id, event_id: event('account.provisioned', null, { operator_id: id, role }) } };
      }
      const account = path.match(/^\/administration\/accounts\/([^/]+)$/);
      if (method === 'DELETE' && account) { if (!get('SELECT id FROM accounts WHERE id=?', account[1])) fail(404, 'not_found', 'No account'); run('DELETE FROM accounts WHERE id=?', account[1]); return { status: 200, value: { event_id: event('account.removed', null, { operator_id: account[1] }) } }; }
      if (method === 'POST' && path === '/administration/assets') {
        const id = string(data.asset_id, 'asset_id'); protocolCheck('variables/asset_id.json', id); if (get('SELECT id FROM assets WHERE id=?', id)) fail(409, 'exists', 'Asset exists');
        const key = token(), type = typeof data.type === 'string' ? data.type : 'asset';
        run('INSERT INTO assets(id,type) VALUES(?,?)', id, type); run('INSERT INTO asset_keys VALUES(?,?)', id, hash(key));
        return { status: 201, value: { asset_id: id, key, event_id: event('asset.provisioned', id, { asset_id: id, type }) } };
      }
      const provisioned = path.match(/^\/administration\/assets\/([^/]+)(\/key)?$/);
      if (provisioned) {
        const id = provisioned[1]; asset(id);
        if (method === 'POST' && provisioned[2]) { const key = token(); run('UPDATE asset_keys SET key_hash=? WHERE id=?', hash(key), id); return { status: 200, value: { asset_id: id, key, event_id: event('asset.key_replaced', id, { asset_id: id }) } }; }
        if (method === 'DELETE' && !provisioned[2]) { const row = asset(id); run('DELETE FROM assets WHERE id=?', id); run('DELETE FROM asset_keys WHERE id=?', id); return { status: 200, value: { event_id: event('asset.removed', id, { asset_id: id, type: row.type }) } }; }
      }
      if (method === 'POST' && path === '/administration/gateways') {
        const id = string(data.gateway_id, 'gateway_id'); protocolCheck('variables/asset_id.json', id);
        if (get('SELECT id FROM gateways WHERE id=?', id)) fail(409, 'exists', 'Gateway exists');
        const assets = data.asset_ids ?? []; if (!Array.isArray(assets) || assets.some(x => typeof x !== 'string')) fail(400, 'invalid', 'asset_ids must be strings');
        const key = token(); run('INSERT INTO gateways VALUES(?,?,?)', id, hash(key), encode(assets)); return { status: 201, value: { gateway_id: id, key, provisional: true, event_id: event('gateway.provisioned', null, { gateway_id: id, asset_ids: assets }) } };
      }
      const gateway = path.match(/^\/administration\/gateways\/([^/]+)$/);
      if (method === 'DELETE' && gateway) { if (!get('SELECT id FROM gateways WHERE id=?', gateway[1])) fail(404, 'not_found', 'No gateway'); run('DELETE FROM gateways WHERE id=?', gateway[1]); return { status: 200, value: { event_id: event('gateway.removed', null, { gateway_id: gateway[1] }) } }; }
    }
    const entity = path.match(/^\/entities\/assets\/([^/]+)(?:\/(description|reports|settings|contact))?$/);
    if (entity) {
      const id = entity[1]; allowed(principal, id); const row = asset(id);
      if (method === 'GET' && !entity[2]) return { status: 200, value: { ...assetView(id), as_of: asOf() } };
      // Provisional wire surface: gateway contact report shapes are undefined.
      if (method === 'POST' && entity[2] === 'contact') {
        if (principal.kind !== 'gateway') fail(403, 'forbidden', 'Gateway credential required');
        if (typeof data.online !== 'boolean') fail(400, 'invalid', 'online must be boolean');
        const heard = integer(data.last_heard, 'last_heard');
        if (heard > now()) fail(400, 'invalid', 'Contact evidence cannot be ahead of Core');
        const online = data.online && now() - heard <= (config.offlineAfterMs ?? 30000);
        run('UPDATE assets SET last_heard=?,online=? WHERE id=?', heard, Number(online), id);
        const eventId = event('asset.contact', id, { asset_id: id, contact: online ? 'online' : 'offline', last_heard: heard, provisional: true });
        if (!online) dropOutstanding(id);
        return { status: 200, value: { event_id: eventId, provisional: true } };
      }
      if (method === 'PUT' && entity[2] === 'description') {
        if (principal.kind === 'account') fail(403, 'forbidden', 'Asset credential required');
        protocolCheck('records/description.json', data); if (data.asset_id !== id) fail(403, 'forbidden', 'Wrong Asset');
        run('UPDATE assets SET description=? WHERE id=?', encode(data), id); return { status: 200, value: { event_id: event('asset.described', id, data) } };
      }
      if (method === 'POST' && entity[2] === 'reports') {
        if (principal.kind === 'account') fail(403, 'forbidden', 'Asset credential required');
        if (!Array.isArray(data.reports)) fail(400, 'invalid', 'reports must be an array');
        const ids = answerReports(id, data.reports.map(object)); return { status: 200, value: { event_ids: ids, as_of: asOf() } };
      }
      if (method === 'PATCH' && entity[2] === 'settings') {
        operator(principal); if (!row.online) fail(409, 'offline', 'Asset offline');
        if (Object.keys(data).some(key => key !== 'settings')) fail(400, 'invalid', 'Only settings belongs in this request');
        const record = { time: now(), asset_id: id, requested_by: principal.id, settings: data.settings }; protocolCheck('records/settings_change.json', record); checkSettings(data.settings);
        return { status: 202, value: { event_id: requestEvent('settings.requested', id, record) } };
      }
    }
    if (method === 'GET' && path === '/entities/assets') {
      const rows = all('SELECT id FROM assets').filter(row => { try { allowed(principal, String(row.id)); return true; } catch { return false; } });
      return { status: 200, value: { assets: rows.map(row => assetView(String(row.id))), as_of: asOf() } };
    }
    const tasks = path.match(/^\/tasks\/([^/]+)(?:\/(\d+)\/cancel)?$/);
    if (tasks) {
      const id = tasks[1]; allowed(principal, id); const row = asset(id);
      if (method === 'GET' && !tasks[2]) return { status: 200, value: { tasks: all('SELECT body,state,held,dropped FROM tasks WHERE asset_id=? ORDER BY task_id', id).map(row => ({ ...JSON.parse(String(row.body)), task_state: row.state, held: Boolean(row.held), dropped: Boolean(row.dropped) })), queue: get('SELECT e.record FROM queues q JOIN events e ON e.event_id=q.event_id WHERE q.asset_id=?', id)?.record ? JSON.parse(String(get('SELECT e.record FROM queues q JOIN events e ON e.event_id=q.event_id WHERE q.asset_id=?', id)?.record)) : null, as_of: asOf() } };
      operator(principal); if (!row.online) fail(409, 'offline', 'Asset offline');
      if (method === 'POST' && tasks[2]) {
        const taskId = integer(tasks[2], 'task_id'); if (!get('SELECT task_id FROM tasks WHERE asset_id=? AND task_id=?', id, taskId)) fail(409, 'unknown_task', 'Unknown Task');
        const record = { time: now(), asset_id: id, task_id: taskId, requested_by: principal.id }; protocolCheck('records/cancel.json', record);
        return { status: 202, value: { event_id: requestEvent('cancel.requested', id, record) } };
      }
      if (method === 'POST' && !tasks[2]) {
        if (!Array.isArray(data.tasks) || !data.tasks.length || data.tasks.length > 64) fail(400, 'invalid', 'tasks must contain 1..64 Tasks');
        if (data.now !== undefined && typeof data.now !== 'boolean') fail(400, 'invalid', 'now must be boolean');
        if (data.now && data.tasks.length !== 1) fail(400, 'invalid', 'now requires one Task');
        const first = Number(get('SELECT COALESCE(MAX(task_id),0)+1 AS id FROM tasks WHERE asset_id=?', id)?.id);
        const clearCount = Number(get('SELECT clear_count FROM queues WHERE asset_id=?', id)?.clear_count ?? 0);
        const description = row.description && JSON.parse(String(row.description));
        const bodies = data.tasks.map((raw, index) => {
          const input = object(raw); const record = { ...input, time: now(), asset_id: id, task_id: first + index, send_last: first + data.tasks.length - 1, clear_count: clearCount, requested_by: principal.id, ...(data.now ? { now: true } : {}) };
          // Operator cannot override attribution, numbering, or delivery metadata.
          if (Object.keys(input).some(key => ['time','asset_id','task_id','send_last','clear_count','requested_by','now'].includes(key))) fail(400, 'invalid', 'Task metadata belongs to Core');
          protocolCheck('records/task.json', record);
          if (input.kind === 'settings') checkSettings(input.settings);
          else if (!description?.commands.includes(input.kind)) fail(409, 'unsupported_command', 'Asset does not advertise command');
          return record;
        });
        for (const record of bodies) run('INSERT INTO tasks(asset_id,task_id,body) VALUES(?,?,?)', id, record.task_id, encode(record));
        return { status: 202, value: { task_ids: bodies.map(record => record.task_id), event_id: requestEvent('tasks.requested', id, { asset_id: id, tasks: bodies, requested_by: principal.id }) } };
      }
    }
    if (method === 'GET' && path === '/history') {
      const id = url.searchParams.get('asset_id'); if (id) allowed(principal, id); else operator(principal);
      const limit = Math.min(integer(url.searchParams.get('limit') ?? 1000, 'limit'), 1000); if (!limit) fail(400, 'invalid', 'limit must be positive');
      let cursorTime = -1, cursorId = 0;
      if (url.searchParams.has('cursor')) { const cursor = url.searchParams.get('cursor')!.split(':'); if (cursor.length !== 2) fail(400, 'invalid', 'cursor must be time:event_id'); cursorTime = integer(cursor[0], 'cursor time'); cursorId = integer(cursor[1], 'cursor event'); }
      const since = integer(url.searchParams.get('since') ?? 0, 'since'), until = integer(url.searchParams.get('until') ?? Number.MAX_SAFE_INTEGER, 'until');
      const report = url.searchParams.get('report');
      const rows = all('SELECT * FROM events WHERE report_time IS NOT NULL AND (? IS NULL OR asset_id=?) AND (? IS NULL OR kind=?) AND report_time>=? AND report_time<=? AND (report_time>? OR (report_time=? AND event_id>?)) ORDER BY report_time,event_id LIMIT ?', id, id, report ? `report.${report.replace(/^report\./,'')}` : null, report ? `report.${report.replace(/^report\./,'')}` : null, since, until, cursorTime, cursorTime, cursorId, limit + 1);
      const page = rows.slice(0, limit), last = page.at(-1);
      return { status: 200, value: { events: page.map(eventView), next_cursor: rows.length > limit && last ? `${last.report_time}:${last.event_id}` : null, as_of: asOf() } };
    }
    fail(404, 'not_found', 'No designed spike route');
  }
  function eventView(row: ReturnType<typeof all>[number]) { return { event_id: Number(row.event_id), time: Number(row.time), kind: String(row.kind), record: JSON.parse(String(row.record)), ...(row.clock_ahead ? { clock_ahead: true } : {}) }; }
  const streams = new Set<ServerResponse>();
  function stream(req: IncomingMessage, res: ServerResponse, url: URL, principal: Principal) {
    const id = url.searchParams.get('asset_id'); if (id) allowed(principal, id);
    let cursor = integer(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? asOf(), 'after');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders(); streams.add(res);
    let alive = now();
    const pump = () => {
      if (res.destroyed) return;
      const current = authenticate(req);
      if (!current || current.kind !== principal.kind || current.id !== principal.id) { res.end(); return; }
      const rows = all('SELECT * FROM events WHERE event_id>? ORDER BY event_id LIMIT 64', cursor);
      for (const row of rows) {
        cursor = Number(row.event_id);
        if (id && row.asset_id !== id) continue;
        if (principal.kind !== 'account') {
          if (!['tasks.requested','settings.requested','cancel.requested'].includes(String(row.kind))) continue;
          try { allowed(principal, String(row.asset_id)); } catch { continue; }
          if (get('SELECT dropped FROM requests WHERE event_id=?', cursor)?.dropped) continue;
        }
        if (!res.write(`id: ${cursor}\nevent: ${row.kind}\ndata: ${encode(eventView(row))}\n\n`)) { res.end(); return; }
      }
      if (now() - alive >= 10000) { alive = now(); if (!res.write(': alive\n\n')) res.end(); }
    };
    const timer = setInterval(pump, 20); timer.unref(); res.on('close', () => { clearInterval(timer); streams.delete(res); }); pump();
  }
  const server = createServer(config.tls, async (req, res) => {
    const method = req.method ?? 'GET', url = new URL(req.url ?? '/', 'https://spike.invalid'), path = url.pathname;
    const send = (response: Response) => { res.writeHead(response.status, { 'Content-Type': 'application/json', ...response.headers }); res.end(encode(response.value)); };
    try {
      const principal = authenticate(req);
      const definitions = path === '/events' ? url.searchParams.get('definitions') : req.headers['atlas-definitions'];
      if (path === '/about' && method === 'GET' && !principal) {
        if (req.headers.authorization) fail(401, 'unauthorized', 'Invalid key');
        send({ status: 200, value: { core_version: 'throwaway', protocol_version: 'unpublished', definitions_hash: definitionsHash, as_of: asOf() } }); return;
      }
      if (definitions !== definitionsHash) {
        if (path === '/about' && principal && principal.kind !== 'account') transaction(() => event('definitions.refused', principal.kind === 'asset' ? principal.id : null, { [`${principal.kind}_id`]: principal.id, definitions_hash: definitions ?? null }));
        fail(409, 'definitions_mismatch', `Expected ${definitionsHash}`);
      }
      sweep();
      if (principal?.kind === 'asset') transaction(() => touch(principal.id));
      if (path === '/about' && method === 'GET') { send({ status: 200, value: { core_version: 'throwaway', protocol_version: 'unpublished', definitions_hash: definitionsHash, as_of: asOf() } }); return; }
      if (path === '/events' && method === 'GET') { if (!principal) fail(401, 'unauthorized', 'Valid session or key required'); stream(req, res, url, principal); return; }
      const changing = !['GET','HEAD'].includes(method);
      if (changing && req.headers['content-type']?.split(';')[0].trim() !== 'application/json') fail(400, 'invalid', 'State changes require application/json');
      const data = changing ? await body(req) : {};
      if (!changing) { send(transaction(() => route(method,path,url,data,principal,req))); return; }
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !key.length || key.length > 64) fail(400, 'invalid', 'Idempotency-Key must contain 1..64 characters');
      const caller = principal ? `${principal.kind}:${principal.id}` : path === '/administration/login' ? `login:${string(data.operator_id,'operator_id')}` : fail(401,'unauthorized','Valid session or key required');
      const fingerprint = hash(`${method}\n${path}\n${encode(data)}`);
      const response = transaction(() => {
        const previous = get('SELECT * FROM idempotency_keys WHERE caller=? AND key=?', caller, key);
        if (previous) { if (previous.fingerprint !== fingerprint) fail(409, 'idempotency_conflict', 'Key already used with another request'); return { status: Number(previous.status), value: JSON.parse(String(previous.response)), headers: JSON.parse(String(previous.headers)) }; }
        db.exec('SAVEPOINT admission');
        let result: Response;
        try {
          result = route(method,path,url,data,principal,req);
          db.exec('RELEASE admission');
        } catch (error) {
          db.exec('ROLLBACK TO admission; RELEASE admission');
          if (!(error instanceof ApiError)) throw error;
          result = {status:error.status,value:{error:error.code,explanation:error.message}};
        }
        run('INSERT INTO idempotency_keys(caller,key,fingerprint,status,response,headers) VALUES(?,?,?,?,?,?)', caller,key,fingerprint,result.status,encode(result.value),encode(result.headers ?? {}));
        return result;
      });
      config.diagnostics?.({ time: now(), method, path, status: response.status }); send(response);
    } catch (error) {
      const known = error instanceof ApiError;
      config.diagnostics?.({ time: now(), method, path, status: known ? error.status : 500, error: known ? error.code : 'internal' });
      if (!res.headersSent) send({ status: known ? error.status : 500, value: { error: known ? error.code : 'internal', explanation: known ? error.message : 'Internal spike failure' } }); else res.destroy();
    }
  });
  const sweepTimer = setInterval(sweep, 100); sweepTimer.unref();
  const entities = {
    // Provisional stand-in record: no public route or implied Track contract.
    putTrack(id: string, record: Json) { return transaction(() => { run('INSERT INTO tracks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record', id, encode(record)); return event('track.provisional', null, { track_id: id, value: record }); }); },
    tracks() { return all('SELECT id,record FROM tracks').map(row => ({ track_id: row.id, value: JSON.parse(String(row.record)) })); },
  };
  return {
    server, db, definitionsHash, sweep, entities,
    async listen(port = 0, host = '127.0.0.1') { await new Promise<void>((resolve,reject) => { server.once('error',reject); server.listen(port,host,resolve); }); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No TCP address'); return `https://${host}:${address.port}`; },
    async close() { clearInterval(sweepTimer); for (const res of streams) res.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); },
  };
}
