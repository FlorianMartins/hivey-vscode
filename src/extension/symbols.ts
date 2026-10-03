// What the language server already knows, instead of a search.
//
// Every one of these questions — where is this used, who calls it, where is the symbol called X —
// has an exact answer that the editor is already holding. A grep answers the same questions
// approximately: it finds the word in a comment, misses the re-export, and cannot tell a method on
// one class from a method of the same name on another. An agent that greps for `save` in a codebase
// with four `save` methods gets four wrong answers and no way to know.
//
// So these three tools ask the providers. They read, they are available in plan mode, and they are
// honest about the one thing that makes them unreliable: a language server that has not finished
// indexing answers nothing, and "no references" from a cold server is indistinguishable from "no
// references" from a warm one unless somebody says so — which is why every answer here says whether
// a provider actually responded.

import * as vscode from "vscode";
import type { Tool, ToolResult } from "../core/agent/loop.js";
import { relative } from "./workspace.js";
import { t } from "../shared/i18n.js";

const MAX_RESULTS = 200;

/** `file:line` for a location, as the model reads paths everywhere else in this product. */
function where(uri: vscode.Uri, position: vscode.Position): string {
  return `${relative(uri)}:${position.line + 1}`;
}

/**
 * The position of a symbol, by name, in the file the question is about.
 *
 * The providers take a POSITION, not a name, and a model does not have one — so the name is located
 * first. The first occurrence of the identifier as a whole word, which is right in the overwhelming
 * majority of cases and wrong in exactly one: a name used before it is declared. The answer says
 * which line it asked about, so a wrong guess is visible rather than silent.
 */
async function locate(file: string, name: string): Promise<{ uri: vscode.Uri; position: vscode.Position } | string> {
  const matches = await vscode.workspace.findFiles(`**/${file.replace(/^\.?\//, "")}`, undefined, 2);
  const uri = matches[0] ?? (file.startsWith("/") ? vscode.Uri.file(file) : undefined);
  if (!uri) return t("I cannot find a file called {0} in this workspace.", file);
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch {
    return t("I cannot open {0}.", file);
  }
  const text = document.getText();
  const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const at = pattern.exec(text);
  if (!at) return t("{0} does not appear in {1}.", name, file);
  return { uri, position: document.positionAt(at.index) };
}

export function buildSymbolTools(): Tool[] {
  const references: Tool = {
    parallel: () => true,
    schema: {
      name: "find_references",
      description:
        "Every place a symbol is used, from the language server — exact, unlike a text search: it " +
        "follows re-exports and tells two methods of the same name apart. Give the file the symbol is " +
        "declared in and its name.",
      parameters: {
        type: "object",
        properties: { file: { type: "string" }, symbol: { type: "string" } },
        required: ["file", "symbol"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const found = await locate(String(args["file"] ?? ""), String(args["symbol"] ?? ""));
      if (typeof found === "string") return { content: found, isError: true };
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        found.uri,
        found.position,
      );
      if (!locations) {
        // Not "no references": a provider that answered nothing at all is a provider that is not
        // ready, and the two must not read the same.
        return {
          content: t(
            "No language server answered for {0}. That is not the same as “no references” — it may still be indexing.",
            String(args["file"]),
          ),
          isError: true,
        };
      }
      ctx.report(t("{0} reference(s) to {1}", locations.length, String(args["symbol"])));
      const lines = locations.slice(0, MAX_RESULTS).map((l) => where(l.uri, l.range.start));
      return {
        content: [
          `${locations.length} reference(s) to ${String(args["symbol"])}, asked about ${where(found.uri, found.position)}:`,
          ...lines,
          ...(locations.length > MAX_RESULTS ? [`… ${locations.length - MAX_RESULTS} more`] : []),
        ].join("\n"),
      };
    },
  };

  const hierarchy: Tool = {
    parallel: () => true,
    schema: {
      name: "call_hierarchy",
      description:
        "Who calls this, and what it calls, from the language server. Use it before changing a " +
        "signature: a text search cannot tell you which of four methods named `save` is yours.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string" },
          symbol: { type: "string" },
          direction: { type: "string", enum: ["incoming", "outgoing"], description: "Default incoming." },
        },
        required: ["file", "symbol"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const found = await locate(String(args["file"] ?? ""), String(args["symbol"] ?? ""));
      if (typeof found === "string") return { content: found, isError: true };
      const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        "vscode.prepareCallHierarchy",
        found.uri,
        found.position,
      );
      if (!items?.length) {
        return {
          content: t(
            "No call hierarchy for {0} at {1}. Either the language server does not provide one for this language, or it is still indexing.",
            String(args["symbol"]),
            where(found.uri, found.position),
          ),
          isError: true,
        };
      }
      const outgoing = String(args["direction"] ?? "incoming") === "outgoing";
      const calls = await vscode.commands.executeCommand<Array<{ from?: vscode.CallHierarchyItem; to?: vscode.CallHierarchyItem }>>(
        outgoing ? "vscode.provideOutgoingCalls" : "vscode.provideIncomingCalls",
        items[0],
      );
      const rows = (calls ?? []).slice(0, MAX_RESULTS).map((call) => {
        const item = outgoing ? call.to : call.from;
        return item ? `${item.name} — ${where(item.uri, item.selectionRange.start)}` : "(unnamed)";
      });
      ctx.report(t("{0} {1} call(s)", rows.length, outgoing ? "outgoing" : "incoming"));
      return {
        content: [
          `${outgoing ? "Called by" : "Callers of"} ${items[0]!.name}, asked about ${where(found.uri, found.position)}:`,
          ...(rows.length ? rows : ["(none)"]),
        ].join("\n"),
      };
    },
  };

  const symbols: Tool = {
    parallel: () => true,
    schema: {
      name: "workspace_symbols",
      description:
        "Find a symbol anywhere in the workspace by name, from the language server. Faster and more " +
        "exact than searching text, and it knows what KIND each one is — a class, a method, a variable.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "A name or part of one." } },
        required: ["query"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const query = String(args["query"] ?? "").trim();
      if (!query) return { content: "No name given.", isError: true };
      const found = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        query,
      );
      if (!found) {
        return {
          content: t("No language server answered. That is not the same as “no such symbol”."),
          isError: true,
        };
      }
      ctx.report(t("{0} symbol(s) matching {1}", found.length, query));
      const rows = found
        .slice(0, MAX_RESULTS)
        .map((s) => `${vscode.SymbolKind[s.kind] ?? "?"} ${s.name}${s.containerName ? ` in ${s.containerName}` : ""} — ${where(s.location.uri, s.location.range.start)}`);
      return {
        content: [`${found.length} symbol(s) matching “${query}”:`, ...(rows.length ? rows : ["(none)"])].join("\n"),
      };
    },
  };

  return [references, hierarchy, symbols];
}
