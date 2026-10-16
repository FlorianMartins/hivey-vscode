import { test } from "node:test";
import assert from "node:assert/strict";
import { sortEntries } from "./entries.js";

const file = (name) => ({ type: "file", name });
const folder = (name) => ({ type: "folder", name });

test("folders come first", () => {
  const sorted = sortEntries([file("a.txt"), folder("src"), file("b.txt"), folder("docs")]);
  assert.deepEqual(sorted.map((e) => e.name), ["docs", "src", "a.txt", "b.txt"]);
});
