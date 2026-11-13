import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Core } from './core.ts';
import type { Caller } from './core.ts';
import { Refusal, definitionsHash } from './protocol.ts';

// Local fixture provisioning, deliberately no credential issuance API or TLS.
// Only credential hashes are stored on disk. Never expose this server to a network.
const config = JSON.parse(readFileSync(process.env.SPIKE_CREDENTIALS!, 'utf8'));
const core = new Core(process.env.SPIKE_DATA ?? 'spike/data');
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, 'http://localhost');
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const caller: Caller | undefined = config[digest(token)];
    if (url.pathname !== '/about' && !caller) throw new Refusal(401, 'unauthorized');
    if (url.pathname !== '/about' && (url.searchParams.get('definitions') ?? req.headers['atlas-definitions']) !== definitionsHash) throw new Refusal(409, 'definitions_mismatch');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      let cursor = Number(url.searchParams.get('after') ?? req.headers['last-event-id'] ?? 0);
      const send = () => {
        for (const event of core.events(cursor)) {
          cursor = Number(event.event_id);
          if (caller!.role !== 'operator' && (!event.asset_id || core.get('assets', String(event.asset_id)).owner !== caller!.id)) continue;
          res.write(`id: ${event.event_id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      };
      send(); const poll = setInterval(send, 20); const alive = setInterval(() => res.write(': alive\n\n'), 10000);
      res.on('close', () => { clearInterval(poll); clearInterval(alive); }); return;
    }
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > core.maxObjectBytes + 1024) throw new Refusal(413, 'too_large');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    let input: unknown = {};
    if (url.pathname === '/objects' && req.method === 'POST') input = bytes;
    else if (bytes.length) { try { input = JSON.parse(bytes.toString()); } catch { throw new Refusal(400, 'invalid'); } }
    const [status, body] = core.request(caller ?? { role: 'operator', id: 'public' }, req.method!, req.url!, input, String(req.headers['idempotency-key'] ?? ''));
    res.writeHead(status, { 'Content-Type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json' });
    res.end(body instanceof Uint8Array ? body : JSON.stringify(body));
  } catch (error) {
    res.writeHead(error instanceof Refusal ? error.status : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Refusal ? error.code : 'spike_bug', explanation: String(error) }));
  }
});
server.listen(Number(process.env.SPIKE_PORT ?? 0), '127.0.0.1', () => { const address = server.address(); if (address && typeof address !== 'string') process.stdout.write(JSON.stringify({ port: address.port, run: core.run }) + '\n'); });
process.on('SIGTERM', () => {
  server.close(); server.closeAllConnections();
  try { core.stop(); core.close(); process.exit(0); }
  catch { core.close(); process.exit(1); }
});
