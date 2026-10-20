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
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { t } from "../shared/i18n.js";
import { cleanTerminalOutput, describeOutcome, isStatusAnswer, tailOutput, waitingForInput } from "../core/terminal/output.js";
import { scaledChars } from "../core/context/scale.js";

/** The name is the contract: one terminal, reused, so only the first command waits for the shell. */
export const TERMINAL_NAME = "Hivey Code";

/**
 * The terminal that shows what commands run as processes print (see `runCommandAsProcess`). A name
 * of its own: the editor restores terminals across reloads, and one restored under `TERMINAL_NAME`
 * was taken for the shell terminal — which has integration, and that one never will.
 */
export const PROCESS_TERMINAL_NAME = t("Hivey Code (commands)");

/**
 * How long to wait for shell integration before giving up on it.
 *
 * A fresh terminal takes a moment: the shell has to start and source VS Code's script. Reusing one
 * terminal means only the first command of a session ever pays this. Three seconds is the value
 * VS Code's own documentation uses in its fallback example.
 */
// How long to wait for the shell to announce itself.
//
// ⚠️ This was a flat 3 s and it was the reason "many run command ... fail". VS Code's
// integration script runs inside the shell's own startup, so on the FIRST terminal of a session it
// lands after the user's profile does — and a real profile is not fast: oh-my-zsh, powerlevel10k,
// nvm, a Windows PowerShell profile, WSL. Miss the window and the command still runs but its output
// cannot be read, so the model is told "do not assume it succeeded" and can verify nothing. For the
// whole session, because every later command re-ran the same three-second race.
//
// So a terminal this extension just created gets a generous window — paid once, and only when
// nothing is warm yet — while one that already existed gets a short one, since integration that has
// not arrived by then is usually a shell that has none.
const INTEGRATION_TIMEOUT_FRESH_MS = 15_000;
const INTEGRATION_TIMEOUT_WARM_MS = 3000;

/** Beyond this the log is cut, keeping the end. Tool output is re-sent on every later step. */
const MAX_OUTPUT_CHARS = 8000;
/**
 * The share of the window one command's output may take — its END, where a test run says what failed
 * and how many. It was 15 %: a whole test suite's listing, 2 147 lines of "ok", reached the model.
 */
const OUTPUT_SHARE = 0.03;

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
  /**
   * What the command printed, cleaned, for the PANEL — the command's step row opens on it (see
   * `toolRow` in the webview). Not what the model reads: that is `content`.
   */
  output?: string;
}

/**
 * How much of a command's output the panel keeps on its step: the END of it, where a failure is.
 * Saved with the conversation, so it is bounded — a turn can run fifty commands.
 */
export const DISPLAY_OUTPUT_CHARS = 4000;

/** The end of what a command printed, short enough to be saved with the step that ran it. */
export function displayOutput(output: string): string {
  const text = output.replace(/\s+$/, "");
  return text.length > DISPLAY_OUTPUT_CHARS ? `…\n${text.slice(-DISPLAY_OUTPUT_CHARS)}` : text;
}

/**
 * The terminal this extension runs commands in, reused across a session.
 *
 * Reused rather than created per command for two reasons that are both about the user: a new panel
 * per command buries the editor under tabs, and shell integration would have to warm up every time,
 * so every command would pay the three-second wait instead of the first one.
 */
function terminalFor(cwd: string | undefined): { terminal: vscode.Terminal; fresh: boolean } {
  // Never the one that shows processes' output (see `runCommandAsProcess`): same name, no shell in it.
  const existing = vscode.window.terminals.find(
    (term) => term.name === TERMINAL_NAME && term.exitStatus === undefined && term !== processView?.terminal,
  );
  if (existing) return { terminal: existing, fresh: false };
  return { terminal: vscode.window.createTerminal({ name: TERMINAL_NAME, cwd }), fresh: true };
}

/**
 * Terminals already found to have no integration.
 *
 * So a shell that will never announce itself is not raced again on every command. Keyed by the
 * terminal object, which is the identity VS Code itself uses, and holding no strong opinion: the
 * live `terminal.shellIntegration` is still read first, because integration can arrive late and a
 * remembered "no" must not outlive the truth.
 */
const noIntegration = new WeakSet<vscode.Terminal>();

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
  const { terminal, fresh } = terminalFor(opts.cwd);
  terminal.show(true);

  // The live property first: integration can arrive at any time, so a remembered "no" is only ever
  // a reason to skip the WAIT, never a reason to skip the check.
  const integration =
    terminal.shellIntegration ??
    (noIntegration.has(terminal)
      ? undefined
      : await waitForShellIntegration(terminal, fresh ? INTEGRATION_TIMEOUT_FRESH_MS : INTEGRATION_TIMEOUT_WARM_MS));
  if (!integration) noIntegration.add(terminal);
  if (!integration) {
    // The honest branch. The command still runs and the user still sees it; what is missing is the
    // reading, and saying so is what stops the model from inventing a result. This is the whole of
    // the old behavior, kept for the shells that cannot do better.
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
      if (raw.length > scaledChars(MAX_OUTPUT_CHARS, OUTPUT_SHARE) * 4) raw = raw.slice(-scaledChars(MAX_OUTPUT_CHARS, OUTPUT_SHARE) * 4);
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
    return { captured: true, isError: true, exitCode: undefined, content: `Cancelled by the user.\n${output}`.trim(), output: displayOutput(output) };
  }
  const content = describeOutcome({ output, exitCode, timedOut }, scaledChars(MAX_OUTPUT_CHARS, OUTPUT_SHARE));
  // `grep` exiting 1 found nothing, which is an answer. See `isStatusAnswer`: the step is not drawn
  // as a failure, the model is not told the tool errored, and `verifyTurn` does not count a check
  // that failed — three wrong conclusions that used to come from one correct command.
  const answered = isStatusAnswer(command, exitCode);
  return {
    captured: true,
    // An unknown exit code is not a failure to report to the user, but it is not a success the
    // model may build on either — `describeOutcome` says so in words the model reads.
    isError: timedOut || (exitCode !== undefined && exitCode !== 0 && !answered),
    exitCode,
    content: answered ? `${content}\n(exit 1 from this command means "no match" or "not found", not an error.)` : content,
    output: displayOutput(output),
  };
}

// ── Running a command as a process ─────────────────────────────────────────────────────────────

/**
 * ⚠️ « il corrige et ensuite dit que ce n'est pas bon » — on Windows, a real session's commands came
 * back "exit code 0" with nothing in them, and the model went on to write its results into files to
 * be able to read them, then lost its way. Shell integration on Windows PowerShell 5.1 is known to
 * hand back an empty stream, and every agent built on it reports the same symptom. A process whose
 * output is read from its own pipes does not depend on any of that: what it printed is what the
 * model reads, on every platform.
 *
 * The user still watches it — in the PANEL: « que les commandes ne nécessitent pas d'ouvrir le
 * terminal à chaque fois ». The command and what it printed are on its step row in the turn (see
 * `RunResult.output`), like the agent's other actions, and no terminal is brought forward. The
 * output is also copied into a terminal of its own, created without being shown: whoever opens it
 * sees the session's commands, and Ctrl+C there still stops the one running.
 */
/** How long a command may print nothing, its last line a question, before it is taken as waiting — see `waitingForInput`. */
const ASKING_IDLE_MS = 15_000;

/**
 * Told to every command the agent runs: there is nobody to answer. Version control asks for
 * credentials on the terminal and a pager waits for a key — both only ever hang here. Nothing that
 * changes what a command does when it does not ask (no `CI=1`: test runners and builds read it).
 */
const NO_PROMPTS: Record<string, string> = { GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", PAGER: "cat", DEBIAN_FRONTEND: "noninteractive" };

export async function runCommandAsProcess(opts: RunOptions): Promise<RunResult> {
  const command = opts.command;
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const view = processTerminal();
  view.write(`\r\n\x1b[2m${opts.cwd ?? ""}>\x1b[0m ${command}\r\n`);
  opts.report?.(`$ ${command}`);

  const windows = process.platform === "win32";
  let child: ChildProcess;
  try {
    child = spawn(command, {
      // ⚠️ Never the extension host's own directory — with no folder open that is wherever VS Code
      // was started, the repository in a test run: `npm test` there ran this project's suite. The
      // home directory, like the integrated terminal opens in.
      cwd: opts.cwd ?? homedir(),
      // cmd.exe on Windows, /bin/sh elsewhere — the shell the tool's description names.
      shell: true,
      windowsHide: true,
      // Its own process group, so a timeout stops what it started too (a server, a watcher).
      detached: !windows,
      // Nothing to type into: a command that asks a question gets an end of input, not a hang.
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...NO_PROMPTS },
    });
  } catch (err) {
    return { captured: true, isError: true, content: `could not start the command: ${(err as Error).message}` };
  }

  let raw = "";
  let lastOutputAt = Date.now();
  const limit = scaledChars(MAX_OUTPUT_CHARS, OUTPUT_SHARE) * 4;
  const take = (chunk: string): void => {
    lastOutputAt = Date.now();
    raw += chunk;
    if (raw.length > limit) raw = raw.slice(-limit);
    view.write(chunk.replace(/\r?\n/g, "\r\n"));
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);

  const race: { outcome: "ended" | "timeout" | "cancelled" | "failed" | "asking"; error?: string; askedFor?: string } = { outcome: "ended" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  let onAbort: (() => void) | undefined;
  const exitCode = await new Promise<number | undefined>((resolve) => {
    // `close`, not `exit`: by then both pipes are drained, so the last lines are in.
    child.on("close", (code) => resolve(code ?? undefined));
    child.on("error", (err) => {
      race.outcome = "failed";
      race.error = err.message;
      resolve(undefined);
    });
    timer = setTimeout(() => {
      race.outcome = "timeout";
      killTree(child);
      // A process that ignores the kill must not hold the turn: give up waiting shortly after.
      setTimeout(() => resolve(undefined), 3000);
    }, timeoutMs);
    // Stopped on a question — see `waitingForInput`. Silent AND ending on a question, never silent alone.
    watch = setInterval(() => {
      if (race.outcome !== "ended" || Date.now() - lastOutputAt < ASKING_IDLE_MS) return;
      const asked = waitingForInput(raw);
      if (asked === undefined) return;
      race.outcome = "asking";
      race.askedFor = asked;
      killTree(child);
      setTimeout(() => resolve(undefined), 3000);
    }, 1000);
    const stop = (): void => {
      race.outcome = "cancelled";
      killTree(child);
      setTimeout(() => resolve(undefined), 3000);
    };
    view.onInterrupt = stop;
    if (opts.signal?.aborted) stop();
    else if (opts.signal) {
      onAbort = stop;
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
  }).finally(() => {
    if (timer) clearTimeout(timer);
    if (watch) clearInterval(watch);
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    view.onInterrupt = undefined;
  });

  const output = cleanTerminalOutput(raw);
  if (race.outcome === "failed") {
    view.write(`\r\n\x1b[31m${race.error}\x1b[0m\r\n`);
    return { captured: true, isError: true, content: `could not run the command: ${race.error}\n${output}`.trim(), output: displayOutput(output) };
  }
  if (race.outcome === "cancelled") {
    view.write(`\r\n\x1b[2m^C\x1b[0m\r\n`);
    return { captured: true, isError: true, exitCode: undefined, content: `Cancelled by the user.\n${output}`.trim(), output: displayOutput(output) };
  }
  if (race.outcome === "asking") {
    view.write(`\r\n\x1b[2m${t("stopped: it was waiting for an answer")}\x1b[0m\r\n`);
    const content = describeOutcome({ output, askedFor: race.askedFor }, scaledChars(MAX_OUTPUT_CHARS, OUTPUT_SHARE));
    return { captured: true, isError: true, exitCode: undefined, content, output: displayOutput(output) };
  }
  const timedOut = race.outcome === "timeout";
  view.write(`\r\n\x1b[2m${timedOut ? t("timed out and was killed") : `exit ${exitCode ?? "?"}`}\x1b[0m\r\n`);
  const content = describeOutcome({ output, exitCode, timedOut }, scaledChars(MAX_OUTPUT_CHARS, OUTPUT_SHARE));
  const answered = isStatusAnswer(command, exitCode);
  return {
    captured: true,
    isError: timedOut || (exitCode !== undefined && exitCode !== 0 && !answered),
    exitCode,
    content: answered ? `${content}\n(exit 1 from this command means "no match" or "not found", not an error.)` : content,
    output: displayOutput(output),
  };
}

// ── In the background ─────────────────────────────────────────────────────────────────────────
//
// ⚠️ « je veux que l'extension travaille comme Claude Code » — Claude Code starts a server, a watcher or
// a bot in the background, goes on working, then reads what it printed or stops it. Here such a command
// was cut at its timeout, so the agent could not run the very thing it was building and look at it.

interface BackgroundCommand {
  command: string;
  child: ChildProcess;
  output: string;
  /** How much of `output` the model has already read. */
  read: number;
  exitCode?: number;
  done: boolean;
}

const background = new Map<string, BackgroundCommand>();
let backgroundCount = 0;
/** What a background command keeps of its output: its latest part. */
const BACKGROUND_KEEP_CHARS = 200_000;

/** Start a command and leave it running; what it printed in its first seconds comes back now. */
export async function startInBackground(opts: { command: string; cwd?: string; firstMs?: number }): Promise<RunResult> {
  const id = `bg-${++backgroundCount}`;
  const view = processTerminal();
  view.write(`\r\n\x1b[2m${opts.cwd ?? ""}> (${id}, background)\x1b[0m ${opts.command}\r\n`);
  let child: ChildProcess;
  try {
    child = spawn(opts.command, {
      cwd: opts.cwd ?? homedir(),
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...NO_PROMPTS },
    });
  } catch (err) {
    return { captured: true, isError: true, content: `could not start the command: ${(err as Error).message}` };
  }
  const job: BackgroundCommand = { command: opts.command, child, output: "", read: 0, done: false };
  background.set(id, job);
  const take = (chunk: string): void => {
    job.output += chunk;
    if (job.output.length > BACKGROUND_KEEP_CHARS) {
      const cut = job.output.length - BACKGROUND_KEEP_CHARS;
      job.output = job.output.slice(cut);
      job.read = Math.max(0, job.read - cut);
    }
    view.write(chunk.replace(/\r?\n/g, "\r\n"));
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  const ended = new Promise<void>((resolve) => {
    child.on("close", (code) => {
      job.exitCode = code ?? undefined;
      job.done = true;
      view.write(`\r\n\x1b[2m(${id}) exit ${code ?? "?"}\x1b[0m\r\n`);
      resolve();
    });
    child.on("error", (err) => {
      job.output += `\n${err.message}`;
      job.done = true;
      resolve();
    });
  });
  await Promise.race([ended, new Promise((r) => setTimeout(r, opts.firstMs ?? 3000))]);
  const first = readBackground(id);
  return job.done
    ? { captured: true, isError: job.exitCode !== 0, exitCode: job.exitCode, content: `It finished at once (${id}).\n${first.content}`, output: displayOutput(cleanTerminalOutput(job.output)) }
    : { captured: true, isError: false, content: `Started in the background as ${id} — it keeps running. Read what it prints with command_output({ id: "${id}" }), stop it with stop_command({ id: "${id}" }). Its first output:\n${first.content}`, output: displayOutput(cleanTerminalOutput(job.output)) };
}

/** What a background command printed since it was last read, and whether it still runs. */
export function readBackground(id: string): RunResult {
  const job = background.get(id);
  if (!job) return { captured: true, isError: true, content: `No background command ${id}. Running: ${[...background.keys()].join(", ") || "none"}.` };
  const fresh = cleanTerminalOutput(job.output.slice(job.read));
  job.read = job.output.length;
  const state = job.done ? `finished, exit code ${job.exitCode ?? "unknown"}` : "still running";
  return { captured: true, isError: false, content: `${id} (${job.command}) — ${state}.\n${tailOutput(fresh, scaledChars(MAX_OUTPUT_CHARS, OUTPUT_SHARE)) || "(nothing new)"}` };
}

/** Stop a background command and everything it started. */
export function stopBackground(id: string): RunResult {
  const job = background.get(id);
  if (!job) return { captured: true, isError: true, content: `No background command ${id}.` };
  if (!job.done) killTree(job.child);
  background.delete(id);
  return { captured: true, isError: false, content: `${id} stopped.` };
}

/** Every background command, stopped — when the extension goes away. */
export function stopAllBackground(): void {
  for (const id of [...background.keys()]) stopBackground(id);
}

/** The command and everything it started — a dev server under `npm run dev` included. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

interface ProcessView {
  terminal: vscode.Terminal;
  write(text: string): void;
  /** Ctrl+C typed in the terminal, while a command runs. */
  onInterrupt?: () => void;
}

let processView: ProcessView | undefined;

/** What is kept for a terminal nobody has opened yet, so that opening it later shows the session. */
const BACKLOG_CHARS = 200_000;

/**
 * One terminal holding what the commands print, reused for the session like the shell one.
 *
 * ⚠️ Created, never SHOWN. It called `show()` on every command, so each command pulled the terminal
 * panel up over the editor — what the owner asked to stop. The command's step row in the turn is
 * where it is watched now; this terminal is for whoever wants the raw log and opens it. What is
 * written before it opens is kept (bounded) and replayed when it does, and nothing waits for it to
 * open: a terminal nobody looks at must not delay a command.
 */
function processTerminal(): ProcessView {
  if (processView && processView.terminal.exitStatus === undefined && vscode.window.terminals.includes(processView.terminal)) {
    return processView;
  }
  const emitter = new vscode.EventEmitter<string>();
  let opened = false;
  let backlog = "";
  const view: ProcessView = {
    terminal: undefined as unknown as vscode.Terminal,
    write: (text) => {
      if (opened) {
        emitter.fire(text);
        return;
      }
      backlog += text;
      if (backlog.length > BACKLOG_CHARS) backlog = backlog.slice(-BACKLOG_CHARS);
    },
  };
  const pty: vscode.Pseudoterminal = {
    onDidWrite: emitter.event,
    open: () => {
      opened = true;
      if (backlog) emitter.fire(backlog);
      backlog = "";
    },
    close: () => {
      if (processView === view) processView = undefined;
    },
    handleInput: (data) => {
      if (data === CTRL_C) view.onInterrupt?.();
    },
  };
  view.terminal = vscode.window.createTerminal({ name: PROCESS_TERMINAL_NAME, pty });
  processView = view;
  return view;
}

/** The terminal that holds what process runs printed, once one has run. For the tests. */
export function processTerminalForTests(): vscode.Terminal | undefined {
  return processView?.terminal;
}

/**
 * Whether `run_command` runs commands as processes — see `runCommandAsProcess`.
 *
 * Everywhere, unless the terminal is asked for by name: « que les commandes ne nécessitent pas
 * d'ouvrir le terminal à chaque fois ». `auto` used to mean "the terminal, except on Windows", and
 * the terminal runner has to bring the terminal forward — the shell runs in it.
 */
export function usesProcessRunner(setting: "auto" | "process" | "terminal"): boolean {
  return setting !== "terminal";
}

/**
 * Which description of `run_command` the MODEL reads — deliberately the one it read before
 * `usesProcessRunner` changed its default.
 *
 * Text the model reads changes only with a measurement behind it (the task bench), and this change is
 * about the display. So `auto` outside Windows keeps the terminal runner's description: a command
 * whose output and exit code come back, which stays true; its one caveat — a shell without
 * integration — simply never happens to a process.
 */
export function describesProcessRunner(setting: "auto" | "process" | "terminal"): boolean {
  return setting === "process" || (setting === "auto" && process.platform === "win32");
}
