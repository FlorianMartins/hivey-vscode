// What only a real editor can tell us: that the extension activates, that everything the manifest
// promises actually exists, and that the pieces the user touches first are wired.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
// The settings namespace has one definition; a test that repeats it as a literal is a test that
// keeps passing after a rename has broken the product.
import { SECTION, readSettings } from "../../extension/config.js";
import { buildTools } from "../../extension/tools.js";
import { buildKnowledgeTools, knowledgeAmbient } from "../../extension/knowledge.js";
import { openFileUris } from "../../extension/models.js";
import { DefinitionStore } from "../../extension/definitions.js";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { suite, test } from "./tiny.js";
import { createServer, type Server } from "node:http";

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

  test("every submenu referenced by a menu exists, and every submenu has rows", async () => {
    // A submenu is declared in one place and filled in another, keyed by a string. Get the string
    // wrong in either and there is no error anywhere: the right-click menu simply has one fewer
    // entry, or an entry that opens onto nothing. Nobody notices until somebody goes looking for a
    // feature they were told exists — which is how this one was asked for in the first place.
    const ext = vscode.extensions.getExtension(ID)!;
    const menus = ext.packageJSON.contributes.menus as Record<string, Array<{ submenu?: string }>>;
    const declared = new Set(
      (ext.packageJSON.contributes.submenus as Array<{ id: string }>).map((sm) => sm.id),
    );

    const referenced = new Set<string>();
    for (const rows of Object.values(menus)) for (const row of rows) if (row.submenu) referenced.add(row.submenu);

    assert.deepEqual([...referenced].filter((id) => !declared.has(id)), [], "submenus referenced but never declared");
    assert.deepEqual([...declared].filter((id) => !menus[id]?.length), [], "submenus declared but never filled");
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

  test("open tabs are found whatever scheme serves them", async () => {
    // The fourth report of "all open editors does nothing", and the first cause that a local file
    // could never show: the tabs were filtered by `uri.scheme === "file"`. That is true on a laptop
    // and false over SSH, in WSL, in a dev container, and on an IBM i — where every member a user
    // of this extension opens arrives under the scheme Code for IBM i registered. Three fixes and
    // an integration test had all been written against `file:` tabs, which is why none of them
    // caught it. An untitled document is the one non-`file:` scheme available in a bare harness,
    // and it is enough: what is being tested is that the SCHEME is not the test.
    const untitled = await vscode.workspace.openTextDocument({ language: "typescript", content: "export const x = 1;\n" });
    await vscode.window.showTextDocument(untitled, { preview: false });
    try {
      assert.notEqual(untitled.uri.scheme, "file", "the document under test is not a file: one");
      const found = openFileUris().map((u) => u.toString());
      assert.ok(
        found.includes(untitled.uri.toString()),
        `a non-file tab was skipped; found: ${found.join(", ") || "(none)"}`,
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
  });

  test("a personal skill is found with no folder open", async () => {
    // Reported from a window with no workspace: creating a skill answered "Open a folder first", so
    // the feature did not exist there at all — and a habit of your own had to be committed to
    // somebody's repository before you could use it. Definitions may now also live in the home
    // directory. This harness opens no folder, which is precisely the case that was broken, so the
    // store either reads them there or the fix is not a fix.
    const dir = join(homedir(), ".hiveycode", "skills");
    const file = join(dir, "harness-personal.md");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, "---\nname: harness-personal\ndescription: written by the test\n---\n\nBody.\n", "utf8");
    const disposables: vscode.Disposable[] = [];
    try {
      assert.equal(vscode.workspace.workspaceFolders, undefined, "the case under test is: no folder");
      const store = new DefinitionStore(disposables);
      const found = await store.load();
      assert.ok(
        found.skills.some((sk) => sk.name === "harness-personal"),
        `the personal skill was not read: ${found.skills.map((sk) => sk.name).join(", ") || "(none)"}`,
      );
    } finally {
      await fs.rm(file, { force: true });
      for (const d of disposables) d.dispose();
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

  test("the selection offers are on the lightbulb, and the way to the rest is with them", async () => {
    // The catalogue is unit-tested; what cannot be unit-tested is whether the editor ever asks for
    // it. This asks the way the editor does, over a real selection with no diagnostic in sight —
    // the case the provider used to answer with nothing at all.
    const doc = await vscode.workspace.openTextDocument({ language: "javascript", content: "function f(a) {\n  return a + 1;\n}\n" });
    await vscode.window.showTextDocument(doc);
    const range = new vscode.Range(0, 0, 2, 1);

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", doc.uri, range);
    const ours = (actions ?? []).filter((a) => a.command?.command?.startsWith("hiveyCode."));
    const commands = ours.map((a) => a.command!.command);

    // Each row must carry a command that exists, or it is a menu entry that does nothing when
    // clicked — silent, and only findable by clicking it.
    const registered = await vscode.commands.getCommands(true);
    assert.deepEqual(commands.filter((c) => !registered.includes(c)), [], `unregistered: ${commands.join(", ")}`);
    assert.ok(commands.includes("hiveyCode.selectionActions"), `no way to the full list among: ${commands.join(" | ")}`);
    assert.ok(ours.length >= 3, `only ${ours.length} offers on a selection`);
  });

  /**
   * "The stop button does nothing."
   *
   * Every layer of this looked right when read: the panel swaps send for stop while streaming, the
   * message arrives, the controller is aborted, the loop checks the signal at every step, the SSE
   * reader cancels. Reading is how the last three of these were "verified" before, and each time
   * the feature was still broken. So this runs it: a server that streams and never stops, a real
   * turn against it, and the assertion that the turn ENDS — not that abort was called.
   */
  test("stopping an answer actually ends the turn", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await streamingStub();
    const restore = await useStub(stub.port);

    try {
      // Not awaited: this promise resolves when the TURN ends, which is the thing being measured.
      const turn = vscode.commands.executeCommand("hiveyCode.askWith", "keep talking");

      let stopped = false;
      for (let i = 0; i < 100 && !stopped; i++) {
        await delay(50);
        stopped = Boolean(await vscode.commands.executeCommand<boolean>("hiveyCode.stopAnswer"));
      }
      assert.ok(stopped, "no turn was ever running to stop");

      // Released immediately, not when the abort finishes travelling: pressing stop a second time
      // must find nothing running. A tool that ignores cancellation is why this matters — the panel
      // cannot be left waiting on a query that will return when it feels like it.
      assert.equal(
        await vscode.commands.executeCommand<boolean>("hiveyCode.stopAnswer"),
        false,
        "the panel was still held by the stopped turn",
      );

      const ended = await Promise.race([turn.then(() => "ended"), delay(4000).then(() => "still running")]);
      assert.equal(ended, "ended", "the turn was aborted but never finished");

      // And the connection is gone, not merely ignored: an abort that leaves the model generating
      // is still being paid for on a metered endpoint, and still holding the GPU on a local one.
      for (let i = 0; i < 40 && stub.open() > 0; i++) await delay(50);
      assert.equal(stub.open(), 0, "the request to the model is still open after stopping");
    } finally {
      await restore();
      stub.close();
    }
  });

  /**
   * Stop, then ask something else — and the stop button is dead for the rest of the conversation.
   *
   * This is the shape the complaint actually had, and it is a race rather than a wiring mistake,
   * which is why every reading of the wiring found nothing. A stopped turn unwinds through the
   * provider and lands in its cleanup a few milliseconds later; the next question has already
   * started by then, and the cleanup used to clear `this.turn` unconditionally — throwing away the
   * NEW turn's controller. Nothing left to abort, no error anywhere, and the only symptom is a
   * button that does nothing.
   */
  test("a turn started right after a stop is still stoppable", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    // The second request holds its headers back, so the first turn's cleanup is guaranteed to land
    // while the second turn is running rather than before it starts. Without that the race decides
    // the result and the test says nothing on the runs where it falls the other way.
    const stub = await streamingStub({ delayAfterFirst: 400 });
    const restore = await useStub(stub.port);

    try {
      const first = vscode.commands.executeCommand("hiveyCode.askWith", "first question");
      let stopped = false;
      for (let i = 0; i < 100 && !stopped; i++) {
        await delay(50);
        stopped = Boolean(await vscode.commands.executeCommand<boolean>("hiveyCode.stopAnswer"));
      }
      assert.ok(stopped, "the first turn never started");

      // No pause: asking again immediately is precisely what someone does after pressing stop.
      const second = vscode.commands.executeCommand("hiveyCode.askWith", "second question");

      let stoppedSecond = false;
      for (let i = 0; i < 100 && !stoppedSecond; i++) {
        await delay(50);
        stoppedSecond = Boolean(await vscode.commands.executeCommand<boolean>("hiveyCode.stopAnswer"));
      }
      assert.ok(stoppedSecond, "the second turn could not be stopped — its controller was thrown away");

      const ended = await Promise.race([
        Promise.all([first, second]).then(() => "ended"),
        delay(5000).then(() => "still running"),
      ]);
      assert.equal(ended, "ended", "a turn was aborted but never finished");
    } finally {
      await restore();
      stub.close();
    }
  });

  /**
   * Stop while the send confirmation is on screen.
   *
   * This is the window every question passes through — `privacy.confirmSend` is "always" by default
   * — and the card was waiting on a promise with no second way out. Cancelling travelled to a turn
   * parked on a question nobody was going to answer: the turn never ended, the panel kept its stop
   * button, and pressing it again aborted an already-aborted controller. A dead button for the rest
   * of the conversation, with nothing in any log to say why.
   *
   * Found by CI failing where a developer machine passed, because the profile there had answered
   * this card once with "always" years of test runs ago.
   */
  test("stopping while the send confirmation is up ends the turn", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();
    const stub = await streamingStub();
    const restore = await useStub(stub.port, "always");

    try {
      const turn = vscode.commands.executeCommand("hiveyCode.askWith", "a question nobody confirms");

      let stopped = false;
      for (let i = 0; i < 60 && !stopped; i++) {
        await delay(50);
        stopped = Boolean(await vscode.commands.executeCommand<boolean>("hiveyCode.stopAnswer"));
      }
      assert.ok(stopped, "the turn never started");

      const ended = await Promise.race([turn.then(() => "ended"), delay(4000).then(() => "still running")]);
      assert.equal(ended, "ended", "the turn is parked on a confirmation nobody will answer");

      // And nothing was sent: the card is answered "no" by the stop, not left to fall through.
      assert.equal(stub.open(), 0, "a request went out despite the stop");
    } finally {
      await restore();
      stub.close();
    }
  });

  /**
   * "The agent said my folder was not open, and it is."
   *
   * This harness opens no folder, which is the case itself: a window with files in it and no folder
   * — ordinary when the files come from a remote or an IBM i partition. Every file tool used to
   * answer "No folder is open", which to somebody looking at their open files reads as the
   * extension having lost the workspace.
   */
  test("a file tool finds an open file when no folder is open", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();
    assert.equal(vscode.workspace.workspaceFolders, undefined, "the case under test is: no folder");

    const dir = await fs.mkdtemp(join(tmpdir(), "hivey-code-nofolder-"));
    const file = join(dir, "facture.ts");
    await fs.writeFile(file, "export const tva = 0.21;\n", "utf8");
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);

    try {
      const read = buildTools({ settings: () => readSettings() }).find((t) => t.schema.name === "read_file");
      assert.ok(read, "read_file is not among the tools");
      const result = await read!.run({ path: "facture.ts" }, { report: () => {} });
      assert.ok(result.content.includes("tva"), `read_file answered: ${result.content}`);

      // And a name nothing matches says what is actually available rather than blaming the folder.
      const missing = await read!.run({ path: "nowhere.ts" }, { report: () => {} }).catch((e: Error) => ({
        content: e.message,
      }));
      assert.match(missing.content, /open file|Ask the user to open/i, missing.content);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * The knowledge base, end to end, against a real filesystem.
   *
   * The core is unit-tested; what only a real editor can settle is whether the files are written
   * where the store says they are, read back as notes, and taken out of the base when retired.
   */
  test("a note can be recorded, found, and retired", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const home = await fs.mkdtemp(join(tmpdir(), "hivey-code-knowledge-"));
    const realHome = process.env["HOME"];
    process.env["HOME"] = home;

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = { enabled: config.get("knowledge.enabled"), scope: config.get("knowledge.scope") };
    await config.update("knowledge.enabled", true, vscode.ConfigurationTarget.Global);
    await config.update("knowledge.scope", "personal", vscode.ConfigurationTarget.Global);

    try {
      const tools = buildKnowledgeTools(() => readSettings());
      const tool = (name: string) => tools.find((t) => t.schema.name === name)!;
      const ctx = { report: () => {} };

      const written = await tool("knowledge_write").run(
        {
          id: "finance/invoice-settlement",
          title: "How an invoice is settled",
          body: "The settlement job runs before the nightly batch. Amounts are in cents.",
          tags: "finance, batch",
        },
        ctx,
      );
      assert.equal(written.isError, undefined, written.content);

      // On disk, where the setting says, and readable by a person.
      const file = join(home, ".hiveycode", "knowledge", "finance", "invoice-settlement.md");
      const text = await fs.readFile(file, "utf8");
      assert.match(text, /title: How an invoice is settled/);
      assert.match(text, /nightly batch/);

      const found = await tool("knowledge_search").run({ query: "settlement" }, ctx);
      assert.match(found.content, /finance\/invoice-settlement/);

      // The same subject under another name is refused, with what already covers it.
      const again = await tool("knowledge_write").run(
        { id: "finance/settlement-of-invoices", title: "Invoice settlement", body: "..." },
        ctx,
      );
      assert.equal(again.isError, true, "a second note on the same subject was accepted");
      assert.match(again.content, /finance\/invoice-settlement/);

      // The index the model sees on every turn lists it.
      const ambient = await knowledgeAmbient(readSettings());
      assert.ok(ambient?.includes("How an invoice is settled"), ambient ?? "(no index)");

      // Retiring takes it out of the base and keeps it on disk.
      const gone = await tool("knowledge_retire").run({ id: "finance/invoice-settlement", reason: "the job was replaced" }, ctx);
      assert.equal(gone.isError, undefined, gone.content);
      await assert.rejects(fs.readFile(file, "utf8"), "the note is still where it was");
      const archived = await fs.readFile(
        join(home, ".hiveycode", "knowledge", ".archive", "finance", "invoice-settlement.md"),
        "utf8",
      );
      assert.match(archived, /retired-because: the job was replaced/);
      assert.equal(await knowledgeAmbient(readSettings()), undefined, "a retired note is still in the index");
    } finally {
      if (realHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = realHome;
      await config.update("knowledge.enabled", before.enabled, vscode.ConfigurationTarget.Global);
      await config.update("knowledge.scope", before.scope, vscode.ConfigurationTarget.Global);
      await fs.rm(home, { recursive: true, force: true });
    }
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A model server that starts answering and never stops.
 *
 * A stub that finishes on its own would let "stopping works" pass without the stop doing anything,
 * which is the one result these tests must not be able to produce.
 */
async function streamingStub(opts: { delayAfterFirst?: number } = {}): Promise<{
  port: number;
  open: () => number;
  close: () => void;
}> {
  let open = 0;
  let served = 0;
  const server: Server = createServer((req, res) => {
    if (req.url?.includes("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
      return;
    }
    const begin = (): void => {
      open += 1;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const timer = setInterval(() => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "encore " } }] })}\n\n`);
      }, 20);
      // Both events fire for one aborted connection, so the bookkeeping has to be idempotent —
      // without this the counter went to -1 and the test blamed the product for its own arithmetic.
      let counted = true;
      const stop = (): void => {
        clearInterval(timer);
        if (counted) open -= 1;
        counted = false;
      };
      res.on("close", stop);
      req.on("aborted", stop);
    };
    const wait = served++ === 0 ? 0 : (opts.delayAfterFirst ?? 0);
    if (wait) setTimeout(begin, wait);
    else begin();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    port: (server.address() as { port: number }).port,
    open: () => open,
    close: () => server.close(),
  };
}

/**
 * Points the extension at the stub, and hands back the way to put the settings as they were.
 *
 * `confirmSend` is set explicitly rather than left at whatever the profile holds, and that is not
 * tidiness: it defaults to "always", so a turn stops at a card before it ever reaches the model.
 * A test that does not say which it wants is testing a different code path on a fresh profile than
 * on a used one — which is precisely what happened: these tests passed on a developer machine and
 * failed in CI, and the difference was this setting.
 */
async function useStub(port: number, confirmSend: "always" | "never" = "never"): Promise<() => Promise<void>> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const before = {
    provider: config.get("chat.provider"),
    model: config.get("chat.model"),
    endpoint: config.get("endpoints.local"),
    confirmSend: config.get("privacy.confirmSend"),
  };
  await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
  await config.update("chat.model", "stub-model", vscode.ConfigurationTarget.Global);
  await config.update("endpoints.local", `http://127.0.0.1:${port}/v1`, vscode.ConfigurationTarget.Global);
  await config.update("privacy.confirmSend", confirmSend, vscode.ConfigurationTarget.Global);
  return async () => {
    await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
    await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", before.endpoint, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", before.confirmSend, vscode.ConfigurationTarget.Global);
  };
}
