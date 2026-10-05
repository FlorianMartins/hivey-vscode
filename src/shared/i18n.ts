// Translation, with the English string as its own key.
//
// The convention is gettext's, and VS Code's own `vscode.l10n`: what you write in the code IS the
// English text, and a table maps it to the other languages. Two properties fall out of that, and
// both matter more than they sound:
//
//   • a missing translation degrades to correct English rather than to `chat.composer.placeholder`;
//   • the code stays readable — `t("Send")` says what it renders, `t("btn.send")` does not.
//
// There is one implementation for the extension host, the panel and the terminal client, because
// three would drift. Each surface only has to say which language it is in:
//   host   → vscode.env.language
//   panel  → document.documentElement.lang (set by the host when it builds the HTML)
//   CLI    → $LC_ALL / $LC_MESSAGES / $LANG

import { FR } from "./i18n.fr.js";

export type Lang = "en" | "fr";

const TABLES: Record<Lang, Record<string, string>> = { en: {}, fr: FR };

let current: Lang = "en";

/**
 * Guess the language at import time.
 *
 * This is not a convenience: several modules build their labels at module scope — the mode list,
 * the period filters, the slash commands — and those run BEFORE any `setLanguage()` call the entry
 * point could make, because ES modules evaluate their imports first. Detecting here means every
 * one of them is already correct; a host that knows better still overrides it.
 */
function detect(): string | undefined {
  if (typeof document !== "undefined") return document.documentElement.lang;
  if (typeof process !== "undefined" && process.env) {
    return process.env["LC_ALL"] ?? process.env["LC_MESSAGES"] ?? process.env["LANG"];
  }
  return undefined;
}

/**
 * Structures that were translated once, at module load, and have to be rebuilt when the language
 * changes.
 *
 * ⚠️ This exists because `t()` resolving at call time is NOT enough, and the gap was invisible. A
 * module that writes `export const MODES = [{ label: t("Chat") }]` calls `t()` while the module is
 * being evaluated — once, before the extension has read its own `language` setting, because ES
 * modules evaluate their imports first. `setLanguage("fr")` afterwards changes nothing about an array
 * whose strings were already produced.
 *
 * So the panel switched to French and the mode labels, the skill families and the 100-odd skill hints
 * stayed in whatever `process.env.LANG` happened to say: « quand on selectionne une langue dans les
 * parametres que l'extension complete change de langue ».
 *
 * A rebuilder mutates its own array IN PLACE, so every module that already imported it sees the new
 * strings without being changed or re-imported. Registering one is a deliberate edit in the file that
 * owns the structure, which is the right place to decide that a label is translated.
 */
const rebuilders: Array<() => void> = [];

/**
 * Rebuild this structure whenever the language changes, and once now.
 *
 * @param rebuild must mutate in place. Reassigning a module-level binding would leave every existing
 *   import pointing at the old value, which is the bug this is here to fix, one level further in.
 */
export function onLanguageChange(rebuild: () => void): void {
  rebuilders.push(rebuild);
  rebuild();
}

export function setLanguage(tag: string | undefined): Lang {
  // VS Code hands out tags like `fr`, `fr-CA`, `pt-br`; only the primary subtag decides.
  const primary = (tag ?? "en").toLowerCase().split(/[-_.]/)[0];
  const next = primary === "fr" ? "fr" : "en";
  const changed = next !== current;
  current = next;
  // Only on a real change: rebuilding on every call would make activation quadratic in the number of
  // registered structures for no reason, and `applyLanguage()` is called on every settings change.
  if (changed) for (const rebuild of rebuilders) rebuild();
  return current;
}

export function language(): Lang {
  return current;
}

/**
 * Translate, and fill `{0}`, `{1}`… with the arguments.
 *
 * Placeholders are numbered rather than concatenated because word order is not a constant: "3 files
 * omitted" and "3 fichiers omis" agree, but plenty of pairs do not, and a translator who cannot
 * move the value has to choose between correct grammar and correct meaning.
 */
export function t(text: string, ...args: Array<string | number>): string {
  const table = TABLES[current];
  const translated = table[text] ?? text;
  if (!args.length) return translated;
  return translated.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}

/** Every English string the French table claims to translate — used by the coverage test. */
export function translationKeys(lang: Lang): string[] {
  return Object.keys(TABLES[lang]);
}

setLanguage(detect());
