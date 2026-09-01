// The three ways to work, and what each one is allowed to touch.
//
// The distinction that matters is not "how clever is the model" but "what can it do to my
// machine". So the mode decides the tool set in CODE, and the prompt merely describes the mode it
// is already in. A plan-mode model that decides to write a file finds no tool to do it with.

import type { Tool } from "../agent/loop.js";
import { AGENT_PROMPT, PLAN_PROMPT, SYSTEM_PROMPT } from "../prompts.js";
import { t } from "../../shared/i18n.js";

export type Mode = "chat" | "plan" | "agent";

// Labels are read at call time rather than at module load, so the list follows the interface
// language even when this module was imported before the host announced it.
export const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "chat", label: t("Chat"), hint: t("Answers from what you attach. No access to the repository.") },
  { id: "plan", label: "Plan", hint: t("Reads the repository and proposes a plan. Changes nothing.") },
  { id: "agent", label: "Agent", hint: t("Reads, edits and proposes commands — with your approval.") },
];

/**
 * Tools that only observe. The allow-list is explicit: a new tool is powerless until named here.
 *
 * It lives in core, next to the mode it governs, rather than being assembled from flags the tools
 * set on themselves — a tool that grants itself read-only status is a tool that can be wrong about
 * it. Adding a tool to this list is a deliberate edit in the file that defines what plan mode means.
 */
const READ_ONLY = new Set([
  "read_file",
  "list_files",
  "search_text",
  "get_diagnostics",
  // The plan is a display, not an action: it changes nothing on the machine. Plan mode is precisely
  // where watching one being built is worth the most, so leaving it out would strip the mode of the
  // thing it is named after.
  "update_plan",
  // Git: everything that inspects history or the working tree.
  "git_status",
  "git_diff",
  "git_log",
  "git_branches",
  "git_blame",
  "git_show",
  // IBM i: reading members and object lists. Running SQL or CL is not here.
  "ibmi_member",
  "ibmi_members",
  "ibmi_objects",
  "ibmi_library_list",
]);

export function toolsForMode(all: Tool[], mode: Mode): Tool[] {
  switch (mode) {
    case "chat":
      return [];
    case "plan":
      // Two ways in: a tool that only ever reads, or a tool that can produce a reading-only
      // version of itself. Anything else has no representation in plan mode at all.
      return all.flatMap((tool) => {
        if (READ_ONLY.has(tool.schema.name)) return [tool];
        return tool.restrict ? [tool.restrict()] : [];
      });
    case "agent":
      return all;
  }
}

export function promptForMode(mode: Mode): string {
  switch (mode) {
    case "chat":
      return SYSTEM_PROMPT;
    case "plan":
      return PLAN_PROMPT;
    case "agent":
      return AGENT_PROMPT;
  }
}
