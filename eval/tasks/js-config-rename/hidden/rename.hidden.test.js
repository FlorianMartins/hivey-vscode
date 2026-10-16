import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { HELP, configFromArgs } from "./cli.js";

function collect() {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m) };
}

test("timeoutMs is the setting, in milliseconds, with the same default", () => {
  const { warnings, warn } = collect();
  const config = loadConfig({}, { warn });
  assert.equal(config.timeoutMs, 30000);
  assert.equal("timeout" in config, false, "the old key is not in the effective configuration");
  assert.equal(DEFAULTS.timeoutMs, 30000);
  assert.deepEqual(warnings, []);
  assert.equal(loadConfig({ timeoutMs: 1500 }, { warn }).timeoutMs, 1500);
  assert.deepEqual(warnings, []);
});

test("an old config with timeout in seconds still works, with one warning", () => {
  const { warnings, warn } = collect();
  const config = loadConfig({ timeout: 2 }, { warn });
  assert.equal(config.timeoutMs, 2000);
  assert.equal("timeout" in config, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /timeout/);
  assert.match(warnings[0], /timeoutMs/);
  assert.equal(loadConfig({ timeout: 0.5 }, { warn }).timeoutMs, 500);
});

test("when both are given, timeoutMs wins", () => {
  const { warnings, warn } = collect();
  assert.equal(loadConfig({ timeout: 9, timeoutMs: 1200 }, { warn }).timeoutMs, 1200);
  assert.equal(warnings.length, 1);
});

test("the old retry rename still works alongside", () => {
  const { warnings, warn } = collect();
  const config = loadConfig({ retry: 4, timeout: 1 }, { warn });
  assert.equal(config.retries, 4);
  assert.equal(config.timeoutMs, 1000);
  assert.equal(warnings.length, 2);
});

test("invalid values are refused, under the name the user wrote", () => {
  const none = () => {};
  assert.throws(() => loadConfig({ timeoutMs: 0 }, { warn: none }), /timeoutMs/);
  assert.throws(() => loadConfig({ timeoutMs: -5 }, { warn: none }), /timeoutMs/);
  assert.throws(() => loadConfig({ timeoutMs: "1000" }, { warn: none }), /timeoutMs/);
  assert.throws(() => loadConfig({ timeoutMs: 12.5 }, { warn: none }), /timeoutMs/);
  assert.throws(() => loadConfig({ timeout: -1 }, { warn: none }), /timeout/);
});

test("the client waits for timeoutMs", async () => {
  const seen = [];
  const transport = async (url, opts) => {
    seen.push(opts.timeoutMs);
    return { ok: true, url };
  };
  await createClient(loadConfig({ timeoutMs: 2500 }, { warn: () => {} }), transport).get("/a");
  await createClient(loadConfig({ timeout: 3 }, { warn: () => {} }), transport).get("/b");
  await createClient(loadConfig({}, { warn: () => {} }), transport).get("/c");
  assert.deepEqual(seen, [2500, 3000, 30000]);
});

test("the CLI takes --timeout-ms, and still --timeout in seconds with the warning", () => {
  const a = collect();
  assert.equal(configFromArgs(["--timeout-ms", "750"], { warn: a.warn }).timeoutMs, 750);
  assert.deepEqual(a.warnings, []);
  const b = collect();
  assert.equal(configFromArgs(["--timeout", "4"], { warn: b.warn }).timeoutMs, 4000);
  assert.equal(b.warnings.length, 1);
});

test("the help documents --timeout-ms", () => {
  assert.match(HELP, /--timeout-ms <ms>|--timeout-ms <milliseconds>|--timeout-ms <n>|--timeout-ms/);
  assert.doesNotMatch(HELP, /--timeout <seconds>/);
});
