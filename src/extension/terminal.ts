// Running a command and reading what it printed.
//
// This is the loop the whole agent rests on. "Edit, run the tests, read the failure, fix it" is
// what separates an assistant that works from one that guesses, and until now the editor could
// only do the first half: `run_command` started a command in the user's terminal and returned the
// sentence "ask them what it printed". Every turn that needed the answer spent a round trip through
// a human, and most of them simply asserted success instead.
//
// VS Code's shell integration gives back the stream and the exit code — but only when it is
// ACTIVE, which depends on the shell, the platform and the user's own configuration. That is why
// the old comment in `tools.ts` said it could not be done reliably, and it was half right: it
// cannot be done ALWAYS. It can be done usually, and the rest of the time the honest thing is to
// say so rather than to invent an exit code. Hence one function with two outcomes, and a model that
// is told which one it got.

import * as vscode from "vscode";
import { t } from "../shared/i18n.js";
import { cleanTerminalOutput, describeOutcome } from "../core/terminal/output.js";

/** The name is the contract: one terminal, reused, so only the first command waits for the shell. */
export const TERMINAL_NAME = "Hivey Code";

/**
 * How long to wait for shell integration before giving up on it.
 *
 * A fresh terminal takes a moment: the shell has to start and source VS Code's script. Reusing one
 * terminal means only the first command of a session ever pays this. Three seconds is the value
 * VS Code's own documentation uses in its fallback example.
 */
const INTEGRATION_TIMEOUT_MS = 3000;

/** Beyond this the log is cut, keeping the end. Tool output is re-sent on every later step. */
const MAX_OUTPUT_CHARS = 8000;

/** What a person presses to stop a runaway build. There is no API that kills one. */
const CTRL_C = "\u0003";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export interface RunResult {
  /** What the model is told. Already cut to a budget and free of escape sequences. */
  content: string;
  isError: boolean;
  /** False when shell integration was not available and the output could not be read. */
  captured: boolean;
  exitCode?: number;
}

/**
 * The terminal this extension runs commands in, reused across a session.
 *
 * Reused rather than created per command for two reasons that are both about the user: a new panel
 * per command buries the editor under tabs, and shell integration would have to warm up every time,
 * so every command would pay the three-second wait instead of the first one.
 */
function terminalFor(cwd: string | undefined): vscode.Terminal {
  const existing = vscode.window.terminals.find((term) => term.name === TERMINAL_NAME && term.exitStatus === undefined);
  return existing ?? vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
}

/**
 * Wait for the shell to announce itself, or decide it is not going to.
 *
 * `terminal.shellIntegration` is undefined until VS Code's script has run inside the shell, and it
 * is undefined FOREVER on a shell that has no integration script (an unusual shell, a container
 * without the injection, a user who switched it off). Both look identical for the first second,
 * which is why this waits rather than checks.
 */
function waitForShellIntegration(terminal: vscode.Terminal, timeoutMs: number): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(undefined);
    }, timeoutMs);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((ev) => {
      if (ev.terminal !== terminal) return;
      clearTimeout(timer);
      sub.dispose();
      resolve(ev.shellIntegration);
    });
  });
}

export interface RunOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Progress line for the panel, so a two-minute build is not a spinner. */
  report?(message: string): void;
}

/**
 * Run a command in the user's terminal and, when the shell allows it, return what it printed.
 *
 * The command runs in the terminal the user can see either way. That is not a limitation to work
 * around: a command that runs invisibly in a hidden process is a command nobody can interrupt, and
 * the approval the user gave was to a command they would watch.
 */
export async function runCommandInTerminal(opts: RunOptions): Promise<RunResult> {
  const command = opts.command;
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const terminal = terminalFor(opts.cwd);
  terminal.show(true);

  const integration = await waitForShellIntegration(terminal, INTEGRATION_TIMEOUT_MS);
  if (!integration) {
    // The honest branch. The command still runs and the user still sees it; what is missing is the
    // reading, and saying so is what stops the model from inventing a result. This is the whole of
    // the old behaviour, kept for the shells that cannot do better.
    terminal.sendText(command, true);
    opts.report?.(t("started: {0}", command));
    return {
      captured: false,
      isError: false,
      content:
        "The command was started in the user's terminal, but this shell has no integration so its " +
        "output could not be read. Ask the user what it printed, or use get_diagnostics for " +
        "compiler errors. Do not assume it succeeded.",
    };
  }

  let execution: vscode.TerminalShellExecution;
  try {
    execution = integration.executeCommand(command);
  } catch {
    // Task terminals refuse this. Same honesty as above rather than a failed turn.
    terminal.sendText(command, true);
    opts.report?.(t("started: {0}", command));
    return {
      captured: false,
      isError: false,
      content: "The command was started in the user's terminal; its output could not be read. Ask the user what it printed.",
    };
  }

  opts.report?.(`$ ${command}`);

  // `read()` must be called immediately — the stream only carries what is written after the first
  // call, so anything awaited before this line is output nobody will ever see.
  const stream = execution.read();

  let raw = "";
  const collect = (async () => {
    for await (const chunk of stream) {
      raw += chunk;
      // Keep twice the budget while collecting: the cut happens once, at the end, on clean text.
      if (raw.length > MAX_OUTPUT_CHARS * 4) raw = raw.slice(-MAX_OUTPUT_CHARS * 4);
    }
  })();

  // One race, three ways out, and every listener disposed on the way — a ten-minute timer left
  // running holds the extension host awake long after the turn it belonged to has ended, and a
  // subscription per command accumulates one listener per command for the life of the window.
  let endSub: vscode.Disposable | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  // Held in an object rather than a `let`, because every assignment below happens inside a callback
  // the compiler cannot see into: a plain variable narrows to its initial value and the two checks
  // after the await become "always false".
  const race: { outcome: "ended" | "timeout" | "cancelled" } = { outcome: "ended" };

  const exitCode = await new Promise<number | undefined>((resolve) => {
    endSub = vscode.window.onDidEndTerminalShellExecution((ev) => {
      if (ev.execution !== execution) return;
      race.outcome = "ended";
      resolve(ev.exitCode);
    });
    timer = setTimeout(() => {
      race.outcome = "timeout";
      resolve(undefined);
    }, timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) {
        race.outcome = "cancelled";
        resolve(undefined);
      } else {
        onAbort = () => {
          race.outcome = "cancelled";
          resolve(undefined);
        };
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  }).finally(() => {
    endSub?.dispose();
    if (timer) clearTimeout(timer);
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
  });

  const timedOut = race.outcome === "timeout";
  const cancelled = race.outcome === "cancelled";

  if (timedOut || cancelled) {
    // ^C, because the alternative is a build that goes on spending the user's laptop after the turn
    // they started it for has ended. There is no API to kill a shell command; this is what a person
    // would press.
    terminal.sendText(CTRL_C, false);
  }
  // Give the stream a moment to deliver what was written just before the end, then stop waiting for
  // it: a stream that never closes must not hold the turn open.
  await Promise.race([collect, new Promise((r) => setTimeout(r, 250))]);

  const output = cleanTerminalOutput(raw, { command });
  if (cancelled) {
    return { captured: true, isError: true, exitCode: undefined, content: `Cancelled by the user.\n${output}`.trim() };
  }
  const content = describeOutcome({ output, exitCode, timedOut }, MAX_OUTPUT_CHARS);
  return {
    captured: true,
    // An unknown exit code is not a failure to report to the user, but it is not a success the
    // model may build on either — `describeOutcome` says so in words the model reads.
    isError: timedOut || (exitCode !== undefined && exitCode !== 0),
    exitCode,
    content,
  };
}
