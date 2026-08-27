// What only a real editor can tell us: that the extension activates, that everything the manifest
// promises actually exists, and that the pieces the user touches first are wired.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import { suite, test } from "./tiny.js";

const ID = "hivey.forge";

suite("Forge", () => {
  test("the extension is present and activates", async () => {
    const ext = vscode.extensions.getExtension(ID);
    assert.ok(ext, "extension not found by id");
    await ext!.activate();
    assert.equal(ext!.isActive, true);
  });

  test("every command the manifest declares is registered", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();
    const declared: string[] = (ext.packageJSON.contributes.commands as Array<{ command: string }>).map((c) => c.command);
    const registered = await vscode.commands.getCommands(true);
    const missing = declared.filter((c) => !registered.includes(c));
    assert.deepEqual(missing, [], `commands declared but not registered: ${missing.join(", ")}`);
  });

  test("the interface language can be pinned independently of the editor", async () => {
    const config = vscode.workspace.getConfiguration("forge");
    await config.update("language", "fr", vscode.ConfigurationTarget.Global);
    assert.equal(vscode.workspace.getConfiguration("forge").get("language"), "fr");
    await config.update("language", undefined, vscode.ConfigurationTarget.Global);
    assert.equal(vscode.workspace.getConfiguration("forge").get("language"), "auto", "the default follows the editor");
  });

  test("the manifest is localised: no unresolved %key% reaches the user", async () => {
    // `package.nls.json` is resolved by VS Code when it loads the extension. If a key is missing
    // from it, the raw `%command.x.title%` is what the command palette shows — which is the kind of
    // defect that only appears once, in front of everyone.
    const ext = vscode.extensions.getExtension(ID)!;
    const raw: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string" && /^%.+%$/.test(value)) raw.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(ext.packageJSON.contributes);
    walk(ext.packageJSON.description);
    assert.deepEqual(raw, [], `unresolved manifest keys: ${raw.join(", ")}`);

    const commands = ext.packageJSON.contributes.commands as Array<{ title: string; category?: string }>;
    assert.ok(commands.every((c) => c.title.length > 2));
  });

  test("settings read back with the defaults the manifest declares", () => {
    const c = vscode.workspace.getConfiguration("forge");
    assert.equal(c.get("chat.provider"), "local");
    assert.equal(c.get("privacy.redaction"), "strict");
    assert.equal(c.get("completion.enabled"), true);
    assert.ok((c.get<string[]>("privacy.blockedGlobs") ?? []).includes("**/.env*"));
  });

  test("the inline completion provider survives a model server that is not there", async () => {
    // Point at a closed port so the failure is immediate and deterministic. This is the path a
    // user hits on their first day — before `ollama serve` — and it must produce no suggestion and
    // no error dialog, not an exception in the extension host.
    const config = vscode.workspace.getConfiguration("forge");
    await config.update("endpoints.local", "http://127.0.0.1:45387/v1", vscode.ConfigurationTarget.Global);
    await config.update("completion.debounceMs", 0, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument({ language: "javascript", content: "function add(a, b) {\n  \n}\n" });
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(1, 2, 1, 2);

      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes("vscode.executeInlineCompletionProvider")) return; // older host: nothing to drive
      const result = await vscode.commands.executeCommand<{ items: unknown[] }>(
        "vscode.executeInlineCompletionProvider",
        doc.uri,
        editor.selection.active,
      );
      assert.equal(result?.items.length ?? 0, 0, "no suggestion when no server answers");
    } finally {
      await config.update("endpoints.local", undefined, vscode.ConfigurationTarget.Global);
      await config.update("completion.debounceMs", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("the reports open without a script and without a model", async () => {
    await vscode.commands.executeCommand("forge.showEgress");
    await vscode.commands.executeCommand("forge.showCosts");
  });

  test("quick fixes are offered on a diagnostic", async () => {
    const doc = await vscode.workspace.openTextDocument({ language: "plaintext", content: "ligne en erreur\n" });
    const collection = vscode.languages.createDiagnosticCollection("forge-test");
    const range = new vscode.Range(0, 0, 0, 5);
    collection.set(doc.uri, [new vscode.Diagnostic(range, "quelque chose ne va pas", vscode.DiagnosticSeverity.Error)]);

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", doc.uri, range);
    const titles = (actions ?? []).map((a) => a.title);
    // The title is translated, so match on the product name rather than on one language's wording.
    assert.ok(
      titles.some((title) => title.includes("Forge")),
      `no Forge quick fix among: ${titles.join(" | ")}`,
    );
    collection.dispose();
  });
});

// Screenshot mode. Not a test: it drives a real conversation against a stub model server, then
// holds the window open while an outside process captures the screen. Guarded by an environment
// variable so it never runs in CI. Everything on the resulting image is real UI rendering real
// content — the only thing faked is the model that answered.
suite("Screenshot", () => {
  test(
    "hold the window open with a real conversation",
    async () => {
      if (!process.env["FORGE_SCREENSHOT"]) return;

      const config = vscode.workspace.getConfiguration("forge");
      await config.update("endpoints.local", process.env["FORGE_SCREENSHOT"], vscode.ConfigurationTarget.Global);
      await config.update("chat.model", "qwen2.5-coder:7b", vscode.ConfigurationTarget.Global);
      // FORGE_LOCALE also drives the extension's own language setting, so the screenshots can show
      // the translated interface without installing a VS Code language pack.
      await config.update("language", process.env["FORGE_LOCALE"] ?? "auto", vscode.ConfigurationTarget.Global);
      // The panel claims to take the user's theme. The only way to check that claim rather than
      // repeat it is to photograph the same panel under two of them, so the harness can be told
      // which one to wear.
      if (process.env["FORGE_THEME"]) {
        await vscode.workspace
          .getConfiguration("workbench")
          .update("colorTheme", process.env["FORGE_THEME"], vscode.ConfigurationTarget.Global);
        await new Promise((r) => setTimeout(r, 1200));
      }

      const doc = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: [
        "export function totalTTC(lignes: Ligne[], tauxTVA = 0.2): number {",
        "  const ht = lignes.reduce((somme, l) => somme + l.prixUnitaire * l.quantite, 0);",
        "  return ht * (1 + tauxTVA);",
        "}",
        "",
      ].join("\n"),
      });
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(0, 0, 3, 1);

      // Tidy the window for the capture: no auxiliary chat panel, no notification toast, and a
      // sidebar wide enough to read — the width a user would actually give it.
      await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar").then(undefined, () => {});
      await vscode.commands.executeCommand("notifications.clearAll").then(undefined, () => {});
      await vscode.commands.executeCommand("forge.chat.focus");
      // `increaseViewSize` resizes whatever part has focus. Revealing the view is not the same as
      // focusing the side bar — the editor keeps the focus — so without this the loop below
      // silently widened the editor group instead, and every screenshot showed a 280 px panel
      // nobody would actually work in.
      // Two commands because which one exists depends on the build, and a missing one rejects
      // rather than throwing here. Fourteen presses is a comfortable working width, not a stunt:
      // the panel is designed to survive 260 px, and the screenshots should show what someone who
      // uses it every day would actually give it.
      // No attempt to widen the panel. `increaseViewSize` grows whatever holds the focus, and a
      // webview view hands the focus straight back to the editor group, so pressing it fourteen
      // times squeezed the panel to 150 px instead of widening it; the opposite command changed
      // nothing at all. The screenshots therefore show the side bar at its DEFAULT width, which is
      // the honest thing to publish anyway — it is what someone sees the minute they install this,
      // and a panel that only looks right after the user drags it wider does not look right.
      await vscode.commands.executeCommand("forge.askWith", "Does this function round correctly? What should change?");
      await new Promise((r) => setTimeout(r, 4000));
      await vscode.commands.executeCommand("notifications.clearAll").then(undefined, () => {});

      // The capture script is a separate process, so the two used to agree by clock: it waited a
      // fixed time, we held each screen for a fixed time. Two clocks in two processes drift, and
      // when they do the result is not an error — it is three photographs of the same frame, or a
      // photograph of an editor still starting up. So the harness ANNOUNCES which screen is on
      // display by writing its name to a file, and the script waits for the name to change.
      const marker = process.env["FORGE_SCREENSHOT_MARKER"];
      const hold = Number(process.env["FORGE_SCREENSHOT_HOLD"] ?? 20_000);
      const announce = async (name: string) => {
        if (marker) await fs.writeFile(marker, name, "utf8");
        // Long enough for the panel to settle and for the script to photograph it.
        await new Promise((r) => setTimeout(r, hold));
      };

      await announce("conversation");
      for (const [command, name] of [
        ["forge.pickModel", "picker"],
        ["forge.showHistory", "historique"],
        ["forge.showModels", "modeles"],
        ["forge.showPermissions", "permissions"],
      ] as const) {
        await vscode.commands.executeCommand(command);
        await announce(name);
      }
      if (marker) await fs.writeFile(marker, "done", "utf8");
    },
    200_000,
  );
});
