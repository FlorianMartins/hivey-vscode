// IBM i dialects. The tests that matter here are the ones about FORMAT, not about keywords: a
// wrong keyword produces an error message, a wrong column produces a member that compiles into
// something else. Every fixture below is written the way the platform writes it — five leading
// spaces before the specification letter — because that is the only way the assertions mean
// anything.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIbmiSource, detectIbmiLanguage, ibmiLanguages, ibmiPrompt, memberTypeOf } from "../src/core/ibmi/languages.js";
import { extractIbmiReferences, extractIbmiSymbols } from "../src/core/ibmi/symbols.js";
import { extractSymbols } from "../src/core/context/symbols.js";

const FREE_RPG = `**FREE
ctl-opt dftactgrp(*no) actgrp(*caller);
dcl-f CUSTMAST usage(*update) keyed;
dcl-proc calcVat export;
  dcl-pi *n packed(9:2);
    amount packed(9:2) const;
  end-pi;
  return amount * 0.2;
end-proc;
`;

const FIXED_RPGLE = `     H DFTACTGRP(*NO)
     FCUSTMAST  UF   E           K DISK
     D calcVat         PR             9P 2
     D  amount                        9P 2 CONST
     C     KEY           CHAIN     CUSTMAST
     C                   IF        %FOUND(CUSTMAST)
     C                   ENDIF
`;

const RPG3 = `     H
     FCUSTMAST IF  E           K        DISK
     C           *IN01     DOWEQ*OFF
     C                     EXSR SUBR01
     C                     END
     C           SUBR01    BEGSR
     C                     ENDSR
`;

const DDS_PF = `     A          R CUSTREC                   TEXT('Customer')
     A            CUSNBR         6P 0       COLHDG('Customer' 'Number')
     A            CUSNAM        30A         COLHDG('Name')
     A          K CUSNBR
`;

const DSPF = `     A                                      DSPSIZ(24 80 *DS3)
     A                                      INDARA
     A          R HEADER
     A                                  1  2'Customer enquiry'
     A            CUSNBR         6P 0O  3  2EDTCDE(Z)
     A                                      CF03(03 'Exit')
`;

const CL = `             PGM        PARM(&LIB)
             DCL        VAR(&LIB) TYPE(*CHAR) LEN(10)
             DCLF       FILE(QTEMP/WORKF)
             MONMSG     MSGID(CPF0000) EXEC(GOTO CMDLBL(ERROR))
             CHGVAR     VAR(&LIB) VALUE('QGPL')
             CALL       PGM(MYPGM) PARM(&LIB)
 ERROR:
             ENDPGM
`;

const SQLRPGLE = `**FREE
ctl-opt option(*srcstmt);
dcl-s custName char(30);
exec sql declare custCursor cursor for
  select name from qgpl.custmast where id = :custId;
exec sql open custCursor;
exec sql fetch custCursor into :custName;
`;

// ── Detection ────────────────────────────────────────────────────────────────────────────────

test("a fully free member is recognised by its own switch, not by its name", () => {
  const lang = detectIbmiLanguage("src/CALCVAT.rpgle", FREE_RPG);
  assert.equal(lang?.id, "rpgle-free");
  assert.equal(lang?.fixedForm, false);
});

test("the same extension holding fixed-format source is reported as fixed", () => {
  // This is the case that costs the most: `.rpgle` says nothing about the format, and telling the
  // model "free-form" here makes it emit code the compiler cannot place.
  const lang = detectIbmiLanguage("src/CALCVAT.rpgle", FIXED_RPGLE);
  assert.equal(lang?.id, "rpgle-fixed");
  assert.equal(lang?.fixedForm, true);
});

test("RPG III is not ILE RPG, whatever it looks like", () => {
  const lang = detectIbmiLanguage("QRPGSRC/CUST.rpg", RPG3);
  assert.equal(lang?.id, "rpg3");
  assert.match(ibmiPrompt(lang!), /no procedures/i);
  assert.match(ibmiPrompt(lang!), /at most 6 characters/i);
});

test("embedded SQL wins over the RPG flavour, because the precompiler runs first", () => {
  assert.equal(detectIbmiLanguage("X.sqlrpgle", SQLRPGLE)?.id, "sqlrpgle");
  // Even a member named .rpgle is SQLRPGLE once it carries exec sql.
  assert.equal(detectIbmiLanguage("X.rpgle", SQLRPGLE)?.id, "sqlrpgle");
});

test("the DDS flavours are distinguished, because their rules differ", () => {
  assert.equal(detectIbmiLanguage("F.pf", DDS_PF)?.id, "dds-pf");
  assert.equal(detectIbmiLanguage("S.dspf", DSPF)?.id, "dds-dspf");
  assert.equal(detectIbmiLanguage("L.lf", "")?.id, "dds-lf");
  assert.equal(detectIbmiLanguage("R.prtf", "")?.id, "dds-prtf");
});

test("a QSYS member path carries its type, an IFS path does not", () => {
  assert.equal(memberTypeOf("/QGPL/QRPGLESRC/CALCVAT.RPGLE"), "RPGLE");
  assert.equal(memberTypeOf("/MYLIB/QDDSSRC/CUSTMAST.PF"), "PF");
  assert.equal(memberTypeOf("docs/README.md"), undefined, "a markdown file is not a member of type MD");
  assert.equal(detectIbmiLanguage("/QGPL/QCLSRC/START.CLLE", CL)?.id, "cl");
});

test("a file that is not IBM i source at all is left alone", () => {
  assert.equal(detectIbmiLanguage("src/index.ts", "export const a = 1;"), undefined);
  assert.equal(detectIbmiLanguage("README.md", "# hello"), undefined);
});

// ── What the model is told ───────────────────────────────────────────────────────────────────

test("a fixed-format dialect ships its column ruler, a free-form one does not", () => {
  const fixed = ibmiPrompt(detectIbmiLanguage("X.rpgle", FIXED_RPGLE)!);
  assert.match(fixed, /Column layout/);
  assert.match(fixed, /column 80/);

  const free = ibmiPrompt(detectIbmiLanguage("X.rpgle", FREE_RPG)!);
  assert.doesNotMatch(free, /Column layout/, "a ruler is the most expensive line in the prompt and buys nothing here");
});

test("Db2 for i is told apart from every other Db2", () => {
  const sql = ibmiPrompt(detectIbmiLanguage("q.sql", "select 1")!);
  assert.match(sql, /FETCH FIRST/);
  assert.match(sql, /SYSIBM\.SYSDUMMY1/);
  assert.match(sql, /QSYS2/);
});

test("every dialect says how a comment is written", () => {
  for (const lang of ibmiLanguages()) {
    assert.ok(lang.comment.length > 0, `${lang.id} has no comment syntax`);
    assert.ok(lang.rules.length >= 3, `${lang.id} carries too few rules to be useful`);
    assert.ok(lang.memberType.length > 0);
  }
});

// ── The local check ──────────────────────────────────────────────────────────────────────────

test("an over-long line in a fixed-format member is reported, because the compiler will not", () => {
  const lang = detectIbmiLanguage("X.rpgle", FIXED_RPGLE)!;
  const long = "     C" + "x".repeat(90);
  const problems = checkIbmiSource(lang, long);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /column 80/);
});

test("COBOL stops at 72, not at 80", () => {
  const lang = detectIbmiLanguage("P.cblle", "")!;
  assert.match(checkIbmiSource(lang, " ".repeat(7) + "x".repeat(70))[0]!, /column 72/);
});

test("a DDS line without A in column 6 is reported", () => {
  const lang = detectIbmiLanguage("F.pf", DDS_PF)!;
  assert.deepEqual(checkIbmiSource(lang, DDS_PF), [], "the fixture itself is valid");
  assert.match(checkIbmiSource(lang, "     X            CUSNBR")[0]!, /column 6 must be A/);
});

test("a free-form member is never checked for columns it does not have", () => {
  const lang = detectIbmiLanguage("X.rpgle", FREE_RPG)!;
  assert.deepEqual(checkIbmiSource(lang, "x".repeat(200)), []);
});

// ── Symbols ──────────────────────────────────────────────────────────────────────────────────

test("a free-form procedure, prototype and file are all found", () => {
  const syms = extractIbmiSymbols("X.rpgle", FREE_RPG);
  const names = syms.map((s) => s.name);
  assert.ok(names.includes("calcVat"), `expected calcVat, got ${names.join(", ")}`);
  assert.ok(names.includes("CUSTMAST"));
  assert.equal(syms.find((s) => s.name === "calcVat")?.kind, "function");
});

test("a fixed-format prototype is found in its columns, where no line-anchored regex looks", () => {
  const names = extractIbmiSymbols("X.rpgle", FIXED_RPGLE).map((s) => s.name);
  assert.ok(names.includes("calcVat"), `expected calcVat, got ${names.join(", ")}`);
  assert.ok(names.includes("CUSTMAST"));
});

test("RPG III yields its subroutines, which are the only named unit it has", () => {
  const syms = extractIbmiSymbols("C.rpg", RPG3);
  assert.ok(syms.some((s) => s.name === "SUBR01" && s.kind === "method"));
  assert.ok(syms.some((s) => s.name === "CUSTMAST"));
});

test("a DDS record format is a record, and its key is not", () => {
  const syms = extractIbmiSymbols("F.pf", DDS_PF);
  assert.equal(syms.find((s) => s.name === "CUSTREC")?.kind, "class");
  assert.ok(syms.some((s) => s.name === "CUSNAM"));
});

test("a display file yields its formats without drowning in constants", () => {
  const syms = extractIbmiSymbols("S.dspf", DSPF);
  assert.ok(syms.some((s) => s.name === "HEADER" && s.kind === "class"));
});

test("a CL program and its labels are found", () => {
  const syms = extractIbmiSymbols("S.clle", CL);
  assert.ok(syms.some((s) => s.kind === "function"), "the PGM itself");
  assert.ok(syms.some((s) => s.name === "WORKF" || s.name === "QTEMP/WORKF"));
});

test("an SQL cursor is part of a member's surface", () => {
  assert.ok(extractIbmiSymbols("X.sqlrpgle", SQLRPGLE).some((s) => s.name === "custCursor"));
});

test("the generic extractor delegates rather than returning nothing", () => {
  // The regression this guards: `.rpgle` matches no generic rule, so before the delegation an
  // IBM i repository produced a completely empty repository map.
  assert.ok(extractSymbols("X.rpgle", FREE_RPG).length > 0);
  assert.ok(extractSymbols("src/a.ts", "export function hello() {}").some((s) => s.name === "hello"));
});

// ── References ───────────────────────────────────────────────────────────────────────────────

test("what a member needs is collected, since IBM i has no import statement", () => {
  const refs = extractIbmiReferences("X.rpgle", FREE_RPG + "\n/copy QRPGLEREF,STDDEF\n");
  assert.ok(refs.includes("CUSTMAST"));
  assert.ok(refs.some((r) => r.includes("QRPGLEREF")));

  const cl = extractIbmiReferences("S.clle", CL);
  assert.ok(cl.includes("MYPGM"), `expected the called program, got ${cl.join(", ")}`);
});

test("a non-IBM i file contributes no IBM i references", () => {
  assert.deepEqual(extractIbmiReferences("src/a.ts", "import x from 'y'; call('z')"), []);
});
