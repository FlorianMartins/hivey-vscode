// What an edit tells the model about its own result.
//
// `edit_file` returned `"Edited src/app.ts."` — and nothing else. The model had just changed a file
// and the only way to learn whether it still compiled was to CHOOSE to call `get_diagnostics`. A
// model that forgets, or that is confident, walks away from a syntax error it made three steps
// earlier; and the editor knew about it the whole time.
//
// So an edit carries the editor's own errors for that file. The language server is already running,
// already parsing on change, and already right about the language — none of which a model's opinion
// of its own diff can claim.
//
// Two rules, and the second is the one that matters:
//
//   • ERRORS ONLY. Not warnings, not hints. A warning is a style opinion and would make every edit
//     noisy, which is how a signal becomes furniture. An error means the file is broken NOW, which
//     is the one thing the model must not walk away from.
//   • SILENCE WHEN THERE ARE NONE. Nothing is appended rather than "no problems found". A language
//     server debounces: an empty list a few milliseconds after an edit means "it has not answered
//     yet" just as often as it means "it is fine", and the two are not the same claim. Saying
//     nothing costs no tokens and asserts nothing — and the project's own rule is that an absence is
//     never reported as a zero.

export interface EditProblem {
  line: number;
  message: string;
}

/** At most this many, and the message is cut: this rides on every edit of a broken file. */
export const MAX_PROBLEMS = 8;
const MAX_MESSAGE = 160;

/**
 * The line appended to an edit's result, or nothing.
 *
 * @param path the file, as the model named it.
 * @param errors what the editor reports for that file, errors only, already filtered by the caller.
 */
export function editProblems(path: string, errors: EditProblem[]): string {
  if (!errors.length) return "";
  const shown = errors.slice(0, MAX_PROBLEMS);
  const lines = shown.map((e) => `  ${path}:${e.line} ${clip(e.message)}`);
  const more = errors.length - shown.length;
  return [
    `The editor now reports ${errors.length} error(s) in ${path}:`,
    ...lines,
    ...(more > 0 ? [`  …and ${more} more.`] : []),
    "Fix these before you finish.",
  ].join("\n");
}

function clip(message: string): string {
  const one = message.replace(/\s+/g, " ").trim();
  return one.length > MAX_MESSAGE ? `${one.slice(0, MAX_MESSAGE - 1)}…` : one;
}
