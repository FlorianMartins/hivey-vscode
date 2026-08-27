// Which of these four hundred models should I use to write code?
//
// The obvious implementation is a hard-coded list of the best models, and it is the wrong one. Such
// a list is correct on the day it is written and quietly wrong two months later, when the model it
// names has been superseded by one from the same family — and nobody notices, because a
// recommendation that is out of date looks exactly like a recommendation that is current.
//
// So nothing here names a version. What it holds is a list of FAMILIES with a reputation for
// writing code, matched against whatever the user's endpoint actually serves. The catalogue is
// regenerated daily from the provider; when a family ships a new version, the recommendation
// follows it the next day without anyone editing this file. When a family stops being served, it
// simply stops appearing.
//
// The ordering rule is the one thing that is a judgement: a model that runs on the user's own
// machine leads, because it costs nothing and sends nothing, and this whole extension is an
// argument for preferring it. Below that, families are ordered by how well they are regarded for
// code, and inside a family the newest-looking id wins.

export interface Candidate {
  id: string;
  /** Input price per million tokens. Zero for a local model. */
  inUsd: number;
  local: boolean;
}

interface Family {
  /** Matched against the lowercased model id. */
  re: RegExp;
  /** Why this one is worth suggesting, in one clause. Shown to the user. */
  why: string;
  /** Lower is stronger. Ties are broken by price. */
  rank: number;
}

/**
 * Families with a reputation for code, strongest first.
 *
 * Deliberately no version numbers, no dates and no sizes: `qwen.*coder` matches whatever Qwen's
 * coding model is called this month. The patterns are broad on purpose — a recommendation that
 * misses a model because its id gained a suffix is worse than one that occasionally suggests a
 * smaller sibling.
 */
const FAMILIES: Family[] = [
  { re: /claude.*(opus|sonnet)|(?:opus|sonnet).*\d/, why: "strong at long multi-file changes", rank: 0 },
  { re: /gpt-5|(?:^|\/)o[34](?!-mini)/, why: "strong at reasoning through a bug", rank: 1 },
  { re: /qwen.*coder|coder.*qwen/, why: "built for code, and runs locally", rank: 2 },
  { re: /deepseek.*(coder|v3|r1)/, why: "very capable for what it costs", rank: 3 },
  { re: /codestral|mistral.*cod/, why: "fast, and good at fill-in-the-middle", rank: 4 },
  { re: /gemini.*(pro|flash).*\d|gemini-\d.*pro/, why: "a very large context window", rank: 5 },
  { re: /glm-?\d|kimi|moonshot/, why: "competitive at agentic work", rank: 6 },
  { re: /grok.*code|grok-\d/, why: "quick, and inexpensive", rank: 7 },
  { re: /starcoder|codellama|granite.*code/, why: "small enough to run anywhere", rank: 8 },
];

export interface Recommendation {
  id: string;
  why: string;
}

/**
 * How new an id looks.
 *
 * A crude proxy, and the crudeness is deliberate: the alternative is a release-date field that no
 * catalogue publishes. The largest version-looking number in the id wins, so `qwen3-coder` beats
 * `qwen2.5-coder` and `claude-opus-4-5` beats `claude-opus-4`. A `:7b` size suffix is ignored,
 * because it is a size and not a version — otherwise a 70b tag would masquerade as version 70.
 */
export function versionScore(id: string): number {
  const withoutSize = id.toLowerCase().replace(/[:@-]\d+(?:\.\d+)?\s*[bkm]\b/g, " ");
  let best = 0;
  for (const match of withoutSize.matchAll(/(\d+(?:\.\d+)?)/g)) {
    const value = Number(match[1]);
    // Four-digit numbers are dates (`20250219`), not versions; they say "newer" but not "better".
    if (Number.isFinite(value) && value < 1000) best = Math.max(best, value);
  }
  return best;
}

/**
 * The models worth suggesting, out of what is actually available.
 *
 * At most one per family, so the list reads as a set of choices rather than as four flavours of the
 * same thing — someone deciding between Claude and Qwen is making a real decision; someone deciding
 * between three Claude sizes is not being helped by a recommendation.
 */
export function recommend(candidates: Candidate[], max = 6): Recommendation[] {
  const best = new Map<number, { candidate: Candidate; family: Family }>();

  for (const candidate of candidates) {
    const id = candidate.id.toLowerCase();
    const family = FAMILIES.find((f) => f.re.test(id));
    if (!family) continue;

    const held = best.get(family.rank);
    if (!held || better(candidate, held.candidate)) best.set(family.rank, { candidate, family });
  }

  const chosen = [...best.values()].sort((a, b) => {
    // Local first, whatever its family: it is the one that costs nothing and sends nothing.
    if (a.candidate.local !== b.candidate.local) return a.candidate.local ? -1 : 1;
    return a.family.rank - b.family.rank;
  });

  // No "— on your machine" suffix: the row already carries a `local` tag and a `local` price, and
  // a third mention only truncated the sentence that was carrying the actual information.
  return chosen.slice(0, max).map(({ candidate, family }) => ({ id: candidate.id, why: family.why }));
}

/** Within a family: local wins, then the newer-looking id, then the cheaper one. */
function better(a: Candidate, b: Candidate): boolean {
  if (a.local !== b.local) return a.local;
  const byVersion = versionScore(a.id) - versionScore(b.id);
  if (byVersion !== 0) return byVersion > 0;
  return a.inUsd < b.inUsd;
}
