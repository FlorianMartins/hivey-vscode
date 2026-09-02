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
  // The guided start replaces the welcome, and both replace nothing: neither is a message, and when
  // the first question is asked they are simply not drawn again.
  if (state.wizard) {
    list.append(wizardCard(state, state.wizard, deps));
    return list;
  }
  if (!state.session.entries.length) {
    list.append(welcome(state, deps));
    return list;
  }
  const matches = new Set(state.matches);
  let first = true;
  for (const entry of state.session.entries) {
    if (state.searchQuery && !matches.has(entry.id)) continue;
    // The rule belongs to the transcript, not to either message it separates — it is emitted
    // between them rather than inside the question, so that a pinned answer's tint and a muted
    // turn's fade stop at the message and do not swallow the way back out of it.
    if (!first && entry.role === "user") list.append(turnRule(entry, deps));
    list.append(renderEntry(entry, state, deps));
    first = false;
  }
  if (state.searchQuery && !matches.size) {
    list.append(el("p", "empty", t("No message contains “{0}”.", state.searchQuery)));
  }
  return list;
}

/**
 * An empty conversation.
 *
 * It held three mode cards, a family chooser and a list of tips — a screen of decisions in answer
 * to someone who has just pressed "new conversation" and wants to type. Every one of those choices
 * is still available: the mode and the model are in the composer below, and the families are behind
 * the `+`'s other entry, which exists precisely so this screen does not have to ask.
 *
 * What is left is the mark and the one line that changes: whether anything will leave the machine.
 */
function welcome(state: UiState, deps: ChatDeps): HTMLElement {
  const w = el("div", "welcome");
  w.append(hiveyMark());
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
  return w;
}

/**
 * The hexagon, drawn rather than shipped as an image.
 *
 * A `<img>` would need a source in the panel's content policy, which forbids remote origins for
 * good reasons and would have to be widened for a decoration. An inline path costs nothing, scales,
 * and takes the theme's own foreground.
 */
function hiveyMark(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", "44");
  svg.setAttribute("height", "44");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "welcome-mark");
  for (const [d, width, opacity] of [
    ["M24 4 41 14v20L24 44 7 34V14Z", "2", "1"],
    ["M24 16 32 20.5v9L24 34l-8-4.5v-9Z", "1.6", "0.55"],
  ] as const) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", width);
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("opacity", opacity);
    svg.append(path);
  }
  return svg;
}

/**
 * The guided start: three questions, then the floor.
 *
 * One question per screen rather than a form with three sections, because each answer narrows the
 * next: the families you pick decide which skills are offered, and offering all seventy up front is
 * the thing this exists to avoid. The steps are drawn from state and are not messages — when the
 * first real question is asked they are gone, and the conversation looks like any other.
 */
function wizardCard(state: UiState, wizard: NonNullable<UiState["wizard"]>, deps: ChatDeps): HTMLElement {
  const wrap = el("div", "wizard");

  const head = el("div", "wizard-head");
  const steps = ["mode", "family", "skills", "ready"] as const;
  const at = steps.indexOf(wizard.step);
  head.append(el("span", "wizard-step", t("Step {0} of 3", Math.min(at + 1, 3))));
  head.append(el("div", "spacer"));
  // A cross, not the word "Skip". "Skip" reads as "skip this step" beside a Next button, when what
  // it does is abandon the whole guided start — and on the last screen there is no step left to
  // skip, which made it meaningless exactly where it was most likely to be pressed.
  head.append(
    button({
      icon: ICON.close,
      className: "btn icon-only",
      title: t("Close and carry on in an ordinary conversation"),
      onClick: () => deps.send({ type: "wizardCancel" }),
    }),
  );
  wrap.append(head);

  if (wizard.step === "mode") {
    wrap.append(el("h2", "wizard-title", t("What may Hivey Code do?")));
    wrap.append(el("p", "wizard-lede", t("This decides which tools exist for the whole conversation, not how it is asked.")));
    const cards = el("div", "welcome-cards");
    for (const m of MODES) {
      const card = el("button", "welcome-card");
      card.append(el("span", "welcome-card-title", m.label));
      card.append(el("span", "welcome-card-hint", m.hint));
      card.addEventListener("click", () => deps.send({ type: "wizardAnswer", step: "mode", value: [m.id] }));
      cards.append(card);
    }
    wrap.append(cards);
    return wrap;
  }

  if (wizard.step === "family") {
    wrap.append(el("h2", "wizard-title", t("What is this about?")));
    wrap.append(el("p", "wizard-lede", t("Pick the areas you are working in. It decides which skills you are offered next — nothing is sent to ask it.")));
    const chosen = new Set(wizard.families);

    // A list with room to read, not a row of chips.
    //
    // Eighteen families as chips is eighteen words in a paragraph shape: you cannot see what any of
    // them covers, and the one thing that would help — how many skills are behind each — has
    // nowhere to go. As rows, each carries its subject, its examples and its count, which is the
    // whole basis on which the choice is made.
    const list = el("div", "wizard-families");
    for (const group of state.skillGroups) {
      if (group.id === "general") continue;
      const row = el("button", `wizard-family${chosen.has(group.id) ? " on" : ""}`);
      row.append(el("span", "skill-check", chosen.has(group.id) ? "\u2611" : "\u25A2"));
      const main = el("div", "skill-main");
      const name = el("div", "wizard-family-name");
      name.append(el("span", undefined, group.label));
      if (group.suggested) name.append(el("span", "wizard-suggested", t("what you have open")));
      main.append(name);
      main.append(el("div", "skill-desc", group.hint));
      row.append(main);
      row.append(el("span", "wizard-family-count", String(group.skills)));
      row.addEventListener("click", () => {
        if (chosen.has(group.id)) chosen.delete(group.id);
        else chosen.add(group.id);
        wizard.families = [...chosen];
        deps.rerender();
      });
      list.append(row);
    }
    wrap.append(list);
    wrap.append(
      wizardFoot(
        deps,
        () => deps.send({ type: "wizardAnswer", step: "family", value: [...chosen] }),
        t("Next"),
      ),
    );
    return wrap;
  }

  if (wizard.step === "skills") {
    wrap.append(el("h2", "wizard-title", t("Which of these do you want?")));
    wrap.append(
      el("p", "wizard-lede", t("These are the skills of what you chose. Everything ticked appears when you type “/”.")),
    );
    const on = new Set(wizard.skills.filter((sk) => sk.enabled).map((sk) => sk.name));
    const list = el("div", "wizard-skills");

    // Under the family it came from, because "which of these" is answered family by family: you
    // keep the four Python ones and drop the Java ones, and an undifferentiated column of twenty
    // makes that a reading exercise.
    let lastGroup: string | undefined;
    for (const sk of wizard.skills) {
      if (sk.group && sk.group !== lastGroup) {
        lastGroup = sk.group;
        const heading = el("div", "wizard-group");
        heading.append(el("span", undefined, sk.groupLabel ?? sk.group));
        heading.append(
          button({
            label: t("All"),
            className: "btn tiny ghost",
            title: t("Tick everything in this family"),
            onClick: (ev) => {
              ev.stopPropagation();
              for (const other of wizard.skills) if (other.group === lastGroupOf(heading)) on.add(other.name);
              deps.rerender();
            },
          }),
        );
        heading.dataset["group"] = sk.group;
        list.append(heading);
      }
      const row = el("div", `skill-row${on.has(sk.name) ? " on" : ""}`);
      const box = el("span", "skill-check", on.has(sk.name) ? "\u2611" : "\u25A2");
      row.append(box);
      const main = el("div", "skill-main");
      main.append(el("div", "skill-name", sk.name));
      main.append(el("div", "skill-desc", sk.description));
      row.append(main);
      row.addEventListener("click", () => {
        const next = !row.classList.contains("on");
        row.classList.toggle("on", next);
        box.textContent = next ? "\u2611" : "\u25A2";
        if (next) on.add(sk.name);
        else on.delete(sk.name);
      });
      list.append(row);
    }
    wrap.append(list);
    wrap.append(
      wizardFoot(deps, () => deps.send({ type: "wizardAnswer", step: "skills", value: [...on] }), t("Next")),
    );
    return wrap;
  }

  // Ready. The last screen says nothing but the question, because everything else has been settled
  // and the only thing left is for the user to type.
  wrap.classList.add("ready");
  wrap.append(el("h2", "wizard-title", t("What would you like to do?")));
  wrap.append(
    el(
      "p",
      "wizard-lede",
      t("{0} mode · {1} skills in play. Ask below, and attach what you need.", modeLabel(wizard.mode), state.skills.filter((sk) => sk.enabled).length),
    ),
  );
  wrap.append(wizardFoot(deps, undefined, undefined));
  return wrap;
}

function lastGroupOf(heading: HTMLElement): string | undefined {
  return heading.dataset["group"];
}

function modeLabel(mode: Mode | undefined): string {
  return MODES.find((m) => m.id === mode)?.label ?? MODES[2]!.label;
}

function wizardFoot(deps: ChatDeps, onNext: (() => void) | undefined, label: string | undefined): HTMLElement {
  const foot = el("div", "wizard-foot");
  foot.append(
    button({ label: t("Back"), className: "btn tiny ghost", onClick: () => deps.send({ type: "wizardBack" }) }),
  );
  foot.append(el("div", "spacer"));
  if (onNext && label) foot.append(button({ label, className: "btn tiny primary", onClick: onNext }));
  return foot;
}

function renderEntry(entry: UiEntry, state: UiState, deps: ChatDeps): HTMLElement {
  // The message, and next to it the things you can do to the message.
  //
  // They used to be one element, and the give-away was pinning: a pinned answer paints a tint
  // across its whole block, and the tint ran under the buttons — because as far as the DOM was
  // concerned the buttons WERE part of the answer. They are not. They are a control strip that
  // belongs to the message the way a scrollbar belongs to a list, so they sit outside the article
  // and inside a wrapper that carries the hover.
  const block = el("div", `entry-block ${entry.role}${entry.pinned ? " pinned" : ""}`);
  const wrap = el(
    "article",
    `entry ${entry.role}${entry.included ? "" : " muted"}${entry.error ? " failed" : ""}${entry.pinned ? " pinned" : ""}`,
  );

  const head = el("div", "entry-head");
  // A small mark before the name, the way the editor's own chat does it. It is not decoration:
  // when an answer is long enough to scroll, the mark is what tells you at a glance whether the
  // block you have landed in is your question or its reply.
  head.append(el("span", `entry-mark ${entry.role}`, entry.role === "user" ? "\u25CF" : "\u25C6"));
  head.append(el("span", "entry-who", entry.role === "user" ? t("You") : "Hivey Code"));
  // The model and the cost are a receipt, and a receipt belongs at the bottom. In the header they
  // sat between the name and the tags, competing for a row that is already tight at a docked width,
  // and they were read on every turn by nobody. They now appear with the buttons, on hover, at the
  // far end of the row — the last thing on the line, which is where a total goes.
  if (!entry.included) head.append(el("span", "entry-tag", t("out of context")));
  if (entry.pinned) {
    // A mark, not a word, and never faded.
    //
    // Pinning worked and looked as though it did not: it printed "pinned" in the muted colour, in
    // the row that fades to nothing when the pointer leaves — so the one visible consequence of the
    // button disappeared a second after it was pressed. What a pinned message needs is what a
    // pinned message has everywhere else: a mark that stays, and an edge you can see down the
    // transcript without reading anything.
    const tag = el("span", "entry-pin");
    tag.append(icon("pin", "entry-pin-ico"));
    tag.append(el("span", undefined, t("pinned")));
    tag.title = t("Kept in the context when older exchanges are trimmed away.");
    head.append(tag);
  }

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
    // Sending one message into another conversation. Copying it out and pasting it back is the
    // thing this replaces, and that loses what it was — an answer, from a model, at a moment —
    // and arrives as text the next conversation cannot tell from the user's own words.
    button({
      icon: ICON.forward,
      title: t("Use in another conversation"),
      className: "btn icon-only",
      onClick: () => deps.send({ type: "shareEntry", id: entry.id }),
    }),
    button({
      icon: ICON.trash,
      title: t("Delete permanently"),
      // Named, not positional. `:last-child` would have styled whichever element happened to end
      // the row — which since the receipt moved in is the receipt, not this button.
      className: "btn icon-only danger",
      onClick: () => deps.send({ type: "dropEntry", id: entry.id }),
    }),
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
  const receipt = el("div", "entry-receipt");
  if (entry.model && entry.role === "assistant") receipt.append(el("span", "entry-meta", entry.model));
  if (entry.usdCost) {
    const cost = el("span", "entry-meta cost", formatCost(entry.usdCost));
    cost.title = t("What this answer cost.");
    receipt.append(cost);
  }
  if (receipt.childElementCount) {
    actions.append(el("div", "spacer"));
    actions.append(receipt);
  }

  block.append(wrap, actions);
  return block;
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
 * The line between two turns, and the way back to before the one it introduces.
 *
 * Drawn above every question but the transcript's first, because that is where one exchange ends
 * and the next starts. A transcript is a stack of question-and-answer pairs, and until now nothing
 * said so: every entry was separated from the next by the same amount of space, so a question sat
 * as far from its own answer as from a different turn entirely. The space now goes at the
 * boundary, and the reply is pulled up close to what it answers, so a pair reads as one block.
 *
 * When the turn changed files the line carries the restore, sitting on it the way the editor's
 * chat marks a restore point — visible without hovering, unlike everything else attached to a
 * message, because it is the only one that puts files back and something that overwrites the
 * working tree should never be discovered by accident.
 */
function turnRule(entry: Pick<UiEntry, "id" | "checkpointFiles" | "checkpointPartial">, deps: ChatDeps): HTMLElement {
  const files = entry.checkpointFiles ?? 0;
  const wrap = el("div", `turn-rule${files ? "" : " bare"}`);
  const action = button({
    icon: ICON.restore,
    label: t("Restore checkpoint"),
    className: "btn tiny checkpoint-btn",
    // Three different promises, and each says which one it is making before it is pressed. A turn
    // that wrote nothing to disk is still a point to come back to — that is the common case in
    // chat and plan mode, and refusing it there made the restore point look like an agent feature.
    title: entry.checkpointPartial
      ? t("Restore {0} file(s) — some changes were too large to record", files)
      : files
        ? t("Put the {0} file(s) this turn changed back, and rewind the conversation here", files)
        : t("Rewind the conversation to before this question — that turn changed no file"),
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

  if (state.attachments.length || state.implicit) {
    const chips = el("div", "chips attached");

    // The file the editor is showing, offered rather than attached. It looks different from the
    // chips beside it — outlined instead of filled — because it behaves differently: it follows the
    // active tab and disappears when you switch away, while a real attachment is something you
    // chose and that stays. A suggestion drawn as a decision is a suggestion people stop trusting.
    // Not when the same file is already attached by hand. The capture that proved attaching works
    // also showed `totals.ts` twice — once as the suggestion, once as the attachment — which reads
    // as the panel having lost count.
    const implicitAttached = state.implicit && state.attachments.some((a) => a.label === state.implicit!.label);
    if (state.implicit && !implicitAttached) {
      const chip = el("span", `chip implicit${state.implicitOn ? "" : " off"}`);
      chip.append(icon(fileIcon(state.implicit.label), "chip-ico"));
      const cut = state.implicit.label.lastIndexOf("/");
      chip.append(el("span", "chip-label", cut >= 0 ? state.implicit.label.slice(cut + 1) : state.implicit.label));
      if (cut > 0) chip.append(el("span", "chip-dir", state.implicit.label.slice(0, cut)));
      chip.title = state.implicitOn
        ? t("{0} — the open file, sent with your question. ~{1} tokens", state.implicit.label, formatTokens(state.implicit.tokens))
        : t("{0} — not sent. It comes back when you open another file.", state.implicit.label);
      chip.append(
        button({
          icon: state.implicitOn ? ICON.close : ICON.add,
          title: state.implicitOn ? t("Do not send the open file") : t("Send the open file after all"),
          className: "btn chip-x",
          onClick: () => deps.send({ type: "setImplicit", on: !state.implicitOn }),
        }),
      );
      chips.append(chip);
    }

    for (const a of state.attachments) {
      const chip = el("span", "chip removable");
      chip.append(icon(chipIcon(a.kind, a.label), "chip-ico"));
      // The file NAME, with its folder after it in the muted colour — the editor's own shape for
      // this, and the right one: `src/webview/chat.ts` truncated from the left is unreadable, and
      // truncated from the right is every file in the folder. The name identifies, the folder
      // disambiguates, and only the second is allowed to be cut.
      const cut = a.label.lastIndexOf("/");
      chip.append(el("span", "chip-label", cut >= 0 ? a.label.slice(cut + 1) : a.label));
      if (cut > 0) chip.append(el("span", "chip-dir", a.label.slice(0, cut)));
      chip.title = t("{0} · ~{1} tokens", a.kind, formatTokens(a.tokens));
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

    // A heading over the row once there is more than one thing in it, with what the lot costs and
    // one way to clear it. Chips alone answer "what is attached"; at four or five of them the
    // question becomes "how much is this sending", and that is a number, not a list.
    if (state.attachments.length > 1) {
      const head = el("div", "context-head");
      const total = state.attachments.reduce((sum, a) => sum + a.tokens, 0);
      head.append(el("span", "context-count", t("Context — {0} items, ~{1} tokens", state.attachments.length, formatTokens(total))));
      head.append(el("div", "spacer"));
      head.append(
        button({
          label: t("Clear"),
          className: "btn tiny ghost",
          title: t("Remove everything attached"),
          onClick: () => {
            for (const a of state.attachments) deps.send({ type: "removeAttachment", label: a.label });
          },
        }),
      );
      card.append(head);
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
  // Phrased as the assistant offering rather than the user being instructed. "Describe the change"
  // is a form label; "What can I do for you?" is the sentence someone actually answers.
  area.placeholder =
    state.mode === "agent"
      ? t("What can I do for you?")
      : state.mode === "plan"
        ? t("What can we plan together?")
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
  // Order: what to attach, what it may do, which model, how hard it thinks — then the skills.
  // Skills sit last because they are the one control that changes what `/` offers rather than what
  // this message does, and because that is where the user asked for it.
  left.append(contextButton(state, deps), modeButton(state, deps), modelButton(state, deps));
  if (state.reasoningAvailable) left.append(reasoningButton(state, deps));
  bar.append(left);

  // Skills sit with the send rather than at the end of the left group. On a wide panel the two
  // groups are pushed apart by `margin-left: auto`, so "last on the left" and "next to send" are
  // not the same place at all — and this is the control you reach for while writing the message,
  // not while configuring the conversation.
  const right = el("div", "toolbar-group end");
  right.append(toolsButton(state, deps));
  right.append(
    // The same button as its neighbours, carrying a different glyph. `primary` made it a size and a
    // weight of its own at the end of a row of six identical controls, and "the send is special"
    // is a thing a toolbar says by position, not by paint.
    isStreaming()
      ? button({ icon: ICON.stop, title: t("Stop the answer"), className: "btn ghost icon-only send", onClick: () => deps.send({ type: "stop" }) })
      : button({ icon: ICON.send, title: t("Send (⏎)"), className: "btn ghost icon-only send", onClick: () => submit(area, deps) }),
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
  // A ring rather than a bar. The bar was ninety pixels of a row that has to hold the provider, the
  // approval setting, a token count and a price on one line at 280 px — and it was hidden below a
  // fifth full, because a green dot at the end of a long grey line reads as a rendering fault
  // rather than as a measurement. A ring says the same thing in fourteen pixels and says it
  // legibly when nearly empty, so it no longer has to wait until the number is worrying.
  if (state.contextFill > 0.02) meter.append(contextRing(state, deps));
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

/** A chip's icon, from what the attachment is. The label says which one; this says what kind. */
/**
 * The mark for a file, from its extension.
 *
 * A row of identical page glyphs says only "these are files", which the reader can see from the
 * names. Four marks — source, structured data, prose, picture — is as far as this can go honestly:
 * the editor draws the language's own icon from a theme a webview cannot reach, and a logo redrawn
 * by hand at twelve pixels is a smudge. An unknown extension keeps the page, which is the truth.
 */
function fileIcon(label: string): Parameters<typeof icon>[0] {
  const ext = label.slice(label.lastIndexOf(".") + 1).toLowerCase();
  if (/^(json|jsonc|ya?ml|toml|ini|csv|tsv|xml|sql|env|properties)$/.test(ext)) return "data";
  if (/^(md|markdown|txt|rst|adoc|log|pdf|docx?)$/.test(ext)) return "doc";
  if (/^(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/.test(ext)) return "image";
  if (
    /^(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|php|swift|scala|sh|bash|zsh|ps1|lua|dart|vue|svelte|html?|css|scss|less|rpgle?|sqlrpgle|clle?|clp|dds|pf|lf|dspf|prtf|cbl|cblle|pgm|mbr)$/.test(ext)
  ) {
    return "code";
  }
  return "file";
}

function chipIcon(kind: string, label = ""): Parameters<typeof icon>[0] {
  switch (kind) {
    case "selection":
    case "symbol":
      return "edit";
    case "conversation":
    case "message":
      return "history";
    case "diff":
    case "changes":
      return "bringIn";
    default:
      return fileIcon(label);
  }
}

/**
 * How full the context is, as a ring.
 *
 * The shape the editor's own chat uses for this — a circle of background with an arc drawn over it,
 * starting at twelve o'clock. Same reasons: it is the smallest honest way to show a proportion, it
 * cannot be confused with a progress bar for something that is running, and the number it stands
 * for is only interesting when it is high, so the number itself waits until you point at it.
 */
function contextRing(state: UiState, deps: ChatDeps): HTMLElement {
  const fill = state.contextFill;
  const pct = Math.min(100, Math.round(fill * 100));
  // A button, because the thing you want after reading "84 %" is to change what the 84 % is OF.
  //
  // The budget belongs in the reasoning menu too — it is the other half of "how much may this model
  // spend" — but that menu only exists on a model that can think, and this setting applies to every
  // model there is. Put in the toolbar as a control of its own it cost 22 px, and a capture showed
  // where they came from: the model name, the one label in that row carrying something nobody can
  // guess, went from "qwen2.5-co…" to "qwen2…". Here it costs nothing: the ring was already drawn,
  // already about exactly this, and already in the row where the token count lives.
  const wrap = el("button", `context-ring${fill > 0.85 ? " high" : fill > 0.6 ? " warm" : ""}`);
  wrap.title = t("{0}% of the context budget — click to change it", pct);
  wrap.addEventListener("click", () =>
    menu(wrap, (close) => {
      const panel = el("div", "menu-list");
      panel.append(
        menuTitle(
          state.modelContext > 0
            ? t("Context budget — {0} holds {1}", state.modelLabel, formatTokens(state.modelContext))
            : t("Context budget"),
        ),
      );
      const budgets = contextBudgets(state.modelContext);
      for (const tokens of budgets) {
        panel.append(
          menuItem({
            label: t("{0} tokens", formatTokens(tokens)),
            hint:
              tokens === budgets[budgets.length - 1] && state.modelContext > 0
                ? t("As much as this model can take, with room left for the answer")
                : undefined,
            selected: tokens === state.contextBudget,
            onClick: () => {
              deps.send({ type: "setContextBudget", tokens });
              close();
            },
          }),
        );
      }
      return panel;
    }),
  );

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ring");

  const R = 6;
  const CIRCUMFERENCE = 2 * Math.PI * R;
  for (const kind of ["ring-bg", "ring-arc"] as const) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "8");
    c.setAttribute("cy", "8");
    c.setAttribute("r", String(R));
    c.setAttribute("class", kind);
    if (kind === "ring-arc") {
      // Drawn as a dash long enough to cover the fraction, with the gap covering the rest. The
      // rotation that puts the start at the top is in the stylesheet, where the rest of the shape
      // is.
      c.setAttribute("stroke-dasharray", `${(pct / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`);
    }
    svg.append(c);
  }
  wrap.append(svg);
  // The number, revealed by pointing at the ring. It is four characters that nobody needs on screen
  // at 12 % and everybody wants at 90.
  wrap.append(el("span", "ring-pct", `${pct}%`));
  return wrap;
}

function autoGrow(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  // The floor matches the stylesheet's `min-height`. Two numbers for one decision is how a box
  // ends up snapping to a different size the moment somebody types into it.
  const height = Math.min(260, Math.max(44, area.scrollHeight));
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
  const on = state.skills.filter((sk) => sk.enabled).length;
  return button({
    icon: ICON.tools,
    // The count of what is ON, in the tooltip. The badge that used to sit on this icon counted what
    // was off, which was a signal while everything was on by default and became permanently lit the
    // moment families became opt-in.
    title: t("Skills and sub-agents — {0} in play", on),
    className: "btn ghost icon-only",
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

/**
 * How much of the model's window this conversation may fill.
 *
 * Steps, not a number to type: the choice is coarse — "keep it cheap", "let it read a lot" — and a
 * field asking for a token count is a field asking the user to know what a token is. They are
 * derived from the model actually chosen and stopped at ITS ceiling, because offering 128k on a
 * model that holds 8k is a promise the run cannot keep, and the failure would arrive one question
 * later as a truncation nobody asked for. A model whose window the catalogue does not know — a
 * local runtime that reports no such number — gets fixed steps instead, which is the honest answer
 * to "I do not know how big this is".
 */
export function contextBudgets(modelContext: number): number[] {
  const STEPS = [4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 200_000];
  if (modelContext <= 0) return STEPS.slice(0, 5);
  // Never the whole window: the answer has to fit in it too, and a budget equal to the window
  // leaves nowhere for the reply.
  const ceiling = Math.floor(modelContext * 0.75);
  const within = STEPS.filter((n) => n <= ceiling);
  if (!within.length) return [ceiling];
  // The ceiling itself, when the steps stop well short of it — otherwise a 200k model offers 128k
  // as its largest choice and the rest of the window is unreachable.
  if (ceiling > (within[within.length - 1] ?? 0) * 1.3) within.push(ceiling);
  return within;
}

function reasoningButton(state: UiState, deps: ChatDeps): HTMLElement {
  const current = REASONING.find((r) => r.id === state.reasoning) ?? REASONING[0]!;
  const budgets = contextBudgets(state.modelContext);
  const b = button({
    label: current.label,
    trailingIcon: ICON.chevron,
    title: t("Reasoning: {0}", current.hint),
    className: `btn ghost reasoning${state.reasoning === "none" ? "" : " active"}`,
    onClick: () =>
      menu(b, (close) => {
        const panel = el("div", "menu-list");
        if (state.reasoningAvailable) {
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
        }
        panel.append(
          menuTitle(
            state.modelContext > 0
              ? t("Context budget — {0} holds {1}", state.modelLabel, formatTokens(state.modelContext))
              : t("Context budget"),
          ),
        );
        for (const tokens of budgets) {
          panel.append(
            menuItem({
              label: t("{0} tokens", formatTokens(tokens)),
              hint:
                tokens === budgets[budgets.length - 1] && state.modelContext > 0
                  ? t("As much as this model can take, with room left for the answer")
                  : undefined,
              selected: tokens === state.contextBudget,
              onClick: () => {
                deps.send({ type: "setContextBudget", tokens });
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

/**
 * The skills on offer right now.
 *
 * Derived from the state the extension sends rather than from the catalogue, because the catalogue
 * is every skill that exists and the state is the ones in play. Reading the catalogue and
 * subtracting was the old shape, and it offered seventy commands to someone who had chosen four
 * families — the filter has to be the other way round.
 */
function offeredSkills(state: UiState): BuiltinSkill[] {
  const on = new Set(state.skills.filter((sk) => sk.builtin && sk.enabled).map((sk) => sk.name));
  return BUILTIN_SKILLS.filter((sk) => on.has(sk.name));
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
  const available = state ? offeredSkills(state) : BUILTIN_SKILLS;
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
  const available = state ? offeredSkills(state) : BUILTIN_SKILLS;
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
