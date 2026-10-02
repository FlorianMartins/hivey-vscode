// The French business identifier. 14 digits, Luhn checksum.
export const SIRET_LENGTH = 14;

/**
 * True when `value` is a well-formed SIRET.
 *
 * Never throws: it is called on whatever a form submitted, and a validator that throws on bad
 * input has to be wrapped by every caller, which is the same check written again in the wrong place.
 */
export function isValidSiret(value) {
  if (typeof value !== "string" || !/^\d{14}$/.test(value)) return false;
  let sum = 0;
  // Luhn, from the right: every second digit doubled, and a double above nine reduced by nine.
  for (let i = 0; i < SIRET_LENGTH; i++) {
    const digit = Number(value[SIRET_LENGTH - 1 - i]);
    if (i % 2 === 0) {
      sum += digit;
    } else {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  return sum % 10 === 0;
}
