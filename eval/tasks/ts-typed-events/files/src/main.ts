import { createApp } from "./app.js";
import { Bus } from "./bus.js";

export const bus = new Bus();
export const app = createApp(bus);
app.start();
