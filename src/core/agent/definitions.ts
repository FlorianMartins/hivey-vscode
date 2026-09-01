// Skills and sub-agents, defined by the user in files.
//
// The request behind this file was "total control of the tool", and the shape that answers it is
// not a settings page. It is a directory of Markdown files in the repository:
//
//   .hiveycode/skills/review-rpg.md      a named set of instructions, invoked with /review-rpg
//   .hiveycode/agents/db-explorer.md     a sub-agent with its own prompt, tools and model
//
// Files rather than settings, for three reasons that are the whole design:
//
//   • THEY ARE VERSIONED. A team's conventions belong in the repository next to the code they
//     govern, reviewed like code, and arriving automatically with a clone. A setting is per person
//     and dies with the machine.
//   • THEY ARE READABLE. A skill is prose with a header. Someone who has never seen this extension
//     can open one and know exactly what it will make the model do — which is not true of anything
//     stored as JSON in a settings file.
//   • THE FORMAT IS ALREADY KNOWN. It is Claude Code's: `---` frontmatter, `name`, `description`,
//     body. Somebody who has written one has written all of them.
//
// The one rule that is not the user's to change: a sub-agent's tools are an INTERSECTION with what
// the mode already allows, never a union. A definition file arrives with a cloned repository, and a
// file that could grant itself `run_command` in plan mode would make the mode a suggestion.

export interface Skill {
  kind: "skill";
  /** The invocation name: `/review-rpg`. Lowercase, no spaces. */
  name: string;
  /** Shown in the slash-command list, and given to the model so it knows when this applies. */
  description: string;
  /** The instructions, verbatim. */
  body: string;
  /** Where it came from, for the interface and for error messages. */
  source: string;
}

export interface AgentDefinition {
  kind: "agent";
  name: string;
  description: string;
  /** The sub-agent's system prompt. */
  body: string;
  /** Tool names it may use. Empty means "whatever the mode allows", which is the safe default. */
  tools: string[];
  /** A model of its own, when a cheap one is enough or an expensive one is needed. */
  model?: string;
  /** How many tool round-trips it gets before it has to answer. */
  maxSteps?: number;
  source: string;
}

export type Definition = Skill | AgentDefinition;

export interface ParseResult {
  definition?: Definition;
  /** Everything wrong with the file, in the words its author needs to fix it. */
  problems: string[];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/**
 * Sub-agents that ship with the extension.
 *
 * The machinery for these existed and nothing used it, because a feature whose only form is "write
 * a Markdown file in a directory you have to know about" is a feature for the person who wrote it.
 * These four are the delegations that come up constantly, and each earns its place by having a
 * NARROWER tool set than the conversation that calls it — which is the entire point of a sub-agent:
 * it starts on a clean context and it cannot do more than its job.
 *
 * A repository that defines an agent of the same name wins. The team's `reviewer` is theirs, and a
 * built-in silently overriding it would be the worst possible outcome.
 */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    kind: "agent",
    name: "explorer",
    description: "Finds where something lives in the repository and reports back. Reads only.",
    tools: ["read_file", "list_files", "search_text"],
    maxSteps: 12,
    source: "built-in",
    body: [
      "You answer one question about a repository you have not seen before: where something is, and how it fits.",
      "Search before reading, and read only what the search points at — you are called precisely so the caller",
      "does not have to spend its context on this.",
      "",
      "Answer with paths and symbol names, not with prose about them. Cite file:line for every claim.",
      "If you cannot find it, say so and say where you looked; a confident wrong path costs more than an admission.",
    ].join("\n"),
  },
  {
    kind: "agent",
    name: "reviewer",
    description: "Reviews the uncommitted changes. Reads the diff and the files around it; changes nothing.",
    tools: ["git_diff", "git_status", "read_file", "search_text", "get_diagnostics"],
    maxSteps: 16,
    source: "built-in",
    body: [
      "You review a change. Read the diff first, then read enough of the surrounding files to judge it —",
      "a diff read in isolation produces comments about things the rest of the file already handles.",
      "",
      "Order: correctness, then security, then what the next reader will get wrong. For each finding give the",
      "file and line, what happens, and the smallest fix. Report nothing you are unsure of, and say plainly",
      "when the change is fine — a review that always finds something is a review nobody reads twice.",
    ].join("\n"),
  },
  {
    kind: "agent",
    name: "tester",
    description: "Writes tests for something and runs them until they pass.",
    tools: ["read_file", "search_text", "list_files", "write_file", "edit_file", "run_command", "get_diagnostics"],
    maxSteps: 20,
    source: "built-in",
    body: [
      "You write tests and make them pass. Read the existing tests first and match them: the same framework,",
      "the same layout, the same naming. A test that does not look like its neighbours is a test that gets deleted.",
      "",
      "Cover the boundaries and the failure paths, not another version of the happy path. Run them, and if one",
      "fails, decide whether the test or the code is wrong before changing either. Never weaken an assertion to",
      "make a test pass.",
    ].join("\n"),
  },
  {
    kind: "agent",
    name: "dba",
    description: "Answers questions about the database: schema, queries, indexes. Reads only.",
    tools: ["ibmi_sql", "ibmi_objects", "ibmi_library_list", "read_file", "search_text"],
    maxSteps: 12,
    source: "built-in",
    body: [
      "You answer questions about a database. Look at the schema before answering — column types and keys",
      "decide most of the answer, and guessing at them produces SQL that parses and returns the wrong rows.",
      "",
      "Run only statements that read. Give the query, say what it will scan, and name the index it depends on.",
      "On Db2 for i, qualify objects and use FETCH FIRST rather than LIMIT.",
    ].join("\n"),
  },
];

/**
 * Read one definition file.
 *
 * Deliberately forgiving about layout and strict about identity. Whitespace, CRLF, a missing
 * trailing newline and quoted values are all accepted, because the file is written by hand. A
 * missing or malformed `name` is not, because the name is how it is invoked — a skill called
 * `Review RPG` would be `/Review RPG`, which nobody can type.
 */
export function parseDefinition(kind: "skill" | "agent", source: string, text: string): ParseResult {
  const problems: string[] = [];
  const normalised = text.replace(/\r\n/g, "\n");

  const match = /^\s*---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalised);
  if (!match) {
    return {
      problems: [
        `${source}: no header. A definition starts with a line containing only --- , then name: and description: , then another --- .`,
      ],
    };
  }

  const fields = parseFrontmatter(match[1]!);
  const body = match[2]!.trim();

  const name = (fields["name"] ?? "").trim();
  if (!name) problems.push(`${source}: missing "name".`);
  else if (!NAME.test(name)) {
    problems.push(
      `${source}: "${name}" is not a usable name. Lowercase letters, digits and hyphens, 2 to 40 characters — it is what you type after the slash.`,
    );
  }

  const description = (fields["description"] ?? "").trim();
  if (!description) {
    // Not cosmetic: the description is what the model reads to decide whether a skill applies, and
    // what the user reads in the list. A definition without one is invisible in both directions.
    problems.push(`${source}: missing "description". One line saying when this should be used.`);
  }

  if (!body) problems.push(`${source}: the file has a header but no instructions under it.`);

  if (problems.length) return { problems };

  if (kind === "skill") {
    return { definition: { kind: "skill", name, description, body, source }, problems };
  }

  const tools = splitList(fields["tools"] ?? "");
  const model = (fields["model"] ?? "").trim() || undefined;
  const rawSteps = (fields["max-steps"] ?? fields["maxsteps"] ?? "").trim();
  const maxSteps = rawSteps ? Number(rawSteps) : undefined;
  if (rawSteps && (!Number.isFinite(maxSteps) || maxSteps! < 1 || maxSteps! > 50)) {
    problems.push(`${source}: "max-steps" must be a number between 1 and 50.`);
    return { problems };
  }

  return {
    definition: {
      kind: "agent",
      name,
      description,
      body,
      tools,
      ...(model ? { model } : {}),
      ...(maxSteps ? { maxSteps } : {}),
      source,
    },
    problems,
  };
}

/**
 * `key: value` lines, with folded multi-line values.
 *
 * Not a YAML parser and not pretending to be one. Supporting the whole of YAML here would mean
 * either a dependency or a thousand lines of edge cases, to read four keys out of a header a human
 * typed. What it does handle is what people actually write: quotes, colons inside values,
 * continuation lines indented under a key, and `#` comments on their own line.
 */
function parseFrontmatter(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key: string | undefined;
  for (const raw of header.split("\n")) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const start = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (start) {
      key = start[1]!.toLowerCase();
      out[key] = unquote(start[2]!.trim());
    } else if (key && /^\s+\S/.test(line)) {
      // A continuation: `description:` on one line and the sentence indented under it.
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/** `a, b, c` or `[a, b]` or `a b c` — every way someone writes a list without thinking about it. */
function splitList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/**
 * The tools a sub-agent actually gets.
 *
 * An intersection, never a union. The definition file may have arrived with a cloned repository, so
 * treating its `tools:` line as an authorisation would let a file grant itself `run_command` in a
 * mode that has no `run_command` — and the mode would become a suggestion. Listing a tool the mode
 * does not offer is not an error either; it is a definition written for agent mode being used in
 * plan mode, which should quietly do less rather than refuse.
 */
export function toolsForAgent(definition: AgentDefinition, available: string[]): string[] {
  if (!definition.tools.length) return available;
  const allowed = new Set(available);
  return definition.tools.filter((name) => allowed.has(name));
}

/**
 * The block describing the available skills, for the system prompt.
 *
 * Names and descriptions only. Putting every skill's full instructions in every prompt would cost
 * the whole context budget on a repository with a dozen of them, and the model does not need the
 * instructions until it has decided to use one.
 */
export function skillsPrompt(skills: Skill[]): string {
  if (!skills.length) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return [
    "",
    "This repository defines the following skills. When one of them applies to what is being asked,",
    "call `use_skill` with its name to read its instructions, then follow them.",
    ...lines,
  ].join("\n");
}

/** A starting point that is a working example rather than a form to fill in. */
export function skillTemplate(name: string): string {
  return `---
name: ${name}
description: One line saying when this should be used. The model reads it to decide.
---

Write the instructions here, addressed to the assistant.

Be specific about the things it cannot infer from the code: the conventions of this team, the
library that was banned two years ago, the format a commit message takes here. Anything it could
work out by reading the repository does not need to be written down.
`;
}

export function agentTemplate(name: string): string {
  return `---
name: ${name}
description: One line saying what this agent is for. The main assistant reads it to decide.
# Optional. Omit to allow whatever the current mode allows — never more.
tools: read_file, list_files, search_text
# Optional. A cheaper or larger model than the conversation's.
model:
# Optional, 1 to 50. How many tool round-trips before it has to answer.
max-steps: 8
---

You are a focused sub-agent. Say what this one does, what it must not do, and what its answer
should look like.

The answer you return is the only thing the main assistant sees, so end with the conclusion rather
than with a description of how you reached it.
`;
}
