// The parts of the IBM i bridge that are pure decisions rather than plumbing.
//
// They live in core, away from the `vscode` import, for one reason: `isReadOnlySql` decides whether
// the user is asked before a statement runs against their production data. A function with that job
// has to be testable without an editor and without a partition, and it has to be testable by
// someone who wants to break it — the interesting cases are the ones written to look harmless.

/**
 * Whether a statement only reads.
 *
 * Deliberately conservative and deliberately blunt: anything that is not plainly a read is treated
 * as a write and asked for. The failure this guards against is not a model that drops a table on
 * purpose — it is a model that writes `UPDATE` where it meant `SELECT`, against a library list that
 * happens to point at production.
 *
 * The rule is a whitelist of openings plus a blacklist of verbs anywhere in the statement, which is
 * stricter than a parser would be. It refuses a few honest reads (a SELECT from a table function
 * called CREATE_SOMETHING) and that is the right way round: a refusal costs a dialog, a wrong
 * "this only reads" costs data.
 */
export function isReadOnlySql(statement: string): boolean {
  const cleaned = statement
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
  if (!cleaned) return false;
  // More than one statement is more than we can vouch for: the second may be anything.
  if (/;\s*\S/.test(cleaned)) return false;
  if (!/^(?:select|with|values)\b/i.test(cleaned)) return false;
  // A CTE can hide a write — Db2 for i allows a data-change statement inside WITH — and CALL can
  // run a procedure that does anything at all.
  return !/\b(?:insert|update|delete|merge|drop|alter|create|grant|revoke|call|truncate|comment\s+on|label\s+on)\b/i.test(
    cleaned,
  );
}

export interface MemberRef {
  library: string;
  sourceFile: string;
  member: string;
}

/**
 * Parses a source member reference, in either of the two ways the platform writes one.
 *
 * `LIB/SRCFILE(MEMBER)` is what a developer types; `/LIB/SRCFILE/MEMBER.RPGLE` is what the editor
 * shows in its title bar. Accepting only one of them means the model has to guess which, and it
 * guesses from whichever it saw last.
 */
export function parseMemberRef(ref: string): MemberRef {
  const trimmed = ref.trim();
  const classic = /^([^/(\s]+)\/([^/(\s]+)\(([^)\s]+)\)$/.exec(trimmed);
  if (classic) {
    return {
      library: classic[1]!.toUpperCase(),
      sourceFile: classic[2]!.toUpperCase(),
      member: classic[3]!.toUpperCase(),
    };
  }
  const qsys = /^\/?([^/\s]+)\/([^/\s]+)\/([^/.\s]+)(?:\.[A-Za-z0-9]+)?$/.exec(trimmed);
  if (qsys) {
    return { library: qsys[1]!.toUpperCase(), sourceFile: qsys[2]!.toUpperCase(), member: qsys[3]!.toUpperCase() };
  }
  throw new Error(`“${ref}” is not a member reference. Write LIB/SRCFILE(MEMBER) or /LIB/SRCFILE/MEMBER.RPGLE.`);
}

/**
 * A result set as a fixed-width table.
 *
 * Not JSON, and not CSV. A model reads a column-aligned table more reliably than either, and it
 * costs fewer tokens than JSON does for the same rows because the column names are written once.
 */
export function formatRows(rows: Array<Record<string, unknown>>, maxRows = 200): string {
  if (!rows.length) return "0 rows.";
  const columns = Object.keys(rows[0]!);
  if (!columns.length) return `${rows.length} rows, no columns.`;
  const shown = rows.slice(0, maxRows);
  const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
  const widths = columns.map((c) => Math.min(Math.max(c.length, ...shown.map((r) => cell(r[c]).length)), 40));
  const line = (values: string[]) => values.map((v, i) => v.slice(0, widths[i]!).padEnd(widths[i]!)).join("  ").trimEnd();
  const out = [line(columns), line(widths.map((w) => "-".repeat(w)))];
  for (const row of shown) out.push(line(columns.map((c) => cell(row[c]))));
  if (rows.length > shown.length) out.push(`… ${rows.length - shown.length} more rows`);
  return out.join("\n");
}

/**
 * Does this object name match what the user typed?
 *
 * IBM i's own rule is the generic name: `CUST*` means "starts with CUST", and that is all it means —
 * the platform has no way to say "contains". People do want to say it, so `*` is honoured wherever
 * it appears, which makes `*531*` the search that the system itself cannot express.
 *
 * A pattern with no `*` at all is treated as "contains" rather than as an exact name. That is a
 * deliberate departure: someone typing `531` into a box labelled search means "find me the ones
 * with 531 in them", and answering nothing because no member is called exactly `531` is the kind of
 * literal-mindedness that makes a search feel broken.
 */
export function matchesName(name: string, pattern: string): boolean {
  const wanted = pattern.trim().toUpperCase();
  if (!wanted || wanted === "*") return true;
  const subject = name.trim().toUpperCase();
  const escaped = wanted.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const body = escaped.includes("*") ? escaped.replace(/\*/g, ".*") : `.*${escaped}.*`;
  return new RegExp(`^${body}$`).test(subject);
}
