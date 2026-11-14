import type { Clock } from "./clock.ts";
export type Diagnostic = {
  name: string;
  at: number;
  counter: number;
  detail: Record<string, string | number | boolean | null>;
};
export type Observer = (event: Diagnostic) => void | Promise<void>;
export function diagnostics(clock: Clock, observer?: Observer) {
  let counter = 0,
    dropped = 0,
    scheduled = false;
  const pending: Diagnostic[] = [];
  return (name: string, detail: Diagnostic["detail"] = {}) => {
    if (!observer) return;
    if (pending.length >= 1024) {
      dropped++;
      return;
    }
    pending.push({ name, at: clock.now(), counter: ++counter, detail });
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (dropped) {
        pending.push({
          name: "diagnostics.gap",
          at: clock.now(),
          counter: ++counter,
          detail: { dropped },
        });
        dropped = 0;
      }
      for (const event of pending.splice(0)) {
        try {
          Promise.resolve(observer(event)).catch(() => {});
        } catch {}
      }
    });
  };
}
