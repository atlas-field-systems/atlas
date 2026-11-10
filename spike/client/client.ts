import { request } from 'node:https';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) { super(`Core ${status}: ${JSON.stringify(body)}`); this.status = status; this.body = body; }
}

/** Throwaway transport, not the Atlas SDK. TLS verification stays enabled. */
export class SpikeClient {
  baseUrl: string;
  definitionsHash: string;
  ca?: string | Buffer;
  key?: string;
  cookie = '';
  constructor(config: {baseUrl: string; definitionsHash: string; ca?: string | Buffer; key?: string}) {
    Object.assign(this, config);
    this.baseUrl = config.baseUrl;
    this.definitionsHash = config.definitionsHash;
  }
  headers() {
    return {'Atlas-Definitions': this.definitionsHash,
      ...(this.key ? {Authorization: `Bearer ${this.key}`} : {}),
      ...(this.cookie ? {Cookie: this.cookie} : {})};
  }
  async request(method: string, path: string, body?: unknown, idempotencyKey = randomUUID()) {
    return new Promise<{status: number; body: unknown; headers: import('node:http').IncomingHttpHeaders}>((resolve, reject) => {
      const bytes = body === undefined ? '' : JSON.stringify(body);
      const req = request(new URL(path, this.baseUrl), {method, ca: this.ca,
        headers: {...this.headers(), ...(method !== 'GET' ? {'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey} : {})}}, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const cookie = res.headers['set-cookie'];
          if (cookie) this.cookie = cookie[0].split(';')[0];
          let data: unknown;
          try { const text = Buffer.concat(chunks).toString(); data = text ? JSON.parse(text) : null; }
          catch (error) { reject(error); return; }
          const status = res.statusCode ?? 500;
          if (status >= 400) reject(new ApiError(status, data));
          else resolve({status, body: data, headers: res.headers});
        });
      });
      req.on('error', reject);
      req.end(bytes);
    });
  }
  async *events(options: {after?: number; signal?: AbortSignal; onAlive?: () => void} = {}): AsyncGenerator<unknown> {
    const url = new URL('/events', this.baseUrl);
    url.searchParams.set('definitions', this.definitionsHash);
    if (options.after !== undefined) url.searchParams.set('after', String(options.after));
    const req = request(url, {ca: this.ca, headers: this.headers(), signal: options.signal});
    const response = new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      req.on('response', resolve); req.on('error', reject);
    });
    req.end();
    const res = await response;
    if (res.statusCode !== 200) { res.destroy(); throw new ApiError(res.statusCode ?? 500, 'stream refused'); }
    const lines = createInterface({input: res, crlfDelay: Infinity});
    let data: string[] = [];
    try {
      for await (const line of lines) {
        options.onAlive?.();
        if (line === '') {
          if (data.length) { yield JSON.parse(data.join('\n')); data = []; }
        } else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
    } finally { lines.close(); res.destroy(); req.destroy(); }
  }
}
