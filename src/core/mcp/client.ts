// A Model Context Protocol client, written by hand.
//
// MCP is how a vendor plugs a system into an assistant without either side knowing about the
// other: the server declares its tools, the client offers them to the model, and the two never
// share a type. That is exactly the shape an IBM i shop needs — ARCAD, a ticketing system, an
// internal catalogue — so this extension speaks it.
//
// Writing the client rather than installing @modelcontextprotocol/sdk is the same trade this
// codebase makes everywhere else. The wire format is JSON-RPC 2.0 over a stream, the handshake is
// three messages, and the whole thing fits in this file. An SDK would bring a dependency tree into
// an extension whose selling point is that you can audit what it sends.
//
// The transport is injected, because the two that matter are very different animals: a stdio
// server is a child process on the user's machine, an HTTP server is a URL somewhere else. Only the
// second one can leak anything, and keeping the distinction in the type means the extension layer
// can treat them differently without this file knowing why.

export interface McpTransport {
  /** Sends one JSON-RPC message. Framing belongs to the transport. */
  send(message: unknown): Promise<void>;
  /** Registers the sink for messages arriving from the server. */
  onMessage(handler: (message: unknown) => void): void;
  /** Registers the sink for transport-level failure — the process died, the socket closed. */
  onError(handler: (error: Error) => void): void;
  close(): Promise<void>;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: { type: string; properties?: Record<string, unknown>; required?: string[] };
  /** Servers may hint that a tool only reads; we treat the hint as a hint, never as a permission. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; text?: string };
}

export interface McpCallResult {
  content: McpContent[];
  isError?: boolean;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The version of the protocol this client implements and will negotiate for. */
export const PROTOCOL_VERSION = "2025-06-18";

export interface McpClientOptions {
  transport: McpTransport;
  /** Shown to the server in the handshake. */
  clientName?: string;
  clientVersion?: string;
  /** How long a single request may take before it is abandoned. */
  timeoutMs?: number;
}

export class McpClient {
  private readonly transport: McpTransport;
  private readonly pending = new Map<number | string, Pending>();
  private readonly timeoutMs: number;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private nextId = 1;
  private closed = false;

  /** Filled in by the handshake; useful to show the user who they are actually talking to. */
  serverName = "";
  serverVersion = "";
  capabilities: Record<string, unknown> = {};

  constructor(opts: McpClientOptions) {
    this.transport = opts.transport;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.clientName = opts.clientName ?? "forge";
    this.clientVersion = opts.clientVersion ?? "0.0.0";
    this.transport.onMessage((message) => this.receive(message));
    this.transport.onError((error) => this.failAll(error));
  }

  /**
   * The handshake: initialize, read what the server can do, tell it we are ready.
   *
   * The `notifications/initialized` message at the end is not decoration. A server that has not
   * received it is entitled to reject every subsequent request, and the ones that do fail in a way
   * that looks exactly like a broken tool list.
   */
  async initialize(): Promise<void> {
    const result = (await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      clientInfo: { name: this.clientName, version: this.clientVersion },
    })) as { serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown> };

    this.serverName = result?.serverInfo?.name ?? "";
    this.serverVersion = result?.serverInfo?.version ?? "";
    this.capabilities = result?.capabilities ?? {};
    await this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    if (!this.capabilities["tools"]) return [];
    const out: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    // Paginated by the spec, and a server with thirty tools does paginate. Reading only the first
    // page would silently hide the rest, which is the kind of bug nobody reports as a bug.
    do {
      const page = (await this.request("tools/list", cursor ? { cursor } : {})) as {
        tools?: McpToolDescriptor[];
        nextCursor?: string;
      };
      out.push(...(page?.tools ?? []));
      cursor = page?.nextCursor;
    } while (cursor && out.length < 500);
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    const result = (await this.request("tools/call", { name, arguments: args }, signal)) as McpCallResult;
    return { content: result?.content ?? [], isError: result?.isError };
  }

  async listResources(): Promise<McpResourceDescriptor[]> {
    if (!this.capabilities["resources"]) return [];
    const page = (await this.request("resources/list", {})) as { resources?: McpResourceDescriptor[] };
    return page?.resources ?? [];
  }

  async readResource(uri: string): Promise<McpContent[]> {
    const page = (await this.request("resources/read", { uri })) as { contents?: McpContent[] };
    return page?.contents ?? [];
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failAll(new Error("The MCP connection was closed."));
    await this.transport.close();
  }

  // ── Plumbing ─────────────────────────────────────────────────────────────────────────────────

  private request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("The MCP connection is closed."));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs} ms.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });

      if (signal) {
        // Cancelling the turn must free the request, but the server is not obliged to notice; the
        // notification is best-effort and the local promise is settled either way.
        signal.addEventListener(
          "abort",
          () => {
            const entry = this.pending.get(id);
            if (!entry) return;
            this.pending.delete(id);
            clearTimeout(entry.timer);
            void this.notify("notifications/cancelled", { requestId: id, reason: "The user stopped the turn." }).catch(
              () => undefined,
            );
            reject(new Error("Cancelled."));
          },
          { once: true },
        );
      }

      this.transport.send({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.transport.send({ jsonrpc: "2.0", method, params });
  }

  private receive(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const msg = message as { id?: number | string; result?: unknown; error?: { code: number; message: string }; method?: string };

    // A request from the server (sampling, roots, elicitation). We advertise none of those
    // capabilities, so the correct answer is a well-formed refusal rather than silence: a server
    // waiting on a reply that never comes hangs until its own timeout.
    if (msg.method && msg.id !== undefined) {
      void this.transport
        .send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `${msg.method} is not supported by this client.` } })
        .catch(() => undefined);
      return;
    }
    if (msg.id === undefined) return; // a notification we do not act on

    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
    else entry.resolve(msg.result);
  }

  private failAll(error: Error): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }
}

/**
 * A tool result, flattened into the text a model can read.
 *
 * MCP content is a list of typed parts and a model gets a string. Images and audio are named rather
 * than inlined: this extension's whole premise is that the user knows what left their machine, and
 * quietly turning a screenshot into a megabyte of base64 in the transcript is the opposite of that.
 */
export function flattenContent(content: McpContent[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === "text" && item.text) parts.push(item.text);
    else if (item.type === "resource" && item.resource?.text) parts.push(item.resource.text);
    else if (item.type === "resource" && item.resource?.uri) parts.push(`[resource ${item.resource.uri}]`);
    else if (item.type === "image") parts.push(`[image${item.mimeType ? ` ${item.mimeType}` : ""}, not included]`);
    else if (item.type === "audio") parts.push(`[audio${item.mimeType ? ` ${item.mimeType}` : ""}, not included]`);
    else if (item.text) parts.push(item.text);
  }
  return parts.join("\n").trim();
}

/**
 * Splits a stream into JSON-RPC messages.
 *
 * MCP over stdio is newline-delimited JSON — not the Content-Length framing LSP uses, which is the
 * mistake everyone makes first. A chunk from a pipe respects no boundary at all, so the remainder
 * has to be carried between calls; without that, a message that straddles two reads is dropped and
 * the client waits forever for a reply that already arrived.
 */
export class LineFramer {
  private buffer = "";

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const out: unknown[] = [];
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) {
        try {
          out.push(JSON.parse(line));
        } catch {
          // Servers print diagnostics to stdout more often than they should. A line that is not
          // JSON is not a protocol error; it is noise, and dropping it beats crashing the client.
        }
      }
      index = this.buffer.indexOf("\n");
    }
    return out;
  }
}
