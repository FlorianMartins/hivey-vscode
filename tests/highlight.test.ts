// The syntax highlighter.
//
// The first test is the one that matters and it is asserted on every language and every awkward
// input this file can think of: THE TOKENS REPRODUCE THE INPUT. A highlighter that loses a
// backslash, drops a character at a fence, or swallows the tail of an unterminated string has
// corrupted code the user is about to paste into their repository — a far worse failure than a
// keyword rendered in the ordinary colour, and a silent one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { familyOf, highlight, type Token } from "../src/core/markdown/highlight.js";

const text = (tokens: Token[]) => tokens.map((t) => t.text).join("");
const kinds = (tokens: Token[], kind: string) => tokens.filter((t) => t.kind === kind).map((t) => t.text);

// ── The invariant ────────────────────────────────────────────────────────────────────────────

const SAMPLES: Array<[string, string]> = [
  ["ts", "const x = `a ${b} c`; // note\nfunction f(y: string) { return /re[/]gex/.test(y); }"],
  ["ts", "const s = \"he said \\\"hi\\\"\"; const n = 0xFF_00;"],
  ["py", "def f(x):\n    # comment\n    return f'{x!r}' if x else None"],
  ["sql", "SELECT * FROM QSYS2.SYSTABLES WHERE NAME = 'it''s' FETCH FIRST 5 ROWS ONLY;"],
  ["rpgle", "**FREE\ndcl-s name char(10);\n// a note\nif name = 'x';\n  dsply 'hello';\nendif;"],
  ["rpg", "     H DFTACTGRP(*NO)\n     C* an old comment\n     C                   EVAL      X = 1"],
  ["dds", "     A          R CUSTREC\n     A            CUSNO          5S 0"],
  ["json", '{"a": [1, 2.5, true, null], "b": "\\u00e9"}'],
  ["html", '<div class="a" id=\'b\'>text</div><!-- c -->'],
  ["", "whatever this is, it has ` and \" and /* in it"],
  ["ts", "const unterminated = 'oops\nconst next = 1;"],
  ["ts", "/* never closed"],
  ["ts", ""],
  ["ts", "\n\n\n"],
  ["cobol", "IDENTIFICATION DIVISION."],
];

test("the tokens always reproduce the input exactly", () => {
  for (const [lang, code] of SAMPLES) {
    assert.equal(text(highlight(code, lang)), code, `${lang}: ${JSON.stringify(code)}`);
  }
});

test("every token carries a non-empty text", () => {
  // An empty span is an element the browser has to lay out and nobody can see.
  for (const [lang, code] of SAMPLES) {
    for (const token of highlight(code, lang)) assert.ok(token.text.length > 0, `${lang} produced an empty token`);
  }
});

test("adjacent tokens of the same kind are merged", () => {
  const tokens = highlight("aaa bbb ccc ddd", "ts");
  assert.equal(tokens.length, 1, "four plain words and three spaces is one plain run");
});

// ── Getting the five distinctions right ──────────────────────────────────────────────────────

test("a comment wins over everything inside it", () => {
  // The ordering bug this exists to prevent: a quote inside a comment starting a string that runs
  // to the end of the file, painting the whole snippet as text.
  const tokens = highlight("// it's fine\nconst a = 1;", "ts");
  assert.deepEqual(kinds(tokens, "comment"), ["// it's fine"]);
  assert.ok(kinds(tokens, "keyword").includes("const"));
  assert.ok(kinds(tokens, "number").includes("1"));
});

test("an unterminated string stops at the newline", () => {
  const tokens = highlight("const a = 'oops\nconst b = 2;", "ts");
  assert.deepEqual(kinds(tokens, "string"), ["'oops"]);
  assert.ok(kinds(tokens, "number").includes("2"), "the next line is still code");
});

test("a doubled quote does not close a SQL string", () => {
  const tokens = highlight("SELECT 'it''s' FROM T", "sql");
  assert.deepEqual(kinds(tokens, "string"), ["'it''s'"]);
});

test("SQL keywords are matched whatever their case, and identifiers are not", () => {
  const upper = highlight("SELECT NAME FROM T", "sql");
  const lower = highlight("select name from t", "sql");
  assert.ok(kinds(upper, "keyword").includes("SELECT"));
  assert.ok(kinds(lower, "keyword").includes("select"));
  assert.ok(!kinds(upper, "keyword").includes("NAME"), "a column is not a keyword");
});

test("a name followed by a parenthesis is a call", () => {
  const tokens = highlight("doThing(a, b)", "ts");
  assert.deepEqual(kinds(tokens, "function"), ["doThing"]);
});

test("a number is a number, and a number inside a name is not", () => {
  assert.ok(kinds(highlight("const a = 42;", "ts"), "number").includes("42"));
  assert.deepEqual(kinds(highlight("const utf8Name = 1;", "ts"), "number"), ["1"], "utf8Name is one identifier");
});

// ── IBM i ────────────────────────────────────────────────────────────────────────────────────

test("free-form RPG knows its own words, hyphens included", () => {
  const tokens = highlight("**FREE\ndcl-s qty packed(5:0);\nif qty > 0;\nendif;", "rpgle");
  const keywords = kinds(tokens, "keyword");
  assert.ok(keywords.includes("dcl-s"), "a hyphen is part of the word in RPG");
  assert.ok(keywords.includes("if"));
  assert.ok(keywords.includes("endif"));
  assert.ok(kinds(tokens, "meta").includes("**FREE"));
});

test("in a fixed-format member the column decides, not the character", () => {
  // Column 7 is the comment marker. The same asterisk anywhere else is multiplication, and a
  // highlighter that greps for `*` comments out half a calculation spec.
  const commented = highlight("     C* this is a comment\n", "rpg");
  assert.deepEqual(kinds(commented, "comment"), ["     C* this is a comment"]);

  const code = highlight("     C                   EVAL      X = A * B\n", "rpg");
  assert.equal(kinds(code, "comment").length, 0, "an asterisk in column 40 is not a comment");
});

test("the specification letter is marked, and the rest of the line is left alone", () => {
  const tokens = highlight("     A          R CUSTREC\n", "dds");
  assert.deepEqual(kinds(tokens, "keyword"), ["A"]);
});

test("SQLRPGLE gets the free-form lexer, fixed RPG does not", () => {
  assert.equal(familyOf("sqlrpgle"), "ibmi");
  assert.equal(familyOf("rpgle"), "ibmi");
  assert.equal(familyOf("rpg"), "ibmi-fixed");
  assert.equal(familyOf("dds"), "ibmi-fixed");
});

// ── Not guessing ─────────────────────────────────────────────────────────────────────────────

test("an unknown language is left entirely plain", () => {
  const tokens = highlight("SECTION 1. blah 'quoted' // slashes", "cobol");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.kind, "plain");
});

test("the family is decided by the tag, and an unknown tag is plain", () => {
  assert.equal(familyOf("TypeScript"), "clike");
  assert.equal(familyOf(".py"), "script");
  assert.equal(familyOf("db2"), "sql");
  assert.equal(familyOf("brainfuck"), "plain");
  assert.equal(familyOf(""), "plain");
});
