import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { startCore } from "@atlas/core";
import { loadPackagedProtocol } from "@atlas/protocol";
import { createClient, type Credential, type Result, type Diagnostic, type Client } from "@atlas/sdk";
import { SimClock } from "./clock.ts";
import { Network } from "./network.ts";
export function value<T>(r: Result<T>): T { if (!r.ok) throw new Error(`${r.error}: ${r.explanation}`); return r.value; }
export async function createWorld() {
  const root = await mkdtemp(join(tmpdir(),"atlas-sim-"));
  const password = "simulation-password";
  await writeFile(join(root,"password"),password);
  const clock = new SimClock(), network = new Network(clock), protocol = await loadPackagedProtocol(), diagnostics: Diagnostic[] = [];
  const core = await startCore({ clock, config: { listen_address: "127.0.0.1", port: 0, data_directory: join(root,"data"), archive_directory: join(root,"archive"), log_directory: join(root,"logs"), first_admin: { operator_id:"ADM",password_file:join(root,"password") } } });
  const clients: Client[] = [];
  const cleanup = new Set<() => void>();
  function client<C extends Credential>(caller: string, credential: C) {
    const c = createClient({ protocol, credential, clock, fetch:network.fetchFor(caller), baseUrl:core.url, backoff:{ minMs:10,maxMs:100,factor:2,jitter:0 }, observer: e => { diagnostics.push(e); network.activity++; } });
    clients.push(c as Client); return c;
  }
  function guard(start: number) { if (Date.now()-start > 10000) throw new Error(`World wait exceeded 10 s; in flight: ${JSON.stringify(network.inFlight)}`); if(clock.now()-1800000000000>86400000) throw new Error("Simulated time exceeded 24 h"); }
  async function settle() {
    const start = Date.now(); let quiet = 0, last = network.activity;
    while (quiet < 8) {
      guard(start); await setImmediate();
      if (!network.inFlight.length && last === network.activity) quiet++; else quiet = 0;
      last = network.activity;
    }
  }
  async function advance(ms: number) {
    const end = clock.now()+ms; const start = Date.now();
    while ((clock.nextAt() ?? Infinity) <= end) { guard(start); clock.fireNext(); await settle(); }
    clock.moveTo(end); await settle();
  }
  async function complete<T>(promise: Promise<T>): Promise<T> {
    let done = false; let result: T | undefined, error: unknown;
    void promise.then(v => { result = v; done = true; },e => { error = e; done = true; });
    const start = Date.now();
    while (!done) { guard(start); await settle(); if (!done) { if (!clock.fireNext()) await setImmediate(); } }
    if (error) throw error;
    return result!;
  }
  async function until(pred: () => boolean) {
    const start = Date.now();
    while (true) { guard(start); await settle(); if (pred()) return; if (!clock.fireNext()) await setImmediate(); }
  }
  const admin = client("admin",{kind:"account"});
  value(await complete(admin.connect())); value(await complete(admin.login("ADM",password)));
  return {
    clock, network, protocol, core, root, admin, client, settle, advance, complete, until, diagnostics,
    onClose(fn: () => void) { cleanup.add(fn); },
    trace: { traffic: network.traffic, diagnostics },
    drain: settle,
    async close() { for (const fn of cleanup) fn(); for (const c of clients) c.close(); network.close(); await settle(); await complete(core.stop()); await rm(root,{recursive:true,force:true}); },
  };
}
export type World = Awaited<ReturnType<typeof createWorld>>;
