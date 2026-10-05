// A regular expression written the way models write them.
//
// `search_text` compiled its pattern with `new RegExp(pattern)`, and JavaScript is the odd one out
// among regex dialects: it has no INLINE FLAGS. `(?i)WHS-` is valid in ripgrep, Go, Rust, Python,
// PCRE and Java, and in JavaScript it is `Invalid group` — the whole call fails and the model has to
// work out why from an error message about groups.
//
// This is not hypothetical. It was found by watching a real turn: the model searched for a warehouse
// code with `(?i)`, got the failure, and retried without it. It recovered — a good model does — but
// it paid a step and a round trip for a dialect difference nobody told it about, and a weaker model
// recovers by giving up or by inventing. The project already treats "the model wrote it the usual
// way" as the client's problem to solve rather than the model's to guess: see `textToolCall.ts`.
//
// So the flags are translated instead of rejected. Only LEADING flags, and only the ones that have a
// JavaScript equivalent — a flag in the middle of a pattern changes behaviour partway through, which
// JavaScript cannot express at all, and silently applying it to the whole pattern would be a wrong
// answer rather than a refused one.

/** Inline flags that have an exact JavaScript equivalent. */
const TRANSLATABLE: Record<string, string> = {
  i: "i", // case-insensitive
  m: "m", // ^ and $ match at line breaks
  s: "s", // . matches a newline
  u: "u", // unicode
};

export interface ParsedPattern {
  /** The pattern with any leading inline-flag group removed. */
  source: string;
  /** The JavaScript flags it asked for, in a stable order. */
  flags: string;
  /** An inline group that could not be honoured, if one stopped the translation. */
  refused?: string;
}

/**
 * Split a pattern into a JavaScript source and flags.
 *
 * @param pattern what the model wrote.
 * @param base flags the caller always wants, such as `g`.
 */
export function parsePattern(pattern: string, base = ""): ParsedPattern {
  let source = pattern;
  const wanted = new Set(base);
  // Repeated, because `(?i)(?s)foo` is as legal as `(?is)foo` wherever either is.
  for (;;) {
    const found = /^\(\?([a-zA-Z-]+)\)/.exec(source);
    if (!found) break;
    const group = found[1]!;
    // ⚠️ A negated flag — `(?-i)` — turns something OFF for the rest of the pattern, and JavaScript
    // has no way to say that. Dropping the group would quietly apply the opposite of what was asked.
    if (group.includes("-")) return { source: pattern, flags: base, refused: found[0] };
    const letters = [...group];
    if (!letters.every((l) => TRANSLATABLE[l])) {
      return { source: pattern, flags: base, refused: found[0] };
    }
    for (const l of letters) wanted.add(TRANSLATABLE[l]!);
    source = source.slice(found[0].length);
  }
  // A stable order so two equivalent patterns compile to the same thing — and so a test can say what
  // it expects without depending on insertion order.
  return { source, flags: [..."gimsuy"].filter((f) => wanted.has(f)).join("") };
}

/** Every regex metacharacter, escaped. */
export function escapeLiteral(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

export interface SearchPattern {
  re: RegExp;
  /** True when the pattern would not compile and was searched for as plain text instead. */
  literal: boolean;
}

/**
 * Compile a search pattern the way a model means it, which is not always as a regular expression.
 *
 * ⚠️ `search_text` was regex-only, and that is why « beaucoup de search text ... echouent ». A model
 * looking for where a function is called types `total(`. As a regular expression that is
 * `Unterminated group`, so the call failed and returned nothing useful. The same for `cost.usd(`,
 * `?.length`, `C++`, `foo)` — five of eight patterns taken from ordinary code search fail to
 * compile, and every one of them is obviously a literal.
 *
 * So a pattern that will not compile is searched for as TEXT rather than refused, and the result says
 * which happened — the model must not conclude that `total(` is a working regex, or it will build on
 * that. The one case still refused is an inline flag this searcher cannot honour: there the message
 * says exactly what to change, and a literal search for `(?-i)` would be nonsense.
 */
export function searchPattern(pattern: string, base = ""): SearchPattern {
  const parsed = parsePattern(pattern, base);
  if (parsed.refused) {
    throw new Error(
      `Unsupported inline flag ${parsed.refused} — this searcher cannot change flags partway through a pattern. ` +
        `Leading (?i), (?m), (?s) and (?u) are accepted.`,
    );
  }
  try {
    return { re: new RegExp(parsed.source, parsed.flags), literal: false };
  } catch {
    // Escaped from the ORIGINAL pattern, not from `parsed.source`: if the leading group was not a
    // flag group after all, it is part of what the model was looking for.
    return { re: new RegExp(escapeLiteral(pattern), base), literal: true };
  }
}
