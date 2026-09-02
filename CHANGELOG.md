# Changelog

Notable changes, newest first. Dates are the day the work landed on `main`.

## 0.19.0 — 2026-09-02

### Changed

- **The controls under a message take no room until you point at one.** Every entry reserved the
  height its hover buttons would need — deliberately, so the transcript would not reflow — which
  meant every message in the conversation carried a band of empty air the width of six invisible
  buttons, and on a question that band stood between the question and its own answer. The row now
  opens under the message the pointer is on and closes when it leaves: nothing above the cursor
  moves, and a transcript nobody is pointing at reserves nothing at all.
- **A question and its answer are closer still**, which is the same change seen from the other end.
- **The buttons themselves are smaller** — a 20 px square around a 13 px glyph instead of 22 around
  14 — so the row reads as one control rather than as six separate ones.
- **Code blocks are a veil rather than a panel.** `textCodeBlock-background` is opaque in most
  themes: it puts a slab on top of the answer, and on a light theme it is very nearly the panel's
  own white, so the block read as a rectangle of border with nothing in it. A grey mixed from the
  foreground and left partly transparent lifts the code by the same small amount in every theme and
  keeps the tint of what is behind it. The copy and insert buttons take the same material.
- **The way back to the end of the conversation sits in the middle of the gap it lives in.** It was
  centred in the 26 px strip the transcript reserves, but the composer adds 4 px of its own below
  that — so the space the eye reads is 30, and the button sat on the last line of the answer with
  seven pixels of nothing under it.

### Fixed

- **Skills and sub-agents can be written from the panel's `…` menu.** That entry only ever LISTED
  them, which is the one thing the interface already does everywhere else — they are in the
  composer, in the `/` menu, in the tools picker. Writing one was reachable only from the command
  palette. It now offers **New skill…** and **New sub-agent…** first, with the repository's own
  below: opening one is how you edit it.
- **A CSS rule that had never run.** `.entry-head .entry-actions` described moving a question's
  buttons up into its header, at length, in a comment — and nothing in the panel has ever built
  that element, so the rule matched nothing and the band of empty air it was meant to remove stayed
  where it was. A selector that matches nothing is reported by nothing.

## 0.18.1 — 2026-09-02

### Fixed

- **Four paragraphs of the French interface were in English** — the permissions screen's rule about
  the shape of an action, the note that a refusal beats an authorisation, and both explanations in
  the egress and cost reports. Each was translated; each translation was unreachable. A sentence
  written across several source lines joined by `+` reaches `t()` as ONE string, while the coverage
  test read only the first fragment — so it checked a key that never exists at runtime and passed
  while the interface showed English. The test now joins the fragments, which is what found these
  four. Seen first on a screenshot: nothing else was ever going to notice.

## 0.18.0 — 2026-09-02

### Added

- **A rule between one exchange and the next, carrying the way back.** A transcript is a stack of
  question-and-answer pairs and nothing said so: every message was separated from the next by the
  same amount of space, so a question sat as far from its own answer as from a different turn. The
  line is now drawn at the boundary that matters — above a question, never between a question and
  its reply — and the restore rides on it, the way the editor's own chat marks a restore point.
  There used to be two lines at every boundary, one under the answer and one above the next
  question, both restoring to different points; there is one.
- **A turn that changed no file can be rewound too.** Restoring refused unless something had been
  written to disk, which made the restore point an agent-mode feature — while the thing most people
  want to undo is a question that sent the answer off in the wrong direction, which costs nothing on
  disk and everything in context. Every boundary now carries the restore, and the confirmation says
  which of the two it is about to do.
- **Making a skill or a sub-agent is back in the menu that lists them.** It had become reachable
  only from the command palette, which means reachable only by someone who already knew it was
  there. **New skill…**, **New sub-agent…** and **Share with the team** sit under a rule in
  *Skills and sub-agents*, and "no sub-agent is defined" now offers the button that defines one
  instead of being a dead end.
- **`Hivey Code: Pin or unpin the last answer`**, so pinning can go on a keybinding — and so the
  path can be driven by a test. The button lives in a hover row, which nothing but a person can
  press, which is why it was reported twice as doing nothing.

### Changed

- **A question and its answer are pulled together.** The gap inside a pair is halved; the space
  goes to the boundary between pairs, where the rule is.
- **A pinned answer is unmistakable.** An edge, a tint across the whole block and a badge in the
  header — three signals, because the two before them went unnoticed: what pinning showed for
  itself was a word in the muted colour inside the row that fades when the pointer leaves. The pin
  button also keeps the accent while the state is on, so the answer to "did that work?" is under
  the pointer that just clicked.

## 0.17.1 — 2026-09-01

### Added

- **The permission lists can be edited from the panel.** Allowed and denied paths and commands were
  settings, shown here as two numbers — "3 allowed, 1 refused" — and changing one meant knowing they
  were settings, finding them among thirty-nine, and editing JSON. A list whose length you can see
  and whose contents you cannot is a list nobody trusts. Refusals come first, because that is the
  rule: a denied path beats an allowed one whatever was written first.
- **"Attach all open editors" is a command** (`Hivey Code: Attach all open editors`), so it can go
  on a keybinding — and so the path could be tested end to end. The menu row was a closure inside a
  quick pick, which no test can drive, which is why three separate failures in this one feature were
  each found by a person rather than by the suite.

### Fixed

- **Pinning looked as though it did nothing.** It worked: the state round-tripped and survived
  trimming. What it showed for it was the word "pinned" in the muted colour, inside the header row
  that fades to nothing when the pointer leaves — so the only visible consequence of the button
  disappeared a second after it was pressed. A pinned exchange now carries a mark that does not
  fade and an accented edge you can find down a transcript without reading anything.
- **The open file appeared twice** when it had also been attached by hand — once as the suggestion,
  once as the attachment. Found on a screenshot taken to prove attaching works, which it did.

### Changed

- **Narrower margins again**: the content runs almost to the panel's edge. What is left is the inset
  the composer's border needs so as not to sit on the frame.

### Verified

- Three separate reports that "all open editors" attaches nothing. It is now covered by an
  integration test that opens three real tabs in a real editor with no workspace folder, asserts
  every one is found, runs the whole attach path through the new command, and asserts three
  attachments arrive and a second pass adds none — and by a screenshot of the composer holding them.

## 0.17.0 — 2026-09-01

### Fixed

- **"All open editors" attached nothing**, for a second and different reason. The tabs were found
  correctly; each was then turned back into a path and re-joined onto the first workspace folder —
  which produces a URI pointing nowhere for any file outside it, and which was skipped entirely when
  no folder was open (`if (!folder) break`). It uses the tabs' own URIs now. And when nothing comes
  of it, it says so: silence is what made an empty result look like a broken feature, and "empty"
  has causes you can act on — no tabs, or a privacy rule.
- **Attaching a file outside the workspace** failed the same way, silently. An absolute path is used
  as it stands.
- **The sort control sat on a line of its own** in the history, because the rule that was meant to
  place it named `.search-input-wrap` — a class invented while writing the rule rather than read
  from the function that builds the box. It matched nothing.

### Changed

- **The settings are in seven sections** — General, Model & endpoints, Skills sub-agents & MCP,
  Privacy & budget, Permissions, Context, Inline completion — instead of thirty-nine entries under
  one heading. They were all present, documented and translated, and could not be found.
- **Attachments look like the editor's own**: an icon, the file name, then its folder in the muted
  colour, and the × on hover. A full path truncated from the left is unreadable and truncated from
  the right is every file in the folder.
- **The skills menu returns to its first screen** after each choice instead of closing. Configuring
  these is rarely one decision — you pick the areas, and the skills you then want are the ones that
  just appeared.
- **The guided start says "Next"**, in white on the accent, and closes with a cross rather than the
  word "Skip" — which read as "skip this step" beside a Next button, and meant nothing at all on the
  last screen.
- **The history loses "Paid only"** and gains its sort beside the search. The "most expensive" order
  answers the same question without a switch that has to be remembered.
- **The empty conversation is centred** on the transcript rather than a third of the way down it.

## 0.16.2 — 2026-09-01

### Fixed

- **"All open editors" attached one file.** It read `visibleTextEditors` — what is laid out on
  screen right now, which is one document or two in a split — so the count beside it was right while
  the result was wrong. It reads the tabs, like the row above it.
- **Bold containing code showed its own punctuation.** `**a `x` b**` came out as the literal
  characters, because the bold branch set its contents as text rather than parsing them. Emphasis
  containing an identifier is not an edge case in an answer about code — it is most of the bold in
  one. Every emphasis span now nests, bounded by construction: the delimiters are removed before
  recursing, so the string is strictly shorter every time.
- **The "latest" button** sits a few pixels lower, centred in the strip rather than on its top edge.

### Changed

- **The skills picker is two levels.** One list held eighteen family rows, then every skill under
  its own separator, then the sub-agents — forty rows answering three different questions at once,
  with a thin grey line to tell them apart. It is now *areas*, *skills*, *sub-agents*, one screen
  each, and the first says how many are on in each.
- **The guided start asks properly.** The families are rows carrying their subject, their examples
  and how many skills sit behind them, rather than eighteen chips; and the skills that follow are
  grouped under the family they came from, with an "all" beside each heading.
- **Comments in code are green**, not grey. No colour is registered for a comment — syntax colours
  come from a TextMate theme a webview cannot read — so it takes the ANSI palette, which every theme
  defines and which is designed for text.
- **"Use in another conversation" is on every history row**, including the one you are in, where it
  means "start a fresh conversation with this one attached". Hiding it there made the whole feature
  look absent, since that is the row anyone reaches for first.
- **Narrower margins again**, and the placeholders ask rather than instruct: "What can I do for
  you?" and "What can we plan together?" instead of "Describe the change".
- "The file I am looking at" is **"This file"**.

## 0.16.1 — 2026-09-01

### Fixed

- **The context picker had lost most of itself.** Every group was built in one `try`, so a failure
  in any of them — the file system, a language server, the tab list — took the whole picker with it
  and left a handful of rows. Each group is now built independently: one that cannot be built is
  missing, the rest still opens. The open editors are listed **inline** again, so attaching the file
  you are switching between is one click rather than two, and "All open editors" is always shown —
  saying "no editor is open" rather than vanishing, because a row that disappears when there is
  nothing to attach is indistinguishable from a feature that has been removed.
- **The "latest" button, for the third time.** The first fix moved it off a hand-measured offset,
  the second gave the transcript a box to hold it — and it was still being appended to the SCREEN,
  whose bottom edge is below the composer. Same symptom, a different cause each time, which is why
  it kept looking unfixed.
- **A specialised conversation survived being left.** Opening another conversation from the history
  left the guided start running over it, still asking questions about a conversation that already
  existed. It ends when you leave.
- **Inline code looked like raw markdown.** Its background was removed in 0.14.0 to stop a paragraph
  reading as a row of chips — but the real offender was the block below it, where VS Code's injected
  `code { background }` painted a band per line. With that fixed, a tint on an identifier is what
  makes `;` read as a character from the code rather than as stray punctuation. Code blocks get
  their surface back for the same reason.

### Changed

- **The `+` is a dropdown, not a dialog.** Two ways to start, under the button that was pressed —
  it was briefly a quick pick, which answers a click in the corner of a side bar with a modal list
  in the middle of the screen.
- **An empty conversation is empty**: the mark, the name, and the one line that changes — whether
  anything leaves the machine. It held three mode cards, a family chooser and a list of tips, in
  answer to someone who had just pressed "new conversation" and wanted to type. All of it is still
  one click away, in the composer or behind the `+`.
- **More air and more colour in answers**: wider gaps between blocks, a longer line height, coloured
  list markers, an accented quotation, a hairline under a top-level heading.
- **The model and the cost moved to the button row**, at its far end and on hover. In the header
  they competed with the name and the tags for a row that is tight at a docked width, and were read
  on every turn by nobody.
- **"Use in another conversation"** takes a forward arrow. The tray-with-a-down-arrow said
  "download", which is what people read it as.

## 0.16.0 — 2026-09-01

### Added

- **A specialised conversation**, from the `+` at the top. Three questions, answered locally and in
  order because each narrows the next: what may it do, what is this about, and which of those skills
  do you want — then "What would you like to do?" and the floor is yours. Nothing it produces is a
  message: the steps are drawn from state and are gone the moment you ask something, so a
  specialised conversation looks like any other afterwards.
- **Eighteen families instead of nine.** HTML & CSS and JavaScript & TypeScript are separate, as are
  C & C++, Go and Rust, and IBM i is now RPG & ILE, DDS, Db2 for i and CL. A Go developer and a Rust
  developer want different skills; "Systems" was a filing decision, not a user's. Every family holds
  at least three skills, asserted by a test.
- **Pick a whole family in one click** in the skills picker: family rows govern membership, the rows
  under them govern what is off inside a family in play. Sub-agents sit under their own heading with
  their own icon, because a nested turn with its own tools is not a slash-command.
- **The open editors, properly.** "All N open editors", and a picker to tick the four you mean.

### Changed

- **Families are opt-in and only the general one starts on.** Everything was ticked in a picker
  whose purpose is choosing, which is worse than no question at all. Skills INSIDE a family in play
  stay opt-out, so one committed by a colleague into a family you use arrives working.
- **Narrower side margins** through the transcript, the composer and the guided start. At 280 px the
  old padding was six per cent of the line, spent on habit.
- **The attachments row** gains a heading with the count and total once there is more than one, a
  way to clear it, an icon per kind, and a scroll rather than half the panel.
- "Whole file" is now **"The file I am looking at"**, and "Selection" **"The lines I have
  selected"** — the reader's question is *which* file, not how much of it.
- **No badge on the skills icon.** It counted what was off, which was a signal while everything was
  on by default and became permanently lit the moment families became opt-in.

### Fixed

- **"Open editors" was empty for anyone with tabs they had not clicked.** It read
  `workspace.textDocuments`, which holds the documents the editor has *loaded* — a tab restored from
  the last session and never focused is not among them. It reads `window.tabGroups` now, which is
  what the Open Editors view itself reads.
- **`hiveyCode.newSession` asked a question**, which broke anything invoking it non-interactively. A
  command on a keybinding or in the palette must act; the choice belongs to the `+`, and now lives
  in a command of its own.

## 0.15.1 — 2026-09-01

### Added

- **The file you have open is offered as context, and sent by default** — the editor's own chat
  behaviour. It appears as an outlined chip above the box, showing the selection's line range when
  there is one and the whole file otherwise, and it follows the active tab. One click puts it aside;
  opening a different file brings the offer back, because the dismissal means "not this file" rather
  than "never again".
  - It is deliberately **not** an attachment: an attachment is something you chose and that stays,
    while this changes under you as you switch tabs. Merging the two would mean every tab switch
    quietly adding a file to a list you thought you were curating — so it is drawn differently,
    outlined where an attachment is filled.
  - **The privacy block list applies to it.** Attaching `.env` on request earns a warning and a
    refusal, which is a conversation; a `.env` attaching itself because it is the open tab is the
    exact failure that list exists to prevent, and it would be silent. Output channels, diff views
    and settings editors are excluded too; an unsaved buffer is not, because asking about code you
    have just typed is an ordinary case.

### Changed

- The skills button takes the workbench's **sliders** glyph. A wrench read as "settings" and sent
  people looking for a preferences page; a wand read as decoration. Sliders say "adjust what is on".

### Fixed

- **The toolbar overflowed onto the send button.** The model name had a floor of 12 characters, the
  row deliberately does not wrap, and four controls plus send no longer fitted a docked side bar — so
  it neither wrapped nor shrank, and simply overlapped. The floor is low enough to always be met, and
  the group can no longer paint outside itself.

## 0.15.0 — 2026-09-01

### Added

- **Around 70 skills, grouped by family**: Web, Python, Java, .NET, Systems (C, C++, Go, Rust),
  Mobile (Flutter and Dart), SQL & data, Build & deploy, **Design & UX**, **Security**, and a much
  larger IBM i set — display files, printer files, CL, embedded SQL, ILE structure, commitment
  control, moving native I/O to SQL. Each names the tools of its subject: a test refuses any whose
  prompt is the generic one with a word changed.
- **"What are you working on?"** on every new conversation, answered **locally — nothing is sent to
  ask it and nothing is sent to record it**. Choosing "Web" narrows seventy skills to the dozen that
  apply, so the `/` list is the one for today's work. What the editor has open is pre-ticked, as a
  visible guess rather than a silent one.
- **Sub-agents that ship with the extension** — `explorer`, `reviewer`, `tester`, `dba` — where
  before there was machinery and nothing using it. A repository that defines one of the same name
  wins. All of them, and the skills, are switched on and off in the same picker.
- **Sub-agents run in parallel** when they can only read. Neighbouring tool calls the tool declares
  safe now go at once, while approvals stay strictly one at a time — two dialogs is not an
  interface. Only *consecutive* safe calls are fused, so read → write → read keeps its order.
- **A pre-send card** showing what the question will send and cost, with **Send / Always / Cancel**.
  In the conversation, never as a dialog; **Always** switches it off for good.
- **Share a message into another conversation** from the hover row: it arrives as an attachment
  carrying where it came from, rather than as pasted text indistinguishable from your own words.
- **The context picker is complete**: the editor, open editors, files, symbols, recent, the
  repository, **instructions**, conversations.
- **The panel's language** is one command away rather than a settings search.

### Changed

- **Headings are size, not decoration.** They had an accent bar instead of a larger type size, so
  every heading read as a quoted block and a document made of them read as a form.
- **No frames** on the provider and approval controls under the composer.
- The skills button moved to the right of the reasoning selector and became a wand: the spanner said
  "settings" and sent people looking for a preferences page.
- **On the multi-agent mode:** not built, deliberately. The modes answer "what is this allowed to
  do" and are enforced in code; "multi-agent" is a strategy, not a permission, so it would be a
  fourth mode with agent's powers and unpredictable behaviour. The capability it was for now exists
  without it.

### Removed

- **The command that opened the terminal client from the editor.** It never worked reliably enough
  to keep. The likely cause, found while removing it: in PowerShell — the default shell on Windows —
  `"C:\…\Code.exe" "…cli.js"` prints the path instead of running it, because PowerShell needs a
  leading `&` for a quoted command. The `hivey-code` CLI itself is unchanged and still launched from
  a shell.

### Fixed

- **Uninstalling left the panel on screen until a restart.** Stopping an MCP server is a child
  process being signalled and waited for, and it was registered as a `dispose()` — which the editor
  calls synchronously and does not await. It moved to `deactivate`, which the editor *does* await.
- **The screenshot harness pointed one directory too high** (`../../` from `dist-integration` is the
  repository's *parent*). VS Code does not fail on that: it scans for nested extensions, finds the
  repository, and caches the description it resolves. Everything appeared to work — and a change
  could be built, be present in the bundle, and not be on the picture, with nothing saying why.

## 0.14.0 — 2026-09-01

### Fixed

- **The band behind every line of code.** Blocks looked as though their contents were selected, and
  two attempts at "remove the fill from the code block" did not touch it — because the fill was
  never ours. VS Code injects its own stylesheet into every webview, containing
  `code { background-color: var(--vscode-textPreformat-background) }` and a `pre code` rule that
  resets the *padding* and not the background. Being an inline element, that fill paints one box per
  line, each ending exactly where its line of text ends: the shape of a selection. Found by reading
  the CSS the host injects, which is on disk next to the editor.
- **Adding context is the editor's own picker now.** The webview menu it replaces could not offer
  what the workbench offers, and was one more surface behaving almost-but-not-quite like everything
  around it. The categories follow the question people are answering: the editor, files & folders,
  the repository, earlier conversations.
- **The README screenshots use VS Code's default theme.** They were captured under a deep-navy theme
  nobody chose: the profile said `"Dark Modern"`, which VS Code does not resolve — and an
  unresolvable theme name does not fall back to the default, it leaves whatever was there. The full
  identifier is now passed, and the result is checked by sampling a pixel rather than by reading the
  setting back.

### Added

- **Skills for other languages**, grouped by family so a whole one is switched on or off in a
  gesture: **Web** (accessibility audit against WCAG, semantic markup, stylesheet review, TypeScript
  types), **Python** (pytest, type hints, docstrings, idiom), **Java** (JUnit 5, Javadoc, streams,
  null-safety), alongside the general set and IBM i. Each carries the conventions of its language —
  a prompt that says "write tests, in Java" is the generic one with a word changed, and is worth
  nothing.
- **Configuring skills** opens the editor's own multi-select picker, the way its "Configure Tools"
  does. Accepting replaces the whole selection, so ticking one family and nothing else is exactly
  "use these for this work".
- **The provider switch** under the composer: this machine, OpenRouter, Anthropic, your own gateway.
  Its colour says whether anything leaves the machine, which should never take reading to establish.

### Changed

- **Approvals and the readings moved out of the box**, onto a row under it: they are settings for the
  conversation, not parts of the message being written, and inside the border they read as controls
  of the text. Their labels are one word each — "Ask every time" truncated to "Ask ever…", which is
  worse than a word that fits.
- **Restore checkpoint is a rule across the transcript**, above the question it returns to, the way
  the editor's chat marks one. Visible without hovering, unlike every other per-message control: it
  is the only one that writes to the working tree, and something that overwrites files should not be
  discovered by accident.
- **The "latest" button** floats at the bottom of the transcript rather than at a hand-measured
  offset from the screen, so it stays put when the composer grows a row.

## 0.13.0 — 2026-09-01

The panel moves towards the editor's own chat, in behaviour as much as in looks.

### Added

- **Restore checkpoint.** Every question the agent answered by editing files carries the state of
  those files as they were before it. Restoring puts them back and rewinds the conversation to that
  point, with the question returned to the composer — the unit people undo is "that whole idea",
  not one keystroke across four files. It writes through a `WorkspaceEdit`, so the rollback is
  itself undoable with Ctrl+Z; it says what it will overwrite before it does; and when a turn
  changed something too large to record, it says the restore is partial rather than pretending.
- **The agent's plan, as a collapsible to-do.** A new `update_plan` tool the model keeps up to
  date; the panel shows the step happening now and a count of what is left, opening while the turn
  runs and closing when it is done. Exactly one step may be in progress — enforced in the parser,
  because the display has no honest way to show two.
- **A skills control in the composer.** Switch built-in and repository skills on and off, create
  one, or share them. Sharing does the two things that are actually useful — show the folder, or
  copy the files as Markdown — because a skill is a file that travels with the repository, which
  was the whole point of using files.
- **Approvals in one click**, from the same menu: ask every time, inside this folder, never ask.
  The icon carries the state, so a session left on "never ask" yesterday is visible today.
- **"At the cursor"** on every code block, alongside "Replace". They are different intentions, and
  conflating them silently deleted whatever was selected.
- **An earlier conversation, and all open tabs**, promoted into the `+` menu. Attaching every open
  tab already existed, buried under twelve file names — invisible and absent are the same thing.
- **The session's cost** beside the token count, hidden entirely on a local model where it is
  structurally zero.

### Changed

- **Attaching now searches.** The file picker was a fixed list of the first hundred files, which
  cannot find anything in a repository of any size. It is a live search over the whole workspace,
  files **and symbols** — and a symbol attaches the lines it occupies rather than its whole file.
- **The transcript stops dragging you to the bottom.** Streaming follows the answer only while you
  are already at the end; once you scroll up nothing moves you again, and a "Latest" button appears.
- **Scrollbars are thin overlays** that fade when the pointer leaves, like the workbench's own. The
  rail they replaced is where the "answers should be wider" complaint came from: the answers were
  not narrow by design, they were narrow by a reserved gutter nobody had accounted for.
- **Answers have room.** More space between blocks, and the user's question sits on a tinted card
  derived from the theme's own accent — so a long transcript is scannable without reading a word.
- **Code blocks lost a surface.** The block had a fill and its header had a different one, so code
  sat on a band inside a box; inline code had a background AND a border AND padding, three
  treatments for one idea. Colour alone now says "this is a name from the code".
- **Actions and cost live under the message, on hover** — the editor's own behaviour, and what stops
  a transcript reading as a table of controls.
- **One ring on the composer.** Focus drew an outline outside the border while the working animation
  drew a different weight inside it, so the box changed size depending on what it was doing. Both
  now draw the same thickness in the same place. The box is shorter, full-width again, and its
  placeholder is three words instead of a sentence.

### Fixed

- Skills and approvals were briefly two separate buttons, and the model name collapsed to `qwe…`
  within the hour: every icon in that row is width the one label carrying real information does not
  have. They are one menu, which is what the editor's chat does and for the same reason.

## 0.12.0 — 2026-09-01

### Added

- **Compacting a conversation.** `/compact`, or the offer that appears once the conversation fills
  two thirds of its budget: the model writes a summary that replaces the exchanges **in the
  prompt**, and nothing is deleted. Every exchange stays on screen, muted, one click from coming
  back — the mechanism [ADR-0003](docs/adr/0003-le-transcript-n-est-pas-le-prompt.md) already
  provided, so it needed no new state and no migration. The summary is pinned (it becomes the
  oldest message the moment you ask the next question, and would otherwise be the first thing
  trimmed), and the gain is **measured and shown** — `8 200 → 900 tokens` — rather than asserted.
  See [ADR-0007](docs/adr/0007-compacter-plutot-que-tronquer.md).
- **An earlier conversation as context.** A button on every row of the history attaches that
  transcript to the conversation you are in, instead of leaving for it. Fenced as untrusted, like
  any other attachment: a transcript contains whatever the assistant read while it was running.
- **Syntax colour in answers**, written by hand — no grammar engine, no runtime dependency, and no
  palette of ours: every colour is one of the editor's own variables, so a snippet reads correctly
  on a light theme, a dark one and a high-contrast one. Families rather than languages, and an
  unknown language tag is left entirely plain. RPG (fixed and free), DDS, CL and Db2 for i are
  included, columns and all. See [ADR-0008](docs/adr/0008-la-couleur-vient-du-theme.md).
- **Tables, checklists and horizontal rules** in answers, and the answer is now **rendered as it
  streams** rather than shown as raw markdown and reformatted at the end — which meant reading
  every answer twice and having the text move under your eyes as it finished.
- **Every model server on your machine, and on your network.** The picker used to list what one
  configured address served; it now lists every runtime that answers, under **“On your machine”**
  and **“On your network”** — two homes, because one works on a train and the other is somebody
  else's to reboot. A team's GPU box is declared in `hiveyCode.endpoints.servers` or from the setup
  screen, and an address on your own network counts as local: nothing billed, nothing
  pseudonymised. Choosing a model now carries its address, so a model served by a second runtime no
  longer fails on the first question.

### Fixed

- **The terminal mode never worked behind a gateway.** The editor handed the terminal client a URL
  and a model and never the provider or the key, so anyone not running a local server opened it,
  typed a question and got `HTTP 401 Unauthorized` — which reads as a broken feature rather than as
  a missing hand-off. Both halves of the contract now live in one file. The key travels in the
  process environment (never on the command line, which is world-readable on Linux and lands in
  shell history everywhere) and **only when the endpoint is remote**. If no key is stored, it says
  so *before* opening the terminal.
- **The panel stopped jumping to the left sidebar.** Pressing History — or the model picker, the
  search, the setup screen, or any editor command — in the right-hand panel revealed the
  activity-bar copy and moved the conversation there. Two ways to bring the panel forward existed
  and disagreed; there is now one, and it does nothing at all when a copy is already on screen.
- **The composer overhung the answers.** The transcript reserves a gutter for its scrollbar and the
  composer did not, so the box you type in sat that many pixels wider than everything above it. The
  gutter is now measured on the machine it runs on rather than assumed.

### Changed

- The composer is **three rows** rather than two, and its border **turns clockwise** while the model
  is answering — the only motion in the interface, and switched off for anyone who has asked their
  system for reduced motion.
- The history's filters take **one row per question**: when, then what kind. Eight chips sharing a
  line meant the grouping changed with the width of the panel.
- The context meter gains a **bar**, shown only once the conversation genuinely fills a fifth of the
  budget. At 3 % it drew a dot at the end of a grey line, which reads as a rendering fault.

## 0.11.1 — 2026-08-27

### Fixed

- **The model picker vanished from the composer** on a narrow panel. Caused by 0.10.0: the toolbar
  stopped wrapping, and the model button was the only item allowed to shrink — so it absorbed every
  pixel of pressure and collapsed to nothing, which reads as the control having been removed rather
  than as a narrow row. It now keeps a floor wide enough to stay recognisable, and the mode button
  no longer shrinks at all: "Ag…" tells the reader nothing, while a truncated model name is one
  hover away from its full id.
- **The model name is shortened** to the part someone would say out loud —
  `anthropic/claude-sonnet-4.5` rather than the whole id, `qwen2.5-coder` rather than
  `qwen2.5-coder:7b`. The vendor is repeated in the picker and the size tag is a deployment detail.
  The full id is in the tooltip.

## 0.11.0 — 2026-08-27

**Both sides, at once.**

- **The panel is now declared in the activity bar AND in the right-hand bar**, and both work at the
  same time on the same conversation. Every previous attempt at this moved it: a view container
  lives in exactly one place, so declaring one home is choosing a default rather than offering a
  choice. Declaring it twice, with one provider serving both views, is what actually offers the
  choice — open either, or both; the state lives in the extension and the panels only draw it.
- **The setup screen has a visible icon** in the title bar. It was reachable by command and from the
  model picker, and both of those are the same as unreachable for anyone who has not gone looking
  behind a "…".
- **The context meter is outside the box**, on the panel background above it. It was inside the
  border, where it still read as part of the field you type into — which is precisely what it should
  not be. It is a reading about the conversation, not a control of the message.
- Commands that need the panel now bring forward **whichever copy is on screen**, instead of always
  reaching for the activity bar's one and yanking you back to the left.

## 0.10.0 — 2026-08-27

### Changed

- **The consent to send is asked in the conversation, not in a modal.** The consent itself is not
  negotiable — it is the whole privacy argument — but a modal at the moment of sending stops the
  world for a routine action, and a question that stops the world gets dismissed rather than read.
  It now appears as a card where the answer will appear, with **Send**, **Always to this model** and
  **Do not send**. There is no "this conversation": consent belongs to a destination, and a
  conversation is not one.

  The one case that stays modal is a detected credential. Interrupting is right when something that
  looks like a password is about to leave.
- **The context meter moved above the box**, right-aligned. Inside the toolbar it sat between the
  model name and the send button and competed with both for the same few pixels.
- **The composer's toolbar no longer wraps.** Wrapping was a way to survive a very narrow panel and
  it cost more than it saved: the send button dropped to a line of its own, which reads as a broken
  layout rather than a narrow one. `hiveyCode.panel.minWidth` already stops the panel getting narrow
  enough for the question to arise, so the row refuses to break and the model name ellipsises.

### Fixed

- **The panel is back in the activity bar**, on the left, where an extension's icon belongs. Moving
  it to the secondary side bar in 0.8.0 was a mistake: a view container lives in one place at a
  time, so declaring a home is choosing a DEFAULT — and I changed the default instead of offering
  the choice. `Hivey Code: Move the panel` now opens the editor's own destination picker, which
  offers every placement it supports, in its own words, and remembers what you choose.
- **The quick-connect screen was unreachable** once dismissed. It now opens whenever the configured
  model could not answer — a remote provider with no key in the keychain — because a conversation
  that fails on its first question is a worse first impression than a screen that asks. It is also
  one click from the model picker, which is where someone goes when they want a model they cannot
  yet use. Every provider carries a link to where its key is issued.

## 0.9.1 — 2026-08-27

### Fixed

- **The `#` list vanished the moment you reached for it**, so nothing could be picked. Two causes,
  and the second is the one that mattered. The rows listened for `click`, which arrives after focus
  has moved and after anything the blur set off — by which time the row was gone. And `render()`
  empties the whole panel and rebuilds it, so *any* message from the extension destroyed the list.
  It also destroyed the half-written question underneath it, which nobody had reported because it
  looks like a slip of the hand rather than a bug. The composer's text and caret are now taken out
  before the rebuild and put back after, and the list with them.
- The logic behind the list moved into core, where it can be tested: which word is under the caret,
  and what replaces it. Ten tests, including one that parses every suggestion back — a suggestion
  the parser rejects is a trap, because the user types what was offered and nothing happens.

### Added

- **"Whole file" in the `+` menu**, alongside "Selection" — the same thing `#editor` attaches. The
  single "Active file" entry silently chose between them, so with three lines highlighted there was
  no way to attach the file they live in, which is exactly when you want to. Both entries now name
  the file, and the selection says how many lines it covers.

## 0.9.0 — 2026-08-27

### Security

- **`privacy.blockedGlobs` never blocked anything.** The glob matcher was a chain of `.replace()`
  calls, each rewriting the output of the last: the step that expanded `**/` emitted `?` and `*`,
  and the two later steps rewrote the characters it had just emitted. `**/.env*` compiled to
  `^([^/]:.[^/]*/)[^/]\.env[^/]*$` — a pattern that matches nothing at all. Every shipped default
  starts with `**/`, so `.env`, private keys, `secrets/**`, `.aws/**` and `.ssh/**` were all
  attachable and all sendable.

  There was no test on the matcher. The extension's central promise was untested and therefore
  untrue. It is now compiled in a single pass — a replacement chain cannot be safe when the
  replacement text is in the same alphabet as its input — with fourteen tests, including one that
  asserts the shipped defaults against the paths they exist to stop.

### Added — permissions the user controls

- **`hiveyCode.permissions.autoApprove`**: `off` (the default), `workspace` (changes inside the open
  folder run; commands and anything outside still ask) or `all` (nothing is asked). The middle one
  is the one worth having, and `all` asks for confirmation once, because it is the setting whose
  cost is not visible from its label until something has happened.
- **A denied list and an allowed list**, for paths and for commands. Refusals are evaluated first
  and cannot be overridden — a path on the denied list is refused even when the allowed list says
  `**/*` and approvals are off. That ordering is what makes it safe to offer the dangerous scope.
- **The two command rules pull in opposite directions, deliberately.** An allowance is narrow:
  `npm test` covers `npm test --watch` and *not* `npm test && rm -rf /`. A refusal is broad: denying
  `git push` also refuses `ls && git push`, because a refusal escaped by typing `&&` protects
  nobody. Word boundaries hold in both, so denying `rm` does not deny `rmdir`. There is a test whose
  only job is to stop a later reader merging the two functions.
- The scope and both lists appear on the **Permissions screen**, not only in the settings. Someone
  who cannot find the middle option here will find the one in the settings that says `all`.
- A denied path is about what may be **touched**; `privacy.blockedGlobs` is about what may **leave**.
  Neither is the other, and both apply.

### Fixed

- The model picker stayed open over whatever screen you moved to next. It is a floating element on
  the body, so it outlived the screen that opened it.

## 0.8.0 — 2026-08-27

### Fixed

- **Changing model failed outright** with *"Unable to write to workspace settings because no
  workspace is opened"*. Three preferences were written with `ConfigurationTarget.Workspace`, which
  throws when the editor was launched on a single file or on nothing — so the picker raised an error
  and changed nothing, which is most of a first try. The target now follows reality: the workspace
  when there is one, the user's own settings when there is not.

### Added

- **A "Recommended" group** at the top of the model picker: a handful worth using, one per family,
  each with a clause saying why. Nothing in it names a version. It holds FAMILIES with a reputation
  for code, matched against whatever the endpoint actually serves — so when a family ships a new
  version the recommendation follows it the next day, and when one stops being served it stops
  appearing. A hard-coded list would be correct today and quietly wrong in two months, which is
  worse than none, because an out-of-date recommendation looks exactly like a current one.
- **`hiveyCode.panel.minWidth`** (default 260). Below it the panel scrolls sideways instead of
  rearranging itself, so dragging the side bar narrow can no longer reshuffle the layout. `0` lets
  it shrink freely.

### Changed

- **The panel lives in the secondary side bar**, on the right, where the editor's own chat lives.
  `Hivey Code: Move the panel…` sends it back to the left for anyone who prefers that.
- **The panel's own header holds only the conversation's name, centred.** Search, new conversation,
  history and the overflow behind them are drawn by the editor one row above; drawing them again
  produced a second row that read as a mistake, because it was one. Search moved up to join them,
  and everything that was behind the panel's overflow button now sits in the editor's own.

## 0.7.0 — 2026-08-27

**Skills and sub-agents, defined by you.**

The request was "total control of the tool", and the shape that answers it is not a settings page:

```
.hiveycode/skills/review-rpg.md      instructions you invoke with /review-rpg
.hiveycode/agents/db-explorer.md     a sub-agent with its own prompt, tools and model
```

Files, for three reasons that are the whole design. They are **versioned** — a team's conventions
belong next to the code they govern, reviewed like code, arriving with a clone. They are
**readable** — a skill is prose with a header, and someone who has never seen this extension can
open one and know what it will do. And the **format is already known**: it is Claude Code's, so
anyone who has written one has written all of them.

The model is told each skill's name and description, never its contents — a dozen skills' full text
in every prompt would spend the context budget before the question. It fetches the instructions when
one applies.

### The rule that is not yours to change

A sub-agent's `tools:` line is a **request, not a grant**. Its tools are intersected with what the
current mode already allows, never added to it. A definition file arrives with a cloned repository;
if it could grant itself `run_command` in plan mode, the mode would stop being a guarantee. Listing
a tool the mode does not offer is not an error either — it is a definition written for agent mode
being used in plan mode, and it should quietly do less rather than refuse.

Whatever a sub-agent does goes through the same approver, the same egress gate and the same
pseudonymisation vault as its parent. Being called by a sub-agent is not a way around a dialog.

Skills are absent in chat mode, along with the block naming them. A skill is instructions you wrote,
but it is still a file read from the repository, and chat mode's promise is that it does not read
the repository. A promise with an exception in it is not one.

### Details that matter when you write one

- A broken file is **reported, not skipped**. A skill silently vanishing makes the assistant ignore
  instructions it never received, with no way to find out why.
- The templates are **valid definitions**, not forms of blanks — a template that does not parse is a
  trap, because the failure looks like your edit.
- An out-of-range `max-steps` is refused rather than clamped: you asked for 500, and being given 50
  without being told is worse than being told 500 is not on offer.
- Two files claiming the same name is reported, because one of them would never run.
- Edits take effect on the next turn. A definition you have to reload the window to try is one
  nobody iterates on.

## 0.6.0 — 2026-08-27

Everything here comes from Florian using the extension for the first time. That is the point of
using it: none of the nine defects below were things the 206 tests were looking for.

### A first screen that does not ask an unanswerable question

Installing this used to lead to `hiveyCode.endpoints.local` and a request for a base URL. Someone
who installed Ollama an hour ago does not know it, has no reason to know it, and guesses wrong — and
the guess fails in a way that looks like the extension being broken.

The setup screen does not ask, it reports. It knocks on the ports local runtimes actually bind —
Ollama, LM Studio, llama.cpp, vLLM, Jan, LocalAI, text-generation-webui — **on loopback only**, and
lists what answered with the models it serves. Pick one and you are done. A runtime that is running
but empty gets the exact `ollama pull` line, ready to copy, because "no model found" is a dead end.

Gateways get one card each — **OpenRouter, Anthropic and any OpenAI-compatible server** — with the
address field for the last of those. Only OpenRouter was offered at first, which told everyone with
an Anthropic account that this extension did not support them, while the code supported them all
along. An affordance that exists in the code and not on the screen does not exist.

### Fixed

- **The terminal client could not start.** It was launched with `node`, which assumes Node.js is
  installed and on the shell's PATH — an unreasonable thing to require of someone installing a VS
  Code extension, and it fails as "command not found", which reads as a broken feature. It now runs
  on the Node that VS Code itself runs on (`process.execPath` with `ELECTRON_RUN_AS_NODE`), so there
  is no prerequisite at all. Paths are quoted, because "Program Files" exists.
- **Deleting the last message of a conversation did not save.** The persistence skipped an empty
  session on the reasoning that there was nothing to write; what it did was leave the *previous*
  version — with the messages just deleted — in storage. Reopening brought them all back. Emptying a
  conversation now removes it. Nine tests cover what "the history works" actually means.
- **The settings had no way to connect an account.** Keys deliberately live in the OS keychain
  rather than in `settings.json`, which syncs and gets committed — but nothing in the settings said
  so or offered a way in. There is now an Accounts entry linking to each command.
- **The ellipsis in the panel header was barely visible.** Not a colour problem: it is
  `currentColor` like its neighbours. It was three zero-length segments at stroke-width 1.3 — a
  quarter of the ink of every other icon. A dot has to be filled to weigh the same as a line.

### Changed

- **The model picker shows price and nothing else.** The curated quality index is gone, and deleted
  rather than hidden: a hundred and fifty lines of hand-tuned numbers that no screen reads are not an
  asset. The colours changed too, and for a reason worth recording — `--vscode-charts-*` are *fill*
  colours, meant to sit behind a legend as a solid block. At eleven pixels of text they are muddy,
  and `charts.orange` is a dark amber that disappears on a dark background. The badges now use the
  tokens the editor uses for text it needs you to read.
- **The conversation's name is editable**: double-click it, press F2, or use the pencil. A title the
  assistant guessed from your first question is a guess, and a guess you cannot correct is what you
  scroll past in the history a week later looking for something else. The local/remote badge beside
  it is gone — it said the same thing for weeks at a time, and the composer already names the model.
- **"Attach all open files" is first in the context menu** and says how many there are and roughly
  what they cost. It used to sit below twelve file names, where the only people who found it were
  the ones who no longer needed it.
- **The panel header reads "Hivey Code"**, not "Hivey Code: Chat".
- **The panel can move to the secondary side bar**, from its own overflow menu.

## 0.5.2 — 2026-08-27

- Removed `copilot` from the manifest's keywords. Using a competitor's trademark as search metadata
  is descriptive rather than misleading, and plenty of extensions do it — but the Marketplace
  forbids metadata that suggests affiliation, and the phrase carries no information this extension
  needs to convey. The comparison stays in the README, where it is an argument rather than a tag.
- The keywords now say what the thing is (`coding assistant`, `inline completion`), where the model
  runs (`ollama`, `local llm`, `offline`), why someone is looking (`privacy`, `gdpr`,
  `confidential`) and who nobody else is serving: `ibm i`, `as400`, `rpgle`, `sqlrpgle`,
  `db2 for i`, `arcad`. That last group is the one that will actually find its audience.

## 0.5.1 — 2026-08-27

- The repository is `FlorianMartins/hivey-vscode`. It was `hivey-code`, one hyphen away from
  `HiveyCode` — the web IDE — which is a distinction nobody should have to make at a glance. The
  extension itself is unchanged: still **Hivey Code**, still `hivey.hivey-code`.
- Removed a menu entry pointing at `hiveyCode.askWith`, a command that is registered in code and
  deliberately not declared in the manifest. Hiding an undeclared command with `when: false` hides
  nothing — a command absent from `contributes.commands` never reaches the palette — and it put
  *"Menu item references a command … which is not defined"* in every user's extension host log.

## 0.5.0 — 2026-08-27

**Renamed to Hivey Code.**

The name was the only thing that changed, and it changed for a reason worth writing down: the
Marketplace already carries six extensions with "Forge" in the name, one of them an AI coding agent
called *Forge Code* with several thousand installs. The identifier `hivey.forge` was in fact free —
uniqueness is per publisher — so nothing forced this. Being findable, and not being mistaken for a
competitor, did.

- Display name **Hivey Code**, identifier `hivey.hivey-code`.
- Settings move from `forge.*` to **`hiveyCode.*`**. Nothing migrates them: nobody had installed
  0.4.0, so the cost of a clean break is zero today and would not have been in a month.
- Commands move from `forge.*` to `hiveyCode.*`, under the category **Hivey Code**.
- The terminal client is `hivey-code`, with **`hivey`** as a short alias — a command typed daily
  should be short, and a command in documentation should be unambiguous.
- The per-project configuration file is `.hiveycode.json`, and repository rules may live in
  `.hiveycode/instructions.md`.
- The repository is now `FlorianMartins/hivey-vscode`. GitHub redirects the old address.

### What the rename found

A blanket search-and-replace is a bad way to rename a product, and the tests are what made it a
tolerable one. Three integration tests failed immediately on
`getConfiguration("hivey-code")` — the settings namespace is `hiveyCode`, so every setting silently
read its default instead of failing. The literal was hard-coded in five places for three *different*
meanings: the settings namespace, the MCP client's name, and a label in the terminal client. They
now refer to the single definition, so the next rename cannot reintroduce this.

The same pass turned `.forge.json` into `.hiveyCode.json` — a dotfile with a capital letter, which
behaves differently on Linux and on macOS. It is `.hiveycode.json`.

## 0.4.0 — 2026-08-27

**Speaks IBM i, plugs into the tools around it, and looks like the editor it lives in.**

### IBM i

- The **dialect is detected from the member, not from its name** — `**FREE` in column 1, or a
  specification letter in column 6. `.rpgle` covers both fully free and fixed-format source, and
  telling a model the wrong one produces code the compiler cannot place.
- Its rules and its **column ruler** go into the prompt: RPG III, ILE RPG fixed and free, SQLRPGLE,
  CL/CLLE, DDS for physical, logical, display and printer files, Db2 for i, ILE COBOL, command
  definitions.
- **Symbols are read by column.** A P specification is the letter P in column 6 with the name in
  7-21; a line-anchored regex finds nothing, so an IBM i repository used to produce an empty
  repository map — the one codebase where a map is worth the most.
- A local check reports the failure the compiler does not: a line past column 80 is truncated and
  compiled, not rejected.
- `/tofree`, `/sql` and `/dds`; `#member:LIB/SRCFILE(MBR)` and `#db2:…`.

### The tools around it

- **Git** through the editor's own extension: status, diff, log, blame, show, branches, stage,
  commit. Never push — publishing a branch stays the user's decision.
- **Code for IBM i**: Db2 for i, CL commands, source members, object lists, library list — on the
  connection it has already negotiated. Hivey Code opens no session of its own.
- **ARCAD Elias**: ten actions through the `arcad.*` commands Elias registers, plus calls to the
  REST server already configured in `arcad.restApiServer.*`. Hivey Code does not invent ARCAD's
  endpoints; it carries requests to paths you supply, with credentials from the OS keychain.
- **MCP**, stdio and HTTP, written by hand. A stdio server is arbitrary code execution configured in
  a file that may have arrived with a repository: it does not start until you have agreed in a
  dialog that names the command, and the consent is tied to the command, not to the name.

### The panel

- The **model picker** in the shape the Hivey sidebar settled on: a read-only trigger opening a
  panel with a metric header, its own search box, grouped rows, a badge whose segments are coloured
  independently, and a collapsible price/provider filter. Colour comes from the theme rather than
  from hex values, and the quality metric follows the **mode** — agent re-ranks by how well a model
  drives a tool loop.
- `#context` and `@participant`, in Copilot's notation, resolved on this machine before anything is
  sent. `#` no longer opens a file dialog — a dialog can only ever offer files, which is why
  `#changes` could not exist before.
- House rules from `.github/copilot-instructions.md`.
- Turns are separated by space rather than by a rule; the composer's two toolbar rows become one
  that wraps; each turn carries a shape rather than a colour, so it survives high contrast.
- Export the conversation as Markdown, including the exchanges you muted — a record of a
  conversation nobody had would be worse than no record.

### Fixed

- The credential scanner flagged thirteen of its own strings: in a codebase about language models,
  `token` means a unit of context far more often than a bearer token. Fixed in the detector — no key
  ever issued opens with `#`, `@`, `/` or `\`, or ends with a colon.
- `hiveyCode.pickModel` was registered twice, which fails activation outright. Only a run inside a real
  editor shows that.
- Screenshots are taken by `scripts/screenshots.mjs` from a real VS Code, driven by a marker file
  rather than by two clocks in two processes — the drift used to produce three photographs of the
  same frame.

193 tests, 9 of them inside a real VS Code.

## 0.3.0 — 2026-08-21

**English interface, and a translation that cannot silently rot.**

- The interface is now English in the source, with French as a translation: one catalogue
  (`src/shared/i18n.fr.ts`) for the panel, the extension and the terminal client, plus
  `package.nls.json` / `package.nls.fr.json` for the manifest. It follows VS Code's display
  language.
- A test reads the source and fails when a string has no entry in the catalogue, and another fails
  on entries for strings the code no longer uses.
- The system prompts no longer assume the user writes French: the assistant answers in whatever
  language the question was asked in.
- `hiveyCode.language` pins the interface language independently of the editor's, which is also what
  makes the translated interface testable without installing a VS Code language pack.
- Command words in the terminal client stay untranslated — `/mute` and `/muet` both work, because a
  command that moves with the interface language is a command nobody can rely on.

## 0.2.0 — 2026-08-21

**Renamed to Hivey Code, and the panel rebuilt around what the assistant may do.**

- Four screens — conversation, history, models, permissions — in the editor's own visual language.
  Not one hex colour: every value is a VS Code theme variable. Icons are inline SVG (Unicode glyphs
  rendered as empty boxes in the editor's UI font).
- **Modes** (chat / plan / agent) decide the tool set *in code*: plan mode has no writing tool to
  reach for.
- **Permissions** apply to the shape of an action, never to one occurrence: trusting `npm test`
  does not trust `npm publish`, and a refusal always wins.
- **Reasoning** is a budget the user sets, translated per provider — an effort word for OpenRouter,
  a token budget for Anthropic.
- **Model picker** with input, output and cache prices side by side, plus what the local endpoint
  actually serves. Opening it sends no request anywhere.
- **Search** inside the open conversation and across the history; history filters by period, mode
  and cost, with four sort orders.
- Context menu: active file, open tabs, disk import, VS Code's own file picker.
- Settings, commands and storage keys moved from `hiveyForge.*` to `hivey-code.*`.

### Fixed

- The egress gate fell back to the **unredacted** messages when the user refused mid-turn — that
  is, it sent the data precisely when the answer was “do not send it”. It now aborts the turn.
- Inline completion sent the raw prefix and suffix; on a remote endpoint that was the one path that
  skipped pseudonymisation.

## 0.1.0 — 2026-08-21

First working version: reversible pseudonymisation, providers (Ollama, LM Studio, vLLM, LiteLLM,
OpenRouter, Anthropic), local-first routing with consented escalation, per-request and daily
budgets, inline fill-in-the-middle completion, sidebar chat with an agent mode, editor commands,
a terminal client, an egress log and a cost report — with no runtime dependency and no telemetry.
