import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAll } from "./sync.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("the result is complete the moment syncAll resolves", async () => {
  let finished = 0;
  const upload = async (item) => {
    await sleep(30);
    finished += 1;
    return { id: `remote-${item.id}` };
  };
  const result = await syncAll([{ id: "a" }, { id: "b" }, { id: "c" }], upload);
  assert.equal(finished, 3, "syncAll resolved before every upload had finished");
  assert.equal(result.length, 3);
});

test("the result follows the order of the items, not the order the uploads finish in", async () => {
  const delays = { a: 40, b: 5, c: 20 };
  const upload = async (item) => {
    await sleep(delays[item.id]);
    return { id: `remote-${item.id}` };
  };
  const result = await syncAll([{ id: "a" }, { id: "b" }, { id: "c" }], upload);
  assert.deepEqual(result, [
    { id: "a", remoteId: "remote-a" },
    { id: "b", remoteId: "remote-b" },
    { id: "c", remoteId: "remote-c" },
  ]);
});

test("a failed upload rejects syncAll", async () => {
  const upload = async (item) => {
    await sleep(5);
    if (item.id === "b") throw new Error("503 from the server");
    return { id: `remote-${item.id}` };
  };
  await assert.rejects(syncAll([{ id: "a" }, { id: "b" }, { id: "c" }], upload), /503/);
});

test("progress is reported once per upload, ending at the total, before syncAll resolves", async () => {
  const seen = [];
  const upload = async (item) => {
    await sleep(15);
    return { id: `remote-${item.id}` };
  };
  await syncAll([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], upload, {
    onProgress: (done, total) => seen.push(`${done}/${total}`),
  });
  assert.deepEqual(seen, ["1/4", "2/4", "3/4", "4/4"]);
});

test("nothing to sync resolves with nothing", async () => {
  assert.deepEqual(await syncAll([], async () => ({ id: "x" })), []);
});
