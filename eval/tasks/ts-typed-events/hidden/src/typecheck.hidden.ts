// Compiled with the project and never run. Every line marked @ts-expect-error MUST be a type
// error, and every other line must not be: an unused @ts-expect-error is itself an error, so a bus
// that accepts anything fails the build here.
import { Bus } from "./bus.js";

const bus = new Bus();

bus.on("cart:add", (p) => {
  const quantity: number = p.quantity;
  const sku: string = p.sku;
  void quantity;
  void sku;
});
bus.on("user:login", (p) => {
  const at: number = p.at;
  void at;
});
bus.emit("cart:add", { sku: "A1", quantity: 2 });
bus.emit("user:login", { userId: "ada", at: 1 });
bus.emit("app:ready");
bus.emit("cart:clear");
const off: () => void = bus.on("app:ready", () => undefined);
off();
const handler = (p: { userId: string }) => void p.userId;
bus.on("user:logout", handler);
bus.off("user:logout", handler);

// @ts-expect-error an event that does not exist
bus.emit("cart:remove", { sku: "A1" });
// @ts-expect-error a payload with the wrong field
bus.emit("cart:add", { sku: "A1", qty: 2 });
// @ts-expect-error a payload of the wrong type
bus.emit("cart:add", { sku: "A1", quantity: "2" });
// @ts-expect-error a payload that is missing
bus.emit("user:login");
// @ts-expect-error a payload for an event that carries none
bus.emit("app:ready", { now: true });
// @ts-expect-error a handler that reads a field the event does not carry
bus.on("user:login", (p) => p.user);
// @ts-expect-error subscribing to an event that does not exist
bus.on("cart:remove", () => undefined);
// @ts-expect-error unsubscribing from an event that does not exist
bus.off("nope", () => undefined);
// @ts-expect-error a handler for another event's payload
bus.off("user:logout", (p: { sku: string }) => void p.sku);
