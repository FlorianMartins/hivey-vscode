# Changelog

Notable changes, newest first. Dates are the day the work landed on `main`.

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
