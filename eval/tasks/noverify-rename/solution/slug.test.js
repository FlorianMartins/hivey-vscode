import { test } from "node:test";
import assert from "node:assert/strict";
import { toSlug } from "./slug.js";

test("a title becomes a slug", () => {
  assert.equal(toSlug("Hello, World!"), "hello-world");
  assert.equal(toSlug("  spaced  out  "), "spaced-out");
});
