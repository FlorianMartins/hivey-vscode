// Choosing a model from what has actually happened in this repository.
//
// The expensive model is always the safe choice and always the wrong default. This is the feature
// that makes the cheap one defensible — and it is also the feature where being clever costs the user
// money, so every test below is about a limit.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_POLICY,
  choose,
  classify,
  describe as describeStats,
  find,
  forget,
  observe,
  rate,
  type Candidate,
  type Stats,
} from "../src/core/router/learned.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCAL: Candidate = { model: "qwen2.5-coder:7b", provider: "local", price: 0 };
const MID: Candidate = { model: "mistral-medium", provider: "openrouter", price: 0.4 };
const BIG: Candidate = { model: "anthropic/claude-sonnet-4", provider: "openrouter", price: 3 };
const ALL = [BIG, LOCAL, MID]; // deliberately unsorted: price order is this module's business

function stats(model: string, successes: number, attempts: number, kind = "edit", repo = "/w/app"): Stats {
  return [{ repo, kind, model, attempts, successes, lastAt: 0 }];
}

const never = () => 1; // never explores
const always = () => 0; // always explores

// ── Never outside what the user allowed ──────────────────────────────────────────────────────────

test("the chosen model is always one of the candidates, however good another's record", () => {
  // The candidates are the user's own authorised set. A model with a perfect record that is not on
  // the list is a model this must never produce.
  const excellent = stats("gpt-4o", 50, 50);
  const choice = choose(excellent, { repo: "/w/app", kind: "edit", candidates: [LOCAL, BIG], random: never });
  assert.ok(choice);
  assert.ok([LOCAL.model, BIG.model].includes(choice.model), choice.model);
});

test("no candidates means no choice, rather than a default nobody authorised", () => {
  assert.equal(choose([], { repo: "/w/app", kind: "edit", candidates: [] }), undefined);
});

// ── Never trusted too early ──────────────────────────────────────────────────────────────────────

test("one success is not a rate", () => {
  assert.equal(rate({ repo: "r", kind: "edit", model: "m", attempts: 1, successes: 1, lastAt: 0 }, 5), undefined);
  assert.equal(rate({ repo: "r", kind: "edit", model: "m", attempts: 5, successes: 4, lastAt: 0 }, 5), 0.8);
  assert.equal(rate(undefined, 5), undefined);
});

test("below the minimum, a model has no record — and no record is not a bad one", () => {
  // The configured order wins, and the sentence says why rather than implying the cheap model failed.
  const choice = choose(stats(LOCAL.model, 1, 1), { repo: "/w/app", kind: "edit", candidates: ALL, random: never });
  assert.equal(choice?.model, BIG.model, "the configured first model is the one the user chose");
  assert.match(choice?.why ?? "", /nothing cheaper has a record here yet/);
});

// ── The cheapest that is good enough ─────────────────────────────────────────────────────────────

test("the cheapest model clearing the threshold wins, and the reason carries the counts", () => {
  const choice = choose(stats(LOCAL.model, 9, 10), { repo: "/w/app", kind: "edit", candidates: ALL, random: never });
  assert.equal(choice?.model, LOCAL.model);
  assert.equal(choice?.exploring, false);
  // The sentence somebody can disagree with, rather than one they can only distrust.
  assert.equal(choice?.why, "9 of 10 in this repository");
});

test("a cheap model that has been tried and found wanting does not win, and the reason says so", () => {
  const choice = choose(stats(LOCAL.model, 4, 10), { repo: "/w/app", kind: "edit", candidates: ALL, random: never });
  assert.equal(choice?.model, BIG.model);
  assert.match(choice?.why ?? "", /qwen2\.5-coder:7b 4\/10 here, under the 80 % needed/);
});

test("the middle model wins when the cheapest cannot and it can", () => {
  const both = [...stats(LOCAL.model, 2, 10), ...stats(MID.model, 9, 10)];
  const choice = choose(both, { repo: "/w/app", kind: "edit", candidates: ALL, random: never });
  assert.equal(choice?.model, MID.model, "cheapest GOOD ENOUGH, not cheapest");
});

test("a record in another repository, or for another kind, does not count", () => {
  // The whole premise is that a repository where the small model works is not the same as one where
  // it does not.
  const elsewhere = stats(LOCAL.model, 10, 10, "edit", "/w/other");
  assert.equal(choose(elsewhere, { repo: "/w/app", kind: "edit", candidates: ALL, random: never })?.model, BIG.model);
  const otherKind = stats(LOCAL.model, 10, 10, "ask");
  assert.equal(choose(otherKind, { repo: "/w/app", kind: "edit", candidates: ALL, random: never })?.model, BIG.model);
});

// ── Exploration, bounded ─────────────────────────────────────────────────────────────────────────

test("exploration only ever tries a model with no record", () => {
  // Spending a turn re-measuring a model with forty attempts behind it buys nothing; a model nobody
  // has tried is the only thing a measurement can be about.
  const settled = stats(LOCAL.model, 40, 40);
  const choice = choose(settled, { repo: "/w/app", kind: "edit", candidates: [LOCAL, MID], random: always });
  assert.equal(choice?.model, MID.model);
  assert.equal(choice?.exploring, true);
  assert.match(choice?.why ?? "", /nothing is known about it in this repository yet/);
});

test("with every model measured, exploration cannot fire at all", () => {
  const all = [...stats(LOCAL.model, 9, 10), ...stats(MID.model, 9, 10), ...stats(BIG.model, 9, 10)];
  const choice = choose(all, { repo: "/w/app", kind: "edit", candidates: ALL, random: always });
  assert.equal(choice?.exploring, false, "there is nothing left to learn, so nothing is spent learning it");
  assert.equal(choice?.model, LOCAL.model);
});

test("exploration is bounded by the policy and is deterministic under an injected coin", () => {
  // A feature whose behaviour depends on an untestable coin flip is one nobody can reason about when
  // it surprises them.
  const fresh: Stats = [];
  assert.equal(choose(fresh, { repo: "/w/app", kind: "edit", candidates: ALL, random: () => 0.05 })?.exploring, true);
  assert.equal(choose(fresh, { repo: "/w/app", kind: "edit", candidates: ALL, random: () => 0.5 })?.exploring, false);
  assert.equal(DEFAULT_POLICY.explore, 0.1);
  assert.equal(DEFAULT_POLICY.threshold, 0.8);
  assert.equal(DEFAULT_POLICY.minAttempts, 5);
});

test("a model tried a few times is re-tried by exploration, and the reason is honest about why", () => {
  const choice = choose(stats(LOCAL.model, 2, 3), { repo: "/w/app", kind: "edit", candidates: [LOCAL, BIG], random: always });
  assert.equal(choice?.model, LOCAL.model);
  assert.match(choice?.why ?? "", /2 of 3 here so far, which is not enough to judge/);
});

// ── Recording ────────────────────────────────────────────────────────────────────────────────────

test("an observation is added without mutating what was passed in", () => {
  // The caller persists the result, and a mutation that happened before a failed write is a count
  // nobody can reconcile.
  const before: Stats = [];
  const after = observe(before, { repo: "/w/app", kind: "edit", model: LOCAL.model }, true, 1000);
  assert.deepEqual(before, []);
  assert.deepEqual(after, [{ repo: "/w/app", kind: "edit", model: LOCAL.model, attempts: 1, successes: 1, lastAt: 1000 }]);
  const twice = observe(after, { repo: "/w/app", kind: "edit", model: LOCAL.model }, false, 2000);
  assert.equal(find(twice, { repo: "/w/app", kind: "edit", model: LOCAL.model })?.attempts, 2);
  assert.equal(find(twice, { repo: "/w/app", kind: "edit", model: LOCAL.model })?.successes, 1);
});

test("a turn is classified by what it DID, not by how it was phrased", () => {
  assert.equal(classify(["read_file", "edit_file"]), "edit");
  assert.equal(classify(["read_file", "search_text"]), "ask");
  assert.equal(classify(["run_command"]), "test");
  assert.equal(classify(["ibmi_compile", "edit_file"]), "ibmi", "the platform wins: its models behave differently");
  assert.equal(classify([]), "ask");
});

// ── Local, and erasable ──────────────────────────────────────────────────────────────────────────

test("forgetting a repository leaves the others alone", () => {
  const both = [...stats(LOCAL.model, 9, 10, "edit", "/w/app"), ...stats(LOCAL.model, 1, 10, "edit", "/w/other")];
  const after = forget(both, "/w/app");
  assert.equal(after.length, 1);
  assert.equal(after[0]?.repo, "/w/other");
});

test("what has been learned can be read back, including “not enough to judge”", () => {
  const text = describeStats([...stats(LOCAL.model, 9, 10), ...stats(MID.model, 1, 2)], "/w/app", 5);
  assert.match(text, /edit · qwen2\.5-coder:7b: 9\/10 \(90 %\)/);
  assert.match(text, /edit · mistral-medium: 1\/2 \(not enough to judge\)/);
  assert.equal(describeStats([], "/w/app", 5), "Nothing has been measured in this repository yet.");
});

// ── Where it is wired, and the two limits that matter ────────────────────────────────────────────

test("it is off by default, and the candidates are only what the user configured", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { configuration: Array<{ properties: Record<string, { default: unknown }> }> };
  };
  const props = Object.assign({}, ...manifest.contributes.configuration.map((b) => b.properties)) as Record<
    string,
    { default: unknown }
  >;
  // A router that learns changes which model answers, and that is not a change to spring on somebody.
  assert.equal(props["hiveyCode.routing.learned"]?.default, false);
  assert.equal(props["hiveyCode.routing.threshold"]?.default, 0.8);
  assert.equal(props["hiveyCode.routing.minAttempts"]?.default, 5);

  // The CODE, not the comments: this file explains at length that it does not read a catalogue, and a
  // negative grep over the whole thing finds that sentence. The same trap the evaluation bench's
  // structural checks hit, for the fourth time in this project.
  const code = readFileSync(join("src", "extension", "learned.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  // Exactly two candidates, both explicitly configured. Deriving a wider set from a catalogue would
  // mean sending a question to a model nobody authorised.
  assert.match(code, /add\(settings\.chat\.model, settings\.chat\.provider\);/);
  assert.match(code, /add\(settings\.escalation\.model, settings\.escalation\.provider\);/);
  assert.equal(/allModels|listModels|this\.models/.test(code), false, "the candidates come from a catalogue");
  // And a Hivey preset is left out: it is already a router, and routing a router cannot be explained
  // in one sentence.
  assert.match(code, /isHivey\(model\)/);
});

test("a turn nothing verified is recorded as neither a success nor a failure", () => {
  // Otherwise a model with a perfect record turns out to have answered twenty questions nobody
  // checked.
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  // The set is the router's own now, imported rather than copied: `VERIFIED_TOOLS` in this file was
  // a second copy of `VERIFIERS` from `core/router/outcome.ts` — the same five names, in two files,
  // with nothing keeping them in step. Adding a verifier to the router would silently have stopped
  // this measurement counting it. The guarantee asserted here is unchanged.
  assert.match(chat, /const verified = steps\.some\(\(x\) => VERIFIER_TOOLS\.has\(x\.tool\)\);/);
  assert.match(chat, /if \(verified && !ctl\.signal\.aborted\) \{/);
});

test("a hand-over is never re-routed by what was learned", () => {
  // It exists because a model already failed, and the learned router's opinion of that model is the
  // opinion that just lost.
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  const at = chat.indexOf("const choice = this.learnedRouting?.decide(");
  assert.ok(at > 0);
  assert.match(chat.slice(at - 200, at), /if \(!handover\) \{/);
});

test("the panel is told the real counts, not that a router decided", () => {
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  assert.match(chat, /t\("Chose \{0\}: \{1\}", choice\.model, choice\.why\)/);
  assert.match(chat, /t\("Trying \{0\}: \{1\}", choice\.model, choice\.why\)/);
});
