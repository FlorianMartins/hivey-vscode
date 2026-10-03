// An agent working in its own branch, in its own directory, while somebody does something else.
//
// Two boundaries, and neither is the usual one. The container bounds what COMMANDS can do
// (`core/background/sandbox.ts`); the worktree bounds what the FILE TOOLS can see — and that second
// one is why this does not simply reuse `buildTools`. The editor's tools are rooted in the editor's
// workspace, so an agent holding them could edit the file its author has open, in the middle of
// their own edit, with nothing to say which change was whose. A background task gets a tool set of
// its own whose every path is resolved inside the worktree and refused outside it.
//
// ⚠️ The agent never pushes. There is no git tool here at all: the branch stays local, and what the
// author comes back to is a branch, a diff and a verdict — three things they can read before
// deciding anything.

import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn, type Tool, type ToolResult } from "../core/agent/loop.js";
import { underRoot } from "../core/fs/within.js";
import {
  DEFAULT_LIMITS,
  describeSandbox,
  mayRunInBackground,
  pickEngine,
  sandboxArgv,
  type Engine,
  type SandboxLimits,
} from "../core/background/sandbox.js";
import { branchName, createWorktreeArgv, patchArgv, removeWorktreeArgv } from "../core/background/worktree.js";
import { verifyTurn } from "../core/router/outcome.js";
import { makeProvider } from "../core/providers/index.js";
import { promptForMode } from "../core/session/modes.js";
import { readSettings, endpointFor, Keys, SECTION } from "./config.js";
import { t } from "../shared/i18n.js";

export interface BackgroundTask {
  id: string;
  task: string;
  branch: string;
  worktree: string;
  state: "running" | "done" | "failed" | "cancelled";
  /** What the agent said, once it has said it. */
  summary?: string;
  /** `verifyTurn`'s verdict, so the author knows whether to trust the diff. */
  verdict?: string;
  steps: number;
  startedAt: number;
  cancel: () => void;
}

function run(file: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ""}${stderr ?? ""}`;
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out });
    });
  });
}

async function engineAvailable(): Promise<Engine | undefined> {
  const has = async (file: string) => (await run(file, ["version"], tmpdir(), 10_000)).code === 0;
  return pickEngine({ docker: await has("docker"), podman: await has("podman") });
}

function limits(): SandboxLimits {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    cpus: Math.max(0.5, c.get<number>("background.cpus", DEFAULT_LIMITS.cpus)),
    memory: c.get<string>("background.memory", DEFAULT_LIMITS.memory).trim() || DEFAULT_LIMITS.memory,
    timeoutMs: DEFAULT_LIMITS.timeoutMs,
    image: c.get<string>("background.image", "").trim(),
  };
}

/**
 * The tools a background task gets.
 *
 * Deliberately small, and every path put through `underRoot` before it is touched. A background task
 * does not get the editor's diagnostics (there is no editor here), the plan tool (nobody is watching
 * it being built), or any IBM i tool (a partition is shared, and a background agent reaching one is
 * the opposite of isolated).
 */
function backgroundTools(worktree: string, engine: Engine | undefined): Tool[] {
  const inside = (path: string): string => {
    const placed = underRoot(path.startsWith("/") || /^[A-Za-z]:/.test(path) ? path : join(worktree, path), [worktree]);
    if (!placed) throw new Error(`Refused: “${path}” is outside this task's worktree, which is all it can see.`);
    return placed.relative ? join(worktree, placed.relative) : worktree;
  };

  const read: Tool = {
    parallel: () => true,
    schema: {
      name: "read_file",
      description: "Read a file from this task's worktree.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    approval: () => false,
    async run(args): Promise<ToolResult> {
      const text = await readFile(inside(String(args["path"] ?? "")), "utf8");
      return { content: text.slice(0, 60_000) };
    },
  };

  const list: Tool = {
    parallel: () => true,
    schema: {
      name: "list_files",
      description: "List the files in a directory of this task's worktree.",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
    approval: () => false,
    async run(args): Promise<ToolResult> {
      const dir = inside(String(args["path"] ?? "."));
      const entries = await readdir(dir, { withFileTypes: true });
      return { content: entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n") || "(empty)" };
    },
  };

  const write: Tool = {
    schema: {
      name: "write_file",
      description: "Create a file in this task's worktree, or replace its contents.",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    },
    // Nobody is watching, so nothing can be asked. The bound is the worktree and the branch, which
    // is why this mode exists at all.
    approval: () => false,
    async run(args): Promise<ToolResult> {
      const path = inside(String(args["path"] ?? ""));
      await writeFile(path, String(args["content"] ?? ""), "utf8");
      return { content: `Wrote ${String(args["path"])}.` };
    },
  };

  const edit: Tool = {
    schema: {
      name: "edit_file",
      description: "Replace an exact snippet in a file of this task's worktree. `old` must appear exactly once.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" } },
        required: ["path", "old", "new"],
      },
    },
    approval: () => false,
    async run(args): Promise<ToolResult> {
      const path = inside(String(args["path"] ?? ""));
      const text = await readFile(path, "utf8");
      const old = String(args["old"] ?? "");
      const first = text.indexOf(old);
      if (first < 0) return { content: "That snippet does not appear in the file. Read it again.", isError: true };
      if (text.indexOf(old, first + 1) >= 0) {
        return { content: "That snippet appears more than once. Include more surrounding lines.", isError: true };
      }
      await writeFile(path, text.slice(0, first) + String(args["new"] ?? "") + text.slice(first + old.length), "utf8");
      return { content: `Edited ${String(args["path"])}.` };
    },
  };

  const command: Tool = {
    schema: {
      name: "run_command",
      description:
        "Run a command in a container with NO NETWORK, with only this task's worktree mounted. " +
        "Refused outright when no container engine is available: a background task does not run " +
        "commands on the host.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const bounds = limits();
      const verdict = mayRunInBackground({ engine, image: bounds.image });
      if (!verdict.allow) return { content: verdict.why ?? "Refused.", isError: true };
      const request = { engine: engine!, worktree, command: String(args["command"] ?? ""), limits: bounds };
      const result = await run(engine!, sandboxArgv(request), worktree, bounds.timeoutMs);
      ctx.report(describeSandbox(request));
      return {
        content: `exit ${result.code}\n${describeSandbox(request)}\n\n${result.out.slice(-20_000)}`,
        isError: result.code !== 0,
      };
    },
  };

  return [read, list, write, edit, command];
}

export class Background {
  private readonly tasks = new Map<string, BackgroundTask>();

  constructor(
    private readonly keys: Keys,
    private readonly log: vscode.OutputChannel,
    private readonly onChange: () => void,
  ) {}

  list(): BackgroundTask[] {
    return [...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  cancel(id: string): void {
    this.tasks.get(id)?.cancel();
  }

  /** Several at once: each has its own worktree, so they cannot see each other's work either. */
  async start(task: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) {
      void vscode.window.showWarningMessage(t("A background task needs a folder open: it works in a git worktree of it."));
      return;
    }
    const settings = readSettings();
    const engine = await engineAvailable();
    if (!engine) {
      // Said before the task starts rather than when the first command is refused: somebody who
      // learns this twenty minutes in has lost twenty minutes.
      const go = await vscode.window.showWarningMessage(
        t("No container engine, so this task will not be able to run any command. Start it anyway?"),
        t("Start it"),
      );
      if (!go) return;
    }

    const branch = branchName(task);
    const worktree = await mkdtemp(join(tmpdir(), "hivey-task-"));
    const created = await run("git", createWorktreeArgv(worktree, branch), root.uri.fsPath);
    if (created.code !== 0) {
      void vscode.window.showErrorMessage(t("Could not create the worktree: {0}", created.out.split("\n")[0] ?? ""));
      await rm(worktree, { recursive: true, force: true });
      return;
    }

    const ctl = new AbortController();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: BackgroundTask = {
      id,
      task,
      branch,
      worktree,
      state: "running",
      steps: 0,
      startedAt: Date.now(),
      cancel: () => {
        ctl.abort();
        const found = this.tasks.get(id);
        if (found && found.state === "running") found.state = "cancelled";
        this.onChange();
      },
    };
    this.tasks.set(id, entry);
    this.onChange();

    void this.work(entry, settings, engine, ctl, root.uri.fsPath);
  }

  private async work(
    entry: BackgroundTask,
    settings: ReturnType<typeof readSettings>,
    engine: Engine | undefined,
    ctl: AbortController,
    root: string,
  ): Promise<void> {
    const steps: Array<{ tool: string; ok: boolean; summary: string; call?: string }> = [];
    try {
      const providerId = settings.chat.provider;
      const provider = makeProvider({
        id: providerId,
        baseUrl: endpointFor(settings, providerId),
        apiKey: (await this.keys.get(providerId)) ?? "",
      });
      const result = await runTurn({
        provider,
        model: settings.chat.model,
        messages: [
          {
            role: "system",
            content:
              `${promptForMode("agent")}\n\n` +
              `You are running in the BACKGROUND, in a git worktree of the user's repository, on the ` +
              `branch ${entry.branch}. Nobody is watching: nothing can be asked and nothing is ` +
              `approved, which is why you can see only this worktree and why commands run in a ` +
              `container with no network. You cannot reach the network, the rest of the machine, or ` +
              `any other branch. When you are done, say in two or three sentences what you changed ` +
              `and what you deliberately did not.`,
          },
          { role: "user", content: entry.task },
        ],
        tools: backgroundTools(entry.worktree, engine),
        maxTokens: settings.chat.maxOutputTokens,
        signal: ctl.signal,
        onToolResult: ({ call, result: r }) => {
          steps.push({ tool: call.name, ok: !r.isError, summary: String(r.content).split("\n")[0]?.slice(0, 120) ?? "", call: call.args });
          entry.steps = steps.length;
          this.onChange();
        },
      });
      const verdict = verifyTurn(steps);
      entry.summary = result.text.trim();
      entry.verdict = verdict.kind === "none" ? t("Nothing in the task reports a failure.") : verdict.why;
      entry.state = ctl.signal.aborted ? "cancelled" : verdict.kind === "none" ? "done" : "failed";
    } catch (err) {
      entry.state = ctl.signal.aborted ? "cancelled" : "failed";
      entry.summary = (err as Error).message;
      this.log.appendLine(`[background] ${entry.branch}: ${(err as Error).stack ?? (err as Error).message}`);
    } finally {
      this.onChange();
      await this.finish(entry, root);
    }
  }

  /**
   * What the author comes back to.
   *
   * A branch, a diff open in the editor, and the verdict — in that order of importance. The worktree
   * directory is left in place: removing it would take the diff with it, and the branch alone is not
   * what somebody wants to read at four o'clock.
   */
  private async finish(entry: BackgroundTask, root: string): Promise<void> {
    const patch = await run("git", patchArgv(), entry.worktree);
    const changed = patch.out.trim();
    const label =
      entry.state === "done"
        ? t("Background task finished on {0}.", entry.branch)
        : entry.state === "cancelled"
          ? t("Background task cancelled on {0}.", entry.branch)
          : t("Background task failed on {0}: {1}", entry.branch, entry.verdict ?? "");
    const answer = await vscode.window.showInformationMessage(
      `${label} ${entry.summary ?? ""}`.trim(),
      ...(changed ? [t("Open the diff")] : []),
      t("Discard the branch"),
    );
    if (answer === t("Open the diff") && changed) {
      const doc = await vscode.workspace.openTextDocument({ language: "diff", content: changed });
      await vscode.window.showTextDocument(doc, { preview: true });
    }
    if (answer === t("Discard the branch")) {
      await run("git", removeWorktreeArgv(entry.worktree), root);
      await run("git", ["branch", "-D", entry.branch], root);
      this.tasks.delete(entry.id);
      this.onChange();
    }
  }
}

/** Whether a path is inside a directory — exported for the test that holds the containment claim. */
export async function isInside(path: string, root: string): Promise<boolean> {
  try {
    await stat(path);
  } catch {
    /* a file that does not exist yet is still inside or outside */
  }
  return Boolean(underRoot(path, [root]));
}
