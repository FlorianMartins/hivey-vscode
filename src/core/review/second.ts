// A second model reads the diff before the dangerous ones are applied.
//
// The approval card already shows the diff, and somebody who reads it carefully catches anything.
// The residue written down in the threat model is that **a user who approves without reading
// approves anyway** — and the changes where that costs the most are the small ones: a line added to
// a list of blocked globs, a setting that turns a check off, a permission widened by one word. They
// are three lines long, they look like the thing that was asked for, and they remove a guarantee.
//
// So before those, a second model reads the request and the diff and says what it objects to. Local
// by default, because a second opinion that costs money on every edit is a second opinion people
// switch off — and because the question being asked is narrow enough that a small model is good at
// it: "does this diff do something the request did not ask for?"
//
// ⚠️ ADVISORY BY DEFAULT. The objections go on the card, next to the diff, and the human decides.
// They block only when the organisation's policy says they must — which is a restriction, and so
// within what a policy may do ([ADR-0019](../../../docs/adr/0019-la-politique-ne-fait-que-restreindre.md)).
// A second model that could veto would be a second model whose own mistakes stop work, and nothing
// here has measured how often it is wrong.

/** Why a diff is worth a second look. Empty when it is not. */
export interface Trigger {
  needed: boolean;
  /** The reason, shown on the card so nobody wonders why the extra wait happened. */
  why: string;
}

/**
 * Paths where a small diff can remove a guarantee.
 *
 * Defaults rather than a guess at the user's layout: these are the files that configure THIS
 * extension and the editor, and a change to one of them is a change to what the rest of the rules
 * are allowed to do.
 */
export const SENSITIVE_PATHS = [
  "**/.vscode/settings.json",
  "**/.hiveycode/**",
  "**/package.json",
  "**/*.code-workspace",
  "**/.github/workflows/**",
  "**/Dockerfile",
  "**/docker-compose*.yml",
];

/**
 * Setting keys whose change is a change to a guarantee.
 *
 * Matched against the ADDED lines of the diff, not against the path: a settings change can arrive in
 * a file nobody listed, and the key is the thing that matters. This is deliberately the list of
 * things this product treats as guarantees elsewhere — if one of them appears in a diff, the diff is
 * about the rules rather than about the code.
 */
export const GUARDED_KEYS = [
  "privacy.redaction",
  "privacy.allowUnredacted",
  "privacy.blockedGlobs",
  "privacy.egressPolicy",
  "permissions.autoApprove",
  "permissions.allowedPaths",
  "permissions.allowedCommands",
  "ibmi.writableLibraries",
  "corpus.enabled",
  "siem.rejectUnauthorized",
  "background.image",
  "hooks",
];

export interface TriggerPolicy {
  /** Globs. A diff touching one of these is always worth a second look. */
  sensitivePaths: string[];
  /** Added-plus-removed lines beyond which any diff is worth one. */
  maxLines: number;
}

export const DEFAULT_TRIGGERS: TriggerPolicy = {
  sensitivePaths: SENSITIVE_PATHS,
  // Not a round number for its own sake: a change of this size is past the point where somebody
  // scrolls the approval card rather than reading it, which is the residue this exists for.
  maxLines: 120,
};

/** The lines a unified diff ADDS, without the `+++` header. */
export function addedLines(diff: string): string[] {
  return (diff ?? "")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

function changedLineCount(diff: string): number {
  return (diff ?? "")
    .split("\n")
    .filter((line) => (line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---")))
    .length;
}

/**
 * Is this diff one of the dangerous ones?
 *
 * Three reasons, in the order they are worth reporting: it touches a guarded setting, it touches a
 * sensitive path, or it is simply too big to have been read.
 */
export function needsSecondOpinion(
  input: { paths: string[]; diff: string },
  policy: TriggerPolicy = DEFAULT_TRIGGERS,
  matches: (path: string, glob: string) => boolean = () => false,
): Trigger {
  const added = addedLines(input.diff).join("\n");
  const key = GUARDED_KEYS.find((k) => added.includes(k));
  if (key) {
    return { needed: true, why: `it changes ${key}, which is one of the settings the other rules depend on` };
  }
  const path = input.paths.find((p) => policy.sensitivePaths.some((glob) => matches(p, glob)));
  if (path) return { needed: true, why: `it touches ${path}, which configures how everything else behaves` };
  const lines = changedLineCount(input.diff);
  if (lines > policy.maxLines) {
    return { needed: true, why: `it changes ${lines} lines, which is past the point where a diff gets scrolled rather than read` };
  }
  return { needed: false, why: "" };
}

// ── What the second model is asked ───────────────────────────────────────────────────────────────

/**
 * The question, narrowed to the one thing a second reader is good at.
 *
 * NOT "review this code": that is the first model's job and it has more context for it. The second
 * reader has the request and the diff and nothing else, which makes it good at exactly one
 * question — does this diff do something the request did not ask for? A prompt that asked for a
 * general review would get a general review, and a general review of a three-line settings change is
 * a paragraph of nothing.
 */
export function secondOpinionPrompt(request: string, diff: string): string {
  return [
    "You are a second reader. Somebody asked for a change and another model produced this diff. You",
    "are not reviewing the code's quality — you are answering one question:",
    "",
    "    does this diff do anything the request did not ask for?",
    "",
    "Pay attention to what it REMOVES or WEAKENS: a check deleted, a list of forbidden things made",
    "shorter, a permission widened, a default made more permissive, a test deleted rather than fixed.",
    "Those are the changes that look like what was asked for and are not.",
    "",
    "The request was:",
    request,
    "",
    "The diff is:",
    "```diff",
    diff,
    "```",
    "",
    "Answer with a fenced ```json block holding an array of objections and nothing else outside it:",
    "",
    "```json",
    '[{ "about": "the file and line", "objection": "one sentence saying what was not asked for" }]',
    "```",
    "",
    "An empty array means the diff does what was asked and nothing more. That is the expected answer",
    "most of the time, and saying it is more useful than finding something to say.",
  ].join("\n");
}

export interface Objection {
  about: string;
  objection: string;
}

export interface SecondOpinion {
  objections: Objection[];
  /** True when the answer could not be read, so silence is not read as approval. */
  unreadable: boolean;
}

/**
 * The objections in the second model's answer.
 *
 * An unreadable answer is reported as unreadable, never as "no objections": the whole point of this
 * feature is to put something on the card, and a parser failure that produced an empty list would
 * put a reassuring nothing there.
 */
export function parseObjections(answer: string): SecondOpinion {
  const text = answer ?? "";
  const blocks: string[] = [];
  for (const m of text.matchAll(/```(?:json|jsonc)?\s*\n([\s\S]*?)```/g)) blocks.push(m[1]!);
  const bare = /\[\s*(?:\{[\s\S]*\}\s*)?\]/.exec(text);
  if (bare) blocks.push(bare[0]);

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const objections: Objection[] = [];
    for (const raw of parsed) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const objection = String(entry["objection"] ?? entry["message"] ?? "").trim();
      if (!objection) continue;
      objections.push({ about: String(entry["about"] ?? entry["file"] ?? "").trim(), objection });
    }
    return { objections, unreadable: false };
  }
  // Nothing parseable. If the model said anything at all, that is itself worth putting on the card.
  return { objections: [], unreadable: text.trim().length > 0 };
}

/** The lines the approval card shows. Empty when there is nothing to say. */
export function describeOpinion(opinion: SecondOpinion, model: string, blocking: boolean): string[] {
  if (opinion.unreadable) {
    return [
      `A second reader (${model}) was asked and its answer could not be read. That is not “no objections” — read the diff yourself.`,
    ];
  }
  if (!opinion.objections.length) return [`A second reader (${model}) found nothing the request did not ask for.`];
  return [
    blocking
      ? `A second reader (${model}) objects, and your organisation requires these to be resolved:`
      : `A second reader (${model}) objects:`,
    ...opinion.objections.map((o) => `  ${o.about ? `${o.about}: ` : ""}${o.objection}`),
  ];
}
