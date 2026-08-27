// Git, through the editor's own Git extension rather than through a shell.
//
// Shelling out to `git` would be shorter to write and worse in every way that matters here. The
// built-in extension already knows which repository the open file belongs to, which is not always
// the workspace root; it already holds an authenticated credential helper, so a fetch does not
// hang forever on a password prompt nobody can see; and it reports the working tree as structured
// state instead of as text this code would have to re-parse. Above all, a shell command is an
// arbitrary shell command: `git_log` implemented as `run_command` would be one quoting mistake
// away from running something else.
//
// The types are declared locally and minimally. There is no @types package for the Git extension's
// API, and adding a runtime dependency to describe an interface we use eight methods of would
// break the one architectural promise this extension makes.

import * as vscode from "vscode";
import { t } from "../../shared/i18n.js";
import type { Tool, ToolResult } from "../../core/agent/loop.js";
import { headToTokens } from "../../core/util/tokens.js";

const MAX_DIFF_TOKENS = 5000;

interface GitChange {
  uri: vscode.Uri;
  originalUri: vscode.Uri;
  renameUri?: vscode.Uri;
  status: number;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string; upstream?: { name: string }; ahead?: number; behind?: number };
    refs: Array<{ name?: string; type: number; commit?: string }>;
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    mergeChanges: GitChange[];
  };
  diff(cached?: boolean): Promise<string>;
  diffWithHEAD(path?: string): Promise<string>;
  diffIndexWithHEAD(path?: string): Promise<string>;
  log(options?: { maxEntries?: number; path?: string }): Promise<Array<{ hash: string; message: string; authorName?: string; authorDate?: Date }>>;
  blame(path: string): Promise<string>;
  show(ref: string, path: string): Promise<string>;
  add(paths: string[]): Promise<void>;
  commit(message: string, opts?: { all?: boolean }): Promise<void>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
}

interface GitApi {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

/** The status codes the Git extension reports, in the words a person uses for them. */
const STATUS: Record<number, string> = {
  0: "modified",
  1: "added",
  2: "deleted",
  3: "renamed",
  4: "copied",
  5: "modified",
  6: "added",
  7: "deleted",
  8: "renamed",
  9: "copied",
  10: "untracked",
  11: "ignored",
  12: "conflict",
};

export function gitApi(): GitApi | undefined {
  const ext = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>("vscode.git");
  if (!ext?.isActive) return undefined;
  try {
    return ext.exports.getAPI(1);
  } catch {
    return undefined;
  }
}

/** True when there is a repository to talk to — drives whether the tools are offered at all. */
export function gitAvailable(): boolean {
  return (gitApi()?.repositories.length ?? 0) > 0;
}

/**
 * The repository a request is about.
 *
 * The active editor decides, not the workspace root: in a monorepo of submodules, or a workspace
 * with two folders, "the first repository" is a coin flip and the file on screen is not.
 */
function repoFor(hint?: string): GitRepository {
  const api = gitApi();
  if (!api) throw new Error("The built-in Git extension is not available.");
  if (hint) {
    const match = api.repositories.find((r) => r.rootUri.fsPath.endsWith(hint) || r.rootUri.path.includes(hint));
    if (match) return match;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  const byActive = active ? api.getRepository(active) : null;
  const repo = byActive ?? api.repositories[0];
  if (!repo) throw new Error("No Git repository is open.");
  return repo;
}

function rel(repo: GitRepository, uri: vscode.Uri): string {
  const root = repo.rootUri.path.replace(/\/$/, "");
  return uri.path.startsWith(root) ? uri.path.slice(root.length + 1) : uri.path;
}

/** The working tree as a short report — the shape `git status --short` has, minus the parsing. */
function statusText(repo: GitRepository): string {
  const head = repo.state.HEAD;
  const lines: string[] = [];
  lines.push(`Branch: ${head?.name ?? "(detached)"}${head?.commit ? ` at ${head.commit.slice(0, 8)}` : ""}`);
  if (head?.upstream) {
    lines.push(`Upstream: ${head.upstream.name} (ahead ${head.ahead ?? 0}, behind ${head.behind ?? 0})`);
  }
  const section = (title: string, changes: GitChange[]) => {
    if (!changes.length) return;
    lines.push("", `${title}:`);
    for (const c of changes.slice(0, 100)) {
      lines.push(`  ${STATUS[c.status] ?? "changed"} ${rel(repo, c.uri)}`);
    }
    if (changes.length > 100) lines.push(`  … and ${changes.length - 100} more`);
  };
  section("Staged", repo.state.indexChanges);
  section("Not staged", repo.state.workingTreeChanges);
  section("Conflicts", repo.state.mergeChanges);
  if (!repo.state.indexChanges.length && !repo.state.workingTreeChanges.length && !repo.state.mergeChanges.length) {
    lines.push("", "The working tree is clean.");
  }
  return lines.join("\n");
}

/** Used by the `#changes` context variable as well as by the tool, so the two never disagree. */
export async function gitChangesSummary(): Promise<string | undefined> {
  if (!gitAvailable()) return undefined;
  const repo = repoFor();
  const staged = await repo.diff(true).catch(() => "");
  const unstaged = await repo.diff(false).catch(() => "");
  const diff = [staged && `# Staged\n${staged}`, unstaged && `# Not staged\n${unstaged}`].filter(Boolean).join("\n\n");
  if (!diff.trim()) return `${statusText(repo)}`;
  return `${statusText(repo)}\n\n${headToTokens(diff, MAX_DIFF_TOKENS)}`;
}

export function buildGitTools(): Tool[] {
  const status: Tool = {
    schema: {
      name: "git_status",
      description:
        "The state of the Git working tree: current branch, upstream position, staged and unstaged files, conflicts.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    approval: () => false,
    async run(_args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      ctx.report(t("read the Git status"));
      return { content: statusText(repo) };
    },
  };

  const diff: Tool = {
    schema: {
      name: "git_diff",
      description:
        "The diff of the working tree. Use staged=true for what is about to be committed, or path to limit it to one file.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Diff the index against HEAD instead of the working tree." },
          path: { type: "string", description: "Limit the diff to this path, relative to the repository root." },
        },
        required: [],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      const path = args["path"] ? String(args["path"]) : undefined;
      const staged = args["staged"] === true;
      const text = path
        ? staged
          ? await repo.diffIndexWithHEAD(path)
          : await repo.diffWithHEAD(path)
        : await repo.diff(staged);
      ctx.report(t("diffed {0}", path ?? (staged ? t("the index") : t("the working tree"))));
      return { content: text.trim() ? headToTokens(text, MAX_DIFF_TOKENS) : "No differences." };
    },
  };

  const log: Tool = {
    schema: {
      name: "git_log",
      description: "Recent commits, newest first. Give a path to see the history of one file.",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "How many commits (default 20, maximum 100)." },
          path: { type: "string", description: "Limit the history to this path." },
        },
        required: [],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      const maxEntries = Math.min(Math.max(Number(args["count"] ?? 20) || 20, 1), 100);
      const path = args["path"] ? String(args["path"]) : undefined;
      const commits = await repo.log(path ? { maxEntries, path } : { maxEntries });
      ctx.report(t("read {0} commits", commits.length));
      const out = commits
        .map((c) => {
          const when = c.authorDate ? c.authorDate.toISOString().slice(0, 10) : "";
          return `${c.hash.slice(0, 8)} ${when} ${c.authorName ?? ""} — ${c.message.split("\n")[0]}`;
        })
        .join("\n");
      return { content: out || "No commits." };
    },
  };

  const branches: Tool = {
    schema: {
      name: "git_branches",
      description: "The branches and tags known to the repository, with the current one marked.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    approval: () => false,
    async run(_args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      const current = repo.state.HEAD?.name;
      const names = repo.state.refs
        .filter((r) => r.name)
        .slice(0, 200)
        .map((r) => `${r.name === current ? "* " : "  "}${r.name}`);
      ctx.report(t("listed {0} branches", names.length));
      return { content: names.join("\n") || "No branches." };
    },
  };

  const blame: Tool = {
    schema: {
      name: "git_blame",
      description: "Who last changed each line of a file, and in which commit. Answers “why is this line here”.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the repository root." } },
        required: ["path"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      const path = String(args["path"] ?? "");
      const text = await repo.blame(path);
      ctx.report(t("blamed {0}", path));
      return { content: headToTokens(text, MAX_DIFF_TOKENS) };
    },
  };

  const show: Tool = {
    schema: {
      name: "git_show",
      description: "The content of a file at a given revision — a branch, a tag or a commit hash.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Revision, for example HEAD~1, main, or a commit hash." },
          path: { type: "string", description: "Path relative to the repository root." },
        },
        required: ["ref", "path"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      const ref = String(args["ref"] ?? "HEAD");
      const path = String(args["path"] ?? "");
      const text = await repo.show(ref, path);
      ctx.report(t("read {0} at {1}", path, ref));
      return { content: headToTokens(text, MAX_DIFF_TOKENS) };
    },
  };

  const stage: Tool = {
    schema: {
      name: "git_stage",
      description: "Stage files for the next commit.",
      parameters: {
        type: "object",
        properties: { paths: { type: "array", items: { type: "string" }, description: "Paths relative to the repository root." } },
        required: ["paths"],
      },
    },
    approval: (args) => t("stage {0} file(s)", (args["paths"] as string[] | undefined)?.length ?? 0),
    async run(args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      const paths = (args["paths"] as string[] | undefined) ?? [];
      await repo.add(paths.map((p) => vscode.Uri.joinPath(repo.rootUri, p).fsPath));
      ctx.report(t("staged {0} file(s)", paths.length));
      return { content: `Staged: ${paths.join(", ")}` };
    },
  };

  const commit: Tool = {
    schema: {
      name: "git_commit",
      // The description says what it does NOT do on purpose: a model told only "commit" reaches
      // for a push next, and a push is not something this extension will do behind a dialog.
      description:
        "Commit what is staged. This never pushes: publishing a branch stays a decision the user makes themselves.",
      parameters: {
        type: "object",
        properties: { message: { type: "string", description: "The commit message." } },
        required: ["message"],
      },
    },
    approval: (args) => t("commit “{0}”", String(args["message"] ?? "").split("\n")[0] ?? ""),
    async run(args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      const message = String(args["message"] ?? "").trim();
      if (!message) throw new Error("A commit needs a message.");
      if (!repo.state.indexChanges.length) throw new Error("Nothing is staged.");
      await repo.commit(message);
      ctx.report(t("committed"));
      return { content: `Committed: ${message.split("\n")[0]}` };
    },
  };

  const branch: Tool = {
    schema: {
      name: "git_branch",
      description: "Create a branch and switch to it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The new branch name." },
          from: { type: "string", description: "The revision to branch from (default: current HEAD)." },
        },
        required: ["name"],
      },
    },
    approval: (args) => t("create and switch to the branch {0}", String(args["name"] ?? "")),
    async run(args, ctx): Promise<ToolResult> {
      const repo = repoFor();
      const name = String(args["name"] ?? "");
      await repo.createBranch(name, true, args["from"] ? String(args["from"]) : undefined);
      ctx.report(t("switched to {0}", name));
      return { content: `On branch ${name}.` };
    },
  };

  return [status, diff, log, branches, blame, show, stage, commit, branch];
}
