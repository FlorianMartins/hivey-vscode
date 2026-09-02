// The panel: state, routing between screens, and the live turn.
//
// One state object arrives from the extension and the whole panel is rebuilt from it. That is
// deliberate: the alternative — patching the DOM as messages arrive — is how a chat panel ends up
// showing a muted message as active, or a model name that changed three turns ago. The only thing
// rendered incrementally is the answer being streamed, because that one has to be.

import { button, closeMenu, el, icon, ICON, searchInput } from "./dom.js";
import { chatScreen, collapsible, isStreaming, planBlock, setStreaming, type ChatDeps, captureDraft, restoreDraft } from "./chat.js";
import { historyScreen } from "./history.js";
import { modelsScreen } from "./models.js";
import { permissionsScreen } from "./permissions.js";
import { markdown } from "./markdown.js";
import type { ToExtension, ToPanel, UiState } from "../shared/protocol.js";
import type { Plan } from "../core/agent/plan.js";
import { t } from "../shared/i18n.js";
import { usePrefStore } from "./prefs.js";
import { closeModelCombo, openModelCombo } from "./modelCombo.js";
import { setupScreen } from "./setup.js";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: ToExtension) => vscode.postMessage(m);
// The picker's own preferences live in the webview's state, which survives the view being hidden.
usePrefStore({ get: () => vscode.getState(), set: (state) => vscode.setState(state) });

let state: UiState | undefined;
let searchOpen = false;
let live: LiveTurn | undefined;

const app = document.getElementById("app")!;

const deps: ChatDeps = {
  send,
  state: () => state,
  rerender: () => render(),
};

// ── Shell ────────────────────────────────────────────────────────────────────────────────────

function render(): void {
  if (!state) return;
  closeMenu();
  // Rebuilding the panel is right for the transcript and wrong for the box being typed in. Taking
  // the draft out first and putting it back after is what stops a message arriving from the
  // extension from erasing a half-written question.
  const draft = captureDraft();
  const place = captureScroll();
  app.textContent = "";
  app.append(header(state));
  if (searchOpen && state.screen === "chat") app.append(searchBar(state));

  // The picker is a floating element on <body>, so it outlives the screen that opened it. Leaving
  // it up over the permissions screen is not a stale menu, it is a menu belonging to a screen that
  // is no longer there.
  if (state.screen !== "chat") closeModelCombo();

  switch (state.screen) {
    case "history":
      app.append(historyScreen(state, send));
      break;
    case "models":
      app.append(modelsScreen(state, send, render));
      break;
    case "permissions":
      app.append(permissionsScreen(state, send));
      break;
    case "setup":
      app.append(setupScreen(state, send, render));
      break;
    case "chat":
    default:
      app.append(chatScreen(state, deps));
      break;
  }
  live = undefined;
  restoreScroll(place);
  restoreDraft(draft);
}

/**
 * Where the reader was, so that a rebuild does not move them.
 *
 * Every message from the extension rebuilds the panel, and the rebuild used to end at the bottom of
 * the transcript unconditionally. That is right for a new turn and wrong for everything else: mute
 * an exchange, delete one, attach a file, PIN an answer — and the conversation jumped to the last
 * message, away from the thing you had just acted on. Pinning was reported as "it goes to the last
 * message", and it was: not the pin's doing, but every rebuild's.
 *
 * Nothing is captured when the screen changes, because a scroll position in the history list means
 * nothing in a transcript.
 */
function captureScroll(): { top: number; atEnd: boolean } | undefined {
  const list = document.querySelector(".transcript");
  if (!list || state?.screen !== "chat") return undefined;
  return { top: list.scrollTop, atEnd: atBottom(list) };
}

function restoreScroll(place: { top: number; atEnd: boolean } | undefined): void {
  // At the end, or arriving from another screen: the end is where a conversation is read from.
  if (!place || place.atEnd) {
    scrollToEnd(true);
    return;
  }
  requestAnimationFrame(() => {
    const list = document.querySelector(".transcript");
    if (!list) return;
    list.scrollTop = place.top;
    // The rebuild dropped the button with the old DOM; the reader is still where they were, so it
    // is still needed.
    showJumpButton(!atBottom(list));
  });
}

function header(s: UiState): HTMLElement {
  const bar = el("header", "topbar");
  const left = el("div", "topbar-left");

  if (s.screen !== "chat") {
    left.append(
      button({
        icon: ICON.back,
        title: t("Back to the conversation"),
        className: "btn icon-only",
        onClick: () => send({ type: "openScreen", screen: "chat" }),
      }),
    );
    left.append(el("span", "topbar-title", screenTitle(s)));
  } else {
    // The conversation's name, editable in place. A title the assistant invented from the first
    // question is a guess, and a guess you cannot correct is worse than no title: it is what you
    // will scroll past in the history a week from now looking for something else.
    //
    // The local/remote badge that used to sit here is gone. It said the same thing on every
    // conversation for weeks at a time, and the composer already names the model — a badge that
    // never changes is a badge nobody reads.
    const title = el("span", "topbar-title editable", s.session.title || t("New conversation"));
    title.title = t("Double-click to rename");
    title.tabIndex = 0;

    const rename = () => {
      const input = el("input", "topbar-title-input");
      input.value = s.session.title;
      input.placeholder = t("New conversation");
      const commit = (save: boolean) => {
        if (input.parentElement !== left) return;
        left.replaceChild(title, input);
        const next = input.value.trim();
        if (save && next !== s.session.title) send({ type: "renameSession", title: next });
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(true); }
        else if (ev.key === "Escape") { ev.preventDefault(); commit(false); }
      });
      // Leaving the field keeps what was typed. Discarding an edit because focus moved is the
      // behaviour people learn to distrust.
      input.addEventListener("blur", () => commit(true));
      left.replaceChild(input, title);
      input.focus();
      input.select();
    };

    title.addEventListener("dblclick", rename);
    title.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === "F2") { ev.preventDefault(); rename(); }
    });
    left.append(title);
    left.append(
      button({
        icon: ICON.edit,
        title: t("Rename this conversation"),
        className: "btn icon-only rename",
        onClick: rename,
      }),
    );
  }

  // Nothing on the right. The editor draws its own title bar one row above with exactly these
  // buttons — new conversation, history, terminal — and drawing them again here made a second row
  // that looked like a mistake, because it was one. What is left is the conversation's name, which
  // the editor's row cannot show.
  //
  // The overflow menu stays: what is behind it (outgoing data, costs, permissions, settings) has no
  // place in a title bar, and would be four more icons if it did.
  // Nothing but the conversation's name. The editor draws its own title bar one row above, with
  // exactly the actions this row used to duplicate — search, new conversation, history, terminal —
  // and everything that was behind the overflow button now sits in the editor's own overflow, which
  // is where a reader already looks for it. Two rows of the same buttons was not a layout.
  bar.append(left);
  return bar;
}

function screenTitle(s: UiState): string {
  switch (s.screen) {
    case "history":
      return t("Conversations");
    case "models":
      return t("Models");
    case "permissions":
      return t("Permissions");
    case "setup":
      return t("Setup");
    default:
      return "Hivey Code";
  }
}

function searchBar(s: UiState): HTMLElement {
  const wrap = el("div", "search-bar");
  wrap.append(
    searchInput({
      value: s.searchQuery,
      placeholder: t("Search this conversation…"),
      onInput: (query) => send({ type: "search", query }),
      onEscape: () => {
        searchOpen = false;
        send({ type: "search", query: "" });
      },
    }),
  );
  if (s.searchQuery) {
    wrap.append(el("span", "muted", t("{0} messages", s.matches.length)));
  }
  return wrap;
}

// ── The live turn ────────────────────────────────────────────────────────────────────────────

class LiveTurn {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private text?: HTMLElement;
  private thinking?: { wrap: HTMLElement; body: HTMLElement };
  private buffer = "";

  constructor(list: HTMLElement) {
    this.root = el("article", "entry assistant streaming");
    const head = el("div", "entry-head");
    head.append(el("span", "entry-who", "Hivey Code"));
    head.append(el("span", "entry-meta pulse", t("thinking…")));
    this.root.append(head);
    this.body = el("div", "entry-body");
    this.root.append(this.body);
    list.append(this.root);
  }

  appendText(chunk: string): void {
    this.buffer += chunk;
    if (!this.text) {
      this.text = el("div", "live-text");
      this.body.append(this.text);
    }
    this.scheduleRender();
  }

  /**
   * Render the answer AS IT ARRIVES, not once it has finished.
   *
   * The panel used to show raw markdown while streaming and swap in the formatted version at the
   * end, so every answer was read twice: once as asterisks and backticks, once as prose. The
   * rewrite at the end also moved the text under the reader's eyes, which is the single most
   * unpleasant thing a streaming interface can do.
   *
   * Two things make re-parsing on the fly cheap enough to do this way. It is throttled to one
   * repaint per frame rather than one per token — a fast model emits tokens far faster than a
   * screen refreshes, and rendering more often than the display can show is work nobody sees. And
   * it is skipped entirely while the user has a selection inside the answer, because replacing the
   * nodes under a selection destroys it, and someone selecting text mid-answer is someone about to
   * copy it.
   */
  private pending = false;

  private scheduleRender(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.renderBuffer();
    });
  }

  private renderBuffer(): void {
    if (!this.text) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && this.text.contains(selection.anchorNode)) return;
    // No code actions while streaming: Copy and Compare on a block that is still being written
    // would act on half of it. They arrive with `finish()`, on the finished answer.
    const rendered = markdown(closeOpenFence(this.buffer));
    rendered.className = "md live";
    this.text.replaceChildren(...Array.from(rendered.childNodes));
  }

  appendReasoning(chunk: string): void {
    if (!this.thinking) {
      const wrap = collapsible(t("Reasoning"), "");
      const body = wrap.querySelector<HTMLElement>(".collapsible-body")!;
      this.thinking = { wrap, body };
      this.body.prepend(wrap);
    }
    this.thinking.body.textContent = (this.thinking.body.textContent ?? "") + chunk;
  }

  /**
   * The plan, redrawn in place.
   *
   * Replaced rather than appended: the model sends the WHOLE plan on every update, so appending
   * would stack five copies of the same list down the answer. It is pinned to the top of the turn
   * because that is where it stays useful — under the tool lines it scrolls away exactly when the
   * turn gets long enough to need it.
   */
  private planNode?: HTMLElement;

  setPlan(plan: Plan): void {
    const next = planBlock(plan, true);
    if (this.planNode) this.planNode.replaceWith(next);
    else this.body.prepend(next);
    this.planNode = next;
  }

  appendStatus(text: string, tool?: string, ok?: boolean): void {
    const row = el("div", `step${ok === false ? " failed" : ""}`);
    if (tool) {
      row.append(icon(ok === false ? "cross" : "check", "step-ico"));
      row.append(el("span", "step-tool", tool));
    } else {
      row.append(el("span", "step-ico dot", "·"));
    }
    row.append(el("span", "step-summary", text));
    this.body.append(row);
  }

  appendError(message: string): void {
    this.body.append(el("div", "error", message));
  }

  /** The approval card: four answers, because "yes" and "yes forever" are different decisions. */
  appendApproval(
    id: string,
    tool: string,
    description: string,
    command?: string,
    choices: Array<"once" | "session" | "always" | "no"> = ["once", "session", "always", "no"],
    detail: string[] = [],
  ): void {
    const egress = tool === "egress";
    const card = el("div", `approval${egress ? " egress" : ""}`);
    const head = el("div", "approval-head");
    head.append(icon("shield", "approval-ico"));
    head.append(el("span", undefined, egress ? t("Leaving this machine") : t("Approval requested")));
    card.append(head);
    card.append(el("div", "approval-body", description));
    if (command) card.append(el("pre", "approval-command", command));
    for (const line of detail) card.append(el("div", "approval-detail", line));

    const actions = el("div", "approval-actions");
    const answer = (a: "once" | "session" | "always" | "no", label: string) => {
      send({ type: "approve", id, answer: a });
      card.replaceChildren(el("div", "approval-done", label));
    };
    // Egress consent is per destination, so "this conversation" would be a promise about the wrong
    // thing. The labels differ too: what is being agreed to is sending, not permitting an action.
    const available: Record<string, () => HTMLElement> = {
      once: () =>
        button({
          label: egress ? t("Send") : t("Allow"),
          className: "btn primary",
          onClick: () => answer("once", egress ? t("Sent.") : t("Allowed once.")),
        }),
      session: () =>
        button({
          label: t("Always (this conversation)"),
          className: "btn",
          title: t("Stop asking for {0} until the next conversation", tool),
          onClick: () => answer("session", t("Allowed for this conversation.")),
        }),
      always: () =>
        button({
          label: egress ? t("Always to this model") : t("Always"),
          className: "btn",
          title: egress ? t("Stop asking before sending to this model") : t("Write a permanent rule for this action"),
          onClick: () => answer("always", egress ? t("This model will not be asked about again.") : t("Permanent rule saved.")),
        }),
      no: () =>
        button({
          label: egress ? t("Do not send") : t("Refuse"),
          className: "btn danger",
          onClick: () => answer("no", egress ? t("Not sent.") : t("Refused.")),
        }),
    };
    for (const choice of choices) actions.append(available[choice]!());
    card.append(actions);
    this.body.append(card);
    scrollToEnd();
  }

  /** The authoritative render: the finished text, with the actions that act on it. */
  finish(): void {
    if (this.text && this.buffer) {
      const rendered = markdown(this.buffer, {
        onCopy: (code) => send({ type: "copy", text: code }),
        onInsert: (code) => send({ type: "insertCode", code }),
        onInsertAtCursor: (code) => send({ type: "insertCode", code, atCursor: true }),
        onApply: (code, language) => send({ type: "applyCode", code, language }),
      });
      this.text.replaceWith(rendered);
      this.text = undefined;
    }
    this.root.classList.remove("streaming");
  }
}

/**
 * Close a fence the model has opened and not yet closed.
 *
 * Mid-stream, an answer is routinely cut in the middle of a code block. Handed to the renderer as
 * it stands, the opening ``` has no partner, so the block is not recognised and its contents render
 * as paragraphs — then snap into a code block the moment the closing fence arrives. Adding the
 * missing fence to the COPY being rendered (never to the buffer) means a code block appears as a
 * code block from its first line and simply grows.
 */
function closeOpenFence(text: string): string {
  let open = false;
  for (const line of text.split("\n")) if (/^\s*```/.test(line)) open = !open;
  return open ? `${text}\n\u0060\u0060\u0060` : text;
}

function ensureLive(): LiveTurn {
  if (live) return live;
  const list = document.querySelector<HTMLElement>(".transcript") ?? app;
  // The welcome block is not part of the conversation; it goes as soon as one starts.
  list.querySelector(".welcome")?.remove();
  live = new LiveTurn(list);
  scrollToEnd();
  return live;
}

/**
 * Follow the answer — unless the reader has gone somewhere else.
 *
 * Scrolling to the end on every token is right exactly while the reader is AT the end. The moment
 * they scroll up — to re-read the question, to copy a line out of an earlier block — every further
 * token yanked them back down, which makes reading a long answer while it is being written
 * impossible. It is the single most irritating thing a streaming transcript can do.
 *
 * So the rule is "stick to the bottom while you are already at the bottom", with a tolerance of a
 * couple of lines because a scroll position is rarely exactly zero from the end. Once the reader
 * has left, nothing moves them again until they ask — and the button below is how they ask.
 */
const STICK_TOLERANCE_PX = 48;

function atBottom(list: Element): boolean {
  return list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_TOLERANCE_PX;
}

function scrollToEnd(force = false): void {
  requestAnimationFrame(() => {
    const list = document.querySelector(".transcript");
    if (!list) return;
    if (!force && !atBottom(list)) {
      showJumpButton(true);
      return;
    }
    list.scrollTop = list.scrollHeight;
    showJumpButton(false);
  });
}

/**
 * The way back down.
 *
 * It only exists while it is needed. A permanent button in the corner of a transcript that is
 * already at its end is a button that means nothing, and after a week nobody sees it — which is
 * exactly when it would have been useful.
 */
function showJumpButton(show: boolean): void {
  const existing = document.querySelector<HTMLElement>(".jump-to-end");
  if (!show) {
    existing?.remove();
    return;
  }
  if (existing) return;
  // The transcript's own box, not the screen. I added that box for exactly this and then went on
  // appending to `.chat-screen`, whose bottom edge is BELOW the composer — so the button was
  // positioned against the wrong element and sat under the input. Two fixes ago the symptom was
  // the same and the cause was different, which is why it kept looking unfixed.
  const host = document.querySelector<HTMLElement>(".transcript-wrap");
  if (!host) return;
  // The chevron alone. The word beside it named the destination, which the arrow already names —
  // and it was the widest thing in the strip between the last answer and the composer, in a panel
  // where that strip is the one place nothing else is allowed to be.
  const jump = button({
    icon: ICON.chevron,
    className: "btn jump-to-end",
    title: isStreaming() ? t("Answering… go to the end of the conversation") : t("Go to the end of the conversation"),
    onClick: () => scrollToEnd(true),
  });
  host.append(jump);
}

/** Watch the reader's own scrolling, so the button appears and disappears on its own. */
function watchScrolling(): void {
  document.addEventListener(
    "scroll",
    (ev) => {
      const list = ev.target as HTMLElement | null;
      if (!list?.classList?.contains("transcript")) return;
      showJumpButton(!atBottom(list));
    },
    true,
  );
}
watchScrolling();

// ── Messages from the extension ──────────────────────────────────────────────────────────────

window.addEventListener("message", (event: MessageEvent<ToPanel>) => {
  const m = event.data;
  switch (m.type) {
    case "state":
      state = m.state;
      render();
      break;
    case "turnStart":
      setStreaming(true);
      render();
      ensureLive();
      break;
    case "turnEnd":
      setStreaming(false);
      live?.finish();
      break;
    case "delta":
      ensureLive().appendText(m.text);
      scrollToEnd();
      break;
    case "reasoning":
      ensureLive().appendReasoning(m.text);
      break;
    case "plan":
      ensureLive().setPlan(m.plan);
      break;
    case "status":
      ensureLive().appendStatus(m.text, m.tool, m.ok);
      scrollToEnd();
      break;
    case "approval":
      ensureLive().appendApproval(m.id, m.tool, m.description, m.command, m.choices, m.detail);
      break;
    case "error":
      ensureLive().appendError(m.message);
      setStreaming(false);
      break;
    case "restoreDraft": {
      // A rewind puts the question back where it was typed. Focused and selected, because the
      // reason to roll back is almost always to ask the same thing differently.
      const area = document.querySelector<HTMLTextAreaElement>(".composer-input");
      if (area) {
        area.value = m.text;
        area.focus();
        area.setSelectionRange(m.text.length, m.text.length);
        area.dispatchEvent(new Event("input"));
      }
      break;
    }
    case "openSearch":
      if (state?.screen !== "chat") break;
      searchOpen = true;
      render();
      document.querySelector<HTMLInputElement>(".search-input")?.focus();
      break;
    case "openModelPicker": {
      // Anchored on the composer's own model button, so the panel opens in the same place whether
      // it was reached by mouse or from the command palette. If the button is not on screen — the
      // user is on another screen — there is nothing sensible to anchor to, so nothing happens.
      const anchor = document.querySelector<HTMLElement>(".composer-toolbar .btn.model");
      if (anchor && state) openModelCombo(anchor, state, send);
      break;
    }
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeMenu();
  // The editor's own find shortcut, applied to the conversation.
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "f" && state?.screen === "chat") {
    ev.preventDefault();
    searchOpen = true;
    render();
    document.querySelector<HTMLInputElement>(".search-input")?.focus();
  }
});

/**
 * How wide this platform's scrollbar is, published as a CSS variable.
 *
 * The transcript reserves a gutter for its scrollbar; the composer, which does not scroll, had no
 * reason to know about it and so sat that many pixels wider than every answer above it — the box
 * you type in visibly overhanging the text it produces. The width is the platform's decision (and
 * the user's, via their editor settings), so it is measured rather than assumed: a constant that is
 * right on this machine is wrong on the next one, and silently.
 */
function publishScrollbarWidth(): void {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;overflow-y:scroll;width:60px;height:60px";
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  document.documentElement.style.setProperty("--scrollbar-gutter", `${width}px`);
}
publishScrollbarWidth();

send({ type: "ready" });
export { isStreaming };
