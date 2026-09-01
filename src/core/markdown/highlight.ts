// Syntax colouring for the code blocks in an answer.
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
// far worse failure than a keyword rendered in the ordinary colour.

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
export type Family = "clike" | "script" | "sql" | "ibmi" | "ibmi-fixed" | "json" | "markup" | "plain";

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

// Db2 for i alongside the standard: `QSYS2`, `SYSIBM` and `FETCH FIRST` are what an IBM i developer
// is actually reading, and a highlighter that knows ANSI SQL and not theirs is the wrong one here.
const SQL = new Set(
  ("add all alter and any as asc begin between by call cascade case cast char coalesce column commit constraint create cross current " +
    "cursor date declare default delete desc distinct do drop else end exec execute exists fetch first for foreign from full function " +
    "grant group having if in index inner insert intersect into is join key left like limit not null offset on only open or order " +
    "outer over partition primary procedure references rename replace return revoke right rollback rows select set some table then " +
    "to trigger union unique update using values view when where while with")
    .split(" "),
);

// Free-form RPG, CL and the SQL that lives inside SQLRPGLE. Opcodes and built-ins together: to
// someone reading a member, `%SUBST` and `DOW` are the same kind of word — the language's own.
const IBMI = new Set(
  ("and begsr callp chain clear const ctl-opt dcl-c dcl-ds dcl-f dcl-parm dcl-pi dcl-pr dcl-proc dcl-s dcl-subf delete dou dow else " +
    "elseif end-ds end-if end-pi end-pr end-proc end-sr enddo endfor endif endmon endsl eval eval-corr except exsr for forward " +
    "if in inz iter leave leavesr like likeds likerec monitor on-error open or other otherwise psds qualified read readc reade readp " +
    "readpe recno reset return select setgt setll sndmsg sqlcode sqlstate sqltype static subst templ template unlock update when " +
    "write xml-into xml-sax dsply pgm endpgm dclf dcl chgvar sndpgmmsg monmsg rcvf call cmd")
    .split(" "),
);

/** Which family a fence's language tag belongs to. Unknown tags render plain, never guessed at. */
export function familyOf(lang: string): Family {
  const id = lang.toLowerCase().replace(/^\./, "");
  if (/^(ts|tsx|js|jsx|javascript|typescript|java|c|h|cpp|cc|hpp|cs|csharp|go|golang|rust|rs|php|swift|kotlin|kt|scala|dart|groovy|proto)$/.test(id)) return "clike";
  if (/^(py|python|rb|ruby|sh|bash|zsh|shell|console|ps1|powershell|perl|pl|lua|r|yaml|yml|toml|ini|cfg|conf|makefile|make|dockerfile|env)$/.test(id)) return "script";
  if (/^(sql|db2|db2i|plsql|tsql|mysql|postgres|postgresql|sqlite)$/.test(id)) return "sql";
  // Fixed-format members carry meaning in their columns, which is a different lexer, not a
  // different keyword list: an asterisk in column 7 is a comment and an asterisk anywhere else is
  // multiplication.
  if (/^(rpg|rpg3|rpgiii|rpgle-fixed|dds|pf|lf|dspf|prtf)$/.test(id)) return "ibmi-fixed";
  if (/^(rpgle|sqlrpgle|free|clle|clp|cl|cmd)$/.test(id)) return "ibmi";
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
  /** True where a word may hold a hyphen: `end-proc`, `dcl-ds`, `CHGVAR`. */
  hyphenWords?: boolean;
  /** Preprocessor and directive lines, coloured as meta. */
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
    case "ibmi":
      return { keywords: IBMI, lineComment: ["//"], quotes: ["'", '"'], hyphenWords: true, directive: /^\s*(\*\*free|\/(?:free|end-free|copy|include|if|else|endif|define|exec\b))/i, caseSensitive: false };
    case "json":
      return { keywords: new Set(["true", "false", "null"]), lineComment: ["//"], blockComment: ["/*", "*/"], quotes: ['"'], caseSensitive: true };
    default:
      return undefined;
  }
}

/** Tokens for one block of code. An unknown language yields one plain token — never a guess. */
export function highlight(code: string, lang: string): Token[] {
  const family = familyOf(lang);
  if (family === "ibmi-fixed") return highlightFixed(code);
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
      // colouring without a parser, and it is the one that makes a snippet scannable.
      else if (code[j] === "(") push(out, word, "function");
      // Type-ish by convention: `Foo`, `HTTPServer`. A convention, so it is applied only where the
      // language has one — SQL and RPG are case-insensitive and would light up at random.
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

/** From an opening quote to its match, honouring backslash escapes and doubled quotes (SQL, RPG). */
function readString(code: string, from: number, quote: string): [string, number] {
  let i = from + 1;
  while (i < code.length) {
    const c = code[i]!;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) {
      // `'it''s'` is one string in SQL and in RPG, and closing at the middle quote would colour the
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
  if (rules.hyphenWords && c === "-") return true;
  return /[A-Za-z0-9_$%@]/.test(c);
}

/**
 * Fixed-format members, where the column is the syntax.
 *
 * RPG III, RPG IV fixed and DDS all put meaning in fixed positions, and the one that matters for
 * reading a snippet is the comment: an asterisk in column 7 comments the line out. Column 6 carries
 * the specification letter (H, F, D, C, O in RPG; A in DDS), which is what tells you what kind of
 * line you are looking at — so it is coloured as the structural marker it is.
 *
 * Everything to the right of that stays plain. Guessing at operands inside a fixed layout is where
 * a naive highlighter starts colouring column boundaries as operators.
 */
function highlightFixed(code: string): Token[] {
  const out: Token[] = [];
  for (const line of code.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, "");
    const eol = line.slice(bare.length);
    // The comment marker is column 7 (index 6), and a bare `*` in column 1 is the convention older
    // listings use — both are comments and neither is multiplication.
    if (bare[6] === "*" || /^\s*\*/.test(bare)) {
      push(out, bare, "comment");
      push(out, eol, "plain");
      continue;
    }
    if (/^\s*\*\*(free|ctdata|\s|$)/i.test(bare)) {
      push(out, bare, "meta");
      push(out, eol, "plain");
      continue;
    }
    if (bare.length > 6 && /[A-Za-z]/.test(bare[5] ?? "")) {
      push(out, bare.slice(0, 5), "plain");
      push(out, bare[5]!, "keyword");
      push(out, bare.slice(6), "plain");
      push(out, eol, "plain");
      continue;
    }
    push(out, bare + eol, "plain");
  }
  return out;
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
