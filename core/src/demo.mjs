// One command: Core, a simulated drone and an operator that flies the protocol's first flight.
// Open the printed address to watch the path.
import { readFileSync } from 'node:fs';
import { startCore, hash } from './core.mjs';
import { startAsset } from '../sim/asset.mjs';
import { connectOperator } from './operator.mjs';

const ex = (f) => JSON.parse(readFileSync(new URL(`../protocol/examples/first-flight/${f}`, import.meta.url)));
const core = await startCore({ port: Number(process.env.PORT ?? 8080), enrollmentKey: 'demo-enrollment-key-00', operators: { OP1: hash('demo-operator-key-0000') }, log: console.log });
const url = `ws://localhost:${core.port}`;
console.log(`Atlas Core on http://localhost:${core.port}/#OP1:demo-operator-key-0000`);
startAsset({ url, asset_id: 'A1', key: 'demo-asset-key-0000000', enrollment_key: 'demo-enrollment-key-00', speed: Number(process.env.SPEED ?? 4), log: console.log });
const op = connectOperator({ url, operator_id: 'OP1', key: 'demo-operator-key-0000' });
await op.ready;
await op.until((m) => m.type === 'admin.asset' && m.asset_id === 'A1');
await new Promise((r) => setTimeout(r, 3000));
for (const f of ['07-command-takeoff.json', '08-command-move_to.json', '09-command-land.json']) {
  const { time, seq, ...command } = ex(f);
  const r = await op.request(command);
  console.log(`${command.kind} ${command.task_id}: ${r.reply_result}`);
}
await op.until((m) => m.type === 'report.status' && m.task_id === 'T3' && m.task_state === 'completed', 600000);
console.log('First flight done. Core keeps running; Ctrl+C to stop.');
op.close();
