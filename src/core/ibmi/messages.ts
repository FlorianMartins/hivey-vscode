// What does CPF4131 mean — and what does this shop do about it?
//
// Two halves of one answer, and the second is the one no other tool gives.
//
// IBM's text is on the partition, in a message file, and it is precise: "Level check on file
// CUSTMAST in library DEVCFC". That tells a model what happened. It does not tell anybody what to
// DO, because what to do is a decision this company made years ago and wrote down somewhere — the
// recovery procedure, the person to call, the batch to re-run, the reason the file is not journalled
// in the first place. That part lives in the internal documentation, which this extension can
// already read (`knowledge.folders`).
//
// So an identifier resolves to both: the text IBM shipped, and the house notes that mention it.
// Neither is invented, and the answer says which is which — because "IBM says this" and "your
// documentation says this" carry very different authority when the second one is out of date.

export interface IbmMessage {
  id: string;
  /** First-level text, with the substitution variables as IBM wrote them. */
  text: string;
  /** Second-level text: cause and recovery. This is the half people never read and need. */
  help?: string;
  severity?: number;
  /** Where it was found. */
  file: { library: string; name: string };
}

/**
 * A message identifier: three letters then four digits.
 *
 * Deliberately narrow. Two letters would match half the acronyms in a document, and the identifiers
 * that matter on this platform are all of this shape — CPF, CPD, CPA, CPI, MCH, RNF, RNX, SQL, TCP,
 * LNC, QSH.
 */
const ID = /\b([A-Z]{3})(\d{4})\b/g;
const ONE_ID = /^([A-Z]{3})(\d{4})$/;

export function validMessageId(id: string): boolean {
  return ONE_ID.test((id ?? "").trim().toUpperCase());
}

/**
 * Which message files hold this prefix, in the order worth looking.
 *
 * This is IBM's layout, not a guess at it: the system messages live in QSYS/QCPFMSG, the RPG
 * compiler and runtime in QRNXMSG, SQL in QSQLMSG, and the C runtime in QCLEMSG. An unknown prefix
 * is looked for in all of them rather than refused — the cost of looking is one query, and the cost
 * of refusing is a model that cannot explain the error in front of it.
 */
const FILES: Record<string, Array<{ library: string; name: string }>> = {
  CPF: [{ library: "QSYS", name: "QCPFMSG" }],
  CPD: [{ library: "QSYS", name: "QCPFMSG" }],
  CPA: [{ library: "QSYS", name: "QCPFMSG" }],
  CPI: [{ library: "QSYS", name: "QCPFMSG" }],
  CPX: [{ library: "QSYS", name: "QCPFMSG" }],
  MCH: [{ library: "QSYS", name: "QCPFMSG" }],
  RNF: [{ library: "QSYS", name: "QRNXMSG" }],
  RNX: [{ library: "QSYS", name: "QRNXMSG" }],
  RNS: [{ library: "QSYS", name: "QRNXMSG" }],
  SQL: [{ library: "QSYS", name: "QSQLMSG" }],
  LNC: [{ library: "QSYS", name: "QCLEMSG" }],
  TCP: [{ library: "QSYS", name: "QTCPMSG" }],
};

/** Every file worth asking, most likely first. */
export function messageFiles(id: string): Array<{ library: string; name: string }> {
  const prefix = (id ?? "").trim().toUpperCase().slice(0, 3);
  const known = FILES[prefix];
  if (known) return known;
  const all = Object.values(FILES).flat();
  const seen = new Set<string>();
  return all.filter((f) => {
    const key = `${f.library}/${f.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function messageSql(file: { library: string; name: string }, id: string): string {
  return (
    `SELECT * FROM TABLE(QSYS2.MESSAGE_FILE_DATA(` +
    `MESSAGE_FILE_LIBRARY => '${up(file.library)}', MESSAGE_FILE => '${up(file.name)}'` +
    `)) X WHERE MESSAGE_ID = '${up(id)}' FETCH FIRST 1 ROWS ONLY`
  );
}

function up(value: string): string {
  return (value ?? "").trim().toUpperCase().replace(/'/g, "''");
}

type Read = (row: Record<string, unknown>, ...names: string[]) => string;

export function readMessage(
  rows: Array<Record<string, unknown>>,
  file: { library: string; name: string },
  read: Read,
): IbmMessage | undefined {
  const row = rows[0];
  if (!row) return undefined;
  const id = read(row, "MESSAGE_ID", "MESSAGEID").toUpperCase();
  if (!id) return undefined;
  const severity = read(row, "SEVERITY", "MESSAGE_SEVERITY");
  const help = read(row, "MESSAGE_SECOND_LEVEL_TEXT", "SECOND_LEVEL_TEXT", "MESSAGE_HELP");
  return {
    id,
    text: read(row, "MESSAGE_TEXT", "FIRST_LEVEL_TEXT", "MESSAGETEXT"),
    ...(help ? { help } : {}),
    ...(severity.trim() && Number.isFinite(Number(severity)) ? { severity: Number(severity) } : {}),
    file: { library: file.library.toUpperCase(), name: file.name.toUpperCase() },
  };
}

/**
 * The message identifiers a document cites.
 *
 * This is the index the roadmap asks for, and it is computed from the notes rather than stored
 * beside them — deliberately, and for the reason the knowledge store already gives for its own
 * search: a second index is a second thing to keep in step, and the one that drifts is the one
 * nobody notices. A folder of internal documentation is small enough to read.
 */
export function citedIds(text: string): string[] {
  const found = new Set<string>();
  for (const m of (text ?? "").toUpperCase().matchAll(ID)) found.add(`${m[1]}${m[2]}`);
  return [...found].sort();
}

export interface CitingNote {
  id: string;
  title: string;
  /** The line that cites it, which is usually the whole of what the reader needs. */
  excerpt: string;
}

/** The house notes that mention this identifier, with the line that does. */
export function notesCiting(
  notes: Array<{ id: string; title: string; body: string }>,
  messageId: string,
  limit = 6,
): CitingNote[] {
  const wanted = (messageId ?? "").trim().toUpperCase();
  if (!validMessageId(wanted)) return [];
  const out: CitingNote[] = [];
  for (const note of notes) {
    const lines = note.body.split("\n");
    const at = lines.findIndex((l) => l.toUpperCase().includes(wanted));
    if (at < 0) continue;
    // The citing line, plus the one after it: a procedure is written as "CPF4131 — then do X", and
    // the X is on the next line as often as not.
    const excerpt = [lines[at], lines[at + 1]]
      .filter((l) => l?.trim())
      .join(" ")
      .trim()
      .slice(0, 300);
    out.push({ id: note.id, title: note.title, excerpt });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The answer.
 *
 * IBM first, because it is the fact, then the house. The two are labelled, and that labelling is
 * the point: an internal note is what this company decided, possibly in 2011, and a model that
 * cannot tell it apart from IBM's own text will present a stale procedure with the authority of a
 * manual.
 */
export function formatMessage(
  id: string,
  message: IbmMessage | undefined,
  house: CitingNote[],
  gaps: string[] = [],
): string {
  const lines: string[] = [];
  if (message) {
    lines.push(`${message.id}${message.severity !== undefined ? ` (severity ${message.severity})` : ""} — IBM's text, from ${message.file.library}/${message.file.name}:`);
    lines.push("", message.text || "(no first-level text)");
    if (message.help) lines.push("", "Cause and recovery, as IBM describes it:", message.help);
  } else {
    lines.push(
      `${id.toUpperCase()} — not found in any message file I looked in` +
        `${gaps.length ? "" : " (QSYS/QCPFMSG, QRNXMSG, QSQLMSG, QCLEMSG, QTCPMSG)"}.`,
    );
  }

  if (house.length) {
    lines.push("", `Your own documentation mentions ${id.toUpperCase()} in ${house.length} note(s):`);
    for (const note of house) lines.push(`  ${note.title} (${note.id}) — ${note.excerpt}`);
    lines.push(
      "",
      "Those notes are your organisation's, not IBM's: they say what this shop decided to do, which " +
        "may be out of date. Say which of the two you are relying on.",
    );
  } else {
    lines.push("", `Your own documentation does not mention ${id.toUpperCase()}.`);
  }

  if (gaps.length) lines.push("", `What I could not read: ${gaps.join("; ")}.`);
  return lines.join("\n");
}
