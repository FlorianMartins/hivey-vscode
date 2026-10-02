// IBM i, through the Code for IBM i extension's own connection.
//
// The alternative would be to open our own SSH session to the partition, and it is worth saying
// why that is the wrong answer. Code for IBM i has already negotiated the connection the user
// configured — the right host, the right user profile, the right library list, the right CCSID,
// the right temporary library, and an SQL job that is warm. Opening a second session would mean
// asking for a password the user has already given, running under a different library list than
// the editor shows, and getting EBCDIC conversion subtly wrong in a way that corrupts national
// characters and nothing else. So: no connection of our own. If the extension is not connected,
// these tools say so and do nothing.
//
// The permission rule follows the shape of the action, as everywhere else here: a SELECT reads and
// is free, an UPDATE changes the customer master and is asked. The check is on the statement, not
// on the tool, because one tool serves both.

import * as vscode from "vscode";
import { t } from "../../shared/i18n.js";
import type { Tool, ToolResult } from "../../core/agent/loop.js";
import { headToTokens } from "../../core/util/tokens.js";
import { cell, formatRows, isReadOnlySql, matchesName, parseMemberRef } from "../../core/ibmi/sql.js";
import { clOnlyReads, refuseChange, type Refusal } from "../../core/ibmi/guard.js";
import {
  compilableTypes,
  compileAllowed,
  compileApproval,
  errorsOnly,
  formatReport,
  runCompile,
} from "../../core/ibmi/compile.js";
import {
  NOT_INSTALLED,
  formatTestRun,
  parseTestOutput,
  presenceSql,
  readPresence,
  testCommand,
  type RpgUnitPresence,
  type TestRun,
} from "../../core/ibmi/rpgunit.js";
import {
  PROGRAM_REFERENCE_LIMITS,
  fieldMethod,
  formatImpact,
  programRefsCommand,
  programRefsQuery,
  referencesTo,
  type Reference,
} from "../../core/ibmi/impact.js";
import { arcadInstalled } from "./arcad.js";
import {
  formatAdvice,
  indexAdviceSql,
  readAdvice,
  readStats,
  tableStatsSql,
  type IndexAdvice,
  type TableStats,
} from "../../core/ibmi/db2advice.js";
import {
  formatMessage,
  messageFiles,
  messageSql,
  notesCiting,
  readMessage,
  validMessageId,
  type CitingNote,
  type IbmMessage,
} from "../../core/ibmi/messages.js";
import { knowledgeStore } from "../knowledge.js";
import { readSettings } from "../config.js";
import { extractCalledPrograms, extractCopyDirectives } from "../../core/ibmi/symbols.js";

const EXTENSION_ID = "halcyontechltd.code-for-ibmi";
const MAX_ROWS = 200;
const MAX_TOKENS = 6000;
/**
 * How far a field search goes before it stops and says it stopped.
 *
 * A field search downloads source members one at a time, and a library can hold thousands. The
 * bound is what keeps the answer honest rather than slow: an answer that was cut short says so,
 * and "nothing else uses it" is never implied by a search that gave up.
 */
const MAX_MEMBERS_SEARCHED = 300;
const MAX_REFERENCE_ROWS = 5000;
/** The source files a field is plausibly written in. Not every member of the library. */
const SOURCE_FILES = ["QRPGLESRC", "QRPGSRC", "QCLSRC", "QCLLESRC", "QDDSSRC", "QSQLSRC", "QCBLLESRC"];

/** Only the handful of methods used here; the real interface is an order of magnitude larger. */
interface IBMiContent {
  runSQL(statement: string): Promise<Array<Record<string, unknown>>>;
  downloadMemberContent(library: string, sourceFile: string, member: string): Promise<string>;
  uploadMemberContent(library: string, sourceFile: string, member: string, content: string): Promise<boolean>;
  getMemberList(filter: { library: string; sourceFile: string; members?: string; extensions?: string }): Promise<
    Array<{ library: string; file: string; name: string; extension: string; text?: string; lines?: number }>
  >;
  getObjectList(filter: { library: string; object?: string; types?: string[] }): Promise<
    Array<{ library: string; name: string; type: string; attribute?: string; text?: string }>
  >;
  getLibraryList(libraries: string[]): Promise<Array<{ name: string; text?: string }>>;
}

interface IBMiConnection {
  currentHost: string;
  currentUser: string;
  currentConnectionName: string;
  getContent(): IBMiContent;
  getConfig(): { libraryList?: string[]; currentLibrary?: string; homeDirectory?: string };
  runCommand(data: { command: string; environment?: "ile" | "qsh" | "pase"; noLibList?: boolean }): Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>;
}

interface Instance {
  getConnection(): IBMiConnection | undefined;
}

export function ibmiInstance(): Instance | undefined {
  const ext = vscode.extensions.getExtension<{ instance: Instance }>(EXTENSION_ID);
  if (!ext?.isActive) return undefined;
  return ext.exports?.instance;
}

/** Connected, not merely installed — the distinction the user cares about. */
export function ibmiConnected(): boolean {
  try {
    return Boolean(ibmiInstance()?.getConnection());
  } catch {
    return false;
  }
}

export function ibmiExtensionInstalled(): boolean {
  return Boolean(vscode.extensions.getExtension(EXTENSION_ID));
}

/**
 * Should this extension show its IBM i side at all?
 *
 * Off by absence rather than by default: on a machine without Code for IBM i there is nothing here
 * that could work, so there is nothing to show, and the setting exists for the two cases detection
 * cannot decide — someone who wants the entries while disconnected, and someone who has the
 * extension for other reasons and does not want this.
 */
export function ibmiEnabled(mode: "auto" | "on" | "off" = "auto"): boolean {
  if (mode === "off") return false;
  if (!ibmiExtensionInstalled()) return false;
  return mode === "on" || ibmiConnected();
}

function connection(): IBMiConnection {
  if (!ibmiExtensionInstalled()) {
    throw new Error(
      "Code for IBM i is not installed. Install halcyontechltd.code-for-ibmi to work against a partition.",
    );
  }
  const conn = ibmiInstance()?.getConnection();
  if (!conn) throw new Error("Code for IBM i is installed but not connected. Connect to a system first.");
  return conn;
}

/**
 * A source member's text, for attaching rather than for the model to fetch.
 *
 * The same call the `ibmi_member` tool makes. What differs is who decides: a tool is the assistant
 * reaching for something it thinks it needs, and this is the user putting a member in front of it
 * before asking anything. Both go through Code for IBM i's own connection — see the note at the top
 * of this file for why a second SSH session would be the wrong answer.
 */
export async function readMemberText(library: string, sourceFile: string, member: string): Promise<string> {
  return connection().getContent().downloadMemberContent(library, sourceFile, member);
}

/**
 * A stream file's text, through the file system Code for IBM i registers.
 *
 * Not through an API call, and the difference matters: `openTextDocument` on a `streamfile:` URI
 * goes through that extension's own provider, which already knows the connection and the CCSID, and
 * it does not open a tab. Nothing here has to be in the workspace.
 *
 * The scheme name is the one piece of this that comes from outside: it is what Code for IBM i
 * registers for the IFS. If a version of it registers something else, this throws and says so
 * rather than returning an empty file that would look like an empty member.
 */
export async function readStreamFileText(path: string): Promise<string> {
  const clean = path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`;
  const uri = vscode.Uri.from({ scheme: "streamfile", path: clean });
  const doc = await vscode.workspace.openTextDocument(uri);
  return doc.getText();
}

/** The library list of the current connection, so a picker can start from what the user works in. */
export function ibmiLibraryList(): string[] {
  const config = ibmiInstance()?.getConnection()?.getConfig() ?? {};
  const current = config.currentLibrary ? [config.currentLibrary] : [];
  return [...new Set([...current, ...(config.libraryList ?? [])])].filter(Boolean);
}

/**
 * Every library on the system, with the ones in the user's own list first.
 *
 * The library list is what somebody works in today and is the right default, but it is not the
 * whole machine — and a picker that only ever offers it cannot reach an ARCAD version library or a
 * colleague's playground. The rest come from the object catalogue, in one query.
 *
 * `SELECT *` rather than named columns, deliberately: this asks the system for whatever it has and
 * reads it case-insensitively. Naming a column is a bet that it exists and is spelled the way this
 * file guessed, and losing that bet produces a list of blank rows — which on screen is a list that
 * found nothing.
 */
export async function ibmiAllLibraries(): Promise<Array<{ name: string; text?: string; inList: boolean }>> {
  const inList = new Set(ibmiLibraryList().map((l) => l.toUpperCase()));
  const out = [...inList].map((name) => ({ name, text: undefined as string | undefined, inList: true }));
  const content = connection().getContent();

  // Two ways of asking, because one of them coming back empty is indistinguishable from a machine
  // with no libraries — and what the user sees then is their own library list and nothing else,
  // which looks exactly like "it only takes my library list". It was that.
  const sources = [
    // Objects of type *LIB live in QSYS. This carries the text description, which is why it is
    // first: a screen of library names with no descriptions is a screen nobody can choose from.
    `SELECT * FROM TABLE(QSYS2.OBJECT_STATISTICS('QSYS', '*LIB')) X ORDER BY 1`,
    // Every library is an SQL schema. Fewer columns, but it answers on systems where the object
    // catalogue does not — and a name alone is still a name you can pick.
    `SELECT * FROM QSYS2.SYSSCHEMAS ORDER BY 1`,
  ];

  // BOTH, merged — they were alternatives and should always have been complementary.
  //
  // The loop stopped at the first query that returned anything, which is the right shape for
  // "try this, else that" and the wrong one here: the two do not see the same thing. The object
  // catalogue carries descriptions and is subject to object authority; the schema catalogue has no
  // descriptions and lists what SQL can see. Whichever answered first therefore decided the whole
  // list, and the libraries only the other one knew about were never offered — reported as "the
  // list does not show all the libraries".
  //
  // Order matters only in that descriptions arrive first: a name already seen is not replaced, so
  // the row that carries a text description wins over the bare one.
  for (const statement of sources) {
    try {
      for (const row of await content.runSQL(statement)) {
        const name = cell(row, "OBJNAME", "OBJECT_NAME", "SCHEMA_NAME", "SYSTEM_SCHEMA_NAME");
        if (!name || inList.has(name.toUpperCase())) continue;
        inList.add(name.toUpperCase());
        out.push({
          name,
          text: cell(row, "OBJTEXT", "TEXT_DESCRIPTION", "SCHEMA_TEXT") || undefined,
          inList: false,
        });
      }
    } catch {
      // One catalogue that cannot be read is one fewer looked in. The library list alone is still a
      // list, and the caller offers a field to type a name into.
    }
  }
  return out;
}

/**
 * Every source member in a library, in one query.
 *
 * The alternative — list the source files, then list each one's members — is a round trip per file
 * and it depends on two API shapes rather than one. `SYSPARTITIONSTAT` holds one row per member of
 * every file in the schema, which is the whole answer in a single call, and the source files fall
 * out of it as the distinct file names. When it is not available the per-file walk is still there.
 */
/**
 * Every source member of a library.
 *
 * `onProgress` exists because the two paths below take very different amounts of time and only one
 * of them can say anything while it runs. The SQL path is a single round trip: it returns
 * everything or nothing, and the only honest thing to say during it is that it is reading. The
 * fallback walks the source files one at a time, which on a library with a hundred of them is a
 * long wait with something true to say at every step.
 */
export async function ibmiAllMembers(
  library: string,
  onProgress?: (read: number, sourceFile?: string) => void,
): Promise<Array<MemberRow & { sourceFile: string }>> {
  const lib = library.toUpperCase();
  const content = connection().getContent();
  try {
    const rows = await content.runSQL(
      `SELECT * FROM QSYS2.SYSPARTITIONSTAT WHERE TABLE_SCHEMA = '${lib}' ORDER BY TABLE_NAME, TABLE_PARTITION`,
    );
    const out = rows
      .map((row) => ({
        sourceFile: cell(row, "TABLE_NAME", "SYSTEM_TABLE_NAME"),
        name: cell(row, "TABLE_PARTITION", "SYSTEM_TABLE_MEMBER"),
        extension: cell(row, "SOURCE_TYPE"),
        text: cell(row, "PARTITION_TEXT", "TABLE_TEXT") || undefined,
        lines: Number(cell(row, "NUMBER_ROWS")) || undefined,
      }))
      .filter((m) => m.sourceFile && m.name);
    if (out.length) {
      onProgress?.(out.length);
      return out;
    }
  } catch {
    // Fall through to the per-file walk.
  }

  const out: Array<MemberRow & { sourceFile: string }> = [];
  for (const file of await ibmiSourceFiles(lib)) {
    try {
      for (const member of await content.getMemberList({ library: lib, sourceFile: file.name })) {
        out.push({ ...member, sourceFile: file.name });
      }
      onProgress?.(out.length, file.name);
    } catch {
      // One file that cannot be listed is one fewer, not a failure.
    }
  }
  return out;
}

/** Source physical files in a library, so the second step of the picker is a list and not a guess. */
export async function ibmiSourceFiles(library: string): Promise<Array<{ name: string; text?: string }>> {
  const lib = library.toUpperCase();
  const content = connection().getContent();

  // First: ask the extension. `*FILE` covers physical, logical and source physical files, and only
  // the source ones hold members — but the attribute is matched loosely on purpose. It was compared
  // to exactly "PF-SRC", which is what the platform prints and not necessarily what every version
  // of the API returns, and a mismatch there produced an empty list and a dead end.
  try {
    const objects = await content.getObjectList({ library: lib, types: ["*FILE"] });
    const source = objects.filter((o) => /SRC/i.test(o.attribute ?? ""));
    if (source.length) return source.map((o) => ({ name: o.name, text: o.text }));
  } catch {
    // Fall through: an API shape that does not match is a reason to ask the system directly, not a
    // reason to tell the user their library is empty.
  }

  // Then: ask Db2 for i, which knows regardless of how the extension spells things. This is the
  // documented way to enumerate objects, and it costs one statement.
  try {
    const rows = await content.runSQL(
      `SELECT * FROM TABLE(QSYS2.OBJECT_STATISTICS('${lib}', '*FILE')) X WHERE OBJATTRIBUTE = 'PF-SRC' ORDER BY 1`,
    );
    return rows
      .map((r) => ({ name: cell(r, "OBJNAME", "OBJECT_NAME"), text: cell(r, "OBJTEXT", "TEXT_DESCRIPTION") || undefined }))
      .filter((f) => f.name);
  } catch {
    // Both ways failed. The caller offers the field, which is the one route that cannot fail: the
    // user knows the name of the source file they work in every day.
    return [];
  }
}

export interface MemberRow {
  name: string;
  extension: string;
  text?: string;
  lines?: number;
}

/**
 * The members of a source file, asked for twice if the first way comes back with nothing.
 *
 * Same shape as the source-file listing above and for the same reason: one route is a convenience
 * that can be wrong about a particular system, and a step with a single route has no answer when it
 * is. The SQL uses three columns and no more — every column named is a column that can be missing.
 */
export async function ibmiMembers(library: string, sourceFile: string): Promise<MemberRow[]> {
  const lib = library.toUpperCase();
  const file = sourceFile.toUpperCase();
  const content = connection().getContent();
  try {
    const members = await content.getMemberList({ library: lib, sourceFile: file });
    if (members.length) return members;
  } catch {
    // Fall through to SQL rather than report an empty source file.
  }
  try {
    const rows = await content.runSQL(
      `SELECT * FROM QSYS2.SYSPARTITIONSTAT WHERE TABLE_SCHEMA = '${lib}' AND TABLE_NAME = '${file}' ORDER BY 1`,
    );
    return rows
      .map((r) => ({ name: cell(r, "TABLE_PARTITION", "SYSTEM_TABLE_MEMBER"), extension: cell(r, "SOURCE_TYPE") }))
      .filter((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * The source files a name might live in, when the directive did not say.
 *
 * `/COPY CUSTPR` means "the source file I am in", and a called program's source is wherever the
 * shop keeps it. Rather than scan every file in every library — a lot of round trips to answer a
 * question nobody asked — this is the short list of names the platform has used for thirty years,
 * with the member's own file first because that is the directive's actual meaning.
 */
function candidateSourceFiles(own: string): string[] {
  const usual = ["QRPGLESRC", "QRPGSRC", "QCPYSRC", "QCLSRC", "QCLLESRC", "QDDSSRC", "QSQLSRC", "QCBLLESRC", "QSRVSRC"];
  return [own.toUpperCase(), ...usual.filter((f) => f !== own.toUpperCase())];
}

export interface ResolvedSource {
  ref: string;
  text: string;
}

/**
 * Everything a member needs, fetched from the partition.
 *
 * The dependencies are read out of the SOURCE — copybooks, called programs — rather than out of a
 * catalogue, and that choice is worth defending. A cross-reference file says what the compiled
 * object binds; the source says what the programmer wrote, including the copybook that carries the
 * data structure the whole program is about. Both are useful, and only one of them can be had
 * without inventing catalogue views whose column names differ between releases. The other half —
 * who calls THIS program, which is the direction source cannot answer — stays with `ibmi_sql` and
 * `ibmi_command`, where the shop's own DSPPGMREF or ARCAD cross-references can be used by name.
 *
 * Searching is bounded on purpose: the library list, the usual source files, and a cap on how many
 * members come back. An unbounded walk of an IBM i program reaches the whole shop in three hops.
 */
export async function collectMemberContext(
  library: string,
  sourceFile: string,
  member: string,
  limit = 10,
): Promise<{ root: ResolvedSource; found: ResolvedSource[]; missing: string[] }> {
  const content = connection().getContent();
  const rootText = await content.downloadMemberContent(library, sourceFile, member);
  const root: ResolvedSource = { ref: `${library}/${sourceFile}(${member})`, text: rootText };

  const wanted: Array<{ name: string; library?: string; sourceFile?: string }> = [
    ...extractCopyDirectives(rootText).map((c) => ({ name: c.member, library: c.library, sourceFile: c.sourceFile })),
    ...extractCalledPrograms(rootText).map((name) => ({ name })),
  ];

  const libraries = [library.toUpperCase(), ...ibmiLibraryList().map((l) => l.toUpperCase())];
  const found: ResolvedSource[] = [];
  const missing: string[] = [];
  const seen = new Set<string>([`${library}/${sourceFile}/${member}`.toUpperCase()]);

  for (const want of wanted) {
    if (found.length >= limit) {
      missing.push(`${want.name} (${t("not fetched: the limit of {0} was reached", limit)})`);
      continue;
    }
    const inLibraries = want.library ? [want.library.toUpperCase()] : [...new Set(libraries)];
    const inFiles = want.sourceFile ? [want.sourceFile.toUpperCase()] : candidateSourceFiles(sourceFile);
    let resolved = false;
    outer: for (const lib of inLibraries) {
      for (const file of inFiles) {
        const key = `${lib}/${file}/${want.name}`.toUpperCase();
        if (seen.has(key)) {
          resolved = true;
          break outer;
        }
        try {
          const members = await content.getMemberList({ library: lib, sourceFile: file, members: want.name });
          const hit = members.find((m) => m.name.toUpperCase() === want.name.toUpperCase());
          if (!hit) continue;
          seen.add(key);
          const text = await content.downloadMemberContent(lib, file, hit.name);
          found.push({ ref: `${lib}/${file}(${hit.name})`, text });
          resolved = true;
          break outer;
        } catch {
          // A source file that does not exist in that library is the ordinary case here, not a
          // failure: this is a search, and most of the places looked in will not have it.
        }
      }
    }
    if (!resolved) missing.push(want.name);
  }

  return { root, found, missing };
}

/**
 * What each step of the IBM i bridge actually returns, on THIS system.
 *
 * Written because the alternative was another guess. Listings were coming back empty on a real
 * partition and there is no partition here to try anything against, so every fix was a hypothesis
 * shipped to somebody else to test. This runs each call in turn and reports what came back —
 * including the raw column names, which are the one thing that cannot be inferred from a distance
 * and the likeliest cause: a driver that answers `table_name` where the code asked for `TABLE_NAME`
 * hands back undefined for every row, and a list of blank rows looks exactly like a list of none.
 *
 * It reads and never writes.
 */
export async function ibmiDiagnose(library: string): Promise<string> {
  const lines: string[] = [`# Hivey Code — IBM i diagnosis`, "", `Library asked for: **${library}**`, ""];
  const step = async (title: string, run: () => Promise<string>): Promise<void> => {
    lines.push(`## ${title}`, "");
    try {
      lines.push(await run());
    } catch (error) {
      lines.push(`FAILED: ${(error as Error).message}`);
    }
    lines.push("");
  };
  const describe = (rows: Array<Record<string, unknown>>): string => {
    if (!rows.length) return "0 rows.";
    const keys = Object.keys(rows[0]!);
    return [
      `${rows.length} rows.`,
      `Column names as the driver returned them: ${keys.join(", ")}`,
      "First row:",
      "```",
      keys.map((k) => `${k} = ${JSON.stringify(rows[0]![k])}`).join("\n"),
      "```",
    ].join("\n");
  };

  lines.push(
    `Extension installed: ${ibmiExtensionInstalled()}`,
    `Connected: ${ibmiConnected()}`,
    `Library list: ${ibmiLibraryList().join(", ") || "(empty)"}`,
    "",
  );
  if (!ibmiConnected()) return lines.join("\n");

  const content = connection().getContent();
  const lib = library.toUpperCase();

  await step("getObjectList (the extension's own listing)", async () => {
    const objects = await content.getObjectList({ library: lib, types: ["*FILE"] });
    if (!objects.length) return "0 objects.";
    return [
      `${objects.length} objects of type *FILE.`,
      `Attributes seen: ${[...new Set(objects.map((o) => o.attribute ?? "(none)"))].join(", ")}`,
      `First: ${JSON.stringify(objects[0])}`,
    ].join("\n");
  });

  await step("runSQL (is there an SQL job at all)", async () =>
    describe(await content.runSQL("SELECT 1 AS ONE FROM SYSIBM.SYSDUMMY1")),
  );

  await step("OBJECT_STATISTICS (source files in the library)", async () =>
    describe(await content.runSQL(`SELECT * FROM TABLE(QSYS2.OBJECT_STATISTICS('${lib}', '*FILE')) X FETCH FIRST 5 ROWS ONLY`)),
  );

  await step("SYSPARTITIONSTAT (members in the library)", async () =>
    describe(await content.runSQL(`SELECT * FROM QSYS2.SYSPARTITIONSTAT WHERE TABLE_SCHEMA = '${lib}' FETCH FIRST 5 ROWS ONLY`)),
  );

  await step("Listing the libraries (both ways)", async () => {
    const parts: string[] = [];
    for (const [name, statement] of [
      ["OBJECT_STATISTICS('QSYS','*LIB')", `SELECT * FROM TABLE(QSYS2.OBJECT_STATISTICS('QSYS', '*LIB')) X FETCH FIRST 3 ROWS ONLY`],
      ["SYSSCHEMAS", `SELECT * FROM QSYS2.SYSSCHEMAS FETCH FIRST 3 ROWS ONLY`],
    ] as const) {
      try {
        parts.push(`### ${name}`, describe(await content.runSQL(statement)));
      } catch (error) {
        parts.push(`### ${name}`, `FAILED: ${(error as Error).message}`);
      }
    }
    parts.push(`Hivey Code ends up with ${(await ibmiAllLibraries()).length} libraries.`);
    return parts.join("\n\n");
  });

  await step("What Hivey Code makes of it", async () => {
    const files = await ibmiSourceFiles(lib);
    const members = await ibmiAllMembers(lib);
    return [
      `Source files found: ${files.length}${files.length ? ` — ${files.slice(0, 10).map((f) => f.name).join(", ")}` : ""}`,
      `Members found: ${members.length}${members.length ? ` — ${members.slice(0, 10).map((m) => `${m.sourceFile}(${m.name})`).join(", ")}` : ""}`,
    ].join("\n");
  });

  return lines.join("\n");
}

/**
 * What the gate says, as a tool result.
 *
 * A refusal rather than a dialog, and that distinction is the whole point: a dialog asks a person
 * to approve something the policy already forbids, which is how a policy becomes a habit of
 * clicking yes. The message says what to do about it, because the two ways out — qualify the
 * command, or widen the list — are both the user's to take and neither is obvious from "refused".
 */
function refusal(where: Refusal, writable: string[]): ToolResult {
  const list = writable.join(", ");
  switch (where.reason) {
    case "unqualified":
      return {
        isError: true,
        content: `Refused: this changes something and does not say which library. It would resolve against the job's library list, which cannot be checked from here. Name the library — LIBRARY/OBJECT — and it will run if the library is one of: ${list}.`,
      };
    case "opaque":
      return {
        isError: true,
        content: `Refused: this carries what it will do inside a string — a shell line, or a command handed to QCMDEXC — so what it touches cannot be checked. Run the CL command directly, naming its library, and it will go through if the library is one of: ${list}.`,
      };
    default:
      return {
        isError: true,
        content: `Refused: ${where.libraries.join(", ")} ${where.libraries.length > 1 ? "are" : "is"} not in hiveyCode.ibmi.writableLibraries, which allows: ${list}. Reading is unrestricted; this would have changed something.`,
      };
  }
}


/**
 * A member reference, or nothing.
 *
 * `approval()` is called with whatever the model sent, before anything has validated it, and it
 * runs while the card is being built — so it must not throw. `parseMemberRef` does, correctly, for
 * a reference it cannot read; here the fallback is a plainer sentence rather than a broken card.
 */
function safeRef(ref: string): { library: string; sourceFile: string; member: string } | undefined {
  try {
    return parseMemberRef(ref);
  } catch {
    return undefined;
  }
}

export function buildIbmiTools(writable: string[] = []): Tool[] {
  const sql: Tool = {
    schema: {
      name: "ibmi_sql",
      description:
        "Run one SQL statement against Db2 for i and return the rows. Reads run straight away; anything that changes data is asked for first. Db2 for i dialect: FETCH FIRST n ROWS ONLY, catalogue in QSYS2, no FROM means FROM SYSIBM.SYSDUMMY1.",
      parameters: {
        type: "object",
        properties: { statement: { type: "string", description: "A single SQL statement, without a trailing semicolon." } },
        required: ["statement"],
      },
    },
    approval: (args) => {
      const statement = String(args["statement"] ?? "");
      if (isReadOnlySql(statement)) return false;
      return t("run SQL that changes data: `{0}`", statement.slice(0, 200));
    },
    async run(args, ctx): Promise<ToolResult> {
      const statement = String(args["statement"] ?? "").replace(/;\s*$/, "");
      const refused = refuseChange(statement, !isReadOnlySql(statement), { writable });
      if (refused) return refusal(refused, writable);
      const rows = await connection().getContent().runSQL(statement);
      ctx.report(t("{0} rows from Db2 for i", rows.length));
      return { content: headToTokens(formatRows(rows, MAX_ROWS), MAX_TOKENS) };
    },
    restrict(): Tool {
      // Plan mode gets to query the catalogue — which is most of what planning against Db2 for i
      // consists of — and gets a refusal, not a dialog, for anything that writes.
      return {
        ...sql,
        schema: { ...sql.schema, description: `${sql.schema.description} In this mode only statements that read are accepted.` },
        approval: () => false,
        async run(args, ctx) {
          if (!isReadOnlySql(String(args["statement"] ?? ""))) {
            return { content: "Refused: plan mode runs statements that read and nothing else.", isError: true };
          }
          return sql.run(args, ctx);
        },
      };
    },
  };

  const command: Tool = {
    schema: {
      name: "ibmi_command",
      description:
        "Run a CL command on the partition (for example DSPFD, CRTBNDRPG, WRKOBJ) and return what it wrote. Always asked for.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The CL command, exactly as it would be typed on a command line." },
          environment: { type: "string", enum: ["ile", "qsh", "pase"], description: "Where to run it. Default ile (CL)." },
        },
        required: ["command"],
      },
    },
    approval: (args) => t("run `{0}` on the IBM i", String(args["command"] ?? "")),
    async run(args, ctx): Promise<ToolResult> {
      const cmd = String(args["command"] ?? "");
      const environment = (args["environment"] as "ile" | "qsh" | "pase" | undefined) ?? "ile";
      const refused = refuseChange(cmd, !clOnlyReads(cmd), { writable });
      if (refused) return refusal(refused, writable);
      const result = await connection().runCommand({ command: cmd, environment });
      ctx.report(t("ran {0}", cmd.split(/\s+/)[0] ?? cmd));
      const body = [result.stdout, result.stderr].filter((s) => s?.trim()).join("\n");
      // A non-zero code is an outcome, not a crash: the message ids in the output are the answer.
      return { content: headToTokens(`Exit code ${result.code}\n${body || "(no output)"}`, MAX_TOKENS) };
    },
  };

  const readMember: Tool = {
    schema: {
      name: "ibmi_member",
      description: "Read a source member from QSYS.LIB. Reference it as LIB/SRCFILE(MEMBER).",
      parameters: {
        type: "object",
        properties: { member: { type: "string", description: "LIB/SRCFILE(MEMBER) or /LIB/SRCFILE/MEMBER.RPGLE" } },
        required: ["member"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const { library, sourceFile, member } = parseMemberRef(String(args["member"] ?? ""));
      const text = await connection().getContent().downloadMemberContent(library, sourceFile, member);
      ctx.report(t("read {0}/{1}({2})", library, sourceFile, member));
      return { content: headToTokens(text, MAX_TOKENS) };
    },
  };

  const programContext: Tool = {
    schema: {
      name: "ibmi_program_context",
      description:
        "Read a source member AND the members it depends on — its copybooks and the programs it calls — " +
        "resolved across the library list. Use this instead of ibmi_member when the question is about how a " +
        "program works rather than about one line of it. It does not answer 'who calls this program': that is " +
        "the other direction, and it comes from DSPPGMREF or the shop's cross-reference tool via ibmi_sql.",
      parameters: {
        type: "object",
        properties: {
          member: { type: "string", description: "LIB/SRCFILE(MEMBER)" },
          limit: { type: "number", description: "How many dependencies to fetch. Default 10." },
        },
        required: ["member"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const { library, sourceFile, member } = parseMemberRef(String(args["member"] ?? ""));
      const limit = Math.min(20, Math.max(1, Number(args["limit"] ?? 10)));
      const { root, found, missing } = await collectMemberContext(library, sourceFile, member, limit);
      ctx.report(t("{0} and {1} of its dependencies", root.ref, found.length));
      // A budget per member rather than one for the whole answer: the root is what was asked for and
      // must survive whole, and a copybook truncated in the middle is still worth more than a
      // dependency dropped without saying so.
      const parts = [
        `--- ${root.ref}\n${headToTokens(root.text, 6000)}`,
        ...found.map((f) => `--- ${f.ref}\n${headToTokens(f.text, 2500)}`),
      ];
      if (missing.length) {
        parts.push(
          `--- ${t("Not found on this system")}\n${missing.join(", ")}\n` +
            t("These may be procedures local to the module, objects without source here, or in a library outside the list."),
        );
      }
      return { content: parts.join("\n\n") };
    },
  };

  const whereIsMember: Tool = {
    schema: {
      name: "ibmi_where_is",
      description:
        "Find which libraries and source files hold a member with this name. The reverse of reading one: " +
        "use it when the question is 'where is this program' rather than 'what does it do'. Accepts a generic " +
        "name such as CUST* .",
      parameters: {
        type: "object",
        properties: {
          member: { type: "string", description: "A member name, or a generic name ending in *." },
          library: { type: "string", description: "Optional: only look in this library." },
        },
        required: ["member"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const wanted = String(args["member"] ?? "").trim().toUpperCase();
      if (!wanted) return { content: "No member name given.", isError: true };
      const library = String(args["library"] ?? "").trim().toUpperCase();
      // `LIKE` rather than the client-side matcher: this crosses every schema on the system, so the
      // filtering has to happen where the rows are. A generic name is what IBM i users write.
      const like = wanted.replace(/\*/g, "%");
      const rows = await connection()
        .getContent()
        .runSQL(
          `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_PARTITION, SOURCE_TYPE FROM QSYS2.SYSPARTITIONSTAT ` +
            `WHERE TABLE_PARTITION LIKE '${like}'${library ? ` AND TABLE_SCHEMA = '${library}'` : ""} ` +
            `ORDER BY TABLE_SCHEMA, TABLE_NAME FETCH FIRST ${MAX_ROWS} ROWS ONLY`,
        );
      ctx.report(t("{0} place(s) hold {1}", rows.length, wanted));
      if (!rows.length) return { content: `No member matching ${wanted}.` };
      const out = rows
        .map((r) => {
          const type = cell(r, "SOURCE_TYPE");
          return `${cell(r, "TABLE_SCHEMA")}/${cell(r, "TABLE_NAME")}(${cell(r, "TABLE_PARTITION")})${type ? ` .${type}` : ""}`;
        })
        .join("\n");
      return { content: out };
    },
  };

  const listMembers: Tool = {
    schema: {
      name: "ibmi_members",
      description: "List the source members of a source physical file, with their type and description.",
      parameters: {
        type: "object",
        properties: {
          library: { type: "string" },
          sourceFile: { type: "string", description: "For example QRPGLESRC." },
          filter: { type: "string", description: "Optional generic name, for example CUST*." },
        },
        required: ["library", "sourceFile"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const library = String(args["library"] ?? "").toUpperCase();
      const sourceFile = String(args["sourceFile"] ?? "").toUpperCase();
      const members = await connection()
        .getContent()
        .getMemberList({ library, sourceFile, members: args["filter"] ? String(args["filter"]) : undefined });
      ctx.report(t("{0} members in {1}/{2}", members.length, library, sourceFile));
      const out = members
        .slice(0, MAX_ROWS)
        .map((m) => `${m.name}.${m.extension}${m.lines ? ` (${m.lines} lines)` : ""}${m.text ? ` — ${m.text}` : ""}`)
        .join("\n");
      return { content: out || "No members." };
    },
  };

  const listObjects: Tool = {
    schema: {
      name: "ibmi_objects",
      description: "List the objects in a library — programs, files, data areas — with type and description.",
      parameters: {
        type: "object",
        properties: {
          library: { type: "string" },
          object: { type: "string", description: "Optional generic name, for example CUST*." },
          types: { type: "array", items: { type: "string" }, description: "Optional object types, for example [\"*PGM\", \"*FILE\"]." },
        },
        required: ["library"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const library = String(args["library"] ?? "").toUpperCase();
      const objects = await connection()
        .getContent()
        .getObjectList({
          library,
          object: args["object"] ? String(args["object"]) : undefined,
          types: (args["types"] as string[] | undefined) ?? undefined,
        });
      ctx.report(t("{0} objects in {1}", objects.length, library));
      const out = objects
        .slice(0, MAX_ROWS)
        .map((o) => `${o.name} ${o.type}${o.attribute ? ` (${o.attribute})` : ""}${o.text ? ` — ${o.text}` : ""}`)
        .join("\n");
      return { content: out || "No objects." };
    },
  };

  const libraryList: Tool = {
    schema: {
      name: "ibmi_library_list",
      description:
        "The library list of the current connection, and which system it is. Worth checking before anything that depends on where an unqualified name resolves.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    approval: () => false,
    async run(_args, ctx): Promise<ToolResult> {
      const conn = connection();
      const config = conn.getConfig();
      ctx.report(t("read the library list"));
      const lines = [
        `System: ${conn.currentConnectionName} (${conn.currentHost}) as ${conn.currentUser}`,
        `Current library: ${config.currentLibrary ?? "(none)"}`,
        `Library list: ${(config.libraryList ?? []).join(" ") || "(empty)"}`,
      ];
      return { content: lines.join("\n") };
    },
  };


  /**
   * Compile a member on the partition, and come back with what the compiler said.
   *
   * The loop this exists for is the one IBM Bob does not claim: write it, compile it, READ THE
   * ERRORS, fix them. On IBM i that is the only loop worth having, because a member that does not
   * compile produced nothing at all — there is no object, and nothing partial to inspect. Which is
   * why `core/router/outcome.ts` counts a compile as a verdict on the turn, exactly as it counts a
   * test suite: a compile still failing when the turn ends buys the escalation, with the error list
   * attached.
   *
   * It is absent from plan mode, and not by a flag it sets on itself: `READ_ONLY` in
   * `core/session/modes.ts` is an allow-list, and this creates objects, so it is simply not in it.
   */
  const compile: Tool = {
    schema: {
      name: "ibmi_compile",
      description:
        "Compile a source member into an object on the partition and return the compiler's errors — " +
        "identifier, severity, line and text. Use this to CHECK your own change: a member that does " +
        "not compile has produced no object at all. The command follows the member's type " +
        `(${compilableTypes().join(", ")}); the target library must be one the user allows.`,
      parameters: {
        type: "object",
        properties: {
          member: { type: "string", description: "LIB/SRCFILE(MEMBER) or /LIB/SRCFILE/MEMBER.RPGLE" },
          target: { type: "string", description: "The library the object is created in. Defaults to the source library." },
          type: { type: "string", description: "The member type (rpgle, sqlrpgle, clle, pf, lf, dspf, prtf). Looked up when omitted." },
          module: { type: "boolean", description: "Create an ILE *MODULE instead of a bound program." },
        },
        required: ["member"],
      },
    },
    // Always. It creates an object on a real partition, and when `writableLibraries` is empty the
    // sentence says that nothing is bounding it — which is the one state the user needs told.
    approval: (args) => {
      const ref = safeRef(String(args["member"] ?? ""));
      if (!ref) return t("compile {0}", String(args["member"] ?? ""));
      return compileApproval(
        {
          source: { ...ref, extension: String(args["type"] ?? "") },
          targetLibrary: String(args["target"] ?? ref.library),
          ...(args["module"] ? { module: true } : {}),
        },
        writable,
      );
    },
    async run(args, ctx): Promise<ToolResult> {
      const ref = parseMemberRef(String(args["member"] ?? ""));
      const targetLibrary = String(args["target"] ?? ref.library);
      const verdict = compileAllowed(targetLibrary, writable);
      if (!verdict.allow) return { content: verdict.reason, isError: true };

      // The member's type, from the member itself when the model did not say. `getMemberList` is
      // the same call the member browser uses, so the answer is whatever Code for IBM i believes.
      let extension = String(args["type"] ?? "").replace(/^\./, "");
      if (!extension) {
        try {
          const found = await connection()
            .getContent()
            .getMemberList({ library: ref.library, sourceFile: ref.sourceFile, members: ref.member });
          extension = found.find((m) => m.name.toUpperCase() === ref.member)?.extension ?? "";
        } catch {
          /* asked for below instead of guessed */
        }
      }
      if (!extension) {
        return {
          content:
            `I could not establish the type of ${ref.library}/${ref.sourceFile}(${ref.member}), and I will not ` +
            `guess it: compiling a member with the wrong compiler produces a listing full of real-looking ` +
            `errors about code that is fine. Pass "type" — one of ${compilableTypes().join(", ")}.`,
          isError: true,
        };
      }

      const conn = connection();
      const outcome = await runCompile(
        {
          source: { ...ref, extension },
          targetLibrary,
          ...(args["module"] ? { module: true } : {}),
        },
        {
          command: (command) => conn.runCommand({ command, environment: "ile" }),
          sql: (statement) => conn.getContent().runSQL(statement),
          read: cell,
          user: conn.currentUser,
        },
      );
      if ("refused" in outcome) return { content: outcome.refused, isError: true };

      const { report } = outcome;
      const errors = errorsOnly(report.messages).length;
      ctx.report(
        report.ok
          ? t("compiled {0}/{1}", report.target.library, report.target.object)
          : t("{0} failed, {1} error(s)", report.command.split(/\s+/)[0] ?? "compile", errors),
      );
      return {
        content: headToTokens(formatReport(report), MAX_TOKENS),
        // The verdict is the command's, so the step is red when the object was not created — which
        // is what `verifyTurn` reads to decide whether the turn finished.
        isError: !report.ok,
      };
    },
  };


  /**
   * Run the shop's own RPG unit tests, and report the verdict.
   *
   * The compiler answers "is this a program?". This answers the question a bank actually asks:
   * "does it still do what it did?" — and it does so by running the tests the shop already has,
   * rather than by inventing a framework.
   *
   * The one thing it will not do is be reassuring. If RPGUnit is not installed it says so and
   * stops; "no tests failed" on a partition with no test framework is the most expensive sentence
   * this tool could produce.
   */
  const runTests: Tool = {
    schema: {
      name: "ibmi_test",
      description:
        "Run RPGUnit tests on the partition (RUCALLTST) against a compiled test program, and return " +
        "which cases passed and which failed. Use it after ibmi_compile to check a change against the " +
        "shop's own tests. If RPGUnit is not installed it says so and runs nothing.",
      parameters: {
        type: "object",
        properties: {
          library: { type: "string", description: "The library holding the compiled test program." },
          program: { type: "string", description: "The test *PGM." },
          testCase: { type: "string", description: "One test procedure instead of all of them." },
        },
        required: ["library", "program"],
      },
    },
    // Running a test runs somebody's code on the partition. It is asked for, like a command is.
    approval: (args) => t("run the tests in {0}/{1}", String(args["library"] ?? ""), String(args["program"] ?? "")),
    async run(args, ctx): Promise<ToolResult> {
      const conn = connection();
      const content = conn.getContent();

      // Asked of the catalogue, not by running the command: a RUCALLTST that does not exist fails
      // in a way nothing reading an exit status can tell apart from a failing test.
      let presence: RpgUnitPresence = { installed: false };
      try {
        presence = readPresence(await content.runSQL(presenceSql()), cell);
      } catch {
        // A catalogue we cannot read is not a partition without RPGUnit, and must not be reported
        // as one. Said as its own case below.
        return {
          content:
            "I could not ask the object catalogue whether RPGUnit is installed " +
            "(QSYS2.OBJECT_STATISTICS did not answer), so I do not know, and I am not going to run " +
            "RUCALLTST to find out — a command that does not exist fails in a way I cannot tell " +
            "apart from a failing test.",
          isError: true,
        };
      }
      if (!presence.installed) return { content: NOT_INSTALLED, isError: true };

      const built = testCommand({
        library: String(args["library"] ?? ""),
        program: String(args["program"] ?? ""),
        ...(args["testCase"] ? { testCase: String(args["testCase"]) } : {}),
        detail: true,
      });
      if ("refused" in built) return { content: built.refused, isError: true };

      const result = await conn.runCommand({ command: built.command, environment: "ile" });
      const output = [result.stdout, result.stderr].filter((x) => x?.trim()).join("\n");
      const parsed = parseTestOutput(output);
      const run: TestRun = {
        command: built.command,
        ok: result.code === 0,
        cases: parsed.cases,
        ...(parsed.reported ? { reported: parsed.reported } : {}),
        unread: parsed.unread,
        output,
      };
      const failed = run.cases.filter((c) => c.status !== "passed").length;
      ctx.report(
        run.ok
          ? t("tests passed in {0}", String(args["program"] ?? ""))
          : t("{0} test(s) failed in {1}", failed || "?", String(args["program"] ?? "")),
      );
      return { content: headToTokens(formatTestRun(run), MAX_TOKENS), isError: !run.ok };
    },
  };


  /**
   * Who uses this?
   *
   * The question asked before every change to a file here, and the one the member in front of you
   * cannot answer: a physical file is used by programs nobody remembers writing, through logicals
   * whose names say nothing, from a library that is not on the current list.
   *
   * It READS, and it is in plan mode's allow-list — which is only defensible because the one thing
   * it writes is an output file in QTEMP, a library that is created per job and destroyed with it.
   * The gate knows that explicitly (`SCRATCH_LIBRARY` in `core/ibmi/guard.ts`), and this tool puts
   * its own command through the gate before running it: if `programRefsCommand` is ever changed to
   * write somewhere else, the gate stops it rather than this comment being wrong.
   */
  const impact: Tool = {
    schema: {
      name: "ibmi_impact",
      description:
        "Who uses this file, program or field. At object level it reads the objects' own reference " +
        "lists (DSPPGMREF), which is a fact; at field level it searches the source members it can read, " +
        "which is evidence. The answer states which method it used and what that method cannot see. " +
        "Run it BEFORE changing a physical file.",
      parameters: {
        type: "object",
        properties: {
          object: { type: "string", description: "LIB/NAME, or NAME to search the library list." },
          field: { type: "string", description: "A field name, for a field-level search of the sources." },
          libraries: {
            type: "string",
            description: "Comma-separated libraries to look in. Defaults to the job's library list.",
          },
        },
        required: ["object"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const conn = connection();
      const content = conn.getContent();
      const asked = String(args["object"] ?? "").trim().toUpperCase();
      if (!asked) return { content: "No object name given.", isError: true };
      const [maybeLibrary, maybeName] = asked.includes("/") ? asked.split("/") : ["", asked];
      const name = (maybeName ?? "").trim();
      const field = String(args["field"] ?? "").trim().toUpperCase();

      const scope = String(args["libraries"] ?? "")
        .split(/[,\s]+/)
        .map((l) => l.trim().toUpperCase())
        .filter(Boolean);
      const searched = scope.length
        ? scope
        : [...new Set([maybeLibrary, conn.getConfig().currentLibrary ?? "", ...(conn.getConfig().libraryList ?? [])].map((l) => (l ?? "").toUpperCase()).filter(Boolean))];
      if (!searched.length) {
        return { content: "No library to look in: name one, or set a library list in Code for IBM i.", isError: true };
      }

      // ── Field level: a search of the sources, and it says so ─────────────────────────────────
      if (field) {
        const { method, limits, better } = fieldMethod(arcadInstalled());
        const references: Reference[] = [];
        let truncated = false;
        let read = 0;
        for (const library of searched) {
          for (const sourceFile of SOURCE_FILES) {
            if (read >= MAX_MEMBERS_SEARCHED) {
              truncated = true;
              break;
            }
            let members: Array<{ library: string; file: string; name: string; extension: string }> = [];
            try {
              members = await content.getMemberList({ library, sourceFile });
            } catch {
              continue; // a source file that is not there is not an error, it is a library without one
            }
            for (const member of members) {
              if (read >= MAX_MEMBERS_SEARCHED) {
                truncated = true;
                break;
              }
              if (ctx.signal?.aborted) return { content: "Stopped.", isError: true };
              read++;
              try {
                const text = await content.downloadMemberContent(member.library, member.file, member.name);
                const line = text.split("\n").find((l) => l.toUpperCase().includes(field));
                if (line) {
                  references.push({
                    library: member.library.toUpperCase(),
                    name: member.name.toUpperCase(),
                    type: member.extension.toUpperCase(),
                    usage: line.trim().slice(0, 120),
                  });
                }
              } catch {
                /* a member we cannot read is a member we cannot search; counted in `read` */
              }
            }
          }
        }
        ctx.report(t("searched {0} member(s) for {1}", read, field));
        return {
          content: headToTokens(
            formatImpact({
              subject: { library: maybeLibrary || searched[0]!, name, field },
              method,
              references,
              truncated,
              searched,
              limits,
              ...(better ? { better } : {}),
            }),
            MAX_TOKENS,
          ),
        };
      }

      // ── Object level: the reference lists, which are a fact ──────────────────────────────────
      const references: Reference[] = [];
      let truncated = false;
      const covered: string[] = [];
      for (const library of searched) {
        const command = programRefsCommand(library);
        // Its own command, through the gate. The point is not suspicion of this code but of the
        // next edit to it: `OUTFILE` pointing anywhere but QTEMP must fail here, loudly.
        const refused = refuseChange(command, true, { writable });
        if (refused) return refusal(refused, writable);
        const ran = await conn.runCommand({ command, environment: "ile" });
        if (ran.code !== 0) continue; // a library with no programs produces CPF9801 and no outfile
        const rows = await content.runSQL(programRefsQuery(MAX_REFERENCE_ROWS));
        if (rows.length >= MAX_REFERENCE_ROWS) truncated = true;
        references.push(...referencesTo(rows, { library: maybeLibrary || library, name }, cell));
        covered.push(library);
      }
      ctx.report(t("{0} user(s) of {1}", references.length, name));
      return {
        content: headToTokens(
          formatImpact({
            subject: { library: maybeLibrary || covered[0] || searched[0]!, name },
            method: "program-references",
            references,
            truncated,
            searched: covered.length ? covered : searched,
            limits: PROGRAM_REFERENCE_LIMITS,
          }),
          MAX_TOKENS,
        ),
      };
    },
  };


  /**
   * What Db2 for i already knows about a table.
   *
   * Db2 for i keeps something no other platform hands you this directly: a record of the indexes
   * its own optimizer wished existed while real queries ran. That turns "add an index on CUSTNO,
   * that usually helps" into "the optimizer asked for this exact key 4 812 times, over 2.1 million
   * rows, and built a temporary index for it".
   *
   * It reads, so it is free and it is in plan mode. Acting on what it says is not: creating an
   * index is a CHANGE, it goes through `ibmi_sql`, and the gate sees it like any other.
   */
  const db2Advice: Tool = {
    parallel: () => true,
    schema: {
      name: "ibmi_index_advice",
      description:
        "What Db2 for i's own optimizer wished it had: the indexes it asked for on a table " +
        "(QSYS2.SYSIXADV) with how often it asked, plus the table's size and index count " +
        "(QSYS2.SYSTABLESTAT). Read this BEFORE proposing an index or explaining why a query is slow. " +
        "It is a wish list, not a design, and the answer says what it does not mean.",
      parameters: {
        type: "object",
        properties: {
          schema: { type: "string", description: "The library (SQL schema)." },
          table: { type: "string", description: "The table. Omit to see the whole schema's advice." },
        },
        required: ["schema"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const content = connection().getContent();
      const schema = String(args["schema"] ?? "").trim();
      const table = String(args["table"] ?? "").trim();
      if (!schema) return { content: "No schema given.", isError: true };

      const gaps: string[] = [];
      let advice: IndexAdvice[] = [];
      try {
        advice = readAdvice(await content.runSQL(indexAdviceSql(schema, table || undefined)), cell);
      } catch (err) {
        gaps.push(`the index advisor (${(err as Error).message.split("\n")[0]?.slice(0, 120)})`);
      }

      let stats: TableStats | undefined;
      if (table) {
        try {
          stats = readStats(await content.runSQL(tableStatsSql(schema, table)), cell);
        } catch (err) {
          gaps.push(`the table statistics (${(err as Error).message.split("\n")[0]?.slice(0, 120)})`);
        }
      }

      ctx.report(t("{0} index suggestion(s) from the optimizer", advice.length));
      return {
        content: headToTokens(formatAdvice({ schema: schema.toUpperCase(), ...(table ? { table: table.toUpperCase() } : {}) }, advice, stats, gaps), MAX_TOKENS),
      };
    },
  };


  /**
   * What an identifier means, and what this shop does about it.
   *
   * IBM's text says what happened. It does not say what to DO, because what to do is a decision
   * this company made years ago and wrote down somewhere — the recovery procedure, the batch to
   * re-run, the person to call. That part lives in the internal documentation this extension can
   * already read, so an identifier resolves to both, labelled, because "IBM says this" and "your
   * documentation says this" carry very different authority when the second one is from 2011.
   */
  const message: Tool = {
    parallel: () => true,
    schema: {
      name: "ibmi_message",
      description:
        "What an IBM i message identifier means (CPF, CPD, MCH, RNF, SQL…): IBM's own first- and " +
        "second-level text from the message file, AND the internal documentation notes that mention " +
        "it. Use it whenever a message id appears in a joblog, a compile listing or an error.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "A message identifier, for example CPF4131." } },
        required: ["id"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const id = String(args["id"] ?? "").trim().toUpperCase();
      if (!validMessageId(id)) {
        return {
          content: `“${args["id"]}” is not a message identifier. They are three letters and four digits, like CPF4131.`,
          isError: true,
        };
      }

      const gaps: string[] = [];
      let found: IbmMessage | undefined;
      const content = connection().getContent();
      for (const file of messageFiles(id)) {
        if (found) break;
        try {
          found = readMessage(await content.runSQL(messageSql(file, id)), file, cell);
        } catch (err) {
          gaps.push(`${file.library}/${file.name} (${(err as Error).message.split("\n")[0]?.slice(0, 100)})`);
        }
      }

      // The house half. Read from the knowledge base the user configured, which may be none — and
      // then the answer simply says the documentation does not mention it.
      let house: CitingNote[] = [];
      const store = knowledgeStore(readSettings());
      if (store) {
        try {
          house = notesCiting(await store.list(), id);
        } catch (err) {
          gaps.push(`the knowledge base (${(err as Error).message.split("\n")[0]?.slice(0, 100)})`);
        }
      }

      ctx.report(t("{0}: {1} house note(s)", id, house.length));
      return { content: headToTokens(formatMessage(id, found, house, gaps), MAX_TOKENS) };
    },
  };

  return [sql, command, compile, runTests, impact, db2Advice, message, readMember, programContext, whereIsMember, listMembers, listObjects, libraryList];
}
