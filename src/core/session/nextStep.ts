// The next request, suggested — as Claude Code does.
//
// « Claude Code fait ce qu'on lui demande et ensuite il propose une suggestion de la prochaine action
// pour éviter de tout traiter d'un coup ». The agent is told to do what was asked and only that (see
// SCOPE_RULE in core/prompts.ts); what it noticed beyond it becomes ONE short request, shown greyed
// in the empty composer, that Tab turns into the user's next message.
//
// Written by a separate, small request once the turn is over — thinking off, a few dozen tokens —
// rather than by the agent inside its answer: a marker in the answer would stream onto the screen
// before it could be taken out, and would cost the answer its focus.

import type { ChatMessage } from "../providers/types.js";

const NEXT_STEP_PROMPT = `You suggest the user's next request to a coding assistant that has just finished a task.

Read the request and what the assistant answered. Reply with ONE short request the user is likely to
want next — a natural follow-up: something the assistant mentioned but did not do, the obvious check
or test, the next piece of the same work. Write it as the user would type it: imperative, specific,
at most 15 words, no quotes, no preamble.

If nothing useful follows — the task is complete and nothing was left open — reply with exactly: NONE`;

/** The request for a suggestion. Long answers are cut from the middle: the end says what is left. */
export function nextStepMessages(question: string, answer: string, language: "en" | "fr"): ChatMessage[] {
  const cut = (text: string, max: number): string =>
    text.length <= max ? text : `${text.slice(0, max / 2)}\n[…]\n${text.slice(-max / 2)}`;
  return [
    { role: "system", content: NEXT_STEP_PROMPT },
    {
      role: "user",
      content:
        `Request:\n${cut(question.trim(), 2000)}\n\nAnswer:\n${cut(answer.trim(), 4000)}\n\n` +
        `Write the suggestion in ${language === "fr" ? "French" : "English"}.`,
    },
  ];
}

/** The suggestion in a reply, or nothing. Shown in the composer, so it is kept to one line. */
export function parseNextStep(reply: string): string | undefined {
  const line = reply
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return undefined;
  const clean = line
    .replace(/^(next( step)?|suggestion|prochaine (étape|demande))\s*:\s*/i, "")
    .replace(/^[-*•>\d.)\s]+/, "")
    .replace(/^["'«“`]+|["'»”`]+$/g, "")
    .trim();
  if (!clean || /^none\.?$/i.test(clean) || clean.length < 4) return undefined;
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
}
