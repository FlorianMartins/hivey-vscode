// Following a member's dependencies means parsing the directive that names them, which carries more
// than a name: where the copybook lives decides whether it can be fetched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCalledPrograms, extractCopyDirectives } from "../src/core/ibmi/symbols.js";

test("a bare /COPY means the member's own source file", () => {
  assert.deepEqual(extractCopyDirectives("/COPY CUSTPR"), [{ member: "CUSTPR" }]);
});

test("file,member and library/file,member are both understood", () => {
  assert.deepEqual(extractCopyDirectives("/copy qcpysrc,custpr"), [{ sourceFile: "QCPYSRC", member: "CUSTPR" }]);
  assert.deepEqual(extractCopyDirectives("/COPY MYLIB/QCPYSRC,CUSTPR"), [
    { library: "MYLIB", sourceFile: "QCPYSRC", member: "CUSTPR" },
  ]);
});

test("the comma is what the map extractor could not see", () => {
  // `extractIbmiReferences` splits on whitespace and slashes, so `QCPYSRC,CUSTPR` came out as the
  // source FILE and the member was lost — fine for ranking a map, useless for going to fetch one.
  const [ref] = extractCopyDirectives("      /COPY QCPYSRC,CUSTPR");
  assert.equal(ref?.member, "CUSTPR");
});

test("/INCLUDE is the same directive under the precompiler's name", () => {
  assert.deepEqual(extractCopyDirectives("/INCLUDE QCPYSRC,SQLDS"), [{ sourceFile: "QCPYSRC", member: "SQLDS" }]);
});

test("the same copybook twice is one dependency", () => {
  assert.equal(extractCopyDirectives("/COPY A\n/COPY A\n/copy a").length, 1);
});

test("a directive indented past the specification columns is still found", () => {
  // Fixed-format RPG puts it well into the line; anchoring on the start of the line missed it.
  assert.equal(extractCopyDirectives("     H/COPY QCPYSRC,HSPEC")[0]?.member, "HSPEC");
});

test("called programs are read from both the free and the fixed forms", () => {
  const source = `
    callp custval('X');
    CALL 'ORDCHK'
    C                   CALL      'PRTINV'
    CALL PGM(SNDMAIL)
  `;
  const called = extractCalledPrograms(source);
  for (const name of ["ORDCHK", "PRTINV", "SNDMAIL"]) {
    assert.ok(called.includes(name), `${name} missing from ${called.join(", ")}`);
  }
});

test("a name longer than an object name is not a program", () => {
  // `CALLP myLocalProcedure(...)` is a procedure in this module, not something to go and fetch.
  assert.deepEqual(extractCalledPrograms("callp 'thisIsALocalProcedure'()"), []);
});
