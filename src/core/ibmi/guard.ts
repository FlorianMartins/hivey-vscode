// What an agent is allowed to change on the partition.
//
// The request this answers was not a feature request, it was a condition: "the agents must never
// interact with production". That cannot be a sentence in a prompt. A prompt is a request to a
// model, and a model that misreads one is the ordinary case rather than the exceptional one — which
// is exactly the reasoning already written down for plan mode, where the tool set is decided in
// code and no writing tool exists at all.
//
// So this is a gate, in code, between the agent and anything that changes. It is deliberately
// strict in the three places where being lenient would mean guessing:
//
//   • UNKNOWN IS CHANGING. A CL verb nobody listed as a reader is treated as a writer. The cost of
//     being wrong that way is a refusal the user can lift; the cost of the other way is a deleted
//     production file.
//   • UNQUALIFIED IS REFUSED. `DLTOBJ OBJ(CUSTMAST)` resolves against the job's library list, which
//     is not knowable from here and may well start with production. A command that does not say
//     which library it means cannot be checked, and something that cannot be checked is not allowed
//     through a gate that exists to check it.
//   • EVERY name counts. A command naming four libraries passes only if all four are allowed.
//
// It does nothing at all until a list is configured, because a default list would be this one
// company's library names shipped to everybody else's.

/**
 * CL verbs that only look.
 *
 * Deliberately short. Every verb absent from this list is treated as making a change, so adding to
 * it is a decision to let the agent run that family of commands against whatever is allowed —
 * which is why `WRK` is not here: a WRK screen is a menu onto commands that change things.
 *
 * `QSH` and `STRSQL` were here and should never have been. A shell is not a reader: `QSH CMD('rm -r
 * /QSYS.LIB/PROD.LIB')` was classified as looking and walked straight past the gate that exists to
 * keep the agent out of production. They are handled below instead, as commands whose target cannot
 * be read at all.
 */
const READING_VERBS = ["DSP", "RTV", "PRT", "CHK"];

/** Up to ten characters, starting with a letter or one of the three national characters. */
const NAME = "[A-Z#$@][A-Z0-9#$@_.]{0,9}";

/** Every `LIBRARY/OBJECT` or `LIBRARY.OBJECT` reference, uppercased and deduplicated. */
export function librariesNamed(text: string): string[] {
  const found = new Set<string>();
  const upper = (text ?? "").toUpperCase();
  for (const m of upper.matchAll(new RegExp(`(${NAME})\\s*[/.]\\s*${NAME}`, "g"))) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

/** Whether a CL command only reads. See `READING_VERBS` — anything unrecognized is a change. */
export function clOnlyReads(command: string): boolean {
  const verb = (command ?? "").trim().toUpperCase().split(/\s+/)[0] ?? "";
  // A qualified command name — `QSYS/DSPFD` — is the command's own library, not its target.
  const bare = verb.includes("/") ? (verb.split("/")[1] ?? "") : verb;
  return READING_VERBS.some((v) => bare.startsWith(v));
}

export interface LibraryPolicy {
  /** Libraries the agent may change. Empty means the gate is off. */
  writable: string[];
}

/**
 * The one library a reading tool may write.
 *
 * Asking "which programs use this file" on IBM i means `DSPPGMREF` to an OUTPUT FILE, and an output
 * file is a file: a tool that only reads still has to write somewhere. QTEMP is the right and only
 * answer, for reasons that are properties of the library rather than a convention — it is created
 * per job, it is destroyed when the job ends, no other job can see it, and nothing in production
 * can be reached through it.
 *
 * It lives HERE, in the gate, rather than in each tool. A tool that grants itself an exemption is a
 * tool that can be wrong about it, and the next one copies the exemption without copying the
 * reason. It is also only an exemption for the library named QTEMP: a command that writes to QTEMP
 * and to CUSTMAST is still a command that writes to CUSTMAST.
 */
export const SCRATCH_LIBRARY = "QTEMP";

/**
 * Commands that carry what they will do inside a string.
 *
 * A shell line, or a CL command handed to `QCMDEXC` as text: the target is in the string, the
 * string is built at run time, and whatever this gate reads in it the partition may read something
 * else. There is no version of these that can be checked, so when the gate is on they are refused
 * outright — including one that appears to name an allowed library, because appearing to is not the
 * same as doing so.
 *
 * Matched anywhere in the text rather than at the verb, so a shell wrapped in a submission —
 * `SBMJOB CMD(QSH CMD('…'))` — is still a shell. Word boundaries on both sides: `QSHELLDOC` is a
 * member name, not an interpreter.
 */
const OPAQUE = /(?<![A-Z0-9])(?:QSH|STRQSH|QCMDEXC|QCAPCMD|SYSTEM)(?![A-Z0-9])/;

export type Refusal =
  | { reason: "outside"; libraries: string[] }
  | { reason: "unqualified" }
  /** The command says what it does in a string this cannot read. See `OPAQUE`. */
  | { reason: "opaque" };

/**
 * Why this must not run, or `undefined` if it may.
 *
 * @param changes whether the statement or command alters anything. The caller knows this better
 *   than a parser can — `isReadOnlySql` for SQL, `clOnlyReads` for CL — so it is passed in.
 */
export function refuseChange(text: string, changes: boolean, policy: LibraryPolicy): Refusal | undefined {
  const allowed = policy.writable.map((l) => l.trim().toUpperCase()).filter(Boolean);
  if (!allowed.length || !changes) return undefined;

  // Before anything is read out of it: a command that carries its target in a string cannot be
  // checked by reading the string, and a library name appearing in one proves nothing.
  if (OPAQUE.test(text.toUpperCase())) return { reason: "opaque" };

  const named = librariesNamed(text);
  // Nothing named at all: it resolves against the library list, and that is not knowable here.
  if (!named.length) return { reason: "unqualified" };

  // QTEMP is allowed without being listed — see `SCRATCH_LIBRARY`. Filtered out of the names rather
  // than added to the allow-list, so that a policy printed back to the user still shows the
  // libraries THEY configured and not one this code added behind them.
  const outside = named.filter((l) => l !== SCRATCH_LIBRARY && !allowed.includes(l));
  return outside.length ? { reason: "outside", libraries: outside } : undefined;
}
