// FIX 4.4, by hand.

export const SOH = "\x01";

/**
 * A FIX message from its fields.
 *
 * Two things every counterparty checks before reading the order, and both were wrong:
 *
 *   BodyLength (9) counts the bytes from the SOH that ends tag 9 to the start of tag 10 — which is
 *   exactly the body, so the old code was right by accident and wrong as soon as a header changed.
 *   CheckSum (10) covers EVERYTHING before it, including `8=` and `9=`, and is three digits
 *   zero-padded. Summing the body alone gives a number that is right one time in two hundred and
 *   fifty-six.
 */
export function build(fields) {
  const body = fields.map(([tag, value]) => `${tag}=${value}`).join(SOH) + SOH;
  const head = `8=FIX.4.4${SOH}9=${body.length}${SOH}`;
  const upTo = `${head}${body}`;
  let sum = 0;
  for (const char of upTo) sum += char.charCodeAt(0);
  return `${upTo}10=${String(sum % 256).padStart(3, "0")}${SOH}`;
}
