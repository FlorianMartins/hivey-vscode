// Where the organisation's policy lives, and what happens when it does not verify.
//
// The decisions in `core/policy/policy.ts` are about what a policy MAY say. This file is about the
// one thing that cannot be decided in core, because it is about the machine: WHERE the policy is
// read from. That location is the whole trust model, so it is worth being explicit about it.
//
// ⚠️ THE POLICY IS NEVER READ FROM THE WORKSPACE. Not from `.hiveycode/`, not from `.vscode/`, not
// from anywhere a `git clone` can put a file. A policy that arrived with the repository would be a
// policy written by whoever sent the repository, and "the organisation requires this" would mean
// "a stranger's branch requires this". The location is a MACHINE location that only an
// administrator can write, and the public key is pinned beside the policy in the same directory —
// which is to say that whoever owns that directory owns the policy, and that is the intended and
// stated trust boundary.
//
// The environment variable exists for the one case a fixed path cannot serve: a container image or
// a managed VDI where the policy is mounted somewhere else. It is read from the process
// environment, which on a developer's own machine they control — and that is fine, because a
// developer who wants to remove their own organisation's policy can also uninstall the extension.
// What the policy defends against is not a determined administrator of their own laptop; it is the
// ordinary case of a setting nobody meant to change and nobody can audit.

import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POLICY_FILE,
  POLICY_KEY_FILE,
  policyDirectoryFor,
  verifyPolicy,
  type PolicyState,
} from "../core/policy/policy.js";
import { t } from "../shared/i18n.js";

/** The location decision lives in `core/policy/` so it can be tested; this supplies the machine. */
export function policyDirectory(): string {
  return policyDirectoryFor(process.platform, process.env);
}

let cached: { state: PolicyState; from: string } | undefined;

/**
 * The policy in force.
 *
 * Read once and cached, because `readSettings()` is called on nearly every keystroke and this is a
 * synchronous file read. `reloadPolicy()` is how an administrator's change takes effect without a
 * restart — and reloading is a deliberate act rather than a watcher, so that a policy being written
 * half a file at a time cannot be read mid-write and refused.
 */
export function policyState(): PolicyState {
  if (cached) return cached.state;
  const dir = policyDirectory();
  const state = verifyPolicy({
    envelope: readIfThere(join(dir, POLICY_FILE)),
    publicKey: readIfThere(join(dir, POLICY_KEY_FILE)),
  });
  cached = { state, from: dir };
  return state;
}

export function reloadPolicy(): PolicyState {
  cached = undefined;
  return policyState();
}

/** Where the policy came from, for the interface and the sovereignty report. */
export function policySource(): string {
  policyState();
  return cached?.from ?? policyDirectory();
}

function readIfThere(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // Missing is the ordinary case on an unmanaged machine, and unreadable is the same answer here:
    // `verifyPolicy` decides what the absence means, and it is stricter than this function could be.
    return undefined;
  }
}

/**
 * Tell the user once, and keep telling them where to look.
 *
 * A refused policy is not a detail. It means the extension is in its safest mode — local only,
 * strongest redaction, nothing auto-approved — and a user who does not know that will read it as
 * the product being broken. So it is a modal-free warning with the reason in it, and the reason is
 * the one `verifyPolicy` produced, not a generic sentence.
 */
export function announcePolicy(state: PolicyState = policyState()): void {
  if (state.kind !== "refused") return;
  void vscode.window.showWarningMessage(
    t("Hivey Code is in its safest mode: {0}", state.why),
    t("Where is the policy?"),
  ).then((answer) => {
    if (answer) void vscode.window.showInformationMessage(t("The policy is read from {0}.", policySource()));
  });
}
