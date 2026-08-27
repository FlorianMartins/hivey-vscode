// The handful of choices that belong to the panel rather than to the conversation.
//
// Which badges the model picker shows, how it is sorted, which price tiers are filtered out: none
// of that is worth a setting in `settings.json`, and none of it should be forgotten the moment the
// sidebar is hidden and shown again. VS Code gives a webview exactly the right store for this —
// `getState`/`setState`, which survives the view being disposed and restored — so that is what this
// uses, behind one namespaced key so it cannot collide with anything else kept there.
//
// The store is injected rather than acquired here: `acquireVsCodeApi` may be called only once per
// webview, and it is called in `main.ts`.

export interface PanelPrefs {
  /** Show the curated quality estimate on each model row. */
  metricScore: boolean;
  /** Show the price on each model row. */
  metricPrice: boolean;
  /** "" leaves the natural grouping alone; desc and asc flatten the list into a ranking. */
  modelSort: "" | "desc" | "asc";
  /** Price buckets to show. An empty list means "no filter", not "show nothing". */
  tiers: string[];
  /** Providers to show. Same convention. */
  providers: string[];
}

const DEFAULTS: PanelPrefs = {
  metricScore: true,
  metricPrice: true,
  modelSort: "",
  tiers: [],
  providers: [],
};

const KEY = "forge.panelPrefs";

interface Store {
  get(): unknown;
  set(state: unknown): void;
}

let store: Store = { get: () => undefined, set: () => undefined };
let cache: PanelPrefs | undefined;

export function usePrefStore(s: Store): void {
  store = s;
  cache = undefined;
}

export function prefs(): PanelPrefs {
  if (cache) return cache;
  const all = (store.get() ?? {}) as Record<string, unknown>;
  const saved = (all[KEY] ?? {}) as Partial<PanelPrefs>;
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

export function setPrefs(patch: Partial<PanelPrefs>): PanelPrefs {
  const next = { ...prefs(), ...patch };
  cache = next;
  const all = (store.get() ?? {}) as Record<string, unknown>;
  store.set({ ...all, [KEY]: next });
  return next;
}
