// Noticing that a machine the user controls is serving something new.

import { test } from "node:test";
import assert from "node:assert/strict";
import { servedSetChanged } from "../src/core/models/watch.js";

test("the first look is a baseline, not news", () => {
  // The one subtlety here, and it is easy to write backwards — I did. The other way round, every
  // window that opens rebuilds its model list once for nothing.
  assert.equal(servedSetChanged(undefined, ["qwen2.5-coder:7b"]), false);
  assert.equal(servedSetChanged(undefined, []), false);
});

test("a model pulled while the editor was open is news", () => {
  assert.equal(servedSetChanged(["a"], ["a", "b"]), true);
});

test("a model removed is news too", () => {
  // A picker offering a model the runtime no longer has sends a question that comes back 404.
  assert.equal(servedSetChanged(["a", "b"], ["a"]), true);
});

test("the same models in another order are the same models", () => {
  // Two runtimes answering in a different sequence is not a new model, and rebuilding the list on
  // it would mean rebuilding it every two minutes for ever.
  assert.equal(servedSetChanged(["a", "b"], ["b", "a"]), false);
});

test("a swap of the same size is still a change", () => {
  // The cheap version of this compares lengths and stops. Replacing one model with another keeps
  // the count and is exactly the case a length check cannot see.
  assert.equal(servedSetChanged(["a", "b"], ["a", "c"]), true);
});

test("nothing serving nothing is not a change", () => {
  assert.equal(servedSetChanged([], []), false);
});
