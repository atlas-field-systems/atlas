import test from 'node:test';
import assert from 'node:assert/strict';
import { createAsset, type Task } from './asset.ts';

// Expectations are authored from asset/docs/README.md and failsafes.md, not examples or schemas.
function task(id: number, extras: Partial<Task> = {}): Task {
  return {time: 1000, asset_id: 'A1', task_id: id, clear_count: 0, requested_by: 'OP1', kind: 'takeoff', target_altitude: {altitude_m: 10, altitude_reference: 'launch'}, ...extras} as Task;
}
const event = (event_id: number, tasks: Task[]) => ({event_id, kind: 'tasks.requested', record: {asset_id: 'A1', tasks, requested_by: 'OP1'}});
const cancel = (event_id: number, task_id: number) => ({event_id, kind: 'cancel.requested', record: {time: 1000, asset_id: 'A1', task_id, requested_by: 'OP1'}});

test('queue waits for missing lower IDs and complete send_last; duplicates never repeat execution', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  a.receive(event(1, [task(3, {send_last: 3})])); assert.equal(a.active, null);
  a.receive(event(2, [task(1, {send_last: 3})])); assert.equal(a.active, null);
  a.receive(event(3, [task(2, {send_last: 3})])); assert.equal(a.active, 1);
  a.complete(); assert.equal(a.active, 2); a.complete(); assert.equal(a.active, 3); a.complete();
  a.receive(event(4, [task(1), task(2), task(3)])); assert.equal(a.active, null);
  assert.equal(a.diagnostics.filter(x => 'task_state' in x && x.task_state === 'active').length, 3);
});

test('cancel before arrival counts toward send_last and never runs', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  a.receive(event(1, [task(1, {send_last: 2})])); assert.equal(a.active, null);
  a.receive(cancel(2, 2)); assert.equal(a.active, 1);
  a.receive(event(3, [task(2)])); a.complete(); assert.equal(a.active, null); assert.equal(a.states.get(2), 'cancelled');
});

test('now bypasses pause, missing IDs and stale clear_count, cancels lower work', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000, settings: {run_state: 'paused'}});
  a.receive(event(1, [task(1)])); assert.equal(a.active, null);
  a.receive(event(2, [task(4, {now: true, clear_count: 8})])); assert.equal(a.active, 4);
  assert.equal(a.states.get(1), 'cancelled'); assert.equal(a.states.get(2), 'cancelled'); assert.equal(a.states.get(3), 'cancelled');
  a.receive(event(3, [task(2)])); assert.equal(a.active, 4); a.complete(); assert.equal(a.active, null);
});

test('observed failure clears remaining work and rejects old-count work arriving later', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  a.receive(event(1, [task(1), task(2)])); a.complete('failed', 'Equipment did not act');
  assert.equal(a.clear_count, 1); assert.equal(a.states.get(1), 'failed'); assert.equal(a.states.get(2), 'cancelled');
  a.receive(event(2, [task(3)])); assert.equal(a.states.get(3), 'cancelled');
  a.receive(event(3, [task(4, {clear_count: 1})])); assert.equal(a.active, 4);
});

test('missing equipment fails immediately and readiness never revives the Task', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000}); a.equipmentReady = false;
  a.receive(event(1, [task(1)])); assert.equal(a.states.get(1), 'failed'); a.equipmentReady = true;
  a.receive(event(2, [task(1)])); assert.equal(a.active, null);
});

test('settings follow event order; repeated event cannot undo newer end state', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  const setting = (id: number, lights: string) => ({event_id: id, kind: 'settings.requested', record: {time: 1000, asset_id: 'A1', requested_by: 'OP1', settings: {lights}}});
  a.receive(setting(1, 'on')); a.receive(setting(2, 'off')); a.receive(setting(1, 'on')); assert.equal(a.settings.lights, 'off');
});

test('retained batch retries keep identical key and original reports while newer outcomes wait', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  a.receive(event(1, [task(1)])); const batch = structuredClone(a.takeBatch());
  a.complete(); assert.deepEqual(a.takeBatch(), batch); a.ackBatch(batch.key);
  const next = a.takeBatch(); assert.notEqual(next.key, batch.key); assert(next.reports.some(r => 'task_state' in r && r.task_state === 'completed'));
});

test('failsafe priorities rise, fallback runs once, contact recovery cannot unlock ordinary work', async () => {
  let now = 1000; const a = await createAsset({asset_id: 'A1', now: () => now, settings: {home_position: {latitude: 10, longitude: 20}}});
  a.replacePolicy([{id: 'LINK', priority: 1, conditions: [{kind: 'contact_lost', afterMs: 20}], response: 'return_to_home', fallback: 'land'}, {id: 'BAT', priority: 2, conditions: [{kind: 'battery_below', percent: 10}], response: 'land'}]);
  a.receive(event(1, [task(1), task(2)])); now += 21; a.tick();
  assert.equal(a.states.get(1), 'cancelled'); assert.equal(a.states.get(2), 'cancelled'); assert.equal(a.failsafe?.response?.action, 'return_to_home');
  a.completeResponse('failed'); assert.equal(a.failsafe?.response?.fallback, true); a.completeResponse('failed'); a.tick();
  assert.equal(a.failsafe?.response?.outcome, 'failed'); a.contact(); a.tick();
  a.receive(event(2, [task(3, {clear_count: a.clear_count})])); assert.equal(a.states.get(3), 'failed');
  a.battery = 5; a.tick(); assert.equal(a.failsafe?.priority, 2); assert.equal(a.failsafe?.response?.action, 'land');
  a.completeResponse('completed', true); assert.equal(a.stopped, true);
});

test('paused queued work is not idle, but a queue blocked by missing Tasks is idle', async () => {
  let now = 1000; const a = await createAsset({asset_id: 'A1', now: () => now, settings: {run_state: 'paused'}});
  a.receive(event(1, [task(1)])); a.replacePolicy([{id: 'IDLE', priority: 1, conditions: [{kind: 'idle', afterMs: 10}], response: 'land'}]);
  now += 100; a.tick(); assert.equal(a.failsafe, null);
  const b = await createAsset({asset_id: 'A1', now: () => now}); b.receive(event(1, [task(2)]));
  b.replacePolicy([{id: 'IDLE', priority: 1, conditions: [{kind: 'idle', afterMs: 10}], response: 'land'}]);
  now += 11; b.tick(); assert.equal(b.failsafe?.response?.action, 'land');
});

test('failsafe permits only Land/Return now and pure pause settings', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  a.replacePolicy([{id: 'IDLE', priority: 1, conditions: [{kind: 'idle', afterMs: 0}], response: 'land'}]);
  a.receive(event(1, [{time: 1000, asset_id: 'A1', task_id: 1, clear_count: a.clear_count, requested_by: 'OP1', kind: 'land', landing_position: {latitude: 10, longitude: 20}, now: true}])); assert.equal(a.active, 1);
  a.receive(cancel(2, 1)); assert.equal(a.active, 1);
  a.receive({event_id: 3, kind: 'settings.requested', record: {time: 1000, asset_id: 'A1', requested_by: 'OP1', settings: {run_state: 'paused', lights: 'on'}}});
  assert.equal(a.settings.lights, undefined); assert.equal(a.settings.run_state, 'running');
});

test('lost GPS fix emits no newly timed stale telemetry; first home persists', async () => {
  let now = 1000; const a = await createAsset({asset_id: 'A1', now: () => now});
  a.observePosition({latitude: 10, longitude: 20}, 900, 'GPS');
  now = 2000; a.observePosition(null, 1900, 'GPS');
  assert.deepEqual(a.position, {value: {latitude: 10, longitude: 20}, time: 900, source: 'GPS'});
  a.observePosition({latitude: 11, longitude: 21}, 2000, 'GPS');
  assert.deepEqual(a.settings.home_position, {latitude: 10, longitude: 20});
  const reports = a.reports().filter(r => 'type' in r && r.type === 'report.telemetry');
  assert.equal(reports.length, 2); assert.equal('time' in reports[0] && reports[0].time, 900);
});

test('reporting-only tracker invents no queue, settings, or home', async () => {
  const a = await createAsset({asset_id: 'A1', reportingOnly: true, now: () => 1000});
  a.snapshotReports(); assert.deepEqual(a.reports(), []);
  a.observePosition({latitude: 10, longitude: 20}, 950, 'GPS');
  assert.equal(a.reports().length, 1); assert.equal(a.settings.home_position, undefined);
});

test('independent autopilot takeover cancels work without claiming Atlas performed it', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  a.receive(event(1, [task(1), task(2)])); assert.equal(a.executions.length, 1);
  a.autopilotTakeover(); assert.equal(a.states.get(1), 'cancelled'); assert.equal(a.states.get(2), 'cancelled');
  assert.equal(a.executions.length, 1); assert.equal(a.failsafe?.response, null);
});

test('design probe: 65 held Tasks cannot be represented by Protocol queue report', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000, settings: {run_state: 'paused'}});
  for (let id = 1; id <= 64; id++) a.receive(event(id, [task(id)]));
  assert.equal(a.queue().length, 64);
  assert.throws(() => a.receive(event(65, [task(65)])), /64 items/);
  // This is a documented incompatibility probe, not an endorsement of a partial acceptance.
});

const polygon = [{latitude: 0, longitude: 0}, {latitude: 0, longitude: 0.01}, {latitude: 0.01, longitude: 0.01}, {latitude: 0.01, longitude: 0}];

test('geofence acts when already outside at startup, with zero distance and duration', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  a.observePosition({latitude: 0.005, longitude: 0.02}, 1000, 'GPS');
  a.replacePolicy([{id: 'GEO', priority: 1, conditions: [{kind: 'outside', polygon, distanceM: 0, afterMs: 0}], response: 'land'}]);
  assert.equal(a.failsafe?.response?.action, 'land');
});

test('unknown and boundary positions establish no outside evidence', async () => {
  const a = await createAsset({asset_id: 'A1', now: () => 1000});
  a.replacePolicy([{id: 'GEO', priority: 1, conditions: [{kind: 'outside', polygon, distanceM: 0, afterMs: 0}], response: 'land'}]);
  assert.equal(a.failsafe, null);
  a.observePosition({latitude: 0, longitude: 0.005}, 1000, 'GPS'); assert.equal(a.failsafe, null);
  a.observePosition(null, 1000, 'GPS'); assert.equal(a.failsafe, null);
});

test('outside distance and elapsed duration both matter; policy replacement preserves elapsed interval', async () => {
  let now = 1000; const a = await createAsset({asset_id: 'A1', now: () => now});
  a.observePosition({latitude: 0.005, longitude: 0.02}, now, 'GPS');
  a.replacePolicy([{id: 'GEO', priority: 1, conditions: [{kind: 'outside', polygon, distanceM: 2000, afterMs: 100}], response: 'land'}]);
  now += 200; a.tick(); assert.equal(a.failsafe, null); // about 1112 m beyond edge, not 2000 m.
  a.replacePolicy([{id: 'NEW', priority: 1, conditions: [{kind: 'outside', polygon, distanceM: 500, afterMs: 150}], response: 'land'}]);
  assert.equal(a.failsafe?.response?.action, 'land');
});

test('returning inside resets outside duration and stale location cannot prove outside', async () => {
  let now = 1000; const a = await createAsset({asset_id: 'A1', now: () => now});
  a.observePosition({latitude: 0.005, longitude: 0.02}, now, 'GPS');
  a.replacePolicy([{id: 'GEO', priority: 1, conditions: [{kind: 'outside', polygon, distanceM: 0, afterMs: 100, maxAgeMs: 150}], response: 'land'}]);
  now += 50; a.observePosition({latitude: 0.005, longitude: 0.005}, now, 'GPS');
  now += 30; a.observePosition({latitude: 0.005, longitude: 0.02}, now, 'GPS');
  now += 70; a.tick(); assert.equal(a.failsafe, null);
  now += 100; a.tick(); assert.equal(a.failsafe, null); // now stale, no outside trigger.
  a.observePosition({latitude: 0.005, longitude: 0.02}, now, 'GPS');
  now += 101; a.tick(); assert.equal(a.failsafe?.response?.action, 'land');
});

test('missing and stale measurement conditions are distinct and reevaluate with time', async () => {
  let now = 1000; const a = await createAsset({asset_id: 'A1', now: () => now});
  a.replacePolicy([{id: 'MISS', priority: 1, conditions: [{kind: 'position_missing', afterMs: 50}], response: 'land'}]);
  now += 30; a.tick(); assert.equal(a.failsafe, null);
  a.replacePolicy([{id: 'MISS', priority: 1, conditions: [{kind: 'position_missing', afterMs: 40}], response: 'land'}]);
  now += 11; a.tick(); assert.equal(a.failsafe?.response?.action, 'land');
  const b = await createAsset({asset_id: 'A1', now: () => now});
  b.observePosition({latitude: 0.005, longitude: 0.005}, now, 'GPS');
  b.replacePolicy([{id: 'STALE', priority: 1, conditions: [{kind: 'position_stale', maxAgeMs: 100}], response: 'land'}]);
  now += 99; b.tick(); assert.equal(b.failsafe, null); now++; b.tick(); assert.equal(b.failsafe?.response?.action, 'land');
});
