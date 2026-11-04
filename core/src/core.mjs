// Atlas Core prototype: one WebSocket per Asset or operator interface, protocol 0.5 messages.
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
  const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify({ ...m }));
  const stamp = (m) => ({ ...m, time: Date.now(), seq: seq++ });
  const toOperators = (m) => { for (const o of ops) if (o.hello) send(o, m); };

  const page = (await readFile(new URL('../public/index.html', import.meta.url), 'utf8')).replace('__PROTOCOL_VERSION__', VERSION);
  const http = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page); }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });

  // Link opening: credentials travel in the connection request, never in a message (law 17).
  // Browsers cannot set WebSocket headers, so the prototype uses the query string.
  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://core');
    const p = Object.fromEntries(url.searchParams);
    let who;
    if (url.pathname === '/asset' && /^[A-Za-z0-9]{1,4}$/.test(p.asset_id ?? '') && p.key) {
      const row = store.asset(p.asset_id);
      if (row && same(row.key_hash, hash(p.key))) who = { asset_id: p.asset_id };
      else if (!row && enrollmentKey && p.enrollment_key && same(hash(p.enrollment_key), hash(enrollmentKey))) {
        store.addAsset(p.asset_id, hash(p.key));
        who = { asset_id: p.asset_id };
        log(`enrolled ${p.asset_id}`);
      }
    } else if (url.pathname === '/operator' && operators[p.operator_id] && p.key && same(operators[p.operator_id], hash(p.key))) {
      who = { operator_id: p.operator_id };
    }
    if (!who) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, (ws) => { Object.assign(ws, who); wss.emit('connection', ws); });
  });

  wss.on('connection', (ws) => {
    const sender = ws.asset_id ? `asset:${ws.asset_id}` : `operator:${ws.operator_id}`;
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data); } catch { return log(`${sender}: not JSON`); }
      if (!Number.isInteger(m?.seq) || !fresh(sender, m)) return; // repeat over a second link: drop
      const bad = check(m);
      if (ws.asset_id) return fromAsset(ws, m, bad);
      return fromOperator(ws, m, bad);
    });
    ws.on('close', () => {
      if (ws.asset_id && assets.get(ws.asset_id) === ws) assets.delete(ws.asset_id);
      ops.delete(ws);
      for (const r of repeats) if (r.ws === ws) { clearInterval(r.timer); repeats.delete(r); }
    });
  });

  function fromAsset(ws, m, bad) {
    if (bad || m.asset_id !== ws.asset_id) return log(`${ws.asset_id}: dropped ${m.type}: ${bad ?? 'wrong asset_id'}`);
    store.heard(ws.asset_id, Date.now());
    if (m.type === 'admin.hello') {
      const ok = m.protocol_version === VERSION;
      send(ws, stamp({ type: 'admin.hello_reply', asset_id: m.asset_id, hello_result: ok ? 'accepted' : 'version_mismatch', protocol_version: VERSION }));
      if (!ok) return ws.close();
      ws.hello = m;
      const old = assets.get(m.asset_id);
      if (old && old !== ws) old.close();
      assets.set(m.asset_id, ws);
      store.saveHello(m, Date.now());
      return toOperators(m);
    }
    if (!ws.hello) return log(`${ws.asset_id}: ${m.type} before hello`);
    if (m.type === 'query.queue') { for (const t of store.openTasks(m.asset_id)) send(ws, stamp(t)); return; }
    if (!m.type.startsWith('report.')) return log(`${ws.asset_id}: ignored ${m.type}`);
    store.report(m);
    toOperators(m);
    // Resend any open Task missing from the Asset's queue.
    if (m.kind === 'queue') for (const t of store.openTasks(m.asset_id)) if (!m.task_ids.includes(t.task_id)) send(ws, stamp(t));
  }

  function fromOperator(ws, m, bad) {
    const reply = (reason) => send(ws, stamp({ type: 'admin.reply', ...(m.asset_id && { asset_id: m.asset_id }), reply_to: m.seq, reply_result: reason ? 'refused' : 'accepted', ...(reason && { explanation: reason }) }));
    if (m.type === 'admin.operator_hello' && !bad) {
      const ok = m.protocol_version === VERSION && m.operator_id === ws.operator_id;
      send(ws, stamp({ type: 'admin.hello_reply', operator_id: ws.operator_id, hello_result: ok ? 'accepted' : 'version_mismatch', protocol_version: VERSION }));
      if (!ok) return ws.close();
      ws.hello = m;
      ops.add(ws);
      for (const h of store.hellos()) { send(ws, h); for (const r of store.latest(h.asset_id)) send(ws, r); }
      return;
    }
    if (!ws.hello) return ws.close();
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
    if (m.type === 'query.core') {
      reply();
      if (m.kind === 'assets') return store.hellos().filter((h) => !m.asset_id || h.asset_id === m.asset_id).forEach((h) => send(ws, h));
      return store.history(m.asset_id, m.report, m.since, m.until).forEach((r) => send(ws, r));
    }
    if (m.type === 'query.asset') {
      const slot = `report.${m.report}`;
      const latest = () => store.latestOne(m.asset_id, slot) ?? store.latestOne(m.asset_id, `${slot}.asset`);
      if (!store.asset(m.asset_id)) return reply(`unknown asset ${m.asset_id}`);
      reply();
      for (const r of repeats) if (r.ws === ws && r.key === `${m.asset_id}.${m.report}`) { clearInterval(r.timer); repeats.delete(r); }
      const l = latest(); if (l) send(ws, l);
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
