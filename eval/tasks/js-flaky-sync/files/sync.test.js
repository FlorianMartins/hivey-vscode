import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAll } from "./sync.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const drafts = [{ id: "a" }, { id: "b" }, { id: "c" }];

// The server answers in a few milliseconds, like the staging one does.
const upload = async (item) => {
  await sleep(Math.random() * 12);
  return { id: `remote-${item.id}` };
};

test("every draft is synced", async () => {
  const result = await syncAll(drafts, upload);
  await sleep(10); // give the last uploads time to land
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((r) => r.id).sort(),
    ["a", "b", "c"],
  );
});

test("progress reaches the total", async () => {
  const seen = [];
  await syncAll(drafts, upload, { onProgress: (done, total) => seen.push(`${done}/${total}`) });
  await sleep(10);
  assert.equal(seen.at(-1), "3/3");
});
