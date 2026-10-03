// FIX 4.4, by hand.

export const SOH = "\x01";

/**
 * A FIX message from its fields.
 *
 * `fields` is [tag, value] pairs for the body — everything between BodyLength and CheckSum.
 */
export function build(fields) {
  const body = fields.map(([tag, value]) => `${tag}=${value}`).join(SOH) + SOH;
  const head = `8=FIX.4.4${SOH}9=${body.length}${SOH}`;
  // The checksum: somebody summed the body only.
  let sum = 0;
  for (const char of body) sum += char.charCodeAt(0);
  return `${head}${body}10=${String(sum % 256)}${SOH}`;
}
