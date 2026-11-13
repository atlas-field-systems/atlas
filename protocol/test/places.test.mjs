import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPackagedProtocol } from '@atlas/protocol';

const protocol = await loadPackagedProtocol();
const point = { latitude: 42.2751, longitude: -71.8049 };
const stamped = { time: 1793667600000, asset_id: 'A1', task_id: 1, requested_by: 'OP1' };

test('a Task that names a place carries the copy Core made', () => {
  assert.equal(protocol.check('task', { ...stamped, kind: 'move_to', geofeature_id: 'G2', destination: point }).ok, true);
  assert.equal(protocol.check('task', { ...stamped, kind: 'move_to', geofeature_id: 'G2' }).ok, false);
  assert.equal(protocol.check('task', { ...stamped, kind: 'land', geofeature_id: 'G2', landing_position: point }).ok, true);
  assert.equal(protocol.check('task', { ...stamped, kind: 'land', geofeature_id: 'G2' }).ok, false);
});

test('a Task request names a place without a position', () => {
  assert.equal(protocol.check('requests.task', { kind: 'move_to', geofeature_id: 'G2' }).ok, true);
  assert.equal(protocol.check('requests.task', { kind: 'move_to', geofeature_id: 'G2', destination: point }).ok, false);
  assert.equal(protocol.check('requests.task', { kind: 'land', geofeature_id: 'G2', landing_position: point }).ok, false);
});
