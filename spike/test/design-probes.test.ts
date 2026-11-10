import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadProtocol, validate } from '../../protocol/lib/protocol.mjs';

const protocol = await loadProtocol(
  async (file: string) => JSON.parse(await readFile(new URL(`../../protocol/definitions/${file}`, import.meta.url), 'utf8')),
  Ajv,
  addFormats,
);

// Scenario oracle: core/docs/api.md, Operator requests; asset/docs/README.md,
// Pause and The queue. A paused Asset keeps every accepted Task until it runs.
// This test characterizes a design conflict, rather than approving the limit.
test('design probe: 65 individually valid queued Tasks cannot be acknowledged as a complete queue', () => {
  const taskIds = Array.from({ length: 65 }, (_, index) => index + 1);
  for (const task_id of taskIds) {
    const task = {
      time: 1800000000000,
      asset_id: 'A1',
      task_id,
      clear_count: 0,
      requested_by: 'OP1',
      kind: 'return_to_home',
    };
    assert.equal(validate(protocol, 'records/task.json', task).ok, true);
  }
  const heldQueue = {
    type: 'report.status',
    time: 1800000000001,
    asset_id: 'A1',
    kind: 'queue',
    clear_count: 0,
    task_ids: taskIds,
    request_id: 100,
  };
  assert.equal(validate(protocol, 'records/report/status.json', {
    ...heldQueue,
    task_ids: taskIds.slice(0, 64),
  }).ok, true);
  const result = validate(protocol, 'records/report/status.json', heldQueue);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error: string) => error.includes('/task_ids') && error.includes('64')),
    JSON.stringify(result.errors));
});

// Scenario oracle: core/docs/api.md, Operator requests. Task numbers rise for
// the run and never recycle. This is a documented boundary, not a new defect.
test('design probe: a run exhausts the Task identity space after 9999 Tasks per Asset', () => {
  const task = {
    time: 1800000000000,
    asset_id: 'A1',
    task_id: 9999,
    clear_count: 0,
    requested_by: 'OP1',
    kind: 'return_to_home',
  };
  assert.equal(validate(protocol, 'records/task.json', task).ok, true);
  assert.equal(validate(protocol, 'records/task.json', { ...task, task_id: 10000 }).ok, false);
});
