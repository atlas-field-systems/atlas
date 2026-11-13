/**
 * Core reads time only from the Clock it is given at start.
 *
 * The shipped program passes `systemClock`. A simulation passes its own
 * simulated clock that implements this interface and fires timers when it
 * advances. Every time Core stamps (event `time`, record `time`, diagnostic
 * records) and every timer Core runs (contact deadlines, SSE keepalives, slow
 * reader limits) goes through this interface, so minutes of contact rules run
 * in milliseconds under simulation. (decision-log: "A part taking its clock
 * from outside ... is not a hook added only for tests".)
 *
 * Not on the clock: SQLite, the OS socket timeouts of node:http, and file I/O.
 * They are not product rules.
 */
export interface Clock {
  /** Milliseconds since 1970 UTC (Protocol law 7). */
  now(): number;
  /**
   * Run `fn` once, `ms` from now on this clock. Returns a handle to cancel.
   * A simulated clock fires due timers in deadline order when it advances.
   */
  after(ms: number, fn: () => void): Timer;
}

export interface Timer {
  cancel(): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  after(ms, fn) {
    const handle = setTimeout(fn, ms);
    // Timers never keep the process alive on their own; the HTTP server does.
    handle.unref();
    return { cancel: () => clearTimeout(handle) };
  },
};
