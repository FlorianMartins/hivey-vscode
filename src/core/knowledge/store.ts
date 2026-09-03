// Where the notes live, behind one interface with two implementations.
//
// The interface exists because of a requirement that arrived with the feature: the base has to be
// able to live on a server the team plugs in, not only in the repository. Those are genuinely
// different stores — one is files under version control, the other is somebody's service — and the
// tools, the index and the duplicate check have no business knowing which one answered.
//
// A third implementation already works with no code at all, and it is worth saying so: an MCP
// server that exposes its own knowledge tools joins the tool set through the MCP client. This
// interface is for the case where the team wants THESE tools, and the agent's habits with them,
// against their own storage.

import type { KnowledgeNote } from "./note.js";

export interface KnowledgeStore {
  /**
   * Every note, whole.
   *
   * Whole rather than a summary, because both the index and the search run over the notes
   * themselves — there is no second index to keep in step, which is the failure mode a cached
   * summary would introduce.
   */
  list(): Promise<KnowledgeNote[]>;
  read(id: string): Promise<KnowledgeNote | undefined>;
  write(note: KnowledgeNote): Promise<void>;
  /** Retires a note. Whether that means deleting or archiving is the store's business. */
  remove(id: string, reason: string): Promise<void>;
  /** Shown to the user: `.hiveycode/knowledge`, or the host of the server. */
  describe(): string;
}

/**
 * A base served over HTTP.
 *
 * Four routes, no negotiation, no schema version: `GET /notes` returns the list, `GET /notes/{id}`
 * one note, `PUT /notes/{id}` writes one, `DELETE /notes/{id}` retires one. Deliberately small
 * enough that a team can implement it in an afternoon in whatever they already run — which is the
 * only version of "pluggable" that gets plugged in.
 *
 * The notes are JSON here rather than Markdown-with-a-header: on a wire, a struct beats a format
 * that has to be parsed. The file store keeps Markdown because there the file IS the interface.
 */
export class HttpKnowledgeStore implements KnowledgeStore {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: (url: string, init?: RequestInit) => Promise<Response>,
    private readonly token?: string,
  ) {}

  describe(): string {
    try {
      return new URL(this.baseUrl).host;
    } catch {
      return this.baseUrl;
    }
  }

  async list(): Promise<KnowledgeNote[]> {
    const body = await this.json<unknown>("GET", "/notes");
    const rows = Array.isArray(body) ? body : (body as { notes?: unknown[] })?.notes;
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => normalise(row)).filter((note): note is KnowledgeNote => !!note);
  }

  async read(id: string): Promise<KnowledgeNote | undefined> {
    const body = await this.json<unknown>("GET", `/notes/${encodeURIComponent(id)}`);
    return normalise(body) ?? undefined;
  }

  async write(note: KnowledgeNote): Promise<void> {
    await this.json("PUT", `/notes/${encodeURIComponent(note.id)}`, note);
  }

  async remove(id: string, reason: string): Promise<void> {
    await this.json("DELETE", `/notes/${encodeURIComponent(id)}`, { reason });
  }

  private async json<T>(method: string, path: string, payload?: unknown): Promise<T | undefined> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const response = await this.fetcher(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`${method} ${path} — ${response.status} ${response.statusText}`);
    const text = await response.text();
    return text.trim() ? (JSON.parse(text) as T) : undefined;
  }
}

/**
 * A note from somewhere else, made safe to use.
 *
 * A remote base is not the team's repository: it is a service, and what comes back from it is
 * content rather than instructions — the same status an attachment has. So the shape is checked and
 * the fields are coerced rather than trusted, and a row missing an id or a title is dropped instead
 * of being carried around half-formed.
 */
function normalise(row: unknown): KnowledgeNote | undefined {
  if (!row || typeof row !== "object") return undefined;
  const r = row as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : undefined;
  const title = typeof r["title"] === "string" ? r["title"] : undefined;
  if (!id || !title) return undefined;
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : typeof value === "string"
        ? value.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
  return {
    id,
    title,
    tags: list(r["tags"]),
    sources: list(r["sources"]),
    ...(typeof r["updated"] === "string" ? { updated: r["updated"] } : {}),
    body: typeof r["body"] === "string" ? r["body"] : "",
  };
}
