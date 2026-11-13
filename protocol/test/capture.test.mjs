import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPackagedProtocol } from '@atlas/protocol';

const protocol = await loadPackagedProtocol();

// Task shapes and output IDs: docs/decisions.md, Tasks.
test('capture requires a duration only for clips', () => {
  const capture = { kind: 'capture', camera_id: 'C1', media: 'photo' };
  const accepts = (body) => protocol.check('requests.task', body).ok;
  assert.equal(accepts(capture), true);
  assert.equal(accepts({ ...capture, duration_s: 10 }), false);
  assert.equal(accepts({ ...capture, camera_id: undefined }), false);
  assert.equal(accepts({ ...capture, media: 'clip' }), false);
  assert.equal(accepts({ ...capture, media: 'clip', duration_s: 60 }), true);
  assert.equal(accepts({ ...capture, media: 'clip', duration_s: 0 }), false);
  assert.equal(accepts({ ...capture, media: 'clip', duration_s: 61 }), false);
});

test('only completed Tasks name stored Objects, up to 16', () => {
  const report = { type: 'report.status', time: 1793667600000, asset_id: 'A1', kind: 'task', task_id: 9, task_state: 'completed', object_ids: ['F1'] };
  const accepts = (body) => protocol.check('report.status', body).ok;
  assert.equal(accepts(report), true);
  for (const task_state of ['active', 'failed', 'cancelled']) {
    assert.equal(accepts({ ...report, task_state }), false);
  }
  assert.equal(accepts({ ...report, object_ids: [] }), false);
  assert.equal(accepts({ ...report, object_ids: Array(16).fill('F1') }), true);
  assert.equal(accepts({ ...report, object_ids: Array(17).fill('F1') }), false);
});
