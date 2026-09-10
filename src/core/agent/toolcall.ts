// Making a 7B model's tool calls usable.
//
// A large hosted model emits clean JSON because it was trained and reinforced on tool use for
// months. A 7B coder model running on somebody's laptop emits JSON that is nearly right: a fence
// around it, a trailing comma, `True` where `true` belongs, a Windows path whose backslashes were
// never escaped, or the whole object encoded twice. The loop used to answer all of those with
// "Arguments were not valid JSON. Send the call again." — and a small model, given that, sends the
// same thing again. Three steps of the budget, no progress, and a turn that ends in nothing.
//
// This module is the difference between "local models cannot really do agents" and "local models
// can do agents". Two halves:
//
//   • REPAIR what is nearly right. Every rule below is a real failure mode, not a hypothetical, and
//     each one is conservative: it fixes a syntax that has exactly one plausible reading, and gives
//     up otherwise. A repair that guesses would be worse than a refusal, because a wrongly repaired
//     `write_file` writes the wrong thing to disk without ever failing.
//   • When repair is impossible, SAY WHAT IS WRONG. "Not valid JSON" is not actionable. "The `path`
//     field is missing; it must be a string" is a sentence a small model can act on, and in
//     practice it does — one corrective step instead of three identical ones.

import type { ToolSchema } from "../providers/types.js";

/** JSON that was already valid, or a repair, or nothing. Never a guess. */
export interface ParseResult {
  ok: boolean;
  args?: Record<string, unknown>;
  /** What to tell the model, in words it can act on. */
  error?: string;
  /** True when the text had to be repaired — worth counting, and worth showing in a log. */
  repaired?: boolean;
}

/**
 * Fenced code blocks, and prose around the object.
 *
 * Models trained to answer in markdown put ```json around things. Some prepend "Here is the call:".
 * Both leave the object itself intact, so both are recoverable.
 */
function unwrap(text: string): string {
  let out = text.trim();
  const fence = /^```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?```$/i.exec(out);
  if (fence) out = fence[1]!.trim();
  // Prose on either side of a single object: take the outermost braces.
  if (!out.startsWith("{")) {
    const first = out.indexOf("{");
    const last = out.lastIndexOf("}");
    if (first >= 0 && last > first) out = out.slice(first, last + 1);
  }
  return out.trim();
}

/**
 * Escape the newlines and tabs that appear INSIDE a string literal.
 *
 * The single most common break, and the one with the most at stake: a model writing a multi-line
 * file through `write_file` puts real newlines in the `content` string. The object is otherwise
 * perfect, and the content is exactly what the user wants written — refusing it means the model
 * tries again, usually by shortening the file until it fits on one line.
 *
 * Done by walking the text rather than by regular expression, because only a walk knows whether a
 * given newline is inside a string or between two fields.
 */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Trailing commas before a closing brace or bracket. Every language but JSON allows them. */
function dropTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

/** `True`, `False`, `None` — a model that has read more Python than JSON. */
function pythonLiterals(text: string): string {
  return text.replace(/\b(True|False|None)\b(?=\s*[,}\]])/g, (m) => (m === "True" ? "true" : m === "False" ? "false" : "null"));
}

/**
 * Parse a model's tool arguments, repairing what has one plausible reading.
 *
 * The order matters: try the text as it stands first, so a valid call is never touched. Every
 * repair after that is attempted on the result of the previous one, and the first parse that
 * succeeds wins.
 */
export function parseToolArgs(raw: string): ParseResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, args: {} };

  const attempt = (candidate: string): Record<string, unknown> | undefined => {
    try {
      const value = JSON.parse(candidate);
      // A model that encodes the object twice hands back a string containing JSON.
      if (typeof value === "string") {
        try {
          const inner: unknown = JSON.parse(value);
          if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Record<string, unknown>;
        } catch {
          return undefined;
        }
        return undefined;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      return value as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };

  const clean = attempt(text);
  if (clean) return { ok: true, args: clean };

  let candidate = unwrap(text);
  for (const fix of [dropTrailingCommas, pythonLiterals, escapeControlCharsInStrings]) {
    candidate = fix(candidate);
    const parsed = attempt(candidate);
    if (parsed) return { ok: true, args: parsed, repaired: true };
  }

  return {
    ok: false,
    error:
      "Those arguments were not valid JSON and could not be repaired. Send the call again with a " +
      "single JSON object: no markdown fence, no comments, double quotes around every key and " +
      "string, and \\n for newlines inside a string.",
  };
}

/** The distance between two tool names, for "did you mean". Capped: a far name is not a typo. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 4) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * What to say when a model calls a tool that does not exist.
 *
 * "Unknown tool: read_files" tells a model nothing it did not already have. Naming the nearest real
 * tool turns a dead step into a corrected one, and models invent plurals, underscores and synonyms
 * far more often than they invent something genuinely unrelated.
 */
export function unknownToolMessage(called: string, available: string[]): string {
  const ranked = available
    .map((name) => ({ name, d: editDistance(called.toLowerCase(), name.toLowerCase()) }))
    .sort((a, b) => a.d - b.d);
  if (!available.length) {
    // Plan mode with every writing tool removed, or a turn configured with none at all. "The tools
    // you have are: ." is a sentence that reads as a bug in the harness rather than as an answer.
    return `There is no tool called "${called}", and no tools are available in this mode. Answer without calling one.`;
  }
  const near = ranked[0];
  if (near && near.d <= 4) {
    return `There is no tool called "${called}". Did you mean "${near.name}"? The tools you have are: ${available.join(", ")}.`;
  }
  return `There is no tool called "${called}". The tools you have are: ${available.join(", ")}.`;
}

/**
 * Whether the arguments match the schema, and if not, exactly which field is wrong.
 *
 * Only the parts of JSON Schema the tool definitions here actually use — required, and the primitive
 * types. A full validator would be a dependency, and the fields that break are always these.
 *
 * The point is the WORDING. A model told "invalid arguments" retries at random; a model told
 * "`path` is missing, it must be a string" supplies it. An extra field is deliberately not an error:
 * models add `reason` and `explanation` constantly, they cost nothing, and rejecting them turns a
 * working call into a failed one.
 */
export function validateArgs(schema: ToolSchema, args: Record<string, unknown>): string | undefined {
  const params = schema.parameters as { properties?: Record<string, { type?: string }>; required?: string[] } | undefined;
  if (!params) return undefined;

  const problems: string[] = [];
  for (const name of params.required ?? []) {
    const value = args[name];
    if (value === undefined || value === null || value === "") {
      const type = params.properties?.[name]?.type ?? "value";
      problems.push(`"${name}" is missing; it must be a ${type}`);
    }
  }
  for (const [name, spec] of Object.entries(params.properties ?? {})) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    const wanted = spec.type;
    if (!wanted) continue;
    const actual = Array.isArray(value) ? "array" : typeof value;
    // A number written as "12" is the one coercion worth allowing: it is unambiguous, and every
    // model does it.
    if (wanted === "number" && actual === "string" && String(value).trim() !== "" && !Number.isNaN(Number(value))) continue;
    if (wanted === "string" && (actual === "number" || actual === "boolean")) continue;
    if (wanted !== actual && !(wanted === "integer" && actual === "number")) {
      problems.push(`"${name}" is a ${actual}; it must be a ${wanted}`);
    }
  }
  if (!problems.length) return undefined;
  return `That call cannot run: ${problems.join("; ")}. Send it again with the arguments corrected.`;
}

/** Apply the coercions `validateArgs` tolerates, so the tool receives the type it declared. */
export function coerceArgs(schema: ToolSchema, args: Record<string, unknown>): Record<string, unknown> {
  const params = schema.parameters as { properties?: Record<string, { type?: string }> } | undefined;
  if (!params?.properties) return args;
  const out = { ...args };
  for (const [name, spec] of Object.entries(params.properties)) {
    const value = out[name];
    if (spec.type === "number" || spec.type === "integer") {
      if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) out[name] = Number(value);
    } else if (spec.type === "string" && (typeof value === "number" || typeof value === "boolean")) {
      out[name] = String(value);
    }
  }
  return out;
}
