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
