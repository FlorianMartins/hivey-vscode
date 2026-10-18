// What the panel's search leaves out — see core/agent/searchScope.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { gitignoreGlobs, searchExclude } from "../src/core/agent/searchScope.js";

test("plain .gitignore entries become globs; negations and nested paths are left alone", () => {
  assert.deepEqual(gitignoreGlobs("# comment\ntmp/\n/backups\n*.log\n!keep.log\nsrc/generated/x.js\n\n"), [
    "**/tmp",
    "**/tmp/**",
    "**/backups",
    "**/backups/**",
    "**/*.log",
    "**/*.log/**",
  ]);
});

test("one glob: dependencies, build output, .gitignore and the settings the user turned on", () => {
  const g = searchExclude("tmp/\r\n", { "**/*.min.js": true, "**/docs": false });
  assert.ok(g.startsWith("{") && g.endsWith("}"));
  for (const part of ["**/node_modules/**", "**/dist/**", "**/tmp/**", "**/*.min.js"]) assert.ok(g.includes(part), part);
  assert.ok(!g.includes("**/docs"));
  // Images, fonts, media and databases never hold a line of code: a project of thousands of icons
  // filled the files a search reads with them.
  for (const part of ["**/*.webp", "**/*.png", "**/*.woff2", "**/*.db-wal", "**/*.mp4"]) assert.ok(g.includes(part), part);
  assert.ok(!g.includes("**/*.js,") && !g.includes("**/*.css,"), "code is searched");
});
