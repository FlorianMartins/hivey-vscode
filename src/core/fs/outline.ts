// A large file asked for whole: its plan, not its 3 000 lines.
//
// ⚠️ « en gros il doit chercher directement les éléments qu'il a besoin au lieu de tout lire comme
// claude code le fait ». A real turn read ui.js and menu.js whole, four times each, and filled the
// window to 129 000 tokens. Claude looks for the part first — a search, the structure — and reads
// that. A model that does not think to is handed the structure instead of the whole file: every
// function, class and export with its line, the first lines, and how to read the part it needs.

import { describeSlice, sliceLines } from "./slice.js";

/** Above this many lines, a read with no range gets the plan rather than the text. */
export const OUTLINE_ABOVE_LINES = 800;
/** The head shown under the plan: imports, constants, the file's own comment. */
const HEAD_LINES = 100;

/**
 * Lines as Claude Code's Read returns them: each with its number, then a tab (`cat -n`).
 *
 * The model reads `from`/`to` off them and aims an edit at the right place; reading raw text, it had
 * to count, and counted wrong. The prefix is not part of the file — the tools say so, and an edit
 * that copies it anyway is understood without it (see `unnumbered` in core/text/findText.ts).
 */
export function numbered(text: string, first: number): string {
  return text
    .split("\n")
    .map((line, i) => `${String(first + i).padStart(6)}\t${line}`)
    .join("\n");
}

/** A line that opens something worth finding: a function, a class, an export, a top-level binding. */
const DECLARATION =
  /^\s{0,4}(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?\s+\w|class\s+\w|interface\s+\w|type\s+\w+\s*=|enum\s+\w|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\(|function|class|\w+\s*=>|require\()|def\s+\w|func\s+\w|fn\s+\w|pub\s+(?:fn|struct|enum)\s+\w|struct\s+\w|impl\b|module\.exports|exports\.\w+\s*=|\w+\s*\([^)]*\)\s*\{\s*$|(?:public|private|protected|static)\s+[\w<>[\]]+\s+\w+\s*\()/;

/** The plan of a source file: one line per declaration, with its 1-based line number. */
export function outlineOf(text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (DECLARATION.test(line)) out.push(`${String(i + 1).padStart(5)}  ${line.trim().slice(0, 140)}`);
  }
  return out;
}

/**
 * What read_file returns for a whole file: the text, or — above `OUTLINE_ABOVE_LINES` and with no
 * range asked — the plan, the head and how to read on. `maxChars` bounds the text as before.
 */
export function readWhole(text: string, path: string, from: number | undefined, to: number | undefined, maxChars: number): string {
  const total = text.split("\n").length;
  if (from !== undefined || to !== undefined || total <= OUTLINE_ABOVE_LINES) {
    const slice = sliceLines(text, from, to, maxChars);
    return numbered(slice.text, slice.from) + describeSlice(slice, path);
  }
  const plan = outlineOf(text);
  const head = sliceLines(text, 1, HEAD_LINES, maxChars);
  return (
    `${path} has ${total} lines — too many to read whole usefully. Its plan (line, declaration):\n` +
    (plan.length ? plan.join("\n") : "(no declarations recognised)") +
    `\n\nIts first ${head.to} lines:\n${numbered(head.text, 1)}\n\n` +
    `[Read the part you need: read_file({ path: "${path}", from: <line>, to: <line> }), or find a name with search_text first.]`
  );
}
