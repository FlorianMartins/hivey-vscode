// Who uses this?
//
// The question asked before every change to a file on this platform, and the one that cannot be
// answered by reading the member in front of you. A physical file on IBM i is used by programs
// nobody remembers writing, through logical files whose names say nothing, from a library that is
// not on the current library list. Changing a field length is a five-minute edit and a four-hour
// search, and the search is what this does.
//
// Two levels, and they are not the same kind of answer. That distinction is the whole design here:
//
//   OBJECT LEVEL is a FACT. `DSPPGMREF` reads the object's own reference list — what the compiler
//   recorded about what the program touches. It is complete for compiled programs in the libraries
//   looked at, and it does not depend on anybody's source being present.
//
//   FIELD LEVEL is a SEARCH. Nothing on the partition records "this field is read here" unless a
//   cross-reference product was built for it: ARCAD, when Elias is installed, genuinely knows. With
//   no ARCAD, the honest answer is a text search of the source members we can read — which misses
//   every program whose source is gone, every reference built at run time, and every field renamed
//   with a PREFIX keyword.
//
// So every answer carries its METHOD and its LIMITS, in words, as part of the result. An impact
// analysis that sounds complete and is not is worse than no impact analysis: it is the thing
// somebody quotes in a change request.

/** How an answer was obtained, which decides how much it is worth. */
export type Method = "program-references" | "source-search";

export interface Reference {
  /** The thing that uses it. */
  library: string;
  name: string;
  /** `*PGM`, `*SRVPGM`, `*MODULE`, or a source member type for a source search. */
  type: string;
  /** How it is used, when the source says: `*INPUT`, `*OUTPUT`, `*UPDATE`, or a line of source. */
  usage?: string;
}

export interface Impact {
  /** What was asked about. */
  subject: { library: string; name: string; field?: string };
  method: Method;
  references: Reference[];
  /** True when the answer was cut short, so "nothing else" is not implied. */
  truncated: boolean;
  /** Where this was looked for. An answer is only as wide as the libraries it searched. */
  searched: string[];
  /** What this method cannot see, in words the reader needs before quoting the answer. */
  limits: string[];
  /** A better method that exists on this partition and that this extension cannot call itself. */
  better?: string;
}

/** The scratch file this writes its DSPPGMREF output into. QTEMP, and nowhere else. */
export const OUTFILE = "QTEMP/HVYPGMREF";

/**
 * `DSPPGMREF` for one library, into QTEMP.
 *
 * `*ALL` for the programs rather than one name, because the question is reversed: we do not know
 * which programs use the file, which is precisely what is being asked. So the whole library's
 * reference list is produced and filtered afterwards.
 *
 * `OUTMBR(*FIRST *REPLACE)` so that a second call in the same job does not append to the first
 * one's answer — a stale row in QTEMP would be reported as a current reference.
 */
export function programRefsCommand(library: string): string {
  return (
    `DSPPGMREF PGM(${library.trim().toUpperCase()}/*ALL) OBJTYPE(*ALL) OUTPUT(*OUTFILE) ` +
    `OUTFILE(${OUTFILE}) OUTMBR(*FIRST *REPLACE)`
  );
}

/**
 * Everything DSPPGMREF wrote, bounded.
 *
 * `SELECT *` on purpose. The DSPPGMREF model file's field names (`WHPNAM`, `WHFNAM`, `WHLIB`…) are
 * not something to depend on in a WHERE clause from a machine with no partition to check against;
 * the rows are read with a reader that accepts several spellings instead, and the filtering happens
 * on our side. The bound is what keeps that honest — a library can hold tens of thousands of
 * references, and a truncated answer has to know it was truncated.
 */
export function programRefsQuery(limit = 5000): string {
  return `SELECT * FROM ${OUTFILE.replace("/", ".")} FETCH FIRST ${Math.trunc(limit)} ROWS ONLY`;
}

export interface RowReader {
  (row: Record<string, unknown>, ...names: string[]): string;
}

/**
 * The rows that mention this object.
 *
 * The comparison is on the name, and on the library only when the row gives one — a reference
 * recorded without a library was compiled against the library list, and excluding it because it
 * does not match would hide exactly the references most likely to matter.
 */
export function referencesTo(
  rows: Array<Record<string, unknown>>,
  wanted: { library: string; name: string },
  read: RowReader,
): Reference[] {
  const name = wanted.name.toUpperCase();
  const library = wanted.library.toUpperCase();
  const out: Reference[] = [];
  for (const row of rows) {
    const referenced = read(row, "WHFNAM", "WHRFNM", "OBJECT_REFERENCED", "REFERENCED_OBJECT").toUpperCase();
    if (referenced !== name) continue;
    const referencedLibrary = read(row, "WHLNAM", "WHRFLB", "OBJECT_LIBRARY_REFERENCED").toUpperCase();
    if (referencedLibrary && library && referencedLibrary !== library && referencedLibrary !== "*LIBL") continue;
    const usage = read(row, "WHSTMT", "WHRFUS", "OBJECT_USAGE", "USAGE");
    out.push({
      library: read(row, "WHLIB", "WHPLIB", "PROGRAM_LIBRARY").toUpperCase(),
      name: read(row, "WHPNAM", "PROGRAM_NAME").toUpperCase(),
      type: read(row, "WHOTYP", "WHPTYP", "OBJECT_TYPE") || "*PGM",
      ...(usage ? { usage } : {}),
    });
  }
  // One row per program, even when a program references the file four times.
  const seen = new Set<string>();
  return out.filter((r) => {
    const key = `${r.library}/${r.name}/${r.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What `DSPPGMREF` cannot see. Attached to every object-level answer. */
export const PROGRAM_REFERENCE_LIMITS = [
  "only the libraries listed above were looked in — a program in a library nobody mentioned is not in this answer",
  "a reference built at run time (a program name in a variable, a CALL to a parameter) is recorded nowhere and is not here",
  "SQL embedded with a fully qualified name is recorded, but a table named in a prepared statement is not",
];

/** What a text search of source members cannot see. Attached to every field-level answer without ARCAD. */
export const SOURCE_SEARCH_LIMITS = [
  "this is a TEXT SEARCH of the source members that could be read, not a cross-reference: it is evidence, not an inventory",
  "a program whose source is no longer on the partition cannot appear, however much it uses the field",
  "a field reached through a PREFIX keyword, an externally described data structure or a LIKE definition is named differently in the source and will be missed",
  "a match inside a comment counts as a match here",
];

/**
 * Which method answers a field-level question, and whether a better one exists on this partition.
 *
 * ARCAD, when Elias is installed, genuinely has a cross-reference — and this extension cannot call
 * it. The reason is written at the top of `extension/integrations/arcad.ts` and it has not changed:
 * ARCAD's REST endpoint catalogue is not published, and inventing a path would produce an
 * integration that fails at the customer's site in a way nobody can debug. The roadmap asks for
 * "ARCAD cross-references when Elias is present"; the honest form of that is to say ARCAD is there,
 * say that it knows better, and name the door — `arcad_rest`, with a path the ARCAD administrator
 * supplies — rather than to claim an answer from a product we are guessing at.
 *
 * So the method is always the search. What changes when ARCAD is present is that the answer stops
 * pretending the search is the best available: it points at the thing that is.
 */
export function fieldMethod(arcadAvailable: boolean): { method: Method; limits: string[]; better?: string } {
  const limits = [...SOURCE_SEARCH_LIMITS];
  if (!arcadAvailable) return { method: "source-search", limits };
  return {
    method: "source-search",
    limits,
    better:
      "ARCAD Elias is installed on this workstation and holds a real cross-reference, which would answer " +
      "this properly. Hivey Code does not guess ARCAD's REST paths: ask your ARCAD administrator for the " +
      "cross-reference endpoint and call it with arcad_rest, then trust that over this search.",
  };
}

const LABELS: Record<Method, string> = {
  "program-references": "the objects' own reference lists (DSPPGMREF)",
  "source-search": "a text search of the source members",
};

/**
 * The answer, with its method in the first line.
 *
 * The method goes FIRST and not in a footnote. This result is going to be pasted into a change
 * request, and the difference between "the compiler recorded these" and "I grepped what I could
 * read" is the difference between a fact and a lead.
 */
export function formatImpact(impact: Impact, limit = 100): string {
  const subject = impact.subject.field
    ? `${impact.subject.library}/${impact.subject.name}, field ${impact.subject.field}`
    : `${impact.subject.library}/${impact.subject.name}`;
  const lines: string[] = [
    `Who uses ${subject}, according to ${LABELS[impact.method]}.`,
    "",
    `Looked in: ${impact.searched.length ? impact.searched.join(", ") : "(nothing — no library was searched)"}.`,
  ];

  if (!impact.references.length) {
    // Never "nothing uses it". The method decides what that absence is worth, and for a search it is
    // worth very little.
    lines.push(
      "",
      impact.method === "program-references"
        ? "No program in those libraries records a reference to it. That is a fact about those libraries, not about the system."
        : "Nothing was found. For a search rather than a cross-reference, that is weak evidence: read the limits below before concluding it is unused.",
    );
  } else {
    lines.push("", `${impact.references.length}${impact.truncated ? "+" : ""} user(s):`);
    for (const r of impact.references.slice(0, limit)) {
      lines.push(`  ${r.library}/${r.name} ${r.type}${r.usage ? ` — ${r.usage}` : ""}`);
    }
    if (impact.references.length > limit) lines.push(`  … ${impact.references.length - limit} more`);
  }

  if (impact.truncated) {
    lines.push("", "The answer was cut short, so this list is a floor and not a total.");
  }
  lines.push("", "What this method cannot see:");
  for (const l of impact.limits) lines.push(`  - ${l}`);
  if (impact.better) lines.push("", `A better answer exists here: ${impact.better}`);
  return lines.join("\n");
}
