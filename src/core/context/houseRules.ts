// Which of a repository's rules files is read — see extension/instructions.ts.

/**
 * In order of preference. The first that exists and says something wins; they are not concatenated.
 *
 * `AGENTS.md` and `CLAUDE.md` at the root are what most repositories write today for every coding
 * agent and for Claude Code: a project that had one was not read at all. Hivey's own file still comes
 * first — written for this extension, it says the more precise thing.
 */
export const RULES_FILES: ReadonlyArray<readonly string[]> = [
  [".hiveycode", "instructions.md"],
  ["AGENTS.md"],
  ["CLAUDE.md"],
  [".github", "copilot-instructions.md"],
  [".github", "instructions.md"],
];

/** The first rules file `read` finds with something in it, as its path and its text. */
export async function firstRulesFile(read: (parts: readonly string[]) => Promise<string | undefined>): Promise<{ path: string; text: string } | undefined> {
  for (const parts of RULES_FILES) {
    let raw: string | undefined;
    try {
      raw = (await read(parts))?.trim();
    } catch {
      raw = undefined;
    }
    if (raw) return { path: parts.join("/"), text: raw };
  }
  return undefined;
}
