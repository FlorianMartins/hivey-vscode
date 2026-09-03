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
import { extractCalledPrograms, extractCopyDirectives } from "../../core/ibmi/symbols.js";

const EXTENSION_ID = "halcyontechltd.code-for-ibmi";
const MAX_ROWS = 200;
const MAX_TOKENS = 6000;

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
  const attempts = [
    // Objects of type *LIB live in QSYS. This carries the text description, which is why it is
    // first: a screen of library names with no descriptions is a screen nobody can choose from.
    `SELECT * FROM TABLE(QSYS2.OBJECT_STATISTICS('QSYS', '*LIB')) X ORDER BY 1`,
    // Every library is an SQL schema. Fewer columns, but it answers on systems where the object
    // catalogue does not — and a name alone is still a name you can pick.
    `SELECT * FROM QSYS2.SYSSCHEMAS ORDER BY 1`,
  ];
  for (const statement of attempts) {
    try {
      const rows = await content.runSQL(statement);
      let added = 0;
      for (const row of rows) {
        const name = cell(row, "OBJNAME", "OBJECT_NAME", "SCHEMA_NAME", "SYSTEM_SCHEMA_NAME");
        if (!name || inList.has(name.toUpperCase())) continue;
        inList.add(name.toUpperCase());
        out.push({
          name,
          text: cell(row, "OBJTEXT", "TEXT_DESCRIPTION", "SCHEMA_TEXT") || undefined,
          inList: false,
        });
        added += 1;
      }
      if (added) break;
    } catch {
      // Try the next one. The library list alone is still a list, and the caller offers a field.
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
export async function ibmiAllMembers(
  library: string,
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
    if (out.length) return out;
  } catch {
    // Fall through to the per-file walk.
  }

  const out: Array<MemberRow & { sourceFile: string }> = [];
  for (const file of await ibmiSourceFiles(lib)) {
    try {
      for (const member of await content.getMemberList({ library: lib, sourceFile: file.name })) {
        out.push({ ...member, sourceFile: file.name });
      }
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

export function buildIbmiTools(): Tool[] {
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

  return [sql, command, readMember, programContext, whereIsMember, listMembers, listObjects, libraryList];
}
