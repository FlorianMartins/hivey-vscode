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
