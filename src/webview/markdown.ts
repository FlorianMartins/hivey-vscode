// Markdown → DOM. Not markdown → HTML: the difference is the whole security posture of the panel.
//
// It covers what a coding assistant actually emits — fenced code, inline code, bold, italic,
// headings, lists, numbered lists, blockquotes and links — and renders everything else as literal
// text. A link is rendered as text plus its target, never as a clickable remote URL: the panel has
// `default-src 'none'`, and a link that cannot be followed is better than one that exfiltrates.

import { button, el, ICON } from "./dom.js";
import { t } from "../shared/i18n.js";
// Named on import: `highlight` is already this file's word for the search term being
// wrapped in <mark>, and two meanings of one word in one file is how a bug hides.
import { highlight as highlightCode } from "../core/markdown/highlight.js";

export interface CodeActions {
  onCopy(code: string): void;
  /** Replace what is selected in the editor. */
  onInsert(code: string): void;
  /** Drop it in at the caret, changing nothing that is already there. */
  onInsertAtCursor(code: string): void;
  onApply(code: string, language: string): void;
}

export function markdown(text: string, actions?: CodeActions, highlight?: string): HTMLElement {
  const body = el("div", "md");
  const lines = text.split("\n");
  let i = 0;
  let paragraph: string[] = [];

  const flush = () => {
    if (!paragraph.length) return;
    body.append(inline(paragraph.join("\n"), "p", highlight));
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = line.match(/^\s*```([a-zA-Z0-9+#._-]*)\s*$/);
    if (fence) {
      flush();
      const lang = fence[1] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      body.append(codeBlock(code.join("\n"), lang, actions));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(4, heading[1]!.length + 2);
      const node = inline(heading[2]!, `h${level}` as "h4", highlight);
      node.classList.add("md-h");
      body.append(node);
      i++;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flush();
      const block = el("blockquote", "md-quote");
      while (i < lines.length) {
        const q = lines[i]!.match(/^>\s?(.*)$/);
        if (!q) break;
        block.append(inline(q[1]!, "p", highlight));
        i++;
      }
      body.append(block);
      continue;
    }

    // A horizontal rule. Models use it to separate an answer from its caveats, and rendering it as
    // three literal dashes turns a deliberate break into what looks like a typo.
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flush();
      body.append(el("hr", "md-rule"));
      i++;
      continue;
    }

    // A table. Worth having because of what a coding assistant puts in one — a column of file
    // names against a column of what to do to them — which as pipe-separated text is the least
    // readable thing on the screen and as a table is the most.
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1]!)) {
      flush();
      const rows: string[][] = [splitRow(line)];
      const align = alignments(lines[i + 1]!);
      i += 2;
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(splitRow(lines[i++]!));
      body.append(table(rows, align, highlight));
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flush();
      const list = el(numbered ? "ol" : "ul", "md-list");
      while (i < lines.length) {
        const b = lines[i]!.match(/^\s*[-*+]\s+(.*)$/);
        const n = lines[i]!.match(/^\s*\d+[.)]\s+(.*)$/);
        if (!b && !n) break;
        const content = (b?.[1] ?? n?.[1])!;
        // `- [ ]` and `- [x]`: a plan the assistant wrote, with the done parts marked. Rendered as
        // a real box because the alternative — the literal characters — is read as an array index.
        const task = content.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          const item = inline(task[2]!, "li", highlight);
          item.classList.add("md-task", task[1] === " " ? "todo" : "done");
          item.prepend(el("span", "md-check", task[1] === " " ? "\u25A2" : "\u2611"));
          list.append(item);
        } else {
          list.append(inline(content, "li", highlight));
        }
        i++;
      }
      body.append(list);
      continue;
    }

    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    paragraph.push(line);
    i++;
  }
  flush();
  return body;
}

/** Inline spans: `code`, **bold**, *italic*, [texte](cible). Everything else stays literal. */
export function inline<K extends keyof HTMLElementTagNameMap>(
  text: string,
  tag: K,
  highlight?: string,
): HTMLElementTagNameMap[K] {
  const node = el(tag);
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) appendText(node, text.slice(last, m.index), highlight);
    const token = m[0];
    // Code is the one span whose contents are LITERAL: backticks mean "what is inside is text".
    if (token.startsWith("`")) node.append(el("code", "md-code", token.slice(1, -1)));
    // Everything else nests, and used to not.
    //
    // `**a `x` b**` came out as the literal characters `a \`x\` b` in bold, because the bold branch
    // set its contents as TEXT. Emphasis containing an identifier is not an edge case in an answer
    // about code — it is most of the bold in one — and the failure was the exact thing markdown
    // exists to avoid: showing its own punctuation.
    else if (token.startsWith("**") || token.startsWith("__")) node.append(nested("strong", token.slice(2, -2), highlight));
    else if (token.startsWith("~~")) node.append(nested("del", token.slice(2, -2), highlight, "md-del"));
    else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      const target = token.slice(token.indexOf("](") + 2, -1);
      const link = el("span", "md-link", label);
      // Shown, not followed: the panel forbids remote origins, and a live link would be a way out.
      link.title = target;
      node.append(link);
    } else node.append(nested("em", token.slice(1, -1), highlight));
    last = m.index + token.length;
  }
  if (last < text.length) appendText(node, text.slice(last), highlight);
  return node;
}

/**
 * An emphasis span whose contents are parsed in turn.
 *
 * Bounded by construction rather than by a depth counter: the recursion is on a strictly shorter
 * string every time — the delimiters are removed before recursing — so it terminates whatever the
 * input, including the pathological one a model occasionally emits.
 */
function nested<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
  highlight?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = inline(text, tag, highlight);
  if (className) node.className = className;
  return node;
}

/** Text, with the search term wrapped in a <mark> when there is one. */
function appendText(node: HTMLElement, text: string, highlight?: string): void {
  if (!highlight) {
    node.append(document.createTextNode(text));
    return;
  }
  const needle = highlight.toLocaleLowerCase("fr");
  const hay = text.toLocaleLowerCase("fr");
  let from = 0;
  let at = hay.indexOf(needle);
  while (at >= 0) {
    if (at > from) node.append(document.createTextNode(text.slice(from, at)));
    node.append(el("mark", "hit", text.slice(at, at + highlight.length)));
    from = at + highlight.length;
    at = hay.indexOf(needle, from);
  }
  if (from < text.length) node.append(document.createTextNode(text.slice(from)));
}

export function codeBlock(code: string, lang: string, actions?: CodeActions): HTMLElement {
  const wrap = el("div", "code-block");
  const head = el("div", "code-head");
  head.append(el("span", "code-lang", lang || t("text")));

  if (actions) {
    const tools = el("div", "code-tools");
    // Three ways to take the code, and they are genuinely three different intentions: put it where
    // I am typing, put it over what I selected, or show me what it would change. The first was
    // missing, and it is the one people reach for most — there is usually no selection.
    tools.append(
      button({ icon: ICON.copy, title: t("Copy this block"), className: "btn icon-only", onClick: () => actions.onCopy(code) }),
      button({
        label: t("At the cursor"),
        title: t("Insert at the caret, changing nothing already there"),
        className: "btn tiny",
        onClick: () => actions.onInsertAtCursor(code),
      }),
      button({ label: t("Replace"), title: t("Replace what is selected in the editor"), className: "btn tiny", onClick: () => actions.onInsert(code) }),
      button({ label: t("Compare"), title: t("Open as a diff against the active file"), className: "btn tiny", onClick: () => actions.onApply(code, lang) }),
    );
    head.append(tools);
  }

  const pre = el("pre", "code");
  const node = el("code");
  // Colour comes from the theme, always. Each token kind maps to a CSS class and the stylesheet
  // maps that class to one of VS Code's own variables, so a snippet reads correctly on a light
  // theme, a dark one and a high-contrast one without this file knowing which is installed.
  for (const token of highlightCode(code, lang)) {
    if (token.kind === "plain") node.append(document.createTextNode(token.text));
    else node.append(el("span", `tok-${token.kind}`, token.text));
  }
  pre.append(node);
  wrap.append(head, pre);
  return wrap;
}

// ── Tables ───────────────────────────────────────────────────────────────────────────────────

function isTableRow(line: string): boolean {
  return /\|/.test(line) && /^\s*\|?[^|]*\|/.test(line);
}

/** `|---|:--:|` — the line that turns three pipe-separated lines into a table rather than prose. */
function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function alignments(divider: string): Array<"left" | "center" | "right"> {
  return splitRow(divider).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : "left";
  });
}

function table(rows: string[][], align: Array<"left" | "center" | "right">, hl?: string): HTMLElement {
  // Wrapped in its own scroller. A table of file paths is wider than a docked side bar, and a table
  // that widens the panel pushes the composer off the edge — which is a worse failure than a table
  // the reader has to scroll.
  const wrap = el("div", "md-table-wrap");
  const node = el("table", "md-table");
  const head = el("thead");
  const headRow = el("tr");
  for (const [i, cell] of (rows[0] ?? []).entries()) {
    const th = inline(cell, "th", hl);
    th.style.textAlign = align[i] ?? "left";
    headRow.append(th);
  }
  head.append(headRow);
  node.append(head);

  const bodyRows = el("tbody");
  for (const row of rows.slice(1)) {
    const tr = el("tr");
    for (const [i, cell] of row.entries()) {
      const td = inline(cell, "td", hl);
      td.style.textAlign = align[i] ?? "left";
      tr.append(td);
    }
    bodyRows.append(tr);
  }
  node.append(bodyRows);
  wrap.append(node);
  return wrap;
}
