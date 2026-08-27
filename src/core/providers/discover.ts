// Finding a model server that is already running.
//
// The first thing this extension asks of a new user is the one thing they are least equipped to
// answer: what is the base URL of your inference server. Someone who has just installed Ollama does
// not know it, should not have to know it, and will guess wrong — and the failure looks like the
// extension not working rather than like a wrong address.
//
// So the setup screen does not ask. It knocks on the doors that are worth knocking on. Every
// serious local runtime binds a predictable port on loopback: Ollama 11434, LM Studio 1234, vLLM
// and llama.cpp 8000 and 8080, Jan 1337, LocalAI 8080, text-generation-webui 5000. Probing them
// costs a few hundred milliseconds and turns a form into a list of things that actually answered.
//
// Two rules hold here and are not negotiable:
//
//   • ONLY LOOPBACK. This walks a list of ports on the user's own machine. It never scans a
//     network, never probes a range, and never touches an address the user did not configure. An
//     extension whose selling point is that it does not send your code anywhere has no business
//     port-scanning the LAN it finds itself on.
//   • NOTHING IS SENT. A probe asks a server what models it has. It never carries a prompt, a file
//     or a token, so a probe that reaches something unexpected has disclosed nothing but the fact
//     that a VS Code extension asked.

export interface LocalRuntime {
  /** How the product calls itself, for the interface. */
  name: string;
  /** The OpenAI-compatible base URL to configure. */
  baseUrl: string;
  /** What it is serving right now. Empty means running but with nothing loaded. */
  models: string[];
  /** Where the guess came from, so the interface can say "found Ollama" rather than "found 11434". */
  port: number;
}

interface Candidate {
  name: string;
  port: number;
  /** Path appended to `http://127.0.0.1:<port>` to reach the OpenAI-compatible root. */
  base: string;
}

/**
 * Ports worth knocking on, most likely first.
 *
 * Ordered by how many people run them, because the probe stops being useful the moment it takes
 * long enough for someone to reach for the settings instead.
 */
const CANDIDATES: Candidate[] = [
  { name: "Ollama", port: 11434, base: "/v1" },
  { name: "LM Studio", port: 1234, base: "/v1" },
  { name: "llama.cpp", port: 8080, base: "/v1" },
  { name: "vLLM", port: 8000, base: "/v1" },
  { name: "Jan", port: 1337, base: "/v1" },
  { name: "text-generation-webui", port: 5000, base: "/v1" },
  { name: "LocalAI", port: 8081, base: "/v1" },
];

export interface DiscoverOptions {
  /** Injected so this is testable without a server, and mockable in the extension's tests. */
  fetchJson: (url: string, timeoutMs: number) => Promise<unknown>;
  timeoutMs?: number;
  /** Extra addresses the user configured, probed alongside the well-known ones. */
  extra?: Array<{ name: string; baseUrl: string }>;
}

/**
 * Everything answering on this machine, with what it serves.
 *
 * Probes run concurrently: seven sequential timeouts at 1.2 s each is eight seconds of a progress
 * spinner, and nobody waits eight seconds to find out whether Ollama is running.
 */
export async function discoverLocal(opts: DiscoverOptions): Promise<LocalRuntime[]> {
  const timeoutMs = opts.timeoutMs ?? 1200;

  const targets = [
    ...CANDIDATES.map((c) => ({ name: c.name, baseUrl: `http://127.0.0.1:${c.port}${c.base}`, port: c.port })),
    ...(opts.extra ?? []).map((e) => ({ name: e.name, baseUrl: e.baseUrl, port: portOf(e.baseUrl) })),
  ];

  const results = await Promise.all(
    targets.map(async (t): Promise<LocalRuntime | undefined> => {
      try {
        const body = await opts.fetchJson(`${t.baseUrl}/models`, timeoutMs);
        const models = modelIds(body);
        // A server that answers `/models` with something unrecognisable is still a server; report
        // it with no models rather than hiding it, so the user can decide.
        return { name: t.name, baseUrl: t.baseUrl, models, port: t.port };
      } catch {
        return undefined;
      }
    }),
  );

  const found = results.filter((r): r is LocalRuntime => r !== undefined);
  // Two candidates can share a port in a custom configuration; keep the first, which is the
  // better-known name.
  const seen = new Set<string>();
  return found.filter((r) => (seen.has(r.baseUrl) ? false : (seen.add(r.baseUrl), true)));
}

function portOf(url: string): number {
  try {
    return Number(new URL(url).port) || 0;
  } catch {
    return 0;
  }
}

/** `{ data: [{ id }] }` is the OpenAI shape; a few servers answer `{ models: [{ name }] }`. */
export function modelIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as { data?: unknown; models?: unknown };
  const list = Array.isArray(b.data) ? b.data : Array.isArray(b.models) ? b.models : [];
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string") ids.push(entry);
    else if (entry && typeof entry === "object") {
      const e = entry as { id?: unknown; name?: unknown; model?: unknown };
      const id = e.id ?? e.name ?? e.model;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

/**
 * Whether a model is one worth writing code with.
 *
 * Used to sort, never to hide: someone running a model this does not recognise still gets to pick
 * it. What it prevents is a setup screen that offers an embedding model as the default because it
 * happened to be listed first.
 */
export function looksLikeCodeModel(id: string): boolean {
  const name = id.toLowerCase();
  if (/embed|rerank|whisper|clip|bge-|nomic|moondream|llava|vision|tts|stable-?diffusion/.test(name)) return false;
  return true;
}

/** Code models first, then everything else; inside each group, alphabetical. */
export function rankModels(ids: string[]): string[] {
  const score = (id: string) => {
    const n = id.toLowerCase();
    if (!looksLikeCodeModel(n)) return 3;
    if (/coder|code|starcoder|codestral|codellama|deepseek|qwen.*coder/.test(n)) return 0;
    if (/instruct|chat|it\b/.test(n)) return 1;
    return 2;
  };
  return [...ids].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

/**
 * The command that installs a good default, for a runtime that is running but empty.
 *
 * A setup screen that says "no model found" and stops is a dead end. This is the one thing the user
 * has to type, so it is given exactly, ready to copy.
 */
export function suggestPull(runtime: string): string | undefined {
  if (runtime === "Ollama") return "ollama pull qwen2.5-coder:7b";
  return undefined;
}
