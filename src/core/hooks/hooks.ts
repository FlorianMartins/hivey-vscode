// Commands the team wants run around a tool call.
//
// The request behind this is ordinary and the shape of it is not: "run our linter after the agent
// writes a file", "refuse any write to `generated/**`", "run our secret scanner before a commit".
// All three are a command somebody else wrote, run on this machine, on a trigger the agent pulls.
//
// So hooks are powerful in exactly the way an MCP stdio server is powerful, and they get the same
// treatment (`core/mcp/pinning.ts`): the consent names the COMMAND, and the approval is pinned to a
// fingerprint, so a hooks file that changes asks again. A hook that arrived with a `git clone` is a
// command written by whoever sent the repository, and approving "hooks" once in general would be
// approving every command anybody puts in that file afterwards.
//
// Two shapes, and the difference matters:
//
//   BEFORE a tool, a non-zero exit REFUSES the call. That is a veto: the tool does not run, and the
//   model is told why in words it can act on.
//   AFTER a tool, a non-zero exit is a FAILURE REPORTED TO THE MODEL, and it counts as a
//   verification for `verifyTurn` — the same standing as a failing test, because that is what it is:
//   the team's own check saying the change is not acceptable.

import { createHash } from "node:crypto";

export type HookWhen = "before" | "after";

export interface Hook {
  when: HookWhen;
  /** Tool names this applies to. `*` is every tool. */
  tools: string[];
  /** Workspace-relative globs. Absent means every path, and no path at all still matches. */
  paths?: string[];
  /** The command, run in the workspace root. */
  command: string;
  timeoutMs: number;
  /** Free text for the consent dialog and the step list. */
  name: string;
}

export interface HookParse {
  hooks: Hook[];
  /** Everything wrong with the file, in the words its author needs to fix it. */
  problems: string[];
}

export const DEFAULT_TIMEOUT_MS = 60_000;
/** Beyond this a hook is not a check, it is a build. The agent's turn cannot wait on one. */
export const MAX_TIMEOUT_MS = 300_000;

/**
 * Read a hooks file.
 *
 * Tolerant about shape and strict about meaning: a missing `command` is a problem reported by name,
 * not a hook that silently does nothing. The same choice as the skills and knowledge parsers — a
 * file somebody wrote by hand deserves to be told what is wrong with it.
 */
export function parseHooks(text: string, origin = "hooks.json"): HookParse {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { hooks: [], problems: [`${origin}: not readable JSON — ${(err as Error).message}`] };
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { hooks?: unknown })?.hooks;
  if (!Array.isArray(list)) {
    return { hooks: [], problems: [`${origin}: expected an array of hooks, or an object with a "hooks" array.`] };
  }

  const hooks: Hook[] = [];
  for (const [i, raw] of list.entries()) {
    const at = `${origin}[${i}]`;
    const entry = (raw ?? {}) as Record<string, unknown>;
    const command = typeof entry["command"] === "string" ? entry["command"].trim() : "";
    if (!command) {
      problems.push(`${at}: no "command". A hook with nothing to run is not a hook.`);
      continue;
    }
    const when = entry["when"] === "before" ? "before" : entry["when"] === "after" ? "after" : undefined;
    if (!when) {
      problems.push(`${at}: "when" must be "before" or "after" — a hook that does not say when it runs cannot be run.`);
      continue;
    }
    const tools = asList(entry["tool"] ?? entry["tools"]);
    if (!tools.length) {
      problems.push(`${at}: no "tool". Name the tools this applies to, or "*" for all of them.`);
      continue;
    }
    const paths = asList(entry["path"] ?? entry["paths"]);
    const requested = Number(entry["timeoutMs"]);
    const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    if (Number.isFinite(requested) && requested > MAX_TIMEOUT_MS) {
      problems.push(`${at}: a timeout of ${requested} ms is longer than a turn can wait; capped at ${MAX_TIMEOUT_MS} ms.`);
    }
    hooks.push({
      when,
      tools,
      ...(paths.length ? { paths } : {}),
      command,
      timeoutMs,
      name: typeof entry["name"] === "string" && entry["name"].trim() ? entry["name"].trim() : command,
    });
  }
  return { hooks, problems };
}

function asList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).map((x) => x.trim());
  return [];
}

/**
 * The hooks that apply to this call.
 *
 * A hook with `paths` and a call with no path does NOT match: `after write_file on src/**` is about
 * a file, and running it when the agent ran a command instead would be running it on the wrong
 * event. A hook without `paths` matches whatever the tool was.
 */
export function matchingHooks(
  hooks: Hook[],
  call: { when: HookWhen; tool: string; path?: string },
  matchGlob: (path: string, glob: string) => boolean,
): Hook[] {
  return hooks.filter((hook) => {
    if (hook.when !== call.when) return false;
    if (!hook.tools.includes("*") && !hook.tools.includes(call.tool)) return false;
    if (!hook.paths?.length) return true;
    if (!call.path) return false;
    return hook.paths.some((glob) => matchGlob(call.path!, glob));
  });
}

/**
 * One value standing for every hook the workspace declares.
 *
 * Over the fields that decide what RUNS — the command, when, on what — and not over the name, which
 * is a label. A changed command asks again; a renamed hook does not, because asking about a label
 * is how people learn to click yes.
 */
export function hooksFingerprint(hooks: Hook[]): string {
  const significant = hooks
    .map((h) => ({ when: h.when, tools: [...h.tools].sort(), paths: [...(h.paths ?? [])].sort(), command: h.command }))
    .sort((a, b) => `${a.when}${a.command}`.localeCompare(`${b.when}${b.command}`));
  return createHash("sha256").update(JSON.stringify(significant), "utf8").digest("hex");
}

/** What the consent dialog says. It names every command, because that is what is being approved. */
export function describeHooks(hooks: Hook[]): string {
  if (!hooks.length) return "No hooks.";
  const lines = hooks.map((h) => `  ${h.when} ${h.tools.join(", ")}${h.paths ? ` on ${h.paths.join(", ")}` : ""}: ${h.command}`);
  return [
    `This workspace wants to run ${hooks.length} command(s) on your machine around the agent's tool calls:`,
    ...lines,
    "",
    "These came with the repository. Approve them only if you know where it came from.",
  ].join("\n");
}

export interface HookRun {
  hook: Hook;
  code: number;
  output: string;
  timedOut: boolean;
}

/**
 * What the model is told, and whether the call may proceed.
 *
 * The output is handed over on failure, truncated, because a linter's complaint IS the instruction:
 * "the hook failed" with no output is a dead end the model answers by guessing.
 */
export function hookVerdict(run: HookRun): { allow: boolean; message: string } {
  const tail = run.output.trim().slice(-2000);
  if (run.timedOut) {
    return {
      // A hook that did not finish has not said no. Refusing on a timeout would make a slow linter a
      // broken agent; reporting it lets the user see the hook needs attention.
      allow: run.hook.when === "after",
      message:
        `The ${run.hook.when} hook “${run.hook.name}” did not finish within ${run.hook.timeoutMs} ms, so its verdict is unknown.` +
        (run.hook.when === "before" ? " The call was not made." : ""),
    };
  }
  if (run.code === 0) return { allow: true, message: "" };
  if (run.hook.when === "before") {
    return {
      allow: false,
      message:
        `Refused by the ${run.hook.name} hook (exit ${run.code}). This workspace runs it before ${run.hook.tools.join(", ")} ` +
        `and it said no. What it printed:\n${tail || "(nothing)"}`,
    };
  }
  return {
    allow: true,
    message:
      `The ${run.hook.name} hook failed after the call (exit ${run.code}). This is the team's own check saying the change ` +
      `is not acceptable yet, so treat it as a failing test. What it printed:\n${tail || "(nothing)"}`,
  };
}
