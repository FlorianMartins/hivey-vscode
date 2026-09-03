// What a tool call was actually asked to do, in one line.
//
// The step lines used to show the first line of the RESULT, which answers "what came back" and
// never "what did it do". Reading a finished agent turn, that is the wrong half: `run_command` said
// "The command was started in the user's terminal", six times, without ever naming a command; four
// `ibmi_sql` steps in a row were four identical lines. Somebody reviewing what an agent did to
// their repository needs the call, and the call is in the arguments.
//
// Which argument matters is a property of the tool, so it is named here per tool rather than
// guessed. The fallback — the longest string argument — is for tools this file has never heard of,
// including every MCP tool a user plugs in, and it is right often enough to be worth having.

/** The argument that says what the call does, per tool, most specific first. */
const INTERESTING: Record<string, string[]> = {
  run_command: ["command"],
  read_file: ["path"],
  write_file: ["path"],
  edit_file: ["path"],
  list_files: ["glob"],
  search_text: ["pattern"],
  get_diagnostics: ["path"],
  use_skill: ["name"],
  run_agent: ["agent", "task"],
  ibmi_sql: ["sql"],
  ibmi_command: ["command"],
  ibmi_member: ["member", "library"],
  ibmi_members: ["library"],
  ibmi_objects: ["library"],
  ibmi_where_is: ["name"],
  ibmi_program_context: ["program"],
  ibmi_library_list: [],
  arcad_rest: ["path"],
  arcad_action: ["action"],
  git_diff: ["path"],
  git_show: ["ref"],
  git_log: ["path"],
  git_commit: ["message"],
  git_stage: ["path"],
  git_blame: ["path"],
  knowledge_read: ["id"],
  knowledge_write: ["id"],
  knowledge_search: ["query"],
};

const MAX = 120;

/**
 * A short, honest rendering of one call.
 *
 * Never invents: a tool with nothing worth showing returns an empty string, and the caller shows
 * the tool's name alone rather than a decorative "(no arguments)".
 */
export function callSignature(tool: string, args: Record<string, unknown>): string {
  const named = INTERESTING[tool];
  const keys = named ?? Object.keys(args);
  const parts: string[] = [];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
    else if (typeof value === "number" || typeof value === "boolean") parts.push(String(value));
    if (parts.length >= 2) break;
  }
  if (!parts.length && !named) {
    // An unknown tool: the longest string it was given is nearly always the subject of the call.
    const longest = Object.values(args)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .sort((a, b) => b.length - a.length)[0];
    if (longest) parts.push(longest.trim());
  }
  return short(parts.join(" "));
}

/** One line, and short enough to sit at the end of a row without pushing it out of the panel. */
function short(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line;
}
