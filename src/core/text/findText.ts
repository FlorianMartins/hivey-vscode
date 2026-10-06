// Finding a snippet the model wrote inside a file somebody else wrote.
//
// ⚠️ From a real session, in the model's own words:
//
//     « Le fichier contient des caractères accentués que ma copie ne reproduit pas à l'identique.
//       Je découpe donc l'édition en petits morceaux sans accents. »
//
// It had worked out that accents were the problem and was routing around them — writing smaller and
// smaller edits that avoided the letters it could not reproduce. That is the shape of a defect
// costing an entire session: nothing errors, the tool simply says "that snippet does not appear in
// the file" about a snippet that is visibly in the file.
//
// The cause is Unicode normalisation. `é` is either U+00E9 (composed, NFC) or U+0065 U+0301 (`e`
// followed by a combining acute, NFD). The two render identically in every editor and are different
// strings to `indexOf`. A file saved on macOS, or by a tool that normalised one way, holds one form;
// a model emits the other. Neither is wrong, and no amount of care by the model fixes it.
//
// So: try the literal match first, and only if it fails, match again with both sides normalised —
// mapping the result back to real offsets in the ORIGINAL text, because that is what has to be
// replaced. Falling back rather than always normalising keeps the common path exact.

export interface Found {
  start: number;
  /** Exclusive, in the original text. */
  end: number;
  /** True when it took normalisation to find it — the caller says so, rather than hiding it. */
  normalized: boolean;
}

export type FindResult = Found | { problem: "absent" } | { problem: "ambiguous"; count: number };

/**
 * Normalise a text, keeping a map back to where each character came from.
 *
 * Done per code point rather than on the whole string at once: `String.normalize` on the whole text
 * gives no way to know which original index produced which normalised one, and the replacement has
 * to happen in the original.
 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; ) {
    // ⚠️ LINE ENDINGS FIRST, and this is the other half of the same defect. A file saved on Windows
    // holds `\r\n`; a model writes `\n`. They are the same text on screen and different strings to
    // `indexOf`, so EVERY multi-line edit failed on a Windows checkout — and the model worked it out
    // on its own, in a real session: « Le premier edit multi-ligne échoue sans doute à cause des fins
    // de ligne Windows. Je refais la modification sur une seule ligne. » It was writing worse edits
    // to route around a bug.
    //
    // Both characters map back to where the pair began, so a replacement spans the `\r` as well as
    // the `\n` and cannot leave a stray carriage return behind.
    if (text[i] === "\r") {
      norm += "\n";
      map.push(i);
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    // ⚠️ A CLUSTER, not a code point. NFC composition works on a SEQUENCE — `e` followed by a
    // combining acute becomes `é` only when the two are normalised together. The first version of
    // this normalised each code point on its own, which composes nothing at all and left the map
    // perfectly consistent with a transformation that had not happened. Its own tests caught it.
    const first = String.fromCodePoint(text.codePointAt(i)!);
    let j = i + first.length;
    while (j < text.length) {
      const next = String.fromCodePoint(text.codePointAt(j)!);
      if (!COMBINING.test(next)) break;
      j += next.length;
    }
    const normalized = text.slice(i, j).normalize("NFC");
    for (let k = 0; k < normalized.length; k++) {
      norm += normalized[k];
      // Every unit produced by this cluster maps back to where the cluster began.
      map.push(i);
    }
    i = j;
  }
  // One past the end, so a match that runs to the end of the text has an end to map to.
  map.push(text.length);
  return { norm, map };
}

/** A combining mark: what attaches to the character before it. */
const COMBINING = /\p{M}/u;

/**
 * The snippet in the same shape `normalizeWithMap` produces: composed, and `\n` only.
 *
 * It has no map because nothing is replaced inside the snippet — only its length is needed, and that
 * length is measured in the normalised form on both sides.
 */
function normalizeNeedle(needle: string): string {
  return needle.replace(/\r\n?/g, "\n").normalize("NFC");
}

/** How many times `needle` occurs in `hay`, stopping at two: nobody needs the third. */
function occurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let at = hay.indexOf(needle);
  while (at >= 0 && count < 2) {
    count++;
    at = hay.indexOf(needle, at + 1);
  }
  return count;
}

/**
 * Where `needle` is in `text`, requiring exactly one occurrence.
 *
 * ⚠️ The uniqueness rule survives normalisation, and that matters: two snippets that differ only by
 * normalisation ARE the same text to a reader, so matching one of them arbitrarily would edit a
 * place the model did not mean. Ambiguous is reported as ambiguous.
 */
export function findUnique(text: string, needle: string): FindResult {
  if (!needle) return { problem: "absent" };

  const direct = occurrences(text, needle);
  if (direct === 1) {
    const start = text.indexOf(needle);
    return { start, end: start + needle.length, normalized: false };
  }
  if (direct > 1) return { problem: "ambiguous", count: direct };

  // Nothing literal. Try again with both sides composed AND with one kind of line ending.
  const { norm, map } = normalizeWithMap(text);
  const needleNorm = normalizeNeedle(needle);
  const viaNorm = occurrences(norm, needleNorm);
  if (viaNorm === 0) return { problem: "absent" };
  if (viaNorm > 1) return { problem: "ambiguous", count: viaNorm };

  const at = norm.indexOf(needleNorm);
  const start = map[at]!;
  // `map` has one entry past the end, so this is safe at the very end of the text.
  const end = map[at + needleNorm.length] ?? text.length;
  return { start, end, normalized: true };
}
