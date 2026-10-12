// What to send when an attached file does not fit.
//
// The answer was "its first N tokens", and that is the worst of the available answers. A 3 000-line
// module cut to its first 400 lines tells the model about the imports and the first two functions,
// and hides the existence of everything else — so the model answers about a file it believes it has
// read, and the part that mattered was never on screen. A user attaching a large file and getting a
// vague answer has no way to connect the two.
//
// An outline costs a fraction of the same tokens and loses far less: every symbol the file declares,
// with the line it is on, so the model knows what is in there and can ask for the part it needs. In
// agent mode it can simply read it; in chat mode it can say which lines it wants. What is kept from
// the body is the head, because the top of a file is its imports and its shape.
//
// So the trade is not "less of the file" but "a different projection of it" — and the projection is
// the one the repository map already uses, which is the one this codebase has decided it trusts.

import { extractSymbols, extractImports } from "./symbols.js";
import { estimateTokens, headToTokens } from "../util/tokens.js";

export interface Excerpt {
  body: string;
  /** True when the body is a head plus an outline rather than the file. The label should say so. */
  outlined: boolean;
  /** Symbols named in the outline, 0 when the file fitted or nothing could be extracted. */
  symbols: number;
}

/** Of the budget, spent on the outline. The rest goes to the head, which is usually the larger half. */
const OUTLINE_SHARE = 0.45;

const line = (s: { line: number; signature: string }): string => `${s.line}: ${s.signature}`;

export function fileExcerpt(path: string, text: string, maxTokens: number): Excerpt {
  if (estimateTokens(text) <= maxTokens) return { body: text, outlined: false, symbols: 0 };

  // EVERYTHING the file declares — not the forty the repository map keeps, because there the budget
  // is shared between hundreds of files and here it is the one file the user asked about.
  //
  // The cap has to be lifted rather than merely raised: `extractSymbols` cuts by keeping the FIRST
  // n, so any cap at all loses the end of a large file — the very half that head-truncation already
  // loses and that this function exists to recover. Deciding what to drop belongs below, where it
  // is a sample across the file rather than a cut at the top.
  const symbols = extractSymbols(path, text, Number.MAX_SAFE_INTEGER);
  if (!symbols.length) {
    // Prose, data, a log: nothing to outline, and the head is genuinely the best projection.
    return { body: headToTokens(text, maxTokens), outlined: false, symbols: 0 };
  }

  const imports = extractImports(path, text);
  const outlineBudget = Math.max(200, Math.floor(maxTokens * OUTLINE_SHARE));
  const header = [
    `--- outline of ${path} (${symbols.length} symbols; the body below is only its beginning) ---`,
    ...(imports.length ? [`imports: ${imports.join(", ")}`] : []),
  ];

  // When the file declares more than the budget can name, the outline is SAMPLED across it rather
  // than cut at the top. Cutting would reproduce the defect this function exists to fix one level
  // down: the end of a large file would disappear again, just from the outline instead of from the
  // body. An even stride keeps the shape of the whole module, and the count says what was skipped.
  // The last symbol is always in the sample. A stride alone reaches it only when the count happens
  // to divide, and the end of the file is the half that head-truncation already loses — an outline
  // that drops it too would be solving nothing.
  const sample = (stride: number): typeof symbols => {
    const taken = symbols.filter((_, i) => i % stride === 0);
    const last = symbols[symbols.length - 1]!;
    return taken[taken.length - 1] === last ? taken : [...taken, last];
  };
  let stride = 1;
  let kept = symbols;
  while (estimateTokens([...header, ...kept.map(line)].join("\n")) > outlineBudget && kept.length > 4) {
    stride += 1;
    kept = sample(stride);
  }
  const omitted = symbols.length - kept.length;
  const outline = [
    ...header,
    ...kept.map(line),
    ...(omitted > 0 ? [`(… ${omitted} more symbols between these; ask for the file to see them)`] : []),
  ].join("\n");
  const head = headToTokens(text, Math.max(200, maxTokens - estimateTokens(outline)));

  return {
    body: `${outline}\n--- beginning of ${path} ---\n${head}`,
    outlined: true,
    symbols: symbols.length,
  };
}
