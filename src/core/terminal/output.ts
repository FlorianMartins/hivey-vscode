// What a terminal actually wrote, once the terminal's own furniture is removed.
//
// VS Code's shell integration hands back the RAW stream: color codes, cursor moves, hyperlinks,
// the shell's own OSC 633 markers, the prompt it redraws afterwards, and every intermediate frame
// of a progress bar. Handing that to a model is worse than handing it nothing — several hundred
// tokens of escape sequences around the twelve characters that matter, and a model that starts
// quoting `ESC[2K` back at the user.
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
    // CSI — colors, cursor moves, erase-line. Parameters, then intermediates, then a final byte.
    "\\u001b\\[[0-?]*[ -/]*[@-~]",
    // Two- and three-character escapes: charset selection, save/restore cursor, reverse index.
    "\\u001b[()#][0-9A-Za-z]",
    "\\u001b[0-9A-Za-z=><]",
  ].join("|"),
  "g",
);

/**
 * Color codes, cursor moves and shell markers removed; the text itself untouched.
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
  /** The question it stopped on, when it was stopped for waiting on an answer — see `waitingForInput`. */
  askedFor?: string;
}

/**
 * The question a command is stopped on, waiting for somebody to type — or undefined.
 *
 * ⚠️ « une commande qui attend une saisie bloque le tour ». Nothing can be typed into a command the
 * agent runs, so `npx` asking "Ok to proceed? (y)", a script asking for a password or "Press any key"
 * held the turn until the timeout — two minutes — and the model was then told it had TIMED OUT, which
 * it read as "too slow" and ran again with a longer timeout. Only the last line counts, and only these
 * shapes: a silent build ending on "Compiling…" must never be taken for a question.
 */
export function waitingForInput(output: string): string | undefined {
  const last = stripAnsi(output).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1);
  if (!last) return undefined;
  const asks =
    /\((y|yes)\/(n|no)\)|\[(y\/n|Y\/n|y\/N|yes\/no)\]|\(y\)\s*$|\?\s*$|\bpass(word|phrase)\b[^\n]*:\s*$|\bpress (any key|enter|return)\b|\b(username|login|token|otp)\b[^\n]*:\s*$/i;
  return asks.test(last) ? last.slice(-200) : undefined;
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
  if (outcome.askedFor !== undefined) {
    return (
      `stopped: it was waiting for an answer to « ${outcome.askedFor} », and nothing can be typed into a command run here. ` +
      `Run it again with the answer on the command line — a flag such as \`--yes\`, \`-y\`, \`--no-input\` or \`--force\`, ` +
      `or \`echo y | …\` — or tell the user it needs them.\n${tailOutput(outcome.output, maxChars) || "(no output)"}`
    );
  }
  // ⚠️ « il bloque sur le même souci pendant 1 h ». "Timed out" read as "too slow": the model ran the
  // same tests again with a longer timeout, ten minutes at a time, for an hour. A test run that does not
  // end is almost always one that never CAN — said, with where to look.
  const head = outcome.timedOut
    ? "timed out and was killed. Running it again with a longer timeout rarely helps: a test run or script that " +
      "does not finish usually never will — a promise that never settles, a timer or interval left running, a " +
      "server or connection never closed, a watch mode. Find what keeps it alive (run one test file alone, add a " +
      "per-test timeout such as `--test-timeout=5000`) instead of waiting longer."
    : outcome.exitCode === undefined
      ? "finished, but the shell reported no exit code (treat this as unproven, not as success)"
      : outcome.exitCode === 0
        ? "exit code 0"
        : `exit code ${outcome.exitCode}`;
  const body = tailOutput(outcome.output, maxChars);
  return `${head}\n${body || "(no output)"}`;
}

/**
 * Commands whose non-zero exit is an ANSWER rather than a failure.
 *
 * ⚠️ Part of why "many ... run command ... fail". `grep` exits 1 when it finds nothing,
 * which is a perfectly good answer to "is this used anywhere?" — and the step was drawn as a failure,
 * the model was told the tool errored, and `verifyTurn` counted a check that had failed. Three
 * different wrong conclusions from one correct command.
 *
 * The same reasoning already exists one layer up, in `router/outcome.ts`, where a non-zero exit only
 * counts as evidence when the command was plausibly a CHECK — and its comment lists these very
 * examples. What was missing is that the TOOL still called them errors.
 *
 * Deliberately a short, explicit list rather than "anything that is not a build". A failed `mkdir`,
 * `cp` or `npm install` must stay an error, and the way to be sure of that is to name the exceptions
 * instead of guessing at the rule.
 */
// ⚠️ The boundary is a COMMAND boundary, not whitespace, and that distinction is load-bearing:
// `npm test` contains the word `test` after a space, so a whitespace boundary made a failing test
// suite look like "no match" — the most harmful possible false positive, since it is the one case
// where the model most needs to be told the work is not finished. A command starts at the beginning
// of the line or after `;`, `&&`, `||`, `|` or `(`.
const COMMAND_START = "(?:^|[;|(]\\s*|&&\\s*|\\|\\|\\s*)";
const STATUS_ANSWER = new RegExp(
  `${COMMAND_START}(?:grep|egrep|fgrep|rg|ag|ack|test|\\[|which|type|hash|cmp|diff|git\\s+grep|git\\s+diff\\s+--(?:quiet|exit-code))\\b`,
);

/**
 * Does this exit code mean "no" rather than "something went wrong"?
 *
 * Only exit 1, and only for those commands. `grep` uses 2 for a real failure — an unreadable file, a
 * bad pattern — and conflating the two would hide actual errors behind "no match", which is the
 * mistake this function exists to avoid making in the other direction.
 */
export function isStatusAnswer(command: string, exitCode: number | undefined): boolean {
  if (exitCode !== 1) return false;
  return STATUS_ANSWER.test(command);
}
