// A minimal operator client: connects, says hello, sends messages, collects what Core pushes.
import WebSocket from 'ws';
import { VERSION } from './version.mjs';

export function connectOperator({ url, operator_id, key }) {
  const ws = new WebSocket(`${url}/operator`);
  let seq = 0;
  const received = [];
  const waiters = new Set();
  const send = (m) => { const out = { type: m.type, time: Date.now(), seq: seq++, ...m }; ws.send(JSON.stringify(out)); return out.seq; };
  ws.on('message', (d) => {
    const m = JSON.parse(d); received.push(m);
    for (const w of [...waiters]) if (w.test(m)) w.resolve(m);
  });
  const until = (test, ms = 10000) => new Promise((resolve, reject) => {
    const hit = received.find(test); if (hit) return resolve(hit);
    const settle = (complete, value) => { clearTimeout(timer); waiters.delete(waiter); complete(value); };
    const waiter = { test, resolve: (m) => settle(resolve, m) };
    const timer = setTimeout(() => settle(reject, new Error('timed out waiting for a message')), ms);
    waiters.add(waiter);
  });
  const ready = new Promise((r, j) => { ws.on('open', r); ws.on('error', j); })
    .then(() => { send({ type: 'admin.operator_hello', operator_id, protocol_version: VERSION, key }); return until((m) => m.type === 'admin.hello_reply'); });
  // Sends a message and waits for Core's admin.reply to it.
  const request = (m) => { const s = send(m); return until((r) => r.type === 'admin.reply' && r.reply_to === s); };
  return { ws, ready, send, request, until, received, close: () => ws.close() };
}
