// What a failing command most likely got wrong — see core/terminal/hints.ts. Outputs taken from
// recorded agent runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { commandHint } from "../src/core/terminal/hints.js";

const linux = "linux";

test("npx tsc fetching the unrelated `tsc` package is named, with the command that works", () => {
  const out = "npm warn exec The following package was not found and will be installed: tsc@2.0.4\n\nThis is not the tsc command you are looking for";
  const h = commandHint({ command: "npx tsc --noEmit events.ts", output: out, exitCode: 1, platform: linux });
  assert.match(h!, /unrelated npm package named `tsc`/);
  assert.match(h!, /npx -y -p typescript tsc/);
  const canceled = "npm error npx canceled due to missing packages and no YES option: [\"tsc@2.0.4\"]";
  assert.ok(commandHint({ command: "npx --no-install tsc --noEmit x.ts", output: canceled, exitCode: 1, platform: linux }));
  // The right command already: nothing to say about the package.
  assert.equal(commandHint({ command: "npx -y -p typescript tsc --noEmit x.ts", output: "x.ts(3,1): error TS1128", exitCode: 2, platform: linux }), undefined);
});

test("Windows: single quotes in node -e, and Unix tools in cmd.exe", () => {
  const q = commandHint({ command: "node -e 'console.log(1)'", output: "", exitCode: 1, platform: "win32" });
  assert.match(q!, /single quotes are not quotes/);
  assert.equal(commandHint({ command: "node -e 'console.log(1)'", output: "", exitCode: 1, platform: linux }), undefined, "fine elsewhere");
  const ls = commandHint({ command: "ls src", output: "'ls' is not recognized as an internal or external command,", exitCode: 1, platform: "win32" });
  assert.match(ls!, /cmd\.exe on Windows/);
  const fr = commandHint({ command: "cat a.txt", output: "'cat' n'est pas reconnu en tant que commande interne", exitCode: 1, platform: "win32" });
  assert.ok(fr);
});

test("module format and missing modules", () => {
  assert.match(
    commandHint({ command: "node index.js", output: "SyntaxError: Cannot use import statement outside a module", exitCode: 1, platform: linux })!,
    /"type": "module"/,
  );
  assert.match(
    commandHint({ command: "node --test test/", output: "Error: Cannot find module '/w/test'", exitCode: 1, platform: linux })!,
    /could not be found/,
  );
});

test("a success, or a failure nothing here recognises, adds nothing", () => {
  assert.equal(commandHint({ command: "npx tsc", output: "tsc@2.0.4 will be installed", exitCode: 0, platform: linux }), undefined);
  assert.equal(commandHint({ command: "node --test", output: "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal", exitCode: 1, platform: linux }), undefined);
});
