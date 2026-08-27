// Running MCP servers, and offering what they expose as tools.
//
// Two transports, and the difference between them is a security difference before it is a
// technical one:
//
//   • STDIO starts a program on the user's machine. That is arbitrary code execution, configured in
//     a file that may have arrived with a repository. It is not started until the user has said, in
//     a modal that names the command, that this server may run. Nothing about "it was in the
//     config" makes that consent unnecessary.
//   • HTTP talks to a server somewhere else. Nothing runs locally, but everything sent goes through
//     the egress gate like any other outbound traffic — the tool arguments a model produces are as
//     much the user's data as the file it read them from.
//
// Servers are started lazily and shut down with the extension. A configured server nobody uses
// costs nothing, which matters when a workspace declares six of them.

import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import { t } from "../../shared/i18n.js";
import type { Tool, ToolResult } from "../../core/agent/loop.js";
import { LineFramer, McpClient, flattenContent, type McpTransport, type McpToolDescriptor } from "../../core/mcp/client.js";
import { headToTokens } from "../../core/util/tokens.js";
import { SECTION } from "../config.js";
import { request } from "../../core/util/http.js";
import { sseData, sseLines } from "../../core/util/sse.js";

const MAX_TOKENS = 6000;

export interface McpServerConfig {
  name: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  /** Set in the config to keep a server out of the way without deleting it. */
  disabled?: boolean;
}

export interface McpServerStatus {
  name: string;
  type: "stdio" | "http";
  /** What it is: the command line, or the URL. Shown to the user before they trust it. */
  target: string;
  running: boolean;
  trusted: boolean;
  toolCount: number;
  error?: string;
}

// ── Configuration ──────────────────────────────────────────────────────────────────────────────

/**
 * The configured servers, from the workspace file first and the settings second.
 *
 * `.vscode/mcp.json` is the file VS Code itself standardised on, so a team that already has one
 * gets their servers here without writing anything twice. A name defined in both places resolves to
 * the settings entry, because the setting is the one the user typed themselves.
 */
export async function readMcpConfig(): Promise<McpServerConfig[]> {
  const byName = new Map<string, McpServerConfig>();

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(folder.uri, ".vscode", "mcp.json");
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(stripJsonComments(new TextDecoder().decode(bytes))) as {
        servers?: Record<string, Partial<McpServerConfig>>;
      };
      for (const [name, entry] of Object.entries(parsed.servers ?? {})) byName.set(name, normalise(name, entry));
    } catch {
      // No file, or a file being edited into a broken state. Neither is worth an error banner.
    }
  }

  const fromSettings = vscode.workspace.getConfiguration(SECTION).get<Record<string, Partial<McpServerConfig>>>("mcp.servers") ?? {};
  for (const [name, entry] of Object.entries(fromSettings)) byName.set(name, normalise(name, entry));

  return [...byName.values()].filter((s) => !s.disabled);
}

function normalise(name: string, entry: Partial<McpServerConfig>): McpServerConfig {
  const type = entry.type ?? (entry.url ? "http" : "stdio");
  return { ...entry, name, type } as McpServerConfig;
}

/** `.vscode/*.json` files are JSONC by convention, and people do comment their server list. */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  // A trailing comma is the other thing every hand-edited JSONC file has.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function describeTarget(config: McpServerConfig): string {
  return config.type === "http" ? (config.url ?? "") : [config.command, ...(config.args ?? [])].join(" ");
}

// ── Transports ─────────────────────────────────────────────────────────────────────────────────

function stdioTransport(config: McpServerConfig): McpTransport {
  const cwd = config.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let child: ChildProcess | undefined;
  let onMessage: (m: unknown) => void = () => {};
  let onError: (e: Error) => void = () => {};
  const framer = new LineFramer();

  const start = (): ChildProcess => {
    if (child) return child;
    if (!config.command) throw new Error(`MCP server “${config.name}” has no command.`);
    child = spawn(config.command, config.args ?? [], {
      cwd,
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      for (const message of framer.push(chunk)) onMessage(message);
    });
    // A server's stderr is where it explains why it will not start. Swallowing it is why "the MCP
    // server does not work" is such a common and such an unanswerable bug report.
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => log(config.name, chunk.trimEnd()));
    child.on("error", (error) => onError(error instanceof Error ? error : new Error(String(error))));
    child.on("exit", (code, signal) => {
      child = undefined;
      onError(new Error(`The server exited (${signal ?? `code ${code}`}).`));
    });
    return child;
  };

  return {
    async send(message) {
      const proc = start();
      await new Promise<void>((resolve, reject) => {
        proc.stdin?.write(`${JSON.stringify(message)}\n`, (error) => (error ? reject(error) : resolve()));
      });
    },
    onMessage(handler) { onMessage = handler; },
    onError(handler) { onError = handler; },
    async close() {
      const proc = child;
      child = undefined;
      if (!proc) return;
      proc.stdin?.end();
      proc.kill();
    },
  };
}

/**
 * Streamable HTTP: every message is a POST, and the answer is either JSON or a stream of events.
 *
 * The session id the server hands back on initialize has to travel on every later request, or the
 * server treats each call as a new client and the tool list arrives empty — which looks exactly like
 * a server that has no tools.
 */
function httpTransport(config: McpServerConfig): McpTransport {
  let onMessage: (m: unknown) => void = () => {};
  let onError: (e: Error) => void = () => {};
  let sessionId: string | undefined;

  return {
    async send(message) {
      const url = config.url;
      if (!url) throw new Error(`MCP server “${config.name}” has no url.`);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(config.headers ?? {}),
      };
      if (sessionId) headers["Mcp-Session-Id"] = sessionId;

      let response: Response;
      try {
        response = await request(url, { method: "POST", headers, body: JSON.stringify(message), timeoutMs: 60_000 });
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const given = response.headers.get("mcp-session-id");
      if (given) sessionId = given;

      // A notification is answered with 202 and no body; there is nothing to deliver.
      if (response.status === 202 || response.status === 204) return;

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && response.body) {
        for await (const line of sseLines(response.body)) {
          const data = sseData(line);
          if (data !== undefined) onMessage(data);
        }
        return;
      }
      const text = await response.text();
      if (!text.trim()) return;
      try {
        onMessage(JSON.parse(text));
      } catch {
        onError(new Error(`The server answered with something that is not JSON: ${text.slice(0, 200)}`));
      }
    },
    onMessage(handler) { onMessage = handler; },
    onError(handler) { onError = handler; },
    async close() { sessionId = undefined; },
  };
}

let channel: vscode.OutputChannel | undefined;
function log(server: string, line: string): void {
  if (!line) return;
  channel ??= vscode.window.createOutputChannel("Hivey Code — MCP");
  channel.appendLine(`[${server}] ${line}`);
}

// ── The manager ────────────────────────────────────────────────────────────────────────────────

interface Session {
  config: McpServerConfig;
  client: McpClient;
  tools: McpToolDescriptor[];
  error?: string;
}

export class McpManager {
  private readonly sessions = new Map<string, Session>();
  private readonly failed = new Map<string, string>();

  constructor(private readonly context: vscode.ExtensionContext, private readonly version: string) {}

  /**
   * Whether the user has agreed to run this server.
   *
   * Trust is per workspace and per target, not per name: a repository that renames its server, or
   * changes the command behind a name it already had, is asking a second time. The name is the part
   * an attacker controls most cheaply.
   */
  private trustKey(config: McpServerConfig): string {
    return `hiveyCode.mcp.trust:${config.name}:${describeTarget(config)}`;
  }

  isTrusted(config: McpServerConfig): boolean {
    // Nothing runs locally for an HTTP server, so there is no code-execution decision to make. What
    // it sends still goes through the egress gate, which is where that question belongs.
    if (config.type === "http") return true;
    return this.context.workspaceState.get<boolean>(this.trustKey(config)) === true;
  }

  async requestTrust(config: McpServerConfig): Promise<boolean> {
    if (this.isTrusted(config)) return true;
    const run = t("Run this server");
    const answer = await vscode.window.showWarningMessage(
      t("Start the MCP server “{0}”?", config.name),
      {
        modal: true,
        detail: t(
          "This runs a program on your machine:\n\n{0}\n\nStart it only if you know where this configuration came from.",
          describeTarget(config),
        ),
      },
      run,
    );
    if (answer !== run) return false;
    await this.context.workspaceState.update(this.trustKey(config), true);
    return true;
  }

  async status(): Promise<McpServerStatus[]> {
    const configs = await readMcpConfig();
    return configs.map((config) => {
      const session = this.sessions.get(config.name);
      return {
        name: config.name,
        type: config.type,
        target: describeTarget(config),
        running: Boolean(session),
        trusted: this.isTrusted(config),
        toolCount: session?.tools.length ?? 0,
        error: session?.error ?? this.failed.get(config.name),
      };
    });
  }

  /** Starts every configured server that is already trusted, and skips the rest silently. */
  async startAll(opts: { ask?: boolean } = {}): Promise<void> {
    for (const config of await readMcpConfig()) {
      if (this.sessions.has(config.name)) continue;
      if (!this.isTrusted(config)) {
        if (!opts.ask) continue;
        if (!(await this.requestTrust(config))) continue;
      }
      await this.start(config);
    }
  }

  private async start(config: McpServerConfig): Promise<Session | undefined> {
    try {
      const transport = config.type === "http" ? httpTransport(config) : stdioTransport(config);
      const client = new McpClient({ transport, clientName: "hivey-code", clientVersion: this.version });
      await client.initialize();
      const tools = await client.listTools();
      const session: Session = { config, client, tools };
      this.sessions.set(config.name, session);
      this.failed.delete(config.name);
      log(config.name, `connected: ${client.serverName || "(unnamed)"} ${client.serverVersion} — ${tools.length} tools`);
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failed.set(config.name, message);
      log(config.name, `failed: ${message}`);
      return undefined;
    }
  }

  async stopAll(): Promise<void> {
    for (const session of this.sessions.values()) await session.client.close().catch(() => undefined);
    this.sessions.clear();
  }

  async restart(): Promise<void> {
    await this.stopAll();
    await this.startAll({ ask: true });
  }

  /**
   * Every running server's tools, as tools this extension's agent loop can call.
   *
   * The names are prefixed with the server so two servers may both expose `search` without one
   * shadowing the other — and so the user reading an approval dialog can see which system is about
   * to be touched.
   */
  tools(): Tool[] {
    const out: Tool[] = [];
    for (const session of this.sessions.values()) {
      for (const descriptor of session.tools) {
        out.push(this.adapt(session, descriptor));
      }
    }
    return out;
  }

  private adapt(session: Session, descriptor: McpToolDescriptor): Tool {
    const qualified = `mcp_${sanitise(session.config.name)}_${sanitise(descriptor.name)}`;
    const readOnly = descriptor.annotations?.readOnlyHint === true;
    const label = descriptor.annotations?.title ?? descriptor.name;

    const tool: Tool = {
      schema: {
        name: qualified,
        description: `[${session.config.name}] ${descriptor.description ?? label}`,
        parameters: (descriptor.inputSchema as Tool["schema"]["parameters"]) ?? { type: "object", properties: {}, required: [] },
      },
      // A server saying "this only reads" is a claim by the very thing being governed. It is worth
      // enough to skip a dialog on a local, trusted server; it is never worth enough to skip one on
      // something that reaches out of the machine.
      approval: () =>
        readOnly && session.config.type === "stdio" ? false : t("call {0} on the MCP server {1}", label, session.config.name),
      async run(args, ctx): Promise<ToolResult> {
        const result = await session.client.callTool(descriptor.name, args, ctx.signal);
        ctx.report(t("{0}: {1}", session.config.name, label));
        const text = flattenContent(result.content);
        return { content: headToTokens(text || "(the tool returned nothing)", MAX_TOKENS), isError: result.isError };
      },
    };

    if (readOnly) {
      tool.restrict = () => ({ ...tool, approval: () => false });
    }
    return tool;
  }
}

/** Tool names have to survive every provider's validator: letters, digits and underscores. */
function sanitise(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
}
