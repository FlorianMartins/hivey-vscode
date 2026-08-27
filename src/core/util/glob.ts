// A small glob matcher, shared by the editor extension and the terminal client.
//
// It exists in core rather than in the extension because the rule it implements — "these paths
// never reach a remote provider" — must be identical in both, and because importing the editor's
// module into the CLI would drag the whole `vscode` API into a process that has no editor.
//
// It is built by walking the pattern once, and that is not a stylistic preference. The previous
// version was a chain of `.replace()` calls, each rewriting the output of the last:
//
//     .replace(/\*\*\//g, "(?:.*/)?")   // emits `?` and `*`
//     .replace(/\*/g,     "[^/]*")      // …then rewrites the `*` it just emitted
//     .replace(/\?/g,     "[^/]")       // …then rewrites the `?` it just emitted
//
// Which turned `**/.env*` into `^([^/]:.[^/]*/)[^/]\.env[^/]*$` — a pattern that matches nothing at
// all. Every default in `privacy.blockedGlobs` starts with `**/`, so the block list that is this
// extension's central promise silently blocked nothing, and there was no test on this file to say
// so. A replacement chain cannot be safe when the replacement text is in the same alphabet as the
// input; a single pass has nothing to trip over.

/** Regex metacharacters that must survive as themselves. `*` and `?` are handled by the walker. */
const SPECIAL = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "/"]);

function compile(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;

    if (c === "*") {
      const doubled = glob[i + 1] === "*";
      if (doubled) {
        i++;
        // `**/` means "any number of directories, including none", so `**/x` matches `x` as well
        // as `a/b/x`. Consuming the slash here is what makes the "including none" case work.
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:[^/]*\\/)*";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }

    if (c === "?") {
      out += "[^/]";
      continue;
    }

    out += SPECIAL.has(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}

/** Compiling is cheap but not free, and the same handful of globs are tested on every path. */
const cache = new Map<string, RegExp>();

/** `**` crosses directories, `*` stops at one, `?` is a single character. */
export function matchGlob(path: string, glob: string): boolean {
  let rx = cache.get(glob);
  if (!rx) {
    rx = compile(glob);
    // Bounded: the globs come from settings, but a workspace file could in principle drive this.
    if (cache.size > 500) cache.clear();
    cache.set(glob, rx);
  }
  // Windows paths and a leading `./` are the same path as far as a rule about it is concerned.
  return rx.test(path.replace(/\\/g, "/").replace(/^\.\//, ""));
}

/** The operator's "never send this" list, applied to one path. */
export function isBlockedPath(path: string, globs: string[]): boolean {
  return globs.some((g) => matchGlob(path, g));
}
