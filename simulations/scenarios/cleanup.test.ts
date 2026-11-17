import { test } from "node:test";
import assert from "node:assert/strict";
import { closeAll } from "../src/cleanup.ts";

test("simulations/README.md: failed cleanup still closes every resource in reverse order", async () => {
  const closed: number[] = [];
  const first = new Error("first cleanup failure");
  const second = new Error("second cleanup failure");
  await assert.rejects(closeAll([
    () => { closed.push(1); },
    async () => { closed.push(2); throw second; },
    () => { closed.push(3); throw first; },
  ]), error => error instanceof AggregateError && error.errors[0] === first && error.errors[1] === second);
  assert.deepEqual(closed, [3, 2, 1]);
});

test("simulations/README.md: world cleanup attempts every resource after failure and stops Core", async () => {
  const { createWorld } = await import("../src/world.ts");
  const { rm } = await import("node:fs/promises");
  const w = await createWorld();
  let closed = false;
  w.onClose(() => { throw new Error("archive failed"); });
  w.onClose(() => { closed = true; });
  try {
    await assert.rejects(w.close(), /Cleanup failed/);
    assert.equal(closed, true);
    await assert.rejects(fetch(w.core.url + "/about"));
  } finally {
    w.admin.close();
    w.network.close();
    await w.complete(w.core.stop());
    await rm(w.root, { recursive: true, force: true });
  }
});
