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

/**
 * Whether the rules about to be given to the model should be announced: the first time this file is
 * used in this folder, and again whenever its content changed since — a `git pull` that rewrites
 * `AGENTS.md` gives the model new orders, and that is what someone should see. `seen` is the
 * fingerprint stored the last time, per file; the caller stores `fingerprint` back.
 *
 * ⚠️ « une ligne visible du genre "Règles du projet lues depuis AGENTS.md" ». The rules go into the system
 * prompt unfenced — that is their job — so a rule that arrived with a cloned repository speaks with the
 * repository's authority. VS Code's workspace trust is what gates it; this is what makes it visible.
 */
export function rulesAnnouncement(path: string, text: string, seen: Readonly<Record<string, string>>): { kind: "new" | "changed" | undefined; fingerprint: string } {
  const fingerprint = fingerprintOf(text);
  const before = seen[path];
  return { kind: before === undefined ? "new" : before === fingerprint ? undefined : "changed", fingerprint };
}

/** A short, stable fingerprint of a text (FNV-1a, 32 bits) — enough to tell an edit, not a secret. */
function fingerprintOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

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
