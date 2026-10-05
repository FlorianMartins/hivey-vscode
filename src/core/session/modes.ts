// The three ways to work, and what each one is allowed to touch.
//
// The distinction that matters is not "how clever is the model" but "what can it do to my
// machine". So the mode decides the tool set in CODE, and the prompt merely describes the mode it
// is already in. A plan-mode model that decides to write a file finds no tool to do it with.

import type { Tool } from "../agent/loop.js";
import { AGENT_PROMPT, PLAN_PROMPT, SYSTEM_PROMPT } from "../prompts.js";
import { onLanguageChange, t } from "../../shared/i18n.js";

export type Mode = "chat" | "plan" | "agent";

// ⚠️ This comment used to claim the labels were "read at call time rather than at module load", and
// the code underneath it did the opposite: `t()` inside an array literal at module scope runs ONCE,
// while the module is being evaluated — before the extension has read its own `language` setting,
// because ES modules evaluate their imports first. So the panel switched to French and these stayed
// in whatever the OS locale said, and the comment said that could not happen.
//
// `onLanguageChange` rebuilds the array in place, so every module that already imported it sees the
// new strings. See `shared/i18n.ts`.
export const MODES: Array<{ id: Mode; label: string; hint: string }> = [];
onLanguageChange(() => {
  MODES.length = 0;
  MODES.push(
    { id: "chat", label: t("Chat"), hint: t("Answers from what you attach. No access to the repository.") },
    { id: "plan", label: "Plan", hint: t("Reads the repository and proposes a plan. Changes nothing.") },
    { id: "agent", label: "Agent", hint: t("Reads, edits and proposes commands — with your approval.") },
  );
});

/**
 * Tools that only observe. The allow-list is explicit: a new tool is powerless until named here.
 *
 * It lives in core, next to the mode it governs, rather than being assembled from flags the tools
 * set on themselves — a tool that grants itself read-only status is a tool that can be wrong about
 * it. Adding a tool to this list is a deliberate edit in the file that defines what plan mode means.
 */
export const PLAN_READ_ONLY = new Set([
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
  // What the language server already knows. Every one of these is a question with an exact answer
  // the editor is holding, and a plan is exactly where somebody wants it: "who calls this" decides
  // whether to change a signature, and deciding is what plan mode is for.
  "find_references",
  "call_hierarchy",
  "workspace_symbols",
  // Impact analysis reads. It is here despite writing an output file, because the only library it
  // writes is QTEMP — created per job, destroyed with it, invisible to every other job — and the
  // gate knows that explicitly rather than the tool claiming it (`SCRATCH_LIBRARY`,
  // `core/ibmi/guard.ts`). Plan mode is also where this question is asked most: "who uses this"
  // belongs to deciding whether to change something, not to changing it.
  "ibmi_impact",
  // The optimizer's own index wish list and the table statistics. Reading them is a SELECT; the
  // index it suggests is a change, and that goes through `ibmi_sql` where the gate sees it.
  "ibmi_index_advice",
  // What a message identifier means, and what the house documentation says about it. Two reads.
  "ibmi_message",
]);

export function toolsForMode(all: Tool[], mode: Mode): Tool[] {
  switch (mode) {
    case "chat":
      return [];
    case "plan":
      // Two ways in: a tool that only ever reads, or a tool that can produce a reading-only
      // version of itself. Anything else has no representation in plan mode at all.
      return all.flatMap((tool) => {
        if (PLAN_READ_ONLY.has(tool.schema.name)) return [tool];
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
