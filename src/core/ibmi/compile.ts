// Compile a source member, then read what the compiler said about it.
//
// This is the loop IBM Bob does not claim: not "write RPG", but **write it, compile it on the
// partition, read the errors, fix them**. On IBM i that loop is the only one that means anything,
// because a member that does not compile has not produced a partial result — it has produced
// nothing. There is no object. So a compile is a verdict on the work in exactly the way a test
// suite is, and `core/router/outcome.ts` treats it as one.
//
// Two halves live here, and both are arithmetic over text, which is why they are in `core` rather
// than beside the connection:
//
//   • WHICH COMMAND. Decided by the member's type, from a table, with an unknown type refused
//     rather than guessed. Guessing here would mean compiling a display file with the RPG compiler
//     and reporting the resulting nonsense as the state of the user's code.
//   • WHAT THE COMPILER SAID. The listing is a printed report meant for a person, and turning it
//     into a list of (id, severity, line, text) is where this can be wrong in ways nobody notices.
//
// ⚠️ ON THE FIXTURES, SAID PLAINLY. There is no IBM i partition on the machine this was written on.
// The listings in `tests/ibmiCompile.test.ts` are built from the documented layouts, NOT recorded
// from a real compile, so the parser is tested against what the layouts say and not against what a
// particular release prints. The consequence is written into the design rather than hidden: the
// parser never requires a fixed column, it looks for the three things every one of these listings
// carries — a message identifier, a two-digit severity and a line of text — and a line number only
// when the listing offers one in a shape it recognises. Everything it cannot read, it leaves out
// and SAYS it left out, because a compile report that silently drops an error is worse than one
// that admits it is partial. The joblog is read through `QSYS2.JOBLOG_INFO` instead, where the same
// facts arrive as columns and nothing has to be parsed at all; that is the primary source, and this
// parser is what adds line numbers to it.

/** One thing the compiler said. */
export interface CompileMessage {
  /** `RNF7030`, `SQL0104`, `CPD7596`, `MCH1210`… */
  id: string;
  /** IBM severity: 0, 10, 20, 30, 40. Above 20 a program is normally not created. */
  severity: number;
  /** The statement or source line it points at, when the listing gives one. */
  line?: number;
  text: string;
  /** The member it belongs to, filled in by the caller: the listing rarely repeats it. */
  member?: string;
}

/** Everything a compile produced, in the shape the model is given. */
export interface CompileReport {
  command: string;
  target: { library: string; object: string };
  /** The command's own exit status. This, not the message list, decides success. */
  ok: boolean;
  messages: CompileMessage[];
  /** Where each half of the report came from, so a reader knows what is missing when it is thin. */
  sources: { joblog: boolean; listing: boolean };
  /** What could not be read, in words. Empty when everything asked for came back. */
  gaps: string[];
}

/**
 * The create command for a member type.
 *
 * Exactly the eight the roadmap names, and an unknown extension is refused. The temptation is to
 * fall through to CRTBNDRPG for anything that looks like RPG — and RPG III (`.rpg`, CRTRPGPGM) is
 * the obvious candidate — but a compiler invoked on source it does not understand produces a
 * listing full of real-looking errors about code that is fine, which is a worse answer than "I do
 * not compile that type". `module: true` asks for the ILE module rather than the bound program.
 */
const COMMANDS: Record<string, { program: string; module?: string; parameter: "obj" | "file" | "pgm" }> = {
  rpgle: { program: "CRTBNDRPG", module: "CRTRPGMOD", parameter: "pgm" },
  sqlrpgle: { program: "CRTSQLRPGI", parameter: "obj" },
  clle: { program: "CRTBNDCL", parameter: "pgm" },
  pf: { program: "CRTPF", parameter: "file" },
  lf: { program: "CRTLF", parameter: "file" },
  dspf: { program: "CRTDSPF", parameter: "file" },
  prtf: { program: "CRTPRTF", parameter: "file" },
};

export function compilableTypes(): string[] {
  return Object.keys(COMMANDS).sort();
}

export interface MemberRef {
  library: string;
  sourceFile: string;
  member: string;
  /** The member type, without a dot: `rpgle`, `dspf`. Case does not matter. */
  extension: string;
}

export interface CompileRequest {
  source: MemberRef;
  /** Where the object is created. Not necessarily where the source lives. */
  targetLibrary: string;
  /** An ILE module instead of a bound program, for the types that have both. */
  module?: boolean;
}

/**
 * The command to run, or why there is none.
 *
 * The object is always qualified — `OBJ(LIB/NAME)` — and never left to the library list. That is
 * the same rule the production gate enforces for everything else (`core/ibmi/guard.ts`): a command
 * that does not say which library it means cannot be checked, and on this partition the library
 * list may well start with production.
 */
export function compileCommand(request: CompileRequest): { command: string } | { refused: string } {
  const bad = badNames(request);
  if (bad.length) {
    return {
      refused:
        `Not a usable IBM i name: ${bad.join(", ")}. A name is at most ten characters, starts with a ` +
        `letter, # , $ or @ , and contains only letters, digits, # , $ , @ , _ and . — I refuse the ` +
        `rest rather than quoting it, because a name is about to become part of a command.`,
    };
  }
  const extension = request.source.extension.replace(/^\./, "").toLowerCase();
  const entry = COMMANDS[extension];
  if (!entry) {
    return {
      refused:
        `I do not compile a ${extension || "(no type)"} member. The types I compile are: ` +
        `${compilableTypes().join(", ")}.`,
    };
  }
  if (request.module && !entry.module) {
    return { refused: `There is no module compile for a ${extension} member; ${entry.program} creates a program.` };
  }
  const program = request.module && entry.module ? entry.module : entry.program;
  const target = `${up(request.targetLibrary)}/${up(request.source.member)}`;
  const source = `SRCFILE(${up(request.source.library)}/${up(request.source.sourceFile)}) SRCMBR(${up(request.source.member)})`;
  const keyword = request.module ? "MODULE" : entry.parameter === "file" ? "FILE" : entry.parameter === "pgm" ? "PGM" : "OBJ";
  return { command: `${program} ${keyword}(${target}) ${source}` };
}

function up(value: string): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * A name QSYS.LIB could actually have.
 *
 * Not politeness: every name here is interpolated into a CL command and into SQL, and every one of
 * them was chosen by the MODEL. `CUSTRPT) MONMSG MSGID(CPF0000) DLTLIB LIB(PROD` is a perfectly
 * good string and a catastrophic command, and the production gate cannot help — it reads a command
 * after it is built, and this would be a command we built ourselves on the model's behalf.
 *
 * Ten characters, starting with a letter or one of the three national characters, and nothing in it
 * that can end a parameter or a quoted string. A name that does not match is refused rather than
 * escaped, because there is no legitimate IBM i name that needs escaping.
 */
const NAME = /^[A-Z#$@][A-Z0-9#$@_.]{0,9}$/;

export function validName(name: string): boolean {
  return NAME.test(up(name));
}

/** The names a request touches, so one check covers all of them. */
function badNames(request: CompileRequest): string[] {
  return [
    ["source library", request.source.library],
    ["source file", request.source.sourceFile],
    ["member", request.source.member],
    ["target library", request.targetLibrary],
  ]
    .filter(([, value]) => !validName(String(value)))
    .map(([what, value]) => `${what} “${value}”`);
}

/** A message identifier: two to four letters then four digits. */
const ID = "[A-Z][A-Z0-9]{1,3}\\d{4}";

/**
 * A line of a compile listing that is a message, if it is one.
 *
 * The shapes these listings actually use, and the one trap in them:
 *
 *   *RNF7030 30 a       12 The name or indicator CUSBAL is not defined.
 *   *CPD7596 30 Keyword DSPATR not valid for field CUSREF.
 *    SQL0104 30 Position 23 Token ; was not valid.
 *
 * The identifier may or may not carry a leading asterisk, the severity is always the two digits
 * after it, and what follows is either a statement number, a marker letter and then a statement
 * number, a `Position n`, or straight into the text. A number is taken as a line only in those
 * positions — never from inside the message text, where "not valid for field 15A" would otherwise
 * become line 15.
 */
const MESSAGE = new RegExp(
  `^\\s*\\*?(${ID})\\s+(\\d{2})\\s+` +
    // Optionally a single marker letter (the ILE listing's key into the ======> line above), then
    // optionally a statement number or `Position n`.
    `(?:([a-z])\\s+)?` +
    `(?:(?:Position\\s+)?(\\d{1,7})\\s+)?` +
    `(.*)$`,
);

/** `     12 C                   EVAL      total = total + CUSBAL` — a numbered source line. */
const SOURCE_LINE = /^\s{0,8}(\d{1,7})\s[\s*]?[A-Za-z*/]/;

/**
 * Where the per-occurrence messages stop and the counts begin.
 *
 * The ILE listing ends with a summary whose third column is the NUMBER OF OCCURRENCES, not a line
 * number — `*RNF7030 30      2` means "twice", and reading it as "line 2" is the single most
 * plausible way to produce a confident, wrong error list. So the summary is recognised and its
 * numbers are not read as lines; the messages in it are kept only when the body did not already
 * carry them, which is what makes the parser useful on a listing that has a summary and nothing
 * else.
 */
const SUMMARY_HEADING = /m\s?e\s?s\s?s\s?a\s?g\s?e\s+s\s?u\s?m\s?m\s?a\s?r\s?y/i;

export interface ListingParse {
  messages: CompileMessage[];
  /** True when a summary section was found, so counts were deliberately not read as line numbers. */
  sawSummary: boolean;
}

export function parseCompileListing(listing: string): ListingParse {
  const body: CompileMessage[] = [];
  const summary: CompileMessage[] = [];
  let inSummary = false;
  let lastSourceLine: number | undefined;

  for (const raw of (listing ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (SUMMARY_HEADING.test(raw)) {
      inSummary = true;
      continue;
    }
    const source = SOURCE_LINE.exec(raw);
    if (source && !inSummary) {
      lastSourceLine = Number(source[1]);
      // A numbered source line is not a message; it is what the next message is about.
      if (!MESSAGE.test(raw)) continue;
    }
    const m = MESSAGE.exec(raw);
    if (!m) continue;
    const [, id, severity, , number, text] = m;
    const message: CompileMessage = {
      id: id!,
      severity: Number(severity),
      text: (text ?? "").trim(),
    };
    if (inSummary) {
      // The number here counts occurrences. Deliberately dropped.
      summary.push(message);
      continue;
    }
    const line = number ? Number(number) : lastSourceLine;
    if (line !== undefined) message.line = line;
    body.push(message);
  }

  // A message from the summary is kept only when the body never mentioned that identifier: on a
  // listing that has both, the body's copy carries the line number and the summary's does not.
  const seen = new Set(body.map((b) => b.id));
  const messages = [...body, ...summary.filter((s) => !seen.has(s.id))];
  return { messages, sawSummary: inSummary };
}

/** The joblog, as `QSYS2.JOBLOG_INFO` returns it. Column names vary by release; several are tried. */
export function messagesFromJoblog(
  rows: Array<Record<string, unknown>>,
  read: (row: Record<string, unknown>, ...names: string[]) => string,
): CompileMessage[] {
  const out: CompileMessage[] = [];
  for (const row of rows) {
    const id = read(row, "MESSAGE_ID", "MESSAGEID", "MSGID").toUpperCase();
    if (!id) continue;
    const severity = Number(read(row, "SEVERITY", "MESSAGE_SEVERITY", "MSGSEV")) || 0;
    const text = read(row, "MESSAGE_TEXT", "MESSAGETEXT", "MSGTEXT");
    out.push({ id, severity, text });
  }
  return out;
}

/**
 * One list, with the duplicates removed and the worst first.
 *
 * The joblog and the listing overlap: the same RNF7030 appears in both, once with a line number
 * and once without. Merging on identifier-and-text keeps the copy that knows where it is.
 */
export function mergeMessages(...lists: CompileMessage[][]): CompileMessage[] {
  const best = new Map<string, CompileMessage>();
  for (const message of lists.flat()) {
    // Keyed on the identifier and the text, not on the line: the whole point is that the same
    // message arrives twice, once from a source that knows where it is and once from one that does
    // not. The copy that carries a line wins; otherwise the first one seen stays.
    const key = `${message.id}|${message.text}`;
    const existing = best.get(key);
    if (existing && (existing.line !== undefined || message.line === undefined)) continue;
    best.set(key, message);
  }
  return [...best.values()].sort((a, b) => b.severity - a.severity || (a.line ?? 0) - (b.line ?? 0));
}

/** Severity at or above which IBM would not have created the object. */
export const ERROR_SEVERITY = 20;

export function errorsOnly(messages: CompileMessage[]): CompileMessage[] {
  return messages.filter((m) => m.severity >= ERROR_SEVERITY);
}

/**
 * The report, as the model reads it.
 *
 * Errors first and in full, because they are what the next edit is for. The gaps are stated — "the
 * compile listing could not be read" — because a model told only "it failed" with no messages will
 * guess at the cause, and a model told "it failed and I could not read the listing" asks for the
 * listing.
 */
export function formatReport(report: CompileReport, limit = 40): string {
  const lines: string[] = [];
  lines.push(
    report.ok
      ? `${report.command} — created ${report.target.library}/${report.target.object}.`
      : `${report.command} — FAILED. ${report.target.library}/${report.target.object} was not created.`,
  );
  const errors = errorsOnly(report.messages);
  const warnings = report.messages.filter((m) => m.severity < ERROR_SEVERITY);
  if (errors.length) {
    lines.push("", `${errors.length} error(s):`);
    for (const m of errors.slice(0, limit)) lines.push(`  ${where(m)}${m.id} (sev ${m.severity}) ${m.text}`);
    if (errors.length > limit) lines.push(`  … ${errors.length - limit} more`);
  }
  if (warnings.length) {
    lines.push("", `${warnings.length} warning(s):`);
    for (const m of warnings.slice(0, limit)) lines.push(`  ${where(m)}${m.id} (sev ${m.severity}) ${m.text}`);
    if (warnings.length > limit) lines.push(`  … ${warnings.length - limit} more`);
  }
  if (!report.messages.length) {
    lines.push("", report.ok ? "No messages." : "No messages could be read, which is itself a problem — see below.");
  }
  if (report.gaps.length) lines.push("", `What I could not read: ${report.gaps.join("; ")}.`);
  return lines.join("\n");
}

function where(m: CompileMessage): string {
  const member = m.member ? `${m.member}` : "";
  if (member && m.line !== undefined) return `${member}:${m.line} `;
  if (m.line !== undefined) return `line ${m.line}: `;
  return member ? `${member} ` : "";
}

// ── Running it, and reading the three places the answer hides ────────────────────────────────────
//
// The verdict is the command's exit status and nothing else: Code for IBM i returns what the
// partition returned, and if CRTBNDRPG failed then no object exists. Everything below is about
// EXPLAINING that verdict, and each source is attempted independently so that one that is
// unavailable costs a named gap rather than the whole report:
//
//   1. what the command itself printed — always there, needs no extra authority, and on a failed
//      compile it usually already carries the identifiers;
//   2. the compile listing in the spooled file, which is the only source with LINE NUMBERS;
//   3. the joblog of the job that produced that spooled file, where the messages arrive as columns
//      and nothing has to be parsed.
//
// The joblog is read for the job the SPOOL says compiled it, not for "the current job". That
// distinction is the one thing here that would have been wrong by default: the command runs in one
// job and the SQL runs in another, so `JOBLOG_INFO('*')` would return the log of the SQL job — a
// log with nothing about the compile in it, presented as the compiler's output.

export interface CompileIO {
  /** Code for IBM i's `connection.runCommand`. */
  command(command: string): Promise<{ code: number; stdout: string; stderr: string }>;
  /** Code for IBM i's `connection.getContent().runSQL`. */
  sql(statement: string): Promise<Array<Record<string, unknown>>>;
  /** Reads a column under any of several spellings — `core/ibmi/sql.ts`'s `cell`. */
  read(row: Record<string, unknown>, ...names: string[]): string;
  /** The profile the compile ran under, to find its spooled file. */
  user: string;
}

/** The most recent compile listing this user produced for this object. */
export function spoolLookupSql(object: string, user: string): string {
  return (
    `SELECT JOB_NAME, SPOOLED_FILE_NAME, FILE_NUMBER FROM QSYS2.OUTPUT_QUEUE_ENTRIES ` +
    `WHERE USER_NAME = '${up(user)}' AND SPOOLED_FILE_NAME = '${up(object)}' ` +
    `ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`
  );
}

export function spoolDataSql(job: string, file: string, number: number): string {
  return (
    `SELECT SPOOLED_DATA FROM TABLE(SYSTOOLS.SPOOLED_FILE_DATA(` +
    `JOB_NAME => '${job}', SPOOLED_FILE_NAME => '${up(file)}', SPOOLED_FILE_NUMBER => ${Math.trunc(number)}` +
    `)) X ORDER BY ORDINAL_POSITION`
  );
}

export function joblogSql(job: string): string {
  return (
    `SELECT MESSAGE_ID, SEVERITY, MESSAGE_TEXT FROM TABLE(QSYS2.JOBLOG_INFO('${job}')) X ` +
    `ORDER BY ORDINAL_POSITION`
  );
}

/**
 * A job name, as a column gave it.
 *
 * It goes back into SQL, and it is the one value here that does not come from the model but from
 * the partition — which is not a reason to trust it into a string literal. `nnnnnn/USER/NAME`, and
 * nothing else.
 */
const JOB_NAME = /^[0-9]{6}\/[A-Z0-9#$@_.]{1,10}\/[A-Z0-9#$@_.]{1,10}$/;

export async function runCompile(
  request: CompileRequest,
  io: CompileIO,
): Promise<{ report: CompileReport } | { refused: string }> {
  const built = compileCommand(request);
  if ("refused" in built) return built;

  const target = { library: up(request.targetLibrary), object: up(request.source.member) };
  const gaps: string[] = [];
  const sources = { joblog: false, listing: false };

  const run = await io.command(built.command);
  // What the command printed. Parsed with the same reader as the listing: it is the same messages,
  // in the same shape, minus the numbered source lines.
  const printed = parseCompileListing(`${run.stdout ?? ""}\n${run.stderr ?? ""}`).messages;

  let fromListing: CompileMessage[] = [];
  let fromJoblog: CompileMessage[] = [];
  let job = "";

  try {
    const rows = await io.sql(spoolLookupSql(target.object, io.user));
    const row = rows[0];
    if (!row) {
      gaps.push(`the compile listing (no spooled file named ${target.object} for ${up(io.user)})`);
    } else {
      job = io.read(row, "JOB_NAME", "JOBNAME").toUpperCase();
      const name = io.read(row, "SPOOLED_FILE_NAME", "SPOOLEDFILENAME", "FILE_NAME");
      const number = Number(io.read(row, "FILE_NUMBER", "FILENUMBER", "SPOOLED_FILE_NUMBER")) || 1;
      if (!JOB_NAME.test(job)) {
        gaps.push(`the compile listing (the spooled file's job name “${job}” is not one I can look up)`);
        job = "";
      } else {
        const data = await io.sql(spoolDataSql(job, name || target.object, number));
        const text = data.map((r) => io.read(r, "SPOOLED_DATA", "SPOOLEDDATA", "DATA")).join("\n");
        fromListing = parseCompileListing(text).messages.map((m) => ({ ...m, member: target.object }));
        sources.listing = true;
      }
    }
  } catch (err) {
    gaps.push(`the compile listing (${reason(err)})`);
  }

  if (job) {
    try {
      const rows = await io.sql(joblogSql(job));
      fromJoblog = messagesFromJoblog(rows, io.read);
      sources.joblog = true;
    } catch (err) {
      gaps.push(`the joblog of ${job} (${reason(err)})`);
    }
  } else {
    // Said rather than left out: without the spooled file there is no job name to ask about, so the
    // absence of the joblog has a cause and the model should be told which.
    gaps.push("the joblog (I could not establish which job compiled it, so there was none to read)");
  }

  const messages = mergeMessages(fromListing, fromJoblog, printed);
  return {
    report: {
      command: built.command,
      target,
      ok: run.code === 0,
      messages,
      sources,
      gaps,
    },
  };
}

function reason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.trim().split("\n")[0]?.slice(0, 160) || "no reason given";
}

// ── The gate ─────────────────────────────────────────────────────────────────────────────────────

/**
 * May the agent create an object in this library?
 *
 * Deliberately NOT the same rule as `refuseChange` in `core/ibmi/guard.ts`, and the difference is
 * the roadmap's: that gate is OFF when the list is empty, because a default list would be one
 * company's library names shipped to everybody. A compile cannot be off, because it always creates
 * an object — so an unconfigured list means "ask, every time, and say that nothing is bounding
 * this", which is a usable state rather than a refusal of the feature.
 */
export type CompileVerdict =
  | { allow: true; unconfigured: boolean }
  | { allow: false; reason: string };

export function compileAllowed(targetLibrary: string, writable: string[]): CompileVerdict {
  const allowed = writable.map((l) => up(l)).filter(Boolean);
  const target = up(targetLibrary);
  if (!allowed.length) return { allow: true, unconfigured: true };
  if (allowed.includes(target)) return { allow: true, unconfigured: false };
  return {
    allow: false,
    reason:
      `Refused: ${target} is not in hiveyCode.ibmi.writableLibraries, which allows: ${allowed.join(", ")}. ` +
      `Compiling creates an object, so it is bounded by the same list as every other change.`,
  };
}

/** The sentence on the approval card. It says what will be created, and where. */
export function compileApproval(request: CompileRequest, writable: string[]): string {
  const where = `${up(request.targetLibrary)}/${up(request.source.member)}`;
  const from = `${up(request.source.library)}/${up(request.source.sourceFile)}(${up(request.source.member)})`;
  const base = `compile ${from} into ${where}`;
  return writable.length
    ? base
    : `${base} — nothing bounds this: hiveyCode.ibmi.writableLibraries is empty, so no library is off limits`;
}
