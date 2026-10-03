// A policy the IT department signs, and that the user cannot loosen.
//
// Every test here is an answer to a question a security review asks. "What stops a developer
// turning the redaction off?" "What happens if they delete the policy file?" "What if they edit it?"
// "What if the organisation's policy is wrong — can it make things worse?"

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  SAFEST,
  allowedEndpoint,
  applyPolicy,
  featureDisabled,
  verifyPolicy,
  type ManagedPolicy,
  type Restrictable,
  policyDirectoryFor,
} from "../src/core/policy/policy.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const keys = generateKeyPairSync("ed25519");
const PUBLIC = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const OTHER = generateKeyPairSync("ed25519");

/** An envelope, signed the way the administrator's tooling would sign one. */
function envelopeFor(policy: unknown, key = keys.privateKey): string {
  const bytes = Buffer.from(JSON.stringify(policy), "utf8");
  return JSON.stringify({
    policy: bytes.toString("base64"),
    signature: sign(null, bytes, key).toString("base64"),
  });
}

const POLICY: ManagedPolicy = {
  version: 1,
  organisation: "Crédit Foncier",
  providers: ["local", "openai-compatible"],
  escalation: "ask",
  redaction: "strict",
  allowUnredacted: false,
  blockedGlobs: ["**/clients/**"],
  deniedCommands: ["curl", "scp"],
  autoApprove: "off",
  writableLibraries: ["TSTCFC", "DEVCFC"],
  budget: { perRequestUsd: 0.5, dailyUsd: 5 },
  disabled: ["completion"],
};

// ── Verifying ────────────────────────────────────────────────────────────────────────────────────

test("a signed policy is accepted", () => {
  const state = verifyPolicy({ envelope: envelopeFor(POLICY), publicKey: PUBLIC });
  assert.equal(state.kind, "managed");
  assert.equal(state.kind === "managed" ? state.policy.organisation : "", "Crédit Foncier");
});

test("a policy altered after signing is refused, and the refusal says which of the two happened", () => {
  const signed = JSON.parse(envelopeFor(POLICY)) as { policy: string; signature: string };
  // One byte of the document changed: the budget raised.
  const tampered = { ...POLICY, budget: { perRequestUsd: 50, dailyUsd: 500 } };
  signed.policy = Buffer.from(JSON.stringify(tampered)).toString("base64");
  const state = verifyPolicy({ envelope: JSON.stringify(signed), publicKey: PUBLIC });
  assert.equal(state.kind, "refused");
  assert.match(state.kind === "refused" ? state.why : "", /changed after it was signed/);
  // And the settings in force are the safest ones, NOT the tampered policy.
  assert.deepEqual(state.kind === "refused" ? state.policy : undefined, SAFEST);
});

test("a policy signed by somebody else is refused", () => {
  const state = verifyPolicy({ envelope: envelopeFor(POLICY, OTHER.privateKey), publicKey: PUBLIC });
  assert.equal(state.kind, "refused");
  assert.match(state.kind === "refused" ? state.why : "", /signed by somebody else/);
});

test("no policy and no key at all means this machine is simply not managed", () => {
  assert.deepEqual(verifyPolicy({}), { kind: "none" });
  assert.deepEqual(verifyPolicy({ envelope: "   ", publicKey: "" }), { kind: "none" });
});

test("a pinned key with the policy DELETED is refused, not unmanaged", () => {
  // The attack this closes: escaping the policy by removing one file. An administrator pinned a
  // key, so this machine is meant to be managed.
  const state = verifyPolicy({ publicKey: PUBLIC });
  assert.equal(state.kind, "refused");
  assert.match(state.kind === "refused" ? state.why : "", /meant to be managed/);
});

test("a policy with no key to verify it against is refused", () => {
  const state = verifyPolicy({ envelope: envelopeFor(POLICY) });
  assert.equal(state.kind, "refused");
  assert.match(state.kind === "refused" ? state.why : "", /anybody could have written/);
});

test("an unreadable file, a wrong shape and an empty document are each refused", () => {
  assert.equal(verifyPolicy({ envelope: "{not json", publicKey: PUBLIC }).kind, "refused");
  assert.match(
    (verifyPolicy({ envelope: '{"hello":1}', publicKey: PUBLIC }) as { why: string }).why,
    /no "policy" and "signature" pair/,
  );
  assert.match(
    (verifyPolicy({ envelope: '{"policy":"","signature":"x"}', publicKey: PUBLIC }) as { why: string }).why,
    /empty/,
  );
});

test("a version this build does not understand is refused rather than half applied", () => {
  // A future policy may restrict something this build does not implement. Applying the half we
  // recognise would be reporting a compliance we do not have.
  const state = verifyPolicy({ envelope: envelopeFor({ ...POLICY, version: 2 }), publicKey: PUBLIC });
  assert.equal(state.kind, "refused");
  assert.match(state.kind === "refused" ? state.why : "", /understands version 1/);
  assert.match(state.kind === "refused" ? state.why : "", /compliance it cannot deliver/);
});

test("the signature covers the bytes that get parsed, so key order cannot matter", () => {
  // Signing a JSON OBJECT means agreeing on a canonical serialization, and every scheme that tried
  // has had a bug where two different documents canonicalize the same. Here the bytes are signed,
  // so two orderings of the same policy are two different documents and both verify.
  const a = envelopeFor({ version: 1, organisation: "A", escalation: "never" });
  const b = envelopeFor({ escalation: "never", organisation: "A", version: 1 });
  assert.equal(verifyPolicy({ envelope: a, publicKey: PUBLIC }).kind, "managed");
  assert.equal(verifyPolicy({ envelope: b, publicKey: PUBLIC }).kind, "managed");
});

// ── Applying it: only ever narrower ──────────────────────────────────────────────────────────────

const permissive: Restrictable = {
  provider: "anthropic",
  endpoint: "https://api.anthropic.com/v1",
  escalation: "auto",
  redaction: "off",
  allowUnredacted: true,
  blockedGlobs: ["**/.env*"],
  deniedCommands: [],
  deniedPaths: [],
  autoApprove: "all",
  writableLibraries: [],
  budget: { perRequestUsd: 10, dailyUsd: 100 },
};

test("a permissive user setting is ignored, one field at a time", () => {
  const { settings, managed } = applyPolicy(permissive, verifyPolicy({ envelope: envelopeFor(POLICY), publicKey: PUBLIC }));
  assert.equal(settings.provider, "local", "a forbidden provider falls back to the local one, not to the first allowed");
  assert.equal(settings.escalation, "ask");
  assert.equal(settings.redaction, "strict");
  assert.equal(settings.allowUnredacted, false);
  assert.equal(settings.autoApprove, "off");
  assert.equal(settings.budget.perRequestUsd, 0.5);
  assert.equal(settings.budget.dailyUsd, 5);
  // And every one of them is reported, so the interface can say who decided it.
  for (const key of ["chat.provider", "escalation.policy", "privacy.redaction", "permissions.autoApprove", "budget.dailyUsd"]) {
    assert.ok(managed.includes(key), `${key} was changed without being reported`);
  }
});

test("the lists are added to, never replaced", () => {
  const { settings } = applyPolicy(permissive, verifyPolicy({ envelope: envelopeFor(POLICY), publicKey: PUBLIC }));
  // The user's own blocked glob survives: a policy restricts, so it cannot remove a restriction.
  assert.ok(settings.blockedGlobs.includes("**/.env*"));
  assert.ok(settings.blockedGlobs.includes("**/clients/**"));
  assert.deepEqual(settings.deniedCommands, ["curl", "scp"]);
});

test("a user who is STRICTER than the policy is left alone", () => {
  // A developer who wants more redaction than their organisation requires is not a problem to be
  // solved.
  const strict: Restrictable = {
    ...permissive,
    provider: "local",
    escalation: "never",
    redaction: "strict",
    allowUnredacted: false,
    autoApprove: "off",
    budget: { perRequestUsd: 0.01, dailyUsd: 0.5 },
  };
  const { settings, managed } = applyPolicy(strict, verifyPolicy({ envelope: envelopeFor(POLICY), publicKey: PUBLIC }));
  assert.equal(settings.budget.dailyUsd, 0.5, "the policy's ceiling must not raise a lower user figure");
  assert.equal(settings.escalation, "never");
  assert.equal(managed.includes("budget.dailyUsd"), false);
  assert.equal(managed.includes("escalation.policy"), false);
});

test("an empty writable-libraries list is the most permissive state, so the policy's list stands", () => {
  // The IBM i gate is OFF when the list is empty. Reading that as "the user agrees" would be a way
  // past the policy with no setting to point at.
  const { settings } = applyPolicy(permissive, verifyPolicy({ envelope: envelopeFor(POLICY), publicKey: PUBLIC }));
  assert.deepEqual(settings.writableLibraries, ["TSTCFC", "DEVCFC"]);
  // And a user list is narrowed to the intersection, never widened.
  const wide = applyPolicy({ ...permissive, writableLibraries: ["TSTCFC", "PRODCFC"] }, verifyPolicy({ envelope: envelopeFor(POLICY), publicKey: PUBLIC }));
  assert.deepEqual(wide.settings.writableLibraries, ["TSTCFC"]);
});

test("a field the policy says nothing about is left exactly as the user set it", () => {
  // Otherwise a policy that only wanted to cap the budget would silently forbid every provider.
  const only = verifyPolicy({ envelope: envelopeFor({ version: 1, budget: { dailyUsd: 2 } }), publicKey: PUBLIC });
  const { settings, managed } = applyPolicy(permissive, only);
  assert.equal(settings.provider, "anthropic");
  assert.equal(settings.redaction, "off");
  assert.equal(settings.autoApprove, "all");
  assert.deepEqual(managed, ["budget.dailyUsd"]);
});

test("an unmanaged machine is not restricted at all", () => {
  const { settings, managed } = applyPolicy(permissive, { kind: "none" });
  assert.deepEqual(settings, permissive);
  assert.deepEqual(managed, []);
});

test("a refused policy puts the safest settings in force", () => {
  const { settings } = applyPolicy(permissive, verifyPolicy({ publicKey: PUBLIC }));
  assert.equal(settings.provider, "local");
  assert.equal(settings.redaction, "strict");
  assert.equal(settings.escalation, "never");
  assert.equal(settings.autoApprove, "off");
  // And the features are NOT disabled: a refusal must not look like a broken installation.
  assert.equal(featureDisabled(verifyPolicy({ publicKey: PUBLIC }), "completion"), false);
});

test("a disabled feature is off, and only when the organisation said so", () => {
  const managed = verifyPolicy({ envelope: envelopeFor(POLICY), publicKey: PUBLIC });
  assert.equal(featureDisabled(managed, "completion"), true);
  assert.equal(featureDisabled(managed, "knowledge"), false);
  assert.equal(featureDisabled({ kind: "none" }, "completion"), false);
});

test("an unknown value in a setting cannot be a way past a ceiling", () => {
  // A typo, or a value from a newer build. It is ranked as the most permissive, so the ceiling bites.
  const { settings } = applyPolicy(
    { ...permissive, escalation: "whatever" as never, autoApprove: "everything" as never },
    verifyPolicy({ envelope: envelopeFor(POLICY), publicKey: PUBLIC }),
  );
  assert.equal(settings.escalation, "ask");
  assert.equal(settings.autoApprove, "off");
});

// ── Endpoints, matched on the origin ─────────────────────────────────────────────────────────────

test("an allowed endpoint is matched on its origin, not as a string prefix", () => {
  const allowed = ["https://gateway.example.com", "http://127.0.0.1:11434/v1"];
  assert.equal(allowedEndpoint("https://gateway.example.com/v1", allowed), true);
  assert.equal(allowedEndpoint("http://127.0.0.1:11434/v1/chat", allowed), true);
  // THE case a startsWith would get wrong.
  assert.equal(allowedEndpoint("https://gateway.example.com.attacker.test/v1", allowed), false);
  assert.equal(allowedEndpoint("https://gateway.example.com:8443/v1", allowed), false, "another port is another origin");
  assert.equal(allowedEndpoint("http://gateway.example.com/v1", allowed), false, "http is not https");
  assert.equal(allowedEndpoint("", allowed), false);
  assert.equal(allowedEndpoint("not a url", allowed), false);
});

test("an allowed entry carrying a path bounds the path too", () => {
  const allowed = ["https://gateway.example.com/openai"];
  assert.equal(allowedEndpoint("https://gateway.example.com/openai/v1", allowed), true);
  assert.equal(allowedEndpoint("https://gateway.example.com/anthropic/v1", allowed), false);
});

test("a forbidden endpoint is emptied rather than left pointing somewhere", () => {
  const policy = verifyPolicy({ envelope: envelopeFor({ version: 1, endpoints: ["https://gateway.example.com"] }), publicKey: PUBLIC });
  const { settings, managed } = applyPolicy(permissive, policy);
  assert.equal(settings.endpoint, "");
  assert.ok(managed.includes("endpoints"));
});

// ── Where it is read from, which is the whole trust model ────────────────────────────────────────

/**
 * A source file with its comments removed.
 *
 * The same lesson the evaluation bench learned: a negative grep over a whole file rejects the file
 * for EXPLAINING itself. `src/extension/policy.ts` opens by saying, at length, that it never reads
 * from `.hiveycode` — and a test looking for that word found it in the sentence promising the
 * opposite.
 */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

test("the policy is never read from the workspace", () => {
  // THE test of this chantier. A policy that arrived with a `git clone` would be a policy written
  // by whoever sent the repository, and "your organisation requires this" would mean "a stranger's
  // branch requires this". So the loader's CODE is read and checked for any sign of it reaching
  // into the workspace.
  const source = codeOnly(join("src", "extension", "policy.ts"));
  for (const forbidden of ["workspaceFolders", "workspaceFile", ".hiveycode", ".vscode", "asRelativePath", "findFiles"]) {
    assert.equal(source.includes(forbidden), false, `the policy loader reaches for ${forbidden}`);
  }
  // And the directories it does use are the machine locations core decides.
  assert.match(source, /policyDirectoryFor\(process\.platform, process\.env\)/);
  const core = readFileSync(join("src", "core", "policy", "policy.ts"), "utf8");
  assert.match(core, /\/etc\/hivey-code/);
  assert.match(core, /ProgramData/);
  assert.match(core, /Library\/Application Support/);
  // The core module cannot reach a workspace even in principle: it does not import `vscode`.
  assert.equal(/from "vscode"/.test(core), false);
});

test("every platform gets an absolute machine location, and the environment variable wins", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    const dir = policyDirectoryFor(platform, {});
    assert.ok(dir.startsWith("/") || /^[A-Za-z]:/.test(dir), `${platform}: not an absolute path: ${dir}`);
    // Nothing relative, which would resolve against whatever the editor's working directory is —
    // and on a developer's machine that is the workspace.
    assert.equal(dir.startsWith("."), false, platform);
  }
  assert.equal(policyDirectoryFor("linux", { HIVEY_CODE_POLICY_DIR: "/opt/managed/hivey" }), "/opt/managed/hivey");
  // A blank variable is not a directory.
  assert.equal(policyDirectoryFor("linux", { HIVEY_CODE_POLICY_DIR: "   " }), "/etc/hivey-code");
  // And Windows follows ProgramData wherever the machine puts it.
  assert.equal(policyDirectoryFor("win32", { ProgramData: "D:\\Data\\" }), "D:\\Data\\HiveyCode");
});

test("the settings are narrowed in readSettings itself, not at each point of use", () => {
  // One choke point. Checking the policy where each feature happens to read a setting is the
  // version of this that has a hole in it the first time somebody adds a feature.
  const config = readFileSync(join("src", "extension", "config.ts"), "utf8");
  assert.match(config, /export function readSettings\([^)]*\): Settings \{\s*\n\s*return restrict\(readSettingsRaw\(scope\)\);/);
  assert.match(config, /function restrict\(raw: Settings\): Settings \{/);
  // And the raw reader is private: a caller that wanted the unrestricted settings could not get them.
  assert.equal(/export function readSettingsRaw/.test(config), false, "the unrestricted settings are exported");
});
