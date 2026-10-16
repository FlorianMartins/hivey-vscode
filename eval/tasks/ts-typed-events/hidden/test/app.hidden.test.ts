import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { Bus } from "../src/bus.js";

test("adding to the cart counts the items", () => {
  const app = createApp(new Bus(), () => 0);
  app.addToCart("A1", 2);
  app.addToCart("B2", 3);
  assert.equal(app.state.items, 5);
  app.clearCart();
  assert.equal(app.state.items, 0);
});

test("logging in greets the user by id, logging out clears it", () => {
  const bus = new Bus();
  const app = createApp(bus, () => 0);
  const seen: string[] = [];
  bus.on("user:logout", (p) => seen.push(p.userId));
  app.login("ada");
  assert.equal(app.state.greeting, "Welcome back, ada");
  app.logout("ada");
  assert.equal(app.state.greeting, "");
  assert.deepEqual(seen, ["ada"]);
});

test("start makes the app ready", () => {
  const app = createApp(new Bus(), () => 0);
  app.start();
  assert.equal(app.state.ready, true);
});
