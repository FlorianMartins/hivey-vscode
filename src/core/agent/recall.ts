// Memory with recall: nothing the agent has seen is lost because the context window is full.
//
// "a 64k context is too small to work with — it's fine for chat, not for agent and code mode".
// The window on the GPU is what it is; what an agent needs is not a bigger window but never losing
// what slid out of it. Every tool output is kept here, whole, in this machine's memory, and the
// model gets two tools to have it back WORD FOR WORD — `recall` an output by its id, `search_memory`
// across those outputs and the whole conversation, including exchanges no longer sent. Nothing is
// compressed or summarized on the way, so nothing is lost in quality: what comes back is the text.
//
// This is how coding agents work in windows of this size: the window holds the recent work, the
// rest is a lookup away.
import type { Tool, ToolResult } from "./loop.js";

export interface RecallEntry {
  id: string;
  /** What it was — "read_file src/app.ts" — so a search hit says where it came from. */
  label: string;
  text: string;
}

/** Kept per conversation. Bounded: the oldest outputs go first once the total passes `maxBytes`. */
export class RecallStore {
  private readonly entries = new Map<string, RecallEntry>();
  private next = 1;
  private bytes = 0;

  constructor(private readonly maxBytes = 64 * 1024 * 1024) {}

  /** Keep a text and return its id. The same text with the same label is kept once. */
  put(text: string, label: string): string {
    for (const e of this.entries.values()) if (e.label === label && e.text === text) return e.id;
    const id = `m${this.next++}`;
    this.entries.set(id, { id, label, text });
    this.bytes += text.length;
    while (this.bytes > this.maxBytes && this.entries.size > 1) {
      const oldest = this.entries.values().next().value as RecallEntry;
      this.entries.delete(oldest.id);
      this.bytes -= oldest.text.length;
    }
    return id;
  }

  get(id: string): RecallEntry | undefined {
    return this.entries.get(id);
  }

  all(): RecallEntry[] {
    return [...this.entries.values()];
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

/** A source `search_memory` looks through besides the kept outputs — the conversation's own turns. */
export interface MemorySource {
  label: string;
  text: string;
}

const RECALL_MAX = 20_000;
const RECALL_DEFAULT = 8_000;
const HIT_CONTEXT = 300;
const MAX_HITS = 8;

/** Up to `MAX_HITS` passages containing every word of `query`, with where each came from. */
export function searchMemory(query: string, sources: Array<MemorySource & { id?: string }>): string {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return "Give one or more words to search for.";
  const hits: string[] = [];
  for (const src of sources) {
    const lower = src.text.toLowerCase();
    let from = 0;
    while (hits.length < MAX_HITS) {
      const at = lower.indexOf(words[0]!, from);
      if (at < 0) break;
      const start = Math.max(0, at - HIT_CONTEXT);
      const end = Math.min(src.text.length, at + HIT_CONTEXT);
      const passage = src.text.slice(start, end);
      if (words.every((w) => passage.toLowerCase().includes(w))) {
        const where = src.id ? `${src.label} — recall {"id":"${src.id}","offset":${start}}` : src.label;
        hits.push(`[${where}]\n${start > 0 ? "…" : ""}${passage}${end < src.text.length ? "…" : ""}`);
      }
      from = at + words[0]!.length;
    }
    if (hits.length >= MAX_HITS) break;
  }
  return hits.length
    ? `${hits.length} passage(s) found:\n\n${hits.join("\n\n")}`
    : `Nothing in memory matches "${query}". Earlier outputs that were never kept cannot be searched; run the tool again if you need it.`;
}

/** The two tools that give the model its memory back. Both only read, so they run in any mode. */
export function recallTools(store: RecallStore, conversation: () => MemorySource[]): Tool[] {
  const recall: Tool = {
    parallel: () => true,
    schema: {
      name: "recall",
      description:
        "Get back, word for word, a tool output that was shortened or that left your context window. " +
        'Use the id given where it was cut, e.g. recall {"id":"m4"}. Long outputs come in pieces: pass `offset` to continue.',
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The id shown where the output was shortened, e.g. m4." },
          offset: { type: "number", description: "Character to start from (default 0)." },
          length: { type: "number", description: `How many characters (default ${RECALL_DEFAULT}, at most ${RECALL_MAX}).` },
        },
        required: ["id"],
      },
    },
    approval: () => false,
    async run(args): Promise<ToolResult> {
      const entry = store.get(String(args["id"] ?? "").trim());
      if (!entry) {
        const known = store.all().slice(-10).map((e) => `${e.id} (${e.label})`).join(", ");
        return { content: `No kept output with that id.${known ? ` Recent ones: ${known}.` : ""} Use search_memory to find it by its content.`, isError: true };
      }
      const offset = Math.max(0, Math.floor(Number(args["offset"] ?? 0)) || 0);
      const length = Math.min(RECALL_MAX, Math.max(1, Math.floor(Number(args["length"] ?? RECALL_DEFAULT)) || RECALL_DEFAULT));
      const end = Math.min(entry.text.length, offset + length);
      const more = end < entry.text.length ? `\n[… ${entry.text.length - end} more characters: recall {"id":"${entry.id}","offset":${end}}]` : "";
      return { content: `[${entry.label} — characters ${offset}–${end} of ${entry.text.length}]\n${entry.text.slice(offset, end)}${more}` };
    },
  };
  const search: Tool = {
    parallel: () => true,
    schema: {
      name: "search_memory",
      description:
        "Search everything this conversation has seen — earlier tool outputs (even ones that no longer fit your context) " +
        "and every earlier message — for words, and get the passages back with where they came from. " +
        "Use it instead of guessing or re-running a tool when you need something from earlier.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Words that must all appear in the passage." } },
        required: ["query"],
      },
    },
    approval: () => false,
    async run(args): Promise<ToolResult> {
      const sources = [...store.all().map((e) => ({ id: e.id, label: e.label, text: e.text })), ...conversation()];
      return { content: searchMemory(String(args["query"] ?? ""), sources) };
    },
  };
  return [recall, search];
}
