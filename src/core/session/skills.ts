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

import { t, onLanguageChange } from "../../shared/i18n.js";

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
   * that rots: the roadmap's requirement is that every IBM i skill be backed by a task whose check
   * FAILS before the work is done, and the only way that requirement survives the next skill
   * somebody adds is if a test can read it off the skill itself. `tests/skills.test.ts` checks that
   * every skill in the IBM i families names one and that the directory exists; `eval:verify` and
   * `eval:solutions` already check that the task itself is honest in both directions.
   *
   * One task may back several skills, which is honest where they are the same subject seen from two
   * sides — `/tofree` and `/cycle` are both about getting out of the fixed-format program — and is
   * not an excuse to point five unrelated skills at one convenient task.
   */
  evalTask?: string;
  /**
   * Why no evaluation task backs this skill, when none can.
   *
   * Two of the IBM i skills cannot be exercised by the bench at all: their answer comes from a live
   * partition — `DSPPGMREF` over a real library — and a fixture cannot stand in for it without the
   * fixture becoming the thing being tested. The honest construction is not to point them at a
   * convenient unrelated task, and not to leave them silently unbacked either, but to say so HERE,
   * where it is countable and reviewable. The test requires one of `evalTask` or `evalGap`.
   */
  evalGap?: string;
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
  | "security"
  | "rpg"
  | "dds"
  | "db2i"
  | "cl";

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
  { id: "rpg", label: t("RPG & ILE"), hint: t("Free-form conversion, procedures, embedded SQL") },
  { id: "dds", label: t("DDS, display & printer files"), hint: t("PF, LF, DSPF, PRTF") },
  { id: "db2i", label: t("Db2 for i"), hint: t("SQL, commitment control, catalogue, journalling") },
  { id: "cl", label: "CL", hint: t("Programs, message handling, parameters") },
  );
});

export const BUILTIN_SKILLS: BuiltinSkill[] = [];
onLanguageChange(() => {
  BUILTIN_SKILLS.length = 0;
  BUILTIN_SKILLS.push(
  // ── Any language ────────────────────────────────────────────────────────────────────────────
  { group: "general", name: "/compact", hint: t("summarize the conversation and free the context"), action: "compact" },
  {
    group: "general",
    name: "/remember",
    needs: "knowledge",
    hint: t("record what we established in the knowledge base"),
    prompt: t(
      "Record in the knowledge base what this conversation established that will still be true next month.\n\n" +
        "Work like a librarian, not like a scribe:\n" +
        "1. Search first. Something on this subject may already exist, and the right move is almost always to correct it rather than to add a second note.\n" +
        "2. Write what is true of the system, the business or the team — never what happened in this conversation. “The settlement job runs before the batch” is knowledge; “we looked at the settlement job” is not.\n" +
        "3. One subject per note, with a title somebody scanning a list would recognize, and say where it came from.\n" +
        "4. If something recorded turned out to be wrong, retire it and say why.\n\n" +
        "If nothing durable came out of this conversation, say so and record nothing. A base full of nearly-nothing is worse than a small one.",
    ),
  },
  { group: "general", name: t("/explain"), hint: t("explain the file or the selection"), prompt: t("Explain this code: what it does, how it fits into the rest, and what deserves attention."), attach: true },
  { group: "general", name: "/tests", hint: t("write tests"), prompt: t("Write tests for this code, in the style and with the tools already used in this repository. Cover the edge cases."), attach: true },
  { group: "general", name: t("/fix"), hint: t("find and fix the problem"), prompt: t("Find the defect in this code and fix it. Say in one sentence what was wrong."), attach: true },
  {
    group: "general",
    name: t("/review"),
    hint: t("review: bugs, security, readability"),
    prompt: t(
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
  { group: "general", name: "/doc", hint: t("document"), prompt: t("Document this code: a note above it, in the language and style of the file."), attach: true },
  { group: "general", name: t("/optimize"), hint: t("make it faster, without changing what it does"), prompt: t("Make this code faster without changing its behavior. Say what the cost was before and after, and refuse if the gain is not worth the loss of clarity."), attach: true },
  { group: "general", name: "/commit", hint: t("write the commit message"), prompt: t("Read the staged changes with git_diff and write the commit message for them. Subject line, then the why.") },
  { group: "general", name: "/names", hint: t("better names"), prompt: t("Rename what is badly named here: names that describe the type rather than the role, abbreviations only the author understands, and booleans that read backwards. Propose each rename with the reason, and change nothing else."), attach: true },
  { group: "general", name: "/simplify", hint: t("remove what is not needed"), prompt: t("Simplify this without changing what it does: dead branches, flags with one caller, indirection that hides rather than explains, and comments restating the code. Say what each removal costs if anything."), attach: true },
  { group: "general", name: "/errors", hint: t("handle the failures"), prompt: t("Find every failure this code does not handle: what can throw, what can return nothing, what can time out. Propose handling that leaves the caller able to act, not a swallowed exception."), attach: true },
  { group: "security", name: "/security", hint: t("security review"), prompt: t("Review this for security: injection through anything that reaches a query, a shell or a template; authorization checked at the boundary rather than in the caller; secrets in code or logs; unsafe deserialisation. Rank by exploitability and say what an attacker would need."), attach: true },


  {
    group: "rpg",
    name: "/deliver",
    hint: t("hand the change to ARCAD, ready for a person to release"),
    evalTask: "ibmi-rpg-unittest",
    // The last step is the one that does not exist, and saying so is the whole skill: an agent that
    // promotes to production is an agent nobody can let near a managed partition.
    prompt: t(
      "Get this change ready to hand to ARCAD.\n\n" +
        "1. Compile it with ibmi_compile. A member that does not compile has produced no object: there " +
        "is nothing to deliver and nothing to discuss.\n" +
        "2. Run the tests with ibmi_test. Compiling proves it is a program; it does not prove it still " +
        "does what it did. If there are no tests for what you changed, say so plainly rather than " +
        "treating a clean compile as a pass.\n" +
        "3. Only then check it in with the arcad checkin action, and ask ARCAD Builder for a build with " +
        "request_build — in that order, because a build asked for before the check-in builds the " +
        "previous version and reports success.\n" +
        "4. Report what you did with the evidence attached: the compile, the tests, and the component you " +
        "checked in.\n" +
        "5. Do NOT promote anything. Moving a change towards production is a release decision and it " +
        "belongs to whoever is accountable for the release — say that the change is ready and who has to " +
        "take it from here. There is no tool for it and there is not meant to be.",
    ),
    attach: true,
  },
  // ── IBM i, the families the roadmap asks to complete ─────────────────────────────────────────
  {
    group: "rpg",
    name: "/indicators",
    hint: t("numbered indicators to named ones"),
    evalTask: "ibmi-rpg-indicators",
    prompt: t(
      "Replace the numbered indicators in this member with named indicator variables.\n" +
        "\n" +
        "1. Leave alone every indicator DDS owns: a display file's function keys and its error indicators are the screen's, not the program's. Say which ones you left and why.\n" +
        "2. For each of the program's own flags, give it a name that says what it MEANS rather than what it does — badQuantity, not errorFlag2.\n" +
        "3. Change no behaviour. An indicator that is both set and tested in two places is one variable, not two.\n" +
        "4. Where an indicator was standing in for a condition that can simply be re-evaluated, say so: the best fix is often no flag at all.\n"
    ),
    attach: true,
  },
  {
    group: "rpg",
    name: "/movefree",
    hint: t("MOVE and MOVEL to explicit assignments"),
    evalTask: "ibmi-rpg-move",
    prompt: t(
      "Replace every MOVE and MOVEL here with an explicit free-form assignment.\n" +
        "\n" +
        "1. Say which way each one aligned before you change it: MOVE takes from the right, MOVEL from the left. Getting that backwards is silent and it corrupts data.\n" +
        "2. Use %SUBST for a left-aligned truncation, EVALR for a right-aligned one, and %CHAR or %DEC where a type was being changed as a side effect.\n" +
        "3. A MOVE between different types was doing two things at once. Write both.\n" +
        "4. Change no behaviour, and point out any case where the original was relying on MOVE not clearing the rest of the target.\n"
    ),
    attach: true,
  },
  {
    group: "rpg",
    name: "/cycle",
    hint: t("get out of the RPG cycle"),
    evalTask: "ibmi-rpg-freeform",
    prompt: t(
      "Replace the RPG cycle in this program with an explicit loop.\n" +
        "\n" +
        "1. Say what the cycle was doing for it: the primary file read, the level breaks, the total time output, the automatic LR. Each one has to be written out by hand now.\n" +
        "2. Write the read loop explicitly, with %EOF, and the level-break comparisons as ordinary IF statements on saved key values.\n" +
        "3. Keep the output exactly as it was, totals and all. A level break that fires one record early is the classic way this goes wrong.\n" +
        "4. Set *INLR yourself, and say so: without the cycle nothing does it for you.\n"
    ),
    attach: true,
  },
  {
    group: "rpg",
    name: "/copyproto",
    hint: t("/COPY and prototypes instead of bare CALL"),
    evalTask: "ibmi-rpg-copy-proto",
    prompt: t(
      "Give the called programs here real prototypes.\n" +
        "\n" +
        "1. For each bare CALL, write a prototype with EXTPGM in a copybook member, and bring it in with /COPY. One copybook per called program, named after it.\n" +
        "2. Call it with CALLP through the prototype. The point is the compile error: a change to the called program's parameters now breaks every caller at compile time instead of at run time, in production.\n" +
        "3. Mark as CONST every parameter the callee does not change — that is documentation the compiler enforces, and it lets a caller pass an expression.\n" +
        "4. Say what you could not prototype: a program called by a name held in a variable cannot be, and that is worth reporting rather than working around.\n"
    ),
    attach: true,
  },
  {
    group: "rpg",
    name: "/srvpgm",
    hint: t("monolith to modules and a service program"),
    evalTask: "ibmi-rpg-srvpgm",
    prompt: t(
      "Turn this into an ILE service program.\n" +
        "\n" +
        "1. Decide what belongs in it: the rules more than one program needs. A procedure used once belongs where it is used.\n" +
        "2. Make it NOMAIN — a service program has no entry point, because nothing calls \"the pricing program\", callers call a procedure in it.\n" +
        "3. Export the procedures, and put their prototypes in a copybook included by the service program itself AND by every caller, so the two cannot disagree.\n" +
        "4. Write the binder source with an explicit SIGNATURE and the exports in a fixed order, and say why the order matters: adding at the end stays compatible, reordering breaks every bound caller.\n" +
        "5. Say which activation group it should run in and what that means for open files and for commitment control.\n"
    ),
    attach: true,
  },
  {
    group: "rpg",
    name: "/validate",
    hint: t("input validation that says what is wrong"),
    evalTask: "ibmi-rpg-indicators",
    prompt: t(
      "Review the input validation here.\n" +
        "\n" +
        "1. For each field, say what is actually checked and what is not: a length, a range, a date that exists, a code that is in a table, a mandatory field that is only blank-checked.\n" +
        "2. Validate ALL of it before refusing, not at the first error: a screen that reports one problem at a time is a screen somebody submits six times.\n" +
        "3. Name each failure in a message the user can act on, and keep the field in error identifiable so the display file can light it.\n" +
        "4. Say which checks belong in the database instead — a referential constraint or a check constraint is enforced for every program, including the ones nobody has written yet.\n"
    ),
    attach: true,
  },
  {
    group: "rpg",
    name: "/pointers",
    hint: t("review pointers and based storage"),
    evalTask: "ibmi-rpg-srvpgm",
    prompt: t(
      "Review the pointers and based storage here.\n" +
        "\n" +
        "1. For each pointer, state the invariant that makes it sound: what it points at, who allocated it, who frees it, and what happens on an error path in between.\n" +
        "2. Find the leaks: an ALLOC with no DEALLOC on every path, including the one through a MONITOR handler.\n" +
        "3. Find the arithmetic nobody can check: a based structure whose length is computed from a field, and a %SIZE that stopped matching when somebody changed the structure.\n" +
        "4. Where the same thing can be done with a varying field, a data structure or a procedure parameter, say so. Treat a pointer with no written invariant as a defect.\n"
    ),
    attach: true,
  },
  {
    group: "dds",
    name: "/lf",
    hint: t("design the logical file"),
    evalTask: "ibmi-dds-logical",
    prompt: t(
      "Design or review this logical file.\n" +
        "\n" +
        "1. Say what it is FOR: an access path, a subset, a projection, or a join. A logical that does all four is one nobody can reason about.\n" +
        "2. Key it on the columns the access actually needs, in the order the access needs them — the key order IS the access path.\n" +
        "3. Use S and O specifications for a subset, and say what happens to a record that stops matching: it leaves the view, which is a surprise to any program holding a position in it.\n" +
        "4. Project only the fields the readers use, and say what each one costs: every logical is maintained on every write to the physical.\n"
    ),
    attach: true,
  },
  {
    group: "dds",
    name: "/ddskeys",
    hint: t("keys, select and omit"),
    evalTask: "ibmi-dds-logical",
    prompt: t(
      "Review the keys and the select/omit here.\n" +
        "\n" +
        "1. Say what order the key gives, including the keywords that change it: DESCEND, ABSVAL, ZONE, UNIQUE, and what a duplicate key does to a write.\n" +
        "2. For each S and O line, say whether the order matters — they are evaluated in sequence and the first match wins, so an O before an S changes the answer.\n" +
        "3. Watch for a select on a field that is not in the key: the access path is built anyway and every read pays for the filtering.\n" +
        "4. Say which of these would be clearer as an SQL index and view, and what that would change about how programs open it.\n"
    ),
    attach: true,
  },
  {
    group: "dds",
    name: "/ddsmodern",
    hint: t("DDS to SQL DDL"),
    evalTask: "ibmi-db2-ddl",
    prompt: t(
      "Write the SQL DDL equivalent of this DDS.\n" +
        "\n" +
        "1. Carry over the names, the types and the lengths exactly. A packed field is DECIMAL, a zoned one is NUMERIC, and the two are not interchangeable on disk.\n" +
        "2. Carry over the TEXT and COLHDG as LABEL ON: they are what every query tool shows, and losing them is the most visible part of a conversion nobody reviews.\n" +
        "3. DDS has no nullable field unless ALWNULL says so, so state NOT NULL rather than inheriting SQL's opposite default — and say what default value each column then needs.\n" +
        "4. A unique DDS key becomes a primary key. Say what happens to the programs that relied on duplicate keys being allowed.\n" +
        "5. Say what is LOST: the record format name, the field reference file, and anything the physical file's DDS did that DDL has no word for.\n"
    ),
    attach: true,
  },
  {
    group: "dds",
    name: "/subfile",
    hint: t("review the subfile"),
    evalTask: "ibmi-dds-field",
    prompt: t(
      "Review this subfile.\n" +
        "\n" +
        "1. Say which kind it is and why: load-all, single-page or expanding. A load-all over a file nobody bounded is a program that reads a million records to show twelve.\n" +
        "2. Check the control record's keywords against the behaviour: SFLDSP, SFLDSPCTL, SFLCLR, SFLEND and the order they must be set in. A missing SFLCLR shows yesterday's rows.\n" +
        "3. Check the relative record number arithmetic, which is where this always breaks: the page size, the top record, and what happens on the last partial page.\n" +
        "4. Say how an error on one line is shown, and whether the user can still see the data while reading the message.\n"
    ),
    attach: true,
  },
  {
    group: "db2i",
    name: "/indexes",
    hint: t("which indexes this table needs"),
    evalTask: "ibmi-db2-catalog",
    prompt: t(
      "Work out which indexes this table needs, from evidence.\n" +
        "\n" +
        "1. Call ibmi_index_advice first. Without it this is a guess, and an index is a guess that costs disk and slows every write.\n" +
        "2. Separate the keys asked for thousands of times from the ones asked for twice: the second kind is somebody's ad-hoc query, not a workload.\n" +
        "3. Say what each proposed index would serve — which predicate, which ordering, which join — and in which order its columns must be, because the order IS the index.\n" +
        "4. Look at what already exists before adding: an index whose leading columns match an existing one is usually the existing one with a longer key.\n" +
        "5. Say what you would measure afterwards to know it worked.\n"
    ),
    attach: true,
  },
  {
    group: "db2i",
    name: "/isolation",
    hint: t("the isolation level in force"),
    evalTask: "ibmi-db2-commit",
    prompt: t(
      "What isolation is this running under, and what does that allow?\n" +
        "\n" +
        "1. Say where the level comes from: the COMMIT parameter on the compile, a SET TRANSACTION, the connection, or the default — and that they do not all agree.\n" +
        "2. For the level in force, name what it permits concretely: a dirty read, a value that changes between two reads of the same row, a row that appears in the second half of a report.\n" +
        "3. Say which rows are locked, for how long, and what another job waiting on them will see — a timeout, or a wait that outlasts the user's patience.\n" +
        "4. Where native I/O and SQL touch the same file in one program, say what that does to the locks. It is the most common cause of a hang that nobody can reproduce.\n"
    ),
    attach: true,
  },
  {
    group: "db2i",
    name: "/triggers",
    hint: t("review the triggers on this table"),
    evalTask: "ibmi-db2-ddl",
    prompt: t(
      "Review the triggers on this table.\n" +
        "\n" +
        "1. List them with what fires them and when: before or after, insert, update or delete, row or statement. A before-trigger that writes elsewhere is a transaction nobody declared.\n" +
        "2. Say what happens on a failure inside one: whether the originating write is rolled back, and whether the caller is told anything it can act on.\n" +
        "3. Look for the loop — a trigger whose write fires the trigger — and for the ordering nobody controls when two triggers fire on the same event.\n" +
        "4. Say which of these belongs in a trigger at all: logic in a trigger runs for every program, including the data fix somebody runs by hand at midnight, which is sometimes exactly right and sometimes a disaster.\n"
    ),
    attach: true,
  },
  {
    group: "db2i",
    name: "/sqlperf",
    hint: t("why this query is slow"),
    evalTask: "ibmi-db2-catalog",
    prompt: t(
      "Why is this query slow, and what would make it fast?\n" +
        "\n" +
        "1. Call ibmi_index_advice on the tables involved before saying anything: the optimizer has already recorded what it wished it had.\n" +
        "2. Read the predicates for what an index can actually use: a function on the left of a comparison, a LIKE with a leading wildcard, an implicit cast between a CHAR column and a numeric host variable — each of those costs the index.\n" +
        "3. Look at the joins for the one that fans out, and at the ORDER BY and GROUP BY for a sort that an index could have given for free.\n" +
        "4. Say what you expect to change and by how much, and what you would measure. A rewrite with no number attached is a preference.\n"
    ),
    attach: true,
  },
  {
    group: "cl",
    name: "/clsbmjob",
    hint: t("submit a job that can be found afterwards"),
    evalTask: "ibmi-cl-sbmjob",
    prompt: t(
      "Review this submitted job.\n" +
        "\n" +
        "1. A bare SBMJOB inherits the caller's job description, library list and output queue by accident. Make all three explicit, and qualify the JOBD by its library.\n" +
        "2. Give the job a NAME somebody can find in the output queue two days later. A screen full of QPADEV jobs is an audit nobody can perform.\n" +
        "3. Monitor the submission itself: a missing JOBD, no authority or a held job queue fails at SBMJOB, and the caller currently reports success.\n" +
        "4. Say what the job queue's single-threading means for this, and what happens if it is submitted twice.\n"
    ),
    attach: true,
  },
  {
    group: "cl",
    name: "/cllib",
    hint: t("stop depending on the library list"),
    evalTask: "ibmi-cl-qualify",
    prompt: t(
      "Make this program stop depending on the job's library list.\n" +
        "\n" +
        "1. Qualify every object reference with a library. An unqualified name resolves against a list this program does not control, and in production that list starts with production.\n" +
        "2. Take the library from a parameter with a sensible default rather than hard-coding it in each command: one place to change, and a test run becomes possible.\n" +
        "3. Where the list genuinely has to change, do it explicitly and restore it — and say what happens if the program ends between the two.\n" +
        "4. Say which references you could NOT qualify and why: a command that builds its own target at run time cannot be, and that is a finding rather than a failure.\n"
    ),
    attach: true,
  },
  {
    group: "cl",
    name: "/clmsgf",
    hint: t("send a message somebody can act on"),
    evalTask: "ibmi-cl-monmsg",
    prompt: t(
      "Review the messages this program sends.\n" +
        "\n" +
        "1. Say what each SNDPGMMSG actually does: an informational message in a batch joblog nobody reads, or an escape message that stops the caller. Those are different programs.\n" +
        "2. Put the text in a message file with substitution variables rather than in the source: translatable, findable by id, and changeable without a recompile.\n" +
        "3. Make a failure escape. A program that detects an error, sends *INFO and ends with status 0 is a program whose caller believes it worked.\n" +
        "4. Say what the operator is supposed to DO with each message. A message that names a problem and not an action is a message that gets ignored.\n"
    ),
    attach: true,
  },
  {
    group: "cl",
    name: "/clmonitor",
    hint: t("monitor the message that can happen"),
    evalTask: "ibmi-cl-monmsg",
    prompt: t(
      "Review the error handling in this CL program.\n" +
        "\n" +
        "1. For each command that can fail, name the message it would send and monitor THAT one. A program-level MONMSG MSGID(CPF0000) swallows an authority failure and a damaged object along with the file-not-found you were expecting.\n" +
        "2. Say what the handler should do: tolerate (the file was not there, which is fine the first time), recover, or escape. Tolerating by accident is the bug this skill exists for.\n" +
        "3. Make the program's own failure visible to its caller, with a message the caller can monitor.\n" +
        "4. Say what state is left behind on each error path — a cleared file, a half-copied member, a lock still held.\n"
    ),
    attach: true,
  },
  {
    group: "cl",
    name: "/clvalidate",
    hint: t("check the parameters before acting"),
    evalTask: "ibmi-cl-qualify",
    prompt: t(
      "Make this program check its parameters before it does anything.\n" +
        "\n" +
        "1. For each parameter, say what an invalid value would DO: a blank library that resolves to the list, a name that does not exist, a date nobody validated that ends up in a file name.\n" +
        "2. Check existence where it matters — CHKOBJ before you clear something — and refuse with an escape message naming the parameter rather than failing in the middle.\n" +
        "3. Do all the checking before the first change. A program that validates the second parameter after clearing the file described by the first is a program that destroys data on a typo.\n" +
        "4. Say which checks the command definition (CMD) should carry instead: a VALUES list or a RANGE is enforced before the program ever starts.\n"
    ),
    attach: true,
  },
  {
    group: "db2i",
    name: "/nulls",
    hint: t("null handling, which DDS never had"),
    evalTask: "ibmi-db2-ddl",
    prompt: t(
      "Review how this handles nulls.\n" +
        "\n" +
        "1. Say which columns are actually null-capable. DDS has none unless ALWNULL says so, SQL has them by default, and a table created both ways in its lifetime has both.\n" +
        "2. In RPG, every read of a null-capable column needs its null indicator checked BEFORE the value is used: the value in a null column is not a value, and using it silently gives you zero or blanks.\n" +
        "3. Watch the comparisons: a predicate on a null column is UNKNOWN rather than false, so NOT IN returns nothing and an aggregate skips rows nobody told you about.\n" +
        "4. Say for each column whether null means anything different from zero or blank in this business. If it does not, the column should not be null-capable.\n"
    ),
    attach: true,
  },


  // ── Finance ─────────────────────────────────────────────────────────────────────────────────
  {
    group: "finance",
    name: t("/rounding"),
    hint: t("round money the way an invoice does"),
    evalTask: "js-money-rounding",
    prompt: t(
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
    name: t("/decimal"),
    hint: t("money without a float, anywhere"),
    evalTask: "py-decimal-money",
    prompt: t(
      "Find every place a monetary value touches a binary floating-point type here, and remove it.\n" +
        "1. A float cannot hold 0.10. Everything that follows from that — a total that is 0.30000000000000004, a comparison that fails, a cent that appears from nowhere — is not a bug to be patched, it is the type being wrong.\n" +
        "2. Use the exact type the language has: Decimal in Python, BigDecimal in Java, a packed field in RPG, an integer number of minor units in JavaScript. Say which you chose and what its precision is.\n" +
        "3. Watch the BOUNDARIES, which is where this survives a rewrite: a JSON number is a double, a float column in the database is a double, and a value that was exact until it was serialised is a value that is no longer exact.\n" +
        "4. Say what the precision must be rather than taking a default: two decimals for most currencies, three for a dinar, none for a yen, and more than two for a rate.\n"
    ),
    attach: true,
  },
  {
    group: "finance",
    name: t("/packed"),
    hint: t("packed and zoned decimal, sized on purpose"),
    evalTask: "ibmi-rpg-packed",
    prompt: t(
      "Review the packed and zoned fields here.\n" +
        "1. State the precision of every monetary value and WHY it is that: the ledger's currency to the cent, a rate to six decimals, a quantity with none.\n" +
        "2. Size the intermediates. A product of an 11-digit amount and a 9-digit rate does not fit in 11 digits, and RPG truncates it without saying so — which is a wrong number that balances.\n" +
        "3. Zoned where a file format demands it, packed everywhere else, and say which the field on disk actually is: reading a zoned field as packed gives a number nobody recognises.\n" +
        "4. Never a float for money. And where a conversion can fail — a rate of zero, a value too large — handle it with a MONITOR group rather than letting it end the program in the job log.\n"
    ),
    attach: true,
  },
  {
    group: "finance",
    name: t("/settlement"),
    hint: t("settlement dates, T+1 and T+2"),
    evalTask: "fin-settlement",
    prompt: t(
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
    name: t("/markethours"),
    hint: t("time zones and market sessions"),
    evalTask: "fin-market-hours",
    prompt: t(
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
    name: t("/identifiers"),
    hint: t("validate ISIN, LEI and BIC properly"),
    evalTask: "fin-identifiers",
    prompt: t(
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
    name: t("/fixmsg"),
    hint: t("FIX messages a counterparty accepts"),
    evalTask: "fin-fix-message",
    prompt: t(
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
    name: t("/amortise"),
    hint: t("schedules whose parts total the whole"),
    evalTask: "fin-amortisation",
    prompt: t(
      "Review this schedule.\n" +
        "1. The instalments must total the principal EXACTLY. Rounding each one and multiplying back gives a schedule that differs from the loan by a few cents, and that difference is a reconciliation item somebody chases for an afternoon.\n" +
        "2. Say where the residue goes: spread one minor unit at a time over the first instalments, or all of it on the last. Both are defensible; only one matches the contract.\n" +
        "3. Work in minor units, as integers. Every version of this defect begins with a division in floating point.\n" +
        "4. Say what happens at the boundaries: one instalment, zero instalments, a principal smaller than the number of instalments.\n"
    ),
    attach: true,
  },

  // ── Web ─────────────────────────────────────────────────────────────────────────────────────
  { group: "frontend", name: "/a11y", hint: t("accessibility audit"), prompt: t("Audit this against WCAG 2.2 AA: the accessible name of every control, keyboard reachability and focus order, contrast, ARIA used where a native element would do, and what a screen reader announces. Cite the criterion for each finding and separate what is certain from what needs a browser."), attach: true },
  { group: "frontend", name: "/semantic", hint: t("the right HTML elements"), prompt: t("Rewrite this markup with the elements that carry its meaning: landmarks, headings in order, lists for lists, buttons for actions and links for navigation. Say what each change gives a screen reader that the original did not."), attach: true },
  { group: "frontend", name: "/css", hint: t("simplify the stylesheet"), prompt: t("Review this CSS: specificity that will be hard to override, magic numbers, layout done with hacks where the cascade or grid would do, and anything that breaks on a narrow screen or in the other color scheme. Propose the simpler version."), attach: true },
  { group: "frontend", name: "/responsive", hint: t("make it hold at every width"), prompt: t("Find where this breaks between a phone and a wide monitor: fixed widths, text that cannot wrap, tables and code that overflow, touch targets under 44 px. Fix it with the intrinsic sizing that removes the breakpoint rather than adding one."), attach: true },
  { group: "javascript", name: "/types", hint: t("tighten the TypeScript types"), prompt: t("Tighten the types here: replace `any` and unchecked casts with types the compiler can verify, narrow rather than assert, and make impossible states unrepresentable. Change no behavior, and say which changes would fail the build elsewhere."), attach: true },
  { group: "javascript", name: "/jsdoc", hint: t("document the exported API"), prompt: t("Write JSDoc for what this module exports: the contract, the parameters, what is returned, what throws, and the example that removes the need to read the body. Do not restate the signature."), attach: true },
  { group: "javascript", name: "/perf-web", hint: t("what makes the page slow"), prompt: t("Find what costs the most here: layout thrash, work on every keystroke or scroll without throttling, bundles pulled in for one function, images without dimensions. Give the cheapest fix for each and say what it is worth."), attach: true },

  // ── Python ──────────────────────────────────────────────────────────────────────────────────
  { group: "python", name: "/pytest", hint: t("write pytest tests"), prompt: t("Write pytest tests for this: plain functions, fixtures for the setup, parametrize for the table of cases, and a name per test saying what it asserts. Cover the boundaries and the error paths, and use no mock where a real object is cheap."), attach: true },
  { group: "python", name: "/hints", hint: t("add type hints"), prompt: t("Add type hints complete enough for mypy in strict mode. Prefer the standard collections and `X | None` over Optional, be precise about what is mutated, and change no behavior. Say where a hint was impossible without altering the design."), attach: true },
  { group: "python", name: "/docstring", hint: t("write the docstrings"), prompt: t("Write docstrings in the style already used in the file, or Google style if there is none: what it does, what the arguments mean, what it returns and what it raises. Do not restate the signature in prose."), attach: true },
  { group: "python", name: "/pythonic", hint: t("make it idiomatic Python"), prompt: t("Rewrite this as a Python developer would: comprehensions where they read better than the loop, context managers for anything with a lifetime, the standard library over a hand-rolled version, dataclasses or enums where a dict stands in for a type. Refuse any change that trades clarity for cleverness."), attach: true },
  { group: "python", name: "/asyncio", hint: t("review the async code"), prompt: t("Review this asyncio code: blocking calls on the event loop, tasks created and never awaited, cancellation that leaves state half-written, and gather where a task group would give better failure behavior."), attach: true },

  // ── Java ────────────────────────────────────────────────────────────────────────────────────
  { group: "java", name: "/junit", hint: t("write JUnit 5 tests"), prompt: t("Write JUnit 5 tests: @Test with @DisplayName saying what is asserted, @ParameterizedTest where the cases are data, AssertJ if the project uses it, @Nested to group the cases of one behavior. Cover the exceptions as well as the happy path."), attach: true },
  { group: "java", name: "/javadoc", hint: t("write the Javadoc"), prompt: t("Write Javadoc: what it does and why it exists, @param, @return, @throws, @since where the project uses it. Document the contract — nullability, thread safety, what the caller owns — rather than the implementation."), attach: true },
  { group: "java", name: "/streams", hint: t("loops to streams, where it reads better"), prompt: t("Where the Stream API reads better than the loop, rewrite it — and where it does not, say so and leave the loop. Keep laziness in mind, do not collect a stream only to iterate it, and never hide a side effect inside a map."), attach: true },
  { group: "java", name: "/nullsafe", hint: t("find what can be null"), prompt: t("Find every path where a null can arrive unhandled. Propose the fix that removes the possibility — Optional at the boundary, an invariant enforced at construction, a validated parameter — rather than a null check at each use."), attach: true },
  { group: "java", name: "/concurrent", hint: t("review the concurrency"), prompt: t("Review this for concurrency: shared mutable state without a happens-before edge, locks taken in different orders, collections that are not thread-safe, and executors never shut down. Say what would actually go wrong and under what load."), attach: true },

  // ── .NET ────────────────────────────────────────────────────────────────────────────────────
  { group: "dotnet", name: "/xmldoc", hint: t("write the XML documentation"), prompt: t("Write XML documentation comments: <summary>, <param>, <returns>, <exception>, and <remarks> for the contract the signature cannot state. Document nullability as the compiler sees it."), attach: true },
  { group: "dotnet", name: "/linq", hint: t("loops to LINQ, where it reads better"), prompt: t("Where LINQ reads better than the loop, rewrite it — and where it does not, leave it and say why. Watch for multiple enumeration of the same sequence and for queries that hit the database once per row."), attach: true },
  { group: "dotnet", name: "/asyncnet", hint: t("review the async/await"), prompt: t("Review this async code: async void outside an event handler, .Result or .Wait() that can deadlock, missing ConfigureAwait in library code, and CancellationToken accepted and never passed on."), attach: true },
  { group: "dotnet", name: "/nunit", hint: t("write the tests"), prompt: t("Write tests in the framework this project already uses (xUnit, NUnit or MSTest): one behavior per test, data-driven cases where they are data, and a name that says what is asserted. Cover the exceptions."), attach: true },

  // ── Systems ─────────────────────────────────────────────────────────────────────────────────
  { group: "go", name: "/gotest", hint: t("write Go table tests"), prompt: t("Write Go tests in the table style: a slice of cases with names, t.Run per case, t.Parallel where it is safe, and the standard library rather than an assertion framework. Cover the error returns."), attach: true },
  { group: "go", name: "/goroutines", hint: t("review the goroutines"), prompt: t("Review the concurrency here: goroutines started and never joined, channels that can block for ever, a context accepted and not honoured, and shared state without a mutex or a channel. Say what would deadlock and under what conditions."), attach: true },
  { group: "go", name: "/gomod", hint: t("review the module"), prompt: t("Review this module: dependencies pulled in for one function, versions that are not pinned where they matter, a replace directive left from local work, and packages that would be better internal. Say what each change costs."), attach: true },
  { group: "go", name: "/goerr", hint: t("review the error handling"), prompt: t("Review the error handling: errors swallowed or logged and returned twice, missing context from %w, sentinel errors compared with == where errors.Is is needed, and defers that hide a failure to close."), attach: true },
  { group: "rust", name: "/borrow", hint: t("review the Rust ownership"), prompt: t("Review the ownership here: clones that exist to satisfy the borrow checker rather than the design, lifetimes that could be elided, Rc/RefCell standing in for a structure that does not need shared mutation, and unwrap on a path that can fail."), attach: true },
  { group: "rust", name: "/rusterr", hint: t("review the error handling"), prompt: t("Review the errors here: unwrap and expect on paths that can fail, a single error type doing the work of several, missing From impls that would let ? work, and errors that lose their cause. Propose the enum the caller can actually match on."), attach: true },
  { group: "rust", name: "/rustdoc", hint: t("document the crate"), prompt: t("Write doc comments for what this crate exports: what it is for, the invariants, what panics and when, and an example that compiles. Use //! for the module and /// for items, and link other items with square brackets."), attach: true },
  { group: "rust", name: "/unsafe", hint: t("justify or remove the unsafe"), prompt: t("For each unsafe block or raw pointer here: state the invariant that makes it sound, or show the safe construction that removes it. Treat an unsafe block without a written invariant as a defect."), attach: true },
  { group: "cpp", name: "/raii", hint: t("make the lifetime the type's job"), prompt: t("Rewrite this C++ so ownership is expressed in types: unique_ptr or a value where a raw owning pointer is used, RAII for anything acquired and released, the rule of zero where the compiler can write the special members. Say what each change makes impossible."), attach: true },
  { group: "cpp", name: "/undefined", hint: t("find the undefined behavior"), prompt: t("Find the undefined behavior here: reads past a bound, signed overflow, strict-aliasing violations, uninitialized reads, use after move, and lifetimes ending before the last use. For each, say what a compiler is permitted to do with it."), attach: true },
  { group: "cpp", name: "/memory", hint: t("who owns what"), prompt: t("Trace ownership through this code: what allocates, what frees, what can be used after free or freed twice, and where a bound is checked. Propose the structure that makes the lifetime obvious rather than a comment claiming it."), attach: true },

  // ── Mobile ──────────────────────────────────────────────────────────────────────────────────
  { group: "flutter", name: "/widget", hint: t("review the widget tree"), prompt: t("Review this widget tree: work done in build(), const constructors missing where the subtree never changes, setState rebuilding more than it needs, and layout that overflows on a small screen. Give the restructured tree."), attach: true },
  { group: "flutter", name: "/darttest", hint: t("write the Flutter tests"), prompt: t("Write tests for this in the right kind: a unit test for pure logic, a widget test with pumpWidget and finders for the UI, a golden test where the look is the contract. Name each test for the behavior it pins."), attach: true },
  { group: "flutter", name: "/state", hint: t("review the state management"), prompt: t("Review how state is held here: state above the widget that owns it, rebuilds wider than the change, controllers and streams never disposed, and business logic inside a widget. Propose the arrangement that fits the pattern this project already uses."), attach: true },
  { group: "flutter", name: "/dartdoc", hint: t("document the Dart API"), prompt: t("Write doc comments for what this library exports: the contract, the parameters, what is returned, what throws, and a short example. Use /// and reference other symbols with square brackets."), attach: true },
  { group: "flutter", name: "/adaptive", hint: t("make it hold on every device"), prompt: t("Find where this breaks between a small phone and a tablet: hard-coded sizes, text that ignores the platform scale factor, touch targets under 48 dp, and layout that assumes one orientation. Fix it with layout that adapts rather than with a device check."), attach: true },

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
  { group: "security", name: "/authz", hint: t("check the authorization"), prompt: t("Check authorization here: whether it is enforced at the boundary or trusted from the caller, whether the object being acted on is checked and not only the action, and what a user of another tenant would be able to reach. Show the missing check."), attach: true },
  { group: "security", name: "/crypto", hint: t("review the cryptography"), prompt: t("Review the cryptography here: primitives chosen rather than borrowed from a tutorial, key length and derivation, an IV or nonce that is unique, comparison that is constant-time, and randomness from a CSPRNG. Say what a wrong answer would cost."), attach: true },
  { group: "security", name: "/secrets", hint: t("find the secrets"), prompt: t("Find what should not be in this code: credentials, tokens, connection strings, private keys, and anything logged that carries them. Say where each belongs instead and what has to be rotated if it is already committed."), attach: true },
  { group: "security", name: "/deps", hint: t("review the dependencies"), prompt: t("Review these dependencies: what is unmaintained, what is pulled in for one function, what runs code at install time, and what has a known advisory. Say which could be dropped and what replacing each would cost."), attach: true },

  // ── IBM i ───────────────────────────────────────────────────────────────────────────────────
  //
  // The largest family, and the reason the dialect rules in core exist: a model that guesses at
  // column positions produces a member that looks right, compiles into something else, and fails
  // in a spool file.
  { group: "rpg", name: "/tofree", evalTask: "ibmi-rpg-freeform", hint: t("convert fixed-format RPG to fully free"), prompt: t("Convert this member to fully free-form RPGLE. Start with **FREE, use dcl-f/dcl-s/dcl-ds/dcl-proc, keep every comment, and change no behavior. Point out anything with no free-form equivalent instead of inventing one."), attach: true },
  {
    group: "db2i",
    name: "/sql",
    evalTask: "ibmi-db2-catalog",
    hint: t("write it as Db2 for i SQL"),
    // The addition that matters is step 3. A model asked to make a query faster proposes an index,
    // and the proposal is a guess dressed as expertise — while the database is sitting on a record
    // of the indexes its own optimizer wished for, with counts.
    prompt: t(
      "Write this as Db2 for i SQL, and justify it from what the database knows.\n\n" +
        "1. Qualify the objects, use FETCH FIRST rather than LIMIT, and say which library you assumed.\n" +
        "2. Prefer the SQL the platform has: VALUES, OLAP specifications, CTEs, and the QSYS2 and " +
        "SYSTOOLS services over anything hand-rolled.\n" +
        "3. If this is about speed, call ibmi_index_advice FIRST. Do not propose an index without it: " +
        "the optimizer's own wish list, with how often it asked and the size of the table, is the " +
        "difference between a justified index and a guess. Quote the counts you are relying on.\n" +
        "4. Read what that tool says it does NOT mean before you act on it: a key asked for twice is " +
        "noise, the column order IS the index, and an empty advisor does not mean the indexes are right.\n" +
        "5. Creating the index is a change, bounded by the writable-libraries list. Say what it costs on " +
        "every insert, and say what you would measure to know whether it worked.",
    ),
    attach: true,
  },
  { group: "dds", name: "/dds", evalTask: "ibmi-dds-field", hint: t("explain this DDS"), prompt: t("Explain this DDS member: the record formats, the key fields, the keywords that change behavior, and anything that would surprise someone reading it for the first time."), attach: true },
  { group: "dds", name: "/dspf", evalTask: "ibmi-dds-field", hint: t("review this display file"), prompt: t("Review this DSPF: the record formats and their overlay order, indicators and what each one drives, CFxx/CAxx keys and where they are handled, subfile control and whether the size is right, and the DDS keywords that will surprise the next reader."), attach: true },
  { group: "dds", name: "/prtf", evalTask: "ibmi-dds-printer", hint: t("review this printer file"), prompt: t("Review this PRTF: page size and orientation against the form, the record formats and their line positions, overflow handling, and the editing that will change the printed value. Say what breaks if the form changes."), attach: true },
  { group: "cl", name: "/clparm", evalTask: "ibmi-cl-qualify", hint: t("review the command definition"), prompt: t("Review this command definition: parameter types and lengths against what the program expects, defaults that hide a required choice, prompt text that says what the value is for, and validity checking done in the CMD rather than in the program."), attach: true },
  { group: "cl", name: "/clerr", evalTask: "ibmi-cl-monmsg", hint: t("review the message handling"), prompt: t("Review the message handling here: MONMSG with no message id, escape messages resent so the caller sees them, diagnostic messages left in the job log without an escape, and the message file the program depends on. Say what the caller learns when this fails."), attach: true },
  { group: "cl", name: "/cl", evalTask: "ibmi-cl-qualify", hint: t("review this CL"), prompt: t("Review this CL program: MONMSG placed where it can hide a real failure, unqualified object references and what the library list would resolve them to, overrides never deleted, and the return code the caller sees."), attach: true },
  { group: "rpg", name: "/embedsql", evalTask: "ibmi-db2-commit", hint: t("review the embedded SQL"), prompt: t("Review this embedded SQL in RPG: SQLCODE and SQLSTATE checked after every statement, host variables sized to their columns, cursors closed on every path, literals that should be parameter markers, and the isolation level in force."), attach: true },
  { group: "rpg", name: "/ile", evalTask: "ibmi-rpg-procedure", hint: t("review the ILE structure"), prompt: t("Review this as ILE: what belongs in a service program rather than in the program, the procedures that should be exported and their prototypes, the activation group and what it means for open files and commitment, and the binding directory this needs."), attach: true },
  {
    group: "rpg",
    name: "/compile",
    evalTask: "ibmi-rpg-fixed-lr",
    hint: t("compile it and fix what the compiler says"),
    // The plumbing for this already existed — `ibmi_command` runs CL, and its description names
    // CRTBNDRPG — and it was still not usable, because a model asked to "compile this" invents a
    // command, a target library and a set of options, and gets one of the three wrong. What was
    // missing is not a tool, it is knowing how a shop actually compiles: from the member you are
    // looking at, into the library the source came from, with the options the previous object was
    // built with. All of that is READABLE, and reading it is cheaper than guessing.
    prompt: t(
      "Compile this member and fix what the compiler reports.\n\n" +
        "1. Use ibmi_compile. It picks the command from the member's type and reads the errors out of the " +
        "compile listing and the joblog for you — identifier, severity, line, text. Do not build a CRT… " +
        "command by hand with ibmi_command: that is how a target library or a set of options gets invented.\n" +
        "2. Target the library the source came from unless you were told otherwise, and say which library " +
        "you are creating the object in before you do it.\n" +
        "3. A failed compile means NO OBJECT EXISTS. It is not a partial result and there is nothing to " +
        "inspect: the message ids are the whole of what you have.\n" +
        "4. For every message, quote the id (RNF…, SQL…, CPD…), say which line it is about and why, and give " +
        "the corrected source. Do not change anything the compiler did not complain about.\n" +
        "5. Recompile until it is clean, and say what was changed and what was left alone. If the tool " +
        "reports that it could not read the listing, say so rather than concluding there were no errors.",
    ),
    attach: true,
  },
  {
    group: "rpg",
    name: "/rpgtest",
    evalTask: "ibmi-rpg-unittest",
    hint: t("write RPGUnit tests, compile them and run them"),
    // The instruction that matters is the last one. A model asked to "write tests" writes tests and
    // declares victory, and on this platform a test source that was never compiled is not a test —
    // it is a text file in QRPGLESRC. So the skill ends on the run, and the run has a verdict.
    prompt: t(
      "Write RPGUnit tests for this, then compile and run them.\n\n" +
        "1. Read the member first and work out what it actually promises: the boundaries, the error paths, " +
        "and the behaviour somebody would notice if it changed. Test those, not the happy path three times.\n" +
        "2. Write a test program as a member in QRPGLESRC, `**FREE`, one exported procedure per case named " +
        "`test…`, using the RPGUnit service program: assert with assert()/aEqual()/iEqual(), and set up and " +
        "tear down in setUpSuite/tearDownSuite rather than in each case.\n" +
        "3. Compile the test program with ibmi_compile, into a test library — never into production.\n" +
        "4. Run it with ibmi_test. If RPGUnit is not on the partition the tool says so; report that and stop, " +
        "do not claim the tests pass.\n" +
        "5. A failing test is the point of this exercise. Say which case failed and what it expected, then fix " +
        "the CODE if the test is right, or the test if it was wrong — and say which of the two you decided.",
    ),
    attach: true,
  },
  {
    group: "db2i",
    name: "/impact",
    evalGap: "needs a live partition: the answer comes from DSPPGMREF over a real library, and a fixture standing in for it would be the thing under test",
    hint: t("who uses this file, program or field"),
    // Before, and the word is load-bearing. Changing a field length on this platform is a
    // five-minute edit and a four-hour search, and the search is the part that gets skipped — so
    // the skill exists to make it the first step rather than the post-mortem.
    prompt: t(
      "Who uses this, and what breaks if I change it? Answer BEFORE proposing any change.\n\n" +
        "1. Call ibmi_impact on the object. At object level that reads the programs' own reference lists, " +
        "which is a fact; say which libraries were looked in, because the answer is only as wide as its search.\n" +
        "2. If the change touches a field — a length, a type, a name — call ibmi_impact again with the field. " +
        "That one is a SEARCH of the source members, not an inventory: report it as evidence and repeat what " +
        "the tool says it cannot see.\n" +
        "3. Look for the logical files over the physical one, and for the display and printer files that show " +
        "the field: a DDS change propagates through objects nobody edits.\n" +
        "4. Then, and only then, say what you would change, what has to be recompiled, and in what order.\n" +
        "5. If the tool reports that it was cut short, or that a library could not be read, say so. " +
        "Do not conclude that nothing else uses it.",
    ),
    attach: true,
  },
  { group: "rpg", name: "/rpgdoc", evalTask: "ibmi-rpg-doc", hint: t("document this member"), prompt: t("Document this member the way an RPG shop reads: a header saying what it is for and what calls it, a note per procedure, and the files it uses with what it does to each. Keep the column layout untouched if the member is fixed-format."), attach: true },
  { group: "db2i", name: "/journal", evalTask: "ibmi-db2-commit", hint: t("review the journalling"), prompt: t("Review journalling here: which files are journalled and which are not, what the journal receivers cost and when they are detached, and what a recovery would actually be able to replay. Say what is lost if the system ends abnormally now."), },
  {
    group: "db2i",
    name: "/whouses",
    evalGap: "needs a live partition: the answer comes from DSPPGMREF over a real library, and a fixture standing in for it would be the thing under test",
    hint: t("find what uses an object"),
    prompt: t(
      "Find everything on this system that uses the object I name — programs that call it, files it " +
        "reads or writes, logical files built over it, service programs that bind it.\n\n" +
        "Work it out rather than assuming a catalogue view exists. Try these in order and use what " +
        "answers:\n" +
        "1. `ibmi_where_is` to establish where the object and its source actually are.\n" +
        "2. DSPPGMREF into a temporary file, then read it: run `DSPPGMREF PGM(LIB/*ALL) OBJTYPE(*PGM) " +
        "OUTPUT(*OUTFILE) OUTFILE(QTEMP/HCREF)` with ibmi_command, then `SELECT * FROM QTEMP.HCREF " +
        "FETCH FIRST 5 ROWS ONLY` with ibmi_sql to see what the columns are called on THIS release, " +
        "and only then write the query that filters on the object I asked about. Do not guess the " +
        "column names; look at them.\n" +
        "3. For SQL objects, the catalogue views: SYSTABLEDEP, SYSVIEWDEP, SYSROUTINEDEP, " +
        "SYSPARTITIONINDEXES. If one does not exist on this release, say so and move on.\n" +
        "4. For DDS logical files over a physical, the reference is in the source: search the DDS " +
        "members for PFILE or JFILE naming it.\n\n" +
        "Report what each step found and what it could not, and say which of them is the evidence " +
        "for each answer. A caller you inferred from a naming convention is not a caller.",
    ),
  },
  { group: "db2i", name: "/qsys2", evalTask: "ibmi-sql-db2", hint: t("use the catalogue instead"), prompt: t("Replace this with a QSYS2 or SYSTOOLS service where one exists — object lists, job information, journal entries, IFS objects — rather than a command whose output has to be parsed. Give the query and say what it returns that the command did not."), attach: true },
  { group: "db2i", name: "/commitctl", evalTask: "ibmi-db2-commit", hint: t("review the commitment control"), prompt: t("Review the commitment control here: what is under commit and what is not, where COMMIT and ROLLBACK are issued, what happens on an unhandled error, and whether the activation group scope matches the unit of work.") },
  { group: "rpg", name: "/dbmodern", evalTask: "ibmi-rpg-sql-cursor", hint: t("modernise the data access"), prompt: t("Propose the SQL replacement for these native I/O operations (CHAIN, SETLL, READE): the query, whether a cursor or a single fetch is right, and what changes about record locking and about the record format the program expects. Say where native I/O should stay."), attach: true },
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

/** The families in play by default: the ones that apply whatever you have open, and nothing else. */
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
  if (has("rpgle", "rpg", "sqlrpgle")) found.push("rpg");
  if (has("dds", "dds.pf", "dds.lf", "dds.dspf", "dds.prtf")) found.push("dds");
  if (has("db2", "sqlrpgle")) found.push("db2i");
  if (has("cl", "clle", "cmd")) found.push("cl");
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

/**
 * The built-in skills, in the shape the model is offered.
 *
 * ⚠️ They were invisible to the model. All of them — forty for IBM i, eight for finance, each one
 * backed by an evaluation task that fails before it is applied — were reachable **only by a user
 * typing the right slash command**. Somebody who does not know that `/packed` exists never benefits
 * from it, which makes a whole axis of this product's expertise conditional on knowing a magic word.
 *
 * They reach the model through the mechanism the repository's own skills already use (see
 * `skillsPrompt` and `use_skill`): the NAME and one line in the prompt, the instructions only when
 * the model asks for them. Nothing new is invented — one more source feeds an existing path, which
 * is also why the token cost is bounded by what the user has switched on rather than by the whole
 * catalogue of eighty-five.
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
