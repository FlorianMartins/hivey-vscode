// The model picker, in the shape the Hivey sidebar settled on.
//
// It is not a dropdown. A dropdown works when there are eight options; the catalogue here is four
// hundred, spread across vendors, priced across three orders of magnitude, and half of them are
// irrelevant to whatever the user is doing right now. What that needs is a small search interface,
// and the sidebar's answer — a read-only trigger that opens a floating panel holding a metric
// header, its own search box, grouped rows and a filter panel — is carried over here unchanged in
// structure:
//
//   ┌─ trigger: the CURRENT model, never an editable field ─────────┐
//   │ ▸ header  🎯 quality  💰 price   ⇅ sort   ⚙ filter            │
//   │ ▸ search  (inside the panel, keeps focus across redraws)      │
//   │ ▸ rows    grouped by vendor · name … badge(quality · price)   │
//   │ ▸ filter  price buckets + providers, collapsible              │
//   └───────────────────────────────────────────────────────────────┘
//
// Two things are deliberately different from the sidebar, and both are about being in an editor
// rather than in a browser:
//
//   • COLOUR COMES FROM THE THEME. The sidebar hard-codes #34d399 and friends because a native
//     <option> cannot be styled. Here the rows are real elements, so a band maps to one of VS
//     Code's own chart colours and the picker reads correctly on light, dark and high-contrast
//     themes without knowing which one is on.
//   • THE QUALITY METRIC FOLLOWS THE MODE. The sidebar ranks by the active tab's specialty; the
//     equivalent here is the mode, so switching from chat to agent re-ranks the list by how well
//     each model drives a tool loop rather than by how well it answers a question.

import { button, el, formatContext, icon, ICON } from "./dom.js";
import { prefs, setPrefs } from "./prefs.js";
import { t } from "../shared/i18n.js";
import type { ToExtension, UiModel, UiState } from "../shared/protocol.js";
import {
  categoryForMode,
  modelScore,
  priceTier,
  PRICE_TIER_ORDER,
  scoreBand,
  type PriceTier,
  type ScoreBand,
} from "../core/models/benchmarks.js";

/** A row in the list, after the model has been scored, priced and grouped. */
interface ComboItem {
  value: string;
  label: string;
  detail: string;
  provider: string;
  vendor: string;
  tier: PriceTier;
  score: number | undefined;
  local: boolean;
  current: boolean;
  group: string;
  model: UiModel;
}

/** Band → one of the editor's chart colours, which every theme defines. */
const BAND_COLOUR: Record<ScoreBand, string> = {
  strong: "var(--vscode-charts-green)",
  good: "var(--vscode-charts-blue)",
  fair: "var(--vscode-charts-yellow)",
  weak: "var(--vscode-charts-orange)",
  poor: "var(--vscode-charts-red)",
  unknown: "var(--vscode-descriptionForeground)",
};

const TIER_COLOUR: Record<PriceTier, string> = {
  free: "var(--vscode-charts-green)",
  cheap: "var(--vscode-charts-green)",
  affordable: "var(--vscode-charts-yellow)",
  moderate: "var(--vscode-charts-orange)",
  expensive: "var(--vscode-charts-red)",
};

function tierLabel(tier: PriceTier): string {
  switch (tier) {
    case "free": return t("Free");
    case "cheap": return t("Low cost");
    case "affordable": return t("Affordable");
    case "moderate": return t("Moderate");
    case "expensive": return t("Expensive");
  }
}

const TIERS: PriceTier[] = ["free", "cheap", "affordable", "moderate", "expensive"];

/** `$3.00/M`, or the word that says the question does not arise. */
function priceBadge(model: UiModel): string {
  if (model.local) return t("local");
  if (!model.inUsd && !model.outUsd) return t("free");
  const value = model.inUsd;
  return `$${value >= 1 ? value.toFixed(2) : value.toFixed(3)}/M`;
}

function toItems(state: UiState): ComboItem[] {
  const category = categoryForMode(state.mode);
  const items = state.models.map((model): ComboItem => {
    const vendor = model.vendor || (model.id.includes("/") ? model.id.split("/")[0]! : model.provider);
    return {
      value: `${model.provider}|${model.id}`,
      label: model.name || model.id,
      detail: model.id,
      provider: model.provider,
      vendor,
      tier: model.local ? "free" : priceTier(model.inUsd, model.outUsd),
      score: modelScore(model.id, category),
      local: model.local,
      current: Boolean(model.current),
      group: model.local ? t("On your machine") : vendorLabel(vendor),
      model,
    };
  });

  // Inside a group: best first, then cheapest. Across groups: local first, then vendors A-Z. The
  // local models lead because they are the ones that cost nothing and send nothing, which is the
  // whole argument of this extension — burying them under Anthropic would contradict it.
  items.sort((a, b) => {
    if (a.local !== b.local) return a.local ? -1 : 1;
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    const byScore = (b.score ?? -1) - (a.score ?? -1);
    if (byScore) return byScore;
    return a.model.inUsd - b.model.inUsd;
  });

  // The current model is pinned to the top as its own group, and REMOVED from where it would
  // otherwise sit. Leaving it in both places puts the same row twice in a row whenever the current
  // model already sorts first — which, since local models lead and the local model is usually the
  // one in use, is the common case rather than the edge one. It reads as a rendering bug.
  const current = items.find((i) => i.current);
  if (!current) return items;
  return [{ ...current, group: t("Current") }, ...items.filter((i) => i !== current)];
}

function vendorLabel(vendor: string): string {
  const clean = vendor.replace(/^[~_-]+/, "");
  return clean.charAt(0).toLocaleUpperCase() + clean.slice(1);
}

/** The query, the tier filter and the provider filter, applied together. */
function passes(item: ComboItem, query: string): boolean {
  if (query) {
    const hay = `${item.label} ${item.detail} ${item.vendor}`.toLowerCase();
    for (const word of query.split(/\s+/)) if (word && !hay.includes(word)) return false;
  }
  const { tiers, providers } = prefs();
  // An empty filter list means "everything", not "nothing" — the distinction a naive
  // `list.includes(x)` gets wrong on first render and which makes the picker look broken.
  if (tiers.length && !tiers.includes(item.tier)) return false;
  if (providers.length && !providers.includes(item.provider)) return false;
  return true;
}

function applySort(items: ComboItem[]): ComboItem[] {
  const { modelSort, metricScore, metricPrice } = prefs();
  if (!modelSort) return items;
  const flat = items.filter((i) => i.group !== t("Current"));
  const byPriceOnly = !metricScore && metricPrice;
  flat.sort(
    byPriceOnly
      ? (a, b) => PRICE_TIER_ORDER[a.tier] - PRICE_TIER_ORDER[b.tier] || a.model.inUsd - b.model.inUsd
      : (a, b) => (b.score ?? -1) - (a.score ?? -1),
  );
  if (modelSort === "asc") flat.reverse();
  return flat.map((i) => ({ ...i, group: t("Ranked") }));
}

// ── The panel ──────────────────────────────────────────────────────────────────────────────────

let open: HTMLElement | undefined;

export function closeModelCombo(): void {
  open?.remove();
  open = undefined;
}

export function isModelComboOpen(): boolean {
  return Boolean(open);
}

export function openModelCombo(anchor: HTMLElement, state: UiState, send: (m: ToExtension) => void): void {
  closeModelCombo();

  const panel = el("div", "combo");
  document.body.append(panel);
  open = panel;

  let query = "";
  let showFilters = false;
  let search: HTMLInputElement | undefined;
  let list: HTMLElement | undefined;

  const pick = (item: ComboItem) => {
    closeModelCombo();
    send({ type: "setModel", model: item.model.id, provider: item.model.provider });
  };

  /** Redraws only the rows, so the search box keeps its text and its focus. */
  const buildList = () => {
    if (!list) return;
    list.textContent = "";
    const matching = applySort(toItems(state).filter((item) => passes(item, query.trim().toLowerCase())));
    if (!matching.length) {
      list.append(el("div", "combo-empty", state.modelsLoading ? t("Loading…") : t("No model matches.")));
      return;
    }
    let lastGroup: string | undefined;
    for (const item of matching) {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        list.append(el("div", "combo-group", item.group));
      }
      list.append(row(item));
    }
  };

  const row = (item: ComboItem): HTMLElement => {
    const node = el("button", `combo-item${item.current ? " sel" : ""}`);
    const main = el("div", "ci-main");
    const name = el("div", "ci-name");
    // The label is the part that may be clipped; the tag is not. Putting the ellipsis on the
    // container instead truncated the tag — "local" rendered as "loca", which reads as damage.
    name.append(el("span", "ci-label", item.label));
    if (item.local) name.append(el("span", "ci-tag", t("local")));
    main.append(name);
    main.append(el("div", "ci-detail", `${item.detail} · ${formatContext(item.model.context)}`));
    node.append(main);

    // Each segment keeps its OWN colour: the quality estimate in its band's colour, the price in
    // its bucket's. A single colour for the pair would make one of the two numbers a lie.
    const { metricScore: showScore, metricPrice: showPrice } = prefs();
    if (showScore || showPrice) {
      const badge = el("div", "ci-badge");
      if (showScore) {
        const value = el("span", "ci-score", item.score === undefined ? "—" : `${item.score}%`);
        value.style.color = BAND_COLOUR[scoreBand(item.score)];
        badge.append(value);
      }
      if (showScore && showPrice) badge.append(el("span", "ci-sep", "·"));
      if (showPrice) {
        const value = el("span", "ci-price", priceBadge(item.model));
        value.style.color = TIER_COLOUR[item.tier];
        badge.append(value);
      }
      node.append(badge);
    }

    node.title = item.local
      ? t("Served on your machine: nothing leaves, nothing is billed.")
      : t("Input {0} $/M · output {1} $/M", item.model.inUsd, item.model.outUsd);
    node.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      pick(item);
    });
    return node;
  };

  const header = (): HTMLElement => {
    const bar = el("div", "combo-header");
    const p = prefs();

    const toggle = (label: string, on: boolean, title: string, onClick: () => void) => {
      const b = button({
        label,
        className: `combo-metric${on ? " on" : ""}`,
        title,
        pressed: on,
        onClick: () => {
          onClick();
          redraw();
        },
      });
      return b;
    };

    bar.append(
      toggle(t("Quality"), p.metricScore, t("A curated estimate for {0} work — not an official benchmark.", modeLabel(state)), () =>
        setPrefs({ metricScore: !p.metricScore }),
      ),
    );
    bar.append(toggle(t("Price"), p.metricPrice, t("Input price per million tokens."), () => setPrefs({ metricPrice: !p.metricPrice })));

    bar.append(el("div", "spacer"));

    // Three states rather than two: a user who has flattened the list into a ranking needs a way
    // back to the grouping, and a second click that only reverses it is not that way.
    const sortLabel = p.modelSort === "desc" ? t("Best first") : p.modelSort === "asc" ? t("Worst first") : t("Grouped");
    bar.append(
      button({
        label: sortLabel,
        className: `combo-metric${p.modelSort ? " on" : ""}`,
        title: t("Sort: grouped by vendor, best first, or worst first."),
        onClick: () => {
          setPrefs({ modelSort: p.modelSort === "" ? "desc" : p.modelSort === "desc" ? "asc" : "" });
          redraw();
        },
      }),
    );
    bar.append(
      button({
        icon: ICON.settings,
        className: `btn icon-only combo-metric${showFilters || p.tiers.length || p.providers.length ? " on" : ""}`,
        title: t("Filter by price and provider"),
        onClick: () => {
          showFilters = !showFilters;
          redraw();
        },
      }),
    );
    return bar;
  };

  const filters = (): HTMLElement => {
    const wrap = el("div", "combo-filters");
    const p = prefs();

    const section = (title: string, options: Array<{ id: string; label: string; colour?: string }>, selected: string[], key: "tiers" | "providers") => {
      const box = el("div", "combo-filter-sec");
      box.append(el("div", "combo-filter-title", title));
      const rows = el("div", "combo-filter-rows");
      for (const option of options) {
        const label = el("label", "combo-filter-row");
        const input = el("input");
        input.type = "checkbox";
        // Empty means "no filter", so an untouched panel shows every box ticked.
        input.checked = !selected.length || selected.includes(option.id);
        input.addEventListener("change", () => {
          const all = options.map((o) => o.id);
          const now = new Set(selected.length ? selected : all);
          if (input.checked) now.add(option.id);
          else now.delete(option.id);
          setPrefs({ [key]: now.size === all.length ? [] : [...now] } as never);
          redraw();
        });
        label.append(input);
        const text = el("span", "combo-filter-label", option.label);
        if (option.colour) text.style.color = option.colour;
        label.append(text);
        rows.append(label);
      }
      box.append(rows);
      return box;
    };

    wrap.append(
      section(
        t("Price"),
        TIERS.map((tier) => ({ id: tier, label: tierLabel(tier), colour: TIER_COLOUR[tier] })),
        p.tiers,
        "tiers",
      ),
    );
    const providers = [...new Set(state.models.map((m) => m.provider))].sort();
    if (providers.length > 1) {
      wrap.append(section(t("Provider"), providers.map((id) => ({ id, label: id })), p.providers, "providers"));
    }

    const foot = el("div", "combo-filter-foot");
    foot.append(
      button({
        label: t("Reset"),
        className: "btn tiny ghost",
        onClick: () => {
          setPrefs({ tiers: [], providers: [] });
          redraw();
        },
      }),
    );
    foot.append(el("div", "spacer"));
    foot.append(button({ label: t("Done"), className: "btn tiny", onClick: () => { showFilters = false; redraw(); } }));
    wrap.append(foot);
    return wrap;
  };

  const redraw = () => {
    const keptQuery = search?.value ?? query;
    const hadFocus = document.activeElement === search;
    panel.textContent = "";

    panel.append(header());
    if (showFilters) panel.append(filters());

    const searchRow = el("div", "combo-search");
    searchRow.append(icon("search", "search-ico"));
    search = el("input", "combo-search-input");
    search.type = "text";
    search.placeholder = t("Search {0} models…", state.models.length);
    search.value = keptQuery;
    search.addEventListener("input", () => {
      query = search!.value;
      buildList();
    });
    search.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeModelCombo();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        list?.querySelector<HTMLElement>(".combo-item")?.dispatchEvent(new MouseEvent("mousedown"));
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        list?.querySelector<HTMLElement>(".combo-item")?.focus();
      }
    });
    searchRow.append(search);
    panel.append(searchRow);

    list = el("div", "combo-list");
    panel.append(list);
    buildList();

    const foot = el("div", "combo-foot");
    foot.append(
      button({
        label: t("Compare side by side"),
        className: "btn tiny ghost",
        onClick: () => {
          closeModelCombo();
          send({ type: "openScreen", screen: "models" });
        },
      }),
    );
    foot.append(el("div", "spacer"));
    foot.append(
      button({ label: t("Refresh"), className: "btn tiny ghost", onClick: () => send({ type: "refreshModels" }) }),
    );
    panel.append(foot);

    position();
    if (hadFocus || keptQuery === "") search.focus();
  };

  const position = () => {
    const rect = anchor.getBoundingClientRect();
    // The trigger sits at the bottom of the sidebar, so the panel opens upwards whenever it fits —
    // and the panel is never wider than the view, which on a 300 px sidebar is the common case.
    panel.style.width = `${Math.min(Math.max(rect.width, 320), window.innerWidth - 16)}px`;
    const height = panel.offsetHeight;
    const above = rect.top - height - 6;
    panel.style.top = `${above > 8 ? above : Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - height - 8))}px`;
    panel.style.left = `${Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - panel.offsetWidth - 8))}px`;
  };

  const onAway = (ev: MouseEvent) => {
    if (!panel.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) {
      closeModelCombo();
      document.removeEventListener("mousedown", onAway);
    }
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && open) {
      closeModelCombo();
      document.removeEventListener("keydown", onKey);
    }
  };

  redraw();
  setTimeout(() => {
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onKey);
  }, 0);
}

function modeLabel(state: UiState): string {
  return state.mode === "agent" ? t("agent") : state.mode === "plan" ? t("analysis") : t("general");
}
