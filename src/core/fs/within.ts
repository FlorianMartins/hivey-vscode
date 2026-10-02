// Where a path the model named actually is, and whether that is somewhere it may write.
//
// The rule being replaced was one line and read as prudence: refuse anything starting with `/`,
// refuse anything containing `..`. It confused two different facts. `..` really can climb out of
// the workspace — but an ABSOLUTE path is not a path outside anything: `/home/me/proj/src/a.ts`
// and `src/a.ts` are the same file when the folder open is `/home/me/proj`, and the first is the
// spelling the editor itself shows in a diagnostic, in a terminal, in a stack trace and in the
// title bar. A model that has just read one and names it back was told its own correct answer
// "leaves the workspace", and the user watched agent mode describe changes instead of making them.
//
// So the question is answered by resolving the path and then looking at where it landed, which is
// the only form of the question that has a true answer. It lives here, away from `vscode`, because
// a rule about containment is exactly the kind of rule that is wrong at the edges — a trailing
// slash, a drive letter, a sibling folder whose name starts with the root's — and the edges are
// what a unit test can reach and a running editor cannot.

/** A path that fell inside a root, and where under it. */
export interface Placement {
  /** The root it fell inside, exactly as it was given. */
  root: string;
  /** The part under that root, `/`-separated. Empty when the path IS the root. */
  relative: string;
}

/**
 * One spelling, so that two paths can be compared at all.
 *
 * Backslashes to slashes, `/c:/x` to `c:/x` — a URI spells a Windows path with a leading slash and
 * a plain one does not — and runs of slashes collapsed, except a leading pair, which is a UNC share
 * and not a typo.
 */
export function tidyPath(path: string): string {
  const slashes = (path ?? "").replace(/\\/g, "/");
  const unc = slashes.startsWith("//");
  const body = slashes.replace(/\/{2,}/g, "/").replace(/^\/([A-Za-z]:)/, "$1");
  return unc ? `/${body}` : body;
}

/** Does this name a place on its own, rather than one relative to somewhere else? */
export function isAbsolutePath(path: string): boolean {
  const tidy = tidyPath(path);
  return tidy.startsWith("/") || /^[A-Za-z]:(?:\/|$)/.test(tidy);
}

/**
 * `.` and `..` resolved without touching the disk — the file may not exist yet.
 *
 * `undefined` when it climbs above where it started, which for a relative path is the one case
 * that genuinely leaves the workspace and the reason the old rule existed.
 */
export function collapsePath(path: string): string | undefined {
  const tidy = tidyPath(path);
  const absolute = isAbsolutePath(tidy);
  const lead = tidy.startsWith("//") ? "//" : tidy.startsWith("/") ? "/" : "";
  const parts: string[] = [];
  for (const part of tidy.slice(lead.length).split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") {
      parts.push(part);
      continue;
    }
    // A drive or a root absorbs `..`, the way every filesystem does: `/..` is `/`.
    if (parts.length && parts[parts.length - 1] !== "..") {
      parts.pop();
    } else if (absolute) {
      continue;
    } else {
      return undefined;
    }
  }
  return `${lead}${parts.join("/")}`;
}

/**
 * Which root an absolute path falls inside, and where under it.
 *
 * `fold` compares without case, for the filesystems that do. Longest root first, so a folder
 * nested inside another is reported as itself rather than as part of its parent — and the
 * comparison is segment by segment, because `/srv/app` does not contain `/srv/application`.
 */
export function underRoot(absolute: string, roots: string[], fold = false): Placement | undefined {
  const target = collapsePath(absolute);
  if (target === undefined) return undefined;
  const same = (a: string) => (fold ? a.toLowerCase() : a);
  const ordered = [...roots].sort((a, b) => tidyPath(b).length - tidyPath(a).length);
  for (const root of ordered) {
    const base = (collapsePath(root) ?? "").replace(/\/$/, "");
    if (!base) continue;
    if (same(target) === same(base)) return { root, relative: "" };
    if (same(target).startsWith(`${same(base)}/`)) return { root, relative: target.slice(base.length + 1) };
  }
  return undefined;
}
