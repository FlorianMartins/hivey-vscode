// The model picker, with prices side by side.
//
// A price only means something next to another price, so the list is a comparison rather than a
// menu: input and output cost per million tokens, the context window, and — the column that
// matters most here — whether the endpoint is local, in which case the answer is "free" and the
// question of cost does not arise at all.
//
// The catalogue ships with the extension (refreshed by a scheduled workflow), so opening this
// screen sends no request anywhere. Only the "served now" section talks to an endpoint, and only
// to the one the user configured.

import { button, el, formatContext, formatPrice, icon, searchInput } from "./dom.js";
import type { ToExtension, UiModel, UiState } from "../shared/protocol.js";
import { t } from "../shared/i18n.js";
import { HIVEY_VARIANTS, isHivey } from "../core/router/hivey.js";
import { isDirectVendor } from "../core/providers/vendors.js";

let query = "";

export function modelsScreen(state: UiState, send: (m: ToExtension) => void, rerender: () => void): HTMLElement {
  const wrap = el("div", "screen models-screen");

  const bar = el("div", "filter-bar");
  bar.append(
    searchInput({
      value: query,
      placeholder: t("Filter by name or vendor…"),
      onInput: (value) => {
        query = value;
        rerender();
      },
    }),
  );
  const actions = el("div", "filter-row");
  actions.append(
    el("span", "muted", state.modelsLoading ? t("Querying the endpoints…") : t("{0} models", state.models.length)),
    el("div", "spacer"),
    button({ label: t("Refresh"), className: "btn tiny", onClick: () => send({ type: "refreshModels" }) }),
    button({ label: t("Settings"), className: "btn tiny", onClick: () => send({ type: "openSettings" }) }),
  );
  bar.append(actions);
  wrap.append(bar);

  const needle = query.trim().toLocaleLowerCase("fr");
  const matching = state.models.filter(
    (m) => !needle || m.name.toLocaleLowerCase("fr").includes(needle) || m.id.toLocaleLowerCase("fr").includes(needle),
  );

  const presets = matching.filter((m) => isHivey(m.id));
  const local = matching.filter((m) => m.local);
  // Served by a vendor the user pays directly. Kept out of "Remote", which is the OpenRouter
  // catalogue: the same model appears in both, and the difference — whose account is billed — is
  // the only thing that separates the two rows.
  const own = matching.filter((m) => !m.local && isDirectVendor(m.provider));
  const remote = matching.filter((m) => !m.local && !isHivey(m.id) && !isDirectVendor(m.provider));

  const list = el("div", "models-list");
  // The presets first, and not because they are better: they answer a different question. Everything
  // below is "which model", which is a question with four hundred answers and no wrong one; a preset
  // is "how much am I willing to spend", which is a question with three. Filed under `hivey` among
  // the vendors — which is where they landed when they were first added — they sat between Google
  // and Meta, three rows nobody scrolling a catalogue would read as a way out of scrolling it.
  if (presets.length) {
    list.append(
      sectionTitle(
        t("Hivey"),
        t("Not models: each sends a kind of work — a question, an agent turn, a completion, a chore — to the model that suits it."),
      ),
    );
    for (const m of presets) list.append(modelRow(m, send));
  }
  if (local.length) {
    list.append(sectionTitle(t("On your machine"), t("No cost, no data leaves.")));
    for (const m of local) list.append(modelRow(m, send));
  }
  if (own.length) {
    list.append(
      sectionTitle(
        t("On your own account"),
        t("Served by a provider whose key you stored: billed by them, not through OpenRouter. Prices shown when the catalogue knows the model."),
      ),
    );
    for (const [vendor, models] of byVendor(own)) {
      list.append(el("div", "models-vendor", vendor));
      for (const m of models) list.append(modelRow(m, send));
    }
  }
  if (remote.length) {
    list.append(
      sectionTitle(
        t("Remote"),
        t("Prices in dollars per million tokens. What leaves is pseudonymised and counted against the budget."),
      ),
    );
    for (const [vendor, models] of byVendor(remote)) {
      list.append(el("div", "models-vendor", vendor));
      for (const m of models) list.append(modelRow(m, send));
    }
  }
  if (!matching.length) {
    list.append(el("p", "empty", state.modelsLoading ? t("Loading…") : t("No model matches.")));
    // The escape hatch, and it is not a nicety: a provider is not obliged to serve a model list.
    // Perplexity does not, some corporate gateways do not, and a private deployment serves names
    // nobody outside has heard of. Without this the model exists, the key is stored, the provider
    // is chosen — and there is no way in this panel to name what should answer. It is offered only
    // once a search has failed, so it never competes with the list when the list has the answer.
    const typed = query.trim();
    if (typed && !state.modelsLoading) {
      const row = el("button", "model-row");
      const main = el("div", "model-main");
      main.append(el("div", "model-name", t("Use “{0}” as it is typed", typed)));
      main.append(el("div", "model-id", t("On the current provider. For an endpoint that serves no list of its models.")));
      row.append(main);
      row.addEventListener("click", () => send({ type: "setModel", model: typed, provider: state.provider }));
      list.append(row);
    }
  }
  wrap.append(list);
  return wrap;
}

/** Cheapest first inside each vendor, vendors alphabetical: a comparison, not a catalogue dump. */
function byVendor(models: UiModel[]): Array<[string, UiModel[]]> {
  const groups = new Map<string, UiModel[]>();
  for (const m of models) {
    const key = m.vendor.replace(/^[~_-]+/, "");
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.inUsd + a.outUsd - (b.inUsd + b.outUsd));
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function sectionTitle(title: string, hint: string): HTMLElement {
  const wrap = el("div", "models-section");
  wrap.append(el("div", "models-section-title", title));
  wrap.append(el("div", "models-section-hint", hint));
  return wrap;
}

function modelRow(model: UiModel, send: (m: ToExtension) => void): HTMLElement {
  const row = el("button", `model-row${model.current ? " current" : ""}`);

  const main = el("div", "model-main");
  const name = el("div", "model-name", model.name);
  if (model.current) name.append(icon("check", "model-current"));
  main.append(name);
  main.append(el("div", "model-id", model.id));
  row.append(main);

  const stats = el("div", "model-stats");
  stats.append(stat(formatContext(model.context), t("context")));
  if (model.local) {
    stats.append(stat(t("free"), t("local")));
  } else {
    stats.append(stat(formatPrice(model.inUsd), t("input")));
    stats.append(stat(formatPrice(model.outUsd), t("output")));
    if (model.cachedInUsd) stats.append(stat(formatPrice(model.cachedInUsd), t("cache")));
  }
  row.append(stats);

  // A preset has four prices, and the row can show one. It shows the ordinary turn's — the one met
  // most often — and says so here rather than letting the figure be read as the whole bill.
  const preset = HIVEY_VARIANTS.find((v) => v.id === model.id);
  row.title = preset
    ? `${preset.hint}\n${t("The figures are those of an ordinary turn; a chore costs less and a hard question more.")}`
    : model.local
      ? t("Served by a local endpoint: no cost, and nothing leaves.")
      : t("Input {0} $/M · output {1} $/M", model.inUsd, model.outUsd) +
        (model.cachedInUsd ? t(" · cached {0} $/M", model.cachedInUsd) : "");
  row.addEventListener("click", () => send({ type: "setModel", model: model.id, provider: model.provider }));
  return row;
}

function stat(value: string, label: string): HTMLElement {
  const wrap = el("div", "model-stat");
  wrap.append(el("span", "model-stat-value", value));
  wrap.append(el("span", "model-stat-label", label));
  return wrap;
}
