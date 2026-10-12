// Split a loan into equal instalments, in cents.

/**
 * The residue is distributed, not dropped.
 *
 * Rounding each instalment on its own and multiplying back is how a schedule comes to a cent less
 * than the loan: 100 000 over 7 is 14 285.71…, and seven times 14 286 is 100 002. So the base is
 * the floor, and the remainder — strictly fewer cents than there are instalments — is handed out
 * one cent at a time. The total is the principal by construction, and no instalment is more than a
 * cent from any other.
 */
export function schedule(principalCents, instalments) {
  if (instalments <= 0) throw new Error("instalments must be positive");
  const base = Math.floor(principalCents / instalments);
  const residue = principalCents - base * instalments;
  return Array.from({ length: instalments }, (_, i) => base + (i < residue ? 1 : 0));
}
