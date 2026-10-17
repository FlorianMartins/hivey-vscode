// A command of several lines, given to cmd.exe.
//
// ⚠️ « Les commandes multi-lignes n'affichent rien » — from a three-hour Windows session. cmd.exe
// runs the first line of what it is handed and drops the rest without a word: a `node -e` script
// written over twenty lines ran its first line, printed nothing, exited 0, and the model concluded
// its script was wrong and rewrote it, several times, before thinking of a file. Said up front
// instead, with the way that works.

/** Why this command cannot run as written on cmd.exe, or nothing when it can. */
export function cmdMultiLineProblem(command: string, platform: string): string | undefined {
  if (platform !== "win32") return undefined;
  const lines = command.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return undefined;
  return (
    `Not run: this command has ${lines.length} lines, and cmd.exe runs only the first one and silently drops the rest. ` +
    "Put the commands on one line joined with &&, or write the script to a file with write_file (for example tmp/check.js) " +
    "and run that file (node tmp/check.js)."
  );
}
