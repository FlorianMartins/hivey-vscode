// "À savoir" — the things worth saying that nobody asked about.
//
// Three sources in one section, and the point of the design is that TWO OF THE THREE are derived
// from facts the product already holds. A feature that depended on the model choosing to be
// forthcoming would be a feature that works on the models that least need it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_NOTICES, youShouldKnow, type Notice } from "../src/core/session/notices.js";

const base = { reported: [] as Notice[], changed: false, verified: false };

test("nothing to say produces nothing, not an empty section", () => {
  // The repository already learnt this about reviews: one that always finds something is one nobody
  // reads twice. A footer that is always there is furniture.
  assert.deepEqual(youShouldKnow(base), []);
  assert.deepEqual(youShouldKnow({ ...base, changed: false, verified: true }), []);
});

test("a change nothing verified is said, derived from the trace", () => {
  const [notice] = youShouldKnow({ ...base, changed: true, verified: false });
  assert.equal(notice?.kind, "unverified");
  assert.match(notice!.text, /unverified/);
  // And a change something DID verify is not mentioned: the guard is about silence, not about noise.
  assert.deepEqual(youShouldKnow({ ...base, changed: true, verified: true }), []);
});

test("a model whose tool calls had to be read from its message is reported as a setup fact", () => {
  // Measured, not guessed: it is true when the runtime returned no tool calls through the protocol.
  const [notice] = youShouldKnow({ ...base, toolCallsFromText: true });
  assert.equal(notice?.kind, "tool");
  assert.match(notice!.text, /read from its message/);
  assert.match(notice!.text, /less of a guarantee/, "it must say what was given up");
});

test("the context and the budget speak only when they are close to the line", () => {
  assert.deepEqual(youShouldKnow({ ...base, contextFill: 0.5 }), []);
  assert.match(youShouldKnow({ ...base, contextFill: 0.91 })[0]!.text, /91 % full/);
  assert.deepEqual(youShouldKnow({ ...base, spend: { today: 2, cap: 20 } }), []);
  assert.match(youShouldKnow({ ...base, spend: { today: 17.8, cap: 20 } })[0]!.text, /\$17\.80 of today's \$20\.00/);
  // A cap of zero is "no cap", so there is no line to be close to.
  assert.deepEqual(youShouldKnow({ ...base, spend: { today: 99, cap: 0 } }), []);
});

test("the order is your code, then this answer, then this session", () => {
  const notices = youShouldKnow({
    ...base,
    changed: true,
    verified: false,
    contextFill: 0.9,
    reported: [{ kind: "noticed", text: "src/pay.ts:42 rounds the other way", where: "src/pay.ts:42" }],
  });
  assert.deepEqual(notices.map((n) => n.kind), ["noticed", "unverified", "tool"]);
});

test("it is bounded, because a list of twelve asides buries the answer", () => {
  const reported: Notice[] = Array.from({ length: 12 }, (_, i) => ({ kind: "noticed", text: `thing ${i}` }));
  const notices = youShouldKnow({ ...base, reported, changed: true, contextFill: 0.99 });
  assert.equal(notices.length, MAX_NOTICES);
  // And what survives is what is about the code, because that is what somebody can act on today.
  assert.ok(notices.every((n) => n.kind === "noticed"));
});

test("the same thing said twice reads once", () => {
  const notices = youShouldKnow({
    ...base,
    changed: true,
    reported: [
      { kind: "unverified", text: "Nothing in this turn ran a test, a build or a compile, so the change is unverified." },
    ],
  });
  assert.equal(notices.length, 1);
});

test("an outstanding plan step is named, not counted", () => {
  const notices = youShouldKnow({ ...base, planLeft: ["Update the migration", "Run the suite"] });
  assert.deepEqual(
    notices.map((n) => n.text),
    ["Left undone from my own plan: Update the migration", "Left undone from my own plan: Run the suite"],
  );
});

test("a blank report is dropped rather than drawn as an empty line", () => {
  assert.deepEqual(youShouldKnow({ ...base, reported: [{ kind: "noticed", text: "   " }] }), []);
});

test("there is one set of verifier names, not two", () => {
  // `chat.ts` held a copy of the router's `VERIFIERS` — the same five entries, in two files, with
  // nothing keeping them in step. Adding a verifier to the router would have silently stopped the
  // panel counting it, and the learned routing would have gone on measuring the old set.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const chat = readFileSync("src/extension/chat.ts", "utf8");
  assert.ok(!/const VERIFIED_TOOLS = new Set\(/.test(chat), "the duplicate set is back");
  assert.match(chat, /import \{ MUTATING_TOOLS, VERIFIER_TOOLS \} from "\.\.\/core\/router\/outcome\.js";/);
});

test("both halves offer the aside tool, and the terminal was not forgotten this time", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  for (const file of ["src/extension/tools.ts", "src/cli/tools.ts"]) {
    assert.match(readFileSync(file, "utf8"), /schema: NOTE_ASIDE_TOOL/, `${file} has no aside tool`);
  }
  // And the tool must tell the model not to fix what it reports: the whole value is that the finding
  // reaches the person without the diff growing something nobody asked for.
  assert.match(readFileSync("src/core/session/notices.ts", "utf8"), /DO NOT fix what you " \+\n\s+"report here/);
});

test("the terminal asks the catalogue what the model holds, instead of a constant", () => {
  // It had `contextTokens: 8000` in its defaults, and the CHANGELOG records that a fixed figure was
  // exactly the defect the panel had: 8 000 tokens is most of a small local model's window and a
  // rounding error on a modern one. It surfaced the day a notice reported "the context is 100 %
  // full" on a model with a million-token window — a notice that fires every turn because of a
  // stale constant is the furniture this section was designed not to be.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const main = readFileSync("src/cli/main.ts", "utf8");
  assert.match(main, /catalogueWindow\(cfg\.model\)/);
  assert.ok(!/contextTokens: 8000/.test(main), "the constant is back");
  // And one lookup, not two: the panel delegates to the same function.
  assert.match(readFileSync("src/extension/models.ts", "utf8"), /return catalogueWindow\(id\);/);
});

test("the terminal's context budget goes through the shared rule, floor included", () => {
  // Reaching for the catalogue lookup alone put the terminal in a different version of the same
  // hole: a local runtime the catalogue has never heard of returns 0, and a budget of zero collapses
  // everything derived from it — the repository map first. `contextBudget` is what the floor and the
  // ceiling are for, and `repoMapBudget` carries the cap and the reason for it.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const main = readFileSync("src/cli/main.ts", "utf8");
  assert.match(main, /contextBudget\(cfg\.contextTokens > 0 \? cfg\.contextTokens : undefined, catalogueWindow\(cfg\.model\)\)/);
  assert.match(main, /repoMapBudget\(contextTokens\)/);
  assert.ok(!/contextTokens \* 0\.35/.test(main), "the terminal's own arithmetic is back");
});
