// Running RPG unit tests on the partition, through RPGUnit.
//
// 1.1 gave the agent a compiler, which answers "is this a program?". This answers the next
// question, which is the one a bank actually asks: "does it still do what it did?". RPGUnit
// (iRPGUnit) is the de facto test framework on this platform, it is free, and a shop that has it
// has test programs already — so the useful thing is not to invent a framework but to RUN theirs
// and read the verdict.
//
// ⚠️ WHAT IS KNOWN FIRST-HAND HERE, AND WHAT IS NOT. The command is `RUCALLTST`, it takes the test
// program and optionally one test case, and it ends in error when a test fails: that is its
// documented contract and it is what the verdict rests on. The exact TEXT it prints is not known
// first-hand on the machine this was written on, and inventing a format would be the worst possible
// move — a parser built around a guessed layout reports "0 tests, all passed" on output it does not
// recognise, which is a green light nobody asked for.
//
// So the design is built so that not knowing the format is SAFE:
//
//   • the verdict is the command's exit status, never the parsed counts;
//   • a line is read as a test result only when it clearly is one, and everything else is left
//     alone rather than coerced;
//   • the parser SAYS how much it could not account for, and the raw output always travels with the
//     result, so a model whose tests failed can read what the partition actually printed;
//   • "no test was recognised" is reported as exactly that, and never as "no test failed".

import { validName } from "./compile.js";

export type CaseStatus = "passed" | "failed" | "error";

export interface TestCase {
  name: string;
  status: CaseStatus;
  /** What the framework said about it, when it said anything. */
  message?: string;
}

export interface TestRun {
  /** The command that ran. */
  command: string;
  /** The partition's verdict: RUCALLTST ends in error when a test fails. */
  ok: boolean;
  cases: TestCase[];
  /** Counts as the framework reported them, when it reported them. Absent is not zero. */
  reported?: { tests: number; failures: number; errors: number };
  /** Lines of output that were not recognised as anything. */
  unread: number;
  /** The output itself, tail-truncated. The model reads this when the parse is thin. */
  output: string;
}

/** Where RPGUnit is, or that it is not there. */
export interface RpgUnitPresence {
  installed: boolean;
  /** The library the RUCALLTST command was found in. */
  library?: string;
}

/**
 * Is RPGUnit on this partition?
 *
 * Asked of the object catalogue rather than by running the command and seeing what happens: a
 * `RUCALLTST` that does not exist raises CPF0006 in the joblog, and "the command failed" is
 * indistinguishable from "a test failed" to anything reading an exit status. The question has a
 * direct answer, so it is asked directly.
 */
export function presenceSql(): string {
  return (
    `SELECT OBJLIB, OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('*ALLUSR', '*CMD', 'RUCALLTST')) X ` +
    `ORDER BY OBJLIB`
  );
}

export function readPresence(
  rows: Array<Record<string, unknown>>,
  read: (row: Record<string, unknown>, ...names: string[]) => string,
): RpgUnitPresence {
  for (const row of rows) {
    const name = read(row, "OBJNAME", "OBJECT_NAME").toUpperCase();
    if (name !== "RUCALLTST") continue;
    const library = read(row, "OBJLIB", "OBJECT_LIBRARY", "OBJLIBRARY").toUpperCase();
    return library ? { installed: true, library } : { installed: true };
  }
  return { installed: false };
}

/**
 * The sentence the tool returns when RPGUnit is not there.
 *
 * It names the product and where to get it, and it says what it will NOT do. "No tests failed" on a
 * partition with no test framework is the single most expensive thing this tool could say.
 */
export const NOT_INSTALLED =
  "RPGUnit is not on this partition: there is no RUCALLTST command in any user library. " +
  "I cannot run RPG unit tests, and I am not going to report that none failed — that would be a " +
  "green light nobody earned. RPGUnit (iRPGUnit) is free and installs as a library; ask whoever " +
  "administers the partition, then this tool will find it on its own.";

export interface TestRequest {
  /** The library holding the compiled test program. */
  library: string;
  /** The test program — a *PGM built from a member of RPGUnit test procedures. */
  program: string;
  /** One test procedure instead of all of them. */
  testCase?: string;
  /** `*ALL` asks RPGUnit for the per-test detail rather than only the summary. */
  detail?: boolean;
}

/**
 * The command, or why there is none.
 *
 * Qualified, like everything else that names an object here, and every name validated before it is
 * interpolated — the same rule and the same reason as `compileCommand`: these names came from the
 * model, and this becomes a CL command.
 */
/**
 * A test case is a PROCEDURE name, not an object name.
 *
 * `validName` is the QSYS.LIB rule — ten characters — and applying it here refused
 * `testRoundsHalfUp`, which is an entirely ordinary RPG procedure name and the shape every RPGUnit
 * example uses. A procedure name is long, so the bound is generous; what it still refuses is
 * everything that could end a CL parameter or a quoted string, which is the only reason this
 * function exists.
 */
const PROCEDURE = /^[A-Za-z#$@][A-Za-z0-9#$@_]{0,127}$/;

export function validProcedureName(name: string): boolean {
  return PROCEDURE.test((name ?? "").trim());
}

export function testCommand(request: TestRequest): { command: string } | { refused: string } {
  const bad = [
    ["library", request.library, validName] as const,
    ["program", request.program, validName] as const,
    ...(request.testCase ? [["test case", request.testCase, validProcedureName] as const] : []),
  ].filter(([, value, check]) => !check(String(value)));
  if (bad.length) {
    return {
      refused:
        `Not a usable IBM i name: ${bad.map(([what, value]) => `${what} “${value}”`).join(", ")}. ` +
        `I refuse a name rather than quoting it, because it is about to become part of a command.`,
    };
  }
  const parts = [`RUCALLTST TSTPGM(${up(request.library)}/${up(request.program)})`];
  if (request.testCase) parts.push(`TSTPRC(${up(request.testCase)})`);
  if (request.detail) parts.push("RPTDTL(*ALL)");
  return { command: parts.join(" ") };
}

function up(value: string): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * One test's result, when a line clearly is one.
 *
 * Three shapes, all of which carry a procedure name and a word for the outcome, in either order.
 * Anything else is counted as unread rather than guessed at — see the header.
 */
const CASE_PATTERNS: Array<{ re: RegExp; name: 1 | 2; status: 1 | 2 }> = [
  // `testAddsVat . . . . . : passed`   /   `testAddsVat ... FAILED`
  { re: /^\s*([A-Za-z_][A-Za-z0-9_#$@]*)\s*[.\s]*[:\-]?\s*(passed|success|successful|ok|failed|failure|error)\b/i, name: 1, status: 2 },
  // `FAILED: testAddsVat`   /   `Error in testAddsVat`
  { re: /^\s*(passed|success|successful|ok|failed|failure|error)(?:\s+in)?\s*[:\-]\s*([A-Za-z_][A-Za-z0-9_#$@]*)/i, name: 2, status: 1 },
  { re: /^\s*(error)\s+in\s+([A-Za-z_][A-Za-z0-9_#$@]*)/i, name: 2, status: 1 },
];

/** `Tests: 7, Failures: 1, Errors: 0` in any order, with any separators. */
const COUNTS = {
  tests: /\b(?:tests?|test\s+cases?)\s*[:=]?\s*(\d+)/i,
  failures: /\bfailures?\s*[:=]?\s*(\d+)/i,
  errors: /\berrors?\s*[:=]?\s*(\d+)/i,
};

function statusOf(word: string): CaseStatus {
  const lower = word.toLowerCase();
  if (lower.startsWith("fail")) return "failed";
  if (lower.startsWith("error")) return "error";
  return "passed";
}

export interface TestParse {
  cases: TestCase[];
  reported?: { tests: number; failures: number; errors: number };
  unread: number;
}

export function parseTestOutput(output: string): TestParse {
  const cases: TestCase[] = [];
  let reported: { tests: number; failures: number; errors: number } | undefined;
  let unread = 0;

  for (const raw of (output ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const tests = COUNTS.tests.exec(line);
    const failures = COUNTS.failures.exec(line);
    // A summary line is one that carries at least the number of tests AND one of the two failure
    // counts. A line saying only "3 errors" is not a summary, it is a sentence.
    if (tests && (failures || COUNTS.errors.test(line))) {
      reported = {
        tests: Number(tests[1]),
        failures: failures ? Number(failures[1]) : 0,
        errors: Number(COUNTS.errors.exec(line)?.[1] ?? 0),
      };
      continue;
    }

    let matched = false;
    for (const pattern of CASE_PATTERNS) {
      const m = pattern.re.exec(line);
      if (!m) continue;
      const name = m[pattern.name]!;
      const status = statusOf(m[pattern.status]!);
      // A name that is only the outcome word is not a test name.
      if (/^(passed|success|successful|ok|failed|failure|error)$/i.test(name)) break;
      const rest = line.slice(m[0].length).replace(/^[\s:\-.]+/, "").trim();
      cases.push({ name, status, ...(rest ? { message: rest } : {}) });
      matched = true;
      break;
    }
    if (!matched) unread++;
  }

  return { cases, ...(reported ? { reported } : {}), unread };
}

export const MAX_OUTPUT = 4000;

/**
 * The result the model reads.
 *
 * The verdict first, and it is the command's. Then what was understood, then — always — how much
 * was not, because a thin parse of a failing run is exactly when the raw output is worth more than
 * our summary of it.
 */
export function formatTestRun(run: TestRun): string {
  const lines: string[] = [];
  const failed = run.cases.filter((c) => c.status !== "passed");
  lines.push(run.ok ? `${run.command} — all tests passed.` : `${run.command} — FAILED.`);

  if (run.reported) {
    lines.push(
      "",
      `RPGUnit reported ${run.reported.tests} test(s), ${run.reported.failures} failure(s), ${run.reported.errors} error(s).`,
    );
  }
  if (run.cases.length) {
    lines.push("", `${run.cases.length} test(s) read from the output:`);
    for (const c of run.cases) {
      lines.push(`  ${c.status === "passed" ? "pass" : c.status.toUpperCase()} ${c.name}${c.message ? ` — ${c.message}` : ""}`);
    }
  } else {
    // Never "0 tests failed". The distinction between "nothing failed" and "I could not read the
    // output" is the whole reason this function exists.
    lines.push(
      "",
      run.ok
        ? "I could not read any individual test from the output, so the pass is the command's verdict and not a count of mine."
        : "I could not read any individual test from the output. The run failed; read what it printed, below.",
    );
  }
  if (run.unread) lines.push("", `${run.unread} line(s) of the output were not in a shape I recognise.`);
  if (failed.length || !run.ok || !run.cases.length) {
    lines.push("", "What it printed:", run.output.slice(-MAX_OUTPUT).trim());
  }
  return lines.join("\n");
}
