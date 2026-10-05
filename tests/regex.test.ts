// Patterns written in the dialect models actually use.
//
// Found by watching a real turn, not by reading the code: the model searched for a warehouse code
// with `(?i)WHS-`, which is valid in ripgrep, Go, Rust, Python, PCRE and Java, and got JavaScript's
// `Invalid group`. It retried without the flag and found the code — so the turn succeeded, and the
// defect was invisible in the result. What it cost was a step and a round trip, every time, for a
// dialect difference nobody told the model about.

import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeLiteral, parsePattern, searchPattern } from "../src/core/agent/regex.js";

test("a leading (?i) becomes the JavaScript i flag", () => {
  const { re } = searchPattern("(?i)whs-", "g");
  assert.equal(re.flags.includes("i"), true);
  assert.equal(re.source, "whs-");
  assert.equal("WHS-7781".match(re)?.[0], "WHS-");
});

test("combined and repeated groups both work", () => {
  // `(?is)foo` and `(?i)(?s)foo` are the same thing wherever either is legal.
  assert.deepEqual(parsePattern("(?is)a.b"), { source: "a.b", flags: "is" });
  assert.deepEqual(parsePattern("(?i)(?s)a.b"), { source: "a.b", flags: "is" });
});

test("the caller's own flags survive the translation", () => {
  assert.equal(parsePattern("(?i)x", "g").flags, "gi");
  assert.equal(parsePattern("x", "g").flags, "g");
});

test("flags come out in a stable order", () => {
  // So two spellings of the same request compile to the same expression, and so a test can state
  // what it expects without depending on which letter was seen first.
  assert.equal(parsePattern("(?si)x", "g").flags, parsePattern("(?is)x", "g").flags);
});

test("a negated flag is refused, not silently dropped", () => {
  // ⚠️ `(?-i)` turns case-insensitivity OFF for the rest of the pattern, and JavaScript cannot say
  // that at all. Removing the group would apply the OPPOSITE of what was asked and return confident
  // wrong results — worse than an error, because nobody checks a search that answered.
  const parsed = parsePattern("(?-i)x", "g");
  assert.equal(parsed.refused, "(?-i)");
  assert.equal(parsed.source, "(?-i)x", "the pattern is left untouched when it cannot be honoured");
  assert.throws(() => searchPattern("(?-i)x", "g"), /Unsupported inline flag/);
});

test("an unknown flag letter is refused rather than guessed", () => {
  // `(?x)` is extended mode: whitespace in the pattern becomes insignificant. Ignoring it would make
  // every space in the pattern match a literal space, which is a different search.
  assert.throws(() => searchPattern("(?x)a b", "g"), /Unsupported inline flag/);
});

test("a group in the middle of the pattern is left alone", () => {
  // Only LEADING flags are translated. `a(?i)b` changes behaviour partway through, which JavaScript
  // cannot express — and it is also a perfectly ordinary non-capturing group in other patterns.
  const parsed = parsePattern("a(?i)b", "g");
  assert.equal(parsed.source, "a(?i)b");
  assert.equal(parsed.flags, "g");
});

test("an ordinary pattern is untouched", () => {
  assert.deepEqual(parsePattern("function\\s+\\w+", "g"), { source: "function\\s+\\w+", flags: "g" });
});

test("a pattern that is not a regex at all is searched as text", () => {
  // ⚠️ Why « beaucoup de search text ... echouent ». A model looking for a call site types `total(`.
  // As a regular expression that is `Unterminated group`, so the search failed and answered nothing
  // — and five of eight patterns taken from ordinary code search fail the same way: `cost.usd(`,
  // `?.length`, `C++`, `foo)`. Every one of them is obviously a literal.
  for (const pattern of ["total(", "cost.usd(", "?.length", "C++", "foo)"]) {
    const found = searchPattern(pattern, "g");
    assert.equal(found.literal, true, `${pattern} should have fallen back to text`);
    assert.equal(found.re.test(pattern), true, `${pattern} should match itself`);
  }
});

test("a real regular expression is still a regular expression", () => {
  // The fallback must not swallow the feature: a working pattern keeps its meaning.
  const found = searchPattern("function\\s+\\w+", "g");
  assert.equal(found.literal, false);
  assert.equal(found.re.test("function total"), true);
  assert.equal(found.re.test("function+total"), false);
});

test("escapeLiteral neutralises every metacharacter", () => {
  // Tested directly, because most strings full of metacharacters are PERFECTLY VALID regexes —
  // `a.b(c)[d]{e}|f*g+h?` compiles — so going through the fallback would not exercise the escaping.
  const nasty = "a.b(c)[d]{e}|f*g+h?i^j$k\\l/m";
  const re = new RegExp(escapeLiteral(nasty));
  assert.equal(re.test(nasty), true, "the escaped pattern must match the text it came from");
  assert.equal(new RegExp(escapeLiteral("a.c")).test("abc"), false, "the dot must stop being a wildcard");
  assert.equal(new RegExp(escapeLiteral("a+")).test("aaa"), false, "the plus must stop being a quantifier");
});

test("an unterminated group falls back and matches itself", () => {
  // A pattern that genuinely does not compile, with metacharacters in it, through the real path.
  const found = searchPattern("cost.usd(", "g");
  assert.equal(found.literal, true);
  assert.equal(found.re.test("const x = cost.usd(a)"), true);
  assert.equal(new RegExp(escapeLiteral("cost.usd(")).test("costXusd("), false, "the dot stayed literal");
});

test("an inline flag is still refused rather than searched for literally", () => {
  // The one case where falling back would be nonsense: `(?-i)` is not something anybody is looking
  // for, and the message says exactly what to change.
  assert.throws(() => searchPattern("(?-i)x", "g"), /Unsupported inline flag/);
});
