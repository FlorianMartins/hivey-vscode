// A background agent, and the two boundaries that make one defensible.
//
// This is the feature with the worst failure mode in the product: an agent somebody is watching runs
// a command and they see it, and an agent running while its author is in a meeting runs whatever it
// wrote a moment ago with nobody there. So the tests here are almost entirely about refusals.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIMITS,
  NO_ENGINE,
  describeSandbox,
  mayRunInBackground,
  pickEngine,
  sandboxArgv,
} from "../src/core/background/sandbox.js";
import {
  ALLOWED_GIT,
  branchName,
  createWorktreeArgv,
  diffArgv,
  gitAllowed,
  patchArgv,
  removeWorktreeArgv,
} from "../src/core/background/worktree.js";

// ── No engine, no commands ───────────────────────────────────────────────────────────────────────

test("without a container engine, a command is REFUSED rather than run on the host", () => {
  // THE decision of this chantier. A background agent that can run anything on the host is a
  // background agent nobody should start.
  const verdict = mayRunInBackground({ engine: undefined, image: "node:20" });
  assert.equal(verdict.allow, false);
  assert.equal(verdict.why, NO_ENGINE);
  // And the refusal names the consequence, the reason and the two ways out — "refused" with no next
  // step is how somebody ends up running it by hand on the host.
  assert.match(NO_ENGINE, /nowhere safe to run a command/);
  assert.match(NO_ENGINE, /while nobody is watching/);
  assert.match(NO_ENGINE, /Install Docker or Podman/);
  assert.match(NO_ENGINE, /run this task in the foreground/);
});

test("without a configured image, nothing is guessed", () => {
  const verdict = mayRunInBackground({ engine: "docker", image: "  " });
  assert.equal(verdict.allow, false);
  assert.match(verdict.why ?? "", /will not guess one/);
  // Because guessing wrong produces "command not found", which reads as a broken feature.
  assert.match(verdict.why ?? "", /command not found/);
  assert.equal(DEFAULT_LIMITS.image, "", "shipping an image would be guessing for everybody");
});

test("an engine and an image is the only combination that runs anything", () => {
  assert.deepEqual(mayRunInBackground({ engine: "docker", image: "node:20" }), { allow: true });
  assert.equal(pickEngine({ docker: true, podman: true }), "docker");
  assert.equal(pickEngine({ docker: false, podman: true }), "podman");
  assert.equal(pickEngine({ docker: false, podman: false }), undefined);
});

// ── The container is drawn tight ─────────────────────────────────────────────────────────────────

const REQUEST = {
  engine: "docker" as const,
  worktree: "/tmp/hivey-task-1",
  command: "npm test",
  limits: { ...DEFAULT_LIMITS, image: "node:20" },
};

test("no network, quotas, and only the worktree mounted", () => {
  const argv = sandboxArgv(REQUEST);
  const joined = argv.join(" ");
  assert.match(joined, /--network none/, "a background agent has no business reaching anything");
  assert.match(joined, /--cpus=2/);
  assert.match(joined, /--memory=2g/);
  assert.match(joined, /--volume \/tmp\/hivey-task-1:\/work/);
  assert.match(joined, /--workdir \/work/);
  assert.match(joined, /--security-opt no-new-privileges/);
  assert.equal(argv.includes("--rm"), true, "a container per command, left behind by none of them");
  // Exactly one mount: the mount IS the sandbox.
  assert.equal(argv.filter((a) => a === "--volume").length, 1);
});

test("the command is one argument, so nothing in it can add an argument to docker run", () => {
  // Building this as a shell string is how `; --privileged` in a command becomes a privileged
  // container.
  const nasty = 'echo hi" --privileged -v /:/host "';
  const argv = sandboxArgv({ ...REQUEST, command: nasty });
  assert.equal(argv[argv.length - 1], nasty, "the command must arrive whole, as one argument");
  assert.equal(argv[argv.length - 2], "-c");
  assert.equal(argv[argv.length - 3], "sh");
  // And nothing it contains has become an option of the engine.
  assert.equal(argv.filter((a) => a === "--privileged").length, 0);
  assert.equal(argv.filter((a) => a === "--volume").length, 1);
  // The image is still the one configured, not something the command chose.
  assert.equal(argv[argv.indexOf("sh") - 1], "node:20");
});

test("the result says where the command ran", () => {
  const text = describeSandbox(REQUEST);
  assert.match(text, /docker container: no network/);
  assert.match(text, /only \/tmp\/hivey-task-1 mounted/);
});

// ── A worktree of its own ────────────────────────────────────────────────────────────────────────

test("the branch is named after the task, prefixed, and dated", () => {
  // Somebody coming back to nine of these needs to tell theirs from the agent's.
  const name = branchName("Corriger l'arrondi des avoirs", new Date(2026, 9, 3, 14, 5));
  assert.equal(name, "hivey/corriger-l-arrondi-des-avoirs-20261003-1405");
  assert.match(branchName("", new Date(2026, 9, 3, 14, 5)), /^hivey\/task-/);
  // A long task does not produce a 300-character branch name, and does not end in a dash.
  const long = branchName("a".repeat(200));
  assert.ok(long.length < 70, long);
  assert.equal(/-\d{8}-\d{4}$/.test(long), true, long);
});

test("the worktree is created on a NAMED branch from the current HEAD", () => {
  const argv = createWorktreeArgv("/tmp/wt", "hivey/x");
  assert.deepEqual(argv, ["worktree", "add", "-b", "hivey/x", "/tmp/wt", "HEAD"]);
  // A detached head is work somebody has to rescue, and fetching is a network operation a background
  // task has no business performing.
  assert.equal(argv.includes("--detach"), false);
  assert.equal(argv.some((a) => a.includes("origin")), false);
});

test("the agent never pushes, and that is enforced by an allow-list", () => {
  // Not "is discouraged from pushing": a background agent that pushes is one that put code on a
  // server while its author was at lunch.
  assert.equal(ALLOWED_GIT.has("push"), false);
  assert.equal(gitAllowed(["push", "origin", "hivey/x"]), false);
  assert.equal(gitAllowed(["worktree", "add"]), true);
  assert.equal(gitAllowed(["diff"]), true);
  for (const forbidden of ["push", "remote", "fetch", "pull", "clone", "submodule"]) {
    assert.equal(gitAllowed([forbidden]), false, `${forbidden} is reachable`);
  }
  // And the module itself contains no push, in code or in an argument list.
  const code = readFileSync(join("src", "core", "background", "worktree.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.equal(/"push"/.test(code), false, "a push appears in the code");
});

test("the diff is against the branch point, which is what a reader wants", () => {
  assert.deepEqual(diffArgv(), ["diff", "HEAD", "--stat"]);
  assert.deepEqual(patchArgv(), ["diff", "HEAD"]);
  assert.deepEqual(removeWorktreeArgv("/tmp/wt"), ["worktree", "remove", "--force", "/tmp/wt"]);
});

// ── Against the real engine ──────────────────────────────────────────────────────────────────────

test("the container really has no network, and really sees only the worktree", (t) => {
  // The argv is checked above; this checks that what it describes is what happens. If docker is
  // missing the test FAILS rather than skipping: the claim "a background command cannot reach the
  // network" is the one thing here nobody should take on trust.
  const engine = "docker";
  let daemonOs: string;
  try {
    daemonOs = execFileSync("docker", ["version", "--format", "{{.Server.Os}}"], { encoding: "utf8", stdio: "pipe" }).trim();
  } catch (err) {
    throw new Error(
      `this test checks the sandbox against a real container engine and could not reach one: ${(err as Error).message}`,
    );
  }

  // ⚠️ "Docker answers" and "Docker can run this sandbox" are two different facts, and conflating
  // them kept CI red for weeks. The Windows runner has a daemon — it is in Windows-container mode,
  // so `alpine:latest` has no matching manifest and the run dies on `no matching manifest for
  // windows(10.0.26100)/amd64`. That is not the sandbox failing; it is this machine being unable to
  // say anything about it. The guarantee is still enforced without mercy on every Linux daemon,
  // which is every ubuntu job and every developer machine. Skipping here is the third answer —
  // "cannot tell" — and it is named rather than dressed up as a pass.
  if (daemonOs !== "linux") {
    t.skip(`the docker daemon runs ${daemonOs} containers, so the Linux sandbox cannot be exercised here`);
    return;
  }

  const worktree = mkdtempSync(join(tmpdir(), "hivey-sandbox-"));
  writeFileSync(join(worktree, "inside.txt"), "the worktree", "utf8");
  const outside = mkdtempSync(join(tmpdir(), "hivey-outside-"));
  writeFileSync(join(outside, "secret.txt"), "not the worktree", "utf8");
  const run = (command: string) =>
    execFileSync(engine, sandboxArgv({ engine: "docker", worktree, command, limits: { ...DEFAULT_LIMITS, image: "alpine:latest" } }), {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

  try {
    // The worktree is there, and it is the working directory.
    assert.match(run("cat inside.txt"), /the worktree/);
    // Nothing else on the host is.
    assert.match(run(`ls ${outside} 2>&1 || echo NOT-THERE`), /NOT-THERE/, "a path outside the worktree was readable");
    // And there is no network: no interface beyond loopback, and no name resolution.
    assert.equal(/eth0/.test(run("ip addr 2>/dev/null || true")), false, "the container has a network interface");
    assert.match(run("getent hosts example.com >/dev/null 2>&1 && echo RESOLVED || echo NO-DNS"), /NO-DNS/);
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// ── What the background tool set can and cannot see ──────────────────────────────────────────────

test("the background tools are their own set, rooted in the worktree", () => {
  // Not the editor's tools: those are rooted in the editor's workspace, so an agent holding them
  // could edit the file its author has open, in the middle of their own edit.
  const code = readFileSync(join("src", "extension", "background.ts"), "utf8");
  assert.match(code, /function backgroundTools\(worktree: string/);
  assert.match(code, /underRoot\(/, "paths are not put through the containment rule");
  assert.match(code, /is outside this task's worktree, which is all it can see/);
  // And the set is deliberately small: no diagnostics (no editor), no plan (nobody watching), no
  // IBM i (a partition is shared, and a background agent reaching one is the opposite of isolated).
  for (const absent of ["get_diagnostics", "update_plan", "ibmi_"]) {
    assert.equal(code.includes(`name: "${absent}`), false, `${absent} is reachable from a background task`);
  }
  assert.match(code, /return \[read, list, write, edit, command\];/);
});

test("there is no git tool at all, and no push anywhere in the file", () => {
  const code = readFileSync(join("src", "extension", "background.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.equal(/"push"/.test(code), false);
  assert.equal(/git_commit|git_push|name: "git/.test(code), false, "a git tool is reachable from a background task");
  // git IS invoked, but only for the worktree and the diff — and `branch -D` when the author asks to
  // discard. Those are the author's gestures, not the agent's.
  assert.match(code, /createWorktreeArgv|patchArgv|removeWorktreeArgv/);
});

test("the absence of an engine is said BEFORE the task starts", () => {
  // Somebody who learns this twenty minutes in has lost twenty minutes.
  const code = readFileSync(join("src", "extension", "background.ts"), "utf8");
  const atStart = code.indexOf("const engine = await engineAvailable();");
  const atRun = code.indexOf("const created = await run(\"git\", createWorktreeArgv");
  assert.ok(atStart > 0 && atStart < atRun, "the engine is checked after the work has begun");
  assert.match(code, /will not be able to run any command/);
});

test("the task's verdict comes from verifyTurn, not from whether it crashed", () => {
  // An agent that wrote a file, ran the tests, saw them fail and stopped has "finished" and has not
  // succeeded. The author needs to know which before they read the diff.
  const code = readFileSync(join("src", "extension", "background.ts"), "utf8");
  assert.match(code, /const verdict = verifyTurn\(steps\);/);
  assert.match(code, /entry\.state = ctl\.signal\.aborted \? "cancelled" : verdict\.kind === "none" \? "done" : "failed";/);
});
