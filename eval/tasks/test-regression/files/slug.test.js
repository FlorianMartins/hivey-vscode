import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slug.js";

test("spaces become dashes", () => {
  assert.equal(slugify("hello world"), "hello-world");
});
