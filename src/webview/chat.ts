// The conversation screen: transcript, live turn, composer.
//
// The layout follows the one convention every developer already has in their fingers — the
// assistant panel in VS Code — because a coding tool is not the place to teach someone a new set of
// gestures. What sits inside that layout is this project's own: the mode selector says what the
// assistant is ALLOWED to do rather than how clever it is, the model button carries its price, and
// every exchange can be muted out of the context without being deleted from the story.

import { button, closeMenu, el, formatTokens, icon, ICON, menu, menuItem, menuTitle, separator } from "./dom.js";
import { markdown } from "./markdown.js";
import { t } from "../shared/i18n.js";
import { closeModelCombo, isModelComboOpen, openModelCombo } from "./modelCombo.js";
import type { Mode, Reasoning, ToExtension, UiEntry, UiState } from "../shared/protocol.js";
import { applySuggestion, suggestionsFor, type Suggestion } from "../core/session/mentions.js";

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "chat", label: t("Chat"), hint: t("Answers from what you attach. No access to the repository.") },
  { id: "plan", label: t("Plan"), hint: t("Reads the repository and proposes a plan. Changes nothing.") },
  { id: "agent", label: t("Agent"), hint: t("Reads, edits, proposes commands — with your approval.") },
];

const REASONING: Array<{ id: Reasoning; label: string; hint: string }> = [
  { id: "none", label: t("Direct"), hint: t("No thinking budget. Fastest, cheapest.") },
  { id: "low", label: t("Brief"), hint: t("A few hundred tokens of thinking.") },
  { id: "medium", label: t("Standard"), hint: t("For diagnosis and design work.") },
  { id: "high", label: t("Deep"), hint: t("For genuinely hard problems. Costs the most.") },
];

export interface ChatDeps {
  send: (m: ToExtension) => void;
  state: () => UiState | undefined;
  rerender: () => void;
}

export function chatScreen(state: UiState, deps: ChatDeps): HTMLElement {
  const wrap = el("div", "screen chat-screen");
  wrap.append(transcript(state, deps), composer(state, deps));
  return wrap;
}

// ── Transcript ───────────────────────────────────────────────────────────────────────────────

function transcript(state: UiState, deps: ChatDeps): HTMLElement {
  const list = el("div", "transcript");
  if (!state.session.entries.length) {
    list.append(welcome(state, deps));
    return list;
  }
  const matches = new Set(state.matches);
  for (const entry of state.session.entries) {
    if (state.searchQuery && !matches.has(entry.id)) continue;
    list.append(renderEntry(entry, state, deps));
  }
  if (state.searchQuery && !matches.size) {
    list.append(el("p", "empty", t("No message contains “{0}”.", state.searchQuery)));
  }
  return list;
}

function welcome(state: UiState, deps: ChatDeps): HTMLElement {
  const w = el("div", "welcome");
  w.append(el("div", "welcome-title", "Hivey Code"));
  w.append(
    el(
      "p",
      "welcome-lede",
      state.remote
        ? t("The selected model is remote: what leaves is pseudonymised, and you are asked before the first request.")
        : t("The model runs on your machine. Nothing you write here leaves the network."),
    ),
  );

  const cards = el("div", "welcome-cards");
  for (const m of MODES) {
    const card = el("button", `welcome-card${state.mode === m.id ? " selected" : ""}`);
    card.append(el("span", "welcome-card-title", m.label));
    card.append(el("span", "welcome-card-hint", m.hint));
    card.addEventListener("click", () => deps.send({ type: "setMode", mode: m.id }));
    cards.append(card);
  }
  w.append(cards);

  const tips = el("ul", "welcome-tips");
  for (const tip of [
    t("“#” attaches a file · “/” opens the commands · ⏎ sends."),
    t("A bad answer can leave the context without leaving the screen."),
    t("Agent mode asks for your approval before every write and every command."),
  ]) {
    tips.append(el("li", undefined, tip));
  }
  w.append(tips);
  return w;
}

function renderEntry(entry: UiEntry, state: UiState, deps: ChatDeps): HTMLElement {
  const wrap = el(
    "article",
    `entry ${entry.role}${entry.included ? "" : " muted"}${entry.error ? " failed" : ""}`,
  );

  const head = el("div", "entry-head");
  // A small mark before the name, the way the editor's own chat does it. It is not decoration:
  // when an answer is long enough to scroll, the mark is what tells you at a glance whether the
  // block you have landed in is your question or its reply.
  head.append(el("span", `entry-mark ${entry.role}`, entry.role === "user" ? "\u25CF" : "\u25C6"));
  head.append(el("span", "entry-who", entry.role === "user" ? t("You") : "Hivey Code"));
  if (entry.model && entry.role === "assistant") head.append(el("span", "entry-meta", entry.model));
  if (entry.usdCost) head.append(el("span", "entry-meta", `${entry.usdCost.toFixed(4)} $`));
  if (!entry.included) head.append(el("span", "entry-tag", t("out of context")));
  if (entry.pinned) head.append(el("span", "entry-tag", t("pinned")));

  const actions = el("div", "entry-actions");
  actions.append(
    button({
      icon: entry.included ? ICON.mute : ICON.unmute,
      title: entry.included ? t("Remove from context — stays on screen, stops being sent") : t("Put back into the context"),
      className: "btn icon-only",
      onClick: () => deps.send({ type: "setIncluded", id: entry.id, included: !entry.included }),
    }),
    button({
      icon: ICON.pin,
      title: entry.pinned ? t("Unpin") : t("Pin — survives trimming when the context is full"),
      className: `btn icon-only${entry.pinned ? " active" : ""}`,
      onClick: () => deps.send({ type: "setPinned", id: entry.id, pinned: !entry.pinned }),
    }),
  );
  if (entry.role === "user") {
    actions.append(
      button({ icon: ICON.edit, title: t("Edit and resend"), className: "btn icon-only", onClick: () => startEdit(entry, deps) }),
    );
  }
  actions.append(
    button({ icon: ICON.copy, title: t("Copy"), className: "btn icon-only", onClick: () => deps.send({ type: "copy", text: entry.text }) }),
    button({ icon: ICON.trash, title: t("Delete permanently"), className: "btn icon-only", onClick: () => deps.send({ type: "dropEntry", id: entry.id }) }),
  );
  head.append(actions);
  wrap.append(head);

  if (entry.context?.length) {
    const chips = el("div", "chips");
    for (const c of entry.context) {
      const chip = el("span", "chip", c.label);
      chip.title = t("{0} · ~{1} tokens", c.kind, formatTokens(c.tokens));
      chips.append(chip);
    }
    wrap.append(chips);
  }

  if (entry.reasoning) wrap.append(collapsible(t("Reasoning"), entry.reasoning));
  if (entry.steps?.length) wrap.append(stepList(entry.steps));

  if (entry.error) {
    wrap.append(el("div", "error", entry.error));
    wrap.append(
      button({ label: t("Retry"), className: "btn tiny", onClick: () => deps.send({ type: "retry" }) }),
    );
  } else {
    wrap.append(
      markdown(
        entry.text,
        {
          onCopy: (code) => deps.send({ type: "copy", text: code }),
          onInsert: (code) => deps.send({ type: "insertCode", code }),
          onApply: (code, language) => deps.send({ type: "applyCode", code, language }),
        },
        state.searchQuery || undefined,
      ),
    );
  }
  return wrap;
}

export function stepList(steps: Array<{ tool: string; summary: string; ok: boolean }>): HTMLElement {
  const list = el("div", "steps");
  for (const s of steps) {
    const row = el("div", `step${s.ok ? "" : " failed"}`);
    row.append(icon(s.ok ? "check" : "cross", "step-ico"));
    row.append(el("span", "step-tool", s.tool));
    row.append(el("span", "step-summary", s.summary));
    list.append(row);
  }
  return list;
}

export function collapsible(title: string, body: string): HTMLElement {
  const wrap = el("div", "collapsible");
  const head = el("button", "collapsible-head");
  head.append(icon("chevron", "collapsible-chevron"));
  head.append(el("span", undefined, title));
  const content = el("div", "collapsible-body", body);
  content.hidden = true;
  head.addEventListener("click", () => {
    content.hidden = !content.hidden;
    wrap.classList.toggle("open", !content.hidden);
  });
  wrap.append(head, content);
  return wrap;
}

function startEdit(entry: UiEntry, deps: ChatDeps): void {
  const area = document.querySelector<HTMLTextAreaElement>(".composer textarea");
  if (!area) return;
  area.value = entry.text;
  area.dataset["editing"] = entry.id;
  area.focus();
  autoGrow(area);
}

// ── Composer ─────────────────────────────────────────────────────────────────────────────────

/**
 * What the user had typed, so a re-render does not throw it away.
 *
 * `render()` empties the whole panel and rebuilds it, which is the right thing for a transcript and
 * the wrong thing for the box the user is typing in. Any message from the extension — a model list
 * arriving, the editor's selection changing — destroyed the draft, the caret and the `#` completion
 * list, which is why the list "disappeared" the moment you reached for it.
 */
export interface Draft {
  text: string;
  start: number;
  end: number;
  editing?: string;
}

let lastDeps: ChatDeps | undefined;

export function captureDraft(): Draft | undefined {
  const area = document.querySelector<HTMLTextAreaElement>(".composer-input");
  if (!area) return undefined;
  return {
    text: area.value,
    start: area.selectionStart ?? area.value.length,
    end: area.selectionEnd ?? area.value.length,
    ...(area.dataset["editing"] ? { editing: area.dataset["editing"] } : {}),
  };
}

export function restoreDraft(draft: Draft | undefined): void {
  if (!draft?.text) return;
  const area = document.querySelector<HTMLTextAreaElement>(".composer-input");
  const hints = document.querySelector<HTMLElement>(".slash-hints");
  if (!area) return;
  area.value = draft.text;
  if (draft.editing) area.dataset["editing"] = draft.editing;
  area.setSelectionRange(draft.start, draft.end);
  autoGrow(area);
  // And the completion list with it: it is derived from the caret, so restoring one without the
  // other leaves the box looking right and the suggestions gone.
  if (hints && lastDeps) slashHints(hints, area, lastDeps);
}

function composer(state: UiState, deps: ChatDeps): HTMLElement {
  lastDeps = deps;
  const wrap = el("div", "composer");
  const card = el("div", "composer-card");

  if (state.attachments.length) {
    const chips = el("div", "chips attached");
    for (const a of state.attachments) {
      const chip = el("span", "chip removable", `${a.label}`);
      chip.title = `${a.kind} · ~${formatTokens(a.tokens)} jetons`;
      chip.append(
        button({
          icon: ICON.close,
          title: t("Remove"),
          className: "btn chip-x",
          onClick: () => deps.send({ type: "removeAttachment", label: a.label }),
        }),
      );
      chips.append(chip);
    }
    card.append(chips);
  }

  const area = el("textarea", "composer-input");
  area.rows = 2;
  area.placeholder =
    state.mode === "agent"
      ? t("Describe the change. “#” attaches a file, “/” opens the commands.")
      : state.mode === "plan"
        ? t("Describe what to investigate. Hivey Code will read the repository without changing anything.")
        : t("Ask your question. Attach the context you need: this mode does not read the repository.");
  area.addEventListener("input", () => {
    autoGrow(area);
    // `#` used to be swallowed and replaced by a file dialog. It now stays in the text and opens
    // the completion list, which is both what Copilot does and what lets `#changes` exist at all:
    // a dialog can only ever offer files.
    slashHints(hints, area, deps);
  });
  area.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      submit(area, deps);
    }
    if (ev.key === "Escape") {
      delete area.dataset["editing"];
      area.value = "";
      autoGrow(area);
      hints.textContent = "";
    }
  });
  card.append(area);

  const hints = el("div", "slash-hints");
  card.append(hints);

  // One row that wraps, rather than two that always exist. On a panel docked at 400 px everything
  // fits on a line, which is what the editor's own chat does and what stops the composer looking
  // like a form; at 260 px the same row wraps and the send button stays pinned to the right of
  // whatever line it lands on. Two hard-coded rows got the narrow case right and the normal one
  // wrong.
  const bar = el("div", "composer-toolbar");
  const left = el("div", "toolbar-group");
  // `contextButton` is icon-only: at the side bar's default width every character it spends on the
  // word "Context" is a character the model name loses, and the model name is the one label in the
  // row that carries information the user cannot guess from the icon.
  left.append(contextButton(state, deps), modeButton(state, deps), modelButton(state, deps));
  if (state.reasoningAvailable) left.append(reasoningButton(state, deps));
  bar.append(left);

  const right = el("div", "toolbar-group end");
  right.append(
    isStreaming()
      ? button({ icon: ICON.stop, title: t("Stop the answer"), className: "btn primary send", onClick: () => deps.send({ type: "stop" }) })
      : button({ icon: ICON.send, title: t("Send (⏎)"), className: "btn primary send", onClick: () => submit(area, deps) }),
  );
  bar.append(right);
  card.append(bar);

  // The meter sits ABOVE the box, on the panel's own background — not inside the border. Inside it,
  // it still read as part of the field you type into, which is exactly what it should not be: it is
  // a reading about the conversation, not a control of the message.
  const meter = el("div", "composer-meter");
  const tokens = el("span", "composer-tokens", t("{0} tokens", formatTokens(state.contextTokens)));
  tokens.title = t("What the next question will send, once muted exchanges are removed.");
  meter.append(tokens);
  wrap.append(meter, card);
  // Size the box to its content on first paint, not only after the first keystroke.
  requestAnimationFrame(() => autoGrow(area));
  return wrap;
}

function autoGrow(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  const height = Math.min(220, Math.max(46, area.scrollHeight));
  area.style.height = `${height}px`;
  // The scrollbar only appears once the box has stopped growing.
  area.style.overflowY = area.scrollHeight > 220 ? "auto" : "hidden";
}

let streaming = false;
export function setStreaming(value: boolean): void {
  streaming = value;
}
export function isStreaming(): boolean {
  return streaming;
}

function contextButton(state: UiState, deps: ChatDeps): HTMLElement {
  const b = button({
    icon: ICON.attach,
    title: t("Add context to the next question"),
    className: "btn ghost icon-only",
    onClick: () =>
      menu(b, (close) => {
        const panel = el("div", "menu-list");
        panel.append(menuTitle(t("Add to the context")));
        // Two entries where there used to be one, because "the open file" and "the selection" are
        // two different things and the old entry silently chose between them. With three lines
        // highlighted there was no way to attach the file they live in — the case where you most
        // want to. Both are named after what the editor is actually showing, so neither is a guess.
        const active = state.activeEditor;
        if (active?.hasSelection) {
          panel.append(
            menuItem({
              label: t("Selection"),
              detail: `${active.selectedLines} ${active.selectedLines === 1 ? t("line") : t("lines")}`,
              hint: active.path,
              onClick: () => {
                deps.send({ type: "attach", what: "selection" });
                close();
              },
            }),
          );
        }
        panel.append(
          menuItem({
            // `#editor` in the composer, and this in the menu: the same thing reached two ways.
            label: t("Whole file"),
            hint: active ? active.path : t("The file open in the editor"),
            onClick: () => {
              deps.send({ type: "attach", what: "editor" });
              close();
            },
          }),
          menuItem({
            label: t("Pick a file…"),
            hint: t("VS Code's own picker, with fuzzy search"),
            onClick: () => {
              deps.send({ type: "attach", what: "mention" });
              close();
            },
          }),
          menuItem({
            label: t("Import a file…"),
            hint: t("From disk, even outside the workspace"),
            onClick: () => {
              deps.send({ type: "attach", what: "browse" });
              close();
            },
          }),
        );

        if (state.openFiles.length) {
          panel.append(separator(), menuTitle(t("Open tabs ({0})", state.openFiles.length)));
          // First, and named for what it does. It was below the per-file list, where the only
          // people who found it were the ones already scrolling past twelve file names — which is
          // to say, the ones who no longer needed it.
          panel.append(
            menuItem({
              label: t("Attach all {0} open files", state.openFiles.length),
              hint: t("Everything open in a tab right now, ~{0} tokens", formatTokens(estimateOpenFiles(state))),
              onClick: () => {
                deps.send({ type: "attach", what: "openFiles" });
                close();
              },
            }),
          );
          for (const f of state.openFiles.slice(0, 12)) {
            panel.append(
              menuItem({
                label: f.path,
                detail: f.active ? t("active") : f.dirty ? t("edited") : "",
                onClick: () => {
                  deps.send({ type: "attachPath", path: f.path });
                  close();
                },
              }),
            );
          }
        }
        return panel;
      }),
  });
  return b;
}

function modeButton(state: UiState, deps: ChatDeps): HTMLElement {
  const current = MODES.find((m) => m.id === state.mode) ?? MODES[2]!;
  const b = button({
    label: current.label,
    trailingIcon: ICON.chevron,
    title: t("Mode: {0}", current.hint),
    className: `btn ghost mode mode-${state.mode}`,
    onClick: () =>
      menu(b, (close) => {
        const panel = el("div", "menu-list");
        panel.append(menuTitle(t("What Hivey Code is allowed to do")));
        for (const m of MODES) {
          panel.append(
            menuItem({
              label: m.label,
              hint: m.hint,
              selected: m.id === state.mode,
              onClick: () => {
                deps.send({ type: "setMode", mode: m.id });
                close();
              },
            }),
          );
        }
        panel.append(
          separator(),
          menuItem({
            label: t("Agent permissions…"),
            hint: t("What runs without asking"),
            onClick: () => {
              deps.send({ type: "openScreen", screen: "permissions" });
              close();
            },
          }),
        );
        return panel;
      }),
  });
  return b;
}

function modelButton(state: UiState, deps: ChatDeps): HTMLElement {
  const b: HTMLElement = button({
    label: state.modelLabel,
    trailingIcon: ICON.chevron,
    title: state.remote
      ? t("Remote model — it is billed, and what you send is pseudonymised first.")
      : t("Local model — nothing leaves this machine."),
    className: `btn ghost model${state.remote ? " remote" : " local"}`,
    onClick: () => {
      closeMenu();
      if (isModelComboOpen()) closeModelCombo();
      else openModelCombo(b, state, deps.send);
    },
  });
  return b;
}

function reasoningButton(state: UiState, deps: ChatDeps): HTMLElement {
  const current = REASONING.find((r) => r.id === state.reasoning) ?? REASONING[0]!;
  const b = button({
    label: current.label,
    trailingIcon: ICON.chevron,
    title: t("Reasoning: {0}", current.hint),
    className: `btn ghost reasoning${state.reasoning === "none" ? "" : " active"}`,
    onClick: () =>
      menu(b, (close) => {
        const panel = el("div", "menu-list");
        panel.append(menuTitle(t("Thinking budget")));
        for (const r of REASONING) {
          panel.append(
            menuItem({
              label: r.label,
              hint: r.hint,
              selected: r.id === state.reasoning,
              onClick: () => {
                deps.send({ type: "setReasoning", reasoning: r.id });
                close();
              },
            }),
          );
        }
        return panel;
      }),
  });
  return b;
}

const SLASH: Array<{ name: string; hint: string; prompt: string; attach?: boolean }> = [
  { name: t("/explain"), hint: t("explain the file or the selection"), prompt: t("Explain this code: what it does, how it fits into the rest, and what deserves attention."), attach: true },
  { name: "/tests", hint: t("write tests"), prompt: t("Write tests for this code, in the style and with the tools already used in this repository. Cover the edge cases."), attach: true },
  { name: t("/fix"), hint: t("find and fix the problem"), prompt: t("Find the defect in this code and fix it. Say in one sentence what was wrong."), attach: true },
  { name: t("/review"), hint: t("review: bugs, security, readability"), prompt: t("Review this code: bugs first, then security, then readability. Order by severity, cite the lines, and report nothing you are unsure of."), attach: true },
  { name: "/doc", hint: t("document"), prompt: t("Document this code: a note above it, in the language and style of the file."), attach: true },
  { name: t("/optimise"), hint: t("make it faster, without changing what it does"), prompt: t("Make this code faster without changing its behaviour. Say what the cost was before and after, and refuse if the gain is not worth the loss of clarity."), attach: true },
  { name: "/commit", hint: t("write the commit message"), prompt: t("Read the staged changes with git_diff and write the commit message for them. Subject line, then the why.") },
  // IBM i. `/tofree` is the one an RPG shop reaches for daily, and the reason the dialect rules in
  // core exist: converting fixed to free is exactly where a model that guesses columns fails.
  { name: "/tofree", hint: t("convert fixed-format RPG to fully free"), prompt: t("Convert this member to fully free-form RPGLE. Start the result with **FREE, use dcl-f/dcl-s/dcl-ds/dcl-proc, keep every comment, and change no behaviour. Point out anything that has no free-form equivalent instead of inventing one."), attach: true },
  { name: "/sql", hint: t("write it as Db2 for i SQL"), prompt: t("Write this as Db2 for i SQL. Qualify the objects, use FETCH FIRST rather than LIMIT, and say which library list the unqualified names would resolve against."), attach: true },
  { name: "/dds", hint: t("explain this DDS"), prompt: t("Explain this DDS member: the record formats, the key fields, the keywords that change behaviour, and anything that would surprise someone reading it for the first time."), attach: true },
];

/** The `#` notations, offered as the user types. Kept in step with the parser by a test. */
const MENTIONS: Suggestion[] = [
  { token: "#file:", hint: t("a file by path"), complete: "#file:" },
  { token: "#selection", hint: t("what is selected in the editor"), complete: "#selection " },
  { token: "#editor", hint: t("the whole active file"), complete: "#editor " },
  { token: "#openFiles", hint: t("every file open in a tab"), complete: "#openFiles " },
  { token: "#codebase", hint: t("the repository map"), complete: "#codebase " },
  { token: "#changes", hint: t("the uncommitted diff"), complete: "#changes " },
  { token: "#problems", hint: t("the errors and warnings from the language servers"), complete: "#problems " },
  { token: "#terminal", hint: t("what is selected in the terminal"), complete: "#terminal " },
  { token: "#sym:", hint: t("a symbol by name"), complete: "#sym:" },
  { token: "#member:", hint: t("an IBM i source member — LIB/SRCFILE(MEMBER)"), complete: "#member:" },
  { token: "#db2:", hint: t("the result of a Db2 for i query that reads"), complete: "#db2:" },
];

const PARTICIPANTS: Suggestion[] = [
  { token: "@workspace", hint: t("the repository: search it before answering"), complete: "@workspace " },
  { token: "@editor", hint: t("the file on screen and the editor's state"), complete: "@editor " },
  { token: "@terminal", hint: t("the last command and what it printed"), complete: "@terminal " },
  { token: "@git", hint: t("the working tree, the history, the blame"), complete: "@git " },
  { token: "@ibmi", hint: t("the partition: Db2 for i, members, objects"), complete: "@ibmi " },
  { token: "@arcad", hint: t("ARCAD Elias: components, versions, cross-references"), complete: "@arcad " },
];

/**
 * The completion list under the composer: `/` commands, `#` context, `@` participants.
 *
 * All three share one list because they share one job — telling the user what they may type — and
 * because a panel that pops a different widget per prefix feels like three features rather than
 * one. The word under the caret decides which set is offered, so `#` works mid-sentence, which is
 * where people actually reach for it.
 */
function slashHints(container: HTMLElement, area: HTMLTextAreaElement, deps: ChatDeps): void {
  container.textContent = "";
  const query = { value: area.value, caret: area.selectionStart ?? area.value.length };
  const rows = suggestionsFor(query, {
    slash: SLASH.map((c) => ({ name: c.name, hint: c.hint })),
    mentions: MENTIONS,
    participants: PARTICIPANTS,
  });

  for (const entry of rows.slice(0, 8)) {
    const row = el("button", "slash-hint");
    row.append(el("span", "slash-name", entry.token));
    row.append(el("span", "slash-hint-text", entry.hint));
    // `mousedown`, not `click`: the click arrives after focus has moved and after anything the blur
    // set off, by which time this row may no longer be in the document. That is why the list looked
    // as though it vanished the moment you reached for it.
    row.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      const applied = applySuggestion(query, entry);
      area.value = applied.value;
      area.focus();
      area.setSelectionRange(applied.caret, applied.caret);
      slashHints(container, area, deps);
    });
    container.append(row);
  }
}

function expandSlash(text: string): { text: string; attach: boolean } | undefined {
  const match = SLASH.find((c) => text === c.name || text.startsWith(`${c.name} `));
  if (!match) return undefined;
  const extra = text.slice(match.name.length).trim();
  return { text: extra ? `${match.prompt}\n\n${extra}` : match.prompt, attach: match.attach ?? false };
}

function submit(area: HTMLTextAreaElement, deps: ChatDeps): void {
  let text = area.value.trim();
  if (!text || isStreaming()) return;
  const editing = area.dataset["editing"];
  const expanded = expandSlash(text);
  if (expanded) {
    text = expanded.text;
    if (expanded.attach) deps.send({ type: "attach", what: "active" });
  }
  area.value = "";
  autoGrow(area);
  if (editing) {
    delete area.dataset["editing"];
    deps.send({ type: "editEntry", id: editing, text });
    return;
  }
  deps.send({ type: "send", text });
}

/**
 * Roughly what attaching every open tab would cost.
 *
 * The panel does not have the files' contents — only their paths — so this cannot be measured, only
 * estimated: a middling source file is a few hundred lines, and four characters make a token. The
 * number is there to separate "three small files" from "the whole codebase", which is the only
 * distinction the user needs before clicking. It is prefixed with ~ for that reason.
 */
function estimateOpenFiles(state: UiState): number {
  return state.openFiles.length * 1200;
}
