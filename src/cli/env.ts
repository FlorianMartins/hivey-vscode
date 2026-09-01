// What the editor hands the terminal client, and what the terminal client reads back.
//
// One file for both halves, because the failure this fixes was the two halves disagreeing in
// silence. The editor passed a URL and a model; the client also needed a PROVIDER and a KEY, and
// got neither — so anyone whose model is behind a gateway opened the terminal, typed a question and
// received `HTTP 401 Unauthorized`. The extension was configured correctly; the terminal simply was
// not told. Nothing in either file said what the contract was, so nothing could notice it was half
// implemented.
//
// Two rules about the key, and they are the reason this is a function rather than an object
// literal at the call site:
//
//   • IT TRAVELS IN THE ENVIRONMENT, NEVER IN THE COMMAND LINE. On Linux `/proc/<pid>/cmdline` is
//     world-readable and the environment is not; on any platform the command line is what a shell
//     writes to its history file. The terminal client is the user's own process, run at their
//     request, so the environment is the right channel — argv never is.
//   • IT IS ONLY SENT WHEN IT IS NEEDED. A local endpoint gets no key, whatever is in the keychain.
//     There is no reason for a credential to be in the environment of a process that will not use
//     it, and "no reason" is the whole test for whether a secret should be somewhere.

export const ENV = {
  provider: "HIVEY_CODE_PROVIDER",
  model: "HIVEY_CODE_MODEL",
  url: "HIVEY_CODE_URL",
  key: "HIVEY_CODE_KEY",
} as const;

export interface TerminalTarget {
  provider: string;
  model: string;
  baseUrl: string;
  /** From the keychain. Undefined when there is none. */
  apiKey?: string;
  /** Whether `baseUrl` resolves to this machine or this network. Decided by the caller. */
  isLocal: boolean;
}

/**
 * The environment for a `hivey-code` terminal, from what the editor is configured to use.
 *
 * Returned as a plain record so the extension's only job is to hand it to `createTerminal`, and so
 * this decision — which is a security decision — is testable without an editor.
 */
export function terminalEnvironment(target: TerminalTarget): Record<string, string> {
  const env: Record<string, string> = {
    // Run on the editor's own Node rather than on whatever `node` the user's shell resolves.
    // Requiring a separate Node installation to use a VS Code extension is an unreasonable thing to
    // ask, and it fails in the least helpful way possible: "command not found".
    ELECTRON_RUN_AS_NODE: "1",
    [ENV.provider]: target.provider,
    [ENV.model]: target.model,
    [ENV.url]: target.baseUrl,
  };
  if (!target.isLocal && target.apiKey) env[ENV.key] = target.apiKey;
  return env;
}

/**
 * Whether the terminal would open into a client that cannot answer.
 *
 * Worth knowing BEFORE the terminal opens: a 401 arriving after the user has typed their first
 * question reads as a broken feature, while a sentence beforehand reads as a missing key — which is
 * what it is, and which they can fix.
 */
export function missingKey(target: TerminalTarget): boolean {
  return !target.isLocal && !target.apiKey;
}
