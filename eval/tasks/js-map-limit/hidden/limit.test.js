import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "./limit.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("results come back in order", async () => {
  const out = await mapLimit([30, 10, 20], 2, async (ms) => {
    await sleep(ms);
    return ms * 2;
  });
  assert.deepEqual(out, [60, 20, 40]);
});

test("never more than the limit in flight", async () => {
  let active = 0;
  let peak = 0;
  await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
    active++;
    peak = Math.max(peak, active);
    await sleep(5);
    active--;
  });
  assert.ok(peak <= 3, `peak ${peak}`);
});
