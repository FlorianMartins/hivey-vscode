// What a terminal actually wrote, once the terminal's own furniture is removed.
//
// VS Code's shell integration hands back the RAW stream: colour codes, cursor moves, hyperlinks,
// the shell's own OSC 633 markers, the prompt it redraws afterwards, and every intermediate frame
// of a progress bar. Handing that to a model is worse than handing it nothing — several hundred
// tokens of escape sequences around the twelve characters that matter, and a model that starts
// quoting `[2K` back at the user.
//
// So this module is the whole difference between "the command was started" and "the tests failed
// on line 42". It is pure text in, pure text out, and it lives in `core` rather than in the tool
// because that is what makes it testable: a fixture recorded from a real shell replays here with
// no editor, no terminal and no platform.

/**
 * Every escape sequence a shell emits, in one expression.
 *
 * Ordered longest-first: OSC and DCS carry a payload terminated by BEL or ST, and matching the
 * two-character forms first would cut them in half and leave the payload as text — which is how
 * a window title or a shell-integration marker ends up quoted in an answer.
 */
const ESCAPES = new RegExp(
  [
    // OSC — window title, hyperlinks (OSC 8), and VS Code's own shell integration (OSC 633).
    "\\u001b\\][\\s\\S]*?(?:\\u0007|\\u001b\\\\|$)",
    // DCS, SOS, PM, APC — same shape, different introducer.
    "\\u001b[P^_X][\\s\\S]*?(?:\\u0007|\\u001b\\\\|$)",
    // CSI — colours, cursor moves, erase-line. Parameters, then intermediates, then a final byte.
    "\\u001b\\[[0-?]*[ -/]*[@-~]",
    // Two- and three-character escapes: charset selection, save/restore cursor, reverse index.
    "\\u001b[()#][0-9A-Za-z]",
    "\\u001b[0-9A-Za-z=><]",
  ].join("|"),
  "g",
);

/**
 * Colour codes, cursor moves and shell markers removed; the text itself untouched.
 *
 * The second pass drops the control characters that are NOT part of a sequence — a bare bell, a
 * stray NUL from a program writing binary to stdout — while keeping tab, newline and the carriage
 * return that `applyCarriageReturns` still needs.
 */
export function stripAnsi(text: string): string {
  return text.replace(ESCAPES, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/**
 * A carriage return means "write the rest of this line over what is already there".
 *
 * Which is how every progress bar works — `npm install` and `pip` and `cargo` all redraw one line a
 * hundred times a second. Keeping the frames would spend a thousand tokens showing a bar nobody can
 * see; keeping only the last segment of each line shows what the bar ENDED at, which is the one
 * frame that carries information.
 */
function applyCarriageReturns(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const parts = line.split("\r");
      // A trailing \r leaves an empty last segment; the frame before it is the visible one.
      while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
      return parts[parts.length - 1] ?? "";
    })
    .join("\n");
}

export interface CleanOptions {
  /** The command as it was sent, so its echo is not returned as though it were output. */
  command?: string;
}

/**
 * The readable output of one command.
 *
 * Three removals, each for a thing that is present in every real capture and means nothing to a
 * reader: the escape sequences, the intermediate frames of anything that redraws a line, and the
 * shell's echo of the command itself — which the model already knows, having just asked for it.
 */
export function cleanTerminalOutput(raw: string, opts: CleanOptions = {}): string {
  let text = applyCarriageReturns(stripAnsi(raw).replace(/\r\n/g, "\n"));
  const lines = text.split("\n");
  const command = opts.command?.trim();
  // Only the FIRST line, and only if it is exactly the command: a test whose output happens to
  // contain the command line is quoting it for a reason.
  if (command && lines[0]?.trim() === command) lines.shift();
  text = lines
    .map((l) => l.replace(/[ \t]+$/, ""))
    // Three blank lines in a row is a rendering artefact, never a message.
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/**
 * Cut to a budget, keeping the END.
 *
 * A failing build prints its summary last, and a passing one prints nothing worth reading first.
 * The cut is announced rather than silent — a model handed a truncated log with no marker will
 * conclude the earlier steps did not happen.
 */
export function tailOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const kept = text.slice(-maxChars);
  // Start at a line boundary: half a line reads as corrupted output rather than as a cut.
  const nl = kept.indexOf("\n");
  const body = nl >= 0 && nl < 200 ? kept.slice(nl + 1) : kept;
  return `…(${text.length - body.length} earlier characters omitted)\n${body}`;
}

export interface CommandOutcome {
  output: string;
  /** `undefined` when the shell reported no code — which is not the same as success. */
  exitCode?: number;
  /** True when the command was still running when the budget ran out. */
  timedOut?: boolean;
}

/**
 * What the model is told, in the words that make it act.
 *
 * The exit code first, because it is the answer to "did that work" and a model reading a long log
 * to infer it will sometimes infer wrong. An exit code the shell did not report is stated as
 * unknown rather than assumed to be zero: shell integration misbehaving, a sub-shell, or the user
 * pressing ctrl+c all land here, and none of them means the build passed.
 */
export function describeOutcome(outcome: CommandOutcome, maxChars = 4000): string {
  const head = outcome.timedOut
    ? "timed out and was killed"
    : outcome.exitCode === undefined
      ? "finished, but the shell reported no exit code (treat this as unproven, not as success)"
      : outcome.exitCode === 0
        ? "exit code 0"
        : `exit code ${outcome.exitCode}`;
  const body = tailOutput(outcome.output, maxChars);
  return `${head}\n${body || "(no output)"}`;
}
