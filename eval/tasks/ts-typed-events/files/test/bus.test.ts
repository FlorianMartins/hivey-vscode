import { test } from "node:test";
import assert from "node:assert/strict";
import { Bus } from "../src/bus.js";

test("a handler receives the payload", () => {
  const bus = new Bus();
  const seen: string[] = [];
  bus.on("cart:add", (p) => seen.push(p.sku));
  bus.emit("cart:add", { sku: "A1", quantity: 1 });
  assert.deepEqual(seen, ["A1"]);
});

test("the returned function unsubscribes", () => {
  const bus = new Bus();
  let calls = 0;
  const off = bus.on("app:ready", () => calls++);
  bus.emit("app:ready");
  off();
  bus.emit("app:ready");
  assert.equal(calls, 1);
});
