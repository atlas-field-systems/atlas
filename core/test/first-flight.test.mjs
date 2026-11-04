// End to end over real sockets: Core, Asset links and operator links. No mocks.
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
const strip = ({ time, seq, key, enrollment_key, ...rest }) => rest;
const ENROLL = ex('01-hello.json').enrollment_key;
const OPKEY = 'operator-key-000000000';
const setup = () => startCore({ port: 0, enrollmentKey: ENROLL, operators: { OP1: hash(OPKEY) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A raw link that records what Core sends it.
function raw(url, side = 'asset') {
  const ws = new WebSocket(`${url}/${side}`);
  const got = [];
  const waiters = [];
  ws.on('message', (d) => { const m = JSON.parse(d); got.push(m); waiters.splice(0).forEach((w) => w()); });
  const next = (n) => new Promise((r) => { const go = () => (got.length >= n ? r(got[n - 1]) : waiters.push(go)); go(); });
  const opened = new Promise((r) => ws.on('open', r));
  const closed = new Promise((r) => ws.on('close', r));
  return { ws, got, next, opened, closed, send: async (m) => { await opened; ws.send(JSON.stringify(m)); } };
}

test('the protocol first-flight example runs through Core', async () => {
  const core = await setup();
  const url = `ws://localhost:${core.port}`;
  const op = connectOperator({ url, operator_id: 'OP1', key: OPKEY });
  await op.ready;
  const drone = raw(url);
  const steps = ex('scenario.json').steps.filter((s) => s.branch === 'main' && s.file);
  let fromCore = 0;
  for (const step of steps) {
    const m = ex(step.file);
    assert.equal(check(m), null, step.file);
    if (step.from === 'Drone') {
      await drone.send(m);
      // Forwarded unchanged except for Core's own seq, and never with a key.
      const fwd = await op.until((r) => r.type === m.type && r.time === m.time);
      assert.deepEqual(strip(fwd), strip(m));
      assert.equal(fwd.key, undefined);
    } else {
      if (m.type === 'control.command') assert.equal((await op.request(strip(m))).reply_result, 'accepted', step.file);
      const got = await drone.next(++fromCore);
      assert.deepEqual(strip(got), strip(m), step.file);
      assert.equal(check(got), null);
    }
  }
  for (const t of ['T1', 'T2', 'T3']) assert.equal(core.store.task('A1', t).task_state, 'completed');
  const path = steps.filter((s) => s.file.includes('telemetry')).map((s) => ex(s.file));
  assert.deepEqual(core.store.history('A1'), path);
  assert.equal(JSON.stringify(core.store.hellos()).includes(ENROLL), false, 'no key is stored');
  // History over the operator link: the answer, then the reply that ends it.
  const before = op.received.length;
  const r = await op.request({ type: 'query.core', kind: 'history', asset_id: 'A1', report: 'telemetry' });
  const answer = op.received.slice(before, op.received.indexOf(r));
  assert.equal(r.reply_result, 'accepted');
  assert.deepEqual(answer.map(strip), path.map(strip));
  // An empty answer is the reply alone.
  const n = op.received.length;
  const empty = await op.request({ type: 'query.core', kind: 'history', asset_id: 'A1', report: 'telemetry', since: 0, until: 1 });
  assert.equal(op.received.indexOf(empty), n);
  op.close(); drone.ws.close(); await core.close();
});

test('a simulated drone flies first flight from operator commands', async (t) => {
  const core = await setup();
  const url = `ws://localhost:${core.port}`;
  const sim = startAsset({ url, asset_id: 'A1', key: 'asset-key-000000000000', enrollment_key: ENROLL, speed: 40 });
  const op = connectOperator({ url, operator_id: 'OP1', key: OPKEY });
  t.after(async () => { sim.close(); op.close(); await core.close(); });
  await op.ready;
  await op.until((m) => m.type === 'report.battery');
  for (const f of ['07-command-takeoff.json', '08-command-move_to.json', '09-command-land.json']) {
    assert.equal((await op.request(strip(ex(f)))).reply_result, 'accepted');
  }
  await op.until((m) => m.task_id === 'T3' && m.task_state === 'completed', 20000);
  const path = core.store.history('A1');
  const last = path.at(-1).position;
  assert.ok(path.length > 5);
  assert.equal(Math.max(...path.map((p) => p.position.altitudes[0].altitude_m)), 30);
  assert.equal(last.altitudes[0].altitude_m, 0);
  assert.ok(Math.abs(last.latitude - 42.2746) < 1e-4 && Math.abs(last.longitude + 71.8063) < 1e-4);
});

test('failsafes: link loss returns home, low battery lands', async (t) => {
  const core = await setup();
  const url = `ws://localhost:${core.port}`;
  const sim = startAsset({ url, asset_id: 'A1', key: 'asset-key-000000000000', enrollment_key: ENROLL, speed: 20 });
  const op = connectOperator({ url, operator_id: 'OP1', key: OPKEY });
  t.after(async () => { sim.close(); op.close(); await core.close(); });
  await op.ready;
  await op.until((m) => m.type === 'report.battery');
  const task = (f) => op.request(strip(ex(f)));
  await task('07-command-takeoff.json'); await task('08-command-move_to.json'); await task('09-command-land.json');
  await op.until((m) => m.task_id === 'T2' && m.task_state === 'active', 10000);
  await sleep(300);
  // The link drops mid move_to: the drone returns home by itself (link_loss_response) and says so when heard again.
  sim.cutLink(1500);
  await sleep(200);
  assert.equal((await task('07-command-takeoff.json')).explanation, 'A1 is not connected');
  const fs = await op.until((m) => m.type === 'report.failsafe' && m.kind === 'link_loss', 10000);
  assert.equal(fs.response, 'return_to_home');
  await op.until((m) => m.task_id === 'T2' && m.task_state === 'failed');
  await op.until((m) => m.task_id === 'T3' && m.task_state === 'cancelled');
  for (let i = 0; i < 100 && sim.position.alt > 0; i++) await sleep(100);
  const home = sim.position;
  assert.equal(home.alt, 0);
  assert.ok(Math.abs(home.latitude - 42.2746) < 1e-4 && Math.abs(home.longitude + 71.8063) < 1e-4);
  assert.equal(core.store.task('A1', 'T2').task_state, 'failed');

  // Low battery in the air: the drone lands where it is (low_battery_response: land).
  assert.equal((await op.request({ type: 'control.command', asset_id: 'A1', kind: 'takeoff', task_id: 'T4', task_seq: 4, target_altitude: { altitude_m: 30, altitude_reference: 'home' } })).reply_result, 'accepted');
  await op.until((m) => m.task_id === 'T4' && m.task_state === 'completed', 10000);
  assert.equal((await op.request({ type: 'control.command', asset_id: 'A1', kind: 'move_to', task_id: 'T5', task_seq: 5, destination: { latitude: 42.2760, longitude: -71.8063 } })).reply_result, 'accepted');
  await op.until((m) => m.task_id === 'T5' && m.task_state === 'active', 10000);
  await sleep(300);
  const where = sim.position;
  sim.setBattery(15);
  const low = await op.until((m) => m.type === 'report.failsafe' && m.kind === 'low_battery', 5000);
  assert.equal(low.response, 'land');
  assert.equal(check(low), null);
  await op.until((m) => m.task_id === 'T5' && m.task_state === 'failed');
  for (let i = 0; i < 100 && sim.position.alt > 0; i++) await sleep(100);
  const landed = sim.position;
  assert.equal(landed.alt, 0);
  assert.ok(Math.abs(landed.latitude - where.latitude) < 2e-4, 'lands near where the battery ran low, not home');
  assert.ok(landed.latitude > 42.2747);
});

test('keys in the hello, refusals, one link per ID, duplicates and repeats', async () => {
  const core = await setup();
  const url = `ws://localhost:${core.port}`;
  const hello = ex('01-hello.json');
  // Wrong enrollment key: refused, link closed.
  const bad = raw(url); await bad.send({ ...hello, enrollment_key: 'wrong-enrollment-key-0' });
  assert.equal((await bad.next(1)).hello_result, 'refused'); await bad.closed;
  // Anything before the hello closes the link.
  const early = raw(url); await early.send(ex('05-telemetry.json')); await early.closed;
  const a = raw(url); await a.send({ ...hello, commands: ['land'] });
  assert.equal((await a.next(1)).hello_result, 'accepted');
  // ID taken, wrong key.
  const thief = raw(url); await thief.send({ ...hello, seq: 50, key: 'not-the-right-key-0000' });
  assert.equal((await thief.next(1)).hello_result, 'refused');
  const badOp = connectOperator({ url, operator_id: 'OP1', key: 'not-the-right-key-0000' });
  assert.equal((await badOp.ready).hello_result, 'refused');
  const op = connectOperator({ url, operator_id: 'OP1', key: OPKEY });
  await op.ready;
  assert.deepEqual(strip(await op.until((m) => m.type === 'admin.hello')), strip({ ...hello, commands: ['land'] }));
  await a.send(ex('03-settings.json'));
  const takeoff = await op.request(strip(ex('07-command-takeoff.json')));
  assert.equal(takeoff.explanation, 'A1 does not accept takeoff');
  assert.equal((await op.request({ type: 'control.command', asset_id: 'A1', kind: 'land' })).reply_result, 'refused');
  assert.equal((await op.request({ type: 'control.settings', asset_id: 'A1', low_battery_response: 'land' })).explanation, 'A1 has no setting low_battery_response');
  assert.equal((await op.request({ type: 'control.settings', asset_id: 'A1', telemetry_every_s: 2 })).reply_result, 'accepted');
  // The same report twice (as over two links) is stored once.
  await a.send(ex('05-telemetry.json')); await a.send(ex('05-telemetry.json'));
  await op.until((m) => m.type === 'report.telemetry');
  await sleep(100);
  assert.equal(core.store.history('A1').length, 1);
  // every_s repeats each carry a new seq, so a receiver's duplicate rule keeps them.
  const r = await op.request({ type: 'query.asset', asset_id: 'A1', report: 'telemetry', every_s: 1 });
  await sleep(2200);
  const copies = op.received.filter((m) => m.type === 'report.telemetry');
  assert.ok(copies.length >= 3);
  assert.equal(new Set(copies.map((m) => m.seq)).size, copies.length);
  assert.ok(op.received.indexOf(copies[1]) < op.received.indexOf(r), 'the first copy comes before the reply');
  // A newer link for the same Asset or operator replaces the older.
  const a2 = raw(url); await a2.send({ ...hello, seq: 60 });
  assert.equal((await a2.next(1)).hello_result, 'accepted');
  await a.closed;
  const op2 = connectOperator({ url, operator_id: 'OP1', key: OPKEY });
  await op2.ready;
  await new Promise((res) => (op.ws.readyState === 3 ? res() : op.ws.on('close', res)));
  op2.close(); a2.ws.close(); await core.close();
});
