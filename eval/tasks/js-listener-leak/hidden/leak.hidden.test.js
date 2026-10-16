import { test } from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "./bus.js";
import { SettingsPanel } from "./settings-panel.js";
import { mountStatusBar } from "./status-bar.js";

function quietBus() {
  const warnings = [];
  const bus = new EventBus({ onWarn: (m) => warnings.push(m) });
  return { bus, warnings };
}

test("opening and closing the panel leaves no handler behind", () => {
  const { bus, warnings } = quietBus();
  const panel = new SettingsPanel(bus);
  for (let i = 0; i < 15; i++) {
    panel.open();
    panel.close();
  }
  assert.equal(bus.listenerCount("settings:changed"), 0);
  assert.equal(bus.listenerCount("theme:changed"), 0);
  assert.deepEqual(warnings, []);
});

test("an open panel renders once per change, however often it was opened before", () => {
  const { bus } = quietBus();
  const panel = new SettingsPanel(bus);
  for (let i = 0; i < 4; i++) {
    panel.open();
    panel.close();
  }
  panel.open();
  bus.emit("settings:changed", { fontSize: 14 });
  assert.equal(panel.renders, 1);
  assert.deepEqual(panel.lastSettings, { fontSize: 14 });
  bus.emit("theme:changed", "dark");
  assert.equal(panel.theme, "dark");
});

test("a closed panel no longer reacts", () => {
  const { bus } = quietBus();
  const panel = new SettingsPanel(bus);
  panel.open();
  panel.close();
  bus.emit("settings:changed", { a: 1 });
  bus.emit("theme:changed", "dark");
  assert.equal(panel.renders, 0);
  assert.equal(panel.theme, "light");
});

test("closing the panel does not unsubscribe anybody else", () => {
  const { bus } = quietBus();
  const status = mountStatusBar(bus);
  const panel = new SettingsPanel(bus);
  panel.open();
  panel.close();
  bus.emit("settings:changed", { a: 1, b: 2 });
  assert.equal(status.text, "saved: 2 settings");
});

test("two panels are independent", () => {
  const { bus } = quietBus();
  const left = new SettingsPanel(bus);
  const right = new SettingsPanel(bus);
  left.open();
  right.open();
  left.close();
  bus.emit("settings:changed", { a: 1 });
  assert.equal(left.renders, 0);
  assert.equal(right.renders, 1);
  assert.equal(bus.listenerCount("settings:changed"), 1);
});

test("off still removes only the handler it is given, once", () => {
  const { bus } = quietBus();
  const seen = [];
  const a = () => seen.push("a");
  const b = () => seen.push("b");
  bus.on("x", a);
  bus.on("x", b);
  bus.on("x", a);
  bus.off("x", a);
  bus.emit("x");
  assert.deepEqual(seen.sort(), ["a", "b"]);
});
