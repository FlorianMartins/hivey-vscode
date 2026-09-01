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

export type SkillGroup =
  | "general"
  | "web"
  | "python"
  | "java"
  | "dotnet"
  | "systems"
  | "mobile"
  | "data"
  | "devops"
  | "design"
  | "security"
  | "ibmi";

/**
 * The families, in the order the picker shows them.
 *
 * General first, because it applies whatever is open. The rest are the kinds of work this tool is
 * actually used for, and they are deliberately coarse: a family per language would be twenty
 * headings to scroll, and "Go or Rust or C" is one decision for the person making it — they are
 * working on a systems codebase today and not on a web one.
 */
export const SKILL_GROUPS: Array<{ id: SkillGroup; label: string; hint: string }> = [
  { id: "general", label: t("Any language"), hint: t("Applies whatever you have open.") },
  { id: "web", label: t("Web"), hint: t("HTML, CSS, JavaScript, TypeScript") },
  { id: "python", label: "Python", hint: t("Tests, typing, packaging") },
  { id: "java", label: "Java", hint: t("JUnit, Javadoc, streams, null-safety") },
  { id: "dotnet", label: ".NET", hint: t("C#, LINQ, async, XML documentation") },
  { id: "systems", label: t("Systems"), hint: t("C, C++, Go, Rust — memory, errors, concurrency") },
  { id: "mobile", label: t("Mobile"), hint: t("Flutter and Dart, Swift, Kotlin") },
  { id: "data", label: t("SQL & data"), hint: t("Queries, indexes, schema, migrations") },
  { id: "devops", label: t("Build & deploy"), hint: t("Docker, CI, shell, configuration") },
  { id: "design", label: t("Design & UX"), hint: t("Layout, typography, states, wording") },
  { id: "security", label: t("Security"), hint: t("Threats, authorisation, secrets, dependencies") },
  { id: "ibmi", label: t("IBM i"), hint: t("RPG, DDS, display and printer files, CL, Db2 for i") },
];

/**
 * A skill is a prompt with a body of convention attached.
 *
 * The test that governs every entry below: it must name the tools, rules or idioms of its subject.
 * "Write tests, in Java" is the generic skill with a word changed and is worth nothing — what makes
 * `/junit` useful is `@ParameterizedTest`, `@Nested` and AssertJ, because those are what the model
 * will otherwise approximate.
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
  { group: "general", name: "/names", hint: t("better names"), prompt: t("Rename what is badly named here: names that describe the type rather than the role, abbreviations only the author understands, and booleans that read backwards. Propose each rename with the reason, and change nothing else."), attach: true },
  { group: "general", name: "/simplify", hint: t("remove what is not needed"), prompt: t("Simplify this without changing what it does: dead branches, flags with one caller, indirection that hides rather than explains, and comments restating the code. Say what each removal costs if anything."), attach: true },
  { group: "general", name: "/errors", hint: t("handle the failures"), prompt: t("Find every failure this code does not handle: what can throw, what can return nothing, what can time out. Propose handling that leaves the caller able to act, not a swallowed exception."), attach: true },
  { group: "security", name: "/security", hint: t("security review"), prompt: t("Review this for security: injection through anything that reaches a query, a shell or a template; authorisation checked at the boundary rather than in the caller; secrets in code or logs; unsafe deserialisation. Rank by exploitability and say what an attacker would need."), attach: true },

  // ── Web ─────────────────────────────────────────────────────────────────────────────────────
  { group: "web", name: "/a11y", hint: t("accessibility audit"), prompt: t("Audit this against WCAG 2.2 AA: the accessible name of every control, keyboard reachability and focus order, contrast, ARIA used where a native element would do, and what a screen reader announces. Cite the criterion for each finding and separate what is certain from what needs a browser."), attach: true },
  { group: "web", name: "/semantic", hint: t("the right HTML elements"), prompt: t("Rewrite this markup with the elements that carry its meaning: landmarks, headings in order, lists for lists, buttons for actions and links for navigation. Say what each change gives a screen reader that the original did not."), attach: true },
  { group: "web", name: "/css", hint: t("simplify the stylesheet"), prompt: t("Review this CSS: specificity that will be hard to override, magic numbers, layout done with hacks where the cascade or grid would do, and anything that breaks on a narrow screen or in the other colour scheme. Propose the simpler version."), attach: true },
  { group: "web", name: "/responsive", hint: t("make it hold at every width"), prompt: t("Find where this breaks between a phone and a wide monitor: fixed widths, text that cannot wrap, tables and code that overflow, touch targets under 44 px. Fix it with the intrinsic sizing that removes the breakpoint rather than adding one."), attach: true },
  { group: "web", name: "/types", hint: t("tighten the TypeScript types"), prompt: t("Tighten the types here: replace `any` and unchecked casts with types the compiler can verify, narrow rather than assert, and make impossible states unrepresentable. Change no behaviour, and say which changes would fail the build elsewhere."), attach: true },
  { group: "web", name: "/jsdoc", hint: t("document the exported API"), prompt: t("Write JSDoc for what this module exports: the contract, the parameters, what is returned, what throws, and the example that removes the need to read the body. Do not restate the signature."), attach: true },
  { group: "web", name: "/perf-web", hint: t("what makes the page slow"), prompt: t("Find what costs the most here: layout thrash, work on every keystroke or scroll without throttling, bundles pulled in for one function, images without dimensions. Give the cheapest fix for each and say what it is worth."), attach: true },

  // ── Python ──────────────────────────────────────────────────────────────────────────────────
  { group: "python", name: "/pytest", hint: t("write pytest tests"), prompt: t("Write pytest tests for this: plain functions, fixtures for the setup, parametrize for the table of cases, and a name per test saying what it asserts. Cover the boundaries and the error paths, and use no mock where a real object is cheap."), attach: true },
  { group: "python", name: "/hints", hint: t("add type hints"), prompt: t("Add type hints complete enough for mypy in strict mode. Prefer the standard collections and `X | None` over Optional, be precise about what is mutated, and change no behaviour. Say where a hint was impossible without altering the design."), attach: true },
  { group: "python", name: "/docstring", hint: t("write the docstrings"), prompt: t("Write docstrings in the style already used in the file, or Google style if there is none: what it does, what the arguments mean, what it returns and what it raises. Do not restate the signature in prose."), attach: true },
  { group: "python", name: "/pythonic", hint: t("make it idiomatic Python"), prompt: t("Rewrite this as a Python developer would: comprehensions where they read better than the loop, context managers for anything with a lifetime, the standard library over a hand-rolled version, dataclasses or enums where a dict stands in for a type. Refuse any change that trades clarity for cleverness."), attach: true },
  { group: "python", name: "/asyncio", hint: t("review the async code"), prompt: t("Review this asyncio code: blocking calls on the event loop, tasks created and never awaited, cancellation that leaves state half-written, and gather where a task group would give better failure behaviour."), attach: true },

  // ── Java ────────────────────────────────────────────────────────────────────────────────────
  { group: "java", name: "/junit", hint: t("write JUnit 5 tests"), prompt: t("Write JUnit 5 tests: @Test with @DisplayName saying what is asserted, @ParameterizedTest where the cases are data, AssertJ if the project uses it, @Nested to group the cases of one behaviour. Cover the exceptions as well as the happy path."), attach: true },
  { group: "java", name: "/javadoc", hint: t("write the Javadoc"), prompt: t("Write Javadoc: what it does and why it exists, @param, @return, @throws, @since where the project uses it. Document the contract — nullability, thread safety, what the caller owns — rather than the implementation."), attach: true },
  { group: "java", name: "/streams", hint: t("loops to streams, where it reads better"), prompt: t("Where the Stream API reads better than the loop, rewrite it — and where it does not, say so and leave the loop. Keep laziness in mind, do not collect a stream only to iterate it, and never hide a side effect inside a map."), attach: true },
  { group: "java", name: "/nullsafe", hint: t("find what can be null"), prompt: t("Find every path where a null can arrive unhandled. Propose the fix that removes the possibility — Optional at the boundary, an invariant enforced at construction, a validated parameter — rather than a null check at each use."), attach: true },
  { group: "java", name: "/concurrent", hint: t("review the concurrency"), prompt: t("Review this for concurrency: shared mutable state without a happens-before edge, locks taken in different orders, collections that are not thread-safe, and executors never shut down. Say what would actually go wrong and under what load."), attach: true },

  // ── .NET ────────────────────────────────────────────────────────────────────────────────────
  { group: "dotnet", name: "/xmldoc", hint: t("write the XML documentation"), prompt: t("Write XML documentation comments: <summary>, <param>, <returns>, <exception>, and <remarks> for the contract the signature cannot state. Document nullability as the compiler sees it."), attach: true },
  { group: "dotnet", name: "/linq", hint: t("loops to LINQ, where it reads better"), prompt: t("Where LINQ reads better than the loop, rewrite it — and where it does not, leave it and say why. Watch for multiple enumeration of the same sequence and for queries that hit the database once per row."), attach: true },
  { group: "dotnet", name: "/asyncnet", hint: t("review the async/await"), prompt: t("Review this async code: async void outside an event handler, .Result or .Wait() that can deadlock, missing ConfigureAwait in library code, and CancellationToken accepted and never passed on."), attach: true },
  { group: "dotnet", name: "/nunit", hint: t("write the tests"), prompt: t("Write tests in the framework this project already uses (xUnit, NUnit or MSTest): one behaviour per test, data-driven cases where they are data, and a name that says what is asserted. Cover the exceptions."), attach: true },

  // ── Systems ─────────────────────────────────────────────────────────────────────────────────
  { group: "systems", name: "/gotest", hint: t("write Go table tests"), prompt: t("Write Go tests in the table style: a slice of cases with names, t.Run per case, t.Parallel where it is safe, and the standard library rather than an assertion framework. Cover the error returns."), attach: true },
  { group: "systems", name: "/goerr", hint: t("review the error handling"), prompt: t("Review the error handling: errors swallowed or logged and returned twice, missing context from %w, sentinel errors compared with == where errors.Is is needed, and defers that hide a failure to close."), attach: true },
  { group: "systems", name: "/borrow", hint: t("review the Rust ownership"), prompt: t("Review the ownership here: clones that exist to satisfy the borrow checker rather than the design, lifetimes that could be elided, Rc/RefCell standing in for a structure that does not need shared mutation, and unwrap on a path that can fail."), attach: true },
  { group: "systems", name: "/unsafe", hint: t("justify or remove the unsafe"), prompt: t("For each unsafe block or raw pointer here: state the invariant that makes it sound, or show the safe construction that removes it. Treat an unsafe block without a written invariant as a defect."), attach: true },
  { group: "systems", name: "/raii", hint: t("make the lifetime the type's job"), prompt: t("Rewrite this C++ so ownership is expressed in types: unique_ptr or a value where a raw owning pointer is used, RAII for anything acquired and released, the rule of zero where the compiler can write the special members. Say what each change makes impossible."), attach: true },
  { group: "systems", name: "/undefined", hint: t("find the undefined behaviour"), prompt: t("Find the undefined behaviour here: reads past a bound, signed overflow, strict-aliasing violations, uninitialised reads, use after move, and lifetimes ending before the last use. For each, say what a compiler is permitted to do with it."), attach: true },
  { group: "systems", name: "/memory", hint: t("who owns what"), prompt: t("Trace ownership through this code: what allocates, what frees, what can be used after free or freed twice, and where a bound is checked. Propose the structure that makes the lifetime obvious rather than a comment claiming it."), attach: true },

  // ── Mobile ──────────────────────────────────────────────────────────────────────────────────
  { group: "mobile", name: "/widget", hint: t("review the widget tree"), prompt: t("Review this widget tree: work done in build(), const constructors missing where the subtree never changes, setState rebuilding more than it needs, and layout that overflows on a small screen. Give the restructured tree."), attach: true },
  { group: "mobile", name: "/darttest", hint: t("write the Flutter tests"), prompt: t("Write tests for this in the right kind: a unit test for pure logic, a widget test with pumpWidget and finders for the UI, a golden test where the look is the contract. Name each test for the behaviour it pins."), attach: true },
  { group: "mobile", name: "/state", hint: t("review the state management"), prompt: t("Review how state is held here: state above the widget that owns it, rebuilds wider than the change, controllers and streams never disposed, and business logic inside a widget. Propose the arrangement that fits the pattern this project already uses."), attach: true },
  { group: "mobile", name: "/dartdoc", hint: t("document the Dart API"), prompt: t("Write doc comments for what this library exports: the contract, the parameters, what is returned, what throws, and a short example. Use /// and reference other symbols with square brackets."), attach: true },
  { group: "mobile", name: "/adaptive", hint: t("make it hold on every device"), prompt: t("Find where this breaks between a small phone and a tablet: hard-coded sizes, text that ignores the platform scale factor, touch targets under 48 dp, and layout that assumes one orientation. Fix it with layout that adapts rather than with a device check."), attach: true },

  // ── SQL & data ──────────────────────────────────────────────────────────────────────────────
  { group: "data", name: "/query", hint: t("review the query"), prompt: t("Review this query: what it will scan, whether the predicates are sargable, joins that multiply rows, and correlated subqueries that run per row. Give the rewrite and say what you expect the plan to change to."), attach: true },
  { group: "data", name: "/index", hint: t("which index this needs"), prompt: t("Propose the indexes this workload needs, with the column order and the reason for it. Say which existing index each new one makes redundant, and what the write cost is."), attach: true },
  { group: "data", name: "/schema", hint: t("review the schema"), prompt: t("Review this schema: keys that do not identify, nullable columns standing in for a missing table, types that lose precision, and constraints the application is enforcing instead of the database. Propose the corrected DDL."), attach: true },
  { group: "data", name: "/migration", hint: t("write a safe migration"), prompt: t("Write this migration so it can run against a live table: no long lock, backfill separated from the schema change, and a state where old and new code both work. Give the rollback, and say what makes it irreversible if it is."), attach: true },

  // ── Build & deploy ──────────────────────────────────────────────────────────────────────────
  { group: "devops", name: "/dockerfile", hint: t("review the Dockerfile"), prompt: t("Review this Dockerfile: layer order that defeats the cache, build tools left in the final image, running as root, a tag that is not pinned, and secrets passed as build arguments. Give the corrected file."), attach: true },
  { group: "devops", name: "/ci", hint: t("review the pipeline"), prompt: t("Review this pipeline: steps that could run in parallel, caches that never hit, a failure that does not fail the build, secrets exposed to a fork's pull request, and actions pinned to a moving tag."), attach: true },
  { group: "devops", name: "/shell", hint: t("make the script safe"), prompt: t("Harden this shell script: set -euo pipefail, quote every expansion, handle a path with a space, avoid parsing ls, and check that each command exists before using it. Say what would have gone wrong without each change."), attach: true },
  { group: "devops", name: "/config", hint: t("review the configuration"), prompt: t("Review this configuration: values that differ between environments and are hard-coded, secrets in the file, defaults that are unsafe in production, and settings with no effect because something later overrides them."), attach: true },

  // ── Design & UX ─────────────────────────────────────────────────────────────────────────────
  //
  // Not decoration: every one of these is a defect class that ships because nobody looked for it.
  { group: "design", name: "/ux", hint: t("review the interface"), prompt: t("Review this interface: what the user is trying to do and how many steps it takes, what is unclear without a tooltip, what happens on the unhappy path, and what a first-time reader would get wrong. Rank by how often it will bite."), attach: true },
  { group: "design", name: "/states", hint: t("the states nobody drew"), prompt: t("List the states this interface can be in — empty, loading, one item, far too many, too long a name, offline, no permission, failed — and say what it shows in each. Write the ones that are missing."), attach: true },
  { group: "design", name: "/copy", hint: t("rewrite the wording"), prompt: t("Rewrite the text in this interface: labels that say what happens rather than what the code does, errors that say what to do next, no apologies, no jargon the user did not choose. Keep it shorter than what it replaces."), attach: true },
  { group: "design", name: "/spacing", hint: t("the layout system"), prompt: t("Review the layout here against one scale: spacing values outside it, alignments off by a pixel or two, type sizes that are nearly the same, and whitespace that groups the wrong things together. Give the corrected values."), attach: true },
  { group: "design", name: "/motion", hint: t("review the animation"), prompt: t("Review the motion here: durations that make the interface feel slow, easing that is linear where it should not be, animation on something the user is trying to read, and no honouring of prefers-reduced-motion."), attach: true },

  // ── Security ────────────────────────────────────────────────────────────────────────────────
  { group: "security", name: "/threats", hint: t("threat model this"), prompt: t("Threat-model this: what an attacker wants, where they can reach it from, what they need to get it, and what stops them today. Rank by how easy each path is rather than by how bad the outcome sounds."), attach: true },
  { group: "security", name: "/authz", hint: t("check the authorisation"), prompt: t("Check authorisation here: whether it is enforced at the boundary or trusted from the caller, whether the object being acted on is checked and not only the action, and what a user of another tenant would be able to reach. Show the missing check."), attach: true },
  { group: "security", name: "/crypto", hint: t("review the cryptography"), prompt: t("Review the cryptography here: primitives chosen rather than borrowed from a tutorial, key length and derivation, an IV or nonce that is unique, comparison that is constant-time, and randomness from a CSPRNG. Say what a wrong answer would cost."), attach: true },
  { group: "security", name: "/secrets", hint: t("find the secrets"), prompt: t("Find what should not be in this code: credentials, tokens, connection strings, private keys, and anything logged that carries them. Say where each belongs instead and what has to be rotated if it is already committed."), attach: true },
  { group: "security", name: "/deps", hint: t("review the dependencies"), prompt: t("Review these dependencies: what is unmaintained, what is pulled in for one function, what runs code at install time, and what has a known advisory. Say which could be dropped and what replacing each would cost."), attach: true },

  // ── IBM i ───────────────────────────────────────────────────────────────────────────────────
  //
  // The largest family, and the reason the dialect rules in core exist: a model that guesses at
  // column positions produces a member that looks right, compiles into something else, and fails
  // in a spool file.
  { group: "ibmi", name: "/tofree", hint: t("convert fixed-format RPG to fully free"), prompt: t("Convert this member to fully free-form RPGLE. Start with **FREE, use dcl-f/dcl-s/dcl-ds/dcl-proc, keep every comment, and change no behaviour. Point out anything with no free-form equivalent instead of inventing one."), attach: true },
  { group: "ibmi", name: "/sql", hint: t("write it as Db2 for i SQL"), prompt: t("Write this as Db2 for i SQL. Qualify the objects, use FETCH FIRST rather than LIMIT, and say which library list the unqualified names would resolve against."), attach: true },
  { group: "ibmi", name: "/dds", hint: t("explain this DDS"), prompt: t("Explain this DDS member: the record formats, the key fields, the keywords that change behaviour, and anything that would surprise someone reading it for the first time."), attach: true },
  { group: "ibmi", name: "/dspf", hint: t("review this display file"), prompt: t("Review this DSPF: the record formats and their overlay order, indicators and what each one drives, CFxx/CAxx keys and where they are handled, subfile control and whether the size is right, and the DDS keywords that will surprise the next reader."), attach: true },
  { group: "ibmi", name: "/prtf", hint: t("review this printer file"), prompt: t("Review this PRTF: page size and orientation against the form, the record formats and their line positions, overflow handling, and the editing that will change the printed value. Say what breaks if the form changes."), attach: true },
  { group: "ibmi", name: "/cl", hint: t("review this CL"), prompt: t("Review this CL program: MONMSG placed where it can hide a real failure, unqualified object references and what the library list would resolve them to, overrides never deleted, and the return code the caller sees."), attach: true },
  { group: "ibmi", name: "/embedsql", hint: t("review the embedded SQL"), prompt: t("Review this embedded SQL in RPG: SQLCODE and SQLSTATE checked after every statement, host variables sized to their columns, cursors closed on every path, literals that should be parameter markers, and the isolation level in force."), attach: true },
  { group: "ibmi", name: "/ile", hint: t("review the ILE structure"), prompt: t("Review this as ILE: what belongs in a service program rather than in the program, the procedures that should be exported and their prototypes, the activation group and what it means for open files and commitment, and the binding directory this needs."), attach: true },
  { group: "ibmi", name: "/rpgdoc", hint: t("document this member"), prompt: t("Document this member the way an RPG shop reads: a header saying what it is for and what calls it, a note per procedure, and the files it uses with what it does to each. Keep the column layout untouched if the member is fixed-format."), attach: true },
  { group: "ibmi", name: "/commitctl", hint: t("review the commitment control"), prompt: t("Review the commitment control here: what is under commit and what is not, where COMMIT and ROLLBACK are issued, what happens on an unhandled error, and whether the activation group scope matches the unit of work.") },
  { group: "ibmi", name: "/dbmodern", hint: t("modernise the data access"), prompt: t("Propose the SQL replacement for these native I/O operations (CHAIN, SETLL, READE): the query, whether a cursor or a single fetch is right, and what changes about record locking and about the record format the program expects. Say where native I/O should stay."), attach: true },
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
 * The stored list after choosing which families to work with.
 *
 * Everything outside the chosen families is switched off and everything inside is switched on, in
 * one write. `general` is always kept: it is the set that applies whatever is open, and a profile
 * that silenced `/fix` because you said "Web" would be a profile nobody uses twice.
 */
export function applyGroups(groups: SkillGroup[]): string[] {
  const keep = new Set<SkillGroup>([...groups, "general"]);
  return BUILTIN_SKILLS.filter((s) => !keep.has(s.group) && !ALWAYS_ON.has(s.name))
    .map((s) => s.name)
    .sort();
}

/** Which families are fully on, for showing the current profile back to the user. */
export function activeGroups(disabled: string[]): SkillGroup[] {
  const off = new Set(disabled);
  return SKILL_GROUPS.map((g) => g.id).filter((id) =>
    BUILTIN_SKILLS.some((s) => s.group === id && !off.has(s.name)),
  );
}

/**
 * What the workspace looks like it is made of.
 *
 * A suggestion, never an imposition — offered as the pre-ticked answer on a new conversation, where
 * the user can change it in one click. Detection from the languages the editor has actually opened
 * rather than from a file scan: the point is to guess well enough that most people accept the guess,
 * and what someone has open is a far better signal of what they are working on today than what the
 * repository contains.
 *
 * Returns an empty list when nothing is recognised, which the caller reads as "ask, do not assume".
 */
export function detectGroups(languageIds: string[]): SkillGroup[] {
  const seen = new Set(languageIds.map((id) => id.toLowerCase()));
  const has = (...ids: string[]) => ids.some((id) => seen.has(id));
  const found: SkillGroup[] = [];
  if (has("html", "css", "scss", "less", "javascript", "javascriptreact", "typescript", "typescriptreact", "vue", "svelte"))
    found.push("web");
  if (has("python")) found.push("python");
  if (has("java", "kotlin", "groovy")) found.push("java");
  if (has("csharp", "fsharp", "vb")) found.push("dotnet");
  if (has("go", "rust", "c", "cpp", "zig")) found.push("systems");
  if (has("sql", "plsql", "postgres", "mysql")) found.push("data");
  if (has("dockerfile", "shellscript", "yaml", "terraform", "makefile")) found.push("devops");
  if (has("rpgle", "rpg", "sqlrpgle", "dds", "dds.pf", "dds.lf", "dds.dspf", "dds.prtf", "cl", "clle", "cobol"))
    found.push("ibmi");
  return found;
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
