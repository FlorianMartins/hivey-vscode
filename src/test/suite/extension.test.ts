// What only a real editor can tell us: that the extension activates, that everything the manifest
// promises actually exists, and that the pieces the user touches first are wired.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
// The settings namespace has one definition; a test that repeats it as a literal is a test that
// keeps passing after a rename has broken the product.
import { SECTION } from "../../extension/config.js";
import { openFileUris } from "../../extension/models.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { suite, test } from "./tiny.js";

const ID = "hivey.hivey-code";

suite("Hivey Code", () => {
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

  /**
   * "Attach all open editors" attached nothing, three times running.
   *
   * Each time the cause was different and each time I reasoned about it from the code instead of
   * running it, which is how a fix can be correct, shipped, and still leave the feature broken.
   * This opens real tabs in a real editor and asserts on what comes back — the only thing that
   * could have settled it, and the thing that should have been written after the first report.
   */
  test("the open tabs are found, and they are the tabs and not the visible editors", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const dir = await fs.mkdtemp(join(tmpdir(), "hivey-tabs-"));
    const made: vscode.Uri[] = [];
    for (const name of ["alpha.ts", "beta.ts", "gamma.ts"]) {
      const file = vscode.Uri.file(join(dir, name));
      await fs.writeFile(file.fsPath, `export const ${name.split(".")[0]} = 1;\n`, "utf8");
      made.push(file);
      // `preview: false` gives each its own tab; without it the editor reuses one and the third
      // file closes the second, which would make this test pass for the wrong reason.
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), { preview: false });
    }

    try {
      const found = openFileUris().map((u) => u.fsPath);
      for (const file of made) {
        assert.ok(found.includes(file.fsPath), `${file.fsPath} is open in a tab and was not found`);
      }

      // The distinction that broke it the first time: only one of these is on screen, and all
      // three are open.
      assert.ok(
        vscode.window.visibleTextEditors.length < made.length,
        "this assertion is only meaningful while fewer editors are visible than tabs are open",
      );

      // And the one that broke it the second time: these files are outside any workspace folder,
      // so a path rebuilt against the first folder would point nowhere.
      assert.equal(vscode.workspace.workspaceFolders, undefined, "the harness opens no folder");
      for (const uri of openFileUris()) {
        const doc = await vscode.workspace.openTextDocument(uri);
        assert.ok(doc.getText().length > 0, `${uri.fsPath} resolved to an empty document`);
      }

      // The whole path, not its first link. Finding the tabs was already proven above and the
      // feature was still broken, twice — because everything after it (turning a tab into a
      // context item, and the privacy check on the way) was never exercised by anything but a
      // person clicking. This runs it.
      const attached = (await vscode.commands.executeCommand<number>("hiveyCode.attachOpenEditors")) ?? 0;
      assert.equal(attached, made.length, `attached ${attached} of ${made.length} open tabs`);

      // Twice in a row attaches nothing new rather than duplicating the lot.
      const again = (await vscode.commands.executeCommand<number>("hiveyCode.attachOpenEditors")) ?? 0;
      assert.equal(again, 0, "the second pass duplicated attachments");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("the interface language can be pinned independently of the editor", async () => {
    const config = vscode.workspace.getConfiguration(SECTION);
    await config.update("language", "fr", vscode.ConfigurationTarget.Global);
    assert.equal(vscode.workspace.getConfiguration(SECTION).get("language"), "fr");
    await config.update("language", undefined, vscode.ConfigurationTarget.Global);
    assert.equal(vscode.workspace.getConfiguration(SECTION).get("language"), "auto", "the default follows the editor");
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
    const c = vscode.workspace.getConfiguration(SECTION);
    assert.equal(c.get("chat.provider"), "local");
    assert.equal(c.get("privacy.redaction"), "strict");
    assert.equal(c.get("completion.enabled"), true);
    assert.ok((c.get<string[]>("privacy.blockedGlobs") ?? []).includes("**/.env*"));
  });

  test("the inline completion provider survives a model server that is not there", async () => {
    // Point at a closed port so the failure is immediate and deterministic. This is the path a
    // user hits on their first day — before `ollama serve` — and it must produce no suggestion and
    // no error dialog, not an exception in the extension host.
    const config = vscode.workspace.getConfiguration(SECTION);
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

  test("pinning is a command, and says nothing to pin when there is nothing to pin", async () => {
    // The button lives in a hover row, which no test can press — the same shape of blind spot that
    // let three separate failures ship in "attach all open editors". As a command the path is
    // reachable: here for the empty case, and in the screenshot run for the real one, where a model
    // has actually answered.
    await vscode.commands.executeCommand("hiveyCode.newSession");
    const pinned = await vscode.commands.executeCommand<boolean | undefined>("hiveyCode.pinLastAnswer");
    assert.equal(pinned, undefined, "an empty conversation has no answer to pin");
  });

  test("the reports open without a script and without a model", async () => {
    await vscode.commands.executeCommand("hiveyCode.showEgress");
    await vscode.commands.executeCommand("hiveyCode.showCosts");
  });

  test("quick fixes are offered on a diagnostic", async () => {
    const doc = await vscode.workspace.openTextDocument({ language: "plaintext", content: "ligne en erreur\n" });
    const collection = vscode.languages.createDiagnosticCollection("hivey-code-test");
    const range = new vscode.Range(0, 0, 0, 5);
    collection.set(doc.uri, [new vscode.Diagnostic(range, "quelque chose ne va pas", vscode.DiagnosticSeverity.Error)]);

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", doc.uri, range);
    const titles = (actions ?? []).map((a) => a.title);
    // The title is translated, so match on the product name rather than on one language's wording.
    assert.ok(
      titles.some((title) => title.includes("Hivey Code")),
      `no Hivey Code quick fix among: ${titles.join(" | ")}`,
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
      if (!process.env["HIVEY_CODE_SCREENSHOT"]) return;

      const config = vscode.workspace.getConfiguration(SECTION);
      await config.update("endpoints.local", process.env["HIVEY_CODE_SCREENSHOT"], vscode.ConfigurationTarget.Global);
      await config.update("chat.model", "qwen2.5-coder:7b", vscode.ConfigurationTarget.Global);
      // HIVEY_CODE_LOCALE also drives the extension's own language setting, so the screenshots can show
      // the translated interface without installing a VS Code language pack.
      await config.update("language", process.env["HIVEY_CODE_LOCALE"] ?? "auto", vscode.ConfigurationTarget.Global);
      // The pre-send card waits for a click, and nothing clicks in a capture: leaving it on meant
      // the harness hung on the first question and photographed six empty screens while reporting
      // "the editor never announced it". Which was also the proof the card works.
      await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);
      // The panel claims to take the user's theme. The only way to check that claim rather than
      // repeat it is to photograph the same panel under two of them, so the harness can be told
      // which one to wear.
      if (process.env["HIVEY_CODE_THEME"]) {
        await vscode.workspace
          .getConfiguration("workbench")
          .update("colorTheme", process.env["HIVEY_CODE_THEME"], vscode.ConfigurationTarget.Global);
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
      // The right-hand copy is opened deliberately: the panel is declared in both places now, and a
      // photograph that shows only one of them would not show what shipped.
      await vscode.commands.executeCommand("hiveyCode.chatSide.focus").then(undefined, () => {});
      await vscode.commands.executeCommand("notifications.clearAll").then(undefined, () => {});
      await vscode.commands.executeCommand("hiveyCode.chat.focus");
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
      // A fresh profile opens on the setup screen, which is correct for a real first run and wrong
      // for a photograph of the conversation. `newSession` is the honest way back: it is what the
      // user clicks, not a flag that only exists for the camera.
      await vscode.commands.executeCommand("hiveyCode.newSession");
      await vscode.commands.executeCommand("hiveyCode.askWith", "Does this function round correctly? What should change?");
      await new Promise((r) => setTimeout(r, 4000));
      await vscode.commands.executeCommand("notifications.clearAll").then(undefined, () => {});

      // The capture script is a separate process, so the two used to agree by clock: it waited a
      // fixed time, we held each screen for a fixed time. Two clocks in two processes drift, and
      // when they do the result is not an error — it is three photographs of the same frame, or a
      // photograph of an editor still starting up. So the harness ANNOUNCES which screen is on
      // display by writing its name to a file, and the script waits for the name to change.
      const marker = process.env["HIVEY_CODE_SCREENSHOT_MARKER"];
      const hold = Number(process.env["HIVEY_CODE_SCREENSHOT_HOLD"] ?? 20_000);
      const announce = async (name: string) => {
        if (marker) await fs.writeFile(marker, name, "utf8");
        // Long enough for the panel to settle and for the script to photograph it.
        await new Promise((r) => setTimeout(r, hold));
      };

      // The panel's `ready` arrives after these commands and opens the setup screen on a fresh
      // profile, so the return to the conversation has to happen after it, not before.
      await new Promise((r) => setTimeout(r, 2500));
      await vscode.commands.executeCommand("hiveyCode.newSession");
      await vscode.commands.executeCommand("hiveyCode.askWith", "Does this function round correctly? What should change?");
      // A SECOND exchange, because one is not a transcript. What separates one turn from the next
      // — the rule above a question, carrying the way back to before it — only exists at a
      // boundary, and a photograph of a single question and its answer contains no boundary to
      // look at. This is the frame that shows whether a pair reads as a pair.
      //
      // Long enough for the first answer to finish: asked while the previous turn was still
      // streaming, the second question was dropped, and the frame came back with one exchange in
      // it and nothing to see.
      await new Promise((r) => setTimeout(r, 12_000));
      await vscode.commands.executeCommand("hiveyCode.askWith", "And the rounding of the VAT itself?");
      await new Promise((r) => setTimeout(r, 12_000));
      // Pinned, so the photograph carries the answer to "how do I know it is pinned?" — reported
      // twice as a button that does nothing, because what it did was invisible.
      const pinned = await vscode.commands.executeCommand<boolean | undefined>("hiveyCode.pinLastAnswer");
      assert.equal(pinned, true, "the last answer should now be pinned");

      // What is actually in the transcript, said by the transcript. A photograph shows a scroll
      // position, not a conversation: the frame that was supposed to prove a second exchange had
      // arrived was equally consistent with one exchange and a scrollbar, and there was no way to
      // tell from the picture which it was. The export is the product's own answer to the question.
      await vscode.commands.executeCommand("hiveyCode.exportSession");
      const exported = vscode.window.activeTextEditor?.document.getText() ?? "";
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      assert.ok(exported.includes("round correctly"), "the first question is in the transcript");
      assert.ok(exported.includes("rounding of the VAT"), `the second question is missing:\n${exported.slice(0, 600)}`);

      await announce("conversation");

      // A screen showing what an attachment actually looks like. Three separate fixes to "attach
      // all open editors" were verified by reasoning about the code, and the feature stayed broken
      // for the person using it — because nothing in the suite ever LOOKED at the result. This
      // opens real tabs and photographs the composer with them attached.
      const dir = await fs.mkdtemp(join(tmpdir(), "hivey-ctx-"));
      for (const name of ["invoice.ts", "rounding.ts", "totals.ts"]) {
        const file = vscode.Uri.file(join(dir, name));
        await fs.writeFile(file.fsPath, `export const ${name.split(".")[0]} = 1;\n`, "utf8");
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), { preview: false });
      }
      await vscode.commands.executeCommand("hiveyCode.attachOpenEditors");
      await announce("contexte");
      for (const [command, name] of [
        ["hiveyCode.setup", "setup"],
        ["hiveyCode.pickModel", "picker"],
        ["hiveyCode.showHistory", "historique"],
        ["hiveyCode.showModels", "modeles"],
        ["hiveyCode.showPermissions", "permissions"],
      ] as const) {
        await vscode.commands.executeCommand(command);
        await announce(name);
      }
      if (marker) await fs.writeFile(marker, "done", "utf8");
    },
    200_000,
  );
});
