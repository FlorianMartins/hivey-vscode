import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";
import { configFromArgs } from "./cli.js";

test("the defaults", () => {
  const config = loadConfig({}, { warn: () => {} });
  assert.equal(config.retries, 2);
  assert.equal(config.baseUrl, "https://api.example.test");
});

test("the old retry key still works, with a warning", () => {
  const warnings = [];
  const config = loadConfig({ retry: 5 }, { warn: (m) => warnings.push(m) });
  assert.equal(config.retries, 5);
  assert.equal(warnings.length, 1);
});

test("flags become configuration", () => {
  const config = configFromArgs(["--retries", "4", "--base-url", "http://localhost:9"], { warn: () => {} });
  assert.equal(config.retries, 4);
  assert.equal(config.baseUrl, "http://localhost:9");
});
