// Reviewing a branch, and the one way this feature fails.
//
// A review that arrives as prose is read once. A review that arrives as findings can be walked
// through in the Problems panel and acted on. So the model is asked for structure — which means the
// PARSING is where this breaks, and it breaks on almost-JSON, on JSON wrapped in an explanation, and
// on a line number that is a string. Every one of those must produce the findings that ARE readable
// plus a note about the rest, and never an empty review, which reads as "nothing wrong".

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_CANDIDATES,
  changedFilesArgv,
  diffArgv,
  mergeBaseArgv,
  parseFindings,
  reviewPrompt,
  summarise,
} from "../src/core/review/review.js";
import { readFileSync } from "node:fs";
import { toolsForMode } from "../src/core/session/modes.js";
import type { Tool } from "../src/core/agent/loop.js";
import { join } from "node:path";

const GOOD = `Here is what I found.

\`\`\`json
[
  { "file": "src/b.ts", "line": 7, "severity": "minor", "category": "style", "message": "unused import" },
  { "file": "src/a.ts", "line": "42", "severity": "blocker", "category": "security",
    "message": "the token is logged", "fix": "remove the console.log" }
]
\`\`\`

Nothing else stood out.`;

test("findings are read out of a fenced block surrounded by prose", () => {
  const { findings, problems } = parseFindings(GOOD);
  assert.deepEqual(problems, []);
  assert.equal(findings.length, 2);
  // Worst first, which is the order somebody wants to walk.
  assert.equal(findings[0]?.severity, "blocker");
  assert.equal(findings[0]?.file, "src/a.ts");
  // A line as a STRING is the single most common shape a model returns.
  assert.equal(findings[0]?.line, 42);
  assert.equal(findings[0]?.fix, "remove the console.log");
});

test("a bare array in the prose is read too", () => {
  const { findings } = parseFindings('I found one thing: [{"file":"a.ts","message":"x","severity":"note"}] — that is all.');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "note");
});

test("an object with a findings key is read", () => {
  const { findings } = parseFindings('```json\n{"findings":[{"file":"a.ts","message":"x"}]}\n```');
  assert.equal(findings.length, 1);
  // An unknown severity is not dropped and is not "note": the safe default is to make somebody look.
  assert.equal(findings[0]?.severity, "major");
  assert.equal(findings[0]?.category, "correctness");
});

test("an empty array is a legitimate review, not a failure", () => {
  const { findings, problems } = parseFindings("```json\n[]\n```");
  assert.deepEqual(findings, []);
  assert.deepEqual(problems, [], "finding nothing is an answer");
});

test("an unreadable answer is NEVER an empty review", () => {
  // THE case. An empty findings list with no explanation reads as "nothing wrong", which is the one
  // conclusion a parser failure must not produce.
  const { findings, problems } = parseFindings("I reviewed it and it all looks reasonable to me.");
  assert.deepEqual(findings, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /no readable list of findings/);
  assert.match(problems[0]!, /not the same as nothing being wrong/);
});

test("a finding with nowhere to go, or nothing to read, is reported rather than shown", () => {
  const { findings, problems } = parseFindings(
    '```json\n[{"message":"something"},{"file":"a.ts"},{"file":"b.ts","message":"real"}]\n```',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.file, "b.ts");
  assert.equal(problems.length, 2);
  assert.match(problems[0]!, /no file, so there is nothing to go to/);
  assert.match(problems[1]!, /no message, so there is nothing to read/);
});

test("broken JSON in the first block does not lose a good second one", () => {
  const answer = "```json\n[ {file: not json} ]\n```\n\nand then:\n\n```json\n[{\"file\":\"a.ts\",\"message\":\"x\"}]\n```";
  const { findings } = parseFindings(answer);
  assert.equal(findings.length, 1);
});

test("a finding about a whole file needs no line", () => {
  const { findings } = parseFindings('```json\n[{"file":"a.ts","message":"this module has no tests","severity":"major"}]\n```');
  assert.equal(findings[0]?.line, undefined, "0 would send the editor to a line that is not the point");
});

// ── Which base, and which diff ───────────────────────────────────────────────────────────────────

test("the base is asked of git, and several defaults are tried", () => {
  // A repository whose default branch is `master`, `develop` or `trunk` is ordinary, and a review
  // that silently compared against a branch that does not exist would report the whole repository
  // as new.
  assert.deepEqual(mergeBaseArgv("origin/main"), ["merge-base", "origin/main", "HEAD"]);
  assert.ok(BASE_CANDIDATES.includes("origin/HEAD"));
  assert.ok(BASE_CANDIDATES.includes("master"));
  assert.ok(BASE_CANDIDATES.includes("develop"));
  assert.equal(BASE_CANDIDATES[0], "origin/HEAD", "the repository's own answer comes first");
});

test("the diff is three dots, not two", () => {
  // Two dots would show somebody else's commits on the base as this branch's work, which is the
  // review equivalent of blaming the wrong person.
  assert.deepEqual(diffArgv("abc123"), ["diff", "abc123...HEAD", "--unified=3"]);
  assert.deepEqual(changedFilesArgv("abc123"), ["diff", "--name-only", "abc123...HEAD"]);
  assert.equal(diffArgv("abc123").some((a) => /[^.]\.\.[^.]/.test(a)), false, "two dots reviews the wrong thing");
});

// ── What the model is asked ──────────────────────────────────────────────────────────────────────

test("the prompt asks about the diff, in an order, with the schema it must answer in", () => {
  const prompt = reviewPrompt({ base: "origin/main", files: ["a.ts", "b.ts"] });
  assert.match(prompt, /against origin\/main/);
  assert.match(prompt, /2 file\(s\) changed/);
  assert.match(prompt, /Review the DIFF, not the repository/);
  assert.match(prompt, /a line nobody touched is not this branch's problem/);
  // Incompleteness is a finding: the case not handled, the test not written.
  assert.match(prompt, /correct but incomplete/);
  // The schema is in the prompt because no structured-output mode is supported by every provider
  // here, and a review that only worked on one vendor is a review most users do not get.
  assert.match(prompt, /```json/);
  assert.match(prompt, /"severity": "blocker\|major\|minor\|note"/);
  // And the instruction against padding, which is what a model does when asked for a list.
  assert.match(prompt, /An empty array is a legitimate answer/);
  assert.match(prompt, /Do not invent a finding to/);
});

test("the organisation's own knowledge rides along when there is some", () => {
  const without = reviewPrompt({ base: "main", files: [] });
  const with_ = reviewPrompt({ base: "main", files: [], knowledge: "The settlement job runs before the batch." });
  assert.equal(/written down about its own systems/.test(without), false);
  assert.match(with_, /The settlement job runs before the batch\./);
});

test("the summary counts by severity, worst first", () => {
  const { findings } = parseFindings(GOOD);
  assert.equal(summarise(findings), "1 blocker, 1 minor");
  assert.equal(summarise([]), "No findings.");
});

// ── Where the findings go, and the one thing this feature will not do ────────────────────────────

test("the findings become diagnostics, and the collection is replaced each time", () => {
  // Not a presentation choice: diagnostics give navigation, grouping by file, a count in the status
  // bar and a place the findings stay. A review printed into a transcript scrolls away.
  const code = readFileSync(join("src", "extension", "review.ts"), "utf8");
  assert.match(code, /createDiagnosticCollection\("hivey-code-review"\)/);
  assert.match(code, /this\.collection\.clear\(\);/, "the previous review is left behind");
  // A finding about a whole file lands on line 1 rather than nowhere: the panel needs a position.
  assert.match(code, /Math\.max\(0, \(finding\.line \?\? 1\) - 1\)/);
  assert.match(code, /diagnostic\.source = `Hivey Code · \$\{finding\.category\}`/);
});

test("the review goes through the chat view, not through its own request path", () => {
  // Otherwise there is a second place a request can leave the machine, and this product has one.
  const wiring = readFileSync(join("src", "extension", "extension.ts"), "utf8");
  assert.match(wiring, /await chat\.askAndWait\(prepared\.prompt\)/);
  const review = readFileSync(join("src", "extension", "review.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const forbidden of ["fetch(", "makeProvider", "runTurn", "request("]) {
    assert.equal(review.includes(forbidden), false, `the review module reaches the network itself via ${forbidden}`);
  }
});

test("publishing findings as pull-request comments is not here", () => {
  // It would mean this extension holding a forge credential and writing on somebody's behalf to a
  // server, which is the one kind of outward action this product does not take. A user who wants it
  // configures an MCP server for their forge and approves it by name.
  const code = readFileSync(join("src", "extension", "review.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const forbidden of ["api.github.com", "gitlab", "pulls", "createReview", "GITHUB_TOKEN"]) {
    assert.equal(code.toLowerCase().includes(forbidden.toLowerCase()), false, `the review module reaches a forge via ${forbidden}`);
  }
});

test("a cut diff is announced to the model, so silence is not read as a clean review", () => {
  const code = readFileSync(join("src", "extension", "review.ts"), "utf8");
  assert.match(code, /The diff below was CUT to fit/);
  assert.match(code, /the files after the cut were not reviewed/);
});

// ── The language server's answers, and where they are allowed ────────────────────────────────────

test("the three language-server tools read, so they are available in plan mode", () => {
  // "Who calls this" decides whether to change a signature, and deciding is what plan mode is for.
  const tools = ["find_references", "call_hierarchy", "workspace_symbols", "write_file"].map(
    (name): Tool => ({
      schema: { name, description: name, parameters: { type: "object", properties: {} } },
      approval: () => false,
      run: async () => ({ content: "ok" }),
    }),
  );
  const planned = toolsForMode(tools, "plan").map((t) => t.schema.name);
  assert.deepEqual(planned, ["find_references", "call_hierarchy", "workspace_symbols"]);
});

test("a provider that did not answer is never reported as an empty answer", () => {
  // THE distinction. "No references" from a language server that is still indexing is not "no
  // references", and the two reading the same is how an agent concludes a symbol is unused and
  // deletes it.
  const code = readFileSync(join("src", "extension", "symbols.ts"), "utf8");
  // Each of the three says it, in the words that fit its own question — counting a phrase would be a
  // test of the wording rather than of the behaviour.
  assert.match(code, /not the same as “no references” — it may still be indexing/, "find_references conflates the two");
  assert.match(code, /does not provide one for this language, or it is still indexing/, "call_hierarchy conflates the two");
  assert.match(code, /not the same as “no such symbol”/, "workspace_symbols conflates the two");
  // And all three report it as an error, so the model cannot read it as a result.
  assert.equal((code.match(/isError: true/g) ?? []).length >= 3, true);
});

test("the tools say which position they asked about, so a wrong guess is visible", () => {
  // The providers take a position and a model has a name, so the name is located first — right
  // almost always and wrong for a name used before it is declared.
  const code = readFileSync(join("src", "extension", "symbols.ts"), "utf8");
  assert.match(code, /asked about \$\{where\(found\.uri, found\.position\)\}/);
});
