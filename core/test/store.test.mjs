import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.mjs';

test('latestReport returns the newest base report', (t) => {
  const store = openStore();
  t.after(() => store.close());
  const settings = { type: 'report.settings', time: 1, seq: 1, asset_id: 'A1', lights: 'off' };
  const updated = { ...settings, time: 2, seq: 2, lights: 'on' };
  store.report(settings);
  store.report(updated);
  assert.deepEqual(store.latestReport('A1', 'settings'), updated);
});

test('latestReport falls back to Asset status', (t) => {
  const store = openStore();
  t.after(() => store.close());
  const status = { type: 'report.status', time: 1, seq: 1, asset_id: 'A1', kind: 'asset', condition: 'healthy' };
  store.report(status);
  assert.deepEqual(store.latestReport('A1', 'status'), status);
  assert.equal(store.latestReport('A2', 'status'), undefined);
});

test('latestReport prefers the base report over a newer Asset status', (t) => {
  const store = openStore();
  t.after(() => store.close());
  const base = { type: 'report.status', time: 1, seq: 1, asset_id: 'A1', condition: 'degraded' };
  store.report(base);
  store.report({ ...base, time: 2, seq: 2, kind: 'asset', condition: 'healthy' });
  assert.deepEqual(store.latestReport('A1', 'status'), base);
});

test('latestReport leaves missing reports undefined', (t) => {
  const store = openStore();
  t.after(() => store.close());
  assert.equal(store.latestReport('A1', 'telemetry'), undefined);
});
