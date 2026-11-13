import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../lib/node-protocol.mjs';

const protocol = await load();
const rule = {
  rule_id: 'CB1',
  priority: 90,
  conditions: [{ kind: 'battery_below', battery_percent: 10, critical: true }],
  response: { kind: 'land' },
};

test('a failsafe rule has one response and no fallback', () => {
  const result = protocol.checkFile('components/failsafe_rule.json', rule);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(protocol.checkFile('components/failsafe_rule.json', { ...rule, fallback: { kind: 'return_to_home' } }).ok, false);
});

test('there is no stale-data condition', () => {
  const stale = { ...rule, conditions: [{ kind: 'measurement_stale', measurement: 'position', stale_after_s: 5 }] };
  assert.equal(protocol.checkFile('components/failsafe_rule.json', stale).ok, false);
});

test('a failsafe response report names no attempt', () => {
  const report = { type: 'report.failsafe', time: 1793667600000, asset_id: 'A1', kind: 'response', rule_id: 'CB1', task_state: 'active', response: { kind: 'return_to_home' } };
  const result = protocol.protocol.check('report.failsafe', report);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(protocol.protocol.check('report.failsafe', { ...report, attempt: 'fallback' }).ok, false);
});
