// Running the workspace's hooks around a tool call.
//
// The decisions are in `core/hooks/hooks.ts`. This is the machine half: reading the file, asking
// once and remembering what was asked about, spawning the command, and reporting the result as a
// step so `verifyTurn` can see it.
//
// ⚠️ The consent is the important part of this file. A hook arrived with the repository is a command
// written by whoever sent the repository, and approving "hooks" in general would be approving every
// command anybody puts in that file afterwards. So the approval is pinned to a fingerprint of what
// RUNS — exactly as an MCP stdio server's approval is pinned to its tool descriptions — and a
// changed command asks again, naming it.

import * as vscode from "vscode";
import { spawn } from "node:child_process";
import {
  describeHooks,
  hookVerdict,
  hooksFingerprint,
  matchingHooks,
  parseHooks,
  type Hook,
  type HookRun,
} from "../core/hooks/hooks.js";
import { matchGlob } from "../core/util/glob.js";
import type { Tool, ToolResult } from "../core/agent/loop.js";
import { SECTION } from "./config.js";
import { t } from "../shared/i18n.js";

const APPROVED_KEY = "hiveyCode.hooks.approved";
const HOOKS_FILE = ".hiveycode/hooks.json";

export interface HookStep {
  name: string;
  command: string;
  ok: boolean;
  summary: string;
}

export class Hooks {
  /** Asked once per fingerprint per window; the answer is remembered per workspace. */
  private asking: Promise<boolean> | undefined;

  constructor(
    private readonly state: vscode.Memento,
    private readonly log: vscode.OutputChannel,
    /** Where a hook's result goes, so a failing one counts for `verifyTurn`. */
    private readonly onStep: (step: HookStep) => void,
  ) {}

  /**
   * The hooks this workspace declares, from the file and from the settings.
   *
   * The file first, because it is the versioned one a team shares. A setting is a personal
   * addition, and it is NOT subject to the consent dialog: the user wrote it themselves, on their
   * own machine, which is the whole difference from a file that arrived with a clone.
   */
  private async load(): Promise<{ fromRepository: Hook[]; own: Hook[] }> {
    const own = parseHooks(
      JSON.stringify(vscode.workspace.getConfiguration(SECTION).get<unknown[]>("hooks", [])),
      "settings",
    );
    if (own.problems.length) this.report(own.problems);

    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) return { fromRepository: [], own: own.hooks };
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root.uri, HOOKS_FILE)));
    } catch {
      return { fromRepository: [], own: own.hooks };
    }
    const parsed = parseHooks(text, HOOKS_FILE);
    if (parsed.problems.length) this.report(parsed.problems);
    return { fromRepository: parsed.hooks, own: own.hooks };
  }

  private report(problems: string[]): void {
    for (const problem of problems) this.log.appendLine(`[hooks] ${problem}`);
  }

  /**
   * Has the user approved the commands this repository wants to run?
   *
   * One dialog per distinct set of commands, and the dialog names them. A "no" is remembered for
   * that fingerprint too: being asked the same question on every tool call is how a refusal becomes
   * an accident.
   */
  private async approved(hooks: Hook[]): Promise<boolean> {
    if (!hooks.length) return true;
    const print = hooksFingerprint(hooks);
    const remembered = this.state.get<Record<string, boolean>>(APPROVED_KEY, {});
    if (print in remembered) return remembered[print]!;
    this.asking ??= (async () => {
      const answer = await vscode.window.showWarningMessage(
        describeHooks(hooks),
        { modal: true },
        t("Run them"),
        t("Never in this workspace"),
      );
      const yes = answer === t("Run them");
      await this.state.update(APPROVED_KEY, { ...this.state.get<Record<string, boolean>>(APPROVED_KEY, {}), [print]: yes });
      this.asking = undefined;
      return yes;
    })();
    return this.asking;
  }

  /**
   * Run the hooks for this moment, and say whether the call may proceed.
   *
   * `before` can refuse. `after` cannot — the call already happened, and pretending otherwise would
   * be a lie to the model about the state of the disk.
   */
  async run(when: "before" | "after", tool: string, args: Record<string, unknown>): Promise<{ allow: boolean; messages: string[] }> {
    const { fromRepository, own } = await this.load();
    const path = pathOf(args);
    const mine = matchingHooks(own, { when, tool, ...(path ? { path } : {}) }, matchGlob);
    const theirs = matchingHooks(fromRepository, { when, tool, ...(path ? { path } : {}) }, matchGlob);
    if (theirs.length && !(await this.approved(fromRepository))) {
      // Refused once, for this set: the hooks are simply not run. Not an error, and not a silent
      // success either — the log says so.
      this.log.appendLine(`[hooks] ${theirs.length} hook(s) from ${HOOKS_FILE} were not run: not approved.`);
      return this.runAll(when, mine);
    }
    return this.runAll(when, [...theirs, ...mine]);
  }

  private async runAll(when: "before" | "after", hooks: Hook[]): Promise<{ allow: boolean; messages: string[] }> {
    const messages: string[] = [];
    let allow = true;
    for (const hook of hooks) {
      const run = await this.spawn(hook);
      const verdict = hookVerdict(run);
      this.onStep({
        name: hook.name,
        command: hook.command,
        ok: run.code === 0 && !run.timedOut,
        summary: run.timedOut ? `${hook.name}: timed out` : `${hook.name}: exit ${run.code}`,
      });
      if (verdict.message) messages.push(verdict.message);
      if (!verdict.allow) {
        allow = false;
        // A refusal stops the rest: the call is not happening, so running the remaining before-hooks
        // would be running them for an event that will not occur.
        if (when === "before") break;
      }
    }
    return { allow, messages };
  }

  private spawn(hook: Hook): Promise<HookRun> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return new Promise<HookRun>((resolve) => {
      let output = "";
      let timedOut = false;
      const child = spawn(hook.command, { shell: true, cwd, env: { ...process.env } });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, hook.timeoutMs);
      const append = (chunk: unknown) => {
        output += String(chunk);
        if (output.length > 40_000) output = output.slice(-40_000);
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ hook, code: timedOut ? 124 : (code ?? 1), output, timedOut });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        // A hook that cannot be started is a hook that failed, and the reason is what the user needs.
        resolve({ hook, code: 127, output: `${output}\n${(err as Error).message}`, timedOut: false });
      });
    });
  }
}

/** The path a tool call is about, when it is about one. */
function pathOf(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file", "member"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Every tool, with the workspace's hooks around it.
 *
 * Wrapped here rather than inside each tool: a tool that had to remember to call the hooks is a
 * tool that will forget, and the one it forgets on is the one somebody wrote the hook for.
 */
export function withHooks(tools: Tool[], hooks: Hooks | undefined): Tool[] {
  if (!hooks) return tools;
  return tools.map((tool) => ({
    ...tool,
    async run(args, ctx): Promise<ToolResult> {
      const before = await hooks.run("before", tool.schema.name, args);
      if (!before.allow) return { content: before.messages.join("\n\n"), isError: true };

      const result = await tool.run(args, ctx);
      const after = await hooks.run("after", tool.schema.name, args);
      if (!after.messages.length) return result;
      // The hook's verdict is appended to the tool's own result rather than replacing it: the model
      // needs both what it did and what the team's check said about it.
      return {
        ...result,
        content: `${result.content}\n\n${after.messages.join("\n\n")}`,
        // A failing after-hook makes the step red, which is what `verifyTurn` reads.
        isError: result.isError || !after.allow || after.messages.some((m) => /failed after the call|verdict is unknown/.test(m)),
      };
    },
  }));
}
