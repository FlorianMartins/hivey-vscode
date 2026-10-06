// The panel: state, routing between screens, and the live turn.
//
// One state object arrives from the extension and the whole panel is rebuilt from it. That is
// deliberate: the alternative — patching the DOM as messages arrive — is how a chat panel ends up
// showing a muted message as active, or a model name that changed three turns ago. The only thing
// rendered incrementally is the answer being streamed, because that one has to be.

import { button, closeMenu, el, icon, ICON, menuIsOpen, searchInput } from "./dom.js";
import { chatScreen, isStreaming, planBlock, reasoningBlock, setStreaming, stepRow, type ChatDeps, captureDraft, restoreDraft,
  NOTE_FADE_MS,
  setComposerNote,
  dictationStopped,
  dictationStarted,
  setLevel,
  cancelDictation,
} from "./chat.js";
import { atEnd, placeAfterChange, type Viewport } from "../core/ui/scroll.js";
import { historyScreen } from "./history.js";
import { modelsScreen } from "./models.js";
import { permissionsScreen } from "./permissions.js";
import { markdown } from "./markdown.js";
import type { ToExtension, ToPanel, UiState } from "../shared/protocol.js";
import type { Plan } from "../core/agent/plan.js";
import { t } from "../shared/i18n.js";
import { usePrefStore } from "./prefs.js";
import { closeModelCombo, openModelCombo, refreshModelCombo } from "./modelCombo.js";
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
  // The one node that cannot be rebuilt: the live turn holds the typing animation's state, the
  // buffer it has released so far and the step rows a turn has produced, none of which exists in
  // `state`. It is carried across; everything else is drawn from the state as it always was.
  //
  // It is carried only while the state still says an answer is being written. A live turn kept
  // past the end of its turn would sit there for ever, next to the finished answer the transcript
  // now draws — and the previous attempt at this, which kept the WHOLE transcript instead, went
  // silent for the length of a turn and stayed silent if anything left the flag set.
  // Kept for as long as the turn it belongs to is running — NOT only while an answer is being
  // written. The live turn exists from the moment a turn starts, and the first thing it can hold is
  // a question; tying its survival to an answer existing yet destroyed it during exactly the window
  // where the turn was waiting to be allowed to start.
  const turnRunning = isStreaming() || state.session.entries.some((e) => e.streaming);
  const liveTurn = state.screen === "chat" && turnRunning && live?.root.isConnected ? live.root : undefined;
  if (liveTurn) liveTurn.remove();
  app.textContent = "";
  app.append(header(state));
  if (searchOpen && state.screen === "chat") app.append(searchBar(state));

  // The picker is a floating element on <body>, so it outlives the screen that opened it. Leaving
  // it up over the permissions screen is not a stale menu, it is a menu belonging to a screen that
  // is no longer there.
  if (state.screen !== "chat") closeModelCombo();
  // An open picker is a floating element on <body>, so a rebuild of the panel leaves it alone —
  // including when the state that arrived is the one it asked for.
  else refreshModelCombo(state);

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
      app.append(chatScreen(state, deps, liveTurn));
      break;
  }
  // The live turn did not survive this render, so the object that points at its nodes must not
  // either: the next token would otherwise be written into a subtree nobody can see.
  if (!liveTurn) live = undefined;
  restoreScroll(place, Boolean(liveTurn));
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
 *
 * ⚠️ AND IT IS NOT ONLY THE TRANSCRIPT. This looked only at `.transcript`, on the chat screen, so
 * every OTHER screen jumped back to the top on every rebuild — and the settings screen rebuilds on
 * each keystroke in a key field. Reported as « quand on déplie un fournisseur pour renseigner la clé
 * il remonte tout en haut ». The reason the defect survived is that the comment above described a
 * problem about the transcript, so that is what the code solved.
 */
function scroller(): HTMLElement | null {
  // Whichever of the panel's scrolling containers this screen has. One list, because a screen has
  // exactly one — and naming them here is how a new screen gets this for free.
  return document.querySelector<HTMLElement>(".transcript, .setup, .history, .models, .screen-scroll");
}

function captureScroll(): { top: number; atEnd: boolean; screen: string } | undefined {
  const list = scroller();
  if (!list || !state) return undefined;
  // `atEnd` means "follow the end" and is a property of a CONVERSATION, not of a settings page: a
  // settings screen that happened to be scrolled to its last line must not be pinned there.
  return { top: list.scrollTop, atEnd: state.screen === "chat" && atBottom(list), screen: state.screen };
}

/**
 * `preserved` says the transcript node survived the rebuild, so its content is identical and the
 * number captured before still points at the same thing.
 *
 * Either way the position is applied IMMEDIATELY and not on the next frame. A re-inserted scroller
 * starts at zero, and a token arriving in the millisecond before that frame would measure "the
 * reader is not at the end" against a position nobody chose — and, the rule being what it is, stop
 * following for the rest of the answer. That was one of the two ways the follow died.
 */
function restoreScroll(place: { top: number; atEnd: boolean; screen: string } | undefined, preserved = false): void {
  // A screen change throws the position away: where you were in the settings means nothing in a
  // conversation. Checked against the state AFTER the rebuild, which is the new screen.
  if (place && state && place.screen !== state.screen) {
    scroller()?.scrollTo({ top: 0 });
    return;
  }
  // At the end, or arriving from another screen: the end is where a conversation is read from.
  if (!place || place.atEnd) {
    scrollToEnd(true);
    return;
  }
  const apply = (): void => {
    const list = scroller();
    if (!list) return;
    list.scrollTop = place.top;
    // The rebuild dropped the button with the old DOM; the reader is still where they were, so it
    // is still needed.
    showJumpButton(!atBottom(list));
  };
  apply();
  // A rebuilt transcript is still settling — a code block measured, a font swapped — so it is
  // placed again once layout has run. A preserved one is the same nodes it already was.
  if (!preserved) requestAnimationFrame(apply);
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
      // behavior people learn to distrust.
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

/**
 * The way out of the search.
 *
 * Closing also clears the query, and that is not tidiness: the query FILTERS the transcript, so a
 * bar that closed while it still held a word would leave messages missing from the conversation
 * with nothing on screen to say why.
 */
function closeSearch(): void {
  searchOpen = false;
  send({ type: "search", query: "" });
}

function searchBar(s: UiState): HTMLElement {
  const wrap = el("div", "search-bar");
  wrap.append(
    searchInput({
      value: s.searchQuery,
      placeholder: t("Search this conversation…"),
      onInput: (query) => send({ type: "search", query }),
      onEscape: closeSearch,
    }),
  );
  if (s.searchQuery) {
    wrap.append(el("span", "muted", t("{0} messages", s.matches.length)));
  }
  // A cross, because Escape only works while the caret is in the field — and the field is the one
  // place a reader is NOT once they have started looking at what the search found. There was no
  // other way out at all: the magnifier opens the bar and pressing it again just opens it afresh.
  wrap.append(
    button({
      icon: ICON.close,
      title: t("Close the search"),
      className: "btn ghost icon-only search-close",
      onClick: () => {
        closeSearch();
        render();
      },
    }),
  );
  return wrap;
}

// ── The live turn ────────────────────────────────────────────────────────────────────────────

class LiveTurn {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private text?: HTMLElement;
  private thinking?: { wrap: HTMLElement; body: HTMLElement; folded?: boolean };
  private buffer = "";

  /**
   * Built and attached in two steps, because the attachment is what moves the reader.
   *
   * The turn's own container is a header and a line of padding — taller than the tolerance that
   * decides whether somebody is "at the end of the transcript". Appending it and then asking the
   * question pushed every reader over that line by the container's own height, and from then on the
   * answer never followed the bottom. `attach()` exists so the caller can ask first.
   */
  constructor(private readonly list: HTMLElement) {
    this.root = el("article", "entry assistant streaming");
    const head = el("div", "entry-head");
    head.append(el("span", "entry-who", "Hivey Code"));
    head.append(el("span", "entry-meta pulse", t("thinking…")));
    this.root.append(head);
    this.body = el("div", "entry-body");
    this.root.append(this.body);
  }

  attach(): void {
    this.list.append(this.root);
  }

  appendText(chunk: string): void {
    // The first word of the answer is the moment the thinking stops being the thing to watch.
    //
    // It is open while it is written — that is most of the reason for turning reasoning on, and a
    // shut block does not grow, so the panel had nothing to follow and sat on the previous answer
    // for the whole of it. Once the answer starts, the same block is in the way of it. So it folds
    // itself here, exactly once: reopening it is the reader's business, and a block that shut
    // itself again on the next token would be a block nobody can read.
    this.foldThinking();
    this.buffer += chunk;
    if (!this.text) {
      this.text = el("div", "live-text");
      this.body.append(this.text);
    }
    this.scheduleRender();
  }

  /** Shut the reasoning, once, when the answer takes over from it. */
  private foldThinking(): void {
    if (!this.thinking || this.thinking.folded) return;
    this.thinking.folded = true;
    this.thinking.body.hidden = true;
    this.thinking.wrap.classList.remove("open");
  }

  /**
   * How much of what has arrived is on screen.
   *
   * A model does not send words, it sends whatever fits in a packet: three tokens, then eleven,
   * then one. Painting each arrival is what makes an answer land in blocks — and reading is a
   * continuous act, so a text that arrives in jumps reads as a text that keeps interrupting itself.
   * Releasing characters at a steady rate costs nothing and turns the same stream into writing.
   *
   * Paced by the backlog, never by a fixed speed: a sixth of what is waiting per frame, so a fast
   * model is not held behind an animation and a slow one still moves. The reader is never made to
   * wait for the interface — which is the only rule that matters here, since this is decoration and
   * the answer is the point.
   */
  private shown = 0;
  private typing = false;

  private drain(): void {
    if (this.typing) return;
    this.typing = true;
    const step = (): void => {
      const backlog = this.buffer.length - this.shown;
      if (backlog <= 0) {
        this.typing = false;
        return;
      }
      this.shown = Math.min(this.buffer.length, this.shown + Math.max(3, Math.ceil(backlog / 6)));
      this.renderBuffer();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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
    // Someone who has asked for less movement gets the text as it arrives, with no pacing at all.
    // The animation is a nicety; motion sickness is not.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      this.shown = this.buffer.length;
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => {
        this.pending = false;
        this.shown = this.buffer.length;
        this.renderBuffer();
      });
      return;
    }
    this.drain();
  }

  private renderBuffer(): void {
    if (!this.text) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && this.text.contains(selection.anchorNode)) return;
    // No code actions while streaming: Copy and Compare on a block that is still being written
    // would act on half of it. They arrive with `finish()`, on the finished answer.
    const rendered = markdown(closeOpenFence(this.buffer.slice(0, this.shown)));
    rendered.className = "md live";
    // Wrapped, because this runs on every frame of the typing animation: the text grows here, so
    // this is the only place that knows where the bottom was a moment before it moved.
    following(() => this.text!.replaceChildren(...Array.from(rendered.childNodes)));
  }

  appendReasoning(chunk: string): void {
    // Through `following`, like the answer itself — and that was missing.
    //
    // While a model thinks, its reasoning is the only thing arriving, so it is the only thing that
    // can move the page. It was appended outside the follow, and into a block that started shut and
    // therefore did not grow at all: the panel sat on the previous answer for the whole of the
    // thinking, and only jumped once the first word of the answer appeared. "When the model thinks,
    // the chat does not go to the last message."
    following(() => {
      if (!this.thinking) {
        const wrap = reasoningBlock("", { open: true });
        const body = wrap.querySelector<HTMLElement>(".collapsible-body")!;
        // A reader who scrolls the box up has said where they want to be; one who scrolls it back to
        // the bottom has said to resume. Tracked on the box rather than guessed from the content,
        // because "did the user move this" is not answerable from the text that arrived.
        body.addEventListener("scroll", () => {
          // A pixel of tolerance: a fractional scrollHeight on a zoomed display never equals the sum.
          this.followThinking = body.scrollHeight - body.scrollTop - body.clientHeight <= 2;
        });
        this.thinking = { wrap, body };
        this.body.prepend(wrap);
      }
      this.thinking.body.textContent = (this.thinking.body.textContent ?? "") + chunk;
    });
    // ⚠️ And the block's OWN scroller, which `following` cannot reach. `.collapsible-body` is capped
    // at 260px with `overflow-y: auto`, so the page can be perfectly positioned while the reasoning
    // grows inside a box that never scrolls itself: you read the first screenful and the rest piles
    // up out of sight. Reported as « on reste bloqué en haut de sa phase de raisonnement au lieu de
    // defiler avec » — the page was following, the box was not.
    //
    // Not when the reader has scrolled it up themselves: someone re-reading an earlier line of the
    // thinking has said where they want to be, and yanking them back is worse than not following.
    const body = this.thinking?.body;
    if (body && this.followThinking) body.scrollTop = body.scrollHeight;
  }

  /** Whether the reasoning box still follows its own tail. False once the reader scrolls it. */
  private followThinking = true;

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
    following(() => {
      if (this.planNode) this.planNode.replaceWith(next);
      else this.body.prepend(next);
    });
    this.planNode = next;
  }

  /**
   * A step, and always above the answer.
   *
   * It used to be appended to the end of the turn, so the steps sat wherever the writing happened
   * to be: text started, a step landed under it, more text went back above it. And at the end the
   * turn is redrawn from the record, where steps are drawn ABOVE the answer — so everything moved
   * one last time, exactly when the reader had settled on it. One container, placed once, and
   * nothing shifts.
   */
  private steps?: HTMLElement;

  private stepsHost(): HTMLElement {
    if (!this.steps) {
      this.steps = el("div", "steps");
      if (this.text) this.body.insertBefore(this.steps, this.text);
      else this.body.append(this.steps);
    }
    return this.steps;
  }

  appendStatus(text: string, tool?: string, ok?: boolean, call?: string): void {
    if (!tool) {
      // Progress from a tool that is still running, not the result of one. It is a passing remark,
      // so it replaces the last one rather than stacking.
      const row = el("div", "step");
      row.append(el("span", "step-ico dot", "·"));
      row.append(el("span", "step-summary", text));
      following(() => this.stepsHost().append(row));
      return;
    }
    const row = stepRow({ tool, summary: text, ok: ok !== false, ...(call ? { call } : {}) });
    following(() => this.stepsHost().append(row));
  }

  appendError(message: string): void {
    following(() => this.body.append(el("div", "error", message)));
  }

  /** The approval card: four answers, because "yes" and "yes forever" are different decisions. */
  /** The authoritative render: the finished text, with the actions that act on it. */
  finish(): void {
    // Whatever is still queued lands at once. An answer that has finished arriving is finished, and
    // an animation still typing it out would be the interface pretending to think.
    this.shown = this.buffer.length;
    this.typing = false;
    if (this.text && this.buffer) {
      const rendered = markdown(this.buffer, {
        onCopy: (code) => send({ type: "copy", text: code }),
        onInsert: (code) => send({ type: "insertCode", code }),
        onInsertAtCursor: (code) => send({ type: "insertCode", code, atCursor: true }),
        onApply: (code, language) => send({ type: "applyCode", code, language }),
      });
      // The last movement of the turn, and the one most likely to be under the reader's eyes: the
      // whole answer is re-rendered at once, with its code actions, so it changes height.
      following(() => this.text!.replaceWith(rendered));
      this.text = undefined;
    }
    this.root.classList.remove("streaming");
  }
}

/**
 * Close a fence the model has opened and not yet closed.
 *
 * Mid-stream, an answer is routinely cut in the middle of a code block. Handed to the renderer as
 * it stands, the opening ``` has no partner, so the block is not recognized and its contents render
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
  // Through `following`, and this is not a tidy-up. The turn's own container — a header, a name, a
  // line of padding — is taller than the tolerance that decides whether the reader is "at the end".
  // Appended first and asked afterwards, as it was, it pushed the reader over that line by its own
  // height: every following frame then measured "they have scrolled up" and the answer never
  // followed the bottom once. The question has to be asked before the container exists.
  const turn = new LiveTurn(list);
  following(() => turn.attach());
  live = turn;
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
function atBottom(list: Element): boolean {
  return atEnd(measure(list));
}

/** The three numbers the rule is made of, read off an element. */
function measure(list: Element): Viewport {
  return { scrollHeight: list.scrollHeight, scrollTop: list.scrollTop, clientHeight: list.clientHeight };
}

/**
 * Make a change to the transcript while keeping the reader at the end — if that is where they were.
 *
 * The distinction from `scrollToEnd` is WHEN the question is asked. That one schedules a frame and
 * then looks at where the list is, which is after the change has landed; and since the answer is
 * now released character by character, every frame added a line or two to a list already at its
 * end — so by the time the check ran, the reader was a line and a half above the bottom and the
 * follow stopped. Fifty frames later they were reading the middle of an answer whose end was
 * somewhere below. The measurement has to be taken BEFORE the text grows, and applied after.
 *
 * The rule itself is unchanged and is the only one that matters here: the transcript follows the
 * answer while you are at the bottom, and never moves you once you have gone up to re-read
 * something. Which is why this is not a setting — it is the reader's own scroll position that says
 * which of the two they want, every time.
 */
function following(mutate: () => void): void {
  const list = document.querySelector<HTMLElement>(".transcript");
  if (!list) {
    mutate();
    return;
  }
  const before = measure(list);
  // Only for a reader who is NOT at the end — the one this protects. An agent turn writes its step
  // lines and its plan ABOVE the answer, so every tool that runs inserts rows over their head and
  // pushes what they are reading further down the document. Their pixel offset does not change and
  // the content at it does, which is the transcript wandering up into older messages on its own.
  const anchorNode = atEnd(before) ? undefined : topmostVisible(list);
  const anchorBefore = anchorNode ? contentOffset(list, anchorNode) : 0;

  mutate();

  const after = measure(list);
  // A mutation that removed the anchor leaves nothing to measure against, and moving the reader on
  // a guess is worse than leaving them.
  const anchor =
    anchorNode && anchorNode.isConnected ? { before: anchorBefore, after: contentOffset(list, anchorNode) } : undefined;
  const place = placeAfterChange(before, after, anchor);
  if (place !== undefined) list.scrollTop = place;
  // Asked of the list rather than inferred from `place`, because those stopped being the same
  // question: a compensated reader has a position applied to them AND is still away from the end,
  // and inferring would have hidden the button that tells them an answer is being written.
  showJumpButton(!atBottom(list));
}

/** Where a node sits within the scrolled content, independent of where the content is scrolled to. */
function contentOffset(list: HTMLElement, node: Element): number {
  return node.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
}

/**
 * The element at the top of what the reader can see.
 *
 * Their anchor: whatever happens above it, this is the thing that must not move on the glass. Top
 * level children only — an entry, the live turn — because those are what the transcript inserts
 * between, and because a deeper node is liable to be replaced by the very mutation being measured.
 */
function topmostVisible(list: HTMLElement): Element | undefined {
  const top = list.scrollTop;
  for (const child of Array.from(list.children)) {
    const start = contentOffset(list, child);
    if (start + child.getBoundingClientRect().height > top) return child;
  }
  return undefined;
}

function scrollToEnd(force = false): void {
  const apply = (): void => {
    const list = document.querySelector<HTMLElement>(".transcript");
    if (!list) return;
    if (!force && !atBottom(list)) {
      showJumpButton(true);
      return;
    }
    list.scrollTop = list.scrollHeight;
    showJumpButton(false);
  };
  // Now, and again after layout. Waiting only for the frame left a window in which the transcript
  // sat at zero; anything that measured during it concluded the reader had scrolled up.
  apply();
  requestAnimationFrame(apply);
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
  if (existing) {
    // It is the same button, but not always saying the same thing: an answer that started arriving
    // after the reader scrolled up has to be announced on the control that goes to it, or the only
    // way to know something is being written is to guess.
    markAnswering(existing);
    return;
  }
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
    title: t("Go to the end of the conversation"),
    onClick: () => scrollToEnd(true),
  });
  markAnswering(jump);
  host.append(jump);
}

/**
 * Say, on the button itself, that an answer is being written down there.
 *
 * A reader who has scrolled up loses the only signal that the turn is still going — the text
 * growing at the bottom. The button that takes them back is the one control they are already
 * looking for, so it is where that belongs: a ring that breathes, and a title that says why. The
 * button does not MOVE, because it lives in a strip a few pixels tall between the last answer and
 * the composer, and anything moving there touches one of the two.
 */
function markAnswering(jump: HTMLElement): void {
  const answering = isStreaming();
  jump.classList.toggle("answering", answering);
  jump.title = answering ? t("Answering… go to the end of the conversation") : t("Go to the end of the conversation");
}

/** The button's state after the turn started or ended, without waiting for the reader to scroll. */
function refreshJumpButton(): void {
  const list = document.querySelector<HTMLElement>(".transcript");
  if (list) showJumpButton(!atBottom(list));
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

/**
 * Paint the panel with Hivey's palette, or with the editor's.
 *
 * ⚠️ TWO THINGS MEASURED FROM A CAPTURE, both of which changed what this does.
 *
 * First, the attribute belongs here and not only on the `<html>` the extension builds: that HTML is
 * produced once, and a panel already open does not rebuild it, so changing the setting appeared to do
 * nothing.
 *
 * Second — and this is the honest limit — the panel's BASE BACKGROUND is not painted by our
 * stylesheet. VS Code paints the webview's own surface outside the document we control, so the Hivey
 * appearance restyles what this stylesheet draws (surfaces, borders, accents, states) on top of the
 * editor's base. That was found the only way it could be: the capture came back with the accents
 * changed and the background identical.
 *
 * Which is why a LIGHT theme keeps the editor's appearance whatever the setting says. A palette tuned
 * for a dark base, laid over a light one we cannot change, is not a style — it is a contrast failure,
 * and the setting would be a way to make the panel unreadable.
 */
function applyAppearance(wanted: "editor" | "hivey"): void {
  const light = document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light");
  document.documentElement.dataset["appearance"] = wanted === "hivey" && !light ? "hivey" : "editor";
}

window.addEventListener("message", (event: MessageEvent<ToPanel>) => {
  const m = event.data;
  switch (m.type) {
    case "state":
      state = m.state;
      // ⚠️ From the page, on every state. The attribute on `<html>` is written when the HTML is
      // BUILT, which is once — and a panel that is already open does not rebuild, so the setting
      // appeared to do nothing. This is the half that cannot fail, and it is also what lets the
      // appearance change without a reload.
      applyAppearance(m.state.appearance ?? "editor");
      applyMinWidth(m.state.panelMinWidth);
      // The extension is the authority on whether a turn is running. A panel that believed its own
      // flag could sit on a stop button for the rest of the conversation with nothing behind it.
      setStreaming(m.state.busy);
      render();
      break;
    case "turnStart":
      setStreaming(true);
      render();
      ensureLive();
      refreshJumpButton();
      break;
    case "turnEnd":
      setStreaming(false);
      live?.finish();
      // Re-rendered, so the composer returns to rest now rather than whenever the next state
      // message happens to arrive: the ring used to keep turning after the turn had ended.
      render();
      refreshJumpButton();
      break;
    case "delta":
      // No scroll here: the text is not on screen yet. It is released frame by frame by the typing
      // animation, and each of those frames follows the end itself — see `following`.
      ensureLive().appendText(m.text);
      break;
    case "reasoning":
      ensureLive().appendReasoning(m.text);
      break;
    case "plan":
      ensureLive().setPlan(m.plan);
      break;
    case "status":
      // Only into a turn that exists. `ensureLive()` CREATES one when there is none, so a message on
      // this channel outside a turn did not report on the conversation — it invented a turn to
      // report in, and the panel sat there apparently thinking. Anything with news to give outside a
      // turn has the editor's own places to give it.
      if (!live && !isStreaming()) break;
      ensureLive().appendStatus(m.text, m.tool, m.ok, m.call);
      break;
        case "error":
      ensureLive().appendError(m.message);
      setStreaming(false);
      break;
    case "dictated": {
      dictationStopped();
      // Into the composer, never sent. A recogniser mis-hears, and a dictated question that sends
      // itself is a question nobody proof-read — which is also what makes a wrong transcription a
      // non-event instead of a wasted turn.
      setComposerNote("");
      const area = document.querySelector<HTMLTextAreaElement>(".composer-input");
      if (area) {
        // Appended to what is already there, with a space: dictating a second sentence after typing
        // the first is an ordinary thing to do, and replacing the draft would destroy it.
        const existing = area.value.trimEnd();
        area.value = existing ? `${existing} ${m.text}` : m.text;
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
        area.dispatchEvent(new Event("input"));
      }
      break;
    }
    // ⚠️ A one-off install of 85 MB over a home connection. A note that cannot change is
    // indistinguishable from a hang, and somebody who has just spoken a sentence is watching it.
    case "dictationStarted":
      dictationStarted();
      break;
    case "dictationLevel":
      setLevel(m.level);
      break;
    case "dictationProgress":
      setComposerNote(m.what);
      break;
    case "dictationFailed":
      // Fades: it describes a moment that has passed, and nothing else was going to clear it — a
      // failed dictation sends nothing more, so the line sat there for the rest of the session.
      dictationStopped();
      setComposerNote(m.why, NOTE_FADE_MS);
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
  // The innermost thing first: a menu opened over the search bar closes before the bar does.
  if (ev.key === "Escape") {
    // A recording in flight is the innermost thing of all, and the one where Escape has to mean
    // "throw it away": somebody who changes their mind mid-sentence has not asked for their voice to
    // be transcribed anywhere.
    if (cancelDictation(deps)) {
      ev.preventDefault();
    } else if (menuIsOpen()) {
      closeMenu();
    } else if (searchOpen) {
      closeSearch();
      render();
    }
  }
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
/**
 * The floor below which the panel scrolls sideways rather than rearranging itself.
 *
 * ⚠️⚠️ Applied as a style PROPERTY, from script, and the distinction is the entire bug. This used to be
 * `<body style="min-width:…px">` in the HTML the extension builds — and `style-src` without
 * `'unsafe-inline'` forbids exactly that, while this panel's CSP has no `'unsafe-inline'` on purpose
 * because a model's output is rendered in this document. The floor was therefore declared in the one
 * place the document's own policy guarantees will be discarded, and it was discarded, for a release:
 * « on peut la reduire au maximum sans quelle se bloque alors que j'ai demandé un bloquage de largeur
 * minimum ». No test could see it, because the markup was exactly right.
 *
 * The same policy does NOT block assigning a property on `element.style`. It does block `cssText` and
 * `setAttribute("style", …)`, which are the attribute by another name — so neither may be used here,
 * and a guard in `tests/panelFocus.test.ts` refuses them.
 *
 * ⚠️ This is a floor on the CONTENT, not a lock on the side bar. VS Code offers an extension no way to
 * set a minimum width for a view (microsoft/vscode#182201 is still open), so what this buys is that
 * the layout stops shrinking and the panel scrolls sideways instead of silently reflowing into
 * something unusable. Nothing in an extension can stop the divider being dragged.
 */
function applyMinWidth(px: number | undefined): void {
  // Zero is a deliberate value — "let it shrink as far as it likes" — and `undefined` is an older
  // extension host that does not send it. They must not collapse into each other.
  if (px === undefined) return;
  document.body.style.minWidth = `${Math.max(0, Math.round(px))}px`;
}

/**
 * How wide the page actually is, published as a CSS variable.
 *
 * ⚠️ MEASURED, not computed. The composer was sized `100vw` — which counts the vertical scrollbar —
 * and then `100vw` minus the scrollbar's measured width, which was closer and still wrong: it left
 * 19 px of air on the right against 13 on the left, reported as « il y a un plus d'espace a droite
 * que a gauche ». Two measurements subtracted from each other carry both their errors.
 *
 * `documentElement.clientWidth` is the one number that answers the question directly: the width
 * inside the scrollbar, which is the width the composer may occupy. Re-read on resize, because that
 * is the only time it changes.
 */
function publishPanelWidth(): void {
  const set = () =>
    document.documentElement.style.setProperty("--panel-width", `${document.documentElement.clientWidth}px`);
  set();
  window.addEventListener("resize", set);
}
publishPanelWidth();

function publishScrollbarWidth(): void {
  const probe = document.createElement("div");
  // ⚠️ Property by property, not `cssText`. `cssText` is the style attribute under another name and
  // this document's CSP forbids it, so the probe used to be a plain `<div>` of no particular size:
  // `offsetWidth - clientWidth` was 0 - 0, the gutter was published as `0px`, and the defect this
  // function exists to fix — the composer sitting a scrollbar's width wider than every answer above
  // it — was never actually fixed. Two of these in one file, found by looking for the first.
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.overflowY = "scroll";
  probe.style.width = "60px";
  probe.style.height = "60px";
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  document.documentElement.style.setProperty("--scrollbar-gutter", `${width}px`);
}
publishScrollbarWidth();

send({ type: "ready" });
export { isStreaming };
