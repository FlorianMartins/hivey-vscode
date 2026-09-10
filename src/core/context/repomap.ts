// The repository map: the cheapest useful answer to "what is in this codebase?".
//
// A hosted assistant can afford to embed a whole repository and search it on every turn. Doing
// that here would mean either shipping an embedding pipeline that runs on the user's laptop for
// every file (slow, and wrong the moment they switch branches) or sending the code to a remote
// embedding API (the exact thing this extension exists to avoid).
//
// So the default context is a MAP, not the territory: every file's path plus its top-level
// symbols, ranked so the ones that matter to the file being edited come first, and cut to a token
// budget. A few thousand tokens describe a repository a hundred times their size, they compress
// well, they sit in the cacheable prefix of the prompt (so they are billed once per conversation
// rather than once per turn on providers with a prompt cache), and they let the model ask for the
// two files it actually needs instead of being handed forty.

import { estimateTokens } from "../util/tokens.js";
import { extractImports, extractSymbols, type Sym } from "./symbols.js";

export interface MapFile {
  path: string;
  text: string;
}

export interface RankHints {
  /** The file being edited. Its neighbours and its imports outrank everything else. */
  focusPath?: string;
  /** Files open in the editor: the user already said these matter. */
  openPaths?: string[];
  /** Recently edited paths, newest first. */
  recentPaths?: string[];
  /**
   * What the user actually asked.
   *
   * The strongest signal there is, and it was not being used. Someone who writes "the invoice total
   * is wrong" has named the file they want; the ranking was answering with whatever happened to be
   * in the front tab. Matched against paths and against the symbols each file declares, so
   * "totalCents" finds the file that defines it even when the path says nothing.
   */
  question?: string;
}

export interface RepoMapEntry {
  path: string;
  symbols: Sym[];
  score: number;
}

const NOISE =
  /(?:^|\/)(?:node_modules|\.git|dist|build|out|target|vendor|coverage|__pycache__|\.venv|venv|\.next|\.nuxt|\.cache|bin|obj)(?:\/|$)/;
const BINARYISH = /\.(?:png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tar|jar|so|dylib|dll|exe|bin|lock|min\.js|map)$/i;

export function isMappable(path: string): boolean {
  return !NOISE.test(path) && !BINARYISH.test(path);
}

/** A file's importance, before any relation to the current one is considered. */
function baseScore(path: string): number {
  let s = 0;
  const name = path.split("/").pop() ?? path;
  if (/^(?:index|main|app|mod|lib)\.[a-z]+$/i.test(name)) s += 3;
  if (/^(?:README|ARCHITECTURE|CONTRIBUTING)/i.test(name)) s += 3;
  if (/(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|composer\.json)$/.test(name)) s += 4;
  if (/(?:\.test\.|\.spec\.|_test\.|^test_)/.test(name)) s -= 2; // tests describe behaviour, but there are many
  if (/\.d\.ts$/.test(name)) s -= 3;
  s -= Math.min(3, path.split("/").length - 1) * 0.3; // shallow files are usually the entry points
  return s;
}

/**
 * The words in a question that could name something in the repository.
 *
 * Identifiers, paths, and CamelCase or snake_case names — never ordinary prose, or every file
 * containing the word "total" outranks the one that defines it. Two characters is the floor: "id"
 * and "db" are real, "a" and "is" are noise.
 */
function termsIn(question: string): string[] {
  const words = question.match(/[A-Za-z_$][\w$]*(?:[./-][\w$]+)*/g) ?? [];
  const seen = new Set<string>();
  for (const word of words) {
    if (word.length < 3) continue;
    if (STOPWORDS.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    // A dotted or slashed name also contributes its parts: `src/totals.ts` should match `totals`.
    for (const part of word.split(/[./-]/)) if (part.length >= 3) seen.add(part.toLowerCase());
  }
  return [...seen];
}

/** Words that appear in every question about code and name nothing in particular. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "when", "why", "how", "what", "where",
  "add", "fix", "make", "use", "does", "not", "can", "should", "would", "file", "files", "code",
  "function", "class", "method", "test", "tests", "error", "bug", "please", "there", "then", "them",
  "you", "your", "its", "are", "was", "were", "has", "have", "but", "all", "any", "some", "more",
]);

export function rankFiles(files: MapFile[], hints: RankHints = {}): RepoMapEntry[] {
  const focus = hints.focusPath;
  const focusFile = focus ? files.find((f) => f.path === focus) : undefined;
  const focusImports = focusFile ? extractImports(focusFile.path, focusFile.text) : [];
  const focusDir = focus ? focus.slice(0, focus.lastIndexOf("/") + 1) : "";
  const open = new Set(hints.openPaths ?? []);
  const recent = hints.recentPaths ?? [];
  const terms = hints.question ? termsIn(hints.question) : [];

  const mappable = files.filter((f) => isMappable(f.path));

  // The import graph, built once. It used to be re-derived per file inside the scoring loop, which
  // is quadratic in a way nobody notices until a repository has three thousand files in it — and it
  // could only ever see DIRECT edges, so the module the focus file's dependency depends on ranked
  // no higher than a README.
  const importsOf = new Map<string, string[]>();
  for (const f of mappable) importsOf.set(f.path, extractImports(f.path, f.text));

  const stemOf = (path: string): string => path.replace(/\.[^./]+$/, "");

  /**
   * Does this import specifier name this file?
   *
   * The extension is stripped from BOTH sides, and that is a fix rather than a tidy-up: in a
   * TypeScript ESM project every import ends in `.js` while every file on disk ends in `.ts`, so
   * comparing a specifier against a stem silently never matched. The whole import-graph half of the
   * ranking was dead on exactly the kind of repository this extension is written in — including
   * this one.
   *
   * The match is anchored on a path boundary, so `./helper` does not also claim `src/otherhelper.ts`.
   */
  const resolves = (specifier: string, path: string): boolean => {
    const want = stemOf(specifier.replace(/^[./]+/, ""));
    if (!want) return false;
    const stem = stemOf(path);
    return stem === want || stem.endsWith(`/${want}`);
  };

  /** Paths the focus file reaches directly, and the ones those reach in turn. */
  const firstDegree = new Set<string>();
  for (const f of mappable) {
    if (focusImports.some((i) => resolves(i, f.path))) firstDegree.add(f.path);
  }
  const secondDegree = new Set<string>();
  for (const near of firstDegree) {
    for (const spec of importsOf.get(near) ?? []) {
      for (const f of mappable) {
        if (f.path !== focus && !firstDegree.has(f.path) && resolves(spec, f.path)) secondDegree.add(f.path);
      }
    }
  }

  return mappable
    .map((f) => {
      let score = baseScore(f.path);
      if (f.path === focus) score += 100;
      if (open.has(f.path)) score += 20;
      const r = recent.indexOf(f.path);
      if (r >= 0) score += Math.max(1, 10 - r);
      if (focusDir && f.path.startsWith(focusDir)) score += 6;
      // A direct edge in the dependency graph, either way round.
      if (firstDegree.has(f.path)) score += 15;
      if (focus && (importsOf.get(f.path) ?? []).some((i) => resolves(i, focus))) score += 8;
      // One hop further out. Worth less than a direct edge and much more than an unrelated file:
      // this is where the type the focus file's helper returns actually lives.
      if (secondDegree.has(f.path)) score += 5;

      const symbols = extractSymbols(f.path, f.text);
      if (terms.length) {
        const path = f.path.toLowerCase();
        // The path naming a term is a strong claim: `src/totals.ts` for "the totals are wrong".
        for (const term of terms) if (path.includes(term)) score += 12;
        // A declared symbol naming a term is stronger still — it is the definition, not a mention.
        const declared = symbols.map((sym) => sym.signature.toLowerCase());
        for (const term of terms) {
          if (declared.some((sig) => sig.includes(term))) score += 18;
        }
      }
      return { path: f.path, symbols, score };
    })
    .filter((e) => e.symbols.length > 0 || e.score > 4)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export interface RepoMap {
  text: string;
  filesIncluded: number;
  filesOmitted: number;
  tokens: number;
}

export function buildRepoMap(files: MapFile[], budgetTokens: number, hints: RankHints = {}): RepoMap {
  const ranked = rankFiles(files, hints);
  const lines: string[] = ["Repository map (paths and top-level symbols; ask for a file to see its body):"];
  let tokens = estimateTokens(lines[0]!);
  let included = 0;

  for (const entry of ranked) {
    const head = `\n${entry.path}`;
    const body = entry.symbols.slice(0, 25).map((s) => `  ${s.line}: ${s.signature}`).join("\n");
    const chunk = body ? `${head}\n${body}` : head;
    const cost = estimateTokens(chunk);
    if (tokens + cost > budgetTokens) {
      // Not `break`: a small high-value file further down still fits where a huge one did not.
      if (tokens + estimateTokens(head) <= budgetTokens) {
        lines.push(head);
        tokens += estimateTokens(head);
        included++;
      }
      continue;
    }
    lines.push(chunk);
    tokens += cost;
    included++;
  }

  return {
    text: lines.join("\n"),
    filesIncluded: included,
    filesOmitted: Math.max(0, ranked.length - included),
    tokens,
  };
}
