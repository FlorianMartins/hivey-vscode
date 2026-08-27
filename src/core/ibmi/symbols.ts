// Symbols for IBM i source, which the generic extractor cannot find.
//
// Everywhere else a declaration starts at the beginning of a line, so a regex anchored with ^\s*
// finds it. In a fixed-format member the declaration starts in a COLUMN: an RPG procedure is a P
// specification, which means the letter P in column 6 and the name in columns 7-21; a DDS record
// format is an R in column 17 with its name in 19-28. Anchoring at the start of the line finds
// nothing at all, and the repository map for an IBM i codebase comes out empty — which is exactly
// the codebase where a map is worth the most, because the members are long, the names are six
// characters, and nobody can hold them in their head.

import type { Sym } from "../context/symbols.js";
import { detectIbmiLanguage } from "./languages.js";

/** Columns are 1-based on the platform and 0-based here; this keeps the arithmetic in one place. */
function cols(line: string, from: number, to: number): string {
  return line.slice(from - 1, to).trim();
}

export function extractIbmiSymbols(path: string, text: string): Sym[] {
  const lang = detectIbmiLanguage(path, text);
  if (!lang) return [];
  const lines = text.split(/\r?\n/);
  const out: Sym[] = [];
  const push = (name: string, kind: Sym["kind"], i: number, signature: string) => {
    if (name) out.push({ name, kind, line: i + 1, signature: signature.trim().slice(0, 160) });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;

    switch (lang.id) {
      case "rpgle-free":
      case "sqlrpgle": {
        // Free-form declarations, and the fixed-format ones a half-converted member still carries.
        let m = /^\s*dcl-proc\s+([A-Za-z_][\w$#@]*)/i.exec(line);
        if (m) { push(m[1]!, "function", i, line); break; }
        m = /^\s*dcl-(?:pr|pi)\s+([A-Za-z_][\w$#@]*)/i.exec(line);
        if (m) { push(m[1]!, "type", i, line); break; }
        m = /^\s*dcl-ds\s+([A-Za-z_][\w$#@]*)/i.exec(line);
        if (m) { push(m[1]!, "type", i, line); break; }
        m = /^\s*dcl-f\s+([A-Za-z_][\w$#@]*)/i.exec(line);
        if (m) { push(m[1]!, "const", i, line); break; }
        m = /^\s*begsr\s+([A-Za-z_][\w$#@]*)/i.exec(line);
        if (m) { push(m[1]!, "method", i, line); break; }
        // An SQLRPGLE member's cursors are as much a public surface as its procedures.
        m = /^\s*exec\s+sql\s+declare\s+([A-Za-z_][\w$#@]*)\s+cursor/i.exec(line);
        if (m) { push(m[1]!, "type", i, line); break; }
        if (line.length >= 6 && /^\s{5}P/.test(line) && /B\s*$|B\s/.test(cols(line, 24, 24) + " ")) {
          push(cols(line, 7, 21), "function", i, line);
        }
        break;
      }

      case "rpgle-fixed": {
        const spec = line[5]?.toUpperCase();
        if (line[6] === "*") break;
        if (spec === "P" && /^[Bb]$/.test(cols(line, 24, 24))) push(cols(line, 7, 21), "function", i, line);
        else if (spec === "D") {
          const name = cols(line, 7, 21);
          const kind = cols(line, 24, 25).toUpperCase();
          if (name) push(name, kind === "PR" || kind === "PI" || kind === "DS" ? "type" : "const", i, line);
        } else if (spec === "F") push(cols(line, 7, 16), "const", i, line);
        else if (spec === "C" && /^\s*BEGSR\s*$/i.test(cols(line, 26, 35))) {
          push(cols(line, 12, 25), "method", i, line);
        }
        break;
      }

      case "rpg3": {
        const spec = line[5]?.toUpperCase();
        if (line[6] === "*") break;
        // RPG III has no procedures at all: subroutines are the only named unit, and files are the
        // only declared surface. Listing anything else would be listing every field in the program.
        if (spec === "C" && /^\s*BEGSR\s*$/i.test(cols(line, 28, 32))) push(cols(line, 18, 27), "method", i, line);
        else if (spec === "F") push(cols(line, 7, 14), "const", i, line);
        break;
      }

      case "cl": {
        let m = /^\s*(?:([A-Za-z_][\w$#@]*)\s*:\s*)?PGM\b/i.exec(line);
        if (m) { push(m[1] ?? "PGM", "function", i, line); break; }
        m = /^\s*SUBR\s+SUBR\(([^)]+)\)/i.exec(line);
        if (m) { push(m[1]!.trim(), "method", i, line); break; }
        m = /^\s*DCLF\s+FILE\(([^)]+)\)/i.exec(line);
        if (m) { push(m[1]!.trim(), "const", i, line); break; }
        m = /^\s*([A-Za-z_][\w$#@]*)\s*:\s*$/.exec(line);
        if (m) push(m[1]!, "method", i, line);
        break;
      }

      case "dds-pf":
      case "dds-lf":
      case "dds-dspf":
      case "dds-prtf": {
        if (line.length < 17 || line[6] === "*") break;
        const marker = line[16]?.toUpperCase();
        const name = cols(line, 19, 28);
        if (marker === "R" && name) push(name, "class", i, line);
        else if (marker === "K" && name) push(name, "const", i, line);
        else if (!marker?.trim() && name && lang.id === "dds-pf") push(name, "const", i, line);
        break;
      }

      case "db2": {
        // The generic SQL rules already cover most of this; what they miss is the platform's own
        // vocabulary — a member that only ever CREATEs things nobody else declares.
        const m =
          /^\s*create\s+(?:or\s+replace\s+)?(table|view|index|procedure|function|trigger|alias|sequence|type)\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[\w$#@]+)(?:[./](?:"[^"]+"|[\w$#@]+))?)/i.exec(
            line,
          );
        if (m) push(m[2]!.replace(/"/g, "").split(/[./]/).pop()!, m[1]!.toLowerCase() === "table" ? "class" : "function", i, line);
        break;
      }

      case "cobol": {
        if (line[6] === "*") break;
        const areaA = line.slice(7, 11);
        if (!areaA.trim()) break;
        const m = /^\s*([A-Za-z0-9][\w-]*)\s*(?:DIVISION|SECTION)?\s*\.?\s*$/.exec(line.slice(7, 72));
        const div = /^\s*([A-Za-z0-9][\w-]*)\s+(DIVISION|SECTION)\s*\./i.exec(line.slice(7, 72));
        if (div) push(div[1]!, "class", i, line);
        else if (m && m[1]) push(m[1], "method", i, line);
        break;
      }

      case "cmd": {
        const m = /^\s*PARM\s+KWD\(([^)]+)\)/i.exec(line);
        if (m) push(m[1]!.trim(), "const", i, line);
        else if (/^\s*CMD\b/i.test(line)) push("CMD", "class", i, line);
        break;
      }
    }
  }
  return out;
}

/**
 * What an IBM i member depends on, for the same ranking the generic extractor drives with imports.
 *
 * There is no import statement on the platform. The equivalents are scattered across dialects: an
 * RPG file specification names a table, a CALL names a program, a copybook is /copy, an SQL
 * statement names a schema-qualified object. Treating all of them as "the things this member
 * needs" is what makes the map rank a display file next to the program that opens it.
 */
export function extractIbmiReferences(path: string, text: string): string[] {
  if (!detectIbmiLanguage(path, text)) return [];
  const out = new Set<string>();
  const patterns: RegExp[] = [
    /^\s*\/(?:copy|include)\s+([\w$#@./-]+)/gim,
    /^\s*dcl-f\s+([A-Za-z_][\w$#@]*)/gim,
    /\bcall(?:p|b)?\s*\(?\s*['"]?([A-Za-z_][\w$#@]*)['"]?/gim,
    /^\s*CALL\s+PGM\(([^)]+)\)/gim,
    /^\s*(?:OVRDBF|DCLF)\s+FILE\(([^)]+)\)/gim,
    /\bfrom\s+((?:[\w$#@]+[./])?[\w$#@]+)/gim,
    /^\s*A\s{10}R\s+[\w$#@]+.*\b(?:PFILE|JFILE)\(([^)]+)\)/gim,
    /\b(?:PFILE|JFILE|REF)\(([^)]+)\)/gim,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const raw = m[1]?.trim();
      if (raw) for (const part of raw.split(/[\s/]+/)) if (part && !/^\*/.test(part)) out.add(part.toUpperCase());
    }
  }
  return [...out];
}
