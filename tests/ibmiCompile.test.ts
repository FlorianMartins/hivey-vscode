// Compiling on the partition, and reading what the compiler said.
//
// ⚠️ THE FIXTURES ARE CONSTRUCTED, NOT RECORDED. There is no IBM i partition on the machine this
// was written on, so every listing below is built from the documented layout of that listing and
// not captured from a real compile. What that buys and what it does not:
//
//   • it buys the behaviour that matters — the identifier, the severity, the line number when one
//     is offered, the summary's occurrence count NOT read as a line number, the merge between the
//     joblog and the listing — all of which are decisions in our code;
//   • it does not buy "this works on a V7R5 partition". That stays NON VÉRIFIÉ, is written down in
//     `docs/ROADMAP.md`, and is why the parser never depends on a fixed column.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compilableTypes,
  compileAllowed,
  compileApproval,
  compileCommand,
  errorsOnly,
  formatReport,
  mergeMessages,
  messagesFromJoblog,
  parseCompileListing,
  runCompile,
  type CompileMessage,
} from "../src/core/ibmi/compile.js";
import { cell } from "../src/core/ibmi/sql.js";
import { toolsForMode } from "../src/core/session/modes.js";
import type { Tool } from "../src/core/agent/loop.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = { library: "DEVCFC", sourceFile: "QRPGLESRC", member: "CUSTRPT", extension: "rpgle" };

// ── Which command ────────────────────────────────────────────────────────────────────────────────

test("each member type gets its own create command, qualified by library", () => {
  const cases: Array<[string, string, string]> = [
    ["rpgle", "CRTBNDRPG", "PGM(TSTCFC/CUSTRPT)"],
    ["sqlrpgle", "CRTSQLRPGI", "OBJ(TSTCFC/CUSTRPT)"],
    ["clle", "CRTBNDCL", "PGM(TSTCFC/CUSTRPT)"],
    ["pf", "CRTPF", "FILE(TSTCFC/CUSTRPT)"],
    ["lf", "CRTLF", "FILE(TSTCFC/CUSTRPT)"],
    ["dspf", "CRTDSPF", "FILE(TSTCFC/CUSTRPT)"],
    ["prtf", "CRTPRTF", "FILE(TSTCFC/CUSTRPT)"],
  ];
  for (const [extension, program, target] of cases) {
    const out = compileCommand({ source: { ...source, extension }, targetLibrary: "TSTCFC" });
    assert.ok("command" in out, `${extension} was refused`);
    assert.match(out.command, new RegExp(`^${program} `), extension);
    assert.ok(out.command.includes(target), `${extension}: ${out.command}`);
    // The source is always qualified too: nothing here resolves against the job's library list.
    assert.ok(out.command.includes("SRCFILE(DEVCFC/QRPGLESRC)"), out.command);
    assert.ok(out.command.includes("SRCMBR(CUSTRPT)"), out.command);
  }
});

test("a module is asked for by name, and refused where there is no module to create", () => {
  const module = compileCommand({ source, targetLibrary: "TSTCFC", module: true });
  assert.ok("command" in module);
  assert.match(module.command, /^CRTRPGMOD MODULE\(TSTCFC\/CUSTRPT\)/);

  const none = compileCommand({ source: { ...source, extension: "dspf" }, targetLibrary: "TSTCFC", module: true });
  assert.ok("refused" in none);
  assert.match(none.refused, /no module compile/);
});

test("an unknown member type is refused, never compiled with the nearest compiler", () => {
  // RPG III is the tempting one: `.rpg` looks like RPG, CRTBNDRPG exists, and the result would be
  // a listing full of real-looking errors about code that is fine.
  for (const extension of ["rpg", "cbl", "txt", ""]) {
    const out = compileCommand({ source: { ...source, extension }, targetLibrary: "TSTCFC" });
    assert.ok("refused" in out, `${extension} was accepted`);
    assert.ok(out.refused.includes("rpgle"), "the refusal must say what it does compile");
  }
  assert.deepEqual(compilableTypes(), ["clle", "dspf", "lf", "pf", "prtf", "rpgle", "sqlrpgle"]);
});

test("names are upper-cased, because QSYS.LIB is", () => {
  const out = compileCommand({
    source: { library: "devcfc", sourceFile: "qrpgsrc", member: "custrpt", extension: "RPGLE" },
    targetLibrary: "tstcfc",
  });
  assert.ok("command" in out);
  assert.equal(out.command, "CRTBNDRPG PGM(TSTCFC/CUSTRPT) SRCFILE(DEVCFC/QRPGSRC) SRCMBR(CUSTRPT)");
});

// ── What the compiler said ───────────────────────────────────────────────────────────────────────

test("an ILE RPG listing gives the identifier, the severity and the statement", () => {
  const listing = [
    "     10 C                   EVAL      count = count + 1",
    "     11 C                   EVAL      total = total + CUSBAL",
    "      ======>                                            aaaaaa",
    "      *RNF7030 30 a       11 The name or indicator CUSBAL is not defined.",
    "     12 C                   ENDDO",
  ].join("\n");
  const { messages } = parseCompileListing(listing);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { id: "RNF7030", severity: 30, line: 11, text: "The name or indicator CUSBAL is not defined." });
});

test("free-form RPG, where the message carries the statement and no marker letter", () => {
  const listing = [
    "      4 dcl-s total packed(11:2);",
    "      5 total = total + CUSBAL;",
    "      *RNF7030 30        5 The name or indicator CUSBAL is not defined.",
  ].join("\n");
  const { messages } = parseCompileListing(listing);
  assert.deepEqual(messages, [
    { id: "RNF7030", severity: 30, line: 5, text: "The name or indicator CUSBAL is not defined." },
  ]);
});

test("RPG III, where the source lines are numbered and the message follows the line it is about", () => {
  const listing = [
    "   200 C                     ADD  1         COUNT",
    "   300 C                     MOVE CUSNAM    NAME",
    "      *RNF5377 20 The result of the MOVE is longer than the factor 2 field.",
  ].join("\n");
  const { messages } = parseCompileListing(listing);
  // No number of its own, so it is attributed to the last numbered source line — which is what the
  // printed listing means by putting it there.
  assert.deepEqual(messages, [
    { id: "RNF5377", severity: 20, line: 300, text: "The result of the MOVE is longer than the factor 2 field." },
  ]);
});

test("the SQL precompiler reports a position, not a statement number", () => {
  const listing = [
    "     22  EXEC SQL",
    "     23    update ACCOUNT set BALANCE = BALANCE - :cents",
    "      SQL0104 30 Position 23 Token ; was not valid.",
  ].join("\n");
  const { messages } = parseCompileListing(listing);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "SQL0104");
  assert.equal(messages[0]?.line, 23);
  assert.equal(messages[0]?.text, "Token ; was not valid.");
});

test("a CL listing", () => {
  const listing = [
    "     5     DLTF       FILE(&LIB/WRKCOPY)",
    "      *CPD0727 30 Position 1 Command DLTF not allowed in this context.",
  ].join("\n");
  const { messages } = parseCompileListing(listing);
  assert.deepEqual(messages, [
    { id: "CPD0727", severity: 30, line: 1, text: "Command DLTF not allowed in this context." },
  ]);
});

test("a DDS listing, where the message carries no number at all", () => {
  const listing = [
    "     7 A            CUSREF        15A  O  3 45",
    "      *CPD7596 30 Keyword DSPATR not valid for field CUSREF.",
  ].join("\n");
  const { messages } = parseCompileListing(listing);
  assert.deepEqual(messages, [
    { id: "CPD7596", severity: 30, line: 7, text: "Keyword DSPATR not valid for field CUSREF." },
  ]);
});

test("the summary's occurrence count is NOT read as a line number", () => {
  // The single most plausible way to produce a confident, wrong error list: the third column of the
  // message summary counts occurrences. `*RNF7030 30      2` means "twice", not "line 2".
  const listing = [
    "     11 C                   EVAL      total = total + CUSBAL",
    "      *RNF7030 30 a       11 The name or indicator CUSBAL is not defined.",
    "     19 C                   EVAL      x = CUSBAL",
    "      *RNF7030 30 a       19 The name or indicator CUSBAL is not defined.",
    "",
    "                            M e s s a g e   S u m m a r y",
    "  MsgId  Sv Number Message Text",
    "  *RNF7030 30      2 The name or indicator CUSBAL is not defined.",
    "  *RNF7066 00      1 Expression contains an operand with an invalid data type.",
  ].join("\n");
  const { messages, sawSummary } = parseCompileListing(listing);
  assert.equal(sawSummary, true);
  const lines = messages.filter((m) => m.id === "RNF7030").map((m) => m.line);
  assert.deepEqual(lines, [11, 19], `a count was read as a line: ${JSON.stringify(messages)}`);
  // And a message that appears ONLY in the summary is still reported, without a line.
  const summaryOnly = messages.find((m) => m.id === "RNF7066");
  assert.ok(summaryOnly, "a message only in the summary was dropped");
  assert.equal(summaryOnly.line, undefined, "the summary has no line to give");
});

test("a listing with nothing but a summary still produces the messages", () => {
  const listing = [
    "                            M e s s a g e   S u m m a r y",
    "  MsgId  Sv Number Message Text",
    "  *RNF7030 30      1 The name or indicator CUSBAL is not defined.",
  ].join("\n");
  const { messages } = parseCompileListing(listing);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "RNF7030");
  assert.equal(messages[0]?.line, undefined);
});

test("a number inside the message text is never mistaken for a line", () => {
  const listing = ["      *CPD7596 30 Keyword LEN 15 not valid for field CUSREF."].join("\n");
  const { messages } = parseCompileListing(listing);
  assert.equal(messages[0]?.text, "Keyword LEN 15 not valid for field CUSREF.");
  assert.equal(messages[0]?.line, undefined, "15 is part of the sentence, not a line number");
});

test("ordinary listing furniture is not mistaken for a message", () => {
  const listing = [
    "5770WDS V7R5M0  210331                 Create Bound RPG Program",
    "  Program . . . . . . . . . . . . . . . . . . :   CUSTRPT",
    "  Library . . . . . . . . . . . . . . . . . . :     TSTCFC",
    "     1 **free",
    "     2 ctl-opt dftactgrp(*no);",
    "                          * * * * *   E N D   O F   S O U R C E   * * * * *",
  ].join("\n");
  const { messages } = parseCompileListing(listing);
  assert.deepEqual(messages, [], `invented messages: ${JSON.stringify(messages)}`);
});

// ── The joblog, and the two sources together ─────────────────────────────────────────────────────

test("the joblog arrives as columns, so nothing is parsed", () => {
  const rows = [
    { MESSAGE_ID: "RNF7030", SEVERITY: 30, MESSAGE_TEXT: "The name or indicator CUSBAL is not defined." },
    { MESSAGE_ID: "CPF1124", SEVERITY: 0, MESSAGE_TEXT: "Job 123456/QUSER/QPADEV started." },
    { MESSAGE_ID: null, SEVERITY: 0, MESSAGE_TEXT: "an immediate message has no identifier" },
  ];
  const messages = messagesFromJoblog(rows, cell);
  assert.equal(messages.length, 2, "a message with no identifier is not a compiler message");
  assert.equal(messages[0]?.id, "RNF7030");
  assert.equal(messages[0]?.severity, 30);
});

test("the joblog's column names vary by release, and several spellings are accepted", () => {
  const messages = messagesFromJoblog([{ MessageId: "RNF7030", MsgSev: "30", MessageText: "nope" }], cell);
  assert.deepEqual(messages, [{ id: "RNF7030", severity: 30, text: "nope" }]);
});

test("merging keeps the copy that knows which line it is on", () => {
  const fromJoblog: CompileMessage[] = [{ id: "RNF7030", severity: 30, text: "not defined" }];
  const fromListing: CompileMessage[] = [{ id: "RNF7030", severity: 30, line: 11, text: "not defined" }];
  for (const order of [[fromJoblog, fromListing], [fromListing, fromJoblog]]) {
    const merged = mergeMessages(...order);
    assert.equal(merged.length, 1, "the same message was reported twice");
    assert.equal(merged[0]?.line, 11, "the line number was lost in the merge");
  }
});

test("the worst comes first, and only severity 20 and above is an error", () => {
  const merged = mergeMessages([
    { id: "RNF7066", severity: 0, text: "informational" },
    { id: "RNF5377", severity: 20, text: "truncation", line: 300 },
    { id: "RNF7030", severity: 30, text: "undefined", line: 11 },
  ]);
  assert.deepEqual(merged.map((m) => m.id), ["RNF7030", "RNF5377", "RNF7066"]);
  assert.deepEqual(errorsOnly(merged).map((m) => m.id), ["RNF7030", "RNF5377"]);
});

// ── The report the model reads ───────────────────────────────────────────────────────────────────

test("a failed compile says the object was not created, and lists the errors with their lines", () => {
  const text = formatReport({
    command: "CRTBNDRPG PGM(TSTCFC/CUSTRPT) SRCFILE(DEVCFC/QRPGLESRC) SRCMBR(CUSTRPT)",
    target: { library: "TSTCFC", object: "CUSTRPT" },
    ok: false,
    messages: [
      { id: "RNF7030", severity: 30, line: 11, text: "The name or indicator CUSBAL is not defined.", member: "CUSTRPT" },
      { id: "RNF7066", severity: 0, text: "Informational." },
    ],
    sources: { joblog: true, listing: true },
    gaps: [],
  });
  assert.match(text, /FAILED/);
  assert.match(text, /was not created/);
  assert.match(text, /1 error\(s\)/);
  assert.match(text, /CUSTRPT:11 RNF7030/);
  assert.match(text, /1 warning\(s\)/);
});

test("a compile whose listing could not be read says so, instead of reporting no errors", () => {
  // The dangerous shape: failed, and no messages. A model told only "it failed" invents a cause.
  const text = formatReport({
    command: "CRTDSPF FILE(TSTCFC/ORDDSP) SRCFILE(DEVCFC/QDDSSRC) SRCMBR(ORDDSP)",
    target: { library: "TSTCFC", object: "ORDDSP" },
    ok: false,
    messages: [],
    sources: { joblog: false, listing: false },
    gaps: ["the compile listing (no spooled file found for this job)", "the joblog (QSYS2.JOBLOG_INFO is not available)"],
  });
  assert.match(text, /No messages could be read, which is itself a problem/);
  assert.match(text, /What I could not read: the compile listing/);
});

test("a successful compile names the object it created", () => {
  const text = formatReport({
    command: "CRTBNDRPG PGM(TSTCFC/CUSTRPT) SRCFILE(DEVCFC/QRPGLESRC) SRCMBR(CUSTRPT)",
    target: { library: "TSTCFC", object: "CUSTRPT" },
    ok: true,
    messages: [],
    sources: { joblog: true, listing: true },
    gaps: [],
  });
  assert.match(text, /created TSTCFC\/CUSTRPT/);
  assert.match(text, /No messages\./);
});

// ── Names, before they become a command ──────────────────────────────────────────────────────────

test("a name that is not an IBM i name is refused, not quoted", () => {
  // Every name here is interpolated into a CL command and into SQL, and every one of them was
  // chosen by the model. This is the test that stops a tool call from becoming a different command.
  const attacks = [
    "CUSTRPT) MONMSG MSGID(CPF0000) DLTLIB LIB(PROD",
    "CUST'RPT",
    "A B",
    "TOOLONGNAMEHERE",
    "1START",
    "",
    "CUSTRPT; DROP",
  ];
  for (const member of attacks) {
    const out = compileCommand({ source: { ...source, member }, targetLibrary: "TSTCFC" });
    assert.ok("refused" in out, `accepted “${member}”`);
    assert.match(out.refused, /Not a usable IBM i name/);
  }
  // And the same for every other position, not just the member.
  assert.ok("refused" in compileCommand({ source: { ...source, library: "A)B" }, targetLibrary: "TSTCFC" }));
  assert.ok("refused" in compileCommand({ source: { ...source, sourceFile: "A B" }, targetLibrary: "TSTCFC" }));
  assert.ok("refused" in compileCommand({ source, targetLibrary: "PROD) FOO(" }));
  // The national characters are real names and must still work.
  assert.ok("command" in compileCommand({ source: { ...source, member: "A#B$C@" }, targetLibrary: "TSTCFC" }));
});

// ── The gate ─────────────────────────────────────────────────────────────────────────────────────

test("an unconfigured list lets the compile through and says nothing is bounding it", () => {
  // Not the same rule as the production gate, deliberately: that one is OFF when the list is empty
  // because a default list would be one company's library names. A compile cannot be off — it
  // always creates an object — so the honest state is "ask, and say so".
  const verdict = compileAllowed("TSTCFC", []);
  assert.deepEqual(verdict, { allow: true, unconfigured: true });
  const card = compileApproval({ source, targetLibrary: "TSTCFC" }, []);
  assert.match(card, /nothing bounds this/);
  assert.match(card, /writableLibraries is empty/);
});

test("a configured list bounds the compile, and the refusal says what is allowed", () => {
  assert.deepEqual(compileAllowed("TSTCFC", ["TSTCFC", "DEVCFC"]), { allow: true, unconfigured: false });
  assert.deepEqual(compileAllowed("devcfc", ["TSTCFC", "DEVCFC"]), { allow: true, unconfigured: false });
  const refused = compileAllowed("PRODCFC", ["TSTCFC", "DEVCFC"]);
  assert.equal(refused.allow, false);
  assert.match(refused.reason, /PRODCFC is not in hiveyCode.ibmi.writableLibraries/);
  assert.match(refused.reason, /TSTCFC, DEVCFC/);
  // The card does not warn when the list is doing its job.
  assert.equal(/nothing bounds this/.test(compileApproval({ source, targetLibrary: "TSTCFC" }, ["TSTCFC"])), false);
});

// ── Running it: the three sources, and what happens when one is missing ─────────────────────────

interface Fake {
  code?: number;
  stdout?: string;
  stderr?: string;
  spool?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  joblog?: Array<Record<string, unknown>>;
  fail?: (statement: string) => string | undefined;
}

function io(fake: Fake): Parameters<typeof runCompile>[1] & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    user: "FMARTINS",
    read: cell,
    async command() {
      return { code: fake.code ?? 0, stdout: fake.stdout ?? "", stderr: fake.stderr ?? "" };
    },
    async sql(statement: string) {
      asked.push(statement);
      const boom = fake.fail?.(statement);
      if (boom) throw new Error(boom);
      if (statement.includes("OUTPUT_QUEUE_ENTRIES")) return fake.spool ?? [];
      if (statement.includes("SPOOLED_FILE_DATA")) return fake.data ?? [];
      if (statement.includes("JOBLOG_INFO")) return fake.joblog ?? [];
      return [];
    },
  };
}

const SPOOL = [{ JOB_NAME: "123456/FMARTINS/QPADEV0001", SPOOLED_FILE_NAME: "CUSTRPT", FILE_NUMBER: 3 }];

test("a failed compile reports the command, the verdict and the errors from all three sources", async () => {
  const out = await runCompile(
    { source, targetLibrary: "TSTCFC" },
    io({
      code: 2,
      stderr: "*RNF7030 30 The name or indicator CUSBAL is not defined.",
      spool: SPOOL,
      data: [
        { SPOOLED_DATA: "     11 C                   EVAL      total = total + CUSBAL" },
        { SPOOLED_DATA: "      *RNF7030 30 a       11 The name or indicator CUSBAL is not defined." },
      ],
      joblog: [{ MESSAGE_ID: "CPF1124", SEVERITY: 0, MESSAGE_TEXT: "Job started." }],
    }),
  );
  assert.ok("report" in out);
  const { report } = out;
  assert.equal(report.ok, false, "a non-zero exit means no object was created");
  assert.deepEqual(report.sources, { joblog: true, listing: true });
  assert.deepEqual(report.gaps, []);
  // One RNF7030, not three, and the copy that knows it is on line 11.
  const rnf = report.messages.filter((m) => m.id === "RNF7030");
  assert.equal(rnf.length, 1, `reported ${rnf.length} times`);
  assert.equal(rnf[0]?.line, 11);
  assert.equal(rnf[0]?.member, "CUSTRPT");
});

test("the joblog is read for the job that COMPILED, not for the current one", async () => {
  // The command runs in one job and the SQL in another, so JOBLOG_INFO('*') would return the log of
  // the SQL job: a log with nothing about the compile in it, presented as the compiler's output.
  const fake = io({ code: 2, spool: SPOOL });
  await runCompile({ source, targetLibrary: "TSTCFC" }, fake);
  const joblog = fake.asked.find((s) => s.includes("JOBLOG_INFO"));
  assert.ok(joblog, "the joblog was never read");
  assert.match(joblog, /JOBLOG_INFO\('123456\/FMARTINS\/QPADEV0001'\)/);
  assert.equal(/JOBLOG_INFO\('\*'\)/.test(joblog), false);
});

test("no spooled file: a named gap, and the command's own output still reported", async () => {
  const out = await runCompile(
    { source, targetLibrary: "TSTCFC" },
    io({ code: 2, stderr: "*RNF7030 30 The name or indicator CUSBAL is not defined.", spool: [] }),
  );
  assert.ok("report" in out);
  assert.equal(out.report.sources.listing, false);
  assert.match(out.report.gaps.join(" "), /no spooled file named CUSTRPT for FMARTINS/);
  assert.match(out.report.gaps.join(" "), /could not establish which job compiled it/);
  assert.equal(out.report.messages.length, 1, "the command's own output is still a source");
});

test("a source that throws costs a gap, not the report", async () => {
  const out = await runCompile(
    { source, targetLibrary: "TSTCFC" },
    io({
      code: 2,
      spool: SPOOL,
      fail: (s) => (s.includes("JOBLOG_INFO") ? "SQL0204 JOBLOG_INFO in QSYS2 type *N not found." : undefined),
      data: [{ SPOOLED_DATA: "      *RNF7030 30 a       11 not defined" }],
    }),
  );
  assert.ok("report" in out);
  assert.equal(out.report.sources.listing, true, "one source failing must not take the other down");
  assert.equal(out.report.sources.joblog, false);
  assert.match(out.report.gaps.join(" "), /the joblog of 123456\/FMARTINS\/QPADEV0001 \(SQL0204/);
});

test("a job name the partition gave that is not a job name is not put back into SQL", async () => {
  const fake = io({ code: 2, spool: [{ JOB_NAME: "'); DROP TABLE X; --", SPOOLED_FILE_NAME: "CUSTRPT", FILE_NUMBER: 1 }] });
  const out = await runCompile({ source, targetLibrary: "TSTCFC" }, fake);
  assert.ok("report" in out);
  assert.equal(fake.asked.some((s) => s.includes("DROP TABLE")), false, "it was interpolated into SQL");
  assert.match(out.report.gaps.join(" "), /is not one I can look up/);
});

test("a successful compile is ok even when a source could not be read", async () => {
  const out = await runCompile({ source, targetLibrary: "TSTCFC" }, io({ code: 0, spool: [] }));
  assert.ok("report" in out);
  assert.equal(out.report.ok, true, "the verdict is the command's exit status, not the completeness of the report");
  assert.ok(out.report.gaps.length);
});

test("a refused request never runs a command", async () => {
  let ran = false;
  const out = await runCompile(
    { source: { ...source, extension: "cbl" }, targetLibrary: "TSTCFC" },
    {
      user: "FMARTINS",
      read: cell,
      async command() {
        ran = true;
        return { code: 0, stdout: "", stderr: "" };
      },
      async sql() {
        return [];
      },
    },
  );
  assert.ok("refused" in out);
  assert.equal(ran, false, "a refusal must happen before the partition is touched");
});

// ── Where the tool is, and where it is not ───────────────────────────────────────────────────────

test("plan mode has no compiler, and the rule is the allow-list rather than a flag", () => {
  const ibmi = ["ibmi_member", "ibmi_members", "ibmi_objects", "ibmi_library_list", "ibmi_sql", "ibmi_command", "ibmi_compile"].map(
    (name): Tool => ({
      schema: { name, description: name, parameters: { type: "object", properties: {} } },
      approval: () => false,
      run: async () => ({ content: "ok" }),
    }),
  );
  const planned = toolsForMode(ibmi, "plan").map((t) => t.schema.name);
  assert.equal(planned.includes("ibmi_compile"), false, "plan mode must not be able to create an object");
  // And the reason: READ_ONLY is an allow-list, so a new tool is powerless until it is named there.
  assert.deepEqual(new Set(planned), new Set(["ibmi_member", "ibmi_members", "ibmi_objects", "ibmi_library_list"]));
  assert.equal(toolsForMode(ibmi, "agent").map((t) => t.schema.name).includes("ibmi_compile"), true);
});

test("the compiler is wired into the tool list and into the verdict, and a test says so", () => {
  // The two halves that a unit test cannot reach, read from the source. `buildIbmiTools` needs a
  // live Code for IBM i to call, and `verifyTurn`'s list is a set of names — so the thing that can
  // silently come undone is the WIRING, which is exactly what a source scan can hold.
  const tools = readFileSync(join("src", "extension", "integrations", "ibmi.ts"), "utf8");
  assert.match(tools, /name: "ibmi_compile"/, "the tool is not declared");
  assert.match(tools, /return \[[^\]]*\bcompile\b[^\]]*\]/, "the tool is declared but never returned");
  assert.match(tools, /runCompile\(/, "the tool does not run the compile from core");

  const outcome = readFileSync(join("src", "core", "router", "outcome.ts"), "utf8");
  assert.match(outcome, /VERIFIERS = new Set\(\[[^\]]*"ibmi_compile"/, "a compile is not counted as a verification");
  assert.match(outcome, /MUTATORS = new Set\(\[[^\]]*"ibmi_compile"/, "a compile is not counted as a change");
});
