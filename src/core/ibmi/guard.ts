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
 */
const READING_VERBS = ["DSP", "RTV", "PRT", "CHK", "QSH", "STRSQL"];

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

export type Refusal = { reason: "outside"; libraries: string[] } | { reason: "unqualified" };

/**
 * Why this must not run, or `undefined` if it may.
 *
 * @param changes whether the statement or command alters anything. The caller knows this better
 *   than a parser can — `isReadOnlySql` for SQL, `clOnlyReads` for CL — so it is passed in.
 */
export function refuseChange(text: string, changes: boolean, policy: LibraryPolicy): Refusal | undefined {
  const allowed = policy.writable.map((l) => l.trim().toUpperCase()).filter(Boolean);
  if (!allowed.length || !changes) return undefined;

  const named = librariesNamed(text);
  // Nothing named at all: it resolves against the library list, and that is not knowable here.
  if (!named.length) return { reason: "unqualified" };

  const outside = named.filter((l) => !allowed.includes(l));
  return outside.length ? { reason: "outside", libraries: outside } : undefined;
}
