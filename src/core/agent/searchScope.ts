// What a workspace search leaves out, for the panel's `search_text`.
//
// ⚠️ « il tourne en rond » — a request that took three hours, with "(no match)" a dozen times for
// class names that were in the code. The panel searched the first 800 files `findFiles` returned, in
// no particular order and with only `files.exclude` applied: in a project with node_modules, backups
// and a tmp folder, those 800 were mostly not the sources, the sources were never read, and the
// model was told nothing matched. The terminal client always skipped the same folders this skips;
// the panel now does too, plus what the project itself says it does not track.

/** Folders no search is about — the terminal client's list. */
export const SKIPPED_DIRS = [".git", "node_modules", "dist", "build", "out", "target", ".venv", "__pycache__", ".next"];

/**
 * The folders and files a root `.gitignore` names plainly — `tmp/`, `backups`, `*.log` — as globs.
 * Negations and paths with a slash in the middle are left alone: a search that reads one file too
 * many costs a line, one that skips the file the question is about costs the answer.
 */
export function gitignoreGlobs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const name = line.replace(/^\//, "").replace(/\/$/, "");
    if (!name || name.includes("/") || name.includes("**") || /[{},]/.test(name)) continue;
    out.push(`**/${name}`, `**/${name}/**`);
  }
  return out;
}

/**
 * Files that never hold a line of code — images, fonts, media, archives, databases. A project with
 * thousands of icons filled the files a search reads with them.
 */
export const BINARY_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff", "psd",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "webm", "ogg", "wav", "mov", "avi", "mkv",
  "zip", "gz", "tgz", "7z", "rar", "jar", "pdf",
  "db", "sqlite", "sqlite3", "db-wal", "db-shm", "wal",
  "exe", "dll", "so", "dylib", "bin", "wasm", "node", "map",
];

/** The globs a search leaves out: skipped folders, binaries, `.gitignore` and the user's settings. */
export function searchExcludeGlobs(gitignore: string, settingExcludes: Record<string, unknown>): string[] {
  const globs = new Set<string>(SKIPPED_DIRS.map((d) => `**/${d}/**`));
  for (const ext of BINARY_EXTENSIONS) globs.add(`**/*.${ext}`);
  for (const g of gitignoreGlobs(gitignore)) globs.add(g);
  for (const [g, on] of Object.entries(settingExcludes)) if (on === true && !/[{},]/.test(g)) globs.add(g);
  return [...globs];
}

/** The same, as one exclude glob for `findFiles`. */
export function searchExclude(gitignore: string, settingExcludes: Record<string, unknown>): string {
  return `{${searchExcludeGlobs(gitignore, settingExcludes).join(",")}}`;
}
