// Loading the skills and sub-agents the user wrote, and offering them to the model.
//
// Everything here reads from `.hiveycode/` — in the workspace, where a team's definitions are
// committed alongside the code they are about, and in the home directory, where a person's own
// follow them into every project. Nothing is generated, nothing is cached across sessions, and a
// file the user edits takes effect on the next turn — a definition you have to reload the window
// to try is a definition nobody iterates on.
//
// Two decisions worth defending:
//
//   • A BROKEN FILE IS REPORTED, NOT SKIPPED. A skill with a typo in its header silently vanishing
//     is the worst outcome: the user sees the assistant ignore instructions it never received, and
//     has no way to find out why. Problems are collected and shown.
//   • THE MAIN LOOP KEEPS THE APPROVALS. A sub-agent runs with the same approver as its parent, so
//     a tool that would ask before writing still asks — being called by a sub-agent is not a way
//     around a dialog. What the sub-agent gets is a narrower tool set and its own prompt, never
//     more authority.

import * as vscode from "vscode";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { t } from "../shared/i18n.js";
import type { Tool, ToolResult } from "../core/agent/loop.js";
import {
  agentTemplate,
  BUILTIN_AGENTS,
  parseDefinition,
  skillTemplate,
  toolsForAgent,
  type AgentDefinition,
  type Skill,
} from "../core/agent/definitions.js";

const DIR = ".hiveycode";
const MAX_FILES = 100;

/**
 * Where a definition lives when it is not a repository's.
 *
 * Skills were repository-only, which is right for a team's — they travel with the code that needs
 * them — and wrong as the only possibility: it made "write a skill" impossible in a window with no
 * folder open, and it meant a habit of your own had to be committed to somebody's project before
 * you could use it. `~/.hiveycode/skills/` is the same layout, one level up, and yours.
 *
 * A repository's own definition wins over a personal one of the same name, for the reason the
 * built-ins lose to both: the more specific answer to "what does this project need" is the project's.
 */
function personalRoot(): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(homedir()), DIR);
}

/**
 * The file a definition came from.
 *
 * A repository's `source` is relative to the repository; a personal one is an absolute path,
 * because there is nothing for it to be relative to. Everything that opens a definition goes
 * through here, so the distinction is made once.
 */
export function definitionUri(source: string): vscode.Uri | undefined {
  if (isAbsolute(source)) return vscode.Uri.file(source);
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? vscode.Uri.joinPath(folder.uri, source) : undefined;
}

export interface Definitions {
  skills: Skill[];
  agents: AgentDefinition[];
  /** One line per malformed file, in the words its author needs. */
  problems: string[];
}

const EMPTY: Definitions = { skills: [], agents: [], problems: [] };

export class DefinitionStore {
  private cache: Definitions | undefined;

  constructor(disposables: vscode.Disposable[]) {
    const clear = () => {
      this.cache = undefined;
    };
    for (const pattern of [
      `**/${DIR}/{skills,agents}/*.md` as const,
      // The personal folder is outside every workspace, so it needs a watcher rooted at itself:
      // a `**/` pattern only ever sees what the editor has opened.
      new vscode.RelativePattern(personalRoot(), "{skills,agents}/*.md"),
    ]) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(clear);
      watcher.onDidCreate(clear);
      watcher.onDidDelete(clear);
      disposables.push(watcher);
    }
  }

  /** Everything currently defined. Re-read after any change to the files. */
  async load(): Promise<Definitions> {
    if (this.cache) return this.cache;
    const folder = vscode.workspace.workspaceFolders?.[0];

    const skills: Skill[] = [];
    const agents: AgentDefinition[] = [];
    const problems: string[] = [];

    // Personal first, the repository second: `dedupe` keeps the first of a name, so the project's
    // own definition is the one that must arrive last to win. A window with no folder open reads
    // the personal ones and nothing else, which is the whole point of their existing.
    const roots: Array<{ base: vscode.Uri; relative: boolean }> = [{ base: personalRoot(), relative: false }];
    if (folder) roots.push({ base: vscode.Uri.joinPath(folder.uri, DIR), relative: true });

    for (const { base, relative } of roots) {
      for (const kind of ["skill", "agent"] as const) {
        const leaf = kind === "skill" ? "skills" : "agents";
        const dir = vscode.Uri.joinPath(base, leaf);
        let entries: [string, vscode.FileType][];
        try {
          entries = await vscode.workspace.fs.readDirectory(dir);
        } catch {
          continue; // No such directory: this workspace, or this user, simply has none.
        }
        for (const [name, type] of entries.slice(0, MAX_FILES)) {
          if (type !== vscode.FileType.File || !name.endsWith(".md")) continue;
          const uri = vscode.Uri.joinPath(dir, name);
          // A repository's definition is named by its path within the repository; a personal one by
          // its absolute path, because there is nothing to be relative to. Whoever opens it tells
          // the two apart with `isAbsolute`.
          const source = relative ? `${DIR}/${leaf}/${name}` : uri.fsPath;
          try {
            const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
            const { definition, problems: found } = parseDefinition(kind, source, text);
            problems.push(...found);
            if (definition?.kind === "skill") skills.push(definition);
            else if (definition?.kind === "agent") agents.push(definition);
          } catch (error) {
            problems.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    // Two files claiming the same name is a real collision — one of them would never be reachable.
    dedupe(skills, problems);
    dedupe(agents, problems);

    // The built-ins, minus anything this repository defines under the same name: a team that has

    // written its own `reviewer` means theirs, and a shipped agent quietly replacing it would be the

    // worst outcome available.

    const own = new Set(agents.map((a) => a.name));

    const merged = [...agents, ...BUILTIN_AGENTS.filter((a) => !own.has(a.name))];

    return (this.cache = { skills, agents: merged, problems });
  }

  invalidate(): void {
    this.cache = undefined;
  }
}

function dedupe(list: Array<{ name: string; source: string }>, problems: string[]): void {
  const seen = new Map<string, string>();
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i]!;
    const first = seen.get(entry.name);
    if (first) {
      problems.push(`${entry.source}: "${entry.name}" is already defined in ${first}. One of them will never run.`);
      list.splice(i, 1);
    } else {
      seen.set(entry.name, entry.source);
    }
  }
}

export interface SubAgentRun {
  definition: AgentDefinition;
  task: string;
  signal?: AbortSignal;
  report: (message: string) => void;
}

export interface DefinitionDeps {
  store: DefinitionStore;
  /** Runs a nested turn. Provided by the chat view, which owns the provider and the approver. */
  runSubAgent: (run: SubAgentRun) => Promise<string>;
  /** The tools the CURRENT mode offers. A sub-agent's list is intersected with this, never added. */
  availableTools: () => string[];
}

export function buildDefinitionTools(deps: DefinitionDeps, definitions: Definitions): Tool[] {
  const out: Tool[] = [];

  if (definitions.skills.length) {
    const names = definitions.skills.map((s) => s.name);
    out.push({
      schema: {
        name: "use_skill",
        description:
          `Read the instructions of a skill this repository defines, then follow them. Available: ${definitions.skills
            .map((s) => `${s.name} (${s.description})`)
            .join("; ")}`,
        parameters: {
          type: "object",
          properties: { name: { type: "string", enum: names, description: "The skill's name." } },
          required: ["name"],
        },
      },
      // Reading instructions the user wrote, from a file in their own repository. There is nothing
      // here to approve that opening the file would not also do.
      approval: () => false,
      async run(args, ctx): Promise<ToolResult> {
        const wanted = String(args["name"] ?? "");
        const skill = definitions.skills.find((s) => s.name === wanted);
        if (!skill) {
          return { content: `No skill named "${wanted}". Available: ${names.join(", ")}.`, isError: true };
        }
        ctx.report(t("skill: {0}", skill.name));
        return { content: `# ${skill.name}\n\n${skill.body}` };
      },
      restrict() {
        return this as Tool;
      },
    });
  }

  if (definitions.agents.length) {
    const names = definitions.agents.map((a) => a.name);
    // Which agents can be dispatched several at a time.
    //
    // One that can only read cannot interfere with another: three of them reading three parts of a
    // repository at once is the whole reason to have them. One that can write can, and two agents
    // editing files concurrently is a race nobody can reconstruct from a transcript afterwards.
    const READ_ONLY_TOOLS = new Set([
      "read_file",
      "list_files",
      "search_text",
      "get_diagnostics",
      "git_status",
      "git_diff",
      "git_log",
      "git_branches",
      "git_blame",
      "git_show",
      "ibmi_member",
      "ibmi_members",
      "ibmi_objects",
      "ibmi_library_list",
      "ibmi_sql",
    ]);
    const readOnly = (name: string): boolean => {
      const agent = definitions.agents.find((a) => a.name === name);
      // An empty tool list means "whatever the mode allows", which in agent mode includes writing.
      // Absence of a restriction is not a restriction.
      if (!agent?.tools.length) return false;
      return agent.tools.every((tool) => READ_ONLY_TOOLS.has(tool));
    };

    out.push({
      parallel: (args) => readOnly(String(args["name"] ?? "")),
      schema: {
        name: "run_agent",
        description:
          `Hand a self-contained task to a sub-agent this repository defines. It works on its own and returns only its conclusion. Available: ${definitions.agents
            .map((a) => `${a.name} (${a.description})`)
            .join("; ")}`,
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", enum: names, description: "Which sub-agent." },
            task: { type: "string", description: "What it should do, in full — it sees nothing of this conversation." },
          },
          required: ["name", "task"],
        },
      },
      // Not asked for here. Whatever the sub-agent does goes through the same approver as anything
      // else, so a dialog still appears at the moment something is actually changed — which is the
      // moment the user can judge it.
      approval: () => false,
      async run(args, ctx): Promise<ToolResult> {
        const wanted = String(args["name"] ?? "");
        const definition = definitions.agents.find((a) => a.name === wanted);
        if (!definition) {
          return { content: `No agent named "${wanted}". Available: ${names.join(", ")}.`, isError: true };
        }
        const task = String(args["task"] ?? "").trim();
        if (!task) return { content: "A sub-agent needs a task. It cannot see this conversation.", isError: true };

        const allowed = toolsForAgent(definition, deps.availableTools());
        ctx.report(t("agent {0}: {1}", definition.name, task.slice(0, 60)));
        const answer = await deps.runSubAgent({
          definition: { ...definition, tools: allowed },
          task,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          report: ctx.report,
        });
        return { content: answer || t("The sub-agent returned nothing.") };
      },
      restrict() {
        // A sub-agent in plan mode is intersected down to reading tools by `toolsForAgent`, so it
        // is exactly as restricted as the mode it runs in. Nothing further to remove.
        return this as Tool;
      },
    });
  }

  return out;
}

// ── Creating one ───────────────────────────────────────────────────────────────────────────────

/**
 * Write a starting file and open it.
 *
 * The template is a valid definition rather than a form of blanks: a template that does not parse
 * is a trap, because the user edits it, it fails, and the failure looks like their edit.
 */
export async function createDefinition(kind: "skill" | "agent"): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];

  // Where it goes, asked only when there is a choice.
  //
  // "Open a folder first" was the answer to every attempt in a window without one, which made the
  // whole feature unreachable there — and even with a folder open it forced a habit of your own
  // into somebody's repository before you could use it. With a folder there are two honest
  // answers and the question is one keystroke; without one, there is nothing to ask.
  let base = personalRoot();
  if (folder) {
    const here = t("This repository");
    const mine = t("Everywhere");
    const where = await vscode.window.showQuickPick(
      [
        { label: "$(repo) " + here, detail: t("In .hiveycode/ — committed, and your team gets it too"), id: here },
        { label: "$(account) " + mine, detail: t("In ~/.hiveycode/ — yours, in every project you open"), id: mine },
      ],
      { placeHolder: kind === "skill" ? t("Where does this skill live?") : t("Where does this sub-agent live?") },
    );
    if (!where) return;
    if (where.id === here) base = vscode.Uri.joinPath(folder.uri, DIR);
  }

  const name = await vscode.window.showInputBox({
    prompt: kind === "skill" ? t("Name of the skill — what you will type after the slash") : t("Name of the sub-agent"),
    placeHolder: kind === "skill" ? "review-rpg" : "db-explorer",
    validateInput: (value) =>
      /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(value.trim())
        ? undefined
        : t("Lowercase letters, digits and hyphens, 2 to 40 characters."),
  });
  if (!name) return;

  const dir = vscode.Uri.joinPath(base, kind === "skill" ? "skills" : "agents");
  const uri = vscode.Uri.joinPath(dir, `${name.trim()}.md`);
  try {
    await vscode.workspace.fs.stat(uri);
    // Opening what exists beats overwriting it, and beats an error: the user asked for this name
    // because they are thinking about this name.
    void vscode.window.showInformationMessage(t("“{0}” already exists — opening it.", name));
  } catch {
    await vscode.workspace.fs.createDirectory(dir);
    const body = kind === "skill" ? skillTemplate(name.trim()) : agentTemplate(name.trim());
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}
