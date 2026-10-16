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

import { en, t, onLanguageChange } from "../../shared/i18n.js";

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
   * The evaluation task that exercises this skill, by directory name under `eval/tasks`.
   *
   * Declared on the skill rather than kept in a list somewhere, because a list somewhere is a list
   * that rots: the roadmap's requirement is that every finance skill be backed by a task whose check
   * FAILS before the work is done, and the only way that requirement survives the next skill
   * somebody adds is if a test can read it off the skill itself. `tests/skills.test.ts` checks that
   * every skill in the finance family names one and that the directory exists; `eval:verify` and
   * `eval:solutions` already check that the task itself is honest in both directions.
   *
   * One task may back several skills, which is honest where they are the same subject seen from two
   * sides, and is not an excuse to point five unrelated skills at one convenient task.
   */
  evalTask?: string;
  /**
   * A feature this skill depends on. Offered only when that feature is on.
   *
   * Not the same thing as a group: a group is a language somebody chose not to work in today, and
   * this is machinery that is switched off — invoking it would reach for tools that are not there.
   */
  needs?: "knowledge";
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
  | "finance"
  | "frontend"
  | "javascript"
  | "python"
  | "java"
  | "dotnet"
  | "cpp"
  | "go"
  | "rust"
  | "flutter"
  | "data"
  | "devops"
  | "design"
  | "security";

/**
 * The families, in the order the picker shows them.
 *
 * One per language or per body of practice, rather than the four coarse buckets this started as.
 * "Systems" grouped C, Go and Rust together and that was a filing decision, not a user's: nobody
 * works on all three today, and the point of choosing a family is to switch off what does not
 * apply. The rule for splitting is whether the answer would differ — a Go developer and a Rust
 * developer want different skills, an HTML author and a TypeScript author want different skills, so
 * those are different families.
 *
 * Every family must hold at least three skills. A heading with one entry under it is a heading that
 * makes the list longer without making the choice easier.
 */
// ⚠️ Rebuilt on a language change rather than built once: `t()` inside an array literal at module
// scope runs while the module is being evaluated, which is before the extension has read its own
// `language` setting. Without this the panel switched language and every one of these labels stayed
// behind. See `shared/i18n.ts`.
export const SKILL_GROUPS: Array<{ id: SkillGroup; label: string; hint: string }> = [];
onLanguageChange(() => {
  SKILL_GROUPS.length = 0;
  SKILL_GROUPS.push(
  { id: "general", label: t("Any language"), hint: t("Applies whatever you have open.") },
  { id: "frontend", label: t("HTML & CSS"), hint: t("Markup, styling, accessibility, responsive layout") },
  { id: "javascript", label: t("JavaScript & TypeScript"), hint: t("Types, modules, async, browser performance") },
  { id: "python", label: "Python", hint: t("Tests, typing, docstrings, idiom") },
  { id: "java", label: "Java", hint: t("JUnit, Javadoc, streams, null-safety, concurrency") },
  { id: "dotnet", label: t("C# & .NET"), hint: t("LINQ, async, XML documentation, tests") },
  { id: "cpp", label: "C & C++", hint: t("Ownership, undefined behavior, memory") },
  { id: "go", label: "Go", hint: t("Table tests, errors, goroutines, modules") },
  { id: "rust", label: "Rust", hint: t("Ownership, unsafe, errors, documentation") },
  { id: "flutter", label: t("Flutter & Dart"), hint: t("Widgets, state, tests, adaptive layout") },
  { id: "data", label: t("SQL & databases"), hint: t("Queries, indexes, schema, migrations") },
  { id: "devops", label: t("Build & deploy"), hint: t("Docker, CI, shell, configuration") },
  { id: "design", label: t("Design & UX"), hint: t("Layout, states, wording, motion") },
  { id: "security", label: t("Security"), hint: t("Threats, authorization, secrets, dependencies") },
  {
    id: "finance",
    label: t("Finance"),
    hint: t("Rounding, decimal, settlement, market hours, ISIN/LEI/BIC, FIX"),
  },
  );
});

export const BUILTIN_SKILLS: BuiltinSkill[] = [];
onLanguageChange(() => {
  BUILTIN_SKILLS.length = 0;
  BUILTIN_SKILLS.push(
  // ── Any language ────────────────────────────────────────────────────────────────────────────
  { group: "general", name: "/compact", hint: en("summarize the conversation and free the context"), action: "compact" },
  {
    group: "general",
    name: "/remember",
    needs: "knowledge",
    hint: en("record what we established in the knowledge base"),
    prompt: en(
      "Record in the knowledge base what this conversation established that will still be true next month.\n\n" +
        "Work like a librarian, not like a scribe:\n" +
        "1. Search first. Something on this subject may already exist, and the right move is almost always to correct it rather than to add a second note.\n" +
        "2. Write what is true of the system, the business or the team — never what happened in this conversation. “The settlement job runs before the batch” is knowledge; “we looked at the settlement job” is not.\n" +
        "3. One subject per note, with a title somebody scanning a list would recognize, and say where it came from.\n" +
        "4. If something recorded turned out to be wrong, retire it and say why.\n\n" +
        "If nothing durable came out of this conversation, say so and record nothing. A base full of nearly-nothing is worse than a small one.",
    ),
  },
  { group: "general", name: en("/explain"), hint: en("explain the file or the selection"), prompt: en("Explain this code: what it does, how it fits into the rest, and what deserves attention."), attach: true },
  { group: "general", name: "/tests", hint: en("write tests"), prompt: en("Write tests for this code, in the style and with the tools already used in this repository. Cover the edge cases."), attach: true },
  { group: "general", name: en("/fix"), hint: en("find and fix the problem"), prompt: en("Find the defect in this code and fix it. Say in one sentence what was wrong."), attach: true },
  {
    group: "general",
    name: en("/review"),
    hint: en("review: bugs, security, readability"),
    prompt: en(
      "Review this code: bugs first, then security, then readability. Order by severity, cite the lines, " +
        "and report nothing you are unsure of.\n\n" +
        "If nothing is attached, review what THIS BRANCH changes: use git_diff against the branch point " +
        "rather than reading the whole repository, because a line nobody touched is not this branch's " +
        "problem however much you would have written it differently. A change that is correct but " +
        "incomplete — a case not handled, a test not written — is a finding.\n\n" +
        "Say what you did NOT review: a file you could not read, a diff that was cut short.",
    ),
    attach: true,
  },
  { group: "general", name: "/doc", hint: en("document"), prompt: en("Document this code: a note above it, in the language and style of the file."), attach: true },
  { group: "general", name: en("/optimize"), hint: en("make it faster, without changing what it does"), prompt: en("Make this code faster without changing its behavior. Say what the cost was before and after, and refuse if the gain is not worth the loss of clarity."), attach: true },
  { group: "general", name: "/commit", hint: en("write the commit message"), prompt: en("Read the staged changes with git_diff and write the commit message for them. Subject line, then the why.") },
  { group: "general", name: "/names", hint: en("better names"), prompt: en("Rename what is badly named here: names that describe the type rather than the role, abbreviations only the author understands, and booleans that read backwards. Propose each rename with the reason, and change nothing else."), attach: true },
  { group: "general", name: "/simplify", hint: en("remove what is not needed"), prompt: en("Simplify this without changing what it does: dead branches, flags with one caller, indirection that hides rather than explains, and comments restating the code. Say what each removal costs if anything."), attach: true },
  { group: "general", name: "/errors", hint: en("handle the failures"), prompt: en("Find every failure this code does not handle: what can throw, what can return nothing, what can time out. Propose handling that leaves the caller able to act, not a swallowed exception."), attach: true },
  { group: "security", name: "/security", hint: en("security review"), prompt: en("Review this for security: injection through anything that reaches a query, a shell or a template; authorization checked at the boundary rather than in the caller; secrets in code or logs; unsafe deserialisation. Rank by exploitability and say what an attacker would need."), attach: true },


  // ── Finance ─────────────────────────────────────────────────────────────────────────────────
  {
    group: "finance",
    name: en("/rounding"),
    hint: en("round money the way an invoice does"),
    evalTask: "js-money-rounding",
    prompt: en(
      "Review how this rounds money.\n" +
        "1. Say which rule is in force and which one the business needs: half away from zero (what an invoice does), half to even (what a float library does by default), or truncation. They differ on exactly one input and that input is a half cent.\n" +
        "2. Check the NEGATIVE case. `Math.round`, Python's `round` and Java's `BigDecimal.ROUND_HALF_UP` do not agree about -0.5, and a credit note that refunds a cent less than the invoice charged is a reconciliation difference nobody can find.\n" +
        "3. Round ONCE, at the end. Rounding each line and summing gives a total that differs from rounding the sum, and both are defensible — but only one of them is what the ledger says.\n" +
        "4. Say what the rounding does to the invariant: if a set of parts must total the whole, the residue has to go somewhere, and 'somewhere' is a decision rather than an accident.\n"
    ),
    attach: true,
  },
  {
    group: "finance",
    name: en("/decimal"),
    hint: en("money without a float, anywhere"),
    evalTask: "py-decimal-money",
    prompt: en(
      "Find every place a monetary value touches a binary floating-point type here, and remove it.\n" +
        "1. A float cannot hold 0.10. Everything that follows from that — a total that is 0.30000000000000004, a comparison that fails, a cent that appears from nowhere — is not a bug to be patched, it is the type being wrong.\n" +
        "2. Use the exact type the language has: Decimal in Python, BigDecimal in Java, an integer number of minor units in JavaScript. Say which you chose and what its precision is.\n" +
        "3. Watch the BOUNDARIES, which is where this survives a rewrite: a JSON number is a double, a float column in the database is a double, and a value that was exact until it was serialised is a value that is no longer exact.\n" +
        "4. Say what the precision must be rather than taking a default: two decimals for most currencies, three for a dinar, none for a yen, and more than two for a rate.\n"
    ),
    attach: true,
  },
  {
    group: "finance",
    name: en("/settlement"),
    hint: en("settlement dates, T+1 and T+2"),
    evalTask: "fin-settlement",
    prompt: en(
      "Work out the settlement dates here.\n" +
        "1. Skip weekends AND the holidays — and the holidays must be a PARAMETER. A calendar built into the code is wrong in another country and wrong next year, and the person who finds out is a counterparty.\n" +
        "2. Say which calendar applies: the venue's, the currency's, or both. A cross-border trade settles when both sides are open, which is not the same as either.\n" +
        "3. T+0 still has to land on a business day. Nothing settles on a Sunday, so a same-day convention moves forward rather than staying put.\n" +
        "4. Say what happens at a month end and across a year end, and whether the convention is 'following', 'modified following' or 'preceding' — they differ only on the day that matters.\n"
    ),
    attach: true,
  },
  {
    group: "finance",
    name: en("/markethours"),
    hint: en("time zones and market sessions"),
    evalTask: "fin-market-hours",
    prompt: en(
      "Review how this decides whether a venue is open.\n" +
        "1. Use the venue's OWN time zone and its session in local time. A window written in UTC is right for half the year: the exchange does not move its bell when the clocks change, so the UTC offset of the open is not a constant.\n" +
        "2. Name the time zone rather than an offset. `Europe/Paris` knows when the clocks change; `+01:00` does not, and the day it is wrong is a day somebody traded.\n" +
        "3. Watch the two transitions: an hour that happens twice and an hour that does not exist. A timestamp in either is ambiguous, and 'it compiled' is not an answer about which one you meant.\n" +
        "4. Holidays and half-days come from the caller, and an auction or a pre-open is part of the session or it is not — say which.\n"
    ),
    attach: true,
  },
  {
    group: "finance",
    name: en("/identifiers"),
    hint: en("validate ISIN, LEI and BIC properly"),
    evalTask: "fin-identifiers",
    prompt: en(
      "Validate these identifiers properly rather than by their length.\n" +
        "1. ISIN: twelve characters, a two-letter country code, and a Luhn check digit over the letters converted to digits — each letter becoming its position in the alphabet plus nine BEFORE the digits are concatenated. Converting afterwards gives a different number and a check that always fails.\n" +
        "2. LEI: twenty characters, ISO 17442, which is ISO 7064 MOD 97-10 — the whole string as digits, modulo 97, must be 1.\n" +
        "3. BIC: the shape is part of what makes it one — four letters, two letters for the country, two alphanumerics, and an optional three-character branch. Eight characters of the wrong shape is not a BIC.\n" +
        "4. Never throw on bad input: these are validated on whatever a form submitted, and a validator that throws has to be wrapped by every caller, which is the same check written again in the wrong place.\n"
    ),
    attach: true,
  },
  {
    group: "finance",
    name: en("/fixmsg"),
    hint: en("FIX messages a counterparty accepts"),
    evalTask: "fin-fix-message",
    prompt: en(
      "Review this FIX message.\n" +
        "1. BodyLength (tag 9) counts the bytes from the SOH that ends tag 9 to the start of tag 10 — not the whole message, and not the body plus the header.\n" +
        "2. CheckSum (tag 10) covers EVERYTHING before it, including `8=` and `9=`, modulo 256, as three digits ZERO-PADDED. A two-digit checksum is right ninety-nine times in a hundred, which is worse than being always wrong.\n" +
        "3. Check the field order where the specification fixes it: 8, 9 and 35 first, 10 last. A counterparty rejects on order before it reads the order.\n" +
        "4. Say which FIX version this is and which fields are required for this message type in it — a field that became required in 4.4 is a rejection on a venue that upgraded.\n"
    ),
    attach: true,
  },
  {
    group: "finance",
    name: en("/amortise"),
    hint: en("schedules whose parts total the whole"),
    evalTask: "fin-amortisation",
    prompt: en(
      "Review this schedule.\n" +
        "1. The instalments must total the principal EXACTLY. Rounding each one and multiplying back gives a schedule that differs from the loan by a few cents, and that difference is a reconciliation item somebody chases for an afternoon.\n" +
        "2. Say where the residue goes: spread one minor unit at a time over the first instalments, or all of it on the last. Both are defensible; only one matches the contract.\n" +
        "3. Work in minor units, as integers. Every version of this defect begins with a division in floating point.\n" +
        "4. Say what happens at the boundaries: one instalment, zero instalments, a principal smaller than the number of instalments.\n"
    ),
    attach: true,
  },

  // ── Web ─────────────────────────────────────────────────────────────────────────────────────
  { group: "frontend", name: "/a11y", hint: en("accessibility audit"), prompt: en("Audit this against WCAG 2.2 AA: the accessible name of every control, keyboard reachability and focus order, contrast, ARIA used where a native element would do, and what a screen reader announces. Cite the criterion for each finding and separate what is certain from what needs a browser."), attach: true },
  { group: "frontend", name: "/semantic", hint: en("the right HTML elements"), prompt: en("Rewrite this markup with the elements that carry its meaning: landmarks, headings in order, lists for lists, buttons for actions and links for navigation. Say what each change gives a screen reader that the original did not."), attach: true },
  { group: "frontend", name: "/css", hint: en("simplify the stylesheet"), prompt: en("Review this CSS: specificity that will be hard to override, magic numbers, layout done with hacks where the cascade or grid would do, and anything that breaks on a narrow screen or in the other color scheme. Propose the simpler version."), attach: true },
  { group: "frontend", name: "/responsive", hint: en("make it hold at every width"), prompt: en("Find where this breaks between a phone and a wide monitor: fixed widths, text that cannot wrap, tables and code that overflow, touch targets under 44 px. Fix it with the intrinsic sizing that removes the breakpoint rather than adding one."), attach: true },
  { group: "javascript", name: "/types", hint: en("tighten the TypeScript types"), prompt: en("Tighten the types here: replace `any` and unchecked casts with types the compiler can verify, narrow rather than assert, and make impossible states unrepresentable. Change no behavior, and say which changes would fail the build elsewhere."), attach: true },
  { group: "javascript", name: "/jsdoc", hint: en("document the exported API"), prompt: en("Write JSDoc for what this module exports: the contract, the parameters, what is returned, what throws, and the example that removes the need to read the body. Do not restate the signature."), attach: true },
  { group: "javascript", name: "/perf-web", hint: en("what makes the page slow"), prompt: en("Find what costs the most here: layout thrash, work on every keystroke or scroll without throttling, bundles pulled in for one function, images without dimensions. Give the cheapest fix for each and say what it is worth."), attach: true },

  // ── Python ──────────────────────────────────────────────────────────────────────────────────
  { group: "python", name: "/pytest", hint: en("write pytest tests"), prompt: en("Write pytest tests for this: plain functions, fixtures for the setup, parametrize for the table of cases, and a name per test saying what it asserts. Cover the boundaries and the error paths, and use no mock where a real object is cheap."), attach: true },
  { group: "python", name: "/hints", hint: en("add type hints"), prompt: en("Add type hints complete enough for mypy in strict mode. Prefer the standard collections and `X | None` over Optional, be precise about what is mutated, and change no behavior. Say where a hint was impossible without altering the design."), attach: true },
  { group: "python", name: "/docstring", hint: en("write the docstrings"), prompt: en("Write docstrings in the style already used in the file, or Google style if there is none: what it does, what the arguments mean, what it returns and what it raises. Do not restate the signature in prose."), attach: true },
  { group: "python", name: "/pythonic", hint: en("make it idiomatic Python"), prompt: en("Rewrite this as a Python developer would: comprehensions where they read better than the loop, context managers for anything with a lifetime, the standard library over a hand-rolled version, dataclasses or enums where a dict stands in for a type. Refuse any change that trades clarity for cleverness."), attach: true },
  { group: "python", name: "/asyncio", hint: en("review the async code"), prompt: en("Review this asyncio code: blocking calls on the event loop, tasks created and never awaited, cancellation that leaves state half-written, and gather where a task group would give better failure behavior."), attach: true },

  // ── Java ────────────────────────────────────────────────────────────────────────────────────
  { group: "java", name: "/junit", hint: en("write JUnit 5 tests"), prompt: en("Write JUnit 5 tests: @Test with @DisplayName saying what is asserted, @ParameterizedTest where the cases are data, AssertJ if the project uses it, @Nested to group the cases of one behavior. Cover the exceptions as well as the happy path."), attach: true },
  { group: "java", name: "/javadoc", hint: en("write the Javadoc"), prompt: en("Write Javadoc: what it does and why it exists, @param, @return, @throws, @since where the project uses it. Document the contract — nullability, thread safety, what the caller owns — rather than the implementation."), attach: true },
  { group: "java", name: "/streams", hint: en("loops to streams, where it reads better"), prompt: en("Where the Stream API reads better than the loop, rewrite it — and where it does not, say so and leave the loop. Keep laziness in mind, do not collect a stream only to iterate it, and never hide a side effect inside a map."), attach: true },
  { group: "java", name: "/nullsafe", hint: en("find what can be null"), prompt: en("Find every path where a null can arrive unhandled. Propose the fix that removes the possibility — Optional at the boundary, an invariant enforced at construction, a validated parameter — rather than a null check at each use."), attach: true },
  { group: "java", name: "/concurrent", hint: en("review the concurrency"), prompt: en("Review this for concurrency: shared mutable state without a happens-before edge, locks taken in different orders, collections that are not thread-safe, and executors never shut down. Say what would actually go wrong and under what load."), attach: true },

  // ── .NET ────────────────────────────────────────────────────────────────────────────────────
  { group: "dotnet", name: "/xmldoc", hint: en("write the XML documentation"), prompt: en("Write XML documentation comments: <summary>, <param>, <returns>, <exception>, and <remarks> for the contract the signature cannot state. Document nullability as the compiler sees it."), attach: true },
  { group: "dotnet", name: "/linq", hint: en("loops to LINQ, where it reads better"), prompt: en("Where LINQ reads better than the loop, rewrite it — and where it does not, leave it and say why. Watch for multiple enumeration of the same sequence and for queries that hit the database once per row."), attach: true },
  { group: "dotnet", name: "/asyncnet", hint: en("review the async/await"), prompt: en("Review this async code: async void outside an event handler, .Result or .Wait() that can deadlock, missing ConfigureAwait in library code, and CancellationToken accepted and never passed on."), attach: true },
  { group: "dotnet", name: "/nunit", hint: en("write the tests"), prompt: en("Write tests in the framework this project already uses (xUnit, NUnit or MSTest): one behavior per test, data-driven cases where they are data, and a name that says what is asserted. Cover the exceptions."), attach: true },

  // ── Systems ─────────────────────────────────────────────────────────────────────────────────
  { group: "go", name: "/gotest", hint: en("write Go table tests"), prompt: en("Write Go tests in the table style: a slice of cases with names, t.Run per case, t.Parallel where it is safe, and the standard library rather than an assertion framework. Cover the error returns."), attach: true },
  { group: "go", name: "/goroutines", hint: en("review the goroutines"), prompt: en("Review the concurrency here: goroutines started and never joined, channels that can block for ever, a context accepted and not honoured, and shared state without a mutex or a channel. Say what would deadlock and under what conditions."), attach: true },
  { group: "go", name: "/gomod", hint: en("review the module"), prompt: en("Review this module: dependencies pulled in for one function, versions that are not pinned where they matter, a replace directive left from local work, and packages that would be better internal. Say what each change costs."), attach: true },
  { group: "go", name: "/goerr", hint: en("review the error handling"), prompt: en("Review the error handling: errors swallowed or logged and returned twice, missing context from %w, sentinel errors compared with == where errors.Is is needed, and defers that hide a failure to close."), attach: true },
  { group: "rust", name: "/borrow", hint: en("review the Rust ownership"), prompt: en("Review the ownership here: clones that exist to satisfy the borrow checker rather than the design, lifetimes that could be elided, Rc/RefCell standing in for a structure that does not need shared mutation, and unwrap on a path that can fail."), attach: true },
  { group: "rust", name: "/rusterr", hint: en("review the error handling"), prompt: en("Review the errors here: unwrap and expect on paths that can fail, a single error type doing the work of several, missing From impls that would let ? work, and errors that lose their cause. Propose the enum the caller can actually match on."), attach: true },
  { group: "rust", name: "/rustdoc", hint: en("document the crate"), prompt: en("Write doc comments for what this crate exports: what it is for, the invariants, what panics and when, and an example that compiles. Use //! for the module and /// for items, and link other items with square brackets."), attach: true },
  { group: "rust", name: "/unsafe", hint: en("justify or remove the unsafe"), prompt: en("For each unsafe block or raw pointer here: state the invariant that makes it sound, or show the safe construction that removes it. Treat an unsafe block without a written invariant as a defect."), attach: true },
  { group: "cpp", name: "/raii", hint: en("make the lifetime the type's job"), prompt: en("Rewrite this C++ so ownership is expressed in types: unique_ptr or a value where a raw owning pointer is used, RAII for anything acquired and released, the rule of zero where the compiler can write the special members. Say what each change makes impossible."), attach: true },
  { group: "cpp", name: "/undefined", hint: en("find the undefined behavior"), prompt: en("Find the undefined behavior here: reads past a bound, signed overflow, strict-aliasing violations, uninitialized reads, use after move, and lifetimes ending before the last use. For each, say what a compiler is permitted to do with it."), attach: true },
  { group: "cpp", name: "/memory", hint: en("who owns what"), prompt: en("Trace ownership through this code: what allocates, what frees, what can be used after free or freed twice, and where a bound is checked. Propose the structure that makes the lifetime obvious rather than a comment claiming it."), attach: true },

  // ── Mobile ──────────────────────────────────────────────────────────────────────────────────
  { group: "flutter", name: "/widget", hint: en("review the widget tree"), prompt: en("Review this widget tree: work done in build(), const constructors missing where the subtree never changes, setState rebuilding more than it needs, and layout that overflows on a small screen. Give the restructured tree."), attach: true },
  { group: "flutter", name: "/darttest", hint: en("write the Flutter tests"), prompt: en("Write tests for this in the right kind: a unit test for pure logic, a widget test with pumpWidget and finders for the UI, a golden test where the look is the contract. Name each test for the behavior it pins."), attach: true },
  { group: "flutter", name: "/state", hint: en("review the state management"), prompt: en("Review how state is held here: state above the widget that owns it, rebuilds wider than the change, controllers and streams never disposed, and business logic inside a widget. Propose the arrangement that fits the pattern this project already uses."), attach: true },
  { group: "flutter", name: "/dartdoc", hint: en("document the Dart API"), prompt: en("Write doc comments for what this library exports: the contract, the parameters, what is returned, what throws, and a short example. Use /// and reference other symbols with square brackets."), attach: true },
  { group: "flutter", name: "/adaptive", hint: en("make it hold on every device"), prompt: en("Find where this breaks between a small phone and a tablet: hard-coded sizes, text that ignores the platform scale factor, touch targets under 48 dp, and layout that assumes one orientation. Fix it with layout that adapts rather than with a device check."), attach: true },

  // ── SQL & data ──────────────────────────────────────────────────────────────────────────────
  { group: "data", name: "/query", hint: en("review the query"), prompt: en("Review this query: what it will scan, whether the predicates are sargable, joins that multiply rows, and correlated subqueries that run per row. Give the rewrite and say what you expect the plan to change to."), attach: true },
  { group: "data", name: "/index", hint: en("which index this needs"), prompt: en("Propose the indexes this workload needs, with the column order and the reason for it. Say which existing index each new one makes redundant, and what the write cost is."), attach: true },
  { group: "data", name: "/schema", hint: en("review the schema"), prompt: en("Review this schema: keys that do not identify, nullable columns standing in for a missing table, types that lose precision, and constraints the application is enforcing instead of the database. Propose the corrected DDL."), attach: true },
  { group: "data", name: "/migration", hint: en("write a safe migration"), prompt: en("Write this migration so it can run against a live table: no long lock, backfill separated from the schema change, and a state where old and new code both work. Give the rollback, and say what makes it irreversible if it is."), attach: true },

  // ── Build & deploy ──────────────────────────────────────────────────────────────────────────
  { group: "devops", name: "/dockerfile", hint: en("review the Dockerfile"), prompt: en("Review this Dockerfile: layer order that defeats the cache, build tools left in the final image, running as root, a tag that is not pinned, and secrets passed as build arguments. Give the corrected file."), attach: true },
  { group: "devops", name: "/ci", hint: en("review the pipeline"), prompt: en("Review this pipeline: steps that could run in parallel, caches that never hit, a failure that does not fail the build, secrets exposed to a fork's pull request, and actions pinned to a moving tag."), attach: true },
  { group: "devops", name: "/shell", hint: en("make the script safe"), prompt: en("Harden this shell script: set -euo pipefail, quote every expansion, handle a path with a space, avoid parsing ls, and check that each command exists before using it. Say what would have gone wrong without each change."), attach: true },
  { group: "devops", name: "/config", hint: en("review the configuration"), prompt: en("Review this configuration: values that differ between environments and are hard-coded, secrets in the file, defaults that are unsafe in production, and settings with no effect because something later overrides them."), attach: true },

  // ── Design & UX ─────────────────────────────────────────────────────────────────────────────
  //
  // Not decoration: every one of these is a defect class that ships because nobody looked for it.
  { group: "design", name: "/ux", hint: en("review the interface"), prompt: en("Review this interface: what the user is trying to do and how many steps it takes, what is unclear without a tooltip, what happens on the unhappy path, and what a first-time reader would get wrong. Rank by how often it will bite."), attach: true },
  { group: "design", name: "/states", hint: en("the states nobody drew"), prompt: en("List the states this interface can be in — empty, loading, one item, far too many, too long a name, offline, no permission, failed — and say what it shows in each. Write the ones that are missing."), attach: true },
  { group: "design", name: "/copy", hint: en("rewrite the wording"), prompt: en("Rewrite the text in this interface: labels that say what happens rather than what the code does, errors that say what to do next, no apologies, no jargon the user did not choose. Keep it shorter than what it replaces."), attach: true },
  { group: "design", name: "/spacing", hint: en("the layout system"), prompt: en("Review the layout here against one scale: spacing values outside it, alignments off by a pixel or two, type sizes that are nearly the same, and whitespace that groups the wrong things together. Give the corrected values."), attach: true },
  { group: "design", name: "/motion", hint: en("review the animation"), prompt: en("Review the motion here: durations that make the interface feel slow, easing that is linear where it should not be, animation on something the user is trying to read, and no honouring of prefers-reduced-motion."), attach: true },

  // ── Security ────────────────────────────────────────────────────────────────────────────────
  { group: "security", name: "/threats", hint: en("threat model this"), prompt: en("Threat-model this: what an attacker wants, where they can reach it from, what they need to get it, and what stops them today. Rank by how easy each path is rather than by how bad the outcome sounds."), attach: true },
  { group: "security", name: "/authz", hint: en("check the authorization"), prompt: en("Check authorization here: whether it is enforced at the boundary or trusted from the caller, whether the object being acted on is checked and not only the action, and what a user of another tenant would be able to reach. Show the missing check."), attach: true },
  { group: "security", name: "/crypto", hint: en("review the cryptography"), prompt: en("Review the cryptography here: primitives chosen rather than borrowed from a tutorial, key length and derivation, an IV or nonce that is unique, comparison that is constant-time, and randomness from a CSPRNG. Say what a wrong answer would cost."), attach: true },
  { group: "security", name: "/secrets", hint: en("find the secrets"), prompt: en("Find what should not be in this code: credentials, tokens, connection strings, private keys, and anything logged that carries them. Say where each belongs instead and what has to be rotated if it is already committed."), attach: true },
  { group: "security", name: "/deps", hint: en("review the dependencies"), prompt: en("Review these dependencies: what is unmaintained, what is pulled in for one function, what runs code at install time, and what has a known advisory. Say which could be dropped and what replacing each would cost."), attach: true },
  );
});

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
 * The families in play when nothing has been chosen and nothing is open.
 *
 * `general` alone. What the open files imply is added on top by `familiesInPlay`, which is where the
 * phrase "the ones that apply whatever you have open" actually became true.
 */
export const DEFAULT_GROUPS: SkillGroup[] = ["general"];

/**
 * Which skills are on, in two parts — and the two parts are not the same kind of thing.
 *
 * A FAMILY is opt-in. Only `general` is on to begin with, because the alternative is what this
 * started as: seventy skills all enabled, a `/` list nobody can read, and — the reason the user
 * noticed — every box ticked in a picker whose whole purpose is choosing. Being handed a
 * pre-answered question is worse than being handed no question.
 *
 * A SKILL inside an active family is opt-OUT, and the asymmetry is deliberate: a skill added by an
 * update, or committed by a colleague, into a family you already use should arrive working. Storing
 * the enabled set instead would ship every future skill switched off and invisible.
 */
export interface SkillPolicy {
  /** Families in play. */
  groups: SkillGroup[];
  /** Individual skills switched off inside an active family. */
  disabled: string[];
}

export function isSkillEnabled(name: string, policy: SkillPolicy | string[]): boolean {
  if (ALWAYS_ON.has(name)) return true;
  // The array form is the old shape, kept because repository skills have no family and are governed
  // by the disabled list alone.
  if (Array.isArray(policy)) return !policy.includes(name);
  const skill = BUILTIN_SKILLS.find((s) => s.name === name);
  if (skill && !policy.groups.includes(skill.group)) return false;
  return !policy.disabled.includes(name);
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
 * The families after a choice, with `general` always kept.
 *
 * A profile that silenced `/fix` because you said "Rust" would be a profile nobody uses twice.
 */
export function normalizeGroups(groups: SkillGroup[]): SkillGroup[] {
  const known = new Set(SKILL_GROUPS.map((g) => g.id));
  const kept = new Set<SkillGroup>(["general", ...groups.filter((g) => known.has(g))]);
  return SKILL_GROUPS.map((g) => g.id).filter((id) => kept.has(id));
}

/** The skills a policy actually offers, in catalogue order. */
export function enabledSkills(policy: SkillPolicy): BuiltinSkill[] {
  return BUILTIN_SKILLS.filter((s) => isSkillEnabled(s.name, policy));
}

/**
 * What the workspace looks like it is made of.
 *
 * A suggestion, never an imposition — offered as the pre-ticked answer where the user can change it
 * in one click. Detection from the languages the editor has actually opened rather than from a file
 * scan: what someone has open is a far better signal of what they are working on today than what
 * the repository contains, and a monorepo contains everything.
 *
 * Returns an empty list when nothing is recognized, which the caller reads as "ask, do not assume".
 */
export function detectGroups(languageIds: string[]): SkillGroup[] {
  const seen = new Set(languageIds.map((id) => id.toLowerCase()));
  const has = (...ids: string[]) => ids.some((id) => seen.has(id));
  const found: SkillGroup[] = [];
  if (has("html", "css", "scss", "less", "vue", "svelte", "handlebars")) found.push("frontend");
  if (has("javascript", "javascriptreact", "typescript", "typescriptreact")) found.push("javascript");
  if (has("python")) found.push("python");
  if (has("java", "kotlin", "groovy")) found.push("java");
  if (has("csharp", "fsharp", "vb")) found.push("dotnet");
  if (has("c", "cpp", "objective-c", "objective-cpp")) found.push("cpp");
  if (has("go")) found.push("go");
  if (has("rust")) found.push("rust");
  if (has("dart")) found.push("flutter");
  if (has("sql", "plsql", "postgres", "mysql")) found.push("data");
  if (has("dockerfile", "shellscript", "yaml", "terraform", "makefile")) found.push("devops");
  return found;
}

/**
 * The editor language id a path would be opened as.
 *
 * ⚠️ This exists because `detectGroups` speaks the editor's vocabulary — `typescriptreact`,
 * `shellscript` — and the terminal has only paths. Without it the terminal could not detect
 * anything at all, and the consequence was not small: the evaluation harness drives the terminal, so
 * every figure in `eval/QUALITY.md` was measured with `general` alone, and the language skill
 * families were switched off while the bench ran.
 *
 * Only the extensions the families actually key on. A map of every extension in existence would be a
 * list nobody maintains; this one has a test that keeps it aligned with `detectGroups`.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  html: "html", htm: "html", css: "css", scss: "scss", less: "less", vue: "vue", svelte: "svelte",
  js: "javascript", jsx: "javascriptreact", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescriptreact", mts: "typescript", cts: "typescript",
  py: "python", java: "java", kt: "kotlin", groovy: "groovy",
  cs: "csharp", fs: "fsharp", vb: "vb",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", m: "objective-c", mm: "objective-cpp",
  go: "go", rs: "rust", dart: "dart",
  sql: "sql", pls: "plsql",
  tf: "terraform", yaml: "yaml", yml: "yaml", sh: "shellscript", bash: "shellscript",
};

export function languageIdForPath(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop() ?? "";
  if (/^dockerfile$/i.test(name)) return "dockerfile";
  if (/^makefile$/i.test(name)) return "makefile";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION[ext];
}

/** The families a set of PATHS implies, for a caller that has no editor to ask. */
export function groupsForPaths(paths: string[]): SkillGroup[] {
  return detectGroups(paths.map((p) => languageIdForPath(p)).filter((id): id is string => Boolean(id)));
}

/**
 * The families in play for a conversation: what was chosen, plus what the open files imply.
 *
 * ⚠️ `detectGroups` existed for a long time and did almost nothing with its answer — it pre-ticked a
 * box in a wizard most people never open. So somebody editing Python with the default settings got
 * `general` and nothing else: the language's skills sat switched off while the model guessed. Florian, reading a session full of mistakes: "the automatic
 * detection of open programs doesn't seem to do the automated enabling and disabling of skills
 * either, which would explain why it makes so many errors". The detection was
 * right; nothing acted on it. The comment in `config.ts` even claimed families "default to the ones
 * that apply whatever is open", which is what the code should have done and did not.
 *
 * Two rules make this safe to do automatically:
 *
 * **It only ever adds.** A family the user chose is never dropped because today's files do not imply
 * it — turning off a skill somebody deliberately asked for, in order to be helpful, is the version
 * of this feature nobody would keep switched on. Deactivation still happens, and it is the
 * harmless kind: a family that was on ONLY because a file was open is gone from the next
 * conversation once that file is not.
 *
 * **It is decided once per conversation, not per turn.** This list goes into the cacheable prefix
 * (see `core/prompts.ts`): a prefix that changed every time the user clicked a different tab would
 * invalidate the whole cache on every turn, which costs far more than the skills are worth. "Which
 * skills exist" is a fact about this conversation, and that is the only reason it may live there.
 *
 * `fromOpenFiles` is what the panel needs to say WHY a family is lit up, because a setting that
 * turns itself on without saying so is indistinguishable from a bug.
 */
export function familiesInPlay(
  chosen: SkillGroup[],
  openLanguages: string[],
  auto: boolean,
): { groups: SkillGroup[]; fromOpenFiles: SkillGroup[] } {
  if (!auto) return { groups: normalizeGroups(chosen), fromOpenFiles: [] };
  const detected = detectGroups(openLanguages);
  const fromOpenFiles = detected.filter((g) => !chosen.includes(g));
  return { groups: normalizeGroups([...chosen, ...detected]), fromOpenFiles };
}

/**
 * A repository skill's invocation name.
 *
 * Defined once because it is a join key: the panel's toggle, the stored setting and the prompt the
 * model receives all have to agree on how a skill named `review-api` in a file is spelled in a
 * list. They disagreed at first, and the symptom was a toggle that appeared to do nothing.
 */
export function skillInvocation(name: string): string {
  return name.startsWith("/") ? name : `/${name}`;
}

/**
 * The built-in skills, in the shape the model is offered.
 *
 * ⚠️ They were invisible to the model. All of them — the finance ones each
 * backed by an evaluation task that fails before it is applied — were reachable **only by a user
 * typing the right slash command**. Somebody who does not know that `/rounding` exists never benefits
 * from it, which makes a whole axis of this product's expertise conditional on knowing a magic word.
 *
 * They reach the model through the mechanism the repository's own skills already use (see
 * `skillsPrompt` and `use_skill`): the NAME and one line in the prompt, the instructions only when
 * the model asks for them. Nothing new is invented — one more source feeds an existing path, which
 * is also why the token cost is bounded by what the user has switched on rather than by the whole
 * catalogue of seventy-five.
 *
 * A skill whose job is an ACTION on the conversation (`/compact`) is left out: there are no
 * instructions to read, and offering it would let the model announce something it cannot do.
 */
export function builtinSkillsForModel(skills: BuiltinSkill[]): Array<{
  kind: "skill";
  name: string;
  description: string;
  body: string;
  source: string;
}> {
  return skills
    .filter((sk) => typeof sk.prompt === "string" && sk.prompt.trim().length > 0)
    .map((sk) => ({
      kind: "skill" as const,
      name: sk.name,
      description: sk.hint,
      body: sk.prompt as string,
      source: "built in",
    }));
}
