// Price buckets.
//
// The picker used to carry a second metric — a curated quality estimate per model family — and it
// is gone, at the user's request. Deleting it rather than hiding it is the point: a hundred and
// fifty lines of hand-tuned numbers that no screen reads are not an asset, they are a thing that
// rots. The comparison the picker makes now is the one nobody publishes and everybody needs: what
// this costs.
//
// Buckets rather than a continuous scale, because the question is not "how much exactly" — the
// price is written next to it — but "is this the cheap kind or the expensive kind", and that has to
// be answerable at a glance across four hundred rows.

export type PriceTier = "free" | "cheap" | "affordable" | "moderate" | "expensive";

/** By input price per million tokens, which is what dominates a coding conversation's bill. */
export function priceTier(inUsdPerMillion: number, outUsdPerMillion = 0): PriceTier {
  if (!inUsdPerMillion && !outUsdPerMillion) return "free";
  if (inUsdPerMillion <= 1) return "cheap";
  if (inUsdPerMillion <= 5) return "affordable";
  if (inUsdPerMillion <= 15) return "moderate";
  return "expensive";
}

export const PRICE_TIER_ORDER: Record<PriceTier, number> = {
  free: 0,
  cheap: 1,
  affordable: 2,
  moderate: 3,
  expensive: 4,
};
