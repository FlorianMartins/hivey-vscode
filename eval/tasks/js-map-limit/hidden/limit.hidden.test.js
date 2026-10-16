import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "./limit.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("one slow call does not hold the others back", async () => {
  // Item 0 only finishes once every other item has finished — or after a second, which is the
  // failure: a pool that waits for a whole batch can never finish the others first.
  const slow = deferred();
  const finished = new Set();
  let releasedBy = null;
  const items = Array.from({ length: 12 }, (_, i) => i);
  const timer = setTimeout(() => {
    releasedBy ??= "timeout";
    slow.resolve();
  }, 1000);
  const out = await mapLimit(items, 3, async (i) => {
    if (i === 0) {
      await slow.promise;
      return "slow";
    }
    await sleep(2);
    finished.add(i);
    if (finished.size === items.length - 1) {
      releasedBy ??= "others";
      slow.resolve();
    }
    return i;
  });
  clearTimeout(timer);
  assert.equal(releasedBy, "others", "the other items waited for the slow one: the free slots sat idle");
  assert.deepEqual(out, ["slow", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("the limit is used, and never exceeded", async () => {
  let active = 0;
  let peak = 0;
  const durations = [12, 3, 3, 9, 1, 7, 2, 2, 8, 1, 4, 6, 3, 2, 5];
  await mapLimit(durations, 4, async (ms) => {
    active++;
    peak = Math.max(peak, active);
    await sleep(ms);
    active--;
  });
  assert.equal(peak, 4);
  assert.equal(active, 0);
});

test("fn gets the index, and results follow the items whatever the finishing order", async () => {
  const out = await mapLimit(["a", "b", "c", "d", "e"], 2, async (item, index) => {
    await sleep((5 - index) * 3);
    return `${index}:${item}`;
  });
  assert.deepEqual(out, ["0:a", "1:b", "2:c", "3:d", "4:e"]);
});

test("a rejection rejects the whole and starts nothing new", async () => {
  const started = [];
  await assert.rejects(
    mapLimit([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2, async (i) => {
      started.push(i);
      await sleep(5);
      if (i === 1) throw new Error("boom on 1");
      await sleep(30);
      return i;
    }),
    /boom on 1/,
  );
  // Give anything still scheduled a chance to start, then check nothing did.
  await sleep(80);
  assert.deepEqual(started.length, 2, `started after the failure: ${JSON.stringify(started)}`);
});

test("more slots than items, and no items", async () => {
  assert.deepEqual(await mapLimit([1, 2], 10, async (x) => x + 1), [2, 3]);
  assert.deepEqual(await mapLimit([], 3, async (x) => x), []);
});

test("synchronous functions work too", async () => {
  assert.deepEqual(await mapLimit([1, 2, 3], 2, (x) => x * 10), [10, 20, 30]);
});
