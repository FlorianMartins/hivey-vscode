// Terminal output, cleaned. Fixtures are shaped like what a real shell writes — the escape
// sequences below are the ones bash, zsh and PowerShell actually emit through VS Code's shell
// integration, not an invented approximation.
//
// The reason this is tested at all: the cleaned text is what the model reads to decide whether the
// build passed. Every failure here is a model told the wrong thing about the user's code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTerminalOutput, describeOutcome, stripAnsi, tailOutput } from "../src/core/terminal/output.js";

const ESC = "";
const BEL = "";

test("colour codes come off, the coloured text stays", () => {
  const raw = `${ESC}[31mFAIL${ESC}[0m src/app.test.ts`;
  assert.equal(stripAnsi(raw), "FAIL src/app.test.ts");
});

test("VS Code's own shell markers come off whole", () => {
  // OSC 633 is how shell integration brackets a command. Matching the two-character escapes first
  // would leave `633;C` as text, and the model would read it as part of the output.
  const raw = `${ESC}]633;C${BEL}npm test${ESC}]633;D;0${BEL}`;
  assert.equal(stripAnsi(raw), "npm test");
});

test("a hyperlink keeps its label and loses its address", () => {
  const raw = `${ESC}]8;;file:///home/f/app.ts${BEL}app.ts${ESC}]8;;${BEL}`;
  assert.equal(stripAnsi(raw), "app.ts");
});

test("a title sequence terminated by ST rather than BEL is still one sequence", () => {
  assert.equal(stripAnsi(`${ESC}]0;bash${ESC}\\ready`), "ready");
});

test("a progress bar collapses to the frame it ended on", () => {
  // Every package manager writes one line a hundred times. Keeping the frames would spend the
  // model's whole context showing an animation it cannot see.
  const raw = "\r  10% ████\r  60% ██████████\r 100% ████████████████\n done\n";
  // Leading indentation is kept: a stack trace is indented, and stripping it would flatten the one
  // structure a log has. Only the outer edges of the whole text are trimmed.
  assert.equal(cleanTerminalOutput(raw), "100% ████████████████\n done");
});

test("the shell's echo of the command is not returned as output", () => {
  const raw = `npm test\n\n> 3 passing\n`;
  assert.equal(cleanTerminalOutput(raw, { command: "npm test" }), "> 3 passing");
  // But only the first line, and only when it is exactly the command: a test that prints the
  // command it ran is quoting it on purpose.
  const quoted = `> 1 failing\nrun \`npm test\` to see it\n`;
  assert.equal(cleanTerminalOutput(quoted, { command: "npm test" }), "> 1 failing\nrun `npm test` to see it");
});

test("a real failing run survives intact", () => {
  const raw = [
    `${ESC}]633;C${BEL}`,
    `${ESC}[0m${ESC}[7m${ESC}[1m${ESC}[31m FAIL ${ESC}[39m${ESC}[22m${ESC}[27m${ESC}[0m ${ESC}[2msrc/${ESC}[22m${ESC}[1mtotals.test.ts${ESC}[22m\r\n`,
    "  ● totals › adds up\r\n\r\n",
    "    expect(received).toBe(expected)\r\n",
    "    Expected: 6\r\n    Received: 5\r\n\r\n",
    `      at Object.<anonymous> (${ESC}[2msrc/${ESC}[22mtotals.test.ts:12:19)\r\n`,
    `${ESC}]633;D;1${BEL}`,
  ].join("");
  const clean = cleanTerminalOutput(raw);
  assert.match(clean, /FAIL {2}src\/totals\.test\.ts/);
  assert.match(clean, /Expected: 6/);
  assert.match(clean, /totals\.test\.ts:12:19/);
  assert.equal(clean.includes(ESC), false, "an escape survived into what the model reads");
  assert.equal(/\n{3,}/.test(clean), false, "blank lines were not collapsed");
});

test("a cut log says it was cut, and keeps the end", () => {
  // The failure is at the BOTTOM of a build log. A truncation that kept the head would keep the
  // part that always says the same thing.
  const text = `${"noise\n".repeat(500)}Error: cannot find module 'left-pad'`;
  const cut = tailOutput(text, 200);
  assert.ok(cut.length < text.length);
  assert.match(cut, /Error: cannot find module 'left-pad'/);
  assert.match(cut, /earlier characters omitted/);
  assert.equal(cut.includes("\nnoise\nnoise"), true, "the tail should still be whole lines");
});

test("an exit code the shell did not report is stated as unproven, never as success", () => {
  // The failure this guards against is the quiet one: a model that reads "the command finished"
  // and concludes the tests passed, then reports success to the user on no evidence at all.
  const unknown = describeOutcome({ output: "…", exitCode: undefined });
  assert.match(unknown, /no exit code/);
  assert.match(unknown, /unproven/);
  assert.equal(unknown.startsWith("exit code 0"), false);

  assert.match(describeOutcome({ output: "ok", exitCode: 0 }), /^exit code 0\nok$/);
  assert.match(describeOutcome({ output: "boom", exitCode: 1 }), /^exit code 1\nboom$/);
  assert.match(describeOutcome({ output: "", exitCode: 0 }), /\(no output\)/);
  assert.match(describeOutcome({ output: "x", timedOut: true }), /timed out/);
});
