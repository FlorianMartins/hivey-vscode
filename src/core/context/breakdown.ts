// What the context is made of, so the percentage can be acted on.
//
// The panel has shown a fill percentage for a long time, and a ring that says "84 %" answers the
// wrong half of the question. The half somebody can act on is "84 % of WHAT" — detach that file,
// narrow that selection, summarise the conversation, raise the budget. A number nobody can
// attribute is a number nobody can act on.
//
// An attribution already existed, and only on the consent card: `whereTheTokensWent` names the
// three largest things in a request that is about to leave the machine. That is the right content in
// a place almost nobody sees — it appears for a remote provider, once per session. This is the same
// idea made permanent and complete: every part, the free space, and a shape a bar can be drawn from.
//
// ⚠️ APPROXIMATE BY CONSTRUCTION, and that is a decision rather than a shortcut. It measures the
// SOURCES — the prompt, the map, each attachment, the transcript — rather than the assembled
// messages, so the parts will not sum exactly to what the provider counts. A breakdown that had to
// be exact would have to be maintained in step with the assembly, and would be dropped the first
// time the two drifted. Naming the big one correctly is what matters.

export interface ContextPart {
  label: string;
  tokens: number;
}

export interface ContextSegment extends ContextPart {
  /** Fraction of the BUDGET, not of the used total: a bar is drawn against the window. */
  share: number;
}

export interface ContextBreakdown {
  segments: ContextSegment[];
  used: number;
  budget: number;
  /** Never negative. When the context is over budget, this is 0 and `over` says so. */
  free: number;
  freeShare: number;
  over: boolean;
}

/**
 * Parts below this fraction of the budget are merged into one.
 *
 * A bar with twenty slices of a third of a percent is not information, it is texture — and each of
 * those slices is a label nobody can read. One honest "other" is worth more than twenty slivers.
 */
export const FLOOR = 0.02;

/** The label the merged remainder gets. The caller translates it; this module stays free of i18n. */
export const OTHER = "other";

/**
 * Turn the parts of a request into something a bar can draw.
 *
 * @param parts the sources, in any order. Parts with the same label are added together — two
 *   attachments of the same name are one line in a legend, not two identical ones.
 * @param budget the model's context budget in tokens. `0` means unknown, and then there is no bar
 *   to draw: shares are all zero and the caller is expected to show the count alone.
 */
export function contextBreakdown(parts: ContextPart[], budget: number): ContextBreakdown {
  const merged = new Map<string, number>();
  for (const part of parts) {
    if (!part.label || !Number.isFinite(part.tokens) || part.tokens <= 0) continue;
    merged.set(part.label, (merged.get(part.label) ?? 0) + Math.round(part.tokens));
  }

  const used = [...merged.values()].reduce((sum, n) => sum + n, 0);
  const share = (tokens: number) => (budget > 0 ? tokens / budget : 0);

  const ordered = [...merged.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const big: ContextSegment[] = [];
  let remainder = 0;
  for (const [label, tokens] of ordered) {
    // Against the budget when there is one; against the used total when there is not, so that an
    // unknown window does not collapse every part into "other".
    const relative = budget > 0 ? tokens / budget : used > 0 ? tokens / used : 0;
    if (relative >= FLOOR) big.push({ label, tokens, share: share(tokens) });
    else remainder += tokens;
  }
  if (remainder > 0) big.push({ label: OTHER, tokens: remainder, share: share(remainder) });

  const over = budget > 0 && used > budget;
  const free = budget > 0 ? Math.max(0, budget - used) : 0;
  return { segments: big, used, budget, free, freeShare: share(free), over };
}
