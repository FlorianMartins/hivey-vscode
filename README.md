# Hivey Code

**A coding assistant for VS Code that does not send your code away.**
Local models (Ollama, LM Studio, vLLM, llama.cpp) or a remote gateway (OpenRouter, Azure, LiteLLM,
Anthropic) — your choice, per role, and **pseudonymised when it does leave**.

Open source (Apache-2.0), **zero runtime dependencies**, **zero telemetry**.

[Français](README.fr.md) · [Architecture](docs/ARCHITECTURE.md) · [Privacy](docs/PRIVACY.md) ·
[Threat model](docs/THREAT-MODEL.md)

![Hivey Code's sidebar in VS Code](https://raw.githubusercontent.com/FlorianMartins/hivey-vscode/main/docs/images/conversation.png)

*Real screenshots, taken from a VS Code launched by the integration suite — `node scripts/screenshots.mjs`
takes them, so they cannot quietly stop being true. Only the model answering is a stub server; the
interface is the product, at the side bar's default width.*

| Choosing a model | Conversations |
|---|---|
| ![The model picker](https://raw.githubusercontent.com/FlorianMartins/hivey-vscode/main/docs/images/picker.png) | ![History and filters](https://raw.githubusercontent.com/FlorianMartins/hivey-vscode/main/docs/images/historique.png) |

---

## Why

GitHub Copilot is excellent, and it presents a company with two problems:

1. **The code leaves.** Every keystroke, every open file, every question goes to a third party. For
   a lot of teams — health, defence, banking, subcontractors under NDA — that alone closes the file.
2. **The cost is structural.** The product sends everything to one large remote model, because that
   is the product. You pay per developer, every month, for completions that are 90 % trivial.

Hivey Code inverts both: **the default is the model already running on your machine**, the remote one is
an **escalation** that has to be justified, consented to, and paid for out of a budget; and anything
that does leave is **reversibly pseudonymised** first.

## What it does

| | |
|---|---|
| **Inline completion** | Fill-in-the-middle with your local code model. Debounced, cancellable, with a typed-through cache that serves the rest of a suggestion **with no request at all**. |
| **Sidebar chat** | Streaming, attachments (active file, selection, chosen files), per-workspace history, model picker, context and cost meters. |
| **Three modes** | **Chat** (no tools), **Plan** (reads the repository, changes nothing), **Agent** (reads, edits, proposes commands). The mode decides the tool set **in code**: in plan mode no writing tool exists — it is not an instruction in a prompt. |
| **Agent mode** | Reads the repository, searches it, consults the **editor's diagnostics**, edits files and proposes commands — **one approval per action**, a diff before every write, everything in the undo stack. |
| **Permissions** | Per action and per shape of action: “allow once”, “for this conversation”, “always”. Allowing `npm test` does not allow `npm publish`. A dedicated screen separates what is permanent from what expires. |
| **Reasoning** | An adjustable thinking budget (direct / brief / standard / deep), translated per provider — `reasoning.effort` on OpenRouter, a token budget on Anthropic. The thinking is shown in a collapsed block and never sent back to the model. |
| **Terminal** | The `hivey-code` command (short alias `hivey`): the same core in a REPL, with command output actually captured and a diff printed before every write. |
| **In the editor** | `Ctrl+I` rewrites the selection in place · right-click → ask about the selection · commit message written from the staged diff · “explain the terminal output”. |
| **Quick fixes** | On an error reported by your language server: “Fix with Hivey Code” and “Explain this problem”. The compiler says **what** and **where**; the model only has to fix it — which is what makes a small local model enough for most everyday cases. |
| **Context notation** | `#file:`, `#selection`, `#changes`, `#problems`, `#codebase`, `#terminal`, `#sym:` — Copilot's notation, because you should not have to learn a second one. Resolved **on your machine** before anything is sent, which is what lets `#changes` attach unreleased code to a conversation with a local model. |
| **Participants** | `@workspace`, `@editor`, `@terminal`, `@git`, `@ibmi`, `@arcad` — a hint about where to look first, not a different personality. |
| **House rules** | `.github/copilot-instructions.md` is read as written: a team that has one should not write it twice. `.hiveycode/instructions.md` wins if both exist. |
| **Git** | Status, diff, log, blame, show, branches, stage, commit — through the editor's own Git extension, not through a shell. It never pushes. |
| **IBM i** | Db2 for i, CL commands, source members, object lists and the library list, over the connection Code for IBM i has already negotiated. And the part that decides whether the code compiles: **the dialect is detected from the member, and its column rules go into the prompt** — RPG III, fixed and free ILE RPG, SQLRPGLE, CL, DDS (PF/LF/DSPF/PRTF), Db2 for i, COBOL. |
| **ARCAD Elias** | Check-out, check-in, compile, cross-references and the Transformer RPG conversion, through the `arcad.*` commands Elias itself registers — plus calls to the REST server you have already configured. |
| **MCP** | Connect any Model Context Protocol server, stdio or HTTP. Its tools join the set, under the same permissions. A local server never starts until you have said so in a dialog that names the command. |
| **Search** | Inside the open conversation (`Ctrl+F`, matches highlighted) **and** across the whole history — the search looks inside the messages and shows the fragment that matched. |
| **History filters** | Period, mode, “paid only”, and four sort orders (recently updated, created, longest, most expensive). |
| **Context control** | Every exchange can be **muted** (stays on screen, stops being sent), **pinned** (survives trimming), edited or deleted. It is the most direct lever there is on both quality **and** cost. |
| **Privacy** | Reversible pseudonymisation, blocked files, consent before the first destination, an **egress log** and a **cost report**. |
| **Languages** | English and French, following the editor's display language — or pinned with `hiveyCode.language`, for a machine whose editor is in one language and whose user reads another. |
| **Your theme** | Every colour in the panel is one of the editor's own variables. Not one hex value — [the same picker under a light theme](https://raw.githubusercontent.com/FlorianMartins/hivey-vscode/main/docs/images/picker.light.png), captured by the same script. It follows a theme change immediately, high contrast included. |

## How the cost tends to zero

Not a slogan — an architecture. Five levers, in order of effect:

1. **Completion never escalates.** It is the high-frequency traffic — one request per pause in
   typing. It runs on a local code model (7B is enough) and costs electricity. The router forbids
   escalating it *whatever* the configured policy.
2. **Send a map, not the territory.** The ambient context is a **repository map** (paths + top-level
   symbols, extracted without a native parser), not file contents. A few thousand tokens describe a
   repository a hundred times their size, and the model asks for the two files it needs instead of
   being handed forty.
3. **The prompt cache.** The stable prefix (system prompt + repository map) is marked with
   `cache_control` on Anthropic and benefits from implicit caching elsewhere. A coding conversation
   resends almost the same context every turn: that is where most of the bill is decided.
4. **Do not ask when it is pointless.** No request mid-word, none in front of existing code, none
   for a context the model already had nothing to say about; and the rest of a suggestion you are
   typing through is served from the cache.
5. **A budget that refuses.** A per-request cap (one runaway prompt cannot cost a dinner) and a
   daily cap, checked **before** the call on an estimate, recorded **after** on the real cost when
   the provider reports it (OpenRouter does).

Default result: **$0**. The first cent spent is an explicit choice.

## How privacy is kept

Four steps, in this order, on everything bound for a remote provider:

1. **Blocked.** A file matching `privacy.blockedGlobs` (`.env`, keys, `secrets/**`…) is never
   attached, neither in chat nor in completion.
2. **Reversible pseudonymisation.** Credentials (known shapes + an entropy safety net), e-mail
   addresses, phone numbers, IP addresses, internal hosts, account names in paths, and the
   **organisation-specific terms** you list. `alice@corp.fr` becomes `⟨EMAIL_1⟩` — **always the same
   marker**, so the model can still reason — and becomes `alice@corp.fr` again on your machine,
   including in the code it sends back.
3. **Refused.** A detected credential raises a modal warning; it has already been replaced anyway.
   The “off” level never applies to credentials: privacy is a preference, a password is not.
4. **Consent.** Before the first request to a given destination: what leaves (volume, destination,
   model) and what was masked.

Then, **the proof**: `Hivey Code: Show outgoing data` lists every remote request — timestamp, host,
model, tokens, share served from cache, cost, redaction categories. **Never the content**: a log of
what you were trying to keep private is not a privacy feature.

The places where others get this wrong, and which are handled here:

- **The endpoint decides, not the setting name.** Pointing the “local” provider at a public URL
  triggers pseudonymisation and consent like any other.
- **Every agent step goes through the gate again.** A file the agent just read is new text: it is
  pseudonymised again before the next call.
- **Attached content is fenced.** Files, logs and pages arrive inside a block closed by a
  **per-turn nonce**; an injection hidden in a file cannot close a block whose delimiter it cannot
  guess.
- **Keys live in the OS keychain** (`SecretStorage`), never in `settings.json` — which syncs, and
  gets committed by accident.

## For IBM i teams

Every other language this extension handles shares an assumption: whitespace is decoration. On IBM i
that assumption is false, and being wrong about it is expensive. An RPG III calculation means one
thing in column 26 and another in column 36; a DDS record name lives in columns 19-28 and nowhere
else; a line that runs past column 80 is not rejected, it is **truncated and compiled**. A model
trained mostly on free-form code writes `if x = 1;` into a fixed-format member and the failure
surfaces later, in a spool file, as a message id.

So Hivey Code decides the dialect from the **member itself** rather than from its name — `**FREE` in
column 1, or a specification letter in column 6 — and puts that dialect's rules and its column ruler
into the prompt. `.rpgle` says nothing about the format, and telling the model the wrong one is the
single most reliable way to get code that cannot compile.

| | |
|---|---|
| **Understood** | RPG III (RPG/400), ILE RPG fixed and fully free, SQLRPGLE, CL/CLLE, DDS for physical, logical, display and printer files, Db2 for i SQL, ILE COBOL, command definitions. |
| **Mapped** | Symbols are read by column, so a repository of source members produces a real map. Before this it produced an empty one — and long members with six-character names are exactly where a map earns its keep. |
| **Connected** | Through **Code for IBM i**, on the connection it has already negotiated: the right library list, the right CCSID, a warm SQL job. Hivey Code opens no session of its own, because a second one would run under a different library list and get EBCDIC subtly wrong. |
| **Under change management** | Through **ARCAD Elias**: check-out, check-in, compile, cross-references, and the Transformer RPG conversion — by calling the `arcad.*` commands Elias registers, so a change stays inside the process the shop already has. |
| **Commands** | `/tofree` converts a fixed-format member, `/sql` writes Db2 for i rather than generic SQL, `/dds` explains a display file. `#member:LIB/SRCFILE(MBR)` and `#db2:select …` attach the real thing. |

Reading is free; running a CL command is always asked; an SQL statement is asked **only if it
writes**, because the check is on the statement rather than on the tool. In plan mode the same tool
exists in a form that refuses a write instead of offering you a dialog — "plan mode changes nothing"
should not have an "unless you click yes" attached to it.

Hivey Code does not invent ARCAD's REST endpoints. Its catalogue is not published, and guessing paths for
a model to call produces an integration that fails at a customer site in a way nobody can debug. It
carries requests to paths **you** supply, with credentials from the OS keychain. For anything deeper
than that, the right shape is MCP.

## Plugging in your own systems

Hivey Code speaks the **Model Context Protocol**, so an internal service — a ticketing system, a
catalogue, a change-management server — can expose its own tools without either side knowing about
the other. Declare a server in `hiveyCode.mcp.servers`, or in a `.vscode/mcp.json` the team already has:

```jsonc
{
  "servers": {
    "tickets":  { "type": "http", "url": "https://tools.corp.example/mcp" },
    "internal": { "command": "node", "args": ["./tools/mcp-server.js"] }
  }
}
```

Its tools join the set under the same rules as every other: named for their server, governed by the
same permissions, filtered by the mode. A server's claim that a tool "only reads" is enough to skip
a dialog on a local one and never enough on one that reaches out of the machine.

**A stdio server is arbitrary code execution**, configured in a file that may have arrived with a
cloned repository. Hivey Code does not start one until you have said so in a dialog that names the
command, and the consent is tied to the command rather than to the name — the part an attacker
controls most cheaply.

The client is written by hand. The wire format is JSON-RPC over a stream and the handshake is three
messages; an SDK would bring a dependency tree into an extension whose whole premise is that you can
audit what it sends.

## Install

From the VS Code Marketplace: search for **Hivey Code** (publisher `hivey`).

From source:

```bash
git clone https://github.com/FlorianMartins/hivey-vscode
cd hivey-code
npm ci
npm run build
npx @vscode/vsce package --no-dependencies   # produces hivey-code.vsix
code --install-extension hivey-code.vsix
```

For the model, the simplest setup:

```bash
ollama pull qwen2.5-coder:7b   # completion + chat, ~5 GB
ollama serve
```

Nothing else to configure: the defaults point at `http://127.0.0.1:11434/v1`.

To add a remote escalation: `Hivey Code: Store a provider key`, then set `hiveyCode.escalation.model` (for
example `anthropic/claude-sonnet-4.5`).

### The terminal client

```bash
npm link                       # puts `hivey-code` and its short alias `hivey` on the PATH
hivey                          # REPL in the current directory
hivey "why is this test flaky?"   # one-shot question
```

Configuration comes from `.hiveycode.json` (working directory, then `~`), so a project can commit its
team configuration without committing a key (`apiKeyEnv` names the environment variable).

REPL commands: `/context` lists the exchanges, `/mute 3` takes one out of the context without
deleting it, `/forget 3` deletes it, `/mode` switches between chat, plan and agent, `/cost` shows
the day's spend. From the editor, `Hivey Code: Open Hivey Code in the terminal` starts it with the same
configuration as the sidebar.

## Enterprise deployment

- Serve one model for everyone: **vLLM** or **Ollama** behind an internal URL, and push
  `hiveyCode.endpoints.local` through VS Code's settings policy.
- Lock down what needs it: `privacy.blockedGlobs`, `privacy.customTerms` (client and project
  names), `privacy.egressPolicy: "ask-always"`, `budget.dailyUsd`.
- `hiveyCode.*` settings are workspace-scoped: a sensitive repository can force `chat.provider: "local"`
  in its own `.vscode/settings.json`.
- The extension ships **no runtime dependency**: what you audit is the bundle and nothing else. An
  SBOM is published on every CI run.

## Architecture

```
src/core/         no `vscode` import — testable without an editor
  redaction/      detectors, pseudonym vault, policy
  providers/      OpenAI-compatible (Ollama, vLLM, LiteLLM, OpenRouter…) + native Anthropic
  router/         local first, consented escalation, prices, budget
  completion/     FIM per model family, cache, answer cleanup
  context/        repository map, symbols, imports
  session/        the transcript, the prompt derived from it, the modes, the history, `#`/`@`
  agent/          the tool loop, and the permission book
  ibmi/           dialects, column rules, symbols read by column, Db2 for i decisions
  mcp/            the Model Context Protocol client, written by hand
  models/         the curated quality index the picker ranks by
src/shared/       the panel↔extension protocol, and the translation catalogue
src/extension/    the VS Code layer (sidebar, completion, commands, egress gate)
  integrations/   Git, Code for IBM i, ARCAD Elias, MCP servers
src/cli/          the terminal client
src/webview/      the panel: chat / history / models / permissions screens, the model picker,
                  hand-drawn SVG icons, and never `innerHTML` on model output
```

More: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/PRIVACY.md`](docs/PRIVACY.md) ·
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) · decisions: [`docs/adr/`](docs/adr).
Those documents are currently written in French; translations are welcome.

## Development

```bash
npm test                   # builds the bundles, then 193 tests (node:test)
npm run test:integration   # loads the extension into a real VS Code (9 tests, headless)
node scripts/screenshots.mjs  # retakes the README's images from that same editor
npm run typecheck
npm run scan:secrets       # scans this repository with the extension's own detectors
npm run models             # regenerates the price catalogue from OpenRouter
npm audit --audit-level=high   # 0 vulnerabilities: 5 dev tools, no runtime dependency
```

CI runs types, tests, integration tests in a real VS Code, the secret self-scan, `npm audit`,
CodeQL, the `.vsix` packaging and an SBOM. The price catalogue is regenerated daily by a scheduled
job: **no version and no price is ever written by hand**.

### Translating

The interface is English in the source and translated through one table:
[`src/shared/i18n.fr.ts`](src/shared/i18n.fr.ts) for the panel, the extension and the CLI, and
`package.nls.<lang>.json` for the manifest. To add a language, copy those two files, translate the
values, and register the table in `src/shared/i18n.ts`. A test fails if a string in the source has
no entry, so a translation cannot silently rot.

## Status

`0.5.1` — usable day to day. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what is done and what is
not.

## Licence

Apache-2.0.
