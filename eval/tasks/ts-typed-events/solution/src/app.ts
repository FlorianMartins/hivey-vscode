import { Bus } from "./bus.js";

export interface AppState {
  ready: boolean;
  items: number;
  greeting: string;
}

/** The parts of the app that talk through the bus. */
export function createApp(bus: Bus, now: () => number = () => Date.now()) {
  const state: AppState = { ready: false, items: 0, greeting: "" };

  bus.on("app:ready", () => {
    state.ready = true;
  });
  bus.on("cart:add", (p) => {
    state.items += p.quantity;
  });
  bus.on("cart:clear", () => {
    state.items = 0;
  });
  bus.on("user:login", (p) => {
    state.greeting = `Welcome back, ${p.userId}`;
  });
  bus.on("user:logout", () => {
    state.greeting = "";
  });

  return {
    state,
    start() {
      bus.emit("app:ready");
    },
    addToCart(sku: string, quantity: number) {
      bus.emit("cart:add", { sku, quantity });
    },
    clearCart() {
      bus.emit("cart:clear");
    },
    login(userId: string) {
      bus.emit("user:login", { userId, at: now() });
    },
    logout(userId: string) {
      bus.emit("user:logout", { userId });
    },
  };
}
