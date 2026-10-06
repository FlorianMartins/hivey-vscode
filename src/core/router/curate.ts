// Which model each Hivey preset runs, decided by rule rather than by a name typed in a file.
//
// These rules used to live in `scripts/update-models.mjs`, which cannot be unit tested — and the
// defect that moved them here is exactly the kind a test catches and a reading does not.
//
// ⚠️⚠️ THE RECENCY TERM WAS DROWNED, FOR MONTHS, WHILE THE GENERATED FILE'S OWN HEADER CLAIMED IT.
// It was `1.5 * (created / newest)`, over two Unix timestamps. Both are around 1.79 × 10⁹, so the
// ratio is ~0.999 for everything: across the WHOLE catalogue — from GPT-3.5 in 2023 to a model
// published yesterday — the term varied by **0.0885**, while a strong-vendor bonus is 1.2 and the
// price rank is worth 1.6. Recency was not a criterion. It was a rounding error wearing one's name.
//
// What that produced was not subtle:
//
//   • `hivey` ran `claude-opus-5` (July, $25/M) while `claude-opus-5.5` (September, $20/M) sat in
//     the same budget — newer AND cheaper, and it lost.
//   • `hivey/smart`, the preset that exists to be the best, ran `gpt-5-pro` — **October 2025, at
//     $120/M** — while `gpt-6.1-sol-pro` (September 2026) was available at **$10/M**. Twelve times
//     the price for a model a year older.
//
// The second one has a second cause, and it is the more interesting of the two: for a role that
// wants capability, price was read as a PROXY for capability (`+1.6 × price rank`). That was
// defensible when newer models cost more. It is actively harmful now that a new generation is
// usually both better and cheaper — it makes the rule prefer the expensive past.
//
// So there are two rules here, and they are different in kind:
//
//   1. RECENCY IS RANKED, like price already was. A rank spreads over [0, 1] whatever the
//      underlying units, which is why the price ladder never had this bug.
//   2. A STRICTLY DOMINATED MODEL IS REMOVED BEFORE SCORING. Within ONE vendor, a model that is
//      newer, no dearer, with at least as much context and at least as much tool support supersedes
//      the other — and no weighting should be able to resurrect it. Scores are a balance of
//      desirable things; this is not a balance, it is "never pay more for an older model from the
//      same vendor", and a filter says that where an addend cannot.
//
//      It is deliberately WITHIN ONE LINE OF ONE VENDOR. Across vendors the claim would be false: a
//      newer, cheaper model from a house nobody has heard of is not thereby better than Claude. And
//      across LINES of the same vendor it is false too — which this rule learnt the hard way on its
//      first run. Anthropic ships Opus and Sonnet at the same time, at different sizes and different
//      prices: `claude-sonnet-5.5` is newer than `claude-opus-5.5` and half the price, so a
//      vendor-wide rule declared the flagship superseded by the mid-range model. It is not. Only a
//      model of the SAME LINE supersedes another — `claude-opus-5.5` over `claude-opus-5`.

/** The shape of one row of OpenRouter's catalogue — only the fields these rules read. */
export interface CatalogueModel {
  id: string;
  /** Unix seconds. Absent on a handful of rows, which then rank oldest. */
  created?: number;
  context_length?: number;
  pricing?: { completion?: string | number; prompt?: string | number };
  architecture?: { output_modalities?: string[] };
  supported_parameters?: string[];
}

export type Role = "chore" | "everyday" | "deep" | "completion";

export interface RoleNeed {
  tools: boolean;
  want: "cheap" | "capable";
  codey?: boolean;
  minContext: number;
  /** Dollars per million output tokens, per preset. `0` means the free pool. */
  ceiling: Record<string, number>;
}

/**
 * The four roles, and the only thing that varies between the presets: the budget.
 *
 * Same roles, same requirements, three ceilings — which is what makes the presets comparable to one
 * another and explainable in one line.
 */
export const HIVEY_ROLES: Record<Role, RoleNeed> = {
  // Titles, commit messages, summaries, classification. High frequency, low value per call — and the
  // traffic that decides whether this costs cents or tens of dollars a day.
  chore: { tools: false, want: "cheap", minContext: 16000, ceiling: { "hivey/free": 0, "hivey/smart": 1.5, hivey: 5 } },
  // An ordinary chat turn.
  everyday: { tools: true, want: "capable", minContext: 64000, ceiling: { "hivey/free": 0, "hivey/smart": 8, hivey: 10 } },
  // An agent turn, or a question the router graded hard. The role the presets exist to separate.
  deep: { tools: true, want: "capable", minContext: 128000, ceiling: { "hivey/free": 0, "hivey/smart": 15, hivey: 20 } },
  // Inline completion: one request per keystroke pause. Fast, cheap and code-shaped, or not at all.
  completion: { tools: false, want: "cheap", codey: true, minContext: 8000, ceiling: { "hivey/free": 0, "hivey/smart": 1.5, hivey: 5 } },
};

/**
 * The presets, CHEAPEST FIRST — and this order is data that other code reads, not a listing.
 *
 * ⚠️ `hivey` used to sit in the middle and is now the dearest. The labels have been crossed for two
 * renames (the one called "Hivey Smart" is `hivey`, the one called "Hivey Pro" is `hivey/smart`), so
 * the only safe way to say "dearer" anywhere is to read this order rather than to name an id. The
 * ladder invariant and the overlap report both do, which is what let the two swap places without a
 * single rule being weakened.
 */
export const HIVEY_VARIANT_IDS = ["hivey/free", "hivey/smart", "hivey"] as const;

/**
 * A vendor a preset reaches for before any other.
 *
 * ⚠️ Asked for directly — « retravaille le modele Hivey Smart qui doit etre le modele le plus puissant
 * (principalememt sur anthropic […]) » — and expressed as a RULE rather than as four model ids,
 * because this repository forbids itself a version number in source: a vendor is stable for years, a
 * version for weeks, and the generated table is what moves when a successor ships.
 *
 * The bonus is large enough to beat price inside a role's budget and small enough that it cannot
 * conjure a model the ceiling does not allow. So the preset buys this vendor's ladder — its small
 * model for chores, its flagship for the hard work — and if that vendor ever has nothing in a
 * budget, the role is still filled by whoever does.
 */
export const PREFERRED_VENDOR: Record<string, string | undefined> = {
  hivey: "anthropic",
};

/**
 * Vendors worth reaching for first. Names, never versions: a vendor is stable for years, a version
 * for weeks. The bonus is small enough that a genuinely better outsider still wins.
 */
export const STRONG_VENDORS = new Set([
  "anthropic", "openai", "google", "x-ai", "deepseek", "qwen", "mistralai", "meta-llama",
  "moonshotai", "z-ai", "nvidia", "cohere",
]);

/**
 * A model that advertises code and nothing else is a poor writer of commit messages, and a general
 * model is a poor completion engine. The preference goes both ways, which is why it is signed.
 */
export const CODEY = /cod(?:e|er|ing)|devstral|laguna|starcoder|seed-.*code|qwen.*coder/i;

export const vendorOf = (m: CatalogueModel): string => m.id.split("/")[0] ?? "";

/**
 * The model's line, with its version removed: `anthropic/claude-opus-5.5` → `claude-opus`.
 *
 * What makes `claude-opus-5.5` a successor to `claude-opus-5` and NOT to `claude-sonnet-5.5`. Every
 * token that looks like a version or a size is dropped — a bare number, a `v`-prefixed number, a
 * parameter count like `550b` or `a55b` — and what remains is the name of the line.
 *
 * A heuristic, and it is allowed to be: it only ever decides whether one model may REMOVE another
 * from a shortlist, and getting it wrong in the cautious direction simply leaves both in, where the
 * score decides. Getting it wrong in the other direction is what the Sonnet-over-Opus run looked
 * like, which is why the test for it names both.
 */
export function lineKey(m: CatalogueModel): string {
  const name = m.id.includes("/") ? m.id.slice(m.id.indexOf("/") + 1) : m.id;
  return name
    .replace(/:.*$/, "")
    .split(/[-_.]+/)
    .filter((part) => part && !/^v?\d/.test(part) && !/^a?\d+b$/i.test(part))
    .join("-")
    .toLowerCase();
}

/** Dollars per million output tokens. `Infinity` when the catalogue quotes no price. */
export function outPrice(m: CatalogueModel): number {
  const n = Number(m.pricing?.completion);
  return Number.isFinite(n) ? n * 1_000_000 : Infinity;
}

const textOut = (m: CatalogueModel): boolean => (m.architecture?.output_modalities ?? ["text"]).includes("text");
const hasTools = (m: CatalogueModel): boolean => (m.supported_parameters ?? []).includes("tools");
const contextOf = (m: CatalogueModel): number => m.context_length ?? 0;

/** Billions of parameters, when the id says so. On the free pool, the only capability signal left. */
function size(m: CatalogueModel): number {
  const b = /[-/](\d{1,4})b\b/i.exec(m.id);
  return b ? Math.min(Number(b[1]), 200) / 200 : 0;
}

/** Everything that could serve any role of this preset, before the role's own budget applies. */
export function eligible(m: CatalogueModel, wantFree: boolean): boolean {
  if (/^~/.test(m.id)) return false; // a moving alias is not a stable id to commit
  if (/preview|-exp\b|experimental|:extended|:thinking|:online/i.test(m.id)) return false;
  // A `:batch` endpoint costs half and answers in hours. Half price is no price at all for a panel
  // whose whole contract is that the answer starts arriving while you watch.
  if (/:batch$/.test(m.id)) return false;
  // OpenRouter's own `auto` and `pareto` products are routers, not models. Picking one would mean
  // this table routes to a router: an unpredictable model at an unpredictable price, chosen by
  // someone else's rules. A preset has to be able to say what it runs. (They also quote no price,
  // which a budget then reads as "free" — that is how `openrouter/auto-beta` once won the cheapest
  // role of all three presets at once.)
  if (m.id.startsWith("openrouter/")) return false;
  if (wantFree !== /:free$/.test(m.id)) return false;
  if (!textOut(m)) return false;
  // On a paid preset, a model quoting no price is a model whose bill cannot be predicted.
  //
  // ⚠️ This read `outPrice(m) > 0`, and `outPrice` returns `Infinity` for an unpriced row — so
  // `Infinity > 0` let exactly the models this line exists to exclude straight through. It was
  // harmless only by accident: the role's own `outPrice <= ceiling` rejected them later. A rule that
  // holds because something else happens to catch it is a rule that stops holding when the other
  // thing moves. Found by the test for this line.
  const price = outPrice(m);
  return wantFree || (Number.isFinite(price) && price > 0);
}

/**
 * Does `a` supersede `b` outright?
 *
 * Same vendor, strictly newer, no dearer, at least as much context, and tools if `b` has them. When
 * all of that holds there is no reading under which `b` is the better choice, so no score should be
 * able to choose it. See the header: this is the rule that stops a preset paying $120/M for a
 * year-old model while its successor sits in the same catalogue at $10/M.
 */
export function supersedes(a: CatalogueModel, b: CatalogueModel): boolean {
  if (a.id === b.id || vendorOf(a) !== vendorOf(b)) return false;
  if (lineKey(a) !== lineKey(b)) return false;
  if ((a.created ?? 0) <= (b.created ?? 0)) return false;
  if (outPrice(a) > outPrice(b)) return false;
  if (contextOf(a) < contextOf(b)) return false;
  if (hasTools(b) && !hasTools(a)) return false;
  return true;
}

/** The pool with every strictly superseded model removed. */
export function undominated(pool: CatalogueModel[]): CatalogueModel[] {
  return pool.filter((b) => !pool.some((a) => supersedes(a, b)));
}

/** 0 for the oldest of the universe, 1 for the newest. A rank, for the reason the header gives. */
export function recencyRank(universe: CatalogueModel[]): (m: CatalogueModel) => number {
  const dates = [...new Set(universe.map((m) => m.created ?? 0))].sort((x, y) => x - y);
  return (m) => (dates.length < 2 ? 0.5 : dates.indexOf(m.created ?? 0) / (dates.length - 1));
}

/** variant → role → model id. */
export function curateHivey(all: CatalogueModel[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};

  for (const variant of HIVEY_VARIANT_IDS) {
    const wantFree = variant === "hivey/free";
    const universe = all.filter((m) => eligible(m, wantFree));
    // The price ladder is built over the WHOLE universe, not over each role's shortlist, and that is
    // what keeps the three presets in order. Ranked inside its own shortlist, a $25 flagship looked
    // cheap against a $150 budget and dear against a $25 one — so Pro chose a $2.50 model for its
    // deep role while Smart chose the flagship. Against a fixed ladder, raising a budget can only
    // add candidates, so a dearer preset is never served a worse model than a cheaper one.
    const prices = [...new Set(universe.map(outPrice))].sort((a, b) => a - b);
    const priceRank = (m: CatalogueModel) => (prices.length < 2 ? 0.5 : prices.indexOf(outPrice(m)) / (prices.length - 1));
    const recency = recencyRank(universe);

    out[variant] = {};
    for (const [role, need] of Object.entries(HIVEY_ROLES) as Array<[Role, RoleNeed]>) {
      const ceiling = need.ceiling[variant] ?? 0;
      const cheap = need.want === "cheap";
      // How strongly this preset reads price UPWARD, for a role that wants capability.
      //
      // A budget is not a limit a preset tries to avoid, it is what the preset is FOR: "the best of
      // the catalogue on the hard work" is the Pro preset's own promise, and a promise it cannot
      // keep if it picks the same model as the cheaper preset. Which is what happened the moment
      // recency started working: the newest strong model was affordable to both, so Pro and Smart
      // resolved to the same id and Pro bought nothing. Scaling this with the ceiling restores the
      // distinction without touching the ladder invariant — a dearer preset still can only ever
      // reach further up the same price ladder, never down.
      const ceilings = Object.values(need.ceiling).filter((c) => c > 0);
      const widest = Math.max(...ceilings, 1);
      const priceWeight = ceiling > 0 ? 0.6 + 1.2 * (ceiling / widest) : 0.6;
      // The preferred vendor's own price ladder, ranked among its own models and nobody else's.
      const house = PREFERRED_VENDOR[variant];
      const housePrices = house
        ? [...new Set(universe.filter((m) => vendorOf(m) === house).map(outPrice))].sort((a, b) => a - b)
        : [];
      const vendorRank = (m: CatalogueModel) =>
        housePrices.length < 2 ? 0.5 : housePrices.indexOf(outPrice(m)) / (housePrices.length - 1);

      const score = (m: CatalogueModel) => {
        // Recency leads for a capable role, because within a strong vendor a new generation is the
        // single best predictor of quality available in this catalogue — better than price, which
        // only tells you what somebody decided to charge.
        let s = (cheap ? 1.2 : 2.0) * recency(m);
        // Saturating, because a window is a threshold and not a quantity: past a few hundred
        // thousand tokens the extra million buys this extension nothing, and rewarding it linearly
        // let one enormous window outweigh every other property a model has.
        s += (cheap ? 0.4 : 1.2) * (Math.min(contextOf(m), 400_000) / 400_000);
        if (STRONG_VENDORS.has(vendorOf(m))) s += cheap ? 0.4 : 1.2;
        // The preset's own house, when it has one. Above the strong-vendor bonus because it is a
        // choice rather than a heuristic, and below what a ceiling decides because a budget is not a
        // preference.
        if (PREFERRED_VENDOR[variant] && vendorOf(m) === PREFERRED_VENDOR[variant]) {
          s += 2.5;
          // ⚠️ And INSIDE that house, price is read as the capability ladder — which is the one place
          // that reading is true. Across vendors it is false and this file says so twice: price "only
          // tells you what somebody decided to charge". Within a single vendor it is their own
          // ordering of their own models, published by them: haiku under sonnet under opus under the
          // reasoning flagship. Without this the role picked the NEWEST Anthropic model rather than
          // the strongest, because recency leads the global score — so the deep role bought the
          // everyday model and the preset's whole promise went with it.
          if (!cheap) s += 1.5 * vendorRank(m);
        }
        if (CODEY.test(m.id)) s += need.codey ? 0.8 : -1;
        // Price, read in the direction the role wants. Weak for a capable role and never decisive
        // there: it is what the vendor charges, not what the model can do.
        s += cheap ? 1.5 * (1 - priceRank(m)) - 0.3 * size(m) : priceWeight * priceRank(m) + 0.5 * size(m);
        return s;
      };
      const pick = (withTools: boolean) => {
        const pool = universe.filter(
          (m) => (!withTools || hasTools(m)) && contextOf(m) >= need.minContext && outPrice(m) <= ceiling,
        );
        return undominated(pool).sort((a, b) => score(b) - score(a))[0];
      };
      // Tools are required where the role drives a tool loop — but a preset with no tool-capable
      // model in its budget must still answer, so the requirement is relaxed rather than the role
      // left empty. That case is real: the free pool is eighteen models on a good day.
      const chosen = (need.tools ? pick(true) : undefined) ?? pick(false);
      if (chosen) out[variant][role] = chosen.id;
    }
  }
  return out;
}

/**
 * Roles where a dearer preset resolves to the same model as a cheaper one.
 *
 * Reported rather than engineered away, and that is the whole point. When recency started working,
 * `hivey` and `hivey/smart` both landed on the newest strong model for the `deep` role — and the
 * margin between it and the next candidate was **0.007 of a point**. At that distance the choice is
 * noise, and tuning the weights until the two presets differed would have been fitting the rules to
 * one afternoon's catalogue.
 *
 * The honest reading is simpler: the strongest current model is already inside the cheaper preset's
 * budget, so the dearer preset has nothing better to buy. That is a fact about the market, it will
 * stop being true the next time somebody ships an expensive flagship, and until then the product
 * should say it instead of pretending to a difference it cannot deliver.
 */
export function presetOverlaps(routing: Record<string, Record<string, string>>): string[] {
  const out: string[] = [];
  const order = [...HIVEY_VARIANT_IDS];
  for (let i = 1; i < order.length; i++) {
    const dearer = order[i]!;
    const cheaper = order[i - 1]!;
    for (const role of Object.keys(HIVEY_ROLES) as Role[]) {
      const a = routing[dearer]?.[role];
      if (a && a === routing[cheaper]?.[role]) out.push(`${dearer}/${role} = ${cheaper}/${role} (${a})`);
    }
  }
  return out;
}
