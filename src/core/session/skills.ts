// The skills the panel offers, built-in and defined by the repository.
//
// This table used to live in the webview, next to the DOM that drew it, and that was the wrong place
// for two reasons that only became visible when they had to be switched off:
//
//   • THE EXTENSION HAS TO KNOW THEM. Which skills are enabled is a setting, and a setting is the
//     extension's to read and write. A list only the panel knows cannot be persisted, and cannot be
//     the same list in the two copies of the panel — the side bar and the secondary side bar each
//     have their own webview state, so a preference stored there would disagree with itself.
//   • THEY ARE DATA. Names, descriptions and prompts have no DOM in them. Keeping them here makes
//     them testable and keeps the webview about drawing.
//
// A built-in skill carries either a `prompt` — words sent to the model on the user's behalf — or an
// `action`, which does something to the conversation instead. The action is a plain string rather
// than a protocol message so that core stays free of the panel's wire format; the webview maps it.

import { t } from "../../shared/i18n.js";

export interface BuiltinSkill {
  /** The invocation, `/` included. */
  name: string;
  /** One line, shown in the completion list. */
  hint: string;
  /** What is actually sent. Absent on an action. */
  prompt?: string;
  /** What it does to the conversation instead of asking something. */
  action?: "compact";
  /** True when the active file (or selection) should ride along with it. */
  attach?: boolean;
  /**
   * Which family it belongs to, so a whole language can be switched on or off in one gesture.
   *
   * The group is the answer to a real problem rather than a filing system: with every skill on, the
   * `/` list is thirty entries long and the model is handed thirty descriptions of things it will
   * not do today. Both cost precision. Someone working on a Python service wants the Python skills
   * and the general ones, and wants the rest out of the way — which is one click when the list is
   * grouped and thirty when it is not.
   */
  group: SkillGroup;
}

export type SkillGroup = "general" | "java" | "python" | "web" | "ibmi";

/** The families, in the order the picker shows them. General first: it applies to every language. */
export const SKILL_GROUPS: Array<{ id: SkillGroup; label: string }> = [
  { id: "general", label: t("Any language") },
  { id: "web", label: t("Web — HTML, CSS, TypeScript") },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "ibmi", label: t("IBM i — RPG, DDS, Db2 for i") },
];

/**
 * The skills that ship with the extension.
 *
 * The last three are the reason the IBM i work exists at all: `/tofree` is what an RPG shop reaches
 * for daily, and converting fixed-format to free-form is precisely where a model that guesses at
 * column positions produces something that will not compile.
 */
export const BUILTIN_SKILLS: BuiltinSkill[] = [
  // ── Any language ────────────────────────────────────────────────────────────────────────────
  { group: "general", name: "/compact", hint: t("summarise the conversation and free the context"), action: "compact" },
  { group: "general", name: t("/explain"), hint: t("explain the file or the selection"), prompt: t("Explain this code: what it does, how it fits into the rest, and what deserves attention."), attach: true },
  { group: "general", name: "/tests", hint: t("write tests"), prompt: t("Write tests for this code, in the style and with the tools already used in this repository. Cover the edge cases."), attach: true },
  { group: "general", name: t("/fix"), hint: t("find and fix the problem"), prompt: t("Find the defect in this code and fix it. Say in one sentence what was wrong."), attach: true },
  { group: "general", name: t("/review"), hint: t("review: bugs, security, readability"), prompt: t("Review this code: bugs first, then security, then readability. Order by severity, cite the lines, and report nothing you are unsure of."), attach: true },
  { group: "general", name: "/doc", hint: t("document"), prompt: t("Document this code: a note above it, in the language and style of the file."), attach: true },
  { group: "general", name: t("/optimise"), hint: t("make it faster, without changing what it does"), prompt: t("Make this code faster without changing its behaviour. Say what the cost was before and after, and refuse if the gain is not worth the loss of clarity."), attach: true },
  { group: "general", name: "/commit", hint: t("write the commit message"), prompt: t("Read the staged changes with git_diff and write the commit message for them. Subject line, then the why.") },

  // ── Web ─────────────────────────────────────────────────────────────────────────────────────
  //
  // Not "explain, but for CSS". Each of these is a review a generalist prompt does badly, because
  // what makes it useful is a body of rules the model has to be told to apply rather than asked to
  // remember: the WCAG criteria, the semantics of the element set, the cascade.
  { group: "web", name: "/a11y", hint: t("accessibility audit"), prompt: t("Audit this for accessibility against WCAG 2.2 AA. Check the accessible name of every control, keyboard reachability and focus order, contrast, the use of ARIA (and whether native elements would remove the need for it), and what a screen reader would announce. Cite the criterion for each finding, and say which are certain and which need testing in a browser."), attach: true },
  { group: "web", name: "/semantic", hint: t("the right HTML elements"), prompt: t("Rewrite this markup with the elements that carry its meaning: landmarks, headings in order, lists for lists, buttons for actions and links for navigation. Say what each change gives a screen reader or a search engine that the original did not."), attach: true },
  { group: "web", name: "/css", hint: t("simplify the stylesheet"), prompt: t("Review this CSS: specificity that will be hard to override later, magic numbers, layout done with hacks where the cascade or a modern layout would do, and anything that breaks on a narrow screen or in the other colour scheme. Propose the simpler version."), attach: true },
  { group: "web", name: "/types", hint: t("tighten the TypeScript types"), prompt: t("Tighten the types here: replace `any` and unchecked casts with types the compiler can verify, narrow rather than assert, and make the states that cannot happen unrepresentable. Change no behaviour, and say which changes would fail the build elsewhere."), attach: true },

  // ── Python ──────────────────────────────────────────────────────────────────────────────────
  { group: "python", name: "/pytest", hint: t("write pytest tests"), prompt: t("Write pytest tests for this: plain functions rather than classes, fixtures for the setup, parametrize for the table of cases, and a name per test that says what it asserts. Cover the boundaries and the error paths, and use no mock where a real object is cheap."), attach: true },
  { group: "python", name: "/hints", hint: t("add type hints"), prompt: t("Add type hints to this code, complete enough for mypy in strict mode. Prefer the standard collections and `X | None` over Optional, be precise about what is mutated, and change no behaviour. Say where a hint was impossible without altering the design."), attach: true },
  { group: "python", name: "/docstring", hint: t("write the docstrings"), prompt: t("Write docstrings for this code in the style already used in the file, or Google style if there is none. Say what it does, what the arguments mean, what it returns and what it raises. Do not restate the signature in prose."), attach: true },
  { group: "python", name: "/pythonic", hint: t("make it idiomatic Python"), prompt: t("Rewrite this as a Python developer would: comprehensions where they read better than the loop, context managers for anything with a lifetime, the standard library instead of a hand-rolled version, and dataclasses or enums where a dict is standing in for a type. Refuse any change that trades clarity for cleverness."), attach: true },

  // ── Java ────────────────────────────────────────────────────────────────────────────────────
  { group: "java", name: "/junit", hint: t("write JUnit 5 tests"), prompt: t("Write JUnit 5 tests for this: @Test with @DisplayName saying what is asserted, @ParameterizedTest where the cases are data, AssertJ if the project already uses it, and @Nested to group the cases of one behaviour. Cover the exceptions as well as the happy path."), attach: true },
  { group: "java", name: "/javadoc", hint: t("write the Javadoc"), prompt: t("Write Javadoc for this: what it does and why it exists, @param, @return, @throws, and @since where the project uses it. Document the contract — nullability, thread safety, what the caller owns — rather than the implementation."), attach: true },
  { group: "java", name: "/streams", hint: t("loops to streams, where it reads better"), prompt: t("Where the Stream API reads better than the loop, rewrite it — and where it does not, say so and leave the loop. Keep laziness in mind, do not collect a stream only to iterate it, and never hide a side effect inside a map."), attach: true },
  { group: "java", name: "/nullsafe", hint: t("find what can be null"), prompt: t("Find every path in this code where a null can arrive and is not handled. Propose the fix that removes the possibility — Optional at the boundary, a non-null invariant enforced at construction, a validated parameter — rather than a null check at each use."), attach: true },

  // ── IBM i ───────────────────────────────────────────────────────────────────────────────────
  //
  // The reason the dialect rules in core exist: converting fixed to free is exactly where a model
  // that guesses at column positions produces something that looks right and does not compile.
  { group: "ibmi", name: "/tofree", hint: t("convert fixed-format RPG to fully free"), prompt: t("Convert this member to fully free-form RPGLE. Start the result with **FREE, use dcl-f/dcl-s/dcl-ds/dcl-proc, keep every comment, and change no behaviour. Point out anything that has no free-form equivalent instead of inventing one."), attach: true },
  { group: "ibmi", name: "/sql", hint: t("write it as Db2 for i SQL"), prompt: t("Write this as Db2 for i SQL. Qualify the objects, use FETCH FIRST rather than LIMIT, and say which library list the unqualified names would resolve against."), attach: true },
  { group: "ibmi", name: "/dds", hint: t("explain this DDS"), prompt: t("Explain this DDS member: the record formats, the key fields, the keywords that change behaviour, and anything that would surprise someone reading it for the first time."), attach: true },
];

/**
 * `/compact` cannot be switched off.
 *
 * It is not a prompt, it is a control over the conversation's own size — like the send button. A
 * user who has disabled every skill still needs to be able to compact, and hiding the control that
 * relieves a full context is the one case where "total control of the tool" would work against the
 * person exercising it.
 */
export const ALWAYS_ON = new Set(["/compact"]);

/**
 * Whether a skill is on.
 *
 * The stored list holds what is DISABLED rather than what is enabled, and that asymmetry is
 * deliberate: a skill added by a future version, or by a colleague committing a file, is on by
 * default. Storing the enabled set instead would mean every new skill arrives switched off and
 * invisible, which is how a feature ships and nobody ever sees it.
 */
export function isSkillEnabled(name: string, disabled: string[]): boolean {
  if (ALWAYS_ON.has(name)) return true;
  return !disabled.includes(name);
}

/** The stored list after a toggle. Kept sorted and unique so the setting file stays readable. */
export function toggleSkill(disabled: string[], name: string, enabled: boolean): string[] {
  if (ALWAYS_ON.has(name)) return disabled;
  const set = new Set(disabled);
  if (enabled) set.delete(name);
  else set.add(name);
  return [...set].sort();
}

/**
 * A repository skill's invocation name.
 *
 * Defined once because it is a join key: the panel's toggle, the stored setting and the prompt the
 * model receives all have to agree on how a skill named `review-rpg` in a file is spelled in a
 * list. They disagreed at first, and the symptom was a toggle that appeared to do nothing.
 */
export function skillInvocation(name: string): string {
  return name.startsWith("/") ? name : `/${name}`;
}
