// Reviewing the branch, and putting the result where the editor can navigate it.
//
// The findings go to the Problems panel as diagnostics, which is not a presentation choice: it is
// what gives them navigation, grouping by file, a count in the status bar and a place they stay until
// somebody deals with them. A review printed into a chat transcript is a review that scrolls away.
//
// ⚠️ Publishing findings as pull-request comments is NOT here and is not going to be. It would mean
// this extension holding a forge credential and writing on somebody's behalf to a server — which is
// the one kind of outward action this product does not take. A user who wants it configures an MCP
// server for their forge, approves it by name, and the agent calls that; the door exists and it is
// theirs to open.

import * as vscode from "vscode";
import { execFile } from "node:child_process";
import {
  BASE_CANDIDATES,
  changedFilesArgv,
  diffArgv,
  mergeBaseArgv,
  parseFindings,
  reviewPrompt,
  summarise,
  type Finding,
} from "../core/review/review.js";
import { headToTokens } from "../core/util/tokens.js";
import { t } from "../shared/i18n.js";

const SEVERITY: Record<Finding["severity"], vscode.DiagnosticSeverity> = {
  blocker: vscode.DiagnosticSeverity.Error,
  major: vscode.DiagnosticSeverity.Warning,
  minor: vscode.DiagnosticSeverity.Information,
  note: vscode.DiagnosticSeverity.Hint,
};

function git(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? 1 : 0, out: `${stdout ?? ""}${stderr ?? ""}` }),
    );
  });
}

/**
 * The branch point, asked of the repository.
 *
 * Each candidate is tried with `merge-base`, which answers "where did this branch leave that one" —
 * and a candidate that does not exist simply fails, which is why trying several costs nothing.
 */
export async function detectBase(root: string): Promise<string | undefined> {
  for (const candidate of BASE_CANDIDATES) {
    const result = await git(mergeBaseArgv(candidate), root);
    const sha = result.out.trim().split("\n")[0] ?? "";
    if (result.code === 0 && /^[0-9a-f]{7,40}$/.test(sha)) return sha;
  }
  return undefined;
}

export interface BranchReview {
  base: string;
  files: string[];
  /** The diff, truncated to what a model can hold. */
  diff: string;
  /** True when the diff was cut, so "no findings beyond this point" is not implied. */
  truncated: boolean;
}

export async function collectBranch(root: string, base: string, maxTokens = 24_000): Promise<BranchReview> {
  const names = await git(changedFilesArgv(base), root);
  const files = names.out.split("\n").map((f) => f.trim()).filter(Boolean);
  const raw = await git(diffArgv(base), root);
  const diff = headToTokens(raw.out, maxTokens);
  return { base, files, diff, truncated: diff.length < raw.out.length };
}

/**
 * The findings, in the Problems panel.
 *
 * One collection, replaced each time: a review is a snapshot, and leaving the previous one behind
 * would mean somebody fixing a finding and still seeing it.
 */
export class ReviewDiagnostics {
  private readonly collection = vscode.languages.createDiagnosticCollection("hivey-code-review");

  dispose(): void {
    this.collection.dispose();
  }

  publish(root: string, findings: Finding[]): void {
    this.collection.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const finding of findings) {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), finding.file);
      // A finding about a whole file lands on its first line rather than nowhere: the Problems panel
      // needs a position, and line 1 is the honest place for "this module has no tests".
      const line = Math.max(0, (finding.line ?? 1) - 1);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        finding.fix ? `${finding.message}\n\nSuggested fix: ${finding.fix}` : finding.message,
        SEVERITY[finding.severity],
      );
      diagnostic.source = `Hivey Code · ${finding.category}`;
      const list = byFile.get(uri.fsPath) ?? [];
      list.push(diagnostic);
      byFile.set(uri.fsPath, list);
    }
    for (const [path, list] of byFile) this.collection.set(vscode.Uri.file(path), list);
  }
}

/**
 * What the command does: find the base, collect the diff, and hand both to the caller to review.
 *
 * The turn itself is run by the chat view, because that is where the model, the budget, the egress
 * gate and the transcript are — a review that went out through its own path would be a second place
 * where a request can leave the machine, which this product has exactly one of.
 */
export async function prepareReview(
  root: string,
): Promise<{ review: BranchReview; prompt: string } | { refused: string }> {
  const base = await detectBase(root);
  if (!base) {
    return {
      refused: t(
        "I could not work out what this branch came from: none of the usual bases resolved. Name one and I will review against it.",
      ),
    };
  }
  const review = await collectBranch(root, base);
  if (!review.files.length) {
    return { refused: t("This branch changes nothing against its base, so there is nothing to review.") };
  }
  return {
    review,
    prompt: [
      reviewPrompt({ base: review.base.slice(0, 12), files: review.files }),
      "",
      review.truncated
        ? "⚠️ The diff below was CUT to fit. Say so in your answer: the files after the cut were not reviewed."
        : "",
      "",
      "```diff",
      review.diff,
      "```",
    ]
      .filter((x) => x !== "")
      .join("\n"),
  };
}

export { summarise, parseFindings };
