// Every source file has to still be TEXT.
//
// This exists because a single byte got past everything. `src/core/router/outcome.ts` carried a
// literal NUL inside a template literal — `${step.tool}\u0000${step.call}` written as the raw byte
// rather than the escape — as a separator for a composite map key. The intent was sound; NUL is the
// one character that cannot appear in a tool name, which is exactly why it makes a good separator.
//
// What it cost was visibility. One control byte makes a file BINARY to the whole Unix toolchain:
// `grep` stops printing matching lines, `file` reports "data", and a diff shows "Binary files
// differ" instead of the change. It was found while searching that very file for a symbol the file
// plainly exported and getting no output — the search was not wrong, the file was unreadable to it.
//
// A defect nobody can grep for is a defect nobody will find again, and every future audit of that
// file would have been silently incomplete. So: the escape means the same thing to the compiler and
// keeps the file text, and this refuses the raw byte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tab, newline and carriage return are the only control characters text is allowed. */
const ALLOWED = new Set([9, 10, 13]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx|js|mjs|cjs|json|md|css|html)$/.test(entry)) out.push(path);
  }
  return out;
}

test("no source file carries a control byte", () => {
  const files = [...sourceFiles("src"), ...sourceFiles("tests"), ...sourceFiles("scripts")];
  // A guard that walks nothing passes forever. The directories exist; say so, so a move is noticed.
  assert.ok(files.length > 200, `only ${files.length} source files found — did the layout move?`);

  const offenders: string[] = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    // Every offender in the file, not just the first: reporting one per file turns a five-minute
    // fix into five runs, which is how a guard earns a reputation for being annoying.
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!;
      if (byte < 32 && !ALLOWED.has(byte)) {
        offenders.push(`${file}: byte 0x${byte.toString(16).padStart(2, "0")} at offset ${i}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join("\n")}\n\nA control byte makes the file binary to grep, diff and file(1). ` +
      `Write the escape (\\u0000) instead: it compiles to the same string and stays readable.`,
  );
});

test("every source file is valid UTF-8", () => {
  // The other half of "still text". A lone surrogate or a truncated sequence renders as a
  // replacement character in some tools and throws in others, and the file compiles either way.
  const files = [...sourceFiles("src"), ...sourceFiles("tests"), ...sourceFiles("scripts")];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const offenders: string[] = [];
  for (const file of files) {
    try {
      decoder.decode(readFileSync(file));
    } catch (err) {
      offenders.push(`${file}: ${(err as Error).message}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
