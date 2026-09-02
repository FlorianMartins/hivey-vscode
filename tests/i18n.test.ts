// Translation. The interesting test is the last one: it reads the source and fails when a string
// was added without a French entry — the only way a translation table stays complete once the
// person who wrote it has moved on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setLanguage, language, t, translationKeys } from "../src/shared/i18n.js";
import { FR } from "../src/shared/i18n.fr.js";

test("the language is the primary subtag, whatever the tag looks like", () => {
  assert.equal(setLanguage("fr"), "fr");
  assert.equal(setLanguage("fr-CA"), "fr");
  assert.equal(setLanguage("FR_ca.UTF-8"), "fr");
  assert.equal(setLanguage("en-GB"), "en");
  assert.equal(setLanguage("de"), "en", "an unsupported language falls back to English, not to nothing");
  assert.equal(setLanguage(undefined), "en");
  assert.equal(language(), "en");
});

test("English is the source: an untranslated string renders as itself", () => {
  setLanguage("en");
  assert.equal(t("Send (⏎)"), "Send (⏎)");
  setLanguage("fr");
  assert.equal(t("A string nobody ever translated"), "A string nobody ever translated");
});

test("a translated string renders in French", () => {
  setLanguage("fr");
  assert.equal(t("Delete permanently"), "Supprimer définitivement");
  assert.equal(t("Allow"), "Autoriser");
  setLanguage("en");
  assert.equal(t("Delete permanently"), "Delete permanently");
});

test("placeholders are numbered, so a translator can move them", () => {
  setLanguage("en");
  assert.equal(t("{0} models", 412), "412 models");
  assert.equal(t("Input {0} $/M · output {1} $/M", 3, 15), "Input 3 $/M · output 15 $/M");
  // The French for "Created {0}" puts the date after a different word; the value still lands.
  setLanguage("fr");
  assert.match(t("Created {0}", "12/03"), /12\/03/);
});

test("a placeholder with no argument is left alone rather than printed as undefined", () => {
  setLanguage("en");
  assert.equal(t("{0} tokens"), "{0} tokens");
  assert.equal(t("{0} of {1}", "a"), "a of {1}");
});

test("the table carries the whole inventory, identical words included", () => {
  // "Agent" and "Plan" are spelled the same in French. They stay in the table anyway: a catalogue
  // with holes cannot be checked mechanically, and a coverage test cannot tell "same word" from
  // "somebody forgot this one".
  assert.equal(FR["Agent"], "Agent");
  assert.ok(Object.keys(FR).length > 300, "the interface is more than a handful of strings");
});

test("every string the source translates has a French entry", () => {
  const keys = new Set<string>();
  for (const file of walk("src")) {
    if (!file.endsWith(".ts")) continue;
    if (file.includes("i18n")) continue;
    const source = readFileSync(file, "utf8");
    // `t("…")`, but not `test(`, `.get(`, `import(` — the boundary matters more than it looks.
    //
    for (const key of translatedIn([source])) keys.add(key);
  }

  assert.ok(keys.size > 200, `expected the whole interface to be translated, found ${keys.size} strings`);
  const missing = [...keys].filter((k) => !(k in FR)).sort();
  assert.deepEqual(missing, [], `strings with no French translation:\n${missing.join("\n")}`);
});

test("the table does not translate strings that no longer exist", () => {
  // Two ways for an entry to be reachable, and it needs one of them.
  //
  // It used to be one loose way: the first forty characters appearing ANYWHERE in the source. That
  // passes on a comment, and it passes on a prefix — "Answering…" survived as dead weight because a
  // longer string starting with it had been added elsewhere. A hundred and thirty-four entries were
  // being kept, and translated, for text the product no longer says.
  //
  // Strict membership alone is too tight, though: a key can be a literal in a table that `t()` is
  // handed through a variable, and that is a real pattern here. So: passed to `t()` (fragments
  // joined, see above), or present in the source as a literal. Anything else cannot be reached,
  // because a key must match exactly — there is no way to build one at runtime.
  const files = walk("src").filter((f) => f.endsWith(".ts") && !f.includes("i18n"));
  const sources = files.map((f) => readFileSync(f, "utf8"));
  const source = sources.join("\n");
  const used = translatedIn(sources);
  const stale = translationKeys("fr").filter((key) => !used.has(key) && !source.includes(`"${key.replace(/\n/g, "\\n")}"`));
  assert.deepEqual(stale, [], `entries for strings the code no longer uses:\n${stale.join("\n")}`);
});

/**
 * Every string handed to `t()` in these sources.
 *
 * The whole argument, not its first line. A long sentence is written across several source lines
 * joined by `+`, and `t()` receives the CONCATENATION — so a reader that took only the first
 * fragment was looking for a key that never exists at runtime. That passed while the French
 * interface showed four paragraphs of English, and it was found on a screenshot, which was the only
 * place left to find it.
 */
function translatedIn(sources: string[]): Set<string> {
  const out = new Set<string>();
  for (const source of sources) {
    for (const m of source.matchAll(/(?<![A-Za-z0-9_.$])t\(\s*("(?:[^"\\]|\\.)*"(?:\s*\+\s*"(?:[^"\\]|\\.)*")*)/g)) {
      const key = [...m[1]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
        .map((part) => part[1]!)
        .join("")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n");
      if (key.trim()) out.add(key);
    }
  }
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
