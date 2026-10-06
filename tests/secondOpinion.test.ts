// A second model reads the diff before the dangerous ones are applied.
//
// The residue this exists for is written in the threat model: a user who approves without reading
// approves anyway. And the changes where that costs the most are the SMALL ones — a line added to a
// list of blocked globs, a setting that turns a check off. Three lines long, they look like what was
// asked for, and they remove a guarantee.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRIGGERS,
  GUARDED_KEYS,
  SENSITIVE_PATHS,
  addedLines,
  describeOpinion,
  needsSecondOpinion,
  parseObjections,
  secondOpinionPrompt,
} from "../src/core/review/second.js";
import { matchGlob } from "../src/core/util/glob.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const small = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@", "-const x = 1;", "+const x = 2;"].join("\n");

// ── Which diffs get a second reader ──────────────────────────────────────────────────────────────

test("a diff that changes a guarded setting always gets one, however small", () => {
  // THE case. Three lines, looks like what was asked for, removes a guarantee.
  const diff = ["--- a/.vscode/settings.json", "+++ b/.vscode/settings.json", '+  "hiveyCode.privacy.redaction": "off",'].join("\n");
  const trigger = needsSecondOpinion({ paths: ["x.json"], diff }, DEFAULT_TRIGGERS, matchGlob);
  assert.equal(trigger.needed, true);
  assert.match(trigger.why, /privacy\.redaction/);
  assert.match(trigger.why, /the other rules depend on/);
});

test("every guarantee this product makes elsewhere is on the guarded list", () => {
  // The list is not a guess: it is the set of things treated as guarantees in the rest of the code.
  for (const key of [
    "privacy.blockedGlobs",
    "permissions.autoApprove",
    "ibmi.writableLibraries",
    "corpus.enabled",
    "siem.rejectUnauthorized",
    "hooks",
  ]) {
    assert.ok(GUARDED_KEYS.includes(key), `${key} can be changed without a second reader`);
  }
});

test("a diff touching a file that configures everything else gets one", () => {
  const trigger = needsSecondOpinion({ paths: ["src/a.ts", ".hiveycode/hooks.json"], diff: small }, DEFAULT_TRIGGERS, matchGlob);
  assert.equal(trigger.needed, true);
  assert.match(trigger.why, /\.hiveycode\/hooks\.json/);
  assert.ok(SENSITIVE_PATHS.includes("**/.github/workflows/**"), "a workflow decides what CI enforces");
});

test("a diff too big to have been read gets one", () => {
  const big = ["--- a/x", "+++ b/x", ...Array.from({ length: 200 }, (_, i) => `+line ${i}`)].join("\n");
  const trigger = needsSecondOpinion({ paths: ["src/a.ts"], diff: big }, DEFAULT_TRIGGERS, matchGlob);
  assert.equal(trigger.needed, true);
  assert.match(trigger.why, /past the point where a diff gets scrolled rather than read/);
});

test("an ordinary small change does not", () => {
  // Otherwise every edit costs a second turn, and the feature gets switched off.
  assert.deepEqual(needsSecondOpinion({ paths: ["src/a.ts"], diff: small }, DEFAULT_TRIGGERS, matchGlob), {
    needed: false,
    why: "",
  });
});

test("the header lines are not counted as changes", () => {
  assert.deepEqual(addedLines(small), ["const x = 2;"]);
  assert.equal(addedLines("+++ b/x\n+real").length, 1);
});

// ── What is asked ────────────────────────────────────────────────────────────────────────────────

test("the question is narrowed to the one thing a second reader is good at", () => {
  // Not "review this code": that is the first model's job and it has more context. A general review
  // of a three-line settings change is a paragraph of nothing.
  const prompt = secondOpinionPrompt("Turn off the lint rule for this file", small);
  assert.match(prompt, /does this diff do anything the request did not ask for\?/);
  assert.equal(/review this code/i.test(prompt), false);
  // And it names what to look for, which is what makes a small model good at this.
  assert.match(prompt, /what it REMOVES or WEAKENS/);
  assert.match(prompt, /a test deleted rather than fixed/);
  assert.match(prompt, /An empty array means the diff does what was asked/);
  assert.match(prompt, /saying it is more useful than finding something to say/);
  assert.match(prompt, /Turn off the lint rule for this file/);
});

// ── Reading the answer ───────────────────────────────────────────────────────────────────────────

test("objections are read, with what they are about", () => {
  const { objections, unreadable } = parseObjections(
    'I had a look.\n```json\n[{"about":"src/a.ts:12","objection":"it also deletes the null check, which was not asked for"}]\n```',
  );
  assert.equal(unreadable, false);
  assert.equal(objections.length, 1);
  assert.equal(objections[0]?.about, "src/a.ts:12");
  assert.match(objections[0]?.objection ?? "", /deletes the null check/);
});

test("an empty array is “nothing to object to”, and is the expected answer", () => {
  const { objections, unreadable } = parseObjections("```json\n[]\n```");
  assert.deepEqual(objections, []);
  assert.equal(unreadable, false);
});

test("an answer that could not be read is reported as such, never as “no objections”", () => {
  // The whole point is to put something on the card. A parser failure producing an empty list would
  // put a reassuring nothing there.
  const { objections, unreadable } = parseObjections("Looks fine to me, I suppose.");
  assert.deepEqual(objections, []);
  assert.equal(unreadable, true);
  const lines = describeOpinion({ objections, unreadable }, "qwen2.5-coder:7b", false);
  assert.match(lines[0] ?? "", /could not be read/);
  assert.match(lines[0] ?? "", /not “no objections”/);
  assert.match(lines[0] ?? "", /read the diff yourself/);
});

test("a model that said nothing at all is not an unreadable answer", () => {
  assert.deepEqual(parseObjections(""), { objections: [], unreadable: false });
});

// ── What the card says ───────────────────────────────────────────────────────────────────────────

test("the card names the model, so nobody wonders who objected", () => {
  const lines = describeOpinion(
    { objections: [{ about: "settings.json", objection: "it widens autoApprove to all" }], unreadable: false },
    "qwen2.5-coder:7b",
    false,
  );
  assert.match(lines[0] ?? "", /A second reader \(qwen2\.5-coder:7b\) objects:/);
  assert.match(lines[1] ?? "", /settings\.json: it widens autoApprove to all/);
});

test("blocking is said on the card, and only when the organisation requires it", () => {
  // Advisory by default: a second model that could veto would be one whose own mistakes stop work,
  // and nothing here has measured how often it is wrong.
  const advisory = describeOpinion({ objections: [{ about: "", objection: "x" }], unreadable: false }, "m", false);
  const blocking = describeOpinion({ objections: [{ about: "", objection: "x" }], unreadable: false }, "m", true);
  assert.equal(/requires/.test(advisory[0] ?? ""), false);
  assert.match(blocking[0] ?? "", /your organisation requires these to be resolved/);
});

test("nothing found is said too, so the wait is accounted for", () => {
  const lines = describeOpinion({ objections: [], unreadable: false }, "m", false);
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /found nothing the request did not ask for/);
});

// ── Where it is wired ────────────────────────────────────────────────────────────────────────────

test("the second reader is local only, and the card says so when there is none", () => {
  // Taken literally. A second opinion that quietly doubled the price of editing a settings file is a
  // feature people turn off, and one that charged without saying so would be worse.
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  assert.match(chat, /if \(!localUrl \|\| !isLocalEndpoint\(localUrl\)\)/);
  assert.match(chat, /a paid one is not called for this/);
  assert.match(chat, /providerFor\(settings, this\.keys, "local"\)/);
});

test("it runs before the edit lands, and a blocking objection stops it", () => {
  // ⚠️ This test used to pin the reader's position relative to a NOTIFICATION that asked the user to
  // apply the change. That notification is gone: the approval already happened on the panel's card,
  // and asking a second time was the "compare instead of modify" people kept reporting.
  //
  // What has to stay true is not where the reader sits relative to a dialog, but that it runs before
  // the edit is let through and that a blocking verdict refuses it. A reader whose objection arrives
  // after the write is a reader that has reviewed history.
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  const asked = chat.indexOf("const second = await this.secondOpinion(");
  const blocked = chat.indexOf("if (second.blocking)", asked);
  const allowed = chat.indexOf("return true;", asked);
  assert.ok(asked > 0, "the second reader is not called");
  assert.ok(blocked > asked && blocked < allowed, "a blocking verdict must be checked before the edit is allowed");
  // And its objections reach the turn even when they do not block, where the person reading it is.
  assert.match(chat, /second\.lines\.length/, "non-blocking objections are dropped on the floor");
});

test("it blocks only when the organisation asks AND there is something to resolve", () => {
  // A second model that could veto on its own would be one whose own mistakes stop work, and nothing
  // here has measured how often it is wrong.
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  assert.match(chat, /blocking: blocking && opinion\.objections\.length > 0/);
  assert.match(chat, /state\.policy\.secondOpinion === "blocking"/);
  // And the policy has no value that turns the check off: a policy may not remove a check.
  const policy = readFileSync(join("src", "core", "policy", "policy.ts"), "utf8");
  assert.match(policy, /secondOpinion\?: "advisory" \| "blocking";/);
  assert.equal(/secondOpinion\?: [^;]*"off"/.test(policy), false, "a policy could switch the second reader off");
});

test("a reader that could not be reached is said, not silently skipped", () => {
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  assert.match(chat, /nobody has checked this but you/);
});
