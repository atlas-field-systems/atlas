import type { Clock, Timer } from "@atlas/sdk";
import type { Clock as CoreClock } from "../../core/src/clock.ts";
type Entry = { at: number; sequence: number; fn(): void; cancelled: boolean };
export class SimClock implements Clock, CoreClock {
  private time = 1800000000000;
  private sequence = 0;
  private timers: Entry[] = [];
  now() { return this.time; }
  after(ms: number, fn: () => void): Timer {
    const entry = { at: this.time + Math.max(0,ms), sequence: this.sequence++, fn, cancelled: false };
    this.timers.push(entry);
    return { cancel: () => { entry.cancelled = true; } };
  }
  nextAt() {
    this.timers = this.timers.filter(e => !e.cancelled).sort((a,b) => a.at-b.at || a.sequence-b.sequence);
    return this.timers[0]?.at;
  }
  fireNext() {
    if (this.nextAt() === undefined) return false;
    const entry = this.timers.shift()!; this.time = entry.at; entry.fn(); return true;
  }
  moveTo(time: number) { if (time < this.time) throw new Error("Clock cannot go backwards"); this.time = time; }
  shifted(offsetMs: number): Clock { return { now: () => this.now() + offsetMs, after: (ms,fn) => this.after(ms,fn) }; }
}
