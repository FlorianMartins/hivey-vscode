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
import type { Mode, Reasoning, ToExtension, UiEntry, UiSkill, UiState } from "../shared/protocol.js";
import { applySuggestion, suggestionsFor, type Suggestion } from "../core/session/mentions.js";
import { BUILTIN_SKILLS, type BuiltinSkill } from "../core/session/skills.js";
import { planComplete, planSummary, type Plan } from "../core/agent/plan.js";

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
  // The transcript sits in its own positioned box so the "latest" button can float at the BOTTOM
  // OF THE TRANSCRIPT — which is the gap between the last answer and the composer, wherever the
  // composer happens to end up. Pinning it to the screen with a hand-measured offset put it inside
  // the composer the moment the composer grew a row.
  const area = el("div", "transcript-wrap");
  area.append(transcript(state, deps));
  wrap.append(area, composer(state, deps));
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

  // The way back to before this question: a rule across the transcript with the action on it,
  // ABOVE the question rather than in the hover row below it. The position is the meaning — a line
  // drawn between two turns is a place in the conversation you can return to, which is exactly what
  // a checkpoint is. As a small icon among mute, pin, copy and delete it read as a fifth thing you
  // could do to a message, and the one action there that changes files on disk should not be the
  // hardest of the five to notice.
  if (entry.role === "user" && entry.checkpointFiles) {
    wrap.append(checkpointRule(entry, deps));
  }

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

  // Under the message, not beside the name. In the header they competed with the model name and the
  // cost for a row that is already tight at a docked width, and they were the only thing there that
  // was not information — a row of controls reads as chrome and pushes what you came to read down.
  // Below the message they sit where the eye already is when it has finished reading, and they are
  // revealed on hover so a quiet transcript stays quiet.
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

  // The plan first, above the answer: it is the summary of what was done, and someone re-reading a
  // turn wants the shape of it before the prose.
  if (entry.plan) wrap.append(planBlock(entry.plan, false));
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
        onInsertAtCursor: (code) => deps.send({ type: "insertCode", code, atCursor: true }),
          onApply: (code, language) => deps.send({ type: "applyCode", code, language }),
        },
        state.searchQuery || undefined,
      ),
    );
  }
  wrap.append(actions);
  return wrap;
}

/**
 * The agent's to-do list, collapsed to the one line that matters.
 *
 * A plan of nine steps printed in full is a wall that pushes the answer off the screen, and by the
 * end every line says "done" — which is a receipt, not a progress display. So what shows is the
 * step happening NOW and a count of what is left; the whole list is one click away for anyone who
 * wants it.
 *
 * It opens by default while the turn is running and closes once everything is done, because those
 * are the two moments the reader's question changes: "what is it doing" becomes "what did it do".
 */
export function planBlock(plan: Plan, live: boolean): HTMLElement {
  const summary = planSummary(plan);
  const complete = planComplete(plan);
  const wrap = el("div", `plan${complete ? " complete" : ""}${live ? " live" : ""}`);

  const head = el("button", "plan-head");
  head.append(icon("chevron", "plan-chevron"));

  const title = el("div", "plan-title");
  // The current step is the headline. With none — a finished plan — the headline is the outcome.
  title.append(
    el("span", "plan-label", complete ? t("Plan") : summary.current ? summary.current.title : t("Plan")),
  );
  head.append(title);
  head.append(
    el(
      "span",
      "plan-count",
      complete ? t("{0} steps", summary.total) : t("{0}/{1}", summary.done, summary.total),
    ),
  );

  const list = el("div", "plan-steps");
  for (const step of plan.steps) {
    const row = el("div", `plan-step ${step.state}`);
    row.append(el("span", "plan-mark", MARKS[step.state]));
    row.append(el("span", "plan-step-title", step.title));
    list.append(row);
  }

  // Open while it is happening, shut once it is history.
  list.hidden = complete;
  wrap.classList.toggle("open", !complete);
  head.addEventListener("click", () => {
    list.hidden = !list.hidden;
    wrap.classList.toggle("open", !list.hidden);
  });

  wrap.append(head, list);
  return wrap;
}

/** Two glyphs and a spinner's worth of meaning, with no font to load. */
const MARKS: Record<string, string> = {
  pending: "\u25CB",
  running: "\u25D4",
  done: "\u25CF",
  skipped: "\u2013",
};

/**
 * The line between two turns that you can go back to.
 *
 * A horizontal rule with the action sitting on it, the way the editor's chat marks a restore point.
 * It is visible without hovering — unlike everything else attached to a message — because it is the
 * only one that puts files back, and something that overwrites the working tree should never be
 * discovered by accident.
 */
function checkpointRule(entry: UiEntry, deps: ChatDeps): HTMLElement {
  const wrap = el("div", "checkpoint-rule");
  const action = button({
    icon: ICON.restore,
    label: t("Restore checkpoint"),
    className: "btn tiny checkpoint-btn",
    title: entry.checkpointPartial
      ? t("Restore {0} file(s) — some changes were too large to record", entry.checkpointFiles ?? 0)
      : t("Put the {0} file(s) this turn changed back, and rewind the conversation here", entry.checkpointFiles ?? 0),
    onClick: () => deps.send({ type: "restoreCheckpoint", id: entry.id }),
  });
  if (entry.checkpointPartial) action.classList.add("partial");
  wrap.append(action);
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
  // The working state lives on the composer rather than on the transcript because that is where the
  // user is looking while they wait — and because it is the control that is unavailable, which is
  // the thing the animation is actually telling them.
  const wrap = el("div", `composer${isStreaming() ? " working" : ""}`);
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
  // Two rows and a comfortable line height, rather than three. Three was a paragraph of empty box
  // on a screen where most questions are one line, and the box grows as you type anyway.
  area.rows = 2;
  // Short. The old ones explained the mode in a full sentence — beside a button that names the
  // mode — and wrapped onto three lines in a docked panel, so the empty box was the noisiest thing
  // on the screen. A placeholder is read once and then in the way for ever.
  area.placeholder =
    state.mode === "agent"
      ? t("Describe the change…")
      : state.mode === "plan"
        ? t("What should I investigate?")
        : t("Ask a question…");
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
  // Four controls, the same four the editor's own chat puts here: what to attach, how it is
  // configured, what it is allowed to do, and which model answers. Skills and approvals were two
  // separate buttons for about an hour, and the cost was immediate and measurable — the model name
  // collapsed to "qwe…" because every icon in this row is width the one label carrying real
  // information does not have. Copilot has one configure affordance for the same reason.
  left.append(contextButton(state, deps), toolsButton(state, deps), modeButton(state, deps), modelButton(state, deps));
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
  const meter = el("div", "composer-footer");
  // What the session runs on, and how much of it runs without asking. Both belong OUTSIDE the box:
  // they are settings for the conversation, not parts of the message being written, and inside the
  // border they read as controls of the text. The editor's own chat makes the same split.
  meter.append(providerButton(state, deps), approvalButton(state, deps));
  meter.append(el("div", "spacer"));
  const tokens = el("span", "composer-tokens", t("{0} tokens", formatTokens(state.contextTokens)));
  tokens.title = t("What the next question will send, once muted exchanges are removed.");
  // A bar rather than a percentage, and only once there is something to watch. At 3 % it drew a
  // green dot at the end of a grey line — which reads as a rendering fault, not as a measurement,
  // and put a permanent smudge above the composer for the first twenty exchanges of every
  // conversation. Below a fifth the token count alone says everything true.
  if (state.contextFill >= 0.2) {
    const gauge = el("div", "composer-gauge");
    const fill = el("div", `composer-gauge-fill${state.contextFill > 0.85 ? " high" : state.contextFill > 0.6 ? " warm" : ""}`);
    fill.style.width = `${Math.round(state.contextFill * 100)}%`;
    gauge.append(fill);
    gauge.title = t("{0}% of the context budget", Math.round(state.contextFill * 100));
    meter.append(gauge);
  }
  meter.append(tokens);
  // The two numbers anyone actually watches, on one line: how much of the context the next question
  // will use, and what this conversation has cost so far. The day's total lives in the cost report,
  // where it can be broken down; here what matters is the conversation in front of you.
  //
  // Hidden entirely on a local model with nothing spent — a figure that is structurally zero is not
  // a reading, it is a decoration that teaches people to ignore the row it sits in.
  if (state.sessionCostUsd > 0 || state.remote) {
    meter.append(el("span", "composer-sep", "\u2022"));
    const cost = el("span", "composer-cost", formatCost(state.sessionCostUsd));
    cost.title = t("What this conversation has cost. Today's total is in the cost report.");
    meter.append(cost);
  }
  const offer = state.suggestCompact ? compactOffer(state, deps) : undefined;
  if (offer) wrap.append(offer);
  wrap.append(card, meter);
  // Size the box to its content on first paint, not only after the first keystroke.
  requestAnimationFrame(() => autoGrow(area));
  return wrap;
}

/**
 * The token count at which the user last said "not now".
 *
 * Dismissing has to mean something, and "never again in this conversation" is the wrong meaning:
 * the conversation keeps growing, and the offer is worth making again when it has grown
 * materially. So the dismissal remembers the size it was dismissed at, and the offer returns once
 * the conversation is a third larger than that. It is not persisted — a dismissal is about the
 * moment, not about the conversation.
 */
let compactDismissedAt: number | undefined;

function compactOffer(state: UiState, deps: ChatDeps): HTMLElement | undefined {
  // Nothing at all rather than something hidden: an empty element with a margin is still a gap the
  // reader can see, and "hidden" is the state a debugger has to explain later.
  if (compactDismissedAt !== undefined && state.contextTokens < compactDismissedAt * 1.33) return undefined;

  const wrap = el("div", "compact-offer");
  wrap.append(icon("sparkle", "compact-ico"));
  const body = el("div", "compact-body");
  body.append(el("div", "compact-title", t("This conversation fills {0}% of the context.", Math.round(state.contextFill * 100))));
  // Says what it does to the transcript, because "compact" alone reads as "delete". Nothing is
  // deleted, and that is the first thing anyone wants to know before pressing it.
  body.append(el("div", "compact-hint", t("Summarising replaces it in the prompt. Nothing leaves the screen.")));
  wrap.append(body);

  wrap.append(
    button({
      label: t("Summarise"),
      className: "btn tiny primary",
      onClick: () => {
        compactDismissedAt = undefined;
        deps.send({ type: "compact" });
      },
    }),
    button({
      icon: ICON.close,
      title: t("Not now"),
      className: "btn icon-only",
      onClick: () => {
        compactDismissedAt = state.contextTokens;
        deps.rerender();
      },
    }),
  );
  return wrap;
}

/**
 * A cost, at the precision the number deserves.
 *
 * Four decimals on a conversation that has cost eight cents is four characters of noise; two
 * decimals on one that has cost a fraction of a cent rounds it to zero, which is a different claim
 * from "almost nothing". The precision follows the amount.
 */
function formatCost(usd: number): string {
  if (usd <= 0) return "0 $";
  if (usd < 0.01) return `${usd.toFixed(4)} $`;
  if (usd < 1) return `${usd.toFixed(3)} $`;
  return `${usd.toFixed(2)} $`;
}

function autoGrow(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  // The floor matches the stylesheet's `min-height`. Two numbers for one decision is how a box
  // ends up snapping to a different size the moment somebody types into it.
  const height = Math.min(260, Math.max(54, area.scrollHeight));
  area.style.height = `${height}px`;
  // The scrollbar only appears once the box has stopped growing.
  area.style.overflowY = area.scrollHeight > 260 ? "auto" : "hidden";
}

let streaming = false;
export function setStreaming(value: boolean): void {
  streaming = value;
}
export function isStreaming(): boolean {
  return streaming;
}

/**
 * Adding context.
 *
 * One line, because the picker is the editor's own. A menu drawn in the webview could not offer
 * what the workbench offers — its icon set, its separators, type-ahead across categories, keyboard
 * navigation people already have in their fingers — and was one more surface behaving almost, but
 * not quite, like everything around it.
 */
function contextButton(state: UiState, deps: ChatDeps): HTMLElement {
  return button({
    icon: ICON.attach,
    title: t("Add context to the next question"),
    className: "btn ghost icon-only",
    onClick: () => deps.send({ type: "openContextPicker" }),
  });
}

/** Which skills are offered, in the editor's own multi-select picker. */
function toolsButton(state: UiState, deps: ChatDeps): HTMLElement {
  const off = state.skills.filter((sk) => !sk.enabled).length;
  return button({
    icon: ICON.tools,
    title: off ? t("Skills — {0} switched off", off) : t("Configure skills…"),
    className: `btn ghost icon-only${off ? " has-off" : ""}`,
    onClick: () => deps.send({ type: "openToolsPicker" }),
  });
}

/**
 * `short` is what fits on the button, `label` is what the menu says.
 *
 * One word each, because the row under the composer holds three things and a docked side bar is
 * 280 px wide: "Ask every time" truncated to "Ask ever…", which is worse than a word that fits.
 * The full phrasing lives one hover and one click away, where there is room for it.
 */
const SCOPES: Array<{ id: UiState["policy"]["scope"]; short: string; label: string; hint: string }> = [
  { id: "off", short: t("Ask"), label: t("Ask every time"), hint: t("Every change and every command is approved by you.") },
  { id: "workspace", short: t("Folder"), label: t("Inside this folder"), hint: t("Edits in the open folder run; commands are still asked.") },
  { id: "all", short: t("Auto"), label: t("Never ask"), hint: t("Everything runs, anywhere on this machine.") },
];

const PROVIDERS: Array<{ id: string; short: string; label: string; hint: string }> = [
  { id: "local", short: t("Local"), label: t("On this machine"), hint: t("Nothing leaves, nothing is billed, it works offline.") },
  { id: "openrouter", short: "OpenRouter", label: "OpenRouter", hint: t("Four hundred models behind one key, billed per token.") },
  { id: "anthropic", short: "Anthropic", label: "Anthropic", hint: t("Claude, billed directly, with prompt caching.") },
  { id: "openai-compatible", short: t("Gateway"), label: t("Your own gateway"), hint: t("Azure, LiteLLM, a company proxy — any OpenAI API.") },
];

/**
 * Where the answer comes from: this machine, or a gateway.
 *
 * A switch rather than a settings page, because it is a decision people make several times a day —
 * a local model for the ordinary work, something larger for the one hard question — and a decision
 * made that often has to be one click from the box you type in.
 *
 * The label says which, and the colour says whether anything leaves the machine. That second fact
 * is the whole argument of this extension and it should never take reading to establish.
 */
function providerButton(state: UiState, deps: ChatDeps): HTMLElement {
  const current = PROVIDERS.find((p) => p.id === state.provider) ?? PROVIDERS[0]!;
  const b = button({
    icon: ICON.chip,
    label: state.remote ? current.short : t("Local"),
    trailingIcon: ICON.chevron,
    title: state.remote
      ? t("{0} — what leaves is pseudonymised first", current.label)
      : t("Runs on this machine: nothing leaves, nothing is billed"),
    className: `btn ghost tiny provider${state.remote ? " remote" : " local"}`,
    onClick: () =>
      menu(b, (close) => {
        const panel = el("div", "menu-list");
        panel.append(menuTitle(t("Where the answer comes from")));
        for (const p of PROVIDERS) {
          panel.append(
            menuItem({
              label: p.label,
              hint: p.hint,
              selected: p.id === state.provider,
              onClick: () => {
                deps.send({ type: "setProvider", provider: p.id });
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

/** How much runs without asking. Outside the box, next to what the answer runs on. */
function approvalButton(state: UiState, deps: ChatDeps): HTMLElement {
  const scope = state.policy.scope;
  const current = SCOPES.find((sc) => sc.id === scope) ?? SCOPES[0]!;
  const b = button({
    icon: ICON.shield,
    label: current.short,
    trailingIcon: ICON.chevron,
    title: t("Approvals: {0}", current.hint),
    className: `btn ghost tiny approval-scope perm-scope-${scope}`,
    onClick: () =>
      menu(b, (close) => {
        const panel = el("div", "menu-list");
        panel.append(menuTitle(t("What runs without asking")));
        for (const sc of SCOPES) {
          panel.append(
            menuItem({
              label: sc.label,
              hint: sc.hint,
              selected: sc.id === scope,
              onClick: () => {
                deps.send({ type: "setApprovalScope", scope: sc.id });
                close();
              },
            }),
          );
        }
        panel.append(separator());
        panel.append(el("div", "menu-note", t("Protected files are never touched, whatever this is set to.")));
        panel.append(
          menuItem({
            label: t("Allowed and denied lists…"),
            hint: t("Name the paths and commands yourself"),
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
    title:
      `${state.model}\n` +
      (state.remote
        ? t("Remote model — it is billed, and what you send is pseudonymised first.")
        : t("Local model — nothing leaves this machine.")),
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

/**
 * The built-in skills, as the composer needs them.
 *
 * The table itself lives in core — the extension has to know it too, in order to persist which
 * ones are switched off — so what is left here is the one thing that is genuinely about the panel:
 * turning a skill's declared `action` into a message on the wire.
 */
function actionMessage(action: NonNullable<BuiltinSkill["action"]>): ToExtension {
  switch (action) {
    case "compact":
      return { type: "compact" };
  }
}

/** The skills on offer right now: the built-in ones the user has left on. */
function enabledSkills(state: UiState): BuiltinSkill[] {
  const off = new Set(state.skills.filter((sk) => sk.builtin && !sk.enabled).map((sk) => sk.name));
  return BUILTIN_SKILLS.filter((sk) => !off.has(sk.name));
}

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
  const state = deps.state();
  // A skill the user switched off is not offered, and — below, in `matchSlash` — not expanded
  // either. Hiding it from the list while still honouring it when typed would make the switch a
  // decoration.
  const available = state ? enabledSkills(state) : BUILTIN_SKILLS;
  const repoSkills = (state?.skills ?? [])
    .filter((sk) => !sk.builtin && sk.enabled)
    .map((sk) => ({ name: sk.name, hint: sk.description }));
  const rows = suggestionsFor(query, {
    slash: [...available.map((c) => ({ name: c.name, hint: c.hint })), ...repoSkills],
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

function matchSlash(text: string, state?: UiState): BuiltinSkill | undefined {
  const available = state ? enabledSkills(state) : BUILTIN_SKILLS;
  return available.find((c) => text === c.name || text.startsWith(`${c.name} `));
}

function expandSlash(text: string, state?: UiState): { text: string; attach: boolean } | undefined {
  const match = matchSlash(text, state);
  if (!match?.prompt) return undefined;
  const extra = text.slice(match.name.length).trim();
  return { text: extra ? `${match.prompt}\n\n${extra}` : match.prompt, attach: match.attach ?? false };
}

function submit(area: HTMLTextAreaElement, deps: ChatDeps): void {
  let text = area.value.trim();
  if (!text || isStreaming()) return;
  // A command that acts on the conversation clears the box and does its thing. It deliberately
  // does not go through the editing path below: `/compact` typed while editing an old message is a
  // command, not a replacement for that message.
  const state = deps.state();
  const command = matchSlash(text, state);
  if (command?.action) {
    area.value = "";
    delete area.dataset["editing"];
    autoGrow(area);
    deps.send(actionMessage(command.action));
    return;
  }
  const editing = area.dataset["editing"];
  const expanded = expandSlash(text, state);
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
