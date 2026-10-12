import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slug.js";

test("a title becomes a slug", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  spaced  out  "), "spaced-out");
});
