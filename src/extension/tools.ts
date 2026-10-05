// What the agent can do, expressed as tools the editor performs on its behalf.
//
// Every one of them goes through VS Code rather than through the filesystem directly, and that is
// not a stylistic choice: an edit applied as a WorkspaceEdit lands in the undo stack, respects the
// user's formatter, and shows up in the diff view. An edit written with `fs.writeFile` is a
// surprise the user cannot undo.
//
// The permission model is the same one Claude Code taught everyone to expect: reading is free,
// changing is asked. Each tool answers `approval()` for itself, so the rule is next to the thing
// it governs and a new tool cannot forget to have one.

import * as vscode from "vscode";
import { compilePattern } from "../core/agent/regex.js";
import { t } from "../shared/i18n.js";
import { parsePlan, planSummary, PLAN_TOOL_DESCRIPTION, type Plan } from "../core/agent/plan.js";
import { NOTE_ASIDE_TOOL, type Notice } from "../core/session/notices.js";
import { editProblems } from "../core/agent/afterEdit.js";
import type { Tool, ToolResult } from "../core/agent/loop.js";
import { headToTokens } from "../core/util/tokens.js";
import { EgressGate } from "./egress.js";
import type { Settings } from "./config.js";
import { relative } from "./workspace.js";
import { openFileUris } from "./models.js";
import { buildGitTools, gitAvailable } from "./integrations/git.js";
import { buildIbmiTools, ibmiEnabled } from "./integrations/ibmi.js";
import { readSettings } from "./config.js";
import { arcadInstalled, buildArcadTools, type ArcadDeps } from "./integrations/arcad.js";
import { buildKnowledgeTools } from "./knowledge.js";
import type { McpManager } from "./integrations/mcp.js";
import { runCommandInTerminal } from "./terminal.js";
import { withHooks, type Hooks } from "./hooks.js";
import { buildSymbolTools } from "./symbols.js";
import { isAbsolutePath, tidyPath, underRoot } from "../core/fs/within.js";

/**
 * Whether two paths differing only in case are the same file.
 *
 * Windows only. macOS folds by default and can be configured not to, and a case difference in a
 * path a model produced is far more likely to be an invention than a real file — so there the
 * stricter answer is also the more useful one.
 */
const FOLD_CASE = process.platform === "win32";

const MAX_READ_TOKENS = 6000;
const MAX_MATCHES = 60;

function root(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("No folder is open.");
  return folder.uri;
}

/**
 * A path the model named, turned into the file it meant.
 *
 * Three cases, and only the first used to work.
 *
 *   ONE FOLDER      join and go.
 *   SEVERAL         the paths the model was shown come from `relative()`, which prefixes the folder
 *                   name when there is more than one. Joining that onto the FIRST folder produced a
 *                   path pointing nowhere — in a multi-root workspace every file outside the first
 *                   folder was unreadable, and the model was told so in words that sound like the
 *                   folder is missing.
 *   NONE            a window with files open and no folder — which is ordinary when the files come
 *                   from a remote, an IBM i partition or a drag-and-drop. Every tool answered "No
 *                   folder is open", and the user, looking at their open files, reads that as the
 *                   extension having lost the workspace. The tabs ARE the workspace here, so a path
 *                   is matched against them.
 */
function resolve(path: string, settings: Settings): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders ?? [];

  // An absolute path is not a path outside the workspace, and the rule that treated the two as one
  // thing is what made agent mode stop changing files. `/home/me/proj/src/a.ts` IS `src/a.ts` when
  // that folder is open, and it is the spelling the editor itself puts in diagnostics, terminal
  // output and stack traces — so a model that read one and named it back was told its own correct
  // answer "leaves the workspace", once per attempted edit. Containment is decided by resolving
  // the path and looking at where it landed; see `underRoot`.
  if (isAbsolutePath(path)) {
    const placed = underRoot(
      path,
      folders.map((f) => f.uri.path),
      FOLD_CASE,
    );
    if (placed) {
      // Checked on the part under the root, not on what the model typed: the privacy list is
      // written in workspace-relative globs, and `**/.env*` matches `.env` and not `/home/me/.env`.
      if (EgressGate.isBlocked(placed.relative, settings.privacy.blockedGlobs)) {
        throw new Error(`Refused: “${path}” is excluded by the privacy policy.`);
      }
      const folder = folders.find((f) => f.uri.path === placed.root)!;
      return placed.relative ? vscode.Uri.joinPath(folder.uri, placed.relative) : folder.uri;
    }
    // No folder open, or outside all of them: an open tab is still somewhere the user chose to
    // work, and naming it by its full path is the obvious thing to do.
    const exact = openFileUris().find((uri) => tidyPath(uri.path) === tidyPath(path));
    if (exact) {
      // The same list as every other branch. A tab is a place the user chose, not an exemption:
      // `~/.ssh/id_rsa` left open in the editor would otherwise be readable just by naming it in
      // full. The leading slash is dropped because the list is written workspace-relative, and
      // `**/.env*` needs a segment to begin matching against.
      if (EgressGate.isBlocked(tidyPath(path).replace(/^\/+/, ""), settings.privacy.blockedGlobs)) {
        throw new Error(`Refused: “${path}” is excluded by the privacy policy.`);
      }
      return exact;
    }
    throw new Error(
      folders.length
        ? `Refused: “${path}” is outside the folder(s) open in the editor.`
        : `Refused: “${path}” is not one of the open files, and no folder is open.`,
    );
  }

  // A relative path. A tool call is model output, and model output can be steered by a file it just
  // read, so climbing out of the workspace is refused here rather than trusted to the model's good
  // manners — and `..` is REFUSED rather than resolved, which is the promise `docs/THREAT-MODEL.md`
  // makes and the stronger of the two available rules. Resolving it would also be correct, since
  // containment is checked afterwards either way; it would buy nothing but `src/sub/../a.ts`, and
  // it would mean a guarantee stated in prose no longer matched the code literally.
  const clean = tidyPath(path).replace(/^\.\//, "");
  if (!clean || clean.includes("..")) {
    throw new Error(`Refused: “${path}” leaves the workspace.`);
  }
  if (EgressGate.isBlocked(clean, settings.privacy.blockedGlobs)) {
    throw new Error(`Refused: “${path}” is excluded by the privacy policy.`);
  }

  if (folders.length > 1) {
    const named = folders.find((f) => clean === f.name || clean.startsWith(`${f.name}/`));
    if (named) {
      const rest = clean.slice(named.name.length).replace(/^\//, "");
      return rest ? vscode.Uri.joinPath(named.uri, rest) : named.uri;
    }
  }
  if (folders.length) return vscode.Uri.joinPath(folders[0]!.uri, clean);

  const open = openFileUris().find((uri) => uri.path === `/${clean}` || uri.path.endsWith(`/${clean}`));
  if (open) return open;
  const tabs = openFileUris().length;
  throw new Error(
    tabs
      ? `No folder is open, and none of the ${tabs} open file(s) is “${path}”. Name one of them, or ask the user to open the folder.`
      : `No folder is open and no file is open. Ask the user to open the folder this question is about.`,
  );
}

export interface ToolDeps {
  settings: () => Settings;
  /** The workspace's own commands, run around every tool call. Absent means none are configured. */
  hooks?: Hooks;
  /** Shows a diff and returns what the user chose. */
  confirmEdit?: (uri: vscode.Uri, next: string) => Promise<boolean>;
  /** The Elias credentials, read from the keychain when an ARCAD call needs them. */
  arcad?: ArcadDeps;
  /** Running MCP servers, whose tools join the set. */
  mcp?: McpManager;
  /** Where the agent's plan goes when it updates one. Absent means the plan tool is not offered. */
  onPlan?: (plan: Plan) => void;
  /** Where an aside goes. Absent means the tool is not offered — the user switched the section off. */
  onNotice?: (notice: Notice) => void;
}

export function buildTools(deps: ToolDeps): Tool[] {
  const s = () => deps.settings();

  const readFile: Tool = {
    parallel: () => true,
    schema: {
      name: "read_file",
      description: "Read a file from the workspace. Returns its text, truncated if very large.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the workspace root." } },
        required: ["path"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const uri = resolve(String(args["path"] ?? ""), s());
      const doc = await vscode.workspace.openTextDocument(uri);
        ctx.report(t("read {0} ({1} lines)", relative(uri), doc.lineCount));
      return { content: headToTokens(doc.getText(), MAX_READ_TOKENS) };
    },
  };

  const listFiles: Tool = {
    parallel: () => true,
    schema: {
      name: "list_files",
      description: "List workspace files matching a glob, e.g. `src/**/*.ts`.",
      parameters: {
        type: "object",
        properties: { glob: { type: "string" }, limit: { type: "number" } },
        required: ["glob"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const glob = String(args["glob"] ?? "**/*");
      const limit = Math.min(Number(args["limit"] ?? 100), 300);
      const uris = await vscode.workspace.findFiles(glob, undefined, limit);
      ctx.report(t("{0} file(s) for {1}", uris.length, glob));
      return { content: uris.map(relative).join("\n") || "(no match)" };
    },
  };

  const searchText: Tool = {
    parallel: () => true,
    schema: {
      name: "search_text",
      description: "Search the workspace for a regular expression. Returns matching lines with their paths.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" }, glob: { type: "string", description: "Optional file filter." } },
        required: ["pattern"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const pattern = String(args["pattern"] ?? "");
      const glob = String(args["glob"] ?? "**/*");
      let re: RegExp;
      try {
        // Same translation as the terminal client's search: one dialect difference, fixed in one
        // place, or the two surfaces answer the same pattern differently.
        re = compilePattern(pattern, "g");
      } catch (err) {
        return { content: `Invalid regular expression: ${(err as Error).message}`, isError: true };
      }
      const uris = await vscode.workspace.findFiles(glob, undefined, 800);
      const out: string[] = [];
      for (const uri of uris) {
        if (out.length >= MAX_MATCHES) break;
        try {
          const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && out.length < MAX_MATCHES; i++) {
            re.lastIndex = 0;
            if (re.test(lines[i]!)) out.push(`${relative(uri)}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
          }
        } catch {
          /* unreadable file */
        }
      }
      ctx.report(t("{0} match(es) for /{1}/", out.length, pattern));
      return { content: out.join("\n") || "(no match)" };
    },
  };

  const diagnostics: Tool = {
    parallel: () => true,
    schema: {
      name: "get_diagnostics",
      description:
        "Errors and warnings the editor's language servers currently report. Use this after an edit to check the work, instead of guessing.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Optional: one file only." } } },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const only = args["path"] ? resolve(String(args["path"]), s()).toString() : undefined;
      const all = vscode.languages.getDiagnostics();
      const lines: string[] = [];
      for (const [uri, list] of all) {
        if (only && uri.toString() !== only) continue;
        for (const d of list.slice(0, 20)) {
          const sev = ["error", "warning", "info", "hint"][d.severity] ?? "info";
          lines.push(`${relative(uri)}:${d.range.start.line + 1} ${sev}: ${d.message}`);
        }
      }
      ctx.report(t("{0} diagnostic(s)", lines.length));
      return { content: lines.slice(0, 100).join("\n") || "No diagnostics." };
    },
  };

  const writeFile: Tool = {
    schema: {
      name: "write_file",
      description: "Create a file or replace its entire contents. Prefer edit_file for a change to an existing file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    approval: (args) => t("write {0}", String(args["path"])),
    async run(args, ctx): Promise<ToolResult> {
      const uri = resolve(String(args["path"] ?? ""), s());
      const content = String(args["content"] ?? "");
      if (deps.confirmEdit && !(await deps.confirmEdit(uri, content))) {
        return { content: "The user rejected the change after reviewing the diff.", isError: true };
      }
      const edit = new vscode.WorkspaceEdit();
      let existed = true;
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        existed = false;
      }
      if (existed) {
        const doc = await vscode.workspace.openTextDocument(uri);
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), content);
      } else {
        edit.createFile(uri, { contents: new TextEncoder().encode(content), overwrite: false });
      }
      const ok = await vscode.workspace.applyEdit(edit);
      ctx.report(existed ? t("edited {0}", relative(uri)) : t("created {0}", relative(uri)));
      if (!ok) return { content: "The editor refused the edit.", isError: true };
      // Through to disk before anything reads the file. See `saveAfterEdit`.
      const unsaved = await saveAfterEdit(uri);
      // The same report as `edit_file`: writing a whole file is at least as likely to break it as
      // replacing a snippet, and the model has even less reason to suspect it did.
      const problems = await errorsAfterEdit(uri);
      return {
        content: `Wrote ${relative(uri)} (${content.split("\n").length} lines).${problems ? `\n${problems}` : ""}${unsaved}`,
        display: { uri: uri.toString() },
      };
    },
  };

  const editFile: Tool = {
    schema: {
      name: "edit_file",
      description:
        "Replace an exact snippet in a file. `old` must appear exactly once. This is the preferred way to change existing code: it is reviewable and it cannot silently rewrite the rest of the file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" } },
        required: ["path", "old", "new"],
      },
    },
    approval: (args) => t("edit {0}", String(args["path"])),
    async run(args, ctx): Promise<ToolResult> {
      const uri = resolve(String(args["path"] ?? ""), s());
      const oldText = String(args["old"] ?? "");
      const newText = String(args["new"] ?? "");
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const first = text.indexOf(oldText);
      if (first < 0) return { content: "That snippet does not appear in the file. Read it again.", isError: true };
      if (text.indexOf(oldText, first + 1) >= 0) {
        return { content: "That snippet appears more than once. Include more surrounding lines.", isError: true };
      }
      const next = text.slice(0, first) + newText + text.slice(first + oldText.length);
      if (deps.confirmEdit && !(await deps.confirmEdit(uri, next))) {
        return { content: "The user rejected the change after reviewing the diff.", isError: true };
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(first), doc.positionAt(first + oldText.length)), newText);
      const ok = await vscode.workspace.applyEdit(edit);
      ctx.report(t("edited {0}", relative(uri)));
      if (!ok) return { content: "The editor refused the edit.", isError: true };
      // Through to disk before anything reads the file. See `saveAfterEdit`.
      const unsaved = await saveAfterEdit(uri);
      // What the edit did, from the editor rather than from the model's opinion of its own diff.
      const problems = await errorsAfterEdit(uri);
      return { content: `Edited ${relative(uri)}.${problems ? `\n${problems}` : ""}${unsaved}` };
    },
  };

  /**
   * The errors the editor reports for a file just edited, after waiting for it to catch up.
   *
   * A language server parses on change and debounces, so asking immediately gets the state from
   * before the edit. The wait is bounded and resolves early on the first diagnostics change for this
   * file: a long wait would make every edit feel slow, and no wait would make this report the past.
   *
   * Errors only — a warning is a style opinion, and an edit that printed warnings would be noise on
   * every turn. And nothing is returned when there are none: see `editProblems` for why silence is
   * the honest answer rather than "no problems found".
   */
  async function errorsAfterEdit(uri: vscode.Uri): Promise<string> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, 400);
      const sub = vscode.languages.onDidChangeDiagnostics((e) => {
        if (e.uris.some((u) => u.toString() === uri.toString())) finish();
      });
      function finish(): void {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      }
    });
    const errors = vscode.languages
      .getDiagnostics(uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
      .map((d) => ({ line: d.range.start.line + 1, message: d.message }));
    return editProblems(relative(uri), errors);
  }

  /**
   * Write an applied edit through to disk.
   *
   * ⚠️⚠️ A `WorkspaceEdit` lands in the editor's in-memory document, not in the file. Without this,
   * an approved edit leaves the buffer showing the new code while the file on disk still holds the
   * old — and the very next step of an agent turn reads the DISK: `run_command` running the tests, a
   * watcher rebuilding a stylesheet, a compiler, git. The agent then grades itself on code it did not
   * write, "fixes" what was never broken, and compounds. It is the quietest possible failure, because
   * the screen is right.
   *
   * Saving is correct rather than merely convenient here: `confirmEdit` showed the user this exact
   * content and they pressed Apply. Leaving it unwritten is not a second safety net, it is a
   * divergence between what the editor shows and what every other tool reads.
   *
   * Returns what to tell the model when the save did not happen, so a turn that proceeds on stale
   * bytes at least knows it is doing so.
   */
  async function saveAfterEdit(uri: vscode.Uri): Promise<string> {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (!doc?.isDirty) return "";
    if (await doc.save()) return "";
    return `\nWARNING: ${relative(uri)} was changed in the editor but could NOT be saved to disk. Commands you run will still read the old file.`;
  }

  const runCommand: Tool = {
    schema: {
      name: "run_command",
      description:
        "Run a shell command in the workspace terminal (tests, build, git) and return its output " +
        "and exit code. The user approves it first and watches it run. On a shell without VS Code " +
        "integration the output cannot be read, and the result says so.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          why: { type: "string" },
          timeoutMs: { type: "number", description: "Give up after this long. Default 120000, maximum 600000." },
        },
        required: ["command"],
      },
    },
    approval: (args) => t("run `{0}`", String(args["command"])),
    async run(args, ctx): Promise<ToolResult> {
      const command = String(args["command"] ?? "");
      const result = await runCommandInTerminal({
        command,
        // Not `root()`, which throws when no folder is open: a terminal does not need one. Someone
        // working on a single file still gets their shell, in whatever directory it opens in.
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        timeoutMs: args["timeoutMs"] === undefined ? undefined : Number(args["timeoutMs"]),
        signal: ctx.signal,
        report: (m) => ctx.report(m),
      });
      return {
        content: result.content,
        isError: result.isError,
        // The panel shows the exit code as a badge on the step. `captured: false` is what it reads
        // to say "started, not read" rather than claiming a result nobody has.
        display: { captured: result.captured, exitCode: result.exitCode },
      };
    },
  };

  // The integrations are offered only when there is something behind them. A model given
  // `ibmi_sql` on a machine with no partition does not conclude "no IBM i here"; it calls the tool,
  // reads the error, and calls it again — a turn spent proving something the tool list could have
  // said for free. Absence is the clearest way to say a system is not there.
  const integrations: Tool[] = [
    ...(gitAvailable() ? buildGitTools() : []),
    // The same gate as the menu: a model that is told it can read source members on a machine with
    // no partition will try, and spend a turn discovering what the settings already knew.
    ...(ibmiEnabled(readSettings().ibmi.integration) ? buildIbmiTools(readSettings().ibmi.writableLibraries) : []),
    ...(arcadInstalled() && deps.arcad ? buildArcadTools(deps.arcad) : []),
    // Same gate as the rest: a model told it can consult a knowledge base that is switched off
    // spends a call finding out. Off by default, because a base nobody asked for is a folder of
    // files appearing in somebody's repository.
    ...(readSettings().knowledge.enabled ? buildKnowledgeTools(() => deps.settings()) : []),
    ...(deps.mcp?.tools() ?? []),
  ];

  /**
   * The agent's to-do list.
   *
   * The only tool here that changes nothing — not a file, not the repository, not the outside world.
   * It exists so a turn that takes two minutes stops being a spinner: the panel shows what the model
   * is doing now and how much it thinks is left. It costs one cheap call per step, which is the
   * price of a progress bar that is honest rather than animated.
   *
   * Offered only when someone is watching. The terminal client and the sub-agents pass no `onPlan`,
   * and a tool whose output nothing displays is a tool that spends tokens for nothing.
   */
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
    // Never asked for. It writes nothing and reads nothing — approving a progress update would be
    // a dialog about a display, which is exactly the kind of prompt that teaches people to click
    // through prompts.
    approval: () => false,
    parallel: () => true,
    async run(args, ctx): Promise<ToolResult> {
      const { plan, error } = parsePlan(args["steps"]);
      if (!plan) return { content: error ?? "Invalid plan.", isError: true };
      deps.onPlan?.(plan);
      const { done, total } = planSummary(plan);
      ctx.report(t("plan: {0}/{1}", done, total));
      // Deliberately terse: this result is re-sent on every later step of the turn, and the model
      // already knows what it just wrote.
      return { content: `Plan updated (${done}/${total} done).` };
    },
  };

  /**
   * Something the model noticed and was not asked about.
   *
   * A tool rather than a convention about prose, for the reason the plan is a tool: a convention is
   * a request, and what comes back from a request has no shape. And it is RECORDED, not acted on —
   * the whole value is that the finding reaches the person without the diff growing something they
   * did not ask for.
   */
  const noteAside: Tool = {
    schema: NOTE_ASIDE_TOOL,
    // Nothing to approve: it changes nothing and reads nothing. A dialog here would be a dialog
    // about a sentence.
    approval: () => false,
    parallel: () => true,
    async run(args, ctx): Promise<ToolResult> {
      const what = String(args["what"] ?? "").trim();
      if (!what) return { content: "An aside needs something to say.", isError: true };
      const where = String(args["where"] ?? "").trim();
      deps.onNotice?.({ kind: "noticed", text: what, ...(where ? { where } : {}) });
      ctx.report(t("noted: {0}", what.slice(0, 60)));
      // Terse, and it says the thing the model has to hear: this was not a fix.
      return { content: "Noted for the user. Do not change it." };
    },
  };

  return withHooks([
    ...buildSymbolTools(),
    readFile,
    listFiles,
    searchText,
    diagnostics,
    writeFile,
    editFile,
    runCommand,
    ...(deps.onPlan ? [updatePlan] : []),
    ...(deps.onNotice ? [noteAside] : []),
    ...integrations,
  ], deps.hooks);
}
