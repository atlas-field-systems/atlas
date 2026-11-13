import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../lib/node-protocol.mjs';
import { validate } from '../lib/protocol.mjs';

const protocol = await load();
const commands = ['takeoff', 'move_to', 'land', 'return_to_home', 'hold', 'point_at', 'failsafe', 'capture'];
const body = { entity_type: 'drone', reports: ['status', 'failsafe'], commands };

test('an Asset registers without an asset_id, because Core assigns it', () => {
  const result = validate(protocol, 'requests/asset.json', body);
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('a registration that names an asset_id is refused', () => {
  assert.equal(validate(protocol, 'requests/asset.json', { ...body, asset_id: 'A1' }).ok, false);
});

test('the description record Core makes from it keeps the asset_id', () => {
  const record = { time: 1793667600100, asset_id: 'A1', ...body };
  const result = validate(protocol, 'records/description.json', record);
  assert.equal(result.ok, true, result.errors.join('\n'));
  const { asset_id, ...unidentified } = record;
  assert.equal(validate(protocol, 'records/description.json', unidentified).ok, false);
});

test('an Asset can list every command', () => {
  assert.equal(commands.length, protocol.schemas['variables/command.json'].enum.length);
  const result = validate(protocol, 'records/description.json', { time: 1793667600100, asset_id: 'A1', ...body });
  assert.equal(result.ok, true, result.errors.join('\n'));
});
