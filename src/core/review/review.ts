// Reviewing a branch, and turning what the model says into something the editor can navigate.
//
// A review that arrives as prose is a review somebody reads once. A review that arrives as findings
// — file, line, severity, category, and the change that would fix it — is one they can walk through
// in the Problems panel, dismiss item by item, and come back to. The difference is not presentation:
// it is whether the review gets acted on.
//
// So the model is asked for a structured answer and the answer is parsed. Which means the parsing is
// where this feature fails, and it fails in one specific way: a model that returns almost-JSON, or
// JSON wrapped in an explanation, or a finding with a line number that is a string. Every one of
// those must produce the findings that ARE readable plus a note about the ones that were not —
// never an empty review, which reads as "nothing wrong".

export type Severity = "blocker" | "major" | "minor" | "note";

export interface Finding {
  file: string;
  /** 1-based. 0 or absent means "this file", which is a legitimate finding about a whole file. */
  line?: number;
  severity: Severity;
  /** `security`, `correctness`, `performance`, `style`, `test`… free text, for grouping. */
  category: string;
  message: string;
  /** The change that would fix it, when the model proposed one. */
  fix?: string;
}

export interface ReviewParse {
  findings: Finding[];
  /** What could not be read, so an unreadable answer is never an empty review. */
  problems: string[];
}

const SEVERITIES: Severity[] = ["blocker", "major", "minor", "note"];

/**
 * The findings in a model's answer.
 *
 * Looks for a fenced block first, then for a bare array, then gives up on the shape and says so.
 * Tolerant about everything except the two fields that make a finding navigable: without a file
 * there is nowhere to go, and without a message there is nothing to read.
 */
export function parseFindings(answer: string): ReviewParse {
  const problems: string[] = [];
  const text = answer ?? "";
  const candidates: string[] = [];

  // A fenced block, with or without a language tag. The common case.
  for (const m of text.matchAll(/```(?:json|jsonc)?\s*\n([\s\S]*?)```/g)) candidates.push(m[1]!);
  // Or a bare array somewhere in the prose.
  const bare = /\[\s*\{[\s\S]*\}\s*\]/.exec(text);
  if (bare) candidates.push(bare[0]);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as { findings?: unknown })?.findings;
    if (!Array.isArray(list)) continue;
    // From here the answer HAS a readable list, so this function returns — even when the list is
    // empty. An empty array is "I found nothing", and falling through to the "unreadable" branch
    // would turn a clean review into a parser failure.
    const findings: Finding[] = [];
    for (const [i, raw] of list.entries()) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const file = String(entry["file"] ?? entry["path"] ?? "").trim();
      const message = String(entry["message"] ?? entry["finding"] ?? entry["description"] ?? "").trim();
      if (!file || !message) {
        problems.push(`finding ${i + 1}: no ${!file ? "file" : "message"}, so there is nothing to ${!file ? "go to" : "read"}.`);
        continue;
      }
      // A line as a string is the single most common shape a model returns.
      const line = Number(entry["line"] ?? entry["lineNumber"] ?? 0);
      const severity = String(entry["severity"] ?? "").toLowerCase();
      findings.push({
        file,
        ...(Number.isFinite(line) && line > 0 ? { line: Math.trunc(line) } : {}),
        severity: (SEVERITIES as string[]).includes(severity) ? (severity as Severity) : "major",
        category: String(entry["category"] ?? "correctness").trim() || "correctness",
        message,
        ...(typeof entry["fix"] === "string" && entry["fix"].trim() ? { fix: entry["fix"].trim() } : {}),
      });
    }
    return { findings: sort(findings), problems };
  }

  if (text.trim()) {
    problems.push(
      "the answer carried no readable list of findings. Read it as prose instead — this is not the same as nothing being wrong.",
    );
  }
  return { findings: [], problems };
}

/** Worst first, then by file and line: the order somebody wants to walk. */
function sort(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

// ── Which base ───────────────────────────────────────────────────────────────────────────────────

/**
 * The branch point, asked of git rather than assumed.
 *
 * `merge-base` and not `origin/main`: a repository whose default branch is `master`, `develop` or
 * `trunk` is ordinary, and a review that silently compared against a branch that does not exist
 * would report every line of the repository as new. The candidates are tried in order and the first
 * that resolves wins; when none does, the caller asks.
 */
export const BASE_CANDIDATES = ["origin/HEAD", "origin/main", "origin/master", "main", "master", "develop", "trunk"];

export function mergeBaseArgv(base: string): string[] {
  return ["merge-base", base, "HEAD"];
}

/**
 * The diff a review is about.
 *
 * `base...HEAD` — three dots — so it is what THIS branch changed and not what happened on the base
 * meanwhile. Two dots would show somebody else's commits as this branch's work, which is the review
 * equivalent of blaming the wrong person.
 */
export function diffArgv(base: string): string[] {
  return ["diff", `${base}...HEAD`, "--unified=3"];
}

/** Only the names, for the summary line and for deciding there is nothing to review. */
export function changedFilesArgv(base: string): string[] {
  return ["diff", "--name-only", `${base}...HEAD`];
}

// ── What the model is asked ──────────────────────────────────────────────────────────────────────

/**
 * The instruction, and the shape the answer must take.
 *
 * The schema is in the prompt because that is the only place it can be: there is no structured-output
 * mode that every provider in this product supports, and a review that only worked on one vendor
 * would be a review most users do not get.
 */
export function reviewPrompt(input: { base: string; files: string[]; knowledge?: string }): string {
  return [
    `Review what this branch changes against ${input.base}. ${input.files.length} file(s) changed.`,
    "",
    "Order of attention: a defect that will bite in production, then security, then a change that will",
    "be misread by the next person. Style last and only where it hides one of the first three.",
    "",
    "Review the DIFF, not the repository: a line nobody touched is not this branch's problem, however",
    "much you would have written it differently. If the change is correct but incomplete — a case not",
    "handled, a test not written — that is a finding.",
    "",
    ...(input.knowledge ? ["What this organisation has written down about its own systems:", input.knowledge, ""] : []),
    "Answer with a fenced ```json block containing an array of findings, and nothing else outside it:",
    "",
    "```json",
    "[",
    '  { "file": "src/a.ts", "line": 42, "severity": "blocker|major|minor|note",',
    '    "category": "security|correctness|performance|test|style",',
    '    "message": "what is wrong, in one or two sentences",',
    '    "fix": "the change that would fix it" }',
    "]",
    "```",
    "",
    "An empty array is a legitimate answer and means you found nothing. Do not invent a finding to",
    "fill the list, and do not report the same problem twice because it appears in two files.",
  ].join("\n");
}

/** One line for the panel and the status bar. */
export function summarise(findings: Finding[]): string {
  if (!findings.length) return "No findings.";
  const counts = new Map<Severity, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  return SEVERITIES.filter((s) => counts.has(s))
    .map((s) => `${counts.get(s)} ${s}`)
    .join(", ");
}
