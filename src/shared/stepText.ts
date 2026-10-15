// What a tool said, in the reader's language — for display only.
//
// ⚠️ « dans les réponses il continue de basculer entre les langues ». Measured: the model's own text
// stayed in the user's language (16 of 16 final steps replayed, every paragraph French). What switched
// was what the PANEL printed between its sentences — the first line of each tool result, "Edited
// public/guilde.js.", "No diagnostics.", "exit code 0" — which is written in English for the MODEL
// and was shown to the user as it stood. The model still reads it in English; the step list shows it
// translated. Anything not recognised here is data (a path, a match, a log line) and stays as it is.

import { t } from "./i18n.js";

const KNOWN: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Edited (.+)\.$/, (m) => t("Edited {0}.", m[1]!)],
  [/^Wrote (.+) \((\d+) lines\)\.$/, (m) => t("Wrote {0} ({1} lines).", m[1]!, m[2]!)],
  [/^Wrote (.+)\.$/, (m) => t("Wrote {0}.", m[1]!)],
  [/^No diagnostics\.$/, () => t("No diagnostics.")],
  [/^exit code (\d+)$/, (m) => t("exit code {0}", m[1]!)],
  [/^timed out and was killed$/, () => t("timed out and was killed")],
  [/^Plan updated \((\d+)\/(\d+) done\)\.$/, (m) => t("Plan updated ({0}/{1} done).", m[1]!, m[2]!)],
  [/^\(no match\)$/, () => t("(no match)")],
  [/^\(the tool returned nothing\)$/, () => t("(the tool returned nothing)")],
  [/^The user rejected the change after review/, () => t("The user rejected the change.")],
  [/^The editor refused the edit/, () => t("The editor refused the edit.")],
  [/^Cancelled by the user\./, () => t("Cancelled by the user.")],
  [/^Noted for the user\./, () => t("Noted for the user.")],
];

export function stepText(summary: string): string {
  for (const [pattern, say] of KNOWN) {
    const m = summary.match(pattern);
    if (m) return say(m);
  }
  return summary;
}
