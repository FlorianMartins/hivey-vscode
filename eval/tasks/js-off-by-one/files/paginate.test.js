import { test } from "node:test";
import assert from "node:assert/strict";
import { pageOf } from "./paginate.js";

const items = ["a", "b", "c", "d", "e"];

test("page 1 is the first page", () => {
  assert.deepEqual(pageOf(items, 1, 2), ["a", "b"]);
});

test("page 2 follows it", () => {
  assert.deepEqual(pageOf(items, 2, 2), ["c", "d"]);
});

test("the last page can be short", () => {
  assert.deepEqual(pageOf(items, 3, 2), ["e"]);
});
