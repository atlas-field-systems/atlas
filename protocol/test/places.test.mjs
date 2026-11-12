import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../lib/node-protocol.mjs';
import { validate } from '../lib/protocol.mjs';

const protocol = await load();
const point = { latitude: 42.2751, longitude: -71.8049 };
const stamped = { time: 1793667600000, asset_id: 'A1', task_id: 1, requested_by: 'OP1' };

test('a Task that names a place carries the copy Core made', () => {
  assert.equal(validate(protocol, 'records/task.json', { ...stamped, kind: 'move_to', geofeature_id: 'G2', destination: point }).ok, true);
  assert.equal(validate(protocol, 'records/task.json', { ...stamped, kind: 'move_to', geofeature_id: 'G2' }).ok, false);
  assert.equal(validate(protocol, 'records/task.json', { ...stamped, kind: 'land', geofeature_id: 'G2', landing_position: point }).ok, true);
  assert.equal(validate(protocol, 'records/task.json', { ...stamped, kind: 'land', geofeature_id: 'G2' }).ok, false);
});

test('a Task request names a place without a position', () => {
  assert.equal(validate(protocol, 'requests/task.json', { kind: 'move_to', geofeature_id: 'G2' }).ok, true);
  assert.equal(validate(protocol, 'requests/task.json', { kind: 'move_to', geofeature_id: 'G2', destination: point }).ok, false);
  assert.equal(validate(protocol, 'requests/task.json', { kind: 'land', geofeature_id: 'G2', landing_position: point }).ok, false);
});
