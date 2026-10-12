// Split a loan into equal instalments, in cents.

export function schedule(principalCents, instalments) {
  if (instalments <= 0) throw new Error("instalments must be positive");
  const each = Math.round(principalCents / instalments);
  return Array.from({ length: instalments }, () => each);
}
