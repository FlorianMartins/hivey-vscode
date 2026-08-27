// ARCAD, through the Elias extension's commands and the Elias REST server.
//
// A word about what this does not do. ARCAD's REST API is a commercial product whose endpoint
// catalogue is not published, and inventing paths for a model to call would produce an integration
// that fails at the customer's site in a way nobody could debug. So the bridge has two halves, and
// both are honest about where their knowledge comes from:
//
//   • the COMMAND half calls the `arcad.*` commands the Elias extension itself registers. Those are
//     a real, declared, versioned surface — they appear in the command palette, and they are what
//     the ARCAD developer already uses. Calling one is exactly as capable as clicking it.
//   • the REST half calls the server the user has already configured in `arcad.restApiServer.*`,
//     at a path the user or their ARCAD administrator supplies. Forge does not guess paths; it
//     carries the request, the credentials and the redaction.
//
// For a deeper integration than that, an MCP server is the right shape, and this extension speaks
// MCP — see `mcp.ts`. That is the door through which a vendor plugs in properly.

import * as vscode from "vscode";
import { t } from "../../shared/i18n.js";
import type { Tool, ToolResult } from "../../core/agent/loop.js";
import { headToTokens } from "../../core/util/tokens.js";
import { request } from "../../core/util/http.js";

const EXTENSION_ID = "arcadsoftware.arcad-elias";
const MAX_TOKENS = 5000;

/**
 * The ARCAD commands worth exposing, named by intent rather than by command id.
 *
 * The list is curated rather than open on purpose. Elias registers over 150 commands, most of which
 * open a picker and wait for a human; handing all of them to a model produces a turn that hangs on
 * a modal nobody is looking at. These are the ones that do a thing and finish.
 */
const ACTIONS: Array<{ id: string; command: string; description: string; changes: boolean }> = [
  {
    id: "convert_to_free",
    command: "arcad.convertToFullyFree",
    description: "Convert the fixed-format RPGLE in the active editor to fully free-form, with ARCAD Transformer RPG.",
    changes: true,
  },
  {
    id: "checkout",
    command: "arcad.checkout",
    description: "Check a component out of the ARCAD repository so it can be modified.",
    changes: true,
  },
  {
    id: "checkin",
    command: "arcad.checkin",
    description: "Check a modified component back into the ARCAD repository.",
    changes: true,
  },
  {
    id: "cancel_checkout",
    command: "arcad.cancelCheckout",
    description: "Cancel a checkout and discard the local modification.",
    changes: true,
  },
  {
    id: "compile",
    command: "arcad.skipperCompileActiveEditor",
    description: "Compile the active component through ARCAD Skipper.",
    changes: true,
  },
  {
    id: "request_build",
    command: "arcad.requestBuild",
    description: "Ask ARCAD Builder for a build.",
    changes: true,
  },
  {
    id: "cross_references",
    command: "arcad.openInArcadObserver",
    description: "Open the active component's cross-references in ARCAD Observer — what calls it and what it calls.",
    changes: false,
  },
  {
    id: "search_repository",
    command: "arcad.searchForWord",
    description: "Search the ARCAD repository for a word across every component.",
    changes: false,
  },
  {
    id: "component_properties",
    command: "arcad.componentProperties",
    description: "Show the ARCAD properties of the active component.",
    changes: false,
  },
  {
    id: "component_history",
    command: "arcad.showComponentHistory",
    description: "Show the version history ARCAD holds for the active component.",
    changes: false,
  },
];

export function arcadInstalled(): boolean {
  return Boolean(vscode.extensions.getExtension(EXTENSION_ID));
}

export interface ArcadServer {
  base: string;
  instance: string;
  ccsid: string;
}

/**
 * Where the Elias REST server is, according to the settings the user already filled in for Elias.
 *
 * Reading another extension's configuration is a liberty, and the alternative — a second set of
 * host/port/TLS settings under `forge.*` — is worse: two places to change when the server moves,
 * and a support call the first time they disagree.
 */
export function arcadServer(): ArcadServer | undefined {
  const cfg = vscode.workspace.getConfiguration("arcad");
  const address = cfg.get<string>("restApiServer.address");
  if (!address) return undefined;
  const port = cfg.get<number>("restApiServer.port") ?? 2012;
  const https = cfg.get<boolean>("restApiServer.useHTTPS") !== false;
  return {
    base: `${https ? "https" : "http"}://${address}:${port}`,
    instance: cfg.get<string>("connection.instance") ?? "AD",
    ccsid: String(cfg.get<string>("restApiServer.ccsid") ?? "37"),
  };
}

export interface ArcadDeps {
  /** The Elias credentials, from the OS keychain — never from settings.json. */
  credentials: () => Promise<{ user: string; password: string } | undefined>;
}

export function buildArcadTools(deps: ArcadDeps): Tool[] {
  const action: Tool = {
    schema: {
      name: "arcad_action",
      description:
        `Run an ARCAD Elias action on the active component. Available actions: ${ACTIONS.map((a) => `${a.id} (${a.description})`).join("; ")}`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ACTIONS.map((a) => a.id), description: "Which action to run." },
        },
        required: ["action"],
      },
    },
    approval: (args) => {
      const entry = ACTIONS.find((a) => a.id === String(args["action"]));
      // Even the read-only ones are worth announcing: they open panels and hit the ARCAD server.
      return t("run the ARCAD action {0}", entry?.id ?? String(args["action"] ?? ""));
    },
    async run(args, ctx): Promise<ToolResult> {
      if (!arcadInstalled()) {
        throw new Error("ARCAD Elias is not installed. Install arcadsoftware.arcad-elias to use ARCAD actions.");
      }
      const entry = ACTIONS.find((a) => a.id === String(args["action"]));
      if (!entry) throw new Error(`Unknown ARCAD action “${String(args["action"])}”.`);
      const available = await vscode.commands.getCommands(true);
      if (!available.includes(entry.command)) {
        throw new Error(
          `ARCAD Elias does not expose ${entry.command} in this version. Check that the ARCAD module it belongs to is licensed.`,
        );
      }
      const result = await vscode.commands.executeCommand(entry.command);
      ctx.report(t("ARCAD: {0}", entry.id));
      return { content: result === undefined ? `Ran ${entry.command}.` : headToTokens(String(result), MAX_TOKENS) };
    },
  };

  const rest: Tool = {
    schema: {
      name: "arcad_rest",
      description:
        "Call the ARCAD Elias REST server the user has configured, at a path they supply. Forge does not know ARCAD's endpoint catalogue: use this only with a path the user or their ARCAD administrator has given, and say so when you do.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path on the Elias server, for example /AD/api/applications." },
          method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "Default GET." },
          body: { type: "string", description: "JSON body, for POST and PUT." },
        },
        required: ["path"],
      },
    },
    approval: (args) => {
      const method = String(args["method"] ?? "GET").toUpperCase();
      if (method === "GET") return false;
      return t("send {0} to the ARCAD server at {1}", method, String(args["path"] ?? ""));
    },
    async run(args, ctx): Promise<ToolResult> {
      const server = arcadServer();
      if (!server) {
        throw new Error(
          "No ARCAD server is configured. Set arcad.restApiServer.address (the Elias extension's own setting).",
        );
      }
      const path = String(args["path"] ?? "");
      if (!path.startsWith("/")) throw new Error("The path must start with a slash.");
      const method = String(args["method"] ?? "GET").toUpperCase();
      const credentials = await deps.credentials();
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      if (credentials) {
        headers["Authorization"] = `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString("base64")}`;
      }
      const response = await request(`${server.base}${path}`, {
        method,
        headers,
        body: args["body"] ? String(args["body"]) : undefined,
        timeoutMs: 30_000,
      });
      const text = await response.text();
      ctx.report(t("ARCAD {0} {1} → {2}", method, path, response.status));
      return {
        content: headToTokens(`HTTP ${response.status}\n${text}`, MAX_TOKENS),
        isError: !response.ok,
      };
    },
    restrict(): Tool {
      return {
        ...rest,
        schema: { ...rest.schema, description: `${rest.schema.description} In this mode only GET is accepted.` },
        approval: () => false,
        async run(args, ctx) {
          if (String(args["method"] ?? "GET").toUpperCase() !== "GET") {
            return { content: "Refused: plan mode sends GET and nothing else.", isError: true };
          }
          return rest.run(args, ctx);
        },
      };
    },
  };

  return [action, rest];
}
