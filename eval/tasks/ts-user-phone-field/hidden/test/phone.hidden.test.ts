import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/api/users.js";
import { UserStore } from "../src/store.js";

const fixedNow = () => new Date("2026-03-01T09:00:00Z");

function record(body: unknown): Record<string, unknown> {
  assert.ok(typeof body === "object" && body !== null && !Array.isArray(body), "expected an object body");
  return body as Record<string, unknown>;
}

function errorsOf(body: unknown): Array<{ field: string }> {
  const errors = record(body)["errors"];
  assert.ok(Array.isArray(errors), "a 400 carries an errors array, like the other validation errors");
  return errors as Array<{ field: string }>;
}

function create(store: UserStore, body: Record<string, unknown>) {
  return handle(store, { method: "POST", path: "/users", body });
}

test("a phone given at creation is returned", () => {
  const store = new UserStore(fixedNow);
  const res = create(store, { name: "Ada", email: "ada@example.com", phone: "+32470123456" });
  assert.equal(res.status, 201);
  assert.equal(record(res.body)["phone"], "+32470123456");
});

test("the phone is optional", () => {
  const store = new UserStore(fixedNow);
  const res = create(store, { name: "Ada", email: "ada@example.com" });
  assert.equal(res.status, 201);
  const phone = record(res.body)["phone"];
  assert.ok(phone === undefined || phone === null, `no phone was given, got ${String(phone)}`);
});

test("a phone that is not E.164 is a 400 naming the field", () => {
  for (const phone of ["0470123456", "+32 470 12 34 56", "32470123456", "+", "+3247012345678901", "phone", 32470123456]) {
    const store = new UserStore(fixedNow);
    const res = create(store, { name: "Ada", email: "ada@example.com", phone });
    assert.equal(res.status, 400, `${JSON.stringify(phone)} was accepted`);
    assert.ok(errorsOf(res.body).some((e) => e.field === "phone"), `no error names the phone field for ${JSON.stringify(phone)}`);
    assert.equal(store.list().length, 0, "a refused user must not be stored");
  }
});

test("other errors are still reported alongside the phone one", () => {
  const store = new UserStore(fixedNow);
  const res = create(store, { name: "Ada", email: "nope", phone: "0470" });
  assert.equal(res.status, 400);
  const fields = errorsOf(res.body).map((e) => e.field).sort();
  assert.deepEqual(fields, ["email", "phone"]);
});

test("the phone is set and changed by an update", () => {
  const store = new UserStore(fixedNow);
  create(store, { name: "Ada", email: "ada@example.com" });
  const set = handle(store, { method: "PATCH", path: "/users/1", body: { phone: "+33612345678" } });
  assert.equal(set.status, 200);
  assert.equal(record(set.body)["phone"], "+33612345678");
  assert.equal(record(set.body)["name"], "Ada");

  const renamed = handle(store, { method: "PATCH", path: "/users/1", body: { name: "Ada L." } });
  assert.equal(record(renamed.body)["phone"], "+33612345678", "an update that does not mention the phone keeps it");
});

test("an update with an invalid phone is refused and changes nothing", () => {
  const store = new UserStore(fixedNow);
  create(store, { name: "Ada", email: "ada@example.com", phone: "+32470123456" });
  const res = handle(store, { method: "PATCH", path: "/users/1", body: { name: "Eve", phone: "0470 12 34 56" } });
  assert.equal(res.status, 400);
  assert.ok(errorsOf(res.body).some((e) => e.field === "phone"));
  const after = record(handle(store, { method: "GET", path: "/users/1" }).body);
  assert.equal(after["name"], "Ada");
  assert.equal(after["phone"], "+32470123456");
});

test("every endpoint that returns a user returns the phone", () => {
  const store = new UserStore(fixedNow);
  create(store, { name: "Ada", email: "ada@example.com", phone: "+32470123456" });
  create(store, { name: "Bob", email: "bob@example.com", phone: "+14155550123" });
  const one = record(handle(store, { method: "GET", path: "/users/2" }).body);
  assert.equal(one["phone"], "+14155550123");
  const list = handle(store, { method: "GET", path: "/users" }).body as unknown[];
  assert.deepEqual(list.map((u) => record(u)["phone"]), ["+32470123456", "+14155550123"]);
});
