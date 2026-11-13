import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPackagedProtocol } from '@atlas/protocol';

const protocol = await loadPackagedProtocol();
const commands = ['takeoff', 'move_to', 'land', 'return_to_home', 'hold', 'point_at', 'failsafe', 'capture'];
const body = { entity_type: 'drone', reports: ['status', 'failsafe'], commands };

test('an Asset registers without an asset_id, because Core assigns it', () => {
  const result = protocol.check('requests.asset', body);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('a registration that names an asset_id is refused', () => {
  assert.equal(protocol.check('requests.asset', { ...body, asset_id: 'A1' }).ok, false);
});

test('the description record Core makes from it keeps the asset_id', () => {
  const record = { time: 1793667600100, asset_id: 'A1', ...body };
  const result = protocol.check('description', record);
  assert.equal(result.ok, true, JSON.stringify(result));
  const { asset_id, ...unidentified } = record;
  assert.equal(protocol.check('description', unidentified).ok, false);
});

test('an Asset can list every command', () => {
  const result = protocol.check('description', { time: 1793667600100, asset_id: 'A1', ...body });
  assert.equal(result.ok, true, JSON.stringify(result));
});
