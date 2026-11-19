export interface Clock {
  /** Milliseconds since 1970 UTC (Protocol law 7). */
  now(): number;
  /**
   * Run `fn` once, `ms` from now on this clock. Returns a handle to cancel.
   * A remote callback resolves when Core has handled the timer. A simulated
   * clock can wait for that completion before advancing to the next deadline.
   */
  after(ms: number, fn: () => void | Promise<void>): Timer;
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
