// Whether a request costs the user anything.
//
// Distinct from "does it leave the machine", which is the egress gate's question and is answered
// separately — a private gateway may well be remote and still be free, and the two must not be
// conflated. This one decides whether it is worth interrupting somebody to show them a price.
//
// The consent card that quotes tokens and dollars was shown for every turn, local ones included,
// where it said "on this machine, nothing billed" and asked for a click anyway. A question whose
// answer is always zero is not a question; it is a step.

/**
 * Providers whose bill the user pays, as opposed to their own hardware or their own proxy.
 *
 * Decided by the PROVIDER alone, and not by where its address points. That looked like the more
 * careful rule and it is the wrong one twice over. A gateway on a private network is already
 * covered by its provider; and making the answer depend on the address made the consent card
 * impossible to exercise from a test, because every stub in the suite listens on loopback — which
 * is how this project shipped an approval card nobody could see in the first place. A rule that
 * cannot be tested is a rule that will be wrong later.
 *
 * Somebody who points the OpenRouter provider at an address on this machine has configured
 * OpenRouter, and is told what OpenRouter charges. That is the honest reading of what they chose.
 */
export function billsTheUser(provider: string): boolean {
  // Their own machine, and their own gateway.
  //
  // The gateway is included whatever its address, and that is a decision rather than an oversight:
  // it is infrastructure the user runs or rents, this extension has no price list for it, and a
  // card quoting "~0.0000 $" is worse than no card — it states a number it does not know. A proxy
  // in front of a paid vendor bills its owner, who is the person who put it there.
  return provider !== "local" && provider !== "openai-compatible";
}
