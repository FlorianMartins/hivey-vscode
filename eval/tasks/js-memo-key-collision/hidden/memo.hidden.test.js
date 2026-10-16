import { test } from "node:test";
import assert from "node:assert/strict";
import { memoize } from "./memo.js";

function counted(fn) {
  const wrapped = (...args) => {
    wrapped.calls += 1;
    return fn(...args);
  };
  wrapped.calls = 0;
  return wrapped;
}

test("every argument is part of the key", () => {
  const inner = counted((a, b) => `${a}|${b}`);
  const f = memoize(inner);
  assert.equal(f("x", "1"), "x|1");
  assert.equal(f("x", "2"), "x|2");
  assert.equal(f("y", "1"), "y|1");
  assert.equal(f("x", "1"), "x|1");
  assert.equal(inner.calls, 3);
});

test("arguments that would join into the same string are still different calls", () => {
  const f = memoize((a, b) => [a, b]);
  assert.deepEqual(f("a,b", "c"), ["a,b", "c"]);
  assert.deepEqual(f("a", "b,c"), ["a", "b,c"]);
});

test("a repeated call is free", () => {
  const inner = counted((n) => n * 2);
  const f = memoize(inner);
  f(21);
  f(21);
  f(21);
  assert.equal(inner.calls, 1);
});

test("objects with the same content still hit the cache", () => {
  const inner = counted((o) => o.a + 1);
  const f = memoize(inner);
  assert.equal(f({ a: 1 }), 2);
  assert.equal(f({ a: 1 }), 2);
  assert.equal(inner.calls, 1);
});

test("a cached undefined is not recomputed", () => {
  const inner = counted(() => undefined);
  const f = memoize(inner);
  f("k");
  f("k");
  assert.equal(inner.calls, 1);
});
