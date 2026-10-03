// A tool call the model wrote in its message instead of in the protocol.
//
// Agent mode on a local model is this product's central promise, and it silently did nothing. The
// reason was not the model: asked to add a flag to a CLI, `qwen2.5-coder:7b` produced a perfectly
// correct `edit_file` call — with the right path, the right old text and the right new text — and
// Ollama's OpenAI-compatible endpoint returned it as plain text in `content`, with
// `finish_reason: "stop"` and `tool_calls: null`. The client saw a message with no tool calls,
// printed the JSON as if it were an answer, and changed nothing.
//
// That is not a rare configuration. It is the default one: the model named in this project's own
// README, on the runtime its README tells people to install. Every agent task scored zero, and the
// score would have been published as the local model's quality.
//
// So a tool call written in the text is recognised. The whole risk of doing that is obvious — model
// prose must never become an executed action — and it is bounded by three rules:
//
//   1. ONLY when the protocol returned nothing. A native tool call always wins; this never competes
//      with one.
//   2. The call must be the LAST thing in the message, and it must be DELIMITED — a fenced block or
//      a `<tool_call>` block. A bare object is accepted only when it is the entire message. These
//      models narrate before they act ("Before making any changes, I'll check that count.js
//      exists…"), so demanding that the message hold nothing else left agent mode inoperative in
//      practice; demanding that nothing follow the call keeps "here is the JSON you would send, that
//      would delete everything" from being a way to make the model act.
//
//      This does collapse two channels that the protocol keeps apart: with native tool calls, a model
//      TALKING about a call cannot become one, because talking happens in `content` and calling
//      happens in `tool_calls`. That separation is genuinely lost here, and it is not recovered by
//      being clever — it is recovered by saying so: a call read out of the text is marked
//      `source: "text"`, and the approval card tells the user where it came from. The action itself
//      is gated exactly as a native call is, by the same approval, the same permissions and the same
//      diff preview.
//   3. The name must be one of the tools actually offered on this request. A name nobody offered is
//      not a call, it is a model inventing an API.
//
// What this does NOT do is grant anything. A recognised call joins the same list as a native one and
// goes through the same approval, the same permission rules and the same diff preview. The user sees
// the same card they would have seen; the only difference is that the call is no longer lost.

import type { ToolCall } from "./types.js";

/** Qwen's chat template wraps each call in these. Several may appear in one message. */
const TOOL_CALL_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

/**
 * The calls a message's text holds, when it holds nothing else.
 *
 * @param text the assistant message's content, as it arrived.
 * @param offered the names of the tools this request actually offered.
 */
export function toolCallsFromText(text: string, offered: readonly string[]): ToolCall[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed || !offered.length) return [];
  const names = new Set(offered);

  // The template's own wrapper, which may carry several calls. Nothing may follow the last one.
  const blocks = [...trimmed.matchAll(TOOL_CALL_BLOCK)];
  if (blocks.length) {
    const last = blocks[blocks.length - 1]!;
    if (trimmed.slice(last.index + last[0].length).trim()) return [];
    const calls = blocks.map((m, i) => parseCall(m[1] ?? "", names, i));
    return calls.every(Boolean) ? (calls as ToolCall[]) : [];
  }

  // A fenced block at the end of the message, whatever was said before it.
  const fenced = lastFencedBlock(trimmed);
  if (fenced !== undefined) {
    const call = parseCall(fenced, names, 0);
    return call ? [call] : [];
  }

  // A bare object with no delimiter at all is accepted only as the whole message: inside prose there
  // is nothing to tell a call from a quotation of one.
  if (!trimmed.startsWith("{")) return [];
  const call = parseCall(trimmed, names, 0);
  return call ? [call] : [];
}

/**
 * The contents of the last fenced block, if the message ends with one.
 *
 * Ends with: a block followed by another sentence is a block the model was talking ABOUT. Scanned
 * from the back rather than with one anchored expression, because the message before it may well
 * contain other fenced code — a model explaining the change it is about to make often shows it.
 */
function lastFencedBlock(text: string): string | undefined {
  if (!text.endsWith("```")) return undefined;
  const open = text.lastIndexOf("```", text.length - 4);
  if (open < 0) return undefined;
  const body = text.slice(open + 3, text.length - 3);
  const newline = body.indexOf("\n");
  if (newline < 0) return undefined; // ```inline``` is not a block
  // Only a language tag may sit on the opening line; anything else means this is not a fence.
  if (/[^a-z]/i.test(body.slice(0, newline).trim())) return undefined;
  return body.slice(newline + 1).trim();
}

/**
 * One `{"name": …, "arguments": {…}}`, or nothing.
 *
 * `arguments` is the field the OpenAI schema uses and the field every template that emits these
 * copies. `parameters` is accepted beside it because it is the word the SCHEMA uses for the same
 * thing, and a model reading its own tool definition reaches for it. Nothing else is guessed at: a
 * shape this does not recognise stays text, which is the safe direction.
 */
function parseCall(json: string, offered: Set<string>, index: number): ToolCall | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const object = parsed as Record<string, unknown>;
  const name = object["name"];
  if (typeof name !== "string" || !offered.has(name)) return undefined;

  const args = object["arguments"] ?? object["parameters"] ?? {};
  // A string is already what the protocol carries; an object is what these models write. Anything
  // else is not arguments.
  if (typeof args === "string") return { id: `text_${index}`, name, args, source: "text" };
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  return { id: `text_${index}`, name, args: JSON.stringify(args), source: "text" };
}
