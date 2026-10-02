// What an agent is allowed to change on the partition.
//
// This was not a feature request, it was a condition: "the agents must never interact with
// production". A condition like that cannot live in a prompt — a prompt is a request to a model,
// and a model that misreads one is the ordinary case. So it is a gate in code, and these are the
// three places where being lenient would have meant guessing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clOnlyReads, librariesNamed, refuseChange } from "../src/core/ibmi/guard.js";

const policy = { writable: ["TSTCFC", "DEVCFC"] };

test("nothing is refused until a list is configured", () => {
  // The default ships empty on purpose: a default list would be one company's library names handed
  // to everybody else's.
  assert.equal(refuseChange("DLTOBJ OBJ(PRDCFC/CUSTMAST) OBJTYPE(*FILE)", true, { writable: [] }), undefined);
});

test("a change inside the allowed libraries runs", () => {
  assert.equal(refuseChange("CRTBNDRPG PGM(TSTCFC/ORD001) SRCFILE(TSTCFC/QRPGLESRC)", true, policy), undefined);
  assert.equal(refuseChange("UPDATE DEVCFC.CUSTOMER SET NAME = 'x' WHERE ID = 1", true, policy), undefined);
});

test("a change touching production is refused, and says which library", () => {
  const refused = refuseChange("DLTOBJ OBJ(PRDCFC/CUSTMAST) OBJTYPE(*FILE)", true, policy);
  assert.deepEqual(refused, { reason: "outside", libraries: ["PRDCFC"] });
});

test("every library named has to be allowed, not just the first", () => {
  // A command that reads from production into test still touches production.
  const refused = refuseChange("CPYF FROMFILE(PRDCFC/CUSTMAST) TOFILE(TSTCFC/CUSTMAST) MBROPT(*REPLACE)", true, policy);
  assert.deepEqual(refused, { reason: "outside", libraries: ["PRDCFC"] });
});

test("a change that names no library at all is refused", () => {
  // It would resolve against the job's library list, which is not knowable from here and may well
  // start with production. Something that cannot be checked does not go through a gate whose whole
  // purpose is to check it.
  assert.deepEqual(refuseChange("DLTOBJ OBJ(CUSTMAST) OBJTYPE(*FILE)", true, policy), { reason: "unqualified" });
});

test("reading is never restricted", () => {
  assert.equal(refuseChange("DSPFD FILE(PRDCFC/CUSTMAST)", false, policy), undefined);
  assert.equal(refuseChange("SELECT * FROM PRDCFC.CUSTMAST", false, policy), undefined);
});

test("an unrecognized CL verb counts as a change", () => {
  // The asymmetry is deliberate. Being wrong this way costs a refusal the user can lift; being
  // wrong the other way costs a production file.
  assert.equal(clOnlyReads("DSPFD FILE(X/Y)"), true);
  assert.equal(clOnlyReads("RTVOBJD OBJ(X/Y)"), true);
  assert.equal(clOnlyReads("DLTOBJ OBJ(X/Y)"), false);
  assert.equal(clOnlyReads("CALL PGM(X/Y)"), false);
  assert.equal(clOnlyReads("SBMJOB CMD(CALL PGM(X/Y))"), false);
  assert.equal(clOnlyReads("WRKOBJ OBJ(X/Y)"), false, "a WRK screen is a menu onto commands that change things");
  assert.equal(clOnlyReads("SOMETHINGNOBODYLISTED PARM(X/Y)"), false);
});

test("the command's own library is not mistaken for its target", () => {
  assert.equal(clOnlyReads("QSYS/DSPFD FILE(X/Y)"), true);
});

test("library names are found in both the CL and the SQL spelling", () => {
  assert.deepEqual(librariesNamed("CRTBNDRPG PGM(tstcfc/ORD001)"), ["TSTCFC"]);
  assert.deepEqual(librariesNamed("SELECT * FROM devcfc.CUSTOMER"), ["DEVCFC"]);
  assert.deepEqual(librariesNamed("no library here"), []);
});

test("a national character is a legal first letter of a library name", () => {
  assert.deepEqual(librariesNamed("DLTOBJ OBJ(#LIB/X)"), ["#LIB"]);
});

// ── A shell is not a reader ─────────────────────────────────────────────────────────────────────
//
// `READING_VERBS` held QSH and STRSQL. `QSH CMD('rm -r /QSYS.LIB/PROD.LIB')` was therefore a READ,
// and walked straight past the gate that exists to keep the agent out of production. The same is
// true of anything that runs a command it was handed as a string: the target is inside the string,
// and the gate cannot see it.

test("a shell command is refused, whatever it appears to touch", () => {
  // Refused as OPAQUE rather than as "outside": the point is not that this one names PROD, it is
  // that nothing here can tell what a shell line will do. A version naming DEVCFC is refused too.
  for (const command of [
    "QSH CMD('rm -r /QSYS.LIB/PROD.LIB')",
    "QSH CMD('rm -r /QSYS.LIB/DEVCFC.LIB/X')",
    "STRQSH",
    "STRQSH PARM('ls')",
  ]) {
    const refused = refuseChange(command, true, policy);
    assert.equal(refused?.reason, "opaque", `${command} was not refused`);
  }
});

test("a command submitted to batch is read through its CMD parameter", () => {
  assert.deepEqual(refuseChange("SBMJOB CMD(DLTF FILE(PROD/X))", true, policy), {
    reason: "outside",
    libraries: ["PROD"],
  });
  // And the same submission into an allowed library goes through.
  assert.equal(refuseChange("SBMJOB CMD(DLTF FILE(DEVCFC/X))", true, policy), undefined);
});

test("a shell wrapped in a submission is still a shell", () => {
  assert.equal(refuseChange("SBMJOB CMD(QSH CMD('rm -r /QSYS.LIB/PROD.LIB'))", true, policy)?.reason, "opaque");
});

test("SQL that runs a CL command is refused", () => {
  // QCMDEXC takes the command as a string. Whatever the gate reads in that string, the partition
  // reads something else the moment it is built at run time.
  assert.equal(refuseChange("CALL QSYS2.QCMDEXC('DLTF PROD/X')", true, policy)?.reason, "opaque");
  assert.equal(refuseChange("CALL QSYS2.QCMDEXC('DLTF DEVCFC/X')", true, policy)?.reason, "opaque");
});

test("QSH is no longer a reader, and neither is STRSQL", () => {
  assert.equal(clOnlyReads("QSH CMD('ls')"), false);
  assert.equal(clOnlyReads("STRSQL"), false);
  // The real readers are untouched.
  assert.equal(clOnlyReads("DSPFD FILE(X/Y)"), true);
  assert.equal(clOnlyReads("RTVOBJD OBJ(X/Y)"), true);
});

test("a member whose name merely starts with QSH is not a shell", () => {
  // `\bQSH\b` and not a prefix match: QSHELLDOC is a name, not an interpreter.
  assert.equal(refuseChange("CRTBNDRPG PGM(DEVCFC/QSHELLDOC) SRCFILE(DEVCFC/QRPGLESRC)", true, policy), undefined);
});

test("nothing is refused as opaque while the gate is off", () => {
  assert.equal(refuseChange("QSH CMD('rm -rf /')", true, { writable: [] }), undefined);
});

test("reading is still never restricted, shell or not", () => {
  assert.equal(refuseChange("QSH CMD('ls')", false, policy), undefined);
});
