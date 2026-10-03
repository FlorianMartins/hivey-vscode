// A policy the IT department signs, and that the user cannot loosen.
//
// GitHub Copilot's enterprise pitch starts with centrally managed settings, and the reason is not
// that administrators enjoy settings: it is that a security review asks "what stops a developer
// turning the redaction off?", and "we asked them not to" is not an answer. So this is the answer,
// and it has three properties that are each load-bearing.
//
// IT ONLY RESTRICTS. A policy can forbid a provider, raise the minimum redaction, lower a budget
// ceiling, add a blocked glob. It cannot grant anything — there is no policy that turns redaction
// off, allows a provider the user has not configured, or widens the writable libraries. That
// asymmetry is what makes the file safe to deploy by script: the worst a wrong policy can do is
// make the extension less capable, never less careful.
//
// A FAILURE IS NOT AN ABSENCE. An unreadable file, a bad signature, a version this build does not
// know, a pinned key with no policy beside it — every one of those puts the extension in its
// SAFEST mode and says so, loudly. The alternative, falling back to the user's own settings, would
// mean that deleting one file is how you escape the policy.
//
// THE SIGNATURE COVERS THE BYTES THAT GET PARSED. The policy travels base64-encoded inside its
// envelope, and the signature is over the decoded bytes. That is not a flourish: signing a JSON
// OBJECT means agreeing on a canonical serialization, and every scheme that has tried has had a
// bug where two different documents canonicalize the same — key order, number formatting, unicode
// escapes. Here there is nothing to agree on. The bytes are the bytes.
//
// What this does NOT defend against, said plainly: whoever can write to the policy directory owns
// the policy, because the public key is pinned there too. That is deliberate — the directory is a
// machine location only an administrator can write — and it is why the policy is never read from
// the workspace. A policy that arrived with a `git clone` would be a policy written by whoever sent
// the repository.

import { createPublicKey, verify as verifySignature } from "node:crypto";

/** The most permissive escalation a policy may allow. */
/** The repository's own vocabulary (`core/router/route.ts`), not a second one. */
export type EscalationCeiling = "never" | "ask" | "auto";
export type RedactionFloor = "strict" | "balanced";
export type ApprovalCeiling = "off" | "workspace" | "all";

/**
 * What an administrator may decide.
 *
 * Every field is optional, and an absent field means "the organisation has no opinion", not "the
 * most restrictive value" — otherwise a policy that only wanted to cap the budget would silently
 * also forbid every provider.
 */
export interface ManagedPolicy {
  /** The format. An unknown version is REFUSED, never ignored: see `verifyPolicy`. */
  version: 1;
  /** Shown in the interface as who manages this machine. */
  organisation?: string;
  /** ISO date, for the sovereignty report. */
  issued?: string;
  /** Provider ids the agent may use. Anything else falls back to the local one. */
  providers?: string[];
  /** Base URLs that may be reached, matched as a prefix on the origin. */
  endpoints?: string[];
  /** The most escalation allowed. */
  escalation?: EscalationCeiling;
  /** The LEAST redaction allowed for anything leaving the machine. */
  redaction?: RedactionFloor;
  /** When false, the user's "send this unredacted" switch does nothing. */
  allowUnredacted?: boolean;
  /** Added to whatever the user blocked — never replacing it. */
  blockedGlobs?: string[];
  /** Added to whatever the user denied. */
  deniedCommands?: string[];
  /** Added to whatever the user denied. */
  deniedPaths?: string[];
  /** The most auto-approval allowed. */
  autoApprove?: ApprovalCeiling;
  /** IBM i libraries the agent may change. The user can narrow this, never widen it. */
  writableLibraries?: string[];
  /** Ceilings. A user figure above one of these is clamped to it. */
  budget?: { perRequestUsd?: number; dailyUsd?: number };
  /** MCP servers allowed, by fingerprint of their command and tool definitions. */
  mcp?: Array<{ name: string; fingerprint: string }>;
  /** Hook commands allowed, by fingerprint. An empty array forbids hooks entirely. */
  hooks?: string[];
  /** Features switched off outright: `completion`, `knowledge`, `mcp`, `hooks`, `background`. */
  disabled?: string[];
}

/** The envelope on disk. */
export interface PolicyEnvelope {
  /** The policy document, base64. The signature is over these bytes once decoded. */
  policy: string;
  /** Ed25519, base64. */
  signature: string;
}

export type PolicyState =
  /** No policy and no pinned key: this machine is not managed, and the user's settings stand. */
  | { kind: "none" }
  | { kind: "managed"; policy: ManagedPolicy }
  /**
   * Something is wrong, so the extension is in its safest mode and must say so.
   *
   * `policy` is the safest policy rather than the one on disk: a refusal must not be a way to get
   * a partially-applied policy.
   */
  | { kind: "refused"; why: string; policy: ManagedPolicy };

/**
 * The safest thing this extension can be.
 *
 * Local only, strongest redaction, no escalation, nothing auto-approved. Note what is NOT here: the
 * features are not disabled. A refusal must not look like a broken installation — the editor still
 * works, against a model on the user's own machine, which is this product's default posture anyway.
 */
export const SAFEST: ManagedPolicy = {
  version: 1,
  providers: ["local"],
  escalation: "never",
  redaction: "strict",
  allowUnredacted: false,
  autoApprove: "off",
};

export function safeMode(why: string): PolicyState {
  return { kind: "refused", why, policy: SAFEST };
}

/**
 * Read and verify a policy.
 *
 * The four states and the reason for each:
 *
 *   • nothing on disk at all → NOT MANAGED. The ordinary case for a developer's own machine.
 *   • a pinned key with no policy → REFUSED. An administrator pinned a key, so this machine is
 *     meant to be managed; a missing policy is either a deployment half-done or somebody deleting
 *     the file, and both deserve the safest mode rather than the user's settings.
 *   • a policy with no key → REFUSED. There is nothing to verify it with, and an unverified policy
 *     is a file anybody could have written.
 *   • both, and the signature checks out → MANAGED.
 */
export function verifyPolicy(input: { envelope?: string; publicKey?: string }): PolicyState {
  const envelope = input.envelope?.trim();
  const publicKey = input.publicKey?.trim();

  if (!envelope && !publicKey) return { kind: "none" };
  if (!envelope) {
    return safeMode(
      "A public key is pinned on this machine but there is no policy file beside it. This machine is " +
        "meant to be managed, so the safest settings are in force until the policy is back.",
    );
  }
  if (!publicKey) {
    return safeMode(
      "There is a policy file but no public key pinned beside it, so nothing can verify it. An " +
        "unverified policy is a file anybody could have written.",
    );
  }

  let parsed: PolicyEnvelope;
  try {
    parsed = JSON.parse(envelope) as PolicyEnvelope;
  } catch (err) {
    return safeMode(`The policy file is not readable JSON: ${(err as Error).message}`);
  }
  if (typeof parsed?.policy !== "string" || typeof parsed?.signature !== "string") {
    return safeMode('The policy file has no "policy" and "signature" pair.');
  }

  const bytes = Buffer.from(parsed.policy, "base64");
  if (!bytes.length) return safeMode("The policy document is empty.");

  let ok = false;
  try {
    ok = verifySignature(null, bytes, createPublicKey(publicKey), Buffer.from(parsed.signature, "base64"));
  } catch (err) {
    return safeMode(`The pinned public key could not be used: ${(err as Error).message}`);
  }
  if (!ok) {
    return safeMode(
      "The policy's signature does not match the pinned public key. Either the policy was changed " +
        "after it was signed, or it was signed by somebody else.",
    );
  }

  let policy: ManagedPolicy;
  try {
    policy = JSON.parse(bytes.toString("utf8")) as ManagedPolicy;
  } catch (err) {
    return safeMode(`The signed policy is not readable JSON: ${(err as Error).message}`);
  }
  // A version this build does not know is refused rather than partially applied: a future policy
  // may restrict something this build does not implement, and applying the half we understand would
  // be reporting compliance we do not have.
  if (policy?.version !== 1) {
    return safeMode(
      `This policy is version ${String(policy?.version)} and this build understands version 1. ` +
        "Applying the part it recognises would mean claiming a compliance it cannot deliver.",
    );
  }
  return { kind: "managed", policy };
}

// ── Applying it ──────────────────────────────────────────────────────────────────────────────────

/** The subset of the user's settings a policy can speak about. */
export interface Restrictable {
  provider: string;
  endpoint: string;
  escalation: EscalationCeiling;
  redaction: "strict" | "balanced" | "off";
  allowUnredacted: boolean;
  blockedGlobs: string[];
  deniedCommands: string[];
  deniedPaths: string[];
  autoApprove: ApprovalCeiling;
  writableLibraries: string[];
  budget: { perRequestUsd: number; dailyUsd: number };
}

/** What was overridden, so the interface can say "managed by your organisation" against each one. */
export interface Applied {
  settings: Restrictable;
  /** Setting keys the policy decided, in the order the interface lists them. */
  managed: string[];
}

const ESCALATION_ORDER: EscalationCeiling[] = ["never", "ask", "auto"];
const REDACTION_ORDER = ["off", "balanced", "strict"] as const;
const APPROVAL_ORDER: ApprovalCeiling[] = ["off", "workspace", "all"];

/**
 * The user's settings, restricted by the policy.
 *
 * Every branch here narrows. There is deliberately no path by which a policy value replaces a
 * stricter user value — a developer who wants MORE redaction than their organisation requires is
 * not a problem to be solved.
 */
export function applyPolicy(settings: Restrictable, state: PolicyState): Applied {
  if (state.kind === "none") return { settings, managed: [] };
  const policy = state.policy;
  const out: Restrictable = { ...settings, budget: { ...settings.budget } };
  const managed: string[] = [];

  if (policy.providers?.length && !policy.providers.includes(out.provider)) {
    // Not "the first allowed provider": the local one, which is the only one that needs no
    // permission to reach and sends nothing anywhere.
    out.provider = policy.providers.includes("local") ? "local" : policy.providers[0]!;
    managed.push("chat.provider");
  }
  if (policy.endpoints?.length && !allowedEndpoint(out.endpoint, policy.endpoints)) {
    out.endpoint = "";
    managed.push("endpoints");
  }
  if (policy.escalation && rank(ESCALATION_ORDER, out.escalation) > rank(ESCALATION_ORDER, policy.escalation)) {
    out.escalation = policy.escalation;
    managed.push("escalation.policy");
  }
  if (policy.redaction && rank(REDACTION_ORDER, out.redaction) < rank(REDACTION_ORDER, policy.redaction)) {
    out.redaction = policy.redaction;
    managed.push("privacy.redaction");
  }
  if (policy.allowUnredacted === false && out.allowUnredacted) {
    out.allowUnredacted = false;
    managed.push("privacy.allowUnredacted");
  }
  if (policy.autoApprove && rank(APPROVAL_ORDER, out.autoApprove) > rank(APPROVAL_ORDER, policy.autoApprove)) {
    out.autoApprove = policy.autoApprove;
    managed.push("permissions.autoApprove");
  }
  if (policy.blockedGlobs?.length) {
    out.blockedGlobs = union(out.blockedGlobs, policy.blockedGlobs);
    managed.push("privacy.blockedGlobs");
  }
  if (policy.deniedCommands?.length) {
    out.deniedCommands = union(out.deniedCommands, policy.deniedCommands);
    managed.push("permissions.deniedCommands");
  }
  if (policy.deniedPaths?.length) {
    out.deniedPaths = union(out.deniedPaths, policy.deniedPaths);
    managed.push("permissions.deniedPaths");
  }
  if (policy.writableLibraries) {
    // An empty user list means the IBM i gate is OFF, which is the most permissive state there is —
    // so it cannot be read as "the user agrees with the policy". The policy's list stands.
    out.writableLibraries = out.writableLibraries.length
      ? intersect(out.writableLibraries, policy.writableLibraries)
      : [...policy.writableLibraries];
    managed.push("ibmi.writableLibraries");
  }
  if (policy.budget?.perRequestUsd !== undefined && out.budget.perRequestUsd > policy.budget.perRequestUsd) {
    out.budget.perRequestUsd = policy.budget.perRequestUsd;
    managed.push("budget.perRequestUsd");
  }
  if (policy.budget?.dailyUsd !== undefined && out.budget.dailyUsd > policy.budget.dailyUsd) {
    out.budget.dailyUsd = policy.budget.dailyUsd;
    managed.push("budget.dailyUsd");
  }
  return { settings: out, managed };
}

/** Is this feature switched off by the organisation? */
export function featureDisabled(state: PolicyState, feature: string): boolean {
  return state.kind !== "none" && Boolean(state.policy.disabled?.includes(feature));
}

/**
 * Matched on the ORIGIN, not as a string prefix.
 *
 * `https://gateway.example.com` must not allow `https://gateway.example.com.attacker.test`, which
 * is exactly what a `startsWith` would do.
 */
export function allowedEndpoint(endpoint: string, allowed: string[]): boolean {
  const origin = originOf(endpoint);
  if (!origin) return false;
  return allowed.some((entry) => {
    const other = originOf(entry);
    if (!other) return false;
    if (origin !== other) return false;
    // When the allowed entry carries a path, the endpoint must be under it.
    const path = pathOf(entry);
    return path === "/" || pathOf(endpoint).startsWith(path);
  });
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

function rank<T extends string>(order: readonly T[], value: T): number {
  const at = order.indexOf(value);
  // An unknown value is treated as the most permissive, so that a typo in a setting cannot be a way
  // past a ceiling.
  return at < 0 ? order.length : at;
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

function intersect(a: string[], b: string[]): string[] {
  const other = new Set(b.map((x) => x.toUpperCase()));
  return a.filter((x) => other.has(x.toUpperCase()));
}

// ── Where it is read from ────────────────────────────────────────────────────────────────────────

/**
 * The directory the policy is read from, by platform.
 *
 * Pure, and in `core`, because this is the whole trust model and therefore the thing that most
 * needs a test. ⚠️ **None of these is in the workspace**, and that is the point rather than a
 * detail: a policy that arrived with a `git clone` would be a policy written by whoever sent the
 * repository, and "your organisation requires this" would mean "a stranger's branch requires this".
 * Each location is one an unprivileged user cannot write on a machine an administrator set up,
 * which is the only property that matters.
 *
 * The environment variable exists for the one case a fixed path cannot serve: a container image or
 * a managed VDI where the policy is mounted elsewhere. On a developer's own machine they control
 * that variable — which is fine, because a developer who wants to remove their own organisation's
 * policy can also uninstall the extension. What a policy defends against is not a determined
 * administrator of their own laptop; it is the ordinary case of a setting nobody meant to change
 * and nobody can audit.
 */
export function policyDirectoryFor(platform: string, env: Record<string, string | undefined>): string {
  const fromEnvironment = env["HIVEY_CODE_POLICY_DIR"];
  if (fromEnvironment?.trim()) return fromEnvironment.trim();
  if (platform === "win32") {
    const data = env["ProgramData"]?.trim() || "C:\\ProgramData";
    // Joined by hand rather than with `node:path`, so this stays a pure function of its arguments:
    // `join` on a POSIX host would produce a forward slash for a Windows path and the test would be
    // testing the host rather than the rule.
    return `${data.replace(/[\\/]+$/, "")}\\HiveyCode`;
  }
  if (platform === "darwin") return "/Library/Application Support/HiveyCode";
  return "/etc/hivey-code";
}

/** The two file names, so the loader and the documentation cannot drift apart. */
export const POLICY_FILE = "policy.json";
export const POLICY_KEY_FILE = "policy.pub";
