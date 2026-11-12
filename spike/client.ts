import { randomUUID } from 'node:crypto';
import { definitionsHash } from './protocol.ts';
export class Client {
  base: string; token: string;
  constructor(base: string, token: string) { this.base = base; this.token = token; }
  async request(method: string, path: string, body?: unknown, key: string = randomUUID()) {
    const bytes = body instanceof Uint8Array;
    const response = await fetch(this.base + path, { method, headers: { Authorization: `Bearer ${this.token}`, 'Atlas-Definitions': definitionsHash, 'Idempotency-Key': key, 'Content-Type': bytes ? 'application/octet-stream' : 'application/json' }, body: body === undefined ? undefined : bytes ? new Uint8Array(body).buffer : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  tasks(id: string, tasks: unknown[], now = false, key?: string) { return this.request('POST', `/tasks/${id}`, { tasks, ...(now ? { now } : {}) }, key); }
  // The caller supplies the operator's answer. No edit silently updates Tasks.
  editPlace(id: string, place: unknown, answer: boolean) { return this.request('PUT', `/entities/geofeatures/${id}?update_tasks=${answer}`, place); }
  async *events(after: number, signal: AbortSignal) {
    const response = await fetch(`${this.base}/events?after=${after}&definitions=${definitionsHash}`, { headers: { Authorization: `Bearer ${this.token}` }, signal });
    if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
    let buffer = '';
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (data) yield JSON.parse(data.slice(6));
      }
    }
  }
}
