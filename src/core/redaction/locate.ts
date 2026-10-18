// Where a finding was, in terms a person can act on: the file and the line.
//
// ⚠️ « dans le message afficher précisément le fichier et la ligne concernée pour que les users
// puissent potentiellement corriger ». A finding is an offset in one message of the request; the
// message is a question with files attached, a tool result, or the model's own words. This turns the
// offset back into `src/config.js`, line 12 — or says what else it came from. Worded by the caller,
// in the interface's language.

import type { Finding } from "./types.js";

interface Msg {
  role: string;
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
}

export type Place =
  | { from: "file"; file: string; line: number }
  /** What the person typed: no need to warn them about their own words, except a credential. */
  | { from: "typed" }
  | { from: "command"; command: string }
  | { from: "tool"; tool: string }
  | { from: "answer" }
  | { from: "unknown" };

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

function argsOf(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The place a finding of `redactMessages` came from, in the messages it was found in. */
export function placeOf(messages: Msg[], finding: Pick<Finding, "message" | "start">): Place {
  const m = finding.message === undefined ? undefined : messages[finding.message];
  if (!m) return { from: "unknown" };
  const at = finding.start;

  if (m.role === "tool") {
    const call = messages.flatMap((x) => x.toolCalls ?? []).find((c) => c.id === m.toolCallId);
    const args = call ? argsOf(call.args) : {};
    if (call?.name === "read_file" && typeof args["path"] === "string") {
      const from = Number(args["from"]) > 0 ? Number(args["from"]) : 1;
      return { from: "file", file: args["path"], line: from + lineAt(m.content, at) - 1 };
    }
    // A search result is one line per match: `path:line: text`.
    const lineStart = m.content.lastIndexOf("\n", at - 1) + 1;
    const hit = /^([^\s:][^:\n]*):(\d+):/.exec(m.content.slice(lineStart));
    if (hit) return { from: "file", file: hit[1]!, line: Number(hit[2]) };
    if (call?.name === "run_command" && typeof args["command"] === "string") return { from: "command", command: args["command"] };
    return call ? { from: "tool", tool: call.name } : { from: "unknown" };
  }

  if (m.role === "user") {
    const marker = m.content.indexOf("\n\n--- attached context ---\n");
    if (marker < 0 || at < marker) return { from: "typed" };
    // The attached block it is in: the last `[kind] label` header before it.
    const headers = [...m.content.slice(0, at).matchAll(/(?:^|\n)\[([a-z]+)\] ([^\n]+)\n/g)];
    const header = headers[headers.length - 1];
    if (!header) return { from: "unknown" };
    let body = m.content.slice(header.index! + header[0].length, at);
    // An untrusted attachment is fenced: its first line is the fence, not the file.
    if (/^⟦[^⟧]*:begin⟧\n/.test(body)) body = body.slice(body.indexOf("\n") + 1);
    const range = /^(.*):(\d+)(?:-\d+)?$/.exec(header[2]!);
    const file = range ? range[1]! : header[2]!;
    const first = range ? Number(range[2]) : 1;
    return { from: "file", file, line: first + lineAt(body, body.length) - 1 };
  }

  return { from: "answer" };
}

/** A value shown in a warning without being shown whole: its ends, enough to recognise it. */
export function masked(value: string): string {
  const v = value.replace(/\s+/g, " ");
  if (v.length <= 6) return "…";
  const keep = v.length >= 16 ? 4 : 2;
  return `${v.slice(0, keep)}…${v.slice(-keep)}`;
}
