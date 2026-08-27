// `#context` and `@participant`.
//
// The notation is borrowed from Copilot deliberately — a developer should not have to learn a
// second syntax for the same idea — and the tests are almost entirely about the things that look
// like the notation and are not: a Markdown heading, a colour, a URL fragment, an e-mail address.
// Getting those wrong is not a cosmetic failure. `#ff8800` silently attaching a file, or `@alice`
// in a sentence being eaten before the question is sent, both change what the model is asked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeMention, mentionSuggestions, parsePrompt, participantDirective, participants } from "../src/core/session/mentions.js";

const kinds = (input: string) => parsePrompt(input).mentions.map((m) => m.kind);

// ── What is a mention ────────────────────────────────────────────────────────────────────────

test("the bare notations are recognised", () => {
  assert.deepEqual(kinds("what is wrong with #selection"), ["selection"]);
  assert.deepEqual(kinds("#changes — is this ready to commit?"), ["changes"]);
  assert.deepEqual(kinds("fix #problems"), ["problems"]);
  assert.deepEqual(kinds("#codebase where is the VAT computed?"), ["codebase"]);
  assert.deepEqual(kinds("#terminal why did that fail"), ["terminal"]);
});

test("the notations that take an argument keep it", () => {
  const one = parsePrompt("compare #file:src/billing/vat.ts with the spec");
  assert.equal(one.mentions[0]?.kind, "file");
  assert.equal(one.mentions[0]?.argument, "src/billing/vat.ts");

  const quoted = parsePrompt('open #file:"src/my folder/a b.ts" please');
  assert.equal(quoted.mentions[0]?.argument, "src/my folder/a b.ts", "a path with spaces needs quotes to survive");

  const member = parsePrompt("explain #member:QGPL/QRPGLESRC(CALCVAT)");
  assert.equal(member.mentions[0]?.kind, "member");
  assert.equal(member.mentions[0]?.argument, "QGPL/QRPGLESRC(CALCVAT)");
});

test("several mentions in one question are all found, in order", () => {
  assert.deepEqual(kinds("#changes and #problems, then #file:a.ts"), ["changes", "problems", "file"]);
});

// ── What is NOT a mention ────────────────────────────────────────────────────────────────────

test("a Markdown heading is not a mention", () => {
  // The panel renders Markdown, so people write it. `# Title` at the start of a line must survive.
  assert.deepEqual(kinds("# Title\n\nthe rest"), []);
  assert.deepEqual(kinds("## Section"), []);
});

test("a colour is not a mention", () => {
  assert.deepEqual(kinds("why is the border #ff8800 here?"), []);
  assert.deepEqual(kinds("#fff"), [], "three hex digits are still a colour");
});

test("a URL fragment is not a mention", () => {
  assert.deepEqual(kinds("see https://example.org/docs#selection for the rule"), []);
});

test("a word that is not a known notation is left alone", () => {
  assert.deepEqual(kinds("ticket #changelog is about this"), []);
  assert.deepEqual(kinds("issue #42"), [], "a number is not a notation");
});

test("a notation used with the wrong shape is ignored rather than half-read", () => {
  // `#sym` needs a name; without one it means nothing, and guessing would attach the wrong thing.
  assert.deepEqual(kinds("what about #sym"), []);
  assert.deepEqual(kinds("#file"), ["editor"], "bare #file is the active file, which is what people mean");
});

// ── Participants ─────────────────────────────────────────────────────────────────────────────

test("a leading participant is read and removed from the question", () => {
  const parsed = parsePrompt("@workspace where is the VAT computed?");
  assert.equal(parsed.participant, "workspace");
  assert.equal(parsed.text, "where is the VAT computed?", "the model should not be asked about the @ itself");
});

test("a participant elsewhere in the sentence is left where it is", () => {
  // "ask @alice about it" is prose. Rewriting it would change what the user said.
  const parsed = parsePrompt("ask @alice about it");
  assert.equal(parsed.participant, undefined);
  assert.equal(parsed.text, "ask @alice about it");
});

test("an unknown participant is not eaten", () => {
  const parsed = parsePrompt("@nobody hello");
  assert.equal(parsed.participant, undefined);
  assert.equal(parsed.text, "@nobody hello");
});

test("a participant and mentions coexist", () => {
  const parsed = parsePrompt("@ibmi does #member:QGPL/QRPGLESRC(CALCVAT) round correctly?");
  assert.equal(parsed.participant, "ibmi");
  assert.equal(parsed.mentions[0]?.kind, "member");
  assert.match(parsed.text, /^does /);
});

test("the platform participants exist and each says where to look first", () => {
  const ids = participants().map((p) => p.id);
  for (const expected of ["workspace", "editor", "terminal", "git", "ibmi", "arcad"]) {
    assert.ok(ids.includes(expected as never), `${expected} is missing`);
  }
  assert.match(participantDirective("ibmi"), /QSYS2/);
  assert.match(participantDirective("arcad"), /change management/i);
  assert.match(participantDirective("git"), /never push/i, "the one thing the agent must not decide on its own");
});

// ── The interface's side of it ───────────────────────────────────────────────────────────────

test("every mention can be described for the context strip", () => {
  const all = parsePrompt("#selection #changes #problems #codebase #terminal #openFiles #editor").mentions;
  assert.equal(all.length, 7);
  for (const mention of all) assert.ok(describeMention(mention).length > 0);
  assert.equal(describeMention({ kind: "file", argument: "src/a.ts", raw: "" }), "src/a.ts");
});

test("the suggestion list covers what the parser accepts", () => {
  const suggested = mentionSuggestions().map((s) => s.token.replace(/[:#]/g, ""));
  // A suggestion the parser rejects would be a trap: the user types what was offered and nothing
  // happens. Each suggested token is parsed back, with a plausible argument where one is needed.
  for (const entry of mentionSuggestions()) {
    const probe = entry.token.endsWith(":") ? `${entry.token}x` : entry.token;
    assert.equal(parsePrompt(probe).mentions.length, 1, `${entry.token} is offered but not parsed`);
  }
  assert.ok(suggested.includes("selection"));
});
