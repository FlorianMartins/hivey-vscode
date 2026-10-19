// The workspace search with VS Code's own ripgrep — see core/search/ripgrep.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRipgrep, ripgrep, ripgrepArgs } from "../src/core/search/ripgrep.js";

test("VS Code's ripgrep is found where each version keeps it", () => {
  const app = "/opt/vscode/resources/app";
  const recent = join(app, "node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/linux-x64/rg");
  const older = join(app, "node_modules.asar.unpacked/@vscode/ripgrep/bin/rg");
  assert.equal(findRipgrep(app, "linux", "x64", (p) => p === recent || p === older), recent, "the newest place first");
  assert.equal(findRipgrep(app, "linux", "x64", (p) => p === older), older);
  assert.equal(
    findRipgrep("C:\\VS Code\\resources\\app", "win32", "x64", (p) => p.endsWith("win32-x64\\rg.exe") || p.endsWith("win32-x64/rg.exe")),
    join("C:\\VS Code\\resources\\app", "node_modules.asar.unpacked", "@vscode", "ripgrep-universal", "bin", "win32-x64", "rg.exe"),
  );
  assert.equal(findRipgrep(app, "linux", "x64", () => false), undefined, "none: the old search is used");
});

test("the same search reads the same files: path order, the pattern as JavaScript reads it", () => {
  const args = ripgrepArgs({ pattern: "require\\('\\./utils'\\)", literal: false, glob: "src/**", exclude: ["**/node_modules/**"], maxFileBytes: 400_000 });
  assert.ok(args.includes("--pcre2"));
  assert.deepEqual(args.slice(args.indexOf("--sort"), args.indexOf("--sort") + 2), ["--sort", "path"]);
  assert.deepEqual(args.slice(-4), ["--regexp", "require\\('\\./utils'\\)", "--", "."]);
  assert.ok(args.includes("!**/node_modules/**") && args.includes("src/**"));
  assert.ok(ripgrepArgs({ pattern: "total(", literal: true, exclude: [], maxFileBytes: 1 }).includes("--fixed-strings"));
});

/** A ripgrep to run the real thing with: $RG, or one on the PATH. Absent, the test says so and passes. */
function anyRipgrep(): string | undefined {
  if (process.env["RG"]) return process.env["RG"];
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return "rg";
  } catch {
    return undefined;
  }
}

test("a real search: sources found, binaries and dependencies left out, the panel's format", async (t) => {
  const rg = anyRipgrep();
  if (!rg) {
    t.skip("no ripgrep on this machine");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "rg-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "src", "artisanFlow.js"), "const a = 1;\nconst { truncate } = require('./utils');\n");
  writeFileSync(join(dir, "src", "events.js"), "// require('./utils') is missing here\n");
  writeFileSync(join(dir, "node_modules", "x.js"), "require('./utils');\n");
  writeFileSync(join(dir, "src", "icon.bin"), Buffer.from([0, 1, 2, 0x72, 0x65, 0x71, 0]));
  const r = await ripgrep({ rg, cwd: dir, pattern: "require\\('\\./utils'\\)", literal: false, exclude: ["**/node_modules/**"], maxMatches: 60, maxFileBytes: 400_000 });
  assert.deepEqual(r?.matches, [
    "src/artisanFlow.js:2: const { truncate } = require('./utils');",
    "src/events.js:1: // require('./utils') is missing here",
  ]);
  const one = await ripgrep({ rg, cwd: dir, pattern: "utils", literal: true, exclude: ["**/node_modules/**"], maxMatches: 1, maxFileBytes: 400_000 });
  assert.equal(one?.matches.length, 1);
  assert.equal(one?.capped, true);
  const refused = await ripgrep({ rg, cwd: dir, pattern: "(", literal: false, exclude: [], maxMatches: 5, maxFileBytes: 400_000 });
  assert.equal(refused, undefined, "a pattern ripgrep refuses: the caller searches the old way");
});
