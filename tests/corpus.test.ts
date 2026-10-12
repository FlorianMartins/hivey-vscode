// What this machine learned, kept on this machine.
//
// An episode holds source code: the request, the files it touched, the diff. That is a reasonable
// thing to keep and an unreasonable thing to start keeping without being asked — so most of these
// tests are about what is NOT kept and what is said about it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPORT_NOTE,
  redactEpisode,
  toConversations,
  toEvalTask,
  toJsonl,
  trim,
  type Episode,
} from "../src/core/corpus/corpus.js";
import { matchGlob } from "../src/core/util/glob.js";

function episode(over: Partial<Episode> = {}): Episode {
  return {
    at: Date.UTC(2026, 9, 3, 10, 0, 0),
    request: "Les avoirs sont arrondis dans le mauvais sens",
    files: [{ path: "src/total.js", before: "export const total = (x) => Math.round(x);\n" }],
    local: { model: "qwen2.5-coder:7b", diff: "--- a/src/total.js\n+++ b/src/total.js\n", error: "1 failing test" },
    final: { model: "anthropic/claude-sonnet-4", diff: "--- a/src/total.js\n+++ b/src/total.js\n+ half away from zero\n" },
    check: "node --test",
    omitted: 0,
    ...over,
  };
}

// ── What is not kept ─────────────────────────────────────────────────────────────────────────────

test("a file the privacy list forbids is never recorded, and the omission is counted", () => {
  // A file nobody is willing to send to a model is a file nobody wants in a training corpus either.
  const { episode: kept, empty } = redactEpisode(
    episode({
      files: [
        { path: "src/total.js", before: "ok" },
        { path: ".env", before: "SECRET=1" },
        { path: "config/secrets/db.yml", before: "password: x" },
      ],
    }),
    ["**/.env*", "**/secrets/**"],
    matchGlob,
  );
  assert.deepEqual(kept.files.map((f) => f.path), ["src/total.js"]);
  assert.equal(kept.omitted, 2, "a thin episode has to be explainable");
  assert.equal(empty, false);
});

test("an episode whose every file was blocked is reported as empty, not stored", () => {
  // A fixture with no files is a fixture nobody can run.
  const { empty } = redactEpisode(episode({ files: [{ path: ".env", before: "x" }] }), ["**/.env*"], matchGlob);
  assert.equal(empty, true);
});

test("retention and the ceiling answer different questions, and both bite", () => {
  const now = Date.UTC(2026, 9, 3, 12, 0, 0);
  const old = episode({ at: now - 100 * 86_400_000 });
  const recent = episode({ at: now - 1000 });
  // The retention is a promise about time.
  assert.deepEqual(trim([old, recent], 90, 100, now), [recent]);
  // The ceiling is a promise about disk, newest first.
  const many = Array.from({ length: 10 }, (_, i) => episode({ at: now - i * 1000 }));
  assert.equal(trim(many, 90, 3, now).length, 3);
  assert.equal(trim(many, 90, 3, now)[0]?.at, now, "the newest is kept");
});

test("a retention of zero keeps nothing, which is how somebody stops without purging", () => {
  const now = Date.UTC(2026, 9, 3, 12, 0, 0);
  assert.deepEqual(trim([episode({ at: now })], 0, 100, now), []);
});

// ── Export one: an evaluation task ───────────────────────────────────────────────────────────────

test("the fixture is the BEFORE state, which is what makes the check fail on it", () => {
  const task = toEvalTask(episode(), 1);
  assert.equal(task.files["src/total.js"], "export const total = (x) => Math.round(x);\n");
  // NOT the fixed version: a fixture that already passes measures nothing, which is the bench's
  // first rule.
  assert.equal(task.files["src/total.js"]?.includes("half away from zero"), false);
  const meta = JSON.parse(task.taskJson) as { prompt: string; check: string; title: string };
  assert.equal(meta.check, "node --test");
  assert.equal(meta.prompt, "Les avoirs sont arrondis dans le mauvais sens");
  assert.match(task.id, /^learned-les-avoirs-sont-arrondis-dans-le-mau-1$/, task.id);
});

test("an episode with no recorded check produces a task that fails loudly rather than silently", () => {
  // A task whose check is empty would pass on anything, which is the one thing a task must not do.
  const meta = JSON.parse(toEvalTask(episode({ check: "" }), 2).taskJson) as { check: string };
  assert.match(meta.check, /exit 1/);
  assert.match(meta.check, /no check was recorded/);
});

test("no reference solution is written from the final diff", () => {
  // A patch applied by hand to a fixture directory may not apply at all, and a task whose solution
  // does not apply is worse than one with none: `eval:solutions` then reports the CHECK as
  // unsatisfiable and somebody goes looking for a bug in the check.
  const task = toEvalTask(episode(), 1);
  assert.equal(Object.keys(task.files).some((p) => p.startsWith("solution")), false);
  assert.match(EXPORT_NOTE, /will report them as unsatisfiable/);
  assert.match(EXPORT_NOTE, /until somebody adds a reference solution by hand/);
});

test("the note says what the folder holds before anything is written", () => {
  assert.match(EXPORT_NOTE, /hold source code from this workspace/);
  assert.match(EXPORT_NOTE, /Nothing here has left this machine/);
  assert.match(EXPORT_NOTE, /a corpus is a copy/);
  // And it does not claim the tasks were verified by being written.
  assert.match(EXPORT_NOTE, /That is not proven by writing them/);
});

// ── Export two: a conversation set ───────────────────────────────────────────────────────────────

test("the answer that WORKED is the assistant turn; the failed attempt is context", () => {
  // THE decision. Training on a wrong answer labelled as the conversation's answer is how a model
  // learns the wrong thing.
  const [conversation] = toConversations([episode()], "You are a coding assistant.");
  assert.equal(conversation?.messages.length, 3);
  assert.equal(conversation?.messages[0]?.role, "system");
  assert.equal(conversation?.messages[2]?.role, "assistant");
  assert.match(conversation?.messages[2]?.content ?? "", /half away from zero/);
  // The failed attempt appears in the user turn, which is what actually happened.
  assert.match(conversation?.messages[1]?.content ?? "", /A first attempt produced this change/);
  assert.match(conversation?.messages[1]?.content ?? "", /1 failing test/);
  assert.equal(conversation?.messages.filter((m) => m.role === "assistant").length, 1);
});

test("the files as they were ride along in the user turn", () => {
  const [conversation] = toConversations([episode()], "sys");
  assert.match(conversation?.messages[1]?.content ?? "", /--- src\/total\.js/);
  assert.match(conversation?.messages[1]?.content ?? "", /Math\.round/);
});

test("an episode with no failed attempt produces a clean conversation", () => {
  const [conversation] = toConversations([episode({ local: { model: "m", diff: "", error: "" } })], "sys");
  assert.equal(/A first attempt/.test(conversation?.messages[1]?.content ?? ""), false);
  assert.equal(/What the check said/.test(conversation?.messages[1]?.content ?? ""), false);
});

test("JSONL is one conversation per line, and empty when there is nothing", () => {
  const text = toJsonl(toConversations([episode(), episode()], "sys"));
  assert.equal(text.split("\n").filter(Boolean).length, 2);
  assert.equal(text.endsWith("\n"), true);
  assert.equal(toJsonl([]), "");
});

// ── Off by default, and nothing leaves ───────────────────────────────────────────────────────────

test("the corpus never reaches the network", () => {
  // The whole premise is that this is the thing a hosted service cannot collect without taking the
  // code. A single request from this module would be the feature contradicting itself.
  for (const file of [join("src", "core", "corpus", "corpus.ts"), join("src", "extension", "corpus.ts")]) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const forbidden of ["fetch(", "request(", "http", "makeProvider"]) {
      assert.equal(code.includes(forbidden), false, `${file} reaches the network via ${forbidden}`);
    }
  }
});

test("it is off by default, and the policy can only forbid it", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { configuration: Array<{ properties: Record<string, { default: unknown }> }> };
  };
  const props = Object.assign({}, ...manifest.contributes.configuration.map((b) => b.properties)) as Record<
    string,
    { default: unknown }
  >;
  assert.equal(props["hiveyCode.corpus.enabled"]?.default, false, "a corpus of source code must be asked for");
  // The policy restricts and never grants: `disabled` can turn it off, and there is no field that
  // turns it on. See ADR-0019.
  const policy = readFileSync(join("src", "core", "policy", "policy.ts"), "utf8");
  assert.equal(/corpus.*: *true/.test(policy), false, "the policy would be able to grant");
});

// ── When an episode is kept ──────────────────────────────────────────────────────────────────────

test("an episode is kept only when the verification went GREEN after the remote model", () => {
  // An episode whose final diff does not work is not a training example, it is two wrong answers.
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  // The guarantee: an episode is kept only when the verdict is clean. The verdict now also reads the
  // turn's own plan (`verifyTurn(steps, this.plan)`), so a turn that left its own steps outstanding
  // is no longer a training example either — which is a tightening of this rule, not a loosening.
  assert.match(
    chat,
    /if \(handover && this\.pendingEpisode && !ctl\.signal\.aborted && verifyTurn\(steps, this\.plan\)\.kind === "none"\)/,
  );
  // And it is held for exactly one turn: carrying it further would attach a diff nobody can
  // attribute to the question that produced it.
  assert.match(chat, /\} else if \(handover\) \{[\s\S]{0,200}this\.pendingEpisode = undefined;/);
});

test("the files are captured BEFORE the second turn, from the checkpoint", () => {
  // Afterwards the local attempt's diff is indistinguishable from the remote one's: both are on disk.
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  const captured = chat.indexOf("this.pendingEpisode = {");
  const escalated = chat.indexOf("await this.runTurn({ ...target, note });");
  assert.ok(captured > 0 && captured < escalated, "the episode is assembled after the escalation has run");
  assert.match(chat, /files: checkpoint\.map\(\(snap\) => \(\{ path: snap\.path, before: snap\.before \?\? "" \}\)\)/);
});

test("a verdict with no command records no command, rather than inventing one", () => {
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  assert.match(chat, /check: failing\?\.tool === "run_command" \? \(failing\.call \?\? ""\) : ""/);
});

test("nothing is recorded when the feature is off", () => {
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  assert.match(chat, /if \(this\.corpus\?\.enabled\(\)\) \{/);
  const corpus = readFileSync(join("src", "extension", "corpus.ts"), "utf8");
  assert.match(corpus, /if \(!this\.enabled\(\)\) return;/);
  // And the organisation can switch it off, which is a restriction and so within what a policy may do.
  assert.match(corpus, /if \(featureDisabled\(policyState\(\), "corpus"\)\) return false;/);
});

test("the corpus lives outside the repository", () => {
  // A corpus inside the workspace is a corpus that gets committed by somebody's `git add -A`.
  const corpus = readFileSync(join("src", "extension", "corpus.ts"), "utf8");
  assert.match(corpus, /globalStorageUri/);
  assert.equal(/workspaceFolders/.test(corpus), false, "the corpus reaches into the workspace");
});
