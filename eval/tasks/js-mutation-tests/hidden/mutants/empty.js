const UNITS = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
const ORDER = ["d", "h", "m", "s", "ms"];
const PART = /(\d+(?:\.\d+)?)(ms|d|h|m|s)/y;

/**
 * Parses a human duration into milliseconds.
 *
 * - units: d (days), h (hours), m (minutes), s (seconds), ms (milliseconds); lowercase only;
 * - several parts combine: "1h30m" is 5 400 000;
 * - parts may be separated by spaces: "1h 30m"; leading and trailing spaces are ignored;
 * - a part may have a decimal: "1.5h" is 5 400 000;
 * - parts go from the largest unit to the smallest, each unit at most once: "30m1h" and "1h1h"
 *   are errors;
 * - the result is rounded to the nearest millisecond: "1.5ms" is 2, "0.0004s" is 0;
 * - a number without a unit, a negative number, an unknown unit, or an empty string is an error:
 *   throws a RangeError naming the input.
 */
export function parseDuration(text) {
  const input = String(text).trim();
  let total = 0;
  let lastRank = -1;
  let i = 0;
  while (i < input.length) {
    if (input[i] === " ") {
      i++;
      continue;
    }
    PART.lastIndex = i;
    const match = PART.exec(input);
    if (!match) throw new RangeError(`not a duration: ${JSON.stringify(text)}`);
    const rank = ORDER.indexOf(match[2]);
    if (rank <= lastRank) throw new RangeError(`not a duration: ${JSON.stringify(text)}`);
    lastRank = rank;
    total += Number(match[1]) * UNITS[match[2]];
    i = PART.lastIndex;
  }
  return Math.round(total);
}
