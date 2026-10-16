import { test } from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "./bus.js";

test("a handler receives what is emitted", () => {
  const bus = new EventBus();
  const seen = [];
  bus.on("x", (p) => seen.push(p));
  bus.emit("x", 1);
  bus.emit("x", 2);
  assert.deepEqual(seen, [1, 2]);
});

test("off removes a handler", () => {
  const bus = new EventBus();
  const seen = [];
  const handler = (p) => seen.push(p);
  bus.on("x", handler);
  bus.off("x", handler);
  bus.emit("x", 1);
  assert.deepEqual(seen, []);
});
