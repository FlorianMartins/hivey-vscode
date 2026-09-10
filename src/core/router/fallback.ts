// What to do when the model that was supposed to answer cannot.
//
// The failure this exists for is the cheapest tier's: Hivey Free routes to endpoints that are free
// because they are rate-limited, and a 429 ended the turn. The user saw an error, lost the answer,
// and had nothing to do about it except wait and ask again — which makes the free preset a
// demonstration rather than something anybody works with.
//
// The other half is the one nobody else can offer. Every hosted assistant is a remote service with
// a local interface: when the network goes, the product goes. Here there is usually a model running
// on the machine already, so a provider that stops answering is a reason to fall back, not a reason
// to stop working. That is the argument on a train, and it is worth being able to make it.
//
// Two rules keep this from being a way to spend money by accident:
//   • a fallback is only ever CHEAPER or EQUAL. The chain runs downwards — the same preset's
//     cheaper role, then the machine — never up into a model the user did not choose.
//   • it only fires on a failure that says "not now": rate limits, gateway errors, a dead socket.
//     A 400 means the request is wrong and sending it somewhere else sends a wrong request twice;
//     a 401 means the key is wrong and no retry fixes that.

import { hiveyModel, hiveyRole, isHivey } from "./hivey.js";
import type { RouterConfig, Route, TaskKind } from "./route.js";
import type { ProviderId } from "../providers/index.js";

/**
 * Is this a failure that another endpoint might not have?
 *
 * Deliberately narrow. Everything not listed here is treated as final, because a fallback on a
 * permanent error turns one clear message into two confusing ones — and on a paid provider it turns
 * one failed request into two billed ones.
 */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  if (typeof status === "number") {
    // 429 rate limit; 500/502/503/504 the provider having a bad minute; 408 its own timeout.
    return status === 429 || status === 408 || (status >= 500 && status < 600);
  }
  const message = String((err as Error | undefined)?.message ?? "").toLowerCase();
  if (!message) return false;
  // A socket that never opened or died mid-answer. The words come from `http.ts`'s own explanations
  // and from Node's underlying errors.
  return /econnrefused|econnreset|enotfound|etimedout|network|socket hang up|fetch failed|sent nothing within|temporarily|overloaded|rate.?limit/.test(
    message,
  );
}

export interface FallbackOptions {
  /** The model this machine serves, when it serves one. The last link of every chain. */
  localModel?: string;
  /** What kind of work this is, so a preset falls back along its own roles. */
  kind: TaskKind;
}

/**
 * Where to go next, in order, after `from` has failed.
 *
 * Never includes `from` itself, never includes anything more expensive than it, and may be empty —
 * which is the honest answer for a user who has configured exactly one remote model and no local
 * one. An empty chain means the error reaches them, which is right: inventing a destination they
 * never chose would be worse than failing.
 */
export function fallbackChain(cfg: RouterConfig, from: Route, opts: FallbackOptions): Route[] {
  const chain: Route[] = [];
  const seen = new Set([`${from.provider}:${from.model}`]);
  const add = (provider: ProviderId, model: string, why: string): void => {
    const key = `${provider}:${model}`;
    if (!model || seen.has(key)) return;
    seen.add(key);
    chain.push({ provider, model, why });
  };

  // A preset falls back along its own roles, downwards. `everyday` is what a hard question would
  // have used before it was classified as hard; `chore` is the cheapest thing the preset has. Both
  // are worse answers than what was asked for, and both are answers.
  if (isHivey(cfg.chat.model)) {
    const role = hiveyRole(opts.kind);
    if (role !== "chore") add("openrouter", hiveyModel(cfg.chat.model, "everyday"), "the preset's everyday model");
    add("openrouter", hiveyModel(cfg.chat.model, "chore"), "the preset's cheapest model");
  }

  // The machine. Always last, always free, and the only link that works with no network at all.
  if (opts.localModel) add("local", opts.localModel, "this machine, because the network did not answer");

  return chain;
}

/** What the user is told when an answer arrives from somewhere other than where they aimed it. */
export function describeFallback(from: Route, to: Route): string {
  return `${from.model} did not answer — ${to.why}: ${to.model}`;
}
