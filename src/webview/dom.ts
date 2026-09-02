// The panel's building blocks.
//
// Everything is built with `createElement` and `textContent`. Nothing in this file — and nothing in
// any screen that uses it — ever assigns `innerHTML`, because a good part of what is rendered here
// was written by a language model, and a model can be steered by a file it just read. A code block
// containing `<img onerror=…>` must render as those characters and do nothing else.

import { language, t } from "../shared/i18n.js";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export interface ButtonOptions {
  label?: string;
  title?: string;
  icon?: IconName;
  /** Drawn after the label — the chevron of a control that opens a menu. */
  trailingIcon?: IconName;
  className?: string;
  onClick: (ev: MouseEvent) => void;
  disabled?: boolean;
  pressed?: boolean;
}

export function button(opts: ButtonOptions): HTMLButtonElement {
  const b = el("button", opts.className ?? "btn");
  if (opts.icon) b.append(icon(opts.icon));
  if (opts.label) b.append(el("span", "lbl", opts.label));
  if (opts.trailingIcon) b.append(icon(opts.trailingIcon, "ico trailing"));
  if (opts.title) {
    b.title = opts.title;
    b.setAttribute("aria-label", opts.title);
  }
  if (opts.disabled) b.disabled = true;
  if (opts.pressed !== undefined) b.setAttribute("aria-pressed", String(opts.pressed));
  b.addEventListener("click", opts.onClick);
  return b;
}

/**
 * Icons, drawn rather than typed.
 *
 * The first version of this panel used Unicode glyphs — ✎, ⧉, ⌾ — and half of them rendered as
 * empty boxes in the editor's UI font. A webview cannot use the editor's codicon font without
 * shipping it, so the icons are inline SVG paths on a 16×16 grid, inheriting `currentColor`. They
 * always render, they scale, and they cost nothing.
 */
const PATHS = {
  // An arrow up, not a paper plane. The plane is a mail metaphor from a mail client — it says "this
  // goes off somewhere and you will hear back later", which is the opposite of what a chat does.
  // Every serious assistant's composer settled on the same glyph for the same reason: the message
  // goes UP, into the conversation above the box you are typing in.
  send: "M8 12.75V4.25M4.25 8 8 4.25 11.75 8",
  stop: "M4 4h8v8H4z",
  add: "M8 3v10M3 8h10",
  history: "M8 3a5 5 0 1 1-4.9 4M3 3v3h3M8 5.5V8l2 1.5",
  search: "M7 3.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6ZM10 10l3 3",
  close: "M4 4l8 8M12 4l-8 8",
  chevron: "M4 6.5 8 10.5 12 6.5",
  chevronLeft: "M10 3.5 5.5 8 10 12.5",
  file: "M4 2h5l3 3v9H4zM9 2v3h3",
  check: "M3.5 8.5 6.5 11.5 12.5 4.5",
  cross: "M4 4l8 8M12 4l-8 8",
  mute: "M3.5 3.5l9 9M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8Z",
  unmute: "M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8Z",
  pin: "M6 2h4l-.6 4L12 8.5H4L6.6 6ZM8 8.5V14",
  edit: "M3 13h3l7-7-3-3-7 7zM9.5 3.5l3 3",
  copy: "M6 2h6v8H6zM4 6H2v8h6v-2",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13.5h6l.5-9M7 7v4M9 7v4",
  settings: "M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4",
  shield: "M8 2 13 4v4.2C13 11 10.8 13.3 8 14.2 5.2 13.3 3 11 3 8.2V4Z",
  attach: "M8 3v10M3 8h10",
  // Four rays around a point: the editor's own mark for "the assistant did something", used here
  // where the panel is offering rather than reporting.
  sparkle: "M8 2.5 9.1 6.4 13 7.5 9.1 8.6 8 12.5 6.9 8.6 3 7.5 6.9 6.4Z",
  // An arrow coming down into a tray: "bring this in here". Distinct from `attach`, which is a
  // plus sign — next to a wastebasket in the history, a plus reads as "new", which is the opposite
  // of what the button does.
  bringIn: "M8 2v7M5.2 6.2 8 9.2l2.8-3M3 11.5v2h10v-2",
  // A forward arrow curving into a new line: "send this over there". The tray-with-a-down-arrow it
  // replaces says "download", which is what people read it as — the direction was right and the
  // destination was wrong.
  forward: "M9.5 3 13.5 7 9.5 11M13 7H6.5A3.5 3.5 0 0 0 3 10.5V13",
  // An arrow turning back on itself: the workbench's own shape for "undo this", used here for
  // going back to before a question.
  restore: "M3.5 7.5a5 5 0 1 1 1.6 4.4M3.5 4v3.5H7",
  // A spanner: the workbench's own mark for "configure the tools this thing may use", which is
  // exactly what the skills picker is.
  // A wand with a spark: what a skill IS — a named thing you invoke that changes what the assistant
  // does. The spanner it replaces says "settings", which sent people looking for a preferences page.
  // Sliders. The workbench's own shape for "configure this", legible at 14 px in a way a wrench is
  // not, and unambiguous in a row where every other icon is an action: two of the three glyphs I
  // tried here read as "settings page" (a gear) or as "magic" (a wand), and this one reads as
  // "adjust what is on".
  tools: "M2 5.5h2.5M7.5 5.5H14M2 10.5h6.5M11.5 10.5H14M7.5 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1 3 0M11.5 10.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1 3 0",
  // A small chip: the model, and where it runs.
  chip: "M5.5 5.5h5v5h-5zM3 6.5h2.5M3 9.5h2.5M10.5 6.5H13M10.5 9.5H13M6.5 3v2.5M9.5 3v2.5M6.5 10.5V13M9.5 10.5V13",
  more: "M4 8a1 1 0 1 0 0-.01M8 8a1 1 0 1 0 0-.01M12 8a1 1 0 1 0 0-.01",
} as const;

/**
 * Icons drawn by filling rather than by stroking.
 *
 * The ellipsis was three zero-length segments with round caps, which at stroke-width 1.3 produces
 * three dots 1.3 px across — a quarter of the ink of any other icon in the row, and it read as
 * disabled next to them. The colour was never wrong: it is `currentColor`, the same as its
 * neighbours. A dot has to be filled to have the weight of a line.
 */
const FILLED = new Set<IconName>(["more", "sparkle"]);

/* Drawn a shade heavier. On the accent-filled send button a 1.3 px stroke is a thin white scratch
   on a saturated square; the same weight that reads as delicate among grey icons reads as unfinished
   there. */
const BOLD = new Set<IconName>(["send"]);

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = "ico"): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", PATHS[name]);
  if (FILLED.has(name)) {
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
  } else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", BOLD.has(name) ? "1.7" : "1.3");
  }
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

/** Names, so screens read `ICON.trash` rather than a string literal that can go stale. */
export const ICON: Record<
  | "send" | "stop" | "add" | "history" | "search" | "close" | "chevron" | "chevronLeft" | "file"
  | "check" | "cross" | "mute" | "unmute" | "pin" | "edit" | "copy" | "trash" | "settings"
  | "shield" | "attach" | "sparkle" | "bringIn" | "forward" | "restore" | "tools" | "chip" | "more" | "back",
  IconName
> = {
  send: "send",
  stop: "stop",
  add: "add",
  history: "history",
  search: "search",
  close: "close",
  chevron: "chevron",
  chevronLeft: "chevronLeft",
  back: "chevronLeft",
  file: "file",
  check: "check",
  cross: "cross",
  mute: "mute",
  unmute: "unmute",
  pin: "pin",
  edit: "edit",
  copy: "copy",
  trash: "trash",
  settings: "settings",
  shield: "shield",
  attach: "attach",
  sparkle: "sparkle",
  bringIn: "bringIn",
  forward: "forward",
  restore: "restore",
  tools: "tools",
  chip: "chip",
  more: "more",
};

/** A popover anchored under its trigger. Only one is open at a time, and Escape closes it. */
let openMenu: HTMLElement | undefined;

export function closeMenu(): void {
  openMenu?.remove();
  openMenu = undefined;
}

export function menu(anchor: HTMLElement, build: (close: () => void) => HTMLElement): void {
  closeMenu();
  const panel = el("div", "menu");
  panel.append(build(closeMenu));
  document.body.append(panel);
  openMenu = panel;

  const rect = anchor.getBoundingClientRect();
  // Prefer opening upwards: the triggers live at the bottom of the panel, next to the composer.
  const height = panel.offsetHeight;
  const top = rect.top - height - 6 > 8 ? rect.top - height - 6 : rect.bottom + 6;
  panel.style.top = `${Math.max(8, top)}px`;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - panel.offsetWidth - 8);
  panel.style.left = `${left}px`;

  const onAway = (ev: MouseEvent) => {
    if (!panel.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) {
      closeMenu();
      document.removeEventListener("mousedown", onAway);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", onAway), 0);
}

export function menuItem(opts: {
  label: string;
  hint?: string;
  detail?: string;
  selected?: boolean;
  onClick: () => void;
}): HTMLElement {
  const row = el("button", `menu-item${opts.selected ? " selected" : ""}`);
  const main = el("div", "menu-item-main");
  main.append(el("span", "menu-item-label", opts.label));
  if (opts.detail) main.append(el("span", "menu-item-detail", opts.detail));
  row.append(main);
  if (opts.hint) row.append(el("div", "menu-item-hint", opts.hint));
  row.addEventListener("click", opts.onClick);
  return row;
}

export function menuTitle(text: string): HTMLElement {
  return el("div", "menu-title", text);
}

export function separator(): HTMLElement {
  return el("div", "menu-sep");
}

/** A text input with a leading glyph — search boxes, filter boxes. */
export function searchInput(opts: {
  value: string;
  placeholder: string;
  onInput: (value: string) => void;
  onEscape?: () => void;
}): HTMLElement {
  const wrap = el("div", "search");
  wrap.append(icon("search", "search-ico"));
  const input = el("input", "search-input");
  input.type = "text";
  input.value = opts.value;
  input.placeholder = opts.placeholder;
  input.addEventListener("input", () => opts.onInput(input.value));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && opts.onEscape) {
      ev.preventDefault();
      opts.onEscape();
    }
  });
  wrap.append(input);
  if (opts.value) {
    wrap.append(
      button({
        icon: ICON.close,
        title: t("Clear"),
        className: "btn icon-only",
        onClick: () => opts.onInput(""),
      }),
    );
  }
  return wrap;
}

/** `il y a 3 min`, `hier`, `12 mars` — dates a human reads without doing arithmetic. */
export function relativeDate(at: number, now = Date.now()): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 60) return t("just now");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("{0} min ago", minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{0} h ago", hours);
  const days = Math.round(hours / 24);
  if (days === 1) return t("yesterday");
  if (days < 7) return t("{0} days ago", days);
  return new Date(at).toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

/** The editor's locale, for anything Intl formats: dates, numbers, prices. */
export function locale(): string {
  return language() === "fr" ? "fr-FR" : "en-GB";
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n);
}

/** Prices are per million tokens; below a cent they need three decimals to mean anything. */
export function formatPrice(usd: number): string {
  if (!usd) return t("free");
  if (usd < 1) return `${usd.toFixed(2)} $`;
  return `${usd.toFixed(usd < 10 ? 1 : 0)} $`;
}

export function formatContext(tokens: number): string {
  if (!tokens) return "—";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)} M`;
  return `${Math.round(tokens / 1000)} k`;
}
