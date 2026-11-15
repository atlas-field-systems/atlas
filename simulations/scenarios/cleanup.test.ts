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
