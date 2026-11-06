import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { startCore } from '../src/core.mjs';
import { connectOperator } from '../src/operator.mjs';

test('Core shutdown closes its SQLite store', async (t) => {
  const core = await startCore({ port: 0 });
  t.after(() => core.close());
  core.store.addAsset('A1', 'asset-key-hash');
  assert.equal(core.store.asset('A1').asset_id, 'A1');
  await core.close();
  assert.throws(() => core.store.asset('A1'), { code: 'ERR_INVALID_STATE' });
});

test('a timed-out operator waiter does not inspect later messages', async (t) => {
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  let link;
  server.on('connection', (ws) => {
    link = ws;
    ws.on('message', () => ws.send(JSON.stringify({ type: 'admin.hello_reply', hello_result: 'accepted' })));
  });
  const op = connectOperator({ url: `ws://localhost:${server.address().port}`, operator_id: 'OP1', key: 'operator-key-000000000' });
  t.after(async () => {
    op.close();
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  await op.ready;
  let calls = 0;
  await assert.rejects(op.until((m) => {
    if (m.type === 'report.battery') calls++;
    return m.type === 'report.battery';
  }, 5), { message: 'timed out waiting for a message' });
  link.send(JSON.stringify({ type: 'report.battery', battery_percent: 80 }));
  await op.until((m) => m.type === 'report.battery');
  assert.equal(calls, 0);
});
