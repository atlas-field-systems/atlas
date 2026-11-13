import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPackagedProtocol } from '@atlas/protocol';

const protocol = await loadPackagedProtocol();
const report = (count) => ({
  type: 'report.status',
  time: 1793667600000,
  asset_id: 'A1',
  kind: 'queue',
  request_id: 122,
  task_ids: Array.from({ length: count }, (_, i) => i + 1),
});

test('a complete queue at the admitted capacity of 64 Tasks is representable', () => {
  const result = protocol.check('report.status', report(64));
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('a queue of 65 Tasks exceeds the complete report capacity', () => {
  const result = protocol.check('report.status', report(65));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.message.includes('64 items')));
});

const tasks = (count, now) => ({ tasks: Array.from({ length: count }, () => ({ kind: 'return_to_home' })), ...(now === undefined ? {} : { now }) });

test('a Tasks request holds 1 to 64 Tasks', () => {
  assert.equal(protocol.check('requests.tasks', tasks(64)).ok, true);
  assert.equal(protocol.check('requests.tasks', tasks(65)).ok, false);
  assert.equal(protocol.check('requests.tasks', tasks(0)).ok, false);
});

test('a now request holds exactly one Task', () => {
  assert.equal(protocol.check('requests.tasks', tasks(1, true)).ok, true);
  assert.equal(protocol.check('requests.tasks', tasks(2, true)).ok, false);
  assert.equal(protocol.check('requests.tasks', tasks(2, false)).ok, true);
});

test('a failsafe Task is sent alone with now', () => {
  const failsafe = (body) => protocol.check('requests.tasks', body).ok;
  assert.equal(failsafe({ tasks: [{ kind: 'failsafe' }], now: true }), true);
  assert.equal(failsafe({ tasks: [{ kind: 'failsafe' }] }), false);
  assert.equal(failsafe({ tasks: [{ kind: 'hold' }, { kind: 'failsafe' }] }), false);
});

test('neither a queue report nor a Task carries a clear count', () => {
  assert.equal(protocol.check('report.status', { ...report(1), clear_count: 0 }).ok, false);
  const task = { time: 1793667600000, asset_id: 'A1', task_id: 1, requested_by: 'OP1', kind: 'hold' };
  assert.equal(protocol.check('task', task).ok, true);
  assert.equal(protocol.check('task', { ...task, clear_count: 0 }).ok, false);
});
