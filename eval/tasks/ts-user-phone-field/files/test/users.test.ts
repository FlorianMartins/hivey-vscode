import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/api/users.js";
import { UserStore } from "../src/store.js";

const fixedNow = () => new Date("2026-03-01T09:00:00Z");

test("a user is created and returned", () => {
  const store = new UserStore(fixedNow);
  const res = handle(store, { method: "POST", path: "/users", body: { name: " Ada ", email: "Ada@Example.com" } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 1, name: "Ada", email: "ada@example.com", createdAt: "2026-03-01T09:00:00.000Z" });
});

test("an invalid email is a 400 naming the field", () => {
  const store = new UserStore(fixedNow);
  const res = handle(store, { method: "POST", path: "/users", body: { name: "Ada", email: "nope" } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { errors: [{ field: "email", message: "email must be a valid address" }] });
});

test("a user is updated", () => {
  const store = new UserStore(fixedNow);
  handle(store, { method: "POST", path: "/users", body: { name: "Ada", email: "ada@example.com" } });
  const res = handle(store, { method: "PATCH", path: "/users/1", body: { name: "Ada L." } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: 1, name: "Ada L.", email: "ada@example.com", createdAt: "2026-03-01T09:00:00.000Z" });
});

test("users are listed", () => {
  const store = new UserStore(fixedNow);
  handle(store, { method: "POST", path: "/users", body: { name: "Ada", email: "ada@example.com" } });
  handle(store, { method: "POST", path: "/users", body: { name: "Bob", email: "bob@example.com" } });
  const res = handle(store, { method: "GET", path: "/users" });
  assert.equal(res.status, 200);
  assert.equal((res.body as unknown[]).length, 2);
});

test("an unknown user is a 404", () => {
  const store = new UserStore(fixedNow);
  assert.equal(handle(store, { method: "GET", path: "/users/9" }).status, 404);
  assert.equal(handle(store, { method: "PATCH", path: "/users/9", body: {} }).status, 404);
});
