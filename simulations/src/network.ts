import { setImmediate } from "node:timers/promises";
import type { SimClock } from "./clock.ts";
export type Fault = { kind: "loseRequest" | "loseResponse" | "repeat" | "cutStream" } | { kind: "delay"; ms: number } | { kind: "refuse"; status: number };
type Rule = { caller: string; path: string; fault: Fault; remaining: number };
export type Traffic = { caller: string; method: string; path: string; key: string | null; status?: number; fault?: Fault; body?: unknown };
export class Network {
  private rules: Rule[] = [];
  private cutCallers = new Set<string>();
  private pending = new Map<number,string>();
  private sequence = 0;
  private streams = new Map<string, Set<AbortController>>();
  readonly traffic: Traffic[] = [];
  activity = 0;
  chunkTurnDelay = false;
  clock: SimClock;
  constructor(clock: SimClock) { this.clock = clock; }
  get inFlight() { return [...this.pending.values()]; }
  once(caller: string, path: string, fault: Fault) { this.rules.push({ caller,path,fault,remaining:1 }); }
  always(caller: string, path: string, fault: Fault) { this.rules.push({ caller,path,fault,remaining:Infinity }); }
  cut(caller: string) { this.cutCallers.add(caller); this.dropStreams(caller); }
  heal(caller: string) { this.cutCallers.delete(caller); }
  dropStreams(caller: string) { for (const c of this.streams.get(caller) ?? []) c.abort(); }
  close() { for (const name of this.streams.keys()) this.dropStreams(name); }
  fetchFor(caller: string): typeof fetch {
    let cookie: string | undefined;
    return async (input, init = {}) => {
      const url = new URL(String(input)), path = url.pathname;
      const id = ++this.sequence; this.pending.set(id, `${caller} ${init.method ?? "GET"} ${path}`); this.activity++;
      const rule = this.rules.find(r => r.remaining > 0 && r.caller === caller && r.path === path);
      if (rule) rule.remaining--;
      const fault = rule?.fault;
      const headers = new Headers(init.headers); if (cookie) headers.set("Cookie",cookie);
      const traffic: Traffic = { caller, method: init.method ?? "GET", path, key: headers.get("Idempotency-Key"), fault };
      if (!path.startsWith("/administration") && typeof init.body === "string") traffic.body = JSON.parse(init.body);
      if (init.body instanceof Uint8Array) traffic.body = { size_bytes: init.body.byteLength };
      this.traffic.push(traffic);
      const controller = new AbortController();
      const abort = () => controller.abort();
      init.signal?.addEventListener("abort",abort,{ once:true });
      if (init.signal?.aborted) abort();
      try {
        if (this.cutCallers.has(caller) || fault?.kind === "loseRequest") throw new TypeError("Simulated request loss");
        if (fault?.kind === "delay") {
          this.pending.delete(id);
          await new Promise<void>(resolve => this.clock.after(fault.ms,resolve));
          this.pending.set(id,`${caller} delayed ${path}`);
        }
        if (fault?.kind === "refuse") return Response.json({ error: "simulated_refusal", explanation: "Host refusal" },{status:fault.status});
        const send = () => fetch(input,{ ...init, headers, signal:controller.signal });
        let response = await send();
        traffic.status = response.status;
        if (fault?.kind === "repeat") { await response.arrayBuffer(); response = await send(); }
        if (fault?.kind === "loseResponse") { await response.arrayBuffer(); throw new TypeError("Simulated response loss after commit"); }
        if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0];
        if (path !== "/events" || !response.ok || !response.body) {
          const bytes = await response.arrayBuffer();
          return new Response(bytes,{status:response.status,headers:response.headers});
        }
        let set = this.streams.get(caller); if (!set) { set = new Set(); this.streams.set(caller,set); }
        set.add(controller);
        const reader = response.body.getReader();
        const network = this;
        const body = new ReadableStream<Uint8Array>({
          async start(target) {
            try {
              while (true) {
                const chunk = await reader.read(); if (chunk.done) break;
                if (network.chunkTurnDelay) await setImmediate();
                network.activity++;
                target.enqueue(chunk.value);
                if (fault?.kind === "cutStream") { controller.abort(); break; }
              }
              target.close();
            } catch (error) { target.error(error); }
            finally { set!.delete(controller); network.activity++; init.signal?.removeEventListener("abort",abort); }
          },
          cancel() { controller.abort(); return reader.cancel().catch(() => {}); },
        });
        return new Response(body,{status:response.status,headers:response.headers});
      } finally { this.pending.delete(id); this.activity++; if (path !== "/events") init.signal?.removeEventListener("abort",abort); }
    };
  }
}
export function faultChoice(seed: number, caller: string, route: string, n: number): number {
  let hash = 2166136261;
  for (const c of `${seed}:${caller}:${route}:${n}`) hash = Math.imul(hash ^ c.charCodeAt(0),16777619);
  return (hash >>> 0) / 2**32;
}
