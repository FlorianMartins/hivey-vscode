// The skills the panel offers, built-in and defined by the repository.
//
// This table used to live in the webview, next to the DOM that drew it, and that was the wrong place
// for two reasons that only became visible when they had to be switched off:
//
//   • THE EXTENSION HAS TO KNOW THEM. Which skills are enabled is a setting, and a setting is the
//     extension's to read and write. A list only the panel knows cannot be persisted, and cannot be
//     the same list in the two copies of the panel — the side bar and the secondary side bar each
//     have their own webview state, so a preference stored there would disagree with itself.
//   • THEY ARE DATA. Names, descriptions and prompts have no DOM in them. Keeping them here makes
//     them testable and keeps the webview about drawing.
//
// A built-in skill carries either a `prompt` — words sent to the model on the user's behalf — or an
// `action`, which does something to the conversation instead. The action is a plain string rather
// than a protocol message so that core stays free of the panel's wire format; the webview maps it.

import { t } from "../../shared/i18n.js";

export interface BuiltinSkill {
  /** The invocation, `/` included. */
  name: string;
  /** One line, shown in the completion list. */
  hint: string;
  /** What is actually sent. Absent on an action. */
  prompt?: string;
  /** What it does to the conversation instead of asking something. */
  action?: "compact";
  /** True when the active file (or selection) should ride along with it. */
  attach?: boolean;
}

/**
 * The skills that ship with the extension.
 *
 * The last three are the reason the IBM i work exists at all: `/tofree` is what an RPG shop reaches
 * for daily, and converting fixed-format to free-form is precisely where a model that guesses at
 * column positions produces something that will not compile.
 */
export const BUILTIN_SKILLS: BuiltinSkill[] = [
  { name: "/compact", hint: t("summarise the conversation and free the context"), action: "compact" },
  { name: t("/explain"), hint: t("explain the file or the selection"), prompt: t("Explain this code: what it does, how it fits into the rest, and what deserves attention."), attach: true },
  { name: "/tests", hint: t("write tests"), prompt: t("Write tests for this code, in the style and with the tools already used in this repository. Cover the edge cases."), attach: true },
  { name: t("/fix"), hint: t("find and fix the problem"), prompt: t("Find the defect in this code and fix it. Say in one sentence what was wrong."), attach: true },
  { name: t("/review"), hint: t("review: bugs, security, readability"), prompt: t("Review this code: bugs first, then security, then readability. Order by severity, cite the lines, and report nothing you are unsure of."), attach: true },
  { name: "/doc", hint: t("document"), prompt: t("Document this code: a note above it, in the language and style of the file."), attach: true },
  { name: t("/optimise"), hint: t("make it faster, without changing what it does"), prompt: t("Make this code faster without changing its behaviour. Say what the cost was before and after, and refuse if the gain is not worth the loss of clarity."), attach: true },
  { name: "/commit", hint: t("write the commit message"), prompt: t("Read the staged changes with git_diff and write the commit message for them. Subject line, then the why.") },
  { name: "/tofree", hint: t("convert fixed-format RPG to fully free"), prompt: t("Convert this member to fully free-form RPGLE. Start the result with **FREE, use dcl-f/dcl-s/dcl-ds/dcl-proc, keep every comment, and change no behaviour. Point out anything that has no free-form equivalent instead of inventing one."), attach: true },
  { name: "/sql", hint: t("write it as Db2 for i SQL"), prompt: t("Write this as Db2 for i SQL. Qualify the objects, use FETCH FIRST rather than LIMIT, and say which library list the unqualified names would resolve against."), attach: true },
  { name: "/dds", hint: t("explain this DDS"), prompt: t("Explain this DDS member: the record formats, the key fields, the keywords that change behaviour, and anything that would surprise someone reading it for the first time."), attach: true },
];

/**
 * `/compact` cannot be switched off.
 *
 * It is not a prompt, it is a control over the conversation's own size — like the send button. A
 * user who has disabled every skill still needs to be able to compact, and hiding the control that
 * relieves a full context is the one case where "total control of the tool" would work against the
 * person exercising it.
 */
export const ALWAYS_ON = new Set(["/compact"]);

/**
 * Whether a skill is on.
 *
 * The stored list holds what is DISABLED rather than what is enabled, and that asymmetry is
 * deliberate: a skill added by a future version, or by a colleague committing a file, is on by
 * default. Storing the enabled set instead would mean every new skill arrives switched off and
 * invisible, which is how a feature ships and nobody ever sees it.
 */
export function isSkillEnabled(name: string, disabled: string[]): boolean {
  if (ALWAYS_ON.has(name)) return true;
  return !disabled.includes(name);
}

/** The stored list after a toggle. Kept sorted and unique so the setting file stays readable. */
export function toggleSkill(disabled: string[], name: string, enabled: boolean): string[] {
  if (ALWAYS_ON.has(name)) return disabled;
  const set = new Set(disabled);
  if (enabled) set.delete(name);
  else set.add(name);
  return [...set].sort();
}

/**
 * A repository skill's invocation name.
 *
 * Defined once because it is a join key: the panel's toggle, the stored setting and the prompt the
 * model receives all have to agree on how a skill named `review-rpg` in a file is spelled in a
 * list. They disagreed at first, and the symptom was a toggle that appeared to do nothing.
 */
export function skillInvocation(name: string): string {
  return name.startsWith("/") ? name : `/${name}`;
}
