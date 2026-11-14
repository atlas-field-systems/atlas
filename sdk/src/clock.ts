export interface Timer {
  cancel(): void;
}
export interface Clock {
  now(): number;
  after(ms: number, fn: () => void): Timer;
}
export const systemClock: Clock = {
  now: () => Date.now(),
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(timer) };
  },
};
export interface Backoff {
  minMs: number;
  maxMs: number;
  factor: number;
  jitter: number;
}
export const defaultBackoff: Backoff = {
  minMs: 500,
  maxMs: 30000,
  factor: 2,
  jitter: 0.2,
};
export function backoffDelay(attempt: number, b: Backoff): number {
  return Math.max(
    0,
    Math.min(b.maxMs, b.minMs * b.factor ** attempt) *
      (1 + b.jitter * (2 * Math.random() - 1)),
  );
}
