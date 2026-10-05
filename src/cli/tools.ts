// The terminal client's tools. Same contract as the editor's, different hands: here there is no
// WorkspaceEdit and no diff view, so the safety comes from three rules instead.
//
//   1. Nothing escapes the working directory. Paths are resolved and checked, not trusted.
//   2. Nothing is written without a diff printed first and a yes typed after it.
//   3. A command's output IS captured here (unlike in the editor, where it belongs to the user's
//      terminal), which makes the terminal client the better place to run tests.

import { spawn } from "node:child_process";
import { searchPattern } from "../core/agent/regex.js";
import { describeSlice, sliceLines } from "../core/fs/slice.js";
import { findUnique } from "../core/text/findText.js";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Tool, ToolResult } from "../core/agent/loop.js";
import { headToTokens } from "../core/util/tokens.js";
import { isBlockedPath } from "../core/util/glob.js";
import { t } from "../shared/i18n.js";

import { parsePlan, planSummary, PLAN_TOOL_DESCRIPTION, type Plan } from "../core/agent/plan.js";
import { NOTE_ASIDE_TOOL, type Notice } from "../core/session/notices.js";
import { toolsForAgent, type AgentDefinition } from "../core/agent/definitions.js";

export interface CliToolOptions {
  cwd: string;
  blockedGlobs: string[];
  /** Prints a diff and asks. The loop's approver handles yes/no; this one shows what changes. */
  showDiff: (path: string, before: string, after: string) => void;
  maxOutputChars?: number;
  /**
   * Where the agent's plan goes when it updates one.
   *
   * The panel had this tool from the start and the terminal did not, on the reasoning that "a tool
   * whose output nothing displays spends tokens for nothing". That was true while a plan was only a
   * progress display. It stopped being true when an unfinished plan became **evidence** the
   * escalation reads (`planVerdict`) — and it also meant the evaluation harness, which drives this
   * client, could not measure anything about plans at all.
   */
  onPlan?: (plan: Plan) => void;
  /**
   * Runs a sub-agent and returns its conclusion. Absent means the tool is not offered.
   *
   * A callback, like the panel's, because dispatching needs a provider and a key and this file has
   * neither — and because the decision of how a sub-agent's request is redacted belongs with the one
   * that redacts the main turn, not duplicated here.
   */
  runSubAgent?: (run: { definition: AgentDefinition; task: string; signal?: AbortSignal }) => Promise<string>;
  /** The agents on offer, repository ones first. Empty means the tool is not offered. */
  agents?: AgentDefinition[];
  /**
   * Where an aside goes.
   *
   * In the terminal from the start this time. The plan tool, the spending caps and the skills were
   * each added to the panel and forgotten here, and each time it meant the evaluation harness —
   * which drives this client — could not measure the thing at all.
   */
  onNotice?: (notice: Notice) => void;
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "target", ".venv", "__pycache__", ".next"]);

/**
 * Agents that only read, so several may run at once.
 *
 * The same list the panel uses, and for the same reason: three of them reading three parts of a
 * repository at once is the whole point of having them, while two that can write is a race.
 */
const READ_ONLY_TOOLS = new Set(["read_file", "list_files", "search_text", "update_plan", "note_aside"]);

export function safeResolve(opts: CliToolOptions, path: string): string {
  const full = isAbsolute(path) ? path : resolve(opts.cwd, path);
  const rel = relative(opts.cwd, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Refused: “${path}” is outside the working directory.`);
  if (isBlockedPath(rel.split(sep).join("/"), opts.blockedGlobs)) {
    throw new Error(`Refused: “${path}” is excluded by the privacy policy.`);
  }
  return full;
}

async function walk(dir: string, root: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, root, out, limit);
    else out.push(relative(root, full).split(sep).join("/"));
  }
}

export function buildCliTools(opts: CliToolOptions): Tool[] {
  const maxOut = opts.maxOutputChars ?? 8000;

  const updatePlan: Tool = {
    schema: {
      name: "update_plan",
      description: PLAN_TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            description: "The whole plan, every time — not just what changed.",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Short and imperative, in the user's language." },
                state: { type: "string", enum: ["pending", "running", "done", "skipped"] },
              },
              required: ["title", "state"],
            },
          },
        },
        required: ["steps"],
      },
    },
    // Never asked for: it writes nothing and reads nothing, and a dialog about a progress update is
    // the kind of prompt that teaches people to click through prompts.
    approval: () => false,
    parallel: () => true,
    async run(args, ctx) {
      const { plan, error } = parsePlan(args["steps"]);
      if (!plan) return { content: error ?? "Invalid plan.", isError: true };
      opts.onPlan?.(plan);
      const { done, total } = planSummary(plan);
      ctx.report(`plan: ${done}/${total}`);
      // Terse on purpose: this result is re-sent on every later step of the turn, and the model
      // already knows what it just wrote.
      return { content: `Plan updated (${done}/${total} done).` };
    },
  };

  const readFileTool: Tool = {
    schema: {
      name: "read_file",
      description:
        "Read a file from the working directory. Give `from` and `to` (1-based line numbers) to read " +
        "part of a large file; the result always says which lines came back and how to read on.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          from: { type: "number", description: "First line to return, 1-based. Default 1." },
          to: { type: "number", description: "Last line to return, 1-based and inclusive. Default: the end." },
        },
        required: ["path"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const path = safeResolve(opts, String(args["path"] ?? ""));
      const text = await readFile(path, "utf8");
      // The same range and the same notice as the panel's reader: one behaviour, two surfaces. See
      // `core/fs/slice.ts` for why truncating in silence sent a real session chasing `sed`.
      const slice = sliceLines(
        text,
        args["from"] === undefined ? undefined : Number(args["from"]),
        args["to"] === undefined ? undefined : Number(args["to"]),
      );
      ctx.report(
        slice.from === 1 && slice.to === slice.total
          ? t("read {0}", String(args["path"]))
          : t("read {0} (lines {1}-{2} of {3})", String(args["path"]), slice.from, slice.to, slice.total),
      );
      return { content: slice.text + describeSlice(slice, String(args["path"])) };
    },
  };

  const listFiles: Tool = {
    schema: {
      name: "list_files",
      description: "List files under the working directory, skipping build output and dependencies.",
      parameters: { type: "object", properties: { subdir: { type: "string" }, limit: { type: "number" } } },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const base = args["subdir"] ? safeResolve(opts, String(args["subdir"])) : opts.cwd;
      const out: string[] = [];
      await walk(base, opts.cwd, out, Math.min(Number(args["limit"] ?? 300), 1000));
      ctx.report(t("{0} file(s)", out.length));
      return { content: out.join("\n") || "(empty)" };
    },
  };

  const searchText: Tool = {
    schema: {
      name: "search_text",
      description: "Search the working directory for a regular expression.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" }, extension: { type: "string" } },
        required: ["pattern"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      let re: RegExp;
      let literal = false;
      try {
        // `(?i)` and friends: valid in ripgrep, Go, Rust, Python and PCRE, `Invalid group` in
        // JavaScript. And `total(` is not a regular expression at all — it is a model looking for a
        // call site. Both handled in `core/agent/regex.ts` rather than refused here.
        const found = searchPattern(String(args["pattern"] ?? ""));
        re = found.re;
        literal = found.literal;
      } catch (err) {
        return { content: `Invalid regular expression: ${(err as Error).message}`, isError: true };
      }
      const ext = args["extension"] ? String(args["extension"]) : undefined;
      const files: string[] = [];
      await walk(opts.cwd, opts.cwd, files, 4000);
      const hits: string[] = [];
      for (const f of files) {
        if (ext && !f.endsWith(ext)) continue;
        if (hits.length >= 60) break;
        try {
          const info = await stat(join(opts.cwd, f));
          if (info.size > 400_000) continue;
          const lines = (await readFile(join(opts.cwd, f), "utf8")).split("\n");
          for (let i = 0; i < lines.length && hits.length < 60; i++) {
            if (re.test(lines[i]!)) hits.push(`${f}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
          }
        } catch {
          /* unreadable */
        }
      }
      ctx.report(t("{0} match(es)", hits.length));
      // Said, because the model must not conclude that `total(` is a working regular expression and
      // build the next pattern on that belief.
      const note = literal ? "(searched as plain text: that pattern is not a valid regular expression)\n" : "";
      return { content: note + (hits.join("\n") || "(no match)") };
    },
  };

  const writeFileTool: Tool = {
    schema: {
      name: "write_file",
      description: "Create a file or replace its contents. Prefer edit_file for an existing file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    approval: (args) => t("write {0}", String(args["path"])),
    async run(args, ctx): Promise<ToolResult> {
      const rel = String(args["path"] ?? "");
      const path = safeResolve(opts, rel);
      const content = String(args["content"] ?? "");
      let before = "";
      try {
        before = await readFile(path, "utf8");
      } catch {
        /* new file */
      }
      opts.showDiff(rel, before, content);
      await writeFile(path, content, "utf8");
      ctx.report(t("wrote {0}", rel));
      return { content: `Wrote ${rel} (${content.split("\n").length} lines).` };
    },
  };

  const editFile: Tool = {
    schema: {
      name: "edit_file",
      description: "Replace an exact snippet in a file. The snippet must appear exactly once.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" } },
        required: ["path", "old", "new"],
      },
    },
    approval: (args) => t("edit {0}", String(args["path"])),
    async run(args, ctx): Promise<ToolResult> {
      const rel = String(args["path"] ?? "");
      const path = safeResolve(opts, rel);
      const oldText = String(args["old"] ?? "");
      const newText = String(args["new"] ?? "");
      const text = await readFile(path, "utf8");
      // The same matcher as the panel's editor: `é` written as one code point and as `e` plus a
      // combining accent are the same text on screen and different strings to `indexOf`. One
      // behaviour, two surfaces — see `core/text/findText.ts`.
      const found = findUnique(text, oldText);
      if ("problem" in found) {
        return {
          content:
            found.problem === "absent"
              ? "That snippet does not appear in the file. Read it again — use read_file with `from` and `to` if it is long."
              : "That snippet appears more than once. Include more surrounding lines.",
          isError: true,
        };
      }
      const next = text.slice(0, found.start) + newText + text.slice(found.end);
      opts.showDiff(rel, text, next);
      await writeFile(path, next, "utf8");
      ctx.report(t("edited {0}", rel));
      return { content: `Edited ${rel}.` };
    },
  };

  const runCommand: Tool = {
    schema: {
      name: "run_command",
      description: "Run a shell command in the working directory and return its output. Use it for tests and builds.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" }, timeoutMs: { type: "number" } },
        required: ["command"],
      },
    },
    approval: (args) => t("run `{0}`", String(args["command"])),
    async run(args, ctx): Promise<ToolResult> {
      const command = String(args["command"] ?? "");
      const timeout = Math.min(Number(args["timeoutMs"] ?? 120_000), 600_000);
      ctx.report(`$ ${command}`);
      return await new Promise<ToolResult>((resolveResult) => {
        const child = spawn(command, { cwd: opts.cwd, shell: true });
        let out = "";
        let killed = false;
        const timer = setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, timeout);
        const onAbort = () => child.kill("SIGKILL");
        ctx.signal?.addEventListener("abort", onAbort, { once: true });
        const append = (chunk: Buffer) => {
          out += chunk.toString();
          // Keep the END of a long log: the failure is at the bottom, not at the top.
          if (out.length > maxOut * 2) out = out.slice(-maxOut * 2);
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.on("close", (code) => {
          clearTimeout(timer);
          ctx.signal?.removeEventListener("abort", onAbort);
          const tail = out.length > maxOut ? `…(start truncated)\n${out.slice(-maxOut)}` : out;
          resolveResult({
            content: `exit code ${killed ? "killed (timeout)" : code}\n${tail || "(no output)"}`,
            isError: code !== 0,
          });
        });
      });
    },
  };

  const noteAside: Tool = {
    schema: NOTE_ASIDE_TOOL,
    approval: () => false,
    parallel: () => true,
    async run(args, ctx) {
      const what = String(args["what"] ?? "").trim();
      if (!what) return { content: "An aside needs something to say.", isError: true };
      const where = String(args["where"] ?? "").trim();
      opts.onNotice?.({ kind: "noticed", text: what, ...(where ? { where } : {}) });
      ctx.report(`noted: ${what.slice(0, 60)}`);
      return { content: "Noted for the user. Do not change it." };
    },
  };

  const agents = opts.agents ?? [];
  const runAgent: Tool | undefined =
    agents.length && opts.runSubAgent
      ? {
          schema: {
            name: "run_agent",
            description:
              `Hand a self-contained task to a sub-agent. It works on its own and returns only its conclusion. Available: ${agents
                .map((a) => `${a.name} (${a.description})`)
                .join("; ")}`,
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", enum: agents.map((a) => a.name), description: "Which sub-agent." },
                task: {
                  type: "string",
                  description: "What it should do, in full — it sees nothing of this conversation.",
                },
              },
              required: ["name", "task"],
            },
          },
          // Read-only agents may fan out; one that can write may not. Two agents editing files at the
          // same time is a race nobody reconstructs from a transcript — the panel's rule, and the
          // same one, because it is a property of the agents and not of the client.
          parallel: (args) => {
            const found = agents.find((a) => a.name === String(args["name"] ?? ""));
            if (!found?.tools.length) return false; // no restriction means it may write
            return found.tools.every((tool) => READ_ONLY_TOOLS.has(tool));
          },
          // Not asked for here: whatever the sub-agent does goes through the same approver, so a
          // dialog still appears at the moment something is actually changed.
          approval: () => false,
          async run(args, ctx): Promise<ToolResult> {
            const wanted = String(args["name"] ?? "");
            const definition = agents.find((a) => a.name === wanted);
            if (!definition) {
              return { content: `No agent named "${wanted}". Available: ${agents.map((a) => a.name).join(", ")}.`, isError: true };
            }
            const task = String(args["task"] ?? "").trim();
            if (!task) return { content: "A sub-agent needs a task. It cannot see this conversation.", isError: true };
            // `toolsForAgent` intersects with what this client offers AND subtracts `run_agent`: a
            // sub-agent is a leaf. See `NEVER_DELEGATES`.
            const allowed = toolsForAgent(definition, [
              readFileTool, listFiles, searchText, writeFileTool, editFile, runCommand, updatePlan, noteAside,
            ].map((tool) => tool.schema.name));
            ctx.report(`agent ${definition.name}: ${task.slice(0, 60)}`);
            const answer = await opts.runSubAgent!({
              definition: { ...definition, tools: allowed },
              task,
              ...(ctx.signal ? { signal: ctx.signal } : {}),
            });
            return { content: answer || "The sub-agent returned nothing." };
          },
        }
      : undefined;

  return [
    readFileTool, listFiles, searchText, writeFileTool, editFile, runCommand, updatePlan, noteAside,
    ...(runAgent ? [runAgent] : []),
  ];
}
