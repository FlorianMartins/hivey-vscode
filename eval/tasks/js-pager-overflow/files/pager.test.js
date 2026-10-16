import { test } from "node:test";
import assert from "node:assert/strict";
import { GAP, pageItems } from "./pager.js";

test("a short list shows every page", () => {
  assert.deepEqual(pageItems(5, 2), [1, 2, 3, 4, 5]);
});

test("a long list hides the pages far from the current one", () => {
  assert.deepEqual(pageItems(50, 25), [1, GAP, 24, 25, 26, GAP, 50]);
});
