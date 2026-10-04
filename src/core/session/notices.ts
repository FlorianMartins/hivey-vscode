// "À savoir" — the things worth saying that nobody asked about.
//
// An assistant finishes a task and three kinds of true, useful thing go unsaid.
//
//   1. WHAT IT NOTICED. Working on one file it reads four others, and sees the same calculation
//      rounding the other way, a `.env` under version control, three skipped tests. Today it has two
//      options and both are bad: fix it silently — which puts a change nobody asked for in the diff —
//      or say nothing, which wastes the one pass over the code somebody paid for.
//   2. WHAT IT DID NOT VERIFY. "Done" is cheap to say. A turn that edited four files and ran nothing
//      has not finished, it has stopped — and the user cannot tell those apart from the answer.
//   3. THE STATE OF THE TOOL. The context is at 91 %, the selected model does not emit native tool
//      calls, the daily budget is nearly spent. Each of these changes what the next answer will be
//      worth, and none of them is visible in the answer.
//
// One section, three sources, and the sources are not equal in kind. **Two of the three are derived
// from facts this product already holds** — the trace, the plan, the budget, the shape of the tool
// calls that came back — so they do not depend on the model choosing to be forthcoming. Only the
// first needs the model, and it gets a tool rather than a convention about prose.
//
// Four rules, all of them about restraint:
//
//   • A NOTICE IS NOT AN ACTION. Nothing here was changed. That is the entire value: the finding
//     reaches the person without the diff growing something they did not ask for.
//   • NOTHING WHEN THERE IS NOTHING. No section rather than an empty one. The repository already
//     learnt this about reviews: "a review that always finds something is a review nobody reads
//     twice", and a footer that is always there is furniture.
//   • BOUNDED. Five at most. A list of twelve asides is a second answer, and it buries the first.
//   • ORDERED BY WHAT IT IS ABOUT: your code, then this answer, then this session. Decreasing
//     distance from the work, which is increasing distance from what you can act on today.

export type NoticeKind = "noticed" | "unverified" | "tool";

export interface Notice {
  kind: NoticeKind;
  /** One line. Where it applies, when it applies somewhere: `src/pay.ts:42`. */
  text: string;
  where?: string;
}

/** At most this many. See the header: a list of twelve asides buries the answer it follows. */
export const MAX_NOTICES = 5;

const ORDER: Record<NoticeKind, number> = { noticed: 0, unverified: 1, tool: 2 };

export interface NoticeInput {
  /** What the model reported through the tool, in the order it reported them. */
  reported: Notice[];
  /** Did the turn change anything? */
  changed: boolean;
  /** Did anything in the turn actually verify — a test, a build, a compile, a hook? */
  verified: boolean;
  /** Steps of the turn's own plan left outstanding, when it kept a plan. */
  planLeft?: string[];
  /** Fraction of the context budget in use, when a budget is known. */
  contextFill?: number;
  /** Spent today and the cap, when the endpoint bills. */
  spend?: { today: number; cap: number };
  /**
   * True when tool calls had to be read out of the model's message because the runtime returned
   * none through the protocol. A measured fact about the setup, not a guess about the model.
   */
  toolCallsFromText?: boolean;
  /**
   * The answer cap a provider's refusal forced this turn down to, when one did.
   *
   * A short answer returned in silence is worse than the refusal it replaced: the user reads a
   * fragment as what the model thinks. This is the one place that says the balance, not the model,
   * decided where the answer stopped.
   */
  shortenedTo?: number;
}

/**
 * The notices worth showing, or none.
 *
 * Derived first, reported second, and the derived ones are the reason this is worth having: they are
 * true whether or not the model was forthcoming.
 */
export function youShouldKnow(input: NoticeInput): Notice[] {
  const out: Notice[] = [...input.reported.filter((n) => n.text.trim())];

  // ── What this answer did not establish.
  if (input.changed && !input.verified) {
    out.push({
      kind: "unverified",
      text: "Nothing in this turn ran a test, a build or a compile, so the change is unverified.",
    });
  }
  for (const step of input.planLeft ?? []) {
    out.push({ kind: "unverified", text: `Left undone from my own plan: ${step}` });
  }

  // ── The state of the tool.
  if (input.toolCallsFromText) {
    out.push({
      kind: "tool",
      text: "This model did not return tool calls through the protocol; they were read from its message. Agent mode is working, with less of a guarantee than usual.",
    });
  }
  if (input.shortenedTo) {
    out.push({
      kind: "tool",
      text: `The provider would not fund a full answer, so this one was capped at ${input.shortenedTo.toLocaleString("en-US")} tokens. Add credit if it reads as cut off.`,
    });
  }
  if (input.contextFill !== undefined && input.contextFill >= 0.85) {
    out.push({
      kind: "tool",
      text: `The context is ${Math.round(input.contextFill * 100)} % full — summarising it will keep answers sharp and cheaper.`,
    });
  }
  if (input.spend && input.spend.cap > 0 && input.spend.today >= input.spend.cap * 0.8) {
    out.push({
      kind: "tool",
      text: `Spent $${input.spend.today.toFixed(2)} of today's $${input.spend.cap.toFixed(2)} cap.`,
    });
  }

  // Stable sort by what it is about, then first-come. Deduplicated on the text, because the model
  // reporting something the derivation also found should read once.
  const seen = new Set<string>();
  return out
    .map((notice, index) => ({ notice, index }))
    .sort((a, b) => ORDER[a.notice.kind] - ORDER[b.notice.kind] || a.index - b.index)
    .map(({ notice }) => notice)
    .filter((notice) => {
      const key = `${notice.text.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_NOTICES);
}

/** The schema the model is given, kept beside the rule it has to respect. */
export const NOTE_ASIDE_TOOL = {
  name: "note_aside",
  description:
    "Record something you noticed that the user did not ask about — a bug elsewhere, a risk, a " +
    "convention being broken — so it reaches them without you changing it. DO NOT fix what you " +
    "report here, and do not report the work you were asked to do. Nothing, rather than something " +
    "to say: an aside on every turn is noise.",
  parameters: {
    type: "object",
    properties: {
      what: { type: "string", description: "One line. What is wrong, not what you think about it." },
      where: { type: "string", description: "`path:line`, when it is somewhere." },
    },
    required: ["what"],
  },
} as const;
