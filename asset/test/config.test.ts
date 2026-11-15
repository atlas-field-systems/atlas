import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseConfig, inspectConfig } from '../src/config.ts';

test('config.md: inspection validates Protocol values without equipment access and removes the key', async () => {
  const input = JSON.parse(await readFile(new URL('../examples/copter.json', import.meta.url), 'utf8'));
  const config = parseConfig(input);
  assert.equal(inspectConfig(config).asset_key, '[removed]');
  assert.throws(() => parseConfig({ ...input, max_ground_speed_mps: 1 }), /exceeds/);
  const { measurement_stale_after_s, ...missing } = input;
  assert.throws(() => parseConfig(missing), /measurement_stale_after_s/);
  assert.throws(() => parseConfig({ ...input, initial_settings: { run_state: 'go' } }), /invalid/);
});
