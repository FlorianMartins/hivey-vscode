import { test } from "node:test";
import assert from "node:assert/strict";
import { getUser } from "./cache.js";

test("a first call returns the user", async () => {
  const user = await getUser(7);
  assert.ok(user, "getUser returned nothing on a cold cache");
  assert.equal(user.id, 7);
});

test("two calls at once both get the user, and fetch once", async () => {
  const [a, b] = await Promise.all([getUser(9), getUser(9)]);
  assert.ok(a && b);
  assert.equal(a.name, "user-9");
  assert.equal(b.name, "user-9");
});
