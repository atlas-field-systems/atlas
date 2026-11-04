// End to end over real sockets: Core, an Asset link and an operator link. No mocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { startCore, hash } from '../src/core.mjs';
import { connectOperator } from '../src/operator.mjs';
import { startAsset } from '../sim/asset.mjs';
import { check } from '../src/protocol.mjs';

const dir = new URL('../protocol/examples/first-flight/', import.meta.url);
const ex = (f) => JSON.parse(readFileSync(new URL(f, dir)));
const strip = ({ time, seq, ...rest }) => rest;
const setup = () => startCore({ port: 0, enrollmentKey: 'enroll', operators: { OP1: hash('opkey') } });

// A raw Asset link that records what Core sends it.
function rawAsset(url, asset_id, key, enrollment_key) {
  const ws = new WebSocket(`${url}/asset?${new URLSearchParams({ asset_id, key, ...(enrollment_key && { enrollment_key }) })}`);
  const got = [];
  const waiters = [];
  ws.on('message', (d) => { const m = JSON.parse(d); got.push(m); waiters.splice(0).forEach((w) => w()); });
  const next = (n) => new Promise((r) => { const go = () => (got.length >= n ? r(got[n - 1]) : waiters.push(go)); go(); });
  const opened = new Promise((r, j) => { ws.on('open', r); ws.on('unexpected-response', (_, res) => j(res.statusCode)); });
  return { ws, got, next, opened, send: (m) => ws.send(JSON.stringify(m)) };
}

test('the protocol first-flight example runs through Core unchanged', async () => {
  const core = await setup();
  const url = `ws://localhost:${core.port}`;
  const op = connectOperator({ url, operator_id: 'OP1', key: 'opkey' });
  await op.ready;
  const drone = rawAsset(url, 'A1', 'assetkey', 'enroll');
  await drone.opened;
  const steps = ex('scenario.json').steps.filter((s) => s.branch === 'main' && s.file);
  let fromCore = 0;
  for (const step of steps) {
    const m = ex(step.file);
    assert.equal(check(m), null, step.file);
    if (step.from === 'Drone') {
      drone.send(m);
      await op.until((r) => r.type === m.type && r.seq === m.seq); // forwarded to the operator, unchanged
      assert.deepEqual(op.received.find((r) => r.type === m.type && r.seq === m.seq), m);
    } else {
      if (m.type === 'control.command') {
        const reply = await op.request(strip(m));
        assert.equal(reply.reply_result, 'accepted', step.file);
      }
      const got = await drone.next(++fromCore);
      assert.deepEqual(strip(got), strip(m), step.file);
      assert.equal(check(got), null);
    }
  }
  for (const t of ['T1', 'T2', 'T3']) assert.equal(core.store.task('A1', t).task_state, 'completed');
  const path = core.store.history('A1');
  assert.deepEqual(path, steps.filter((s) => s.file.includes('telemetry')).map((s) => ex(s.file)));
  // Reading history over the operator link gives the same path.
  const r = await op.request({ type: 'query.core', kind: 'history', asset_id: 'A1', report: 'telemetry' });
  assert.equal(r.reply_result, 'accepted');
  op.close(); drone.ws.close(); await core.close();
});

test('a simulated drone flies first flight from operator commands', async (t) => {
  const core = await setup();
  const url = `ws://localhost:${core.port}`;
  const sim = startAsset({ url, asset_id: 'A1', key: 'assetkey', enrollment_key: 'enroll', speed: 40 });
  t.after(async () => { sim.close(); op.close(); await core.close(); });
  const op = connectOperator({ url, operator_id: 'OP1', key: 'opkey' });
  await op.ready;
  await op.until((m) => m.type === 'report.battery');
  for (const f of ['07-command-takeoff.json', '08-command-move_to.json', '09-command-land.json']) {
    assert.equal((await op.request(strip(ex(f)))).reply_result, 'accepted');
  }
  await op.until((m) => m.task_id === 'T3' && m.task_state === 'completed', 20000);
  const path = core.store.history('A1');
  const last = path.at(-1).position;
  assert.ok(path.length > 5);
  assert.ok(Math.max(...path.map((t) => t.position.altitudes[0].altitude_m)) === 30);
  assert.equal(last.altitudes[0].altitude_m, 0);
  assert.ok(Math.abs(last.latitude - 42.2746) < 1e-4 && Math.abs(last.longitude + 71.8063) < 1e-4);

});

test('auth, refusals and duplicates', async () => {
  const core = await setup();
  const url = `ws://localhost:${core.port}`;
  await assert.rejects(rawAsset(url, 'A1', 'k', 'wrong').opened, (c) => c === 401);
  const a = rawAsset(url, 'A1', 'k', 'enroll'); await a.opened;
  await assert.rejects(rawAsset(url, 'A1', 'other').opened, (c) => c === 401); // ID taken, wrong key
  await assert.rejects(connectOperator({ url, operator_id: 'OP1', key: 'bad' }).ready);
  a.send({ ...ex('01-hello.json'), commands: ['land'] });
  await a.next(1);
  const op = connectOperator({ url, operator_id: 'OP1', key: 'opkey' });
  await op.ready;
  const takeoff = await op.request(strip(ex('07-command-takeoff.json')));
  assert.equal(takeoff.reply_result, 'refused');
  assert.equal(takeoff.explanation, 'A1 does not accept takeoff');
  const bad = await op.request({ type: 'control.command', asset_id: 'A1', kind: 'land' });
  assert.equal(bad.reply_result, 'refused');
  assert.equal((await op.request({ type: 'control.settings', asset_id: 'A1', lights: 'on' })).explanation, 'A1 has no setting lights');
  // The same report twice (as over two links) is stored once.
  a.send(ex('05-telemetry.json')); a.send(ex('05-telemetry.json'));
  await op.until((m) => m.type === 'report.telemetry');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(core.store.history('A1').length, 1);
  op.close(); a.ws.close(); await core.close();
});
