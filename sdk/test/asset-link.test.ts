import { test } from "node:test";
import assert from "node:assert/strict";
import { runAsset, type AssetLink } from "../src/asset.ts";

test("stop interrupts an idle AssetLink read and closes its iterator [sdk/docs/asset.md#running-over-any-link]", async () => {
  let returned = 0;
  let read!: () => void;
  const reading = new Promise<void>((resolve) => {
    read = resolve;
  });
  const link: AssetLink = {
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next() {
          read();
          return new Promise<IteratorResult<never>>(() => {});
        },
        async return() {
          returned++;
          return { done: true, value: undefined };
        },
      }),
    }),
    async sendReports() {
      return { ok: true };
    },
    onContact: () => () => {},
    capacity: () => undefined,
    async storeFile() {
      throw new Error("unused");
    },
  };
  const s = runAsset(
    link,
    { asset_id: "A", after: 0, last_task_id: 0 },
    {
      clock: { now: () => 1000, after: () => ({ cancel() {} }) },
      settings: () => ({}),
    },
  );
  await reading;
  s.stop();
  let end: unknown;
  void s.done.then((v) => {
    end = v;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.deepEqual(end, { reason: "stopped" });
  assert.equal(returned, 1);
});
