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
import { formatRows, isReadOnlySql, parseMemberRef } from "../../core/ibmi/sql.js";

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

  return [sql, command, readMember, listMembers, listObjects, libraryList];
}
