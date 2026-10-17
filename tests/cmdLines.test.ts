// A command of several lines on cmd.exe — see core/terminal/cmdLines.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cmdMultiLineProblem } from "../src/core/terminal/cmdLines.js";

test("cmd.exe: a command of several lines is refused with the way that works", () => {
  const why = cmdMultiLineProblem('node -e "\nconst a = 1;\nconsole.log(a)"', "win32");
  assert.match(why!, /3 lines, and cmd\.exe runs only the first one/);
  assert.match(why!, /write_file/);
});

test("one line, a trailing newline, or another platform: run as it is", () => {
  assert.equal(cmdMultiLineProblem("npm test\n", "win32"), undefined);
  assert.equal(cmdMultiLineProblem("npm test && node --check a.js", "win32"), undefined);
  assert.equal(cmdMultiLineProblem("echo a\necho b", "linux"), undefined);
});
