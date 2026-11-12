import { generateKeyPairSync, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { Client } from './client.ts';
import { definitionsHash } from './protocol.ts';
export class Radio {
  keys = generateKeyPairSync('ed25519');
  sequence = 0;
  identity: string;
  constructor(identity: string) { this.identity = identity; }
  frame(asset_id: string, payload: unknown) {
    const body = JSON.stringify({ asset_id, sequence: ++this.sequence, payload });
    return { identity: this.identity, body, signature: sign(null, Buffer.from(body), this.keys.privateKey) };
  }
}
// In-memory topology and signed frames stand in for a Fieldlink. No bandwidth claims.
export class MeshGateway {
  radios = new Map<string, { id: string; key: KeyObject; last: number }>();
  edges = new Map<string, Set<string>>([['gateway', new Set()]]);
  client: Client;
  constructor(client: Client) { this.client = client; }
  connect(a: string, b: string) { for (const [x,y] of [[a,b],[b,a]]) { if (!this.edges.has(x)) this.edges.set(x, new Set()); this.edges.get(x)!.add(y); } }
  reachable(radio: string) {
    const seen = new Set(['gateway']); const queue = ['gateway'];
    while (queue.length) for (const next of this.edges.get(queue.shift()!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    return seen.has(radio);
  }
  async join(radio: Radio, hash = definitionsHash) {
    if (!this.reachable(radio.identity)) throw new Error('no mesh path');
    const old = this.radios.get(radio.identity); if (old) return old.id;
    const reply = await this.client.request('POST', '/entities/assets/radios', { definitions_hash: hash });
    if (reply.status !== 201) throw new Error(`registration refused ${reply.status}`);
    const id = reply.body.asset_id; this.radios.set(radio.identity, { id, key: radio.keys.publicKey, last: 0 }); return id;
  }
  accept(frame: ReturnType<Radio['frame']>) {
    const radio = this.radios.get(frame.identity);
    if (!radio || !this.reachable(frame.identity) || !verify(null, Buffer.from(frame.body), radio.key, frame.signature)) throw new Error('unauthenticated');
    const body = JSON.parse(frame.body);
    if (body.asset_id !== radio.id || body.sequence <= radio.last) throw new Error('spoof or replay');
    radio.last = body.sequence; return body;
  }
}
