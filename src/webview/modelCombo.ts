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
//     Code's own chart colors and the picker reads correctly on light, dark and high-contrast
//     themes without knowing which one is on.
//   • THE QUALITY METRIC FOLLOWS THE MODE. The sidebar ranks by the active tab's specialty; the
//     equivalent here is the mode, so switching from chat to agent re-ranks the list by how well
//     each model drives a tool loop rather than by how well it answers a question.

import { button, el, formatContext, icon, ICON, type IconName } from "./dom.js";
import { prefs, setPrefs } from "./prefs.js";
import { vendorMark } from "../core/router/vendorIcon.js";
import { t } from "../shared/i18n.js";
import type { ToExtension, UiModel, UiState } from "../shared/protocol.js";
import { priceTier, PRICE_TIER_ORDER, type PriceTier } from "../core/models/tiers.js";
import { recommend } from "../core/models/recommend.js";
import { HIVEY_VARIANTS, isHivey } from "../core/router/hivey.js";
import { isDirectVendor } from "../core/providers/vendors.js";

/** A row in the list, after the model has been priced and grouped. */
interface ComboItem {
  value: string;
  label: string;
  detail: string;
  provider: string;
  vendor: string;
  tier: PriceTier;
  local: boolean;
  /** Set on a recommended row: why it is worth using, in one clause. */
  why?: string;
  current: boolean;
  group: string;
  model: UiModel;
}

/**
 * Price bucket → color.
 *
 * These were `--vscode-charts-*` and that was a mistake worth naming: chart colors are FILL
 * colors, chosen to sit behind a legend as a solid block. At eleven pixels of text they are
 * muddy, and `charts.orange` in particular is a dark amber that disappears on a dark background.
 * The tokens below are the ones the editor uses for TEXT it needs you to read — the same green a
 * new file gets in the explorer, the same amber a warning gets, the same red an error gets.
 *
 * Only the ends are colored. A mid-priced model gets the ordinary foreground, because coloring
 * every row means coloring nothing: if all five buckets shout, the two that matter stop being
 * visible.
 */
const TIER_COLOUR: Record<PriceTier, string> = {
  free: "var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green))",
  cheap: "var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green))",
  affordable: "var(--vscode-foreground)",
  moderate: "var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow))",
  expensive: "var(--vscode-errorForeground, var(--vscode-charts-red))",
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

function usd(value: number): string {
  return `$${value >= 1 ? value.toFixed(2) : value.toFixed(3)}`;
}

/**
 * `$3.00/M`, a span for a preset, or the word that says the question does not arise.
 *
 * ⚠️ A preset gets a SPAN, because it is four models and a single figure made two different presets
 * read as identical: « comment ça se fait que les modeles Hivey pro et Hivey smart sortent le meme
 * prix ? ». The span is still the input price — that is all this badge has room for — but it is now a
 * claim the preset can keep, rather than one role's figure standing in for four.
 */
function priceBadge(model: UiModel): string {
  if (model.local) return t("local");
  if (!model.inUsd && !model.outUsd) return t("free");
  if (model.roles?.length) {
    const low = Math.min(...model.roles.map((r) => r.inUsd));
    const high = Math.max(...model.roles.map((r) => r.inUsd));
    if (high > low) return `${usd(low)}–${usd(high)}/M`;
  }
  return `${usd(model.inUsd)}/M`;
}

/**
 * What a preset is, in one line a row can hold: the model that answers an ordinary question.
 *
 * That is the role the two paid presets differ on, and therefore the only thing worth the space. The
 * detail used to be `model.id` — the literal string `hivey/smart` under a label reading "Hivey Pro",
 * which told a reader nothing they could not see.
 */
function presetDetail(model: UiModel): string | undefined {
  const everyday = model.roles?.find((r) => r.role === "everyday");
  return everyday ? t("{0} on an ordinary question", everyday.model) : undefined;
}

/** Every role, its model and its price — and where a cheaper preset already goes. */
function presetTitle(model: UiModel): string {
  const lines = (model.roles ?? []).map((r) => {
    const price = r.inUsd || r.outUsd ? t("{0} in · {1} out", usd(r.inUsd), usd(r.outUsd)) : t("free");
    const shared = r.sameAsCheaper ? ` — ${t("the same model {0} already uses", r.sameAsCheaper)}` : "";
    return `${r.role}: ${r.model} (${price})${shared}`;
  });
  // ⚠️ Said rather than hidden. A dearer preset reaching for the model a cheaper one already uses is
  // not a defect — it means the strongest current model was already inside the cheaper budget, so the
  // dearer one had nothing better to buy. Unsaid, the two presets read as decorative.
  if ((model.roles ?? []).some((r) => r.sameAsCheaper)) {
    lines.push("", t("Where a role is shared, the dearer preset had nothing better to buy that day."));
  }
  return lines.join("\n");
}

function toItems(state: UiState): ComboItem[] {
  const items = state.models.map((model): ComboItem => {
    const vendor = model.vendor || (model.id.includes("/") ? model.id.split("/")[0]! : model.provider);
    return {
      value: `${model.provider}|${model.id}`,
      label: model.name || model.id,
      detail: (model.roles?.length ? presetDetail(model) : undefined) ?? model.id,
      provider: model.provider,
      vendor,
      tier: model.local ? "free" : priceTier(model.inUsd, model.outUsd),
      local: model.local,
      current: Boolean(model.current),
      // Three homes, not two. "On your machine" and "On your network" are both private and both
      // free, and they are not the same offer: one keeps working on a train, the other is a shared
      // machine somebody else can reboot. Collapsing them would hide the only difference that
      // matters when choosing between them.
      group:
        // A gateway is the user's own infrastructure, like the two below it, and it belongs with
        // them rather than alphabetically among the vendors. It is also usually a short list — the
        // three or four models a proxy has been given — and the point of a short list is that you
        // can switch between them without hunting: "so I can switch easily between the models
        // available through the gateway".
        model.provider === "openai-compatible"
          ? t("On your gateway")
          : model.local
            ? model.loopback === false
              ? t("On your network")
              : t("On your machine")
            : // A model served by the vendor's own API is not the same row as the same model behind
              // OpenRouter: another account, another bill, another rate limit. Grouped under the
              // account rather than under the vendor name, so the two never look like duplicates.
              isDirectVendor(model.provider)
              ? t("Your account: {0}", vendor)
              : vendorLabel(vendor),
      model,
    };
  });

  // Inside a group: best first, then cheapest. Across groups: local first, then vendors A-Z. The
  // local models lead because they are the ones that cost nothing and send nothing, which is the
  // whole argument of this extension — burying them under Anthropic would contradict it.
  // Yours first, then everyone else's. A gateway ranks with the local runtimes whether or not its
  // address happens to be on this machine: it is infrastructure the user runs, it is the short list
  // they switch between, and sorting it as "g" between DeepSeek and Google buried it.
  const mine = (i: ComboItem): number => (i.local ? 0 : i.provider === "openai-compatible" ? 1 : 2);
  items.sort((a, b) => {
    const rank = mine(a) - mine(b);
    if (rank !== 0) return rank;
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.model.inUsd - b.model.inUsd || a.label.localeCompare(b.label);
  });

  // The current model is pinned to the top as its own group, and REMOVED from where it would
  // otherwise sit. Leaving it in both places puts the same row twice in a row whenever the current
  // model already sorts first — which, since local models lead and the local model is usually the
  // one in use, is the common case rather than the edge one. It reads as a rendering bug.
  // A handful worth using, computed from what is actually served rather than from a list of names
  // that would rot. One per family, local first.
  const suggested = recommend(
    state.models.map((m) => ({ id: m.id, inUsd: m.inUsd, local: m.local })),
  );
  const byId = new Map(items.map((i) => [i.model.id, i]));
  const recommended = suggested
    .map(({ id, why }) => {
      const item = byId.get(id);
      return item ? { ...item, group: t("Recommended"), why } : undefined;
    })
    .filter((i) => i !== undefined) as ComboItem[];

  // The presets, in their own group at the top. They are not a vendor and they are not four
  // hundred rows to search through: they are the answer to "I do not want to choose a model", which
  // is a different question from the one the rest of this list answers, and it belongs above it.
  const hint = new Map(HIVEY_VARIANTS.map((v) => [v.id as string, v.hint]));
  const presets = items
    .filter((i) => isHivey(i.model.id))
    .map((i) => ({ ...i, group: t("Hivey"), why: hint.get(i.model.id) }));

  const current = items.find((i) => i.current);
  const rest = (current ? items.filter((i) => i !== current) : items).filter((i) => !isHivey(i.model.id));
  return [...(current ? [{ ...current, group: t("Current") }] : []), ...presets.filter((i) => !i.current), ...recommended, ...rest];
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
  const { modelSort } = prefs();
  if (!modelSort) return items;
  // Flattened into one ranking by price. "desc" reads as "the best deal first", which for a price
  // means the cheapest — the label in the header says which, so there is nothing to guess.
  const flat = items
    .filter((i) => i.group !== t("Current"))
    .sort((a, b) => PRICE_TIER_ORDER[a.tier] - PRICE_TIER_ORDER[b.tier] || a.model.inUsd - b.model.inUsd);
  if (modelSort === "asc") flat.reverse();
  return flat.map((i) => ({ ...i, group: t("Ranked") }));
}

// ── The panel ──────────────────────────────────────────────────────────────────────────────────

let open: HTMLElement | undefined;
/** Redraws the open picker's rows from a newer state. Set while one is open, cleared with it. */
let rebuild: ((next: UiState) => void) | undefined;

export function closeModelCombo(): void {
  open?.remove();
  open = undefined;
  rebuild = undefined;
}

export function isModelComboOpen(): boolean {
  return Boolean(open);
}

/**
 * A model that appeared while the picker was open.
 *
 * The picker captures the state it was opened with, so a list arriving afterwards changed nothing
 * under it — and the whole point of asking the machine what it serves at the moment the picker
 * opens is that the answer lands a fraction of a second later. Without this the model somebody had
 * just pulled appeared only the second time they looked.
 */
export function refreshModelCombo(next: UiState): void {
  if (open) rebuild?.(next);
}

export function openModelCombo(anchor: HTMLElement, state: UiState, send: (m: ToExtension) => void): void {
  // Ask whether anything has appeared on the user's own machines since the list was built. Cheap by
  // construction — it touches loopback and the gateway and nothing else — and this is the moment it
  // matters: somebody who has just run `ollama pull` in a terminal is about to look for the model
  // here. The answer arrives as a new state, which redraws the list under the open picker.
  send({ type: "pollModels" });
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
    // The address travels with the choice. A model served by LM Studio while the extension points
    // at Ollama's port would otherwise be selected and then fail on the first question, with a
    // name in the button that the configured server has never heard of.
    send({
      type: "setModel",
      model: item.model.id,
      provider: item.model.provider,
      ...(item.model.baseUrl ? { baseUrl: item.model.baseUrl } : {}),
    });
  };

  /** Redraws only the rows, so the search box keeps its text and its focus. */
  const buildList = () => {
    if (!list) return;
    list.textContent = "";
    const typed = query.trim();
    const matching = applySort(toItems(state).filter((item) => passes(item, typed.toLowerCase())));

    // A gateway is not a catalogue.
    //
    // It serves whatever it has been given — qwen, deepseek, a fine-tune with a name nobody else
    // uses — and plenty of proxies answer nothing at all on `/models`, which is optional in the
    // OpenAI API. There was then no row to pick and no way to name a model except by editing
    // settings.json, which is not something the picker should send anybody off to do. So a name
    // typed into the search box is offered as a choice on the gateway when nothing matches it.
    const gateway = state.models.find((m) => m.provider === "openai-compatible");
    const known = state.models.some((m) => m.id === typed);
    if (gateway && typed.length > 1 && !known) {
      const use = el("div", "combo-group", t("On your gateway"));
      list.append(use);
      list.append(
        row({
          value: typed,
          label: typed,
          detail: t("use this name on the gateway — it serves what it has, not a catalogue"),
          provider: "openai-compatible",
          vendor: t("gateway"),
          tier: "free",
          local: Boolean(gateway.local),
          current: false,
          group: t("On your gateway"),
          model: { ...gateway, id: typed, name: typed, current: false },
        }),
      );
    }

    if (!matching.length) {
      if (!gateway || typed.length <= 1 || known) {
        list.append(el("div", "combo-empty", state.modelsLoading ? t("Loading…") : t("No model matches.")));
      }
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

  // Keeps the open picker honest about a list that arrives after it. The search text and the caret
  // live in the DOM and are not touched: only the rows are redrawn.
  rebuild = (next: UiState) => {
    state = next;
    buildList();
  };

  const row = (item: ComboItem): HTMLElement => {
    const node = el("button", `combo-item${item.current ? " sel" : ""}`);
    // The maker's mark, before the name, exactly as on the button that opens this list — the picker
    // and the control it fills have to agree, or choosing a model shows one face and selecting it
    // shows another.
    node.append(icon(vendorMark(item.model.id) as IconName, "ci-vendor"));
    const main = el("div", "ci-main");
    const name = el("div", "ci-name");
    // The label is the part that may be clipped; the tag is not. Putting the ellipsis on the
    // container instead truncated the tag — "local" rendered as "loca", which reads as damage.
    name.append(el("span", "ci-label", item.label));
    if (item.local) name.append(el("span", "ci-tag", t("local")));
    main.append(name);
    const detail = item.why
      ? item.why
      : item.local && item.model.server
        ? `${item.detail} · ${item.model.server}`
        : `${item.detail} · ${formatContext(item.model.context)}`;
    main.append(el("div", `ci-detail${item.why ? " why" : ""}`, detail));
    node.append(main);

    // Each segment keeps its OWN color: the quality estimate in its band's color, the price in
    // its bucket's. A single color for the pair would make one of the two numbers a lie.
    const badge = el("div", "ci-badge");
    const price = el("span", "ci-price", priceBadge(item.model));
    price.style.color = TIER_COLOUR[item.tier];
    badge.append(price);
    node.append(badge);

    node.title = item.local
      ? item.model.loopback === false
        ? t("Served by {0} on your network: nothing leaves it, nothing is billed.", item.model.server ?? item.model.baseUrl ?? "")
        : t("Served on your machine by {0}: nothing leaves, nothing is billed.", item.model.server ?? "")
      : item.model.roles?.length
        ? presetTitle(item.model)
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


    // Short enough to share a line with the sort control and the filter at the side bar's default
    // width. The long form is the tooltip: a caption that wraps and orphans the filter icon below
    // it explains the column at the cost of the header.
    const caption = el("span", "combo-caption", t("Price ($/M)"));
    caption.title = t("Input price, in dollars per million tokens.");
    bar.append(caption);
    bar.append(el("div", "spacer"));

    // Three states rather than two: a user who has flattened the list into a ranking needs a way
    // back to the grouping, and a second click that only reverses it is not that way.
    const sortLabel = p.modelSort === "desc" ? t("Cheapest first") : p.modelSort === "asc" ? t("Dearest first") : t("Grouped");
    bar.append(
      button({
        label: sortLabel,
        className: `combo-metric${p.modelSort ? " on" : ""}`,
        title: t("Sort: grouped by vendor, cheapest first, or dearest first."),
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

    const section = (title: string, options: Array<{ id: string; label: string; color?: string }>, selected: string[], key: "tiers" | "providers") => {
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
        if (option.color) text.style.color = option.color;
        label.append(text);
        rows.append(label);
      }
      box.append(rows);
      return box;
    };

    wrap.append(
      section(
        t("Price"),
        TIERS.map((tier) => ({ id: tier, label: tierLabel(tier), color: TIER_COLOUR[tier] })),
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
      button({
        label: t("Connect a provider"),
        className: "btn tiny ghost",
        onClick: () => {
          closeModelCombo();
          send({ type: "openScreen", screen: "setup" });
        },
      }),
    );
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
    // As wide as the PANEL allows, not as wide as the control that opened it.
    //
    // `rect` is the model button, which is small, so the floor won every time and the picker was
    // 320 px in a panel of any width — every model name truncated at the same place, every price
    // pushed against it, and a row of three buttons at the bottom that did not fit on one line and
    // was clipped by the widget's own `overflow: hidden`. Widening the panel did nothing, which is
    // the tell: a floating element that ignores the room it has been given.
    const room = window.innerWidth - 16;
    panel.style.width = `${Math.max(Math.min(rect.width, room), Math.min(room, 520))}px`;
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

