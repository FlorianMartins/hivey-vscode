// A command stopped on a question — see `waitingForInput` in core/terminal/output.ts.
//
// « une commande qui attend une saisie bloque le tour » : held until the two-minute timeout, then
// reported as TIMED OUT, which the model read as "too slow" and ran again with a longer one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeOutcome, waitingForInput } from "../src/core/terminal/output.js";

test("the questions a command stops on", () => {
  for (const last of [
    "Need to install the following packages:\n  create-vite@6.0.0\nOk to proceed? (y)",
    "Do you want to continue? [Y/n]",
    "Overwrite existing files? (yes/no)",
    "[sudo] password for florian: ",
    "Enter passphrase for key '/home/f/.ssh/id_ed25519':",
    "Press any key to continue . . .",
    "\x1b[1m? Which framework would you like to use?\x1b[0m",
    "Username for 'https://github.com':",
  ]) {
    assert.ok(waitingForInput(last), last);
  }
});

test("a silent build, a log line, a finished question are not questions", () => {
  for (const last of ["Compiling 312 files…", "webpack: watching for changes", "Tests: 12 passed", "Server listening on :3000", "Did it work? yes\nDone in 2.3s"]) {
    assert.equal(waitingForInput(last), undefined, last);
  }
  assert.equal(waitingForInput(""), undefined);
});

test("the model is told what it was asked and how to answer it on the command line — not that it was slow", () => {
  const text = describeOutcome({ output: "Ok to proceed? (y)", askedFor: "Ok to proceed? (y)" });
  assert.match(text, /waiting for an answer to « Ok to proceed\? \(y\) »/);
  assert.match(text, /--yes/);
  assert.doesNotMatch(text, /timed out/);
});
