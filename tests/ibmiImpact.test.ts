// "Who uses this?" — and how much the answer is worth.
//
// The expensive mistake here is not missing a reference. It is an answer that SOUNDS complete and
// is not: a text search of the source members that nobody can read as a search, pasted into a
// change request as an inventory. So most of what is tested below is the wording of the claim, not
// the arithmetic of the list.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTFILE,
  PROGRAM_REFERENCE_LIMITS,
  SOURCE_SEARCH_LIMITS,
  fieldMethod,
  formatImpact,
  programRefsCommand,
  programRefsQuery,
  referencesTo,
  type Impact,
} from "../src/core/ibmi/impact.js";
import { cell } from "../src/core/ibmi/sql.js";
import { refuseChange } from "../src/core/ibmi/guard.js";
import { toolsForMode } from "../src/core/session/modes.js";
import { BUILTIN_SKILLS } from "../src/core/session/skills.js";
import type { Tool } from "../src/core/agent/loop.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Where it writes ──────────────────────────────────────────────────────────────────────────────

test("the output file is in QTEMP, and the gate lets exactly that through", () => {
  const command = programRefsCommand("devcfc");
  assert.match(command, /OUTFILE\(QTEMP\/HVYPGMREF\)/);
  assert.equal(OUTFILE, "QTEMP/HVYPGMREF");
  // The command this tool actually runs, put through the production gate with production locked.
  assert.equal(refuseChange(command, true, { writable: ["TSTCFC"] }), undefined);
});

test("the output member is replaced, not appended to", () => {
  // A second call in the same job appending to the first one's answer would report a stale row as a
  // current reference, and QTEMP survives for the whole job.
  assert.match(programRefsCommand("DEVCFC"), /OUTMBR\(\*FIRST \*REPLACE\)/);
});

test("the whole library's references are produced, because the question is reversed", () => {
  // We do not know which programs use the file; that is what is being asked.
  assert.match(programRefsCommand("DEVCFC"), /PGM\(DEVCFC\/\*ALL\)/);
});

test("the read is bounded, so a truncated answer can know it was truncated", () => {
  assert.match(programRefsQuery(5000), /FETCH FIRST 5000 ROWS ONLY/);
  assert.match(programRefsQuery(10), /FETCH FIRST 10 ROWS ONLY/);
  assert.match(programRefsQuery(), /QTEMP\.HVYPGMREF/);
});

// ── Reading the rows ─────────────────────────────────────────────────────────────────────────────

const rows = [
  { WHLIB: "DEVCFC", WHPNAM: "ORDENT", WHOTYP: "*FILE", WHFNAM: "CUSTMAST", WHLNAM: "DEVCFC", WHSTMT: "*INPUT" },
  { WHLIB: "DEVCFC", WHPNAM: "ORDENT", WHOTYP: "*FILE", WHFNAM: "CUSTMAST", WHLNAM: "DEVCFC", WHSTMT: "*UPDATE" },
  { WHLIB: "DEVCFC", WHPNAM: "CUSTRPT", WHOTYP: "*FILE", WHFNAM: "CUSTMAST", WHLNAM: "", WHSTMT: "*INPUT" },
  { WHLIB: "DEVCFC", WHPNAM: "ORDRPT", WHOTYP: "*FILE", WHFNAM: "ORDHDR", WHLNAM: "DEVCFC", WHSTMT: "*INPUT" },
  { WHLIB: "DEVCFC", WHPNAM: "OTHER", WHOTYP: "*FILE", WHFNAM: "CUSTMAST", WHLNAM: "PRODCFC", WHSTMT: "*INPUT" },
];

test("the programs that reference the file are found, once each", () => {
  const found = referencesTo(rows, { library: "DEVCFC", name: "CUSTMAST" }, cell);
  // ORDENT references it twice and appears once; ORDRPT uses another file; OTHER's reference is to
  // a different library's copy.
  assert.deepEqual(found.map((r) => r.name), ["ORDENT", "CUSTRPT"]);
  assert.equal(found[0]?.usage, "*INPUT");
  assert.equal(found[0]?.library, "DEVCFC");
});

test("a reference recorded without a library is kept, not filtered out", () => {
  // It was compiled against the library list, which is exactly the kind of reference most likely to
  // matter — and the easiest to lose by requiring the library to match.
  const found = referencesTo(rows, { library: "DEVCFC", name: "CUSTMAST" }, cell);
  assert.ok(found.some((r) => r.name === "CUSTRPT"), "the unqualified reference was dropped");
});

test("a reference to another library's object of the same name is not ours", () => {
  const found = referencesTo(rows, { library: "DEVCFC", name: "CUSTMAST" }, cell);
  assert.equal(found.some((r) => r.name === "OTHER"), false, "PRODCFC/CUSTMAST is a different file");
});

test("the model file's field names are read under several spellings", () => {
  const alternative = [{ PROGRAM_LIBRARY: "DEVCFC", PROGRAM_NAME: "ORDENT", OBJECT_TYPE: "*FILE", OBJECT_REFERENCED: "CUSTMAST" }];
  const found = referencesTo(alternative, { library: "DEVCFC", name: "CUSTMAST" }, cell);
  assert.deepEqual(found, [{ library: "DEVCFC", name: "ORDENT", type: "*FILE" }]);
});

// ── Which method, and what it is worth ───────────────────────────────────────────────────────────

test("a field question is a search, and says so whether or not ARCAD is installed", () => {
  // ARCAD has a real cross-reference and this extension cannot call it: its REST catalogue is not
  // published, and inventing a path produces an integration that fails at the customer's site. So
  // the method never claims to be a cross-reference — what changes is that the answer names the
  // better door instead of pretending it is the best available.
  assert.equal(fieldMethod(false).method, "source-search");
  assert.equal(fieldMethod(true).method, "source-search");
  assert.deepEqual(fieldMethod(false).limits, SOURCE_SEARCH_LIMITS);
  assert.equal(fieldMethod(false).better, undefined);
  assert.match(fieldMethod(true).better ?? "", /ARCAD Elias is installed/);
  assert.match(fieldMethod(true).better ?? "", /does not guess ARCAD's REST paths/);
  assert.match(fieldMethod(true).better ?? "", /arcad_rest/);
});


const base: Impact = {
  subject: { library: "DEVCFC", name: "CUSTMAST" },
  method: "program-references",
  references: [{ library: "DEVCFC", name: "ORDENT", type: "*FILE", usage: "*UPDATE" }],
  truncated: false,
  searched: ["DEVCFC", "TSTCFC"],
  limits: PROGRAM_REFERENCE_LIMITS,
};

test("the method is the first line, not a footnote", () => {
  // This result gets pasted into a change request. The difference between "the compiler recorded
  // these" and "I grepped what I could read" is the difference between a fact and a lead, and it
  // has to be readable before the list is.
  const fact = formatImpact(base);
  assert.match(fact.split("\n")[0]!, /DSPPGMREF/);
  const search = formatImpact({ ...base, method: "source-search", limits: SOURCE_SEARCH_LIMITS });
  assert.match(search.split("\n")[0]!, /text search of the source members/);
});

test("the libraries searched are stated, because an answer is only as wide as its search", () => {
  assert.match(formatImpact(base), /Looked in: DEVCFC, TSTCFC\./);
  assert.match(formatImpact({ ...base, searched: [] }), /no library was searched/);
});

test("finding nothing is never reported as “nothing uses it”", () => {
  const fact = formatImpact({ ...base, references: [] });
  assert.match(fact, /That is a fact about those libraries, not about the system/);
  assert.equal(/nothing uses it/i.test(fact), false);

  const search = formatImpact({ ...base, references: [], method: "source-search", limits: SOURCE_SEARCH_LIMITS });
  assert.match(search, /weak evidence/);
  assert.match(search, /before concluding it is unused/);
});

test("a truncated answer says it is a floor", () => {
  const text = formatImpact({ ...base, truncated: true });
  assert.match(text, /1\+ user\(s\)/);
  assert.match(text, /a floor and not a total/);
});

test("every answer carries its limits, and the field search admits it counts comments", () => {
  assert.match(formatImpact(base), /What this method cannot see:/);
  assert.match(formatImpact(base), /built at run time/);
  const search = formatImpact({ ...base, method: "source-search", limits: SOURCE_SEARCH_LIMITS });
  assert.match(search, /PREFIX keyword/);
  assert.match(search, /inside a comment counts as a match/);
});

test("a field question names the field in the subject line", () => {
  const text = formatImpact({ ...base, subject: { library: "DEVCFC", name: "CUSTMAST", field: "CUSBAL" } });
  assert.match(text, /DEVCFC\/CUSTMAST, field CUSBAL/);
});

test("the better method is named next to the limits, not buried", () => {
  const text = formatImpact({
    ...base,
    method: "source-search",
    limits: SOURCE_SEARCH_LIMITS,
    better: fieldMethod(true).better!,
  });
  assert.match(text, /A better answer exists here: ARCAD Elias is installed/);
});


// ── Where it sits ────────────────────────────────────────────────────────────────────────────────

test("impact analysis is available in plan mode, which is where the question belongs", () => {
  const tools = ["ibmi_impact", "ibmi_member", "ibmi_compile", "ibmi_command"].map(
    (name): Tool => ({
      schema: { name, description: name, parameters: { type: "object", properties: {} } },
      approval: () => false,
      run: async () => ({ content: "ok" }),
    }),
  );
  const planned = toolsForMode(tools, "plan").map((t) => t.schema.name);
  assert.ok(planned.includes("ibmi_impact"), "“who uses this” belongs to deciding, not to changing");
  assert.equal(planned.includes("ibmi_compile"), false);
  assert.equal(planned.includes("ibmi_command"), false);
});

test("the tool puts its own command through the gate before running it", () => {
  // Not suspicion of this code but of the next edit to it. An OUTFILE pointing anywhere but QTEMP
  // has to fail loudly rather than rely on a comment staying true.
  const source = readFileSync(join("src", "extension", "integrations", "ibmi.ts"), "utf8");
  assert.match(source, /name: "ibmi_impact"/, "the tool is not declared");
  assert.match(source, /return \[[^\]]*\bimpact\b[^\]]*\]/, "the tool is declared but never returned");
  assert.match(source, /const refused = refuseChange\(command, true, \{ writable \}\);/, "it does not check its own command");
  assert.match(source, /programRefsCommand\(library\)/);

  const modes = readFileSync(join("src", "core", "session", "modes.ts"), "utf8");
  assert.match(modes, /READ_ONLY[\s\S]*"ibmi_impact"/, "the plan-mode allow-list does not name it");
});

test("the skill asks before it changes a physical file", () => {
  const impactSkill = BUILTIN_SKILLS.find((s) => s.name === "/impact");
  assert.ok(impactSkill, "/impact is not in the skill list");
  assert.match(impactSkill.prompt ?? "", /ibmi_impact/);
  assert.match(impactSkill.prompt ?? "", /before/i);
});
