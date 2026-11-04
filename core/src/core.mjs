// Atlas Core prototype: one WebSocket per Asset or operator interface, protocol messages (see src/protocol.mjs).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { check, VERSION } from './protocol.mjs';
import { openStore } from './store.mjs';
import { dedupe } from './dedupe.mjs';

export const hash = (key) => createHash('sha256').update(String(key)).digest('hex');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const SETTINGS_FIELDS = new Set(['type', 'time', 'seq', 'asset_id', 'task_id', 'task_seq']);

// options: { port, db, enrollmentKey, operators: { OP1: keyHash }, log }
export async function startCore({ port = 8080, db, enrollmentKey, operators = {}, log = () => {} } = {}) {
  const store = openStore(db);
  const assets = new Map(); // asset_id -> socket
  const ops = new Set();
  const repeats = new Set();
  const fresh = dedupe();
  let seq = 0;
  // Everything Core sends carries Core's own new seq (law 20); forwarded reports keep their time.
  const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify({ ...m, seq: seq++ }));
  const stamp = (m) => ({ ...m, time: Date.now() });
  const toOperators = (m) => { for (const o of ops) send(o, m); };
  const noKeys = ({ key, enrollment_key, ...m }) => m;

  const page = (await readFile(new URL('../public/index.html', import.meta.url), 'utf8')).replace('__PROTOCOL_VERSION__', VERSION);
  const http = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page); }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });

  // Links open with no credentials; keys travel only in the opening hello (law 17).
  http.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://core').pathname;
    if (path !== '/asset' && path !== '/operator') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, (ws) => { ws.side = path.slice(1); wss.emit('connection', ws); });
  });

  // The first message must be the right hello with a good key; anything else closes the link.
  function opening(ws, m) {
    const asset = ws.side === 'asset';
    const id = asset ? m.asset_id : m.operator_id;
    const reply = (hello_result) => send(ws, stamp({ type: 'admin.hello_reply', [asset ? 'asset_id' : 'operator_id']: id, hello_result, protocol_version: VERSION }));
    if (check(m) || m.type !== (asset ? 'admin.hello' : 'admin.operator_hello')) return ws.close();
    let ok = false;
    if (asset) {
      const row = store.asset(id);
      if (row) ok = same(row.key_hash, hash(m.key ?? ''));
      else if (m.key && enrollmentKey && m.enrollment_key && same(hash(m.enrollment_key), hash(enrollmentKey))) {
        store.addAsset(id, hash(m.key)); ok = true; log(`enrolled ${id}`);
      }
    } else ok = Boolean(operators[id]) && same(operators[id], hash(m.key));
    if (!ok) { reply('refused'); return ws.close(); }
    if (m.protocol_version !== VERSION) { reply('version_mismatch'); return ws.close(); }
    ws.id = id; ws.sender = `${ws.side}:${id}`;
    fresh(ws.sender, m);
    reply('accepted');
    // One link per ID (law 22): the newer link replaces the older.
    if (asset) {
      const old = assets.get(id); if (old) old.close();
      assets.set(id, ws); ws.hello = noKeys(m);
      store.saveHello(ws.hello, Date.now());
      return toOperators(ws.hello);
    }
    for (const o of ops) if (o.id === id) { ops.delete(o); o.close(); }
    ops.add(ws);
    for (const h of store.hellos()) { send(ws, h); for (const r of store.latest(h.asset_id)) send(ws, r); }
  }

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data); } catch { return ws.id ? log(`${ws.sender}: not JSON`) : ws.close(); }
      if (!ws.id) return opening(ws, m);
      if (!Number.isInteger(m?.seq) || !fresh(ws.sender, m)) return; // seen before (another link): drop
      const bad = check(m);
      if (ws.side === 'asset') return fromAsset(ws, m, bad);
      return fromOperator(ws, m, bad);
    });
    ws.on('close', () => {
      if (ws.side === 'asset' && assets.get(ws.id) === ws) assets.delete(ws.id);
      ops.delete(ws);
      for (const r of repeats) if (r.ws === ws) { clearInterval(r.timer); repeats.delete(r); }
    });
  });

  function fromAsset(ws, m, bad) {
    if (bad || m.asset_id !== ws.id) return log(`${ws.id}: dropped ${m.type}: ${bad ?? 'wrong asset_id'}`);
    store.heard(ws.id, Date.now());
    if (m.type.startsWith('admin.')) return log(`${ws.id}: ignored ${m.type} after hello`);
    if (m.type === 'query.queue') { for (const t of store.openTasks(m.asset_id)) send(ws, stamp(t)); return; }
    if (!m.type.startsWith('report.')) return log(`${ws.id}: ignored ${m.type}`);
    store.report(m);
    toOperators(m);
    // Resend any open Task missing from the Asset's queue.
    if (m.kind === 'queue') for (const t of store.openTasks(m.asset_id)) if (!m.task_ids.includes(t.task_id)) send(ws, stamp(t));
  }

  function fromOperator(ws, m, bad) {
    const reply = (reason) => send(ws, stamp({ type: 'admin.reply', ...(m.asset_id && { asset_id: m.asset_id }), reply_to: m.seq, reply_result: reason ? 'refused' : 'accepted', ...(reason && { explanation: reason }) }));
    if (bad) return reply(bad);
    const asset = m.asset_id && assets.get(m.asset_id);
    if (m.type.startsWith('control.')) {
      if (!asset) return reply(`${m.asset_id} is not connected`);
      if (m.type === 'control.command' && !asset.hello.commands.includes(m.kind)) return reply(`${m.asset_id} does not accept ${m.kind}`);
      if (m.type === 'control.settings') {
        const have = store.latestOne(m.asset_id, 'report.settings') ?? {};
        const missing = Object.keys(m).find((k) => !SETTINGS_FIELDS.has(k) && !(k in have));
        if (missing) return reply(`${m.asset_id} has no setting ${missing}`);
      }
      if (m.task_id) {
        if (store.task(m.asset_id, m.task_id)) return reply(`${m.asset_id} already has task ${m.task_id}`);
        store.addTask(m);
      }
      reply();
      return send(asset, stamp(m));
    }
    // A query's answer goes first; its admin.reply comes last and marks the end.
    if (m.type === 'query.core') {
      const answer = m.kind === 'assets' ? store.hellos().filter((h) => !m.asset_id || h.asset_id === m.asset_id) : store.history(m.asset_id, m.report, m.since, m.until);
      answer.forEach((r) => send(ws, r));
      return reply();
    }
    if (m.type === 'query.asset') {
      const slot = `report.${m.report}`;
      const latest = () => store.latestOne(m.asset_id, slot) ?? store.latestOne(m.asset_id, `${slot}.asset`);
      if (!store.asset(m.asset_id)) return reply(`unknown asset ${m.asset_id}`);
      for (const r of repeats) if (r.ws === ws && r.key === `${m.asset_id}.${m.report}`) { clearInterval(r.timer); repeats.delete(r); }
      const l = latest(); if (l) send(ws, l);
      reply();
      if (m.every_s) repeats.add({ ws, key: `${m.asset_id}.${m.report}`, timer: setInterval(() => { const x = latest(); if (x) send(ws, x); }, m.every_s * 1000) });
      return;
    }
    reply(`${m.type} is not handled by this prototype`);
  }

  await new Promise((r) => http.listen(port, r));
  return {
    port: http.address().port,
    store,
    close: () => new Promise((r) => { for (const x of repeats) clearInterval(x.timer); for (const c of wss.clients) c.terminate(); http.close(r); }),
  };
}
