// Handing a change to ARCAD — and the one thing this agent will never do.
//
// On a partition managed by ARCAD Elias, a change does not go into production because somebody
// edited a member. It is checked out, modified, checked back in, built, and then PROMOTED through
// the environments by a person who is accountable for it. The last step is a release decision, and
// a release decision is not a tool call.
//
// So this module holds two things, and the second is the point of the first:
//
//   1. WHAT HAS TO BE TRUE before a change is offered to ARCAD at all: it compiled, and its tests
//      passed. Checking in a member that does not compile hands a broken component to everybody
//      else's build, and ARCAD's whole value is that the repository is the truth.
//   2. WHAT THE AGENT MAY NOT DO. Promotion towards production is not in the agent's tool set, and
//      the guarantee lives in code rather than in a prompt: the ARCAD bridge offers a curated
//      allow-list of commands, and a test refuses any entry in it that looks like a promotion.
//      That is the same reasoning as plan mode's tool set and the writable-libraries gate — a model
//      that misreads an instruction is the ordinary case, not the exceptional one.

/** One tool call, as the session records it. The same shape as `core/router/outcome.ts`. */
export interface DeliveryStep {
  tool: string;
  ok: boolean;
  call?: string;
}

export interface Readiness {
  ready: boolean;
  /** What is missing, or what was found, in the words the user reads. */
  why: string;
}

/**
 * Has this turn earned the right to offer the change to ARCAD?
 *
 * Both halves, and the LAST of each: a turn that compiled, failed, fixed and compiled again has
 * earned it, and a turn whose last compile is red has not — the same rule `verifyTurn` applies, for
 * the same reason. A turn that never compiled at all is not ready either, and that is the common
 * case rather than the edge one: the model changed a member and believes it is done.
 */
export function readyToDeliver(steps: DeliveryStep[]): Readiness {
  const last = (tool: string): DeliveryStep | undefined => [...steps].reverse().find((s) => s.tool === tool);
  const compiled = last("ibmi_compile");
  const tested = last("ibmi_test");

  if (!compiled) {
    return {
      ready: false,
      why: "nothing was compiled in this turn, so there is no evidence the change is even a program",
    };
  }
  if (!compiled.ok) {
    return { ready: false, why: `the last compile failed (${compiled.call ?? "ibmi_compile"}), so no object exists` };
  }
  if (!tested) {
    return {
      ready: false,
      why: "it compiles, and nothing ran the tests — compiling proves it is a program, not that it still works",
    };
  }
  if (!tested.ok) {
    return { ready: false, why: `the last test run failed (${tested.call ?? "ibmi_test"})` };
  }
  return { ready: true, why: "it compiled and its tests passed in this turn" };
}

/**
 * Words that mean "move this towards production".
 *
 * Deliberately a pattern over command names rather than a list of them: Elias registers over 150
 * commands and this repository cannot enumerate them, let alone the ones a future version adds. The
 * guarantee is therefore the ALLOW-LIST — the agent can only invoke the curated actions — and this
 * pattern is what a test uses to refuse an entry somebody adds to that list later.
 *
 * It errs towards refusing. A command caught by mistake costs a conversation with whoever added it;
 * one missed puts a release in a model's hands.
 */
const PROMOTION = /promot|transfer|deliver|deploy|toprod|production|release|skipperrun|applychange/i;

export function looksLikePromotion(command: string): boolean {
  return PROMOTION.test((command ?? "").replace(/[^a-z]/gi, ""));
}

/**
 * The sentence the agent gives instead of promoting.
 *
 * It names what it did, what it did not do, and WHO does the rest — because "I cannot do that" with
 * no next step is how somebody ends up doing it by hand, outside ARCAD, at five o'clock.
 */
export const PROMOTION_REFUSED =
  "Promotion towards production is not something I do, and not something I can be configured to do: " +
  "it is a release decision, and it belongs to whoever is accountable for the release. What I can do " +
  "is leave the change ready for them — checked in, built, and with the compile and test evidence " +
  "attached — and say so. The promotion itself is done in ARCAD by a person.";

export interface DeliveryPlan {
  readiness: Readiness;
  /** The curated ARCAD actions to run, in order. */
  steps: string[];
  /** What is deliberately left to a person. */
  handedOver: string;
}

/**
 * What to do with a finished change, given what the turn actually proved.
 *
 * Returns a PLAN rather than running anything, so that the decision and the doing are separable —
 * and so this can be tested without ARCAD, which is the only way it will be tested at all.
 */
export function deliveryPlan(steps: DeliveryStep[]): DeliveryPlan {
  const readiness = readyToDeliver(steps);
  if (!readiness.ready) return { readiness, steps: [], handedOver: PROMOTION_REFUSED };
  return {
    readiness,
    // Check in first, then ask for the build: a build request before the check-in builds the
    // previous version and reports success.
    steps: ["checkin", "request_build"],
    handedOver: PROMOTION_REFUSED,
  };
}
