// The workspace search, with ripgrep — the engine Claude Code's own search runs on, and the one VS Code
// ships with for its search view, so there is nothing to install.
//
// ⚠️ « je veux que l'extension travaille comme Claude Code et prenne toutes les optimisations ». The
// panel's search read files one by one in JavaScript, at most 4 000 of them: on a large project the
// sources could be past the limit, and every search cost seconds. ripgrep reads them all, respects
// .gitignore, skips binaries, and answers in a fraction of a second.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where VS Code keeps its ripgrep. The place moved between versions: `@vscode/ripgrep-universal/bin/
 * <platform>-<arch>/` in recent ones, `@vscode/ripgrep/bin/` before — both are tried, newest first.
 */
export function findRipgrep(appRoot: string, platform: string = process.platform, arch: string = process.arch, exists: (p: string) => boolean = existsSync): string | undefined {
  const exe = platform === "win32" ? "rg.exe" : "rg";
  const candidates = [
    join(appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep-universal", "bin", `${platform}-${arch}`, exe),
    join(appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep", "bin", exe),
    join(appRoot, "node_modules", "@vscode", "ripgrep", "bin", exe),
  ];
  return candidates.find((p) => exists(p));
}

export interface RipgrepSearch {
  rg: string;
  cwd: string;
  pattern: string;
  /** Search the text as written, not as a regular expression. */
  literal: boolean;
  /** Only files matching this glob, relative to `cwd`. */
  glob?: string;
  /** Globs never searched, on top of what .gitignore already leaves out. */
  exclude: string[];
  maxMatches: number;
  maxFileBytes: number;
  signal?: AbortSignal;
}

/**
 * The files matching a glob, the most recently changed first — as Claude Code's Glob lists them: the
 * file someone is working on is the one the question is most likely about. .gitignore respected.
 * Undefined when ripgrep cannot run; `capped` when there were more than `limit`.
 */
export function ripgrepFiles(s: { rg: string; cwd: string; glob: string; exclude: string[]; limit: number }): Promise<{ files: string[]; capped: boolean } | undefined> {
  return new Promise((resolve) => {
    // .gitignore applies in a project that is not a repository too.
    const args = ["--files", "--sortr", "modified", "--color", "never", "--no-require-git"];
    if (s.glob && s.glob !== "**/*") args.push("--glob", s.glob);
    for (const g of s.exclude) args.push("--glob", `!${g}`);
    let child;
    try {
      child = spawn(s.rg, args, { cwd: s.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      resolve(undefined);
      return;
    }
    let all = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      all += chunk;
    });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) return resolve(undefined);
      const files = all
        .split("\n")
        .map((l) => l.replace(/\r$/, "").replace(/^\.[\\/]/, "").replace(/\\/g, "/"))
        .filter(Boolean);
      resolve({ files: files.slice(0, s.limit), capped: files.length > s.limit });
    });
  });
}

/** The arguments ripgrep is run with — in path order, so the same search reads the same files. */
export function ripgrepArgs(s: Omit<RipgrepSearch, "rg" | "cwd" | "signal" | "maxMatches">): string[] {
  const args = [
    "--line-number",
    "--no-heading",
    "--with-filename",
    "--color",
    "never",
    "--max-columns",
    "300",
    "--max-columns-preview",
    "--max-filesize",
    String(s.maxFileBytes),
    // .gitignore applies in a project that is not a repository too.
    "--no-require-git",
    "--sort",
    "path",
    s.literal ? "--fixed-strings" : "--pcre2",
  ];
  if (s.glob && s.glob !== "**/*") args.push("--glob", s.glob);
  for (const g of s.exclude) args.push("--glob", `!${g}`);
  args.push("--regexp", s.pattern, "--", ".");
  return args;
}

/**
 * Run it. `matches` are `path:line: text`, as the panel's search always wrote them; `capped` when the
 * search stopped at `maxMatches`. Undefined when ripgrep could not run or refused the pattern — the
 * caller then searches the old way, so a search never fails for want of ripgrep.
 */
export function ripgrep(s: RipgrepSearch): Promise<{ matches: string[]; capped: boolean } | undefined> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(s.rg, ripgrepArgs(s), { cwd: s.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      resolve(undefined);
      return;
    }
    const matches: string[] = [];
    let rest = "";
    let capped = false;
    const onAbort = (): void => {
      child.kill();
    };
    s.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (capped) return;
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^(?:\.[\\/])?(.+?):(\d+):(.*)$/.exec(line.replace(/\r$/, ""));
        if (!m) continue;
        matches.push(`${m[1]!.replace(/\\/g, "/")}:${m[2]}: ${m[3]!.trim().slice(0, 200)}`);
        if (matches.length >= s.maxMatches) {
          capped = true;
          child.kill();
          break;
        }
      }
    });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      s.signal?.removeEventListener("abort", onAbort);
      // 0: found, 1: nothing found — both answers. 2 is ripgrep's own error (a pattern it refuses).
      if (capped || code === 0 || code === 1) resolve({ matches, capped });
      else resolve(undefined);
    });
  });
}
