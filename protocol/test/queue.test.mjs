import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../lib/node-protocol.mjs';
import { validate } from '../lib/protocol.mjs';

const protocol = await load();
const report = (count) => ({
  type: 'report.status',
  time: 1793667600000,
  asset_id: 'A1',
  kind: 'queue',
  clear_count: 0,
  request_id: 122,
  task_ids: Array.from({ length: count }, (_, i) => i + 1),
});

test('a complete queue at the admitted capacity of 64 Tasks is representable', () => {
  const result = validate(protocol, 'records/report/status.json', report(64));
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('a queue of 65 Tasks exceeds the complete report capacity', () => {
  const result = validate(protocol, 'records/report/status.json', report(65));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('64 items')));
});

const tasks = (count, now) => ({ tasks: Array.from({ length: count }, () => ({ kind: 'return_to_home' })), ...(now === undefined ? {} : { now }) });

test('a Tasks request holds 1 to 64 Tasks', () => {
  assert.equal(validate(protocol, 'requests/tasks.json', tasks(64)).ok, true);
  assert.equal(validate(protocol, 'requests/tasks.json', tasks(65)).ok, false);
  assert.equal(validate(protocol, 'requests/tasks.json', tasks(0)).ok, false);
});

test('a now request holds exactly one Task', () => {
  assert.equal(validate(protocol, 'requests/tasks.json', tasks(1, true)).ok, true);
  assert.equal(validate(protocol, 'requests/tasks.json', tasks(2, true)).ok, false);
  assert.equal(validate(protocol, 'requests/tasks.json', tasks(2, false)).ok, true);
});

test('a failsafe Task is sent alone with now', () => {
  const failsafe = (body) => validate(protocol, 'requests/tasks.json', body).ok;
  assert.equal(failsafe({ tasks: [{ kind: 'failsafe' }], now: true }), true);
  assert.equal(failsafe({ tasks: [{ kind: 'failsafe' }] }), false);
  assert.equal(failsafe({ tasks: [{ kind: 'hold' }, { kind: 'failsafe' }] }), false);
});
