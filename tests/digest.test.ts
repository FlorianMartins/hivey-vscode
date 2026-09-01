// Turning a transcript into something shorter: what compacting and "use as context" share.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compactBrief, digestEntries, sessionAsContext, shouldSuggestCompact } from "../src/core/session/digest.js";
import type { Entry } from "../src/core/session/session.js";

let n = 0;
function entry(role: Entry["role"], text: string, over: Partial<Entry> = {}): Entry {
  return { id: `e${n++}`, role, text, at: 1000 + n, included: true, ...over };
}

const OPTS = {
  you: "You",
  assistant: "Hivey Code",
  maxTokens: 10_000,
  omittedNote: (count: number) => `(${count} omitted.)`,
};

test("a digest reads as a conversation, with both sides named", () => {
  const out = digestEntries([entry("user", "why is it slow"), entry("assistant", "the loop is quadratic")], OPTS);
  assert.match(out, /You: why is it slow/);
  assert.match(out, /Hivey Code: the loop is quadratic/);
});

test("a muted exchange stays out, because the user already said it was irrelevant", () => {
  const out = digestEntries(
    [entry("user", "keep this"), entry("user", "forget this", { included: false })],
    OPTS,
  );
  assert.match(out, /keep this/);
  assert.doesNotMatch(out, /forget this/);
});

test("a failed turn is not something anyone said", () => {
  const out = digestEntries([entry("user", "hello"), entry("assistant", "", { error: "HTTP 500" })], OPTS);
  assert.doesNotMatch(out, /HTTP 500/);
});

test("trimming keeps the end, drops whole exchanges, and says how many", () => {
  // The end carries the conclusion. Half of an old exchange is worse than none of it: it reads as
  // something the participants said and stops where the meaning was.
  const entries = Array.from({ length: 40 }, (_, i) => entry("user", `exchange number ${i} `.repeat(20)));
  const out = digestEntries(entries, { ...OPTS, maxTokens: 300 });
  assert.match(out, /^\(\d+ omitted\.\)/, "the omission is declared, not silent");
  assert.match(out, /exchange number 39/, "the newest survives");
  assert.doesNotMatch(out, /exchange number 0 /, "the oldest does not");
});

test("a conversation too long for the budget still yields something", () => {
  // A digest that came back empty would be a silent failure, and the caller cannot tell it apart
  // from a conversation that had nothing in it.
  const out = digestEntries([entry("user", "x".repeat(50_000))], { ...OPTS, maxTokens: 50 });
  assert.ok(out.length > 100, "one exchange, cut, still answers 'what was this about'");
});

test("an empty conversation digests to nothing at all", () => {
  assert.equal(digestEntries([], OPTS), "");
  assert.equal(digestEntries([entry("user", "   ")], OPTS), "");
});

// ── As an attachment ─────────────────────────────────────────────────────────────────────────

test("an attached conversation is fenced as untrusted", () => {
  // Not paranoia about the user's own history: a transcript contains whatever the assistant read
  // while it was running. Without the fence, attaching one would be a way to move text written by
  // somebody else into the channel that carries instructions.
  const item = sessionAsContext(
    { id: "s1", title: "Invoices", createdAt: 1, updatedAt: 2, entries: [entry("user", "about the invoices")] },
    { ...OPTS, label: (title) => `conversation: ${title}` },
  );
  assert.equal(item.untrusted, true);
  assert.equal(item.kind, "conversation");
  assert.match(item.label, /Invoices/);
  assert.match(item.body, /about the invoices/);
});

// ── When to offer ────────────────────────────────────────────────────────────────────────────

test("compacting is offered once the conversation genuinely fills the budget", () => {
  assert.equal(shouldSuggestCompact(7000, 10_000, 10), true);
});

test("it is never offered on a short conversation, whatever the ratio", () => {
  // On a small budget four exchanges cross two thirds, and nobody wants to be asked to summarise
  // four exchanges.
  assert.equal(shouldSuggestCompact(900, 1000, 10), false, "under the token floor");
  assert.equal(shouldSuggestCompact(9000, 10_000, 2), false, "too few exchanges to summarise");
});

test("it is not offered while there is room", () => {
  assert.equal(shouldSuggestCompact(6100, 20_000, 10), false);
});

test("a nonsensical budget never triggers it", () => {
  assert.equal(shouldSuggestCompact(9000, 0, 10), false);
  assert.equal(shouldSuggestCompact(9000, -1, 10), false);
});

test("the brief asks for the state of the work, not for prose", () => {
  // The summary REPLACES the transcript in the model's context, so what it must carry is what the
  // next turn needs: decisions, dead ends, exact names.
  const brief = compactBrief();
  assert.match(brief, /decisions/i);
  assert.match(brief, /rejected/i);
  assert.match(brief, /verbatim/i);
  assert.match(brief, /next step/i);
  assert.match(brief, /dense/i, "and a length budget, or it summarises to two thirds of the original");
});
