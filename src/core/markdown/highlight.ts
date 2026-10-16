// Syntax coloring for the code blocks in an answer.
//
// Written by hand, like the rest of this codebase's plumbing, because the alternative is shipping a
// grammar engine and a few hundred kilobytes of TextMate rules into an extension whose selling
// point is that an enterprise can read every line of it before installing. What a chat panel needs
// is not an editor's fidelity: it is the five distinctions that make a snippet skimmable —
// comment, string, number, keyword, name-being-defined — and being WRONG about them is worse than
// being coarse, so everything ambiguous stays plain.
//
// One invariant governs the whole file and is asserted by the tests: concatenating the tokens
// reproduces the input, character for character. A highlighter that silently eats a backslash or a
// half-open quote has corrupted code the user is about to paste into their repository, which is a
// far worse failure than a keyword rendered in the ordinary color.

export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "type" | "function" | "meta";

export interface Token {
  text: string;
  kind: TokenKind;
}

/**
 * Language families rather than languages.
 *
 * Forty grammars that differ in their keyword list and agree on everything else is forty places to
 * fix the same bug. What actually varies between C and Rust, at this resolution, is which words are
 * keywords — so that is the only thing the table holds.
 */
export type Family = "clike" | "script" | "sql" | "json" | "markup" | "plain";

const CLIKE = new Set(
  ("abstract as async await break case catch class const constructor continue declare default delete do else enum export extends " +
    "extern final finally fn for from func function get go goto if impl implements import in instanceof interface internal is let " +
    "match mod module mut namespace new null nil None operator override package private protected public readonly record ref return " +
    "sealed self set static struct super switch this throw throws trait try type typedef typeof union unsafe use using var virtual " +
    "void volatile where while with yield true false undefined")
    .split(" "),
);

const SCRIPT = new Set(
  ("and as assert async await break case class continue def del do done elif else elsif end esac except exec exit export fi finally " +
    "for from function global if import in is lambda local nonlocal not or pass print raise return select then true false null nil " +
    "None True False try unless until when while with yield echo set unset source alias")
    .split(" "),
);

const SQL = new Set(
  ("add all alter and any as asc begin between by call cascade case cast char coalesce column commit constraint create cross current " +
    "cursor date declare default delete desc distinct do drop else end exec execute exists fetch first for foreign from full function " +
    "grant group having if in index inner insert intersect into is join key left like limit not null offset on only open or order " +
    "outer over partition primary procedure references rename replace return revoke right rollback rows select set some table then " +
    "to trigger union unique update using values view when where while with")
    .split(" "),
);

/** Which family a fence's language tag belongs to. Unknown tags render plain, never guessed at. */
export function familyOf(lang: string): Family {
  const id = lang.toLowerCase().replace(/^\./, "");
  if (/^(ts|tsx|js|jsx|javascript|typescript|java|c|h|cpp|cc|hpp|cs|csharp|go|golang|rust|rs|php|swift|kotlin|kt|scala|dart|groovy|proto)$/.test(id)) return "clike";
  if (/^(py|python|rb|ruby|sh|bash|zsh|shell|console|ps1|powershell|perl|pl|lua|r|yaml|yml|toml|ini|cfg|conf|makefile|make|dockerfile|env)$/.test(id)) return "script";
  if (/^(sql|db2|plsql|tsql|mysql|postgres|postgresql|sqlite)$/.test(id)) return "sql";
  if (/^(json|jsonc|json5)$/.test(id)) return "json";
  if (/^(html|xml|svg|vue|xhtml|jsp|aspx)$/.test(id)) return "markup";
  return "plain";
}

interface Rules {
  keywords: Set<string>;
  /** Line-comment openers, longest first so `//` is tried before `/`. */
  lineComment: string[];
  blockComment?: [string, string];
  quotes: string[];
  /** Preprocessor and directive lines, colored as meta. */
  directive?: RegExp;
  caseSensitive?: boolean;
}

function rulesFor(family: Family): Rules | undefined {
  switch (family) {
    case "clike":
      return { keywords: CLIKE, lineComment: ["//"], blockComment: ["/*", "*/"], quotes: ['"', "'", "`"], directive: /^\s*#/, caseSensitive: true };
    case "script":
      return { keywords: SCRIPT, lineComment: ["#"], quotes: ['"', "'"], caseSensitive: true };
    case "sql":
      return { keywords: SQL, lineComment: ["--"], blockComment: ["/*", "*/"], quotes: ["'", '"'], caseSensitive: false };
    case "json":
      return { keywords: new Set(["true", "false", "null"]), lineComment: ["//"], blockComment: ["/*", "*/"], quotes: ['"'], caseSensitive: true };
    default:
      return undefined;
  }
}

/** Tokens for one block of code. An unknown language yields one plain token — never a guess. */
export function highlight(code: string, lang: string): Token[] {
  const family = familyOf(lang);
  if (family === "markup") return highlightMarkup(code);
  const rules = rulesFor(family);
  if (!rules) return code ? [{ text: code, kind: "plain" }] : [];
  return scan(code, rules);
}

/** Append while merging with the previous token of the same kind, so the DOM stays small. */
function push(out: Token[], text: string, kind: TokenKind): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ text, kind });
}

function scan(code: string, rules: Rules): Token[] {
  const out: Token[] = [];
  let i = 0;
  let atLineStart = true;

  while (i < code.length) {
    const c = code[i]!;

    if (atLineStart && rules.directive) {
      const rest = code.slice(i, code.indexOf("\n", i) === -1 ? undefined : code.indexOf("\n", i));
      if (rules.directive.test(rest)) {
        push(out, rest, "meta");
        i += rest.length;
        atLineStart = false;
        continue;
      }
    }

    // Comments before anything else: a quote inside a comment is not a string, and getting that
    // order wrong is how a highlighter runs a string to the end of the file.
    const opener = rules.lineComment.find((o) => code.startsWith(o, i));
    if (opener) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      push(out, code.slice(i, stop), "comment");
      i = stop;
      continue;
    }

    if (rules.blockComment && code.startsWith(rules.blockComment[0], i)) {
      const close = code.indexOf(rules.blockComment[1], i + rules.blockComment[0].length);
      // An unterminated block comment runs to the end, which is what the compiler does too.
      const stop = close === -1 ? code.length : close + rules.blockComment[1].length;
      push(out, code.slice(i, stop), "comment");
      i = stop;
      atLineStart = false;
      continue;
    }

    if (rules.quotes.includes(c)) {
      const [text, next] = readString(code, i, c);
      push(out, text, "string");
      i = next;
      atLineStart = false;
      continue;
    }

    if (/[0-9]/.test(c) && !isWordChar(code[i - 1] ?? "", rules)) {
      let j = i;
      while (j < code.length && /[0-9a-fA-FxXoObB._]/.test(code[j]!)) j++;
      push(out, code.slice(i, j), "number");
      i = j;
      atLineStart = false;
      continue;
    }

    if (isWordStart(c)) {
      let j = i;
      while (j < code.length && isWordChar(code[j]!, rules)) j++;
      const word = code.slice(i, j);
      const key = rules.caseSensitive ? word : word.toLowerCase();
      if (rules.keywords.has(key)) push(out, word, "keyword");
      // A name followed by `(` is being called or defined. It is the one structural fact worth
      // coloring without a parser, and it is the one that makes a snippet scannable.
      else if (code[j] === "(") push(out, word, "function");
      // Type-ish by convention: `Foo`, `HTTPServer`. A convention, so it is applied only where the
      // language has one — SQL is case-insensitive and would light up at random.
      else if (rules.caseSensitive && /^[A-Z][A-Za-z0-9_]*$/.test(word) && /[a-z]/.test(word)) push(out, word, "type");
      else push(out, word, "plain");
      i = j;
      atLineStart = false;
      continue;
    }

    push(out, c, "plain");
    atLineStart = c === "\n";
    i += 1;
  }
  return out;
}

/** From an opening quote to its match, honouring backslash escapes and doubled quotes (SQL). */
function readString(code: string, from: number, quote: string): [string, number] {
  let i = from + 1;
  while (i < code.length) {
    const c = code[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) {
      // `'it''s'` is one string in SQL, and closing at the middle quote would color the
      // rest of the statement as if it were text.
      if (code[i + 1] === quote) {
        i += 2;
        continue;
      }
      return [code.slice(from, i + 1), i + 1];
    }
    // A newline ends an unterminated string. Running to the end of the file instead would paint a
    // whole snippet as one string because of a single stray apostrophe in a comment.
    if (c === "\n") return [code.slice(from, i), i];
    i += 1;
  }
  return [code.slice(from), code.length];
}

function isWordStart(c: string): boolean {
  return /[A-Za-z_$%@]/.test(c);
}

function isWordChar(c: string, rules: Rules): boolean {
  if (!c) return false;
  return /[A-Za-z0-9_$%@]/.test(c);
}

/** Tags, attribute values and comments. Enough to read a snippet; not an XML parser. */
function highlightMarkup(code: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < code.length) {
    if (code.startsWith("<!--", i)) {
      const close = code.indexOf("-->", i);
      const stop = close === -1 ? code.length : close + 3;
      push(out, code.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    if (code[i] === "<") {
      const close = code.indexOf(">", i);
      const stop = close === -1 ? code.length : close + 1;
      const tag = code.slice(i, stop);
      // Inside a tag: the name is structure, the quoted values are strings, the rest is plain.
      const nameEnd = tag.search(/[\s>/]/);
      push(out, tag.slice(0, nameEnd === -1 ? tag.length : nameEnd), "keyword");
      let rest = tag.slice(nameEnd === -1 ? tag.length : nameEnd);
      const re = /("[^"]*"|'[^']*')/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) {
        push(out, rest.slice(last, m.index), "plain");
        push(out, m[0], "string");
        last = m.index + m[0].length;
      }
      push(out, rest.slice(last), "plain");
      i = stop;
      continue;
    }
    const next = code.indexOf("<", i);
    const stop = next === -1 ? code.length : next;
    push(out, code.slice(i, stop), "plain");
    i = stop;
  }
  return out;
}
