// What only a real editor can tell us: that the extension activates, that everything the manifest
// promises actually exists, and that the pieces the user touches first are wired.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
// The settings namespace has one definition; a test that repeats it as a literal is a test that
// keeps passing after a rename has broken the product.
import { SECTION, managedSettings, readSettings, providerFor, restoreMisplacedGatewayAddress, Keys } from "../../extension/config.js";
import { reloadPolicy } from "../../extension/policy.js";
import { generateKeyPairSync, sign } from "node:crypto";
import { buildTools } from "../../extension/tools.js";
import { relative } from "../../extension/workspace.js";
import { buildKnowledgeTools, knowledgeAmbient, knowledgeStore } from "../../extension/knowledge.js";
import { listModels, openFileUris } from "../../extension/models.js";
import { DefinitionStore } from "../../extension/definitions.js";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { suite, test } from "./tiny.js";
import { createServer, type Server } from "node:http";
import * as zlib from "node:zlib";
import { HIVEY_ROUTING } from "../../core/router/hivey.generated.js";

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
    // A provider that BILLS: the card exists to consent to a price, and is not opened when there is
    // no price to consent to. On the local provider there is nothing for this test to stop on.
    const restore = await useStub(stub.port, "always", "openrouter");

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

  /**
   * The loop the agent rests on: run something, read what it printed.
   *
   * `run_command` used to return the sentence "ask the user what it printed", which made every
   * "run the tests and fix what fails" turn a round trip through a human — and, more often, a model
   * that asserted success it had no evidence for. This test asks for a command whose output is
   * known and checks that the output came back.
   *
   * It is deliberately tolerant of ONE thing and strict about everything else: shell integration is
   * a property of the shell, so a machine whose shell has none is a legitimate "not captured". What
   * is never legitimate is claiming a result. So the branch that cannot read says so in words, and
   * the branch that can must produce the real output and the real exit code.
   */
  test("a command run in the editor comes back with its output and its exit code", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const run = buildTools({ settings: () => readSettings() }).find((tool) => tool.schema.name === "run_command");
    assert.ok(run, "run_command is not among the tools");

    // Whether this machine's shell CAN be read is established first, and separately, because a test
    // that accepts either answer proves nothing: with the capture removed it would still pass, on
    // the strength of the branch that says "I could not read it". So the question is asked once,
    // of the editor, and the answer decides which assertion is the honest one to make.
    const probe = vscode.window.createTerminal({ name: "hivey-probe" });
    const integrated = await new Promise<boolean>((resolve) => {
      if (probe.shellIntegration) return resolve(true);
      const timer = setTimeout(() => {
        sub.dispose();
        resolve(false);
      }, 5000);
      const sub = vscode.window.onDidChangeTerminalShellIntegration((ev) => {
        if (ev.terminal !== probe) return;
        clearTimeout(timer);
        sub.dispose();
        resolve(true);
      });
    });
    probe.dispose();

    const marker = `hivey-${Date.now().toString(36)}`;
    // A short budget on purpose: the point of the test is what comes back, and a shell that never
    // reports the end of a command must not hold the suite for the default two minutes.
    const result = await run!.run({ command: `echo ${marker}`, timeoutMs: 8000 }, { report: () => {} });
    const captured = (result.display as { captured?: boolean } | undefined)?.captured;

    if (!integrated) {
      // A shell with no integration script. The command still runs; what must never happen is a
      // result that reads like success, so that is what is checked here.
      assert.equal(captured, false, "the output was read on a shell that has no integration");
      assert.match(result.content, /could not be read/i, result.content);
      assert.match(result.content, /ask the user|Do not assume/i, result.content);
      return;
    }

    assert.equal(captured, true, `this shell reports integration, so the output must be read: ${result.content}`);
    assert.match(result.content, new RegExp(marker), `the output was not returned: ${result.content}`);
    assert.match(result.content, /exit code 0/, result.content);
    assert.ok(!result.isError, "a command that succeeded was reported as an error");
    assert.equal((result.display as { exitCode?: number }).exitCode, 0);

    // And a command that fails is reported as a failure, which is the half the agent acts on.
    // In a sub-shell: a bare `exit 3` would end the shell the terminal is running, which is a way
    // of failing that tells us nothing about how failures are reported.
    const failed = await run!.run({ command: "sh -c 'exit 3'", timeoutMs: 8000 }, { report: () => {} });
    assert.equal(failed.isError, true, `a non-zero exit was not an error: ${failed.content}`);
    assert.match(failed.content, /exit code 3/, failed.content);
  });

  /**
   * The prefix must be byte-identical from one turn to the next, or the prompt cache is decoration.
   *
   * Every provider's cache hits up to the first byte that differs. So one line in the system prompt
   * that follows the open editor around does not cost that line — it costs the WHOLE prefix, on
   * every turn, repository map included, on exactly the providers that bill for it. Two things used
   * to sit in there and change: the dialect note, derived from the attached files, and the
   * repository map, re-ranked around whichever tab was in front.
   *
   * Nothing about that is visible from reading the code, which is why it is asserted on the socket:
   * two turns, a different file open for each, and the first message of the request compared byte
   * for byte.
   */
  test("the cacheable prefix does not change when the open file does", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([{ text: "one" }, { text: "two" }]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      local: config.get("endpoints.local"),
      confirm: config.get("privacy.confirmSend"),
    };
    const dir = await fs.mkdtemp(join(tmpdir(), "hivey-prefix-"));
    await fs.writeFile(join(dir, "a.sql"), "select * from QSYS2.SYSTABLES\n");
    await fs.writeFile(join(dir, "b.py"), "def total(x):\n    return x\n");

    await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "prefix-model", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    const systemOf = (body: string): string => {
      const messages = JSON.parse(body).messages as Array<{ role: string; content: string }>;
      return messages.find((m) => m.role === "system")?.content ?? "";
    };

    try {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(join(dir, "a.sql")));
      void vscode.commands.executeCommand("hiveyCode.askWith", "first question");
      for (let i = 0; i < 100 && stub.bodies().length < 1; i++) await delay(50);

      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(join(dir, "b.py")));
      void vscode.commands.executeCommand("hiveyCode.askWith", "second question");
      for (let i = 0; i < 100 && stub.bodies().length < 2; i++) await delay(50);
      await vscode.commands.executeCommand("hiveyCode.stopAnswer");

      const bodies = stub.bodies();
      assert.ok(bodies.length >= 2, `only ${bodies.length} requests were sent`);
      assert.equal(
        systemOf(bodies[0]!),
        systemOf(bodies[1]!),
        "the system prompt changed between two turns, so the prompt cache misses on the whole prefix",
      );
      // And the per-turn material still reaches the model — moved, not dropped. It arrives after
      // the transcript, which is also where a model reads it last.
      const second = JSON.parse(bodies[1]!).messages as Array<{ role: string; content: string }>;
      assert.ok(second.length > 1, "the request has no messages after the system prompt");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(dir, { recursive: true, force: true });
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.local, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * A rate limit must not end the turn.
   *
   * The free preset routes to endpoints that are free because they are rate-limited, so a 429 was
   * the ordinary case rather than the exceptional one — and it lost the answer. The other half is
   * the argument no hosted assistant can make: when the network stops, there is usually a model on
   * the machine already, so a provider that will not answer is a reason to fall back rather than a
   * reason to stop working.
   */
  test("a provider that refuses with a rate limit is answered by the next endpoint down", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const remote = await scriptedStub([{ status: 429 }]);
    const local = await scriptedStub([{ text: "Answered on this machine." }]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      openrouter: config.get("endpoints.openrouter"),
      localUrl: config.get("endpoints.local"),
      completionModel: config.get("completion.model"),
      confirm: config.get("privacy.confirmSend"),
    };
    await config.update("chat.provider", "openrouter", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "busy-remote", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.openrouter", `http://127.0.0.1:${remote.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", `http://127.0.0.1:${local.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("completion.model", "on-my-machine", vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    try {
      void vscode.commands.executeCommand("hiveyCode.askWith", "hello");
      for (let i = 0; i < 200 && !local.asked().length; i++) await delay(50);
      await vscode.commands.executeCommand("hiveyCode.stopAnswer");

      assert.deepEqual(remote.asked(), ["busy-remote"], "the chosen model should be tried first, once");
      assert.deepEqual(
        local.asked(),
        ["on-my-machine"],
        `the turn was not carried on by the machine: ${local.asked().join(", ")}`,
      );
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.openrouter", before.openrouter, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.localUrl, vscode.ConfigurationTarget.Global);
      await config.update("completion.model", before.completionModel, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      remote.close();
      local.close();
    }
  });

  /**
   * The edit somewhere else.
   *
   * Completion answers "what comes next at the cursor", which is the wrong question about half the
   * time: most editing is propagating a change you have just made to the three other places that
   * mention it. Those places are not at the cursor, so no cursor completion can reach them.
   *
   * The check is on what the user would actually see — a hint in the file, at the right place, with
   * a quick fix that applies it — because everything in between (the journal, the debounce, the
   * prompt, the validation) exists only to produce that.
   */
  test("after an edit, the follow-up edit elsewhere in the file is offered", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([
      { text: "FIND\nconst y = oldName(3);\nREPLACE\nconst y = newName(3);\nEND" },
    ]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("completion.provider"),
      model: config.get("completion.model"),
      local: config.get("endpoints.local"),
      enabled: config.get("completion.enabled"),
      nextEdit: config.get("completion.nextEdit"),
    };
    const dir = await fs.mkdtemp(join(tmpdir(), "hivey-next-"));
    const file = join(dir, "app.js");
    await fs.writeFile(file, ["function newName(a) {", "  return a;", "}", "", "const y = oldName(3);", ""].join("\n"));

    await config.update("completion.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("completion.model", "little-model", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("completion.enabled", true, vscode.ConfigurationTarget.Global);
    await config.update("completion.nextEdit", true, vscode.ConfigurationTarget.Global);

    try {
      const doc = await vscode.workspace.openTextDocument(file);
      const editor = await vscode.window.showTextDocument(doc);
      // The rename that the suggestion should follow from. Typed into the file, because the whole
      // trigger is "the user changed something" — opening a file must never make a model run.
      await editor.edit((b) => b.replace(new vscode.Range(0, 9, 0, 16), "newName"));
      editor.selection = new vscode.Selection(1, 0, 1, 0);

      const hints = async (): Promise<vscode.Diagnostic[]> =>
        vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === "Hivey Code");
      for (let i = 0; i < 100 && !(await hints()).length; i++) await delay(100);

      const found = await hints();
      assert.ok(found.length, `no suggestion appeared; the stub was asked ${stub.asked().length} times`);
      assert.equal(found[0]!.severity, vscode.DiagnosticSeverity.Hint, "a suggestion must not look like an error");
      assert.match(found[0]!.message, /oldName/, found[0]!.message);
      // And at the right place: line 5 of the file, not wherever the cursor is.
      assert.equal(found[0]!.range.start.line, 4, "the hint is not on the line it is about");

      // The quick fix that takes it, and the effect of taking it.
      const actions = (await vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        doc.uri,
        found[0]!.range,
      )) ?? [];
      assert.ok(
        actions.some((a) => a.command?.command === "hiveyCode.applyNextEdit"),
        `no way to apply it: ${actions.map((a) => a.title).join(" | ")}`,
      );
      await vscode.commands.executeCommand("hiveyCode.applyNextEdit");
      assert.match(doc.getText(), /const y = newName\(3\);/, doc.getText());
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(dir, { recursive: true, force: true });
      await config.update("completion.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("completion.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.local, vscode.ConfigurationTarget.Global);
      await config.update("completion.enabled", before.enabled, vscode.ConfigurationTarget.Global);
      await config.update("completion.nextEdit", before.nextEdit, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * An address without a scheme must not become "Invalid URL" on every question for ever.
   *
   * `api.openai.com/v1` is what a documentation page shows and what a browser accepts. To `fetch`
   * it is a relative path, so the request fails with a message naming no cause and suggesting no
   * action — while the key is fine and the account is fine. Reported as "the extension no longer
   * works", which from the outside is exactly what it looks like.
   */
  test("an endpoint with no scheme fails with a sentence that says what to put instead", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = { provider: config.get("chat.provider"), model: config.get("chat.model"), url: config.get("endpoints.openrouter") };
    await config.update("chat.provider", "openrouter", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "some-model", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.openrouter", "api.openai.com/v1", vscode.ConfigurationTarget.Global);

    try {
      const settings = readSettings();
      let message = "";
      try {
        // The keychain is never reached: the address is checked before the key is looked up, which
        // is the point — a bad address must not be reported as a missing key.
        const noSecrets = {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined,
          keys: async () => [],
          onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
        } as unknown as vscode.SecretStorage;
        await providerFor(settings, new Keys(noSecrets), "openrouter");
      } catch (err) {
        message = (err as Error).message;
      }
      assert.ok(message, "an unusable address was accepted");
      assert.match(message, /openrouter/, message);
      assert.match(message, /missing its scheme/i, message);
      assert.match(message, /https:\/\/api\.openai\.com\/v1/, "it must name the address to use instead");
      assert.equal(/Invalid URL/.test(message), false, "the useless message must be gone");
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.openrouter", before.url, vscode.ConfigurationTarget.Global);
    }
  });

  /**
   * A Hivey preset bills OpenRouter whatever the provider setting says, and the panel has to admit
   * it.
   *
   * `route()` sends a preset to OpenRouter before it ever reads `chat.provider`. So somebody who
   * stored an OpenAI key, chose OpenAI in the composer and kept a preset as their model was shown
   * "OpenAI" while every request went to OpenRouter, against the OpenRouter balance — and when that
   * ran out, the error told them to top up an account they had not chosen to use.
   */
  test("the panel names OpenRouter when a preset is the model, whatever the provider setting says", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([{ text: "ok" }]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      openrouter: config.get("endpoints.openrouter"),
      confirm: config.get("privacy.confirmSend"),
    };
    await config.update("chat.provider", "openai", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "hivey/free", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.openrouter", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    try {
      void vscode.commands.executeCommand("hiveyCode.askWith", "hello");
      for (let i = 0; i < 100 && !stub.asked().length; i++) await delay(50);
      await vscode.commands.executeCommand("hiveyCode.stopAnswer");

      // The socket is the proof: the provider setting says OpenAI and the request went to the
      // OpenRouter endpoint.
      assert.ok(stub.asked().length, "the preset never reached the OpenRouter endpoint");
      // Read through the product's own reader rather than off the raw configuration: a workspace
      // value set by an earlier test wins over the global one, and the test would then be asserting
      // on the test rather than on the product.
      assert.notEqual(
        readSettings().chat.provider,
        "openrouter",
        "the point of the test is that the provider setting says something else",
      );
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.openrouter", before.openrouter, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * The question this suite could not answer, three fixes in a row.
   *
   * "I ask a question, I get no answer, and the tokens are spent." Three different causes were
   * found by reading the code and fixed, and none of them was it — because nothing here ever
   * checked the only thing that matters: does the ANSWER arrive. Every other test in this file
   * asserts on what was SENT.
   *
   * The export is the discriminator. It is the session's own record, drawn from the same entries
   * the panel draws: if the answer is in it and not on screen, the defect is in the webview; if it
   * is not in it, the defect is upstream of the webview. That is a fact worth having before the
   * next guess.
   *
   * Configured the way a paying user most likely is — a Hivey preset, which routes through
   * OpenRouter and is the path the prompt-cache change of 0.41 rewrote.
   */
  test("a question gets an answer, and the answer reaches the conversation", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([{ text: "The rounding belongs on the invoice total." }]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      openrouter: config.get("endpoints.openrouter"),
      confirm: config.get("privacy.confirmSend"),
      mode: config.get("chat.mode"),
    };
    await config.update("chat.provider", "openrouter", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "hivey/free", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.openrouter", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    try {
      await vscode.commands.executeCommand("hiveyCode.newSession");
      // Awaited: `askWith` resolves when the turn ENDS, which is exactly what this test wants.
      await vscode.commands.executeCommand("hiveyCode.askWith", "Where does the rounding belong?");

      assert.ok(stub.asked().length, "nothing was sent at all");

      await vscode.commands.executeCommand("hiveyCode.exportSession");
      const exported = vscode.window.activeTextEditor?.document.getText() ?? "";
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

      assert.match(exported, /Where does the rounding belong\?/, "the question is missing from the record");
      assert.match(
        exported,
        /The rounding belongs on the invoice total\./,
        `the model answered and the answer never reached the conversation:\n${exported.slice(0, 1200)}`,
      );
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.openrouter", before.openrouter, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * The turn that waits for ever on a question nobody can see.
   *
   * This is the shape of "I ask something, I get no answer, and the tokens are spent". In agent
   * mode every tool call opens an approval card, and that card used to exist ONLY as a message the
   * panel had already consumed, drawn into the turn in progress. Anything that rebuilt the panel
   * while it was up — the caret moving in an editor, a file being opened, the agent saving a file,
   * all of which send state — destroyed it, and the promise behind it was never resolved. The
   * request had been sent and paid for; nothing else ever happened.
   *
   * So the card lives in the state now, and this test is the proof: a state message is forced in
   * while the turn is blocked, and the turn still completes when the card is answered.
   */
  test("an approval survives the panel being rebuilt under it", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([
      { tool: { name: "run_command", args: { command: "echo hello" } } },
      { text: "Done." },
    ]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      local: config.get("endpoints.local"),
      confirm: config.get("privacy.confirmSend"),
      approve: config.get("permissions.autoApprove"),
    };
    await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "asks-first", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);
    // "off" is the default, and the one that opens a card for every command.
    await config.update("permissions.autoApprove", "off", vscode.ConfigurationTarget.Global);

    const dir = await fs.mkdtemp(join(tmpdir(), "hivey-approval-"));
    await fs.writeFile(join(dir, "a.ts"), "export const a = 1;\n");

    try {
      await vscode.commands.executeCommand("hiveyCode.newSession");
      void vscode.commands.executeCommand("hiveyCode.askWith", "run the thing");

      // Wait for the turn to be blocked on the approval: the model has answered once, and nothing
      // more will be sent until somebody says yes.
      for (let i = 0; i < 100 && stub.asked().length < 1; i++) await delay(50);
      await delay(400);
      assert.equal(stub.asked().length, 1, "the turn should be waiting on the approval");

      // Now the thing that used to destroy the card: a state message, for a reason that has nothing
      // to do with the conversation. Opening a file is one of the several that do this, and in
      // agent mode the agent causes them itself by saving what it edits.
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(join(dir, "a.ts")));
      await delay(500);

      // The turn must still be alive and still waiting — not cancelled, not silently finished.
      assert.equal(stub.asked().length, 1, "the rebuild ended the turn instead of leaving it waiting");

      await vscode.commands.executeCommand("hiveyCode.stopAnswer");
      await delay(300);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await fs.rm(dir, { recursive: true, force: true });
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.local, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      await config.update("permissions.autoApprove", before.approve, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * A turn in PLAN mode, answered.
   *
   * Plan mode changes the system prompt and the entire tool set — every tool that writes is either
   * dropped or replaced by a reading-only version of itself — and until this test nothing ever ran
   * a turn in it. It was reported as thinking and then saying nothing, and the suite could not have
   * seen that: there was no way to enter the mode except by clicking the composer's menu.
   *
   * The reasoning is streamed first, as a thinking model sends it, because "it only does the
   * reasoning" is the shape of the complaint.
   */
  test("plan mode answers, and the answer reaches the conversation", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([
      { reasoning: "Let me look at how the total is computed.", text: "## What I found\nRounding happens per line." },
    ]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      local: config.get("endpoints.local"),
      confirm: config.get("privacy.confirmSend"),
    };
    await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "planner", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    try {
      await vscode.commands.executeCommand("hiveyCode.newSession");
      await vscode.commands.executeCommand("hiveyCode.setMode", "plan");
      await vscode.commands.executeCommand("hiveyCode.askWith", "How is the total rounded?");

      await vscode.commands.executeCommand("hiveyCode.exportSession");
      const exported = vscode.window.activeTextEditor?.document.getText() ?? "";
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      assert.match(
        exported,
        /Rounding happens per line/,
        `plan mode produced no answer:\n${exported.slice(0, 800)}`,
      );
    } finally {
      await vscode.commands.executeCommand("hiveyCode.setMode", "agent");
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.local, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * A gateway is configured by its ADDRESS, and a key is optional there.
   *
   * "I configured a local model through our internal proxy and it says: No endpoint configured for
   * openai-compatible." That vendor is the only one whose address has no default — it is somebody's
   * own proxy, and nobody can guess where it lives — and it is also the one where a key is not
   * necessarily required, because a gateway on a private network often has none.
   */
  test("a gateway answers once its address is set, with or without a key", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([{ text: "Answered through the gateway." }]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      gateway: config.get("endpoints.openaiCompatible"),
      confirm: config.get("privacy.confirmSend"),
    };
    await config.update("chat.provider", "openai-compatible", vscode.ConfigurationTarget.Global);
    // Any open-source model the proxy serves. The gateway is not a catalogue: what it answers with
    // is whatever it has been given, and naming a model it does not know is the proxy's error to
    // report, not ours to pre-empt.
    await config.update("chat.model", "qwen3-coder", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.openaiCompatible", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    try {
      await vscode.commands.executeCommand("hiveyCode.newSession");
      await vscode.commands.executeCommand("hiveyCode.askWith", "Are you there?");

      await vscode.commands.executeCommand("hiveyCode.exportSession");
      const exported = vscode.window.activeTextEditor?.document.getText() ?? "";
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      assert.doesNotMatch(exported, /No endpoint configured/, exported.slice(0, 600));
      assert.match(exported, /Answered through the gateway/, `the gateway never answered:\n${exported.slice(0, 800)}`);
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.openaiCompatible", before.gateway, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * A model that thinks until there is nothing left to answer with.
   *
   * The reasoning is charged against the same output budget as the reply, so a long think can
   * consume all of it and the turn ends with a full block of thinking and no answer. The provider
   * says so in `finish_reason`, and nothing read it. Asked again with more room, once, and only
   * when there is nothing at all to show — a truncated answer that reached the user is theirs, and
   * asking twice would bill them again for a paragraph they can already read.
   */
  test("a turn whose thinking ate the whole budget is asked again with more room", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([
      { reasoning: "Thinking at length about the rounding…", truncated: true },
      { text: "Round the gross total once, to the cent." },
    ]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      local: config.get("endpoints.local"),
      confirm: config.get("privacy.confirmSend"),
      output: config.get("chat.maxOutputTokens"),
    };
    await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "thinker", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);
    await config.update("chat.maxOutputTokens", 1000, vscode.ConfigurationTarget.Global);

    try {
      await vscode.commands.executeCommand("hiveyCode.newSession");
      await vscode.commands.executeCommand("hiveyCode.askWith", "How should the rounding work?");

      await vscode.commands.executeCommand("hiveyCode.exportSession");
      const exported = vscode.window.activeTextEditor?.document.getText() ?? "";
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      assert.match(exported, /Round the gross total once/, `no second attempt was made:\n${exported.slice(0, 800)}`);

      // And the second request really did ask for more room, rather than repeating the first.
      const asked = stub.bodies().map((b) => JSON.parse(b).max_tokens as number);
      assert.equal(asked[0], 1000, `the first request did not use the setting: ${asked[0]}`);
      assert.ok((asked[1] ?? 0) > (asked[0] ?? 0), `the retry asked for no more room than the attempt that ran out: ${asked.join(", ")}`);
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.local, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      await config.update("chat.maxOutputTokens", before.output, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * A gateway offers ITS models, and you can switch between them.
   *
   * "When a gateway is configured it should offer only the models the proxy serves." It offered
   * them, underneath four hundred and fifty-seven catalogue rows that go through OpenRouter — which
   * a user whose access is a private proxy has no key for and no way to reach. Finding two names in
   * that haystack is not choosing between them.
   */
  test("a configured gateway offers its own models and nothing it cannot reach", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    // A proxy that serves two open-source models, which is what one looks like.
    const proxy = createServer((req, res) => {
      if (req.url?.includes("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "qwen3-coder" }, { id: "deepseek-r2" }] }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
    const port = (proxy.address() as { port: number }).port;

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = { gateway: config.get("endpoints.openaiCompatible"), provider: config.get("chat.provider") };
    await config.update("endpoints.openaiCompatible", `http://127.0.0.1:${port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("chat.provider", "openai-compatible", vscode.ConfigurationTarget.Global);

    // No key anywhere: a proxy on a private network usually needs none, and OpenRouter is
    // unreachable, which is the whole point of the assertion.
    const nothing: vscode.SecretStorage = {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
      keys: async () => [],
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    };

    try {
      const models = await listModels(readSettings(), new Keys(nothing), "qwen3-coder");
      const ids = models.map((m) => m.id);
      assert.deepEqual(
        ids.filter((id) => id === "qwen3-coder" || id === "deepseek-r2"),
        ["qwen3-coder", "deepseek-r2"],
        `the proxy's models are missing from the picker: ${ids.slice(0, 20).join(", ")}`,
      );
      // Both of them, so there is something to switch BETWEEN.
      assert.ok(
        models.filter((m) => m.provider === "openai-compatible").length >= 2,
        "a gateway serving two models offered fewer than two",
      );
      assert.equal(
        models.some((m) => m.provider === "openrouter"),
        false,
        `the catalogue is still there: ${models.filter((m) => m.provider === "openrouter").length} rows nobody can reach`,
      );
    } finally {
      await config.update("endpoints.openaiCompatible", before.gateway, vscode.ConfigurationTarget.Global);
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      proxy.close();
    }
  });

  /**
   * Nothing to consent to, so nothing is asked.
   *
   * The card that quotes tokens and dollars was opened for every turn, local ones included, where
   * it said "on this machine, nothing billed" and waited for a click. A question whose answer is
   * always zero is not a question, it is a step — and the argument for running a model on your own
   * machine is precisely that nobody has to think about what a question costs.
   *
   * Asserted with the setting left ON, which is the only way to tell "it did not ask" from "asking
   * is switched off".
   */
  test("a local turn is not interrupted by a card about money", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([{ text: "Nothing was billed for this." }]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      local: config.get("endpoints.local"),
      confirm: config.get("privacy.confirmSend"),
    };
    await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "free-one", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    // Left ON. With "never" this test would pass without the fix.
    await config.update("privacy.confirmSend", "ask", vscode.ConfigurationTarget.Global);

    try {
      await vscode.commands.executeCommand("hiveyCode.newSession");
      // Awaited: `askWith` resolves when the turn ENDS. A card nobody clicks never ends, so this
      // resolving at all is half the assertion.
      await Promise.race([
        vscode.commands.executeCommand("hiveyCode.askWith", "Does this cost anything?"),
        delay(8000).then(() => assert.fail("the turn is still waiting — something asked for a click")),
      ]);

      await vscode.commands.executeCommand("hiveyCode.exportSession");
      const exported = vscode.window.activeTextEditor?.document.getText() ?? "";
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      assert.match(exported, /Nothing was billed for this/, `the turn produced no answer:\n${exported.slice(0, 600)}`);
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.local, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * A gateway address this extension took away, put back.
   *
   * The repair that moves a pasted key out of the address setting used to decide "this is a
   * credential" partly by guessing: no dots, no slashes, long enough. An internal hostname is
   * exactly that, so `llm-gateway-internal-prod-01` was moved into the secret store and erased from
   * the settings, automatically, at every configuration change. The user could then neither choose
   * their gateway nor see its models.
   *
   * The detector is prefix-only now, so it cannot happen again; this is the undo for the
   * installations it already happened to.
   */
  test("a gateway address mistaken for a key is put back where it belongs", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = config.get("endpoints.openaiCompatible");
    await config.update("endpoints.openaiCompatible", undefined, vscode.ConfigurationTarget.Global);

    // The store, holding what the old repair put there.
    let held: string | undefined = "llm-gateway-internal-prod-01";
    const store: vscode.SecretStorage = {
      get: async () => held,
      store: async (_k, v) => void (held = v),
      delete: async () => void (held = undefined),
      keys: async () => (held ? ["x"] : []),
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    };

    try {
      await restoreMisplacedGatewayAddress(new Keys(store));
      assert.equal(
        vscode.workspace.getConfiguration(SECTION).get<string>("endpoints.openaiCompatible"),
        "https://llm-gateway-internal-prod-01",
        "the address was not put back",
      );
      assert.equal(held, undefined, "it was left in the secret store as well, so it is now in two places");
    } finally {
      await config.update("endpoints.openaiCompatible", before, vscode.ConfigurationTarget.Global);
    }
  });

  /**
   * And a real key is left exactly where it belongs.
   *
   * The undo above must not become the mirror image of the defect it repairs: a gateway that needs
   * a key, and has one, must not have it promoted to an address the next time the extension starts.
   */
  test("a real gateway key is not mistaken for an address", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = config.get("endpoints.openaiCompatible");
    await config.update("endpoints.openaiCompatible", undefined, vscode.ConfigurationTarget.Global);

    let held: string | undefined = `${["sk", "or", "v1-"].join("-")}0123456789abcdef0123456789abcdef`;
    const store: vscode.SecretStorage = {
      get: async () => held,
      store: async (_k, v) => void (held = v),
      delete: async () => void (held = undefined),
      keys: async () => ["x"],
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    };

    try {
      await restoreMisplacedGatewayAddress(new Keys(store));
      assert.ok(held, "a real key was taken out of the secret store");
      assert.equal(
        vscode.workspace.getConfiguration(SECTION).get<string>("endpoints.openaiCompatible", ""),
        "",
        "a key was written into the address setting",
      );
    } finally {
      await config.update("endpoints.openaiCompatible", before, vscode.ConfigurationTarget.Global);
    }
  });

  /**
   * A folder of internal documentation, read and never written to.
   *
   * The asked-for shape: point this at a share of internal documentation and let the agent search
   * it. The two halves that matter are that ORDINARY Markdown is readable — nobody is adding a
   * `title:` header to four hundred wiki pages — and that nothing this extension does can write
   * into it. A team's documentation is not a scratchpad an agent may edit.
   */
  test("a shared documentation folder is read, and is never written to", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const shared = await fs.mkdtemp(join(tmpdir(), "hivey-doc-"));
    await fs.writeFile(
      join(shared, "creation-client.md"),
      "# Création d'un client\n\nOuvrir TSTCFC, lancer CRTCUST, saisir le SIRET.\n",
      "utf8",
    );
    // And a Word document, because that is what internal documentation is actually written in —
    // named the way a person names a file, not the way this extension names a note.
    const xml =
      "<w:document><w:body><w:p><w:r><w:t>Clôture mensuelle</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Lancer FINCLO dans DEVCFC le dernier jour.</w:t></w:r></w:p></w:body></w:document>";
    await fs.writeFile(join(shared, "Clôture mensuelle.docx"), minimalDocx(xml));

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = { folders: config.get("knowledge.folders"), enabled: config.get("knowledge.enabled") };
    await config.update("knowledge.folders", [shared], vscode.ConfigurationTarget.Global);
    await config.update("knowledge.enabled", true, vscode.ConfigurationTarget.Global);

    try {
      const store = knowledgeStore(readSettings());
      assert.ok(store, "no knowledge store, although the base is switched on");
      const notes = await store.list();
      const found = notes.find((n) => n.id.includes("creation-client"));
      assert.ok(found, `the shared folder contributed nothing: ${notes.map((n) => n.id).join(", ")}`);
      assert.equal(found.title, "Création d'un client", "the title was not taken from the heading");

      // The Word document too, read without a parser shipped as a dependency.
      const word = notes.find((n) => n.id.includes("cloture-mensuelle"));
      assert.ok(word, `the Word document was not read: ${notes.map((n) => n.id).join(", ")}`);
      assert.match(word.body, /Lancer FINCLO dans DEVCFC/, "the document's prose did not come through");

      // And it stays as it was. `/remember` writes to a base this extension owns, never into
      // somebody's documentation share.
      await store.write({ id: "a-new-note", title: "A new note", body: "Written by the agent.", tags: [], sources: [], updated: "" });
      const still = (await fs.readdir(shared)).sort();
      assert.deepEqual(
        still,
        ["Clôture mensuelle.docx", "creation-client.md"].sort(),
        `the extension wrote into the share: ${still.join(", ")}`,
      );
    } finally {
      await config.update("knowledge.folders", before.folders, vscode.ConfigurationTarget.Global);
      await config.update("knowledge.enabled", before.enabled, vscode.ConfigurationTarget.Global);
      await fs.rm(shared, { recursive: true, force: true });
    }
  });

  /**
   * A failure has to leave something behind.
   *
   * "I just get a red error message that appears for a microsecond." It was recorded in the
   * conversation only when an empty answer already existed — which is to say only once the turn had
   * got as far as contacting a model. Anything that went wrong before that was posted as a message,
   * drawn into the turn in progress, and destroyed by the next rebuild. The user could see that
   * something was wrong and could not read what, and neither could anyone they reported it to.
   *
   * Asserted on the export, which is the conversation's own record: if the failure is in there, it
   * is on screen and it stays there.
   */
  test("a failure before the model is contacted is still written into the conversation", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      openrouter: config.get("endpoints.openrouter"),
      confirm: config.get("privacy.confirmSend"),
    };
    // An address that cannot work: the turn dies before anything is sent, which is exactly the case
    // that used to leave no trace.
    await config.update("chat.provider", "openrouter", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "some-model", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.openrouter", "api.openai.com/v1", vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    try {
      await vscode.commands.executeCommand("hiveyCode.newSession");
      await vscode.commands.executeCommand("hiveyCode.askWith", "this will fail");

      await vscode.commands.executeCommand("hiveyCode.exportSession");
      const exported = vscode.window.activeTextEditor?.document.getText() ?? "";
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

      assert.match(exported, /this will fail/, "the question itself is missing from the record");
      assert.match(
        exported,
        /missing its scheme|unusable/i,
        `the failure left no trace in the conversation:\n${exported.slice(0, 800)}`,
      );
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.openrouter", before.openrouter, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
    }
  });

  /**
   * The escalation that is not a guess.
   *
   * The router's own escalation reads the QUESTION and bets. This one reads what happened: a local
   * turn runs a command, the command fails, the turn ends anyway — and only then is a paid model
   * asked, with the failure attached. The whole point is that the second request exists at all, and
   * that it carries the evidence, so both are asserted on the socket rather than on a log line.
   */
  test("a local turn that ends on a failing check is handed to the escalation model, with the evidence", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await scriptedStub([
      // The local model runs something that fails, then answers as though it were done — which is
      // exactly the behavior that made "ask the user what it printed" so expensive.
      // A real check, not just any failing command: a non-zero exit is how half the shell reports
      // "no" — `grep` finding nothing, `git diff --quiet` finding changes — and escalating on those
      // bought a second turn on a larger model nearly every time an agent searched for something.
      { tool: { name: "run_command", args: { command: "npm test" } } },
      { text: "All set." },
      { text: "Fixed it properly." },
    ]);
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      local: config.get("endpoints.local"),
      openrouter: config.get("endpoints.openrouter"),
      policy: config.get("escalation.policy"),
      escModel: config.get("escalation.model"),
      escProvider: config.get("escalation.provider"),
      confirm: config.get("privacy.confirmSend"),
      approve: config.get("permissions.autoApprove"),
    };
    const url = `http://127.0.0.1:${stub.port}/v1`;
    await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "small-local", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", url, vscode.ConfigurationTarget.Global);
    await config.update("endpoints.openrouter", url, vscode.ConfigurationTarget.Global);
    await config.update("escalation.policy", "auto", vscode.ConfigurationTarget.Global);
    await config.update("escalation.provider", "openrouter", vscode.ConfigurationTarget.Global);
    await config.update("escalation.model", "big-remote", vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);
    await config.update("permissions.autoApprove", "all", vscode.ConfigurationTarget.Global);

    try {
      void vscode.commands.executeCommand("hiveyCode.askWith", "make the build pass");
      for (let i = 0; i < 200 && !stub.asked().includes("big-remote"); i++) await delay(50);
      await vscode.commands.executeCommand("hiveyCode.stopAnswer");

      const asked = stub.asked();
      assert.ok(asked.includes("small-local"), `the local model was never asked: ${asked.join(", ")}`);
      assert.ok(
        asked.includes("big-remote"),
        `a turn that ended on a failing command was never handed over: ${asked.join(", ")}`,
      );
      assert.ok(
        asked.indexOf("small-local") < asked.indexOf("big-remote"),
        "the remote model was asked before the local one had failed",
      );

      // And it must arrive with the evidence. A hand-over that only says "try again" buys a second
      // identical answer at a higher price.
      const handover = stub.bodies().find((b) => b.includes("big-remote"));
      assert.ok(handover, "no request body for the escalation");
      assert.match(handover!, /smaller model already attempted/, "the evidence was not attached");
      assert.match(handover!, /npm test/, "the failure itself was not attached");
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.local, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.openrouter", before.openrouter, vscode.ConfigurationTarget.Global);
      await config.update("escalation.policy", before.policy, vscode.ConfigurationTarget.Global);
      await config.update("escalation.model", before.escModel, vscode.ConfigurationTarget.Global);
      await config.update("escalation.provider", before.escProvider, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      await config.update("permissions.autoApprove", before.approve, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * A preset must never reach a provider.
   *
   * `hivey/free` is not a model id: no API has heard of it, and sending it verbatim is a 400 — the
   * exact failure the sibling project shipped and had to chase. Every layer in between resolves it,
   * so the only assertion that means anything is made on what came out of the socket. The stub is
   * put at the OpenRouter endpoint because that is where a preset routes, and a loopback address
   * needs no key.
   */
  test("a Hivey preset sends a real model id, not the preset", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await streamingStub();
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      endpoint: config.get("endpoints.openrouter"),
      confirmSend: config.get("privacy.confirmSend"),
    };
    await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "hivey/free", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.openrouter", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    try {
      void vscode.commands.executeCommand("hiveyCode.askWith", "hello");
      for (let i = 0; i < 100 && !stub.asked().length; i++) await delay(50);
      await vscode.commands.executeCommand("hiveyCode.stopAnswer");

      const asked = stub.asked();
      assert.ok(asked.length, "the preset never reached the model server at all");
      assert.ok(!asked[0]!.startsWith("hivey"), `the preset id itself was sent: ${asked[0]}`);
      assert.equal(asked[0], HIVEY_ROUTING["hivey/free"]!.everyday, "an ordinary question is not an everyday turn");
      // And the provider setting still says "local": a preset decides where it is served, and the
      // panel's promise about what leaves the machine has to follow the model, not the setting.
      assert.equal(config.get("chat.provider"), "local");
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.openrouter", before.endpoint, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirmSend, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * A provider the user pays directly is a route, not a label.
   *
   * The failure this guards against is quiet: the provider list grows, the panel offers OpenAI or
   * DeepSeek, the setting takes the value — and the turn still goes to whatever endpoint the code
   * knew about before, because the address for the new provider was declared in the manifest and
   * never read. The only place that can be seen is the socket, so the stub is put at the vendor's
   * address and nowhere else: if the request arrives, the whole chain resolved.
   *
   * No key is stored, and none is needed: the stub answers on loopback, which this extension treats
   * as local — the endpoint decides, never the setting name.
   */
  test("choosing a provider sends the turn to that provider's address", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const stub = await streamingStub();
    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      endpoint: config.get("endpoints.deepseek"),
      confirmSend: config.get("privacy.confirmSend"),
    };
    await config.update("chat.provider", "deepseek", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "deepseek-chat", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.deepseek", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);

    try {
      void vscode.commands.executeCommand("hiveyCode.askWith", "hello");
      for (let i = 0; i < 100 && !stub.asked().length; i++) await delay(50);
      await vscode.commands.executeCommand("hiveyCode.stopAnswer");

      const asked = stub.asked();
      assert.ok(asked.length, "the question never reached the provider's own endpoint");
      assert.equal(asked[0], "deepseek-chat", "the model was rewritten on the way out");
    } finally {
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.deepseek", before.endpoint, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirmSend, vscode.ConfigurationTarget.Global);
      stub.close();
    }
  });

  /**
   * Agent mode changes a file the model named the way the editor shows it.
   *
   * The one thing the product is for, and until now the one thing no test looked at: forty
   * integration tests drive turns, approve commands, escalate, route and photograph, and every one
   * of them asserts on what was SENT or on what the panel says. "Agent mode no longer makes
   * modifications" could not be contradicted by any of them.
   *
   * An ABSOLUTE path, deliberately. That is the spelling a model uses after reading a diagnostic,
   * a stack trace or terminal output — all of which the editor writes absolutely — and the
   * resolver refused every one of them with "leaves the workspace", a sentence that reads as the
   * agent having lost the project. The containment arithmetic itself is checked at its edges in
   * `tests/paths.test.ts`; what this proves is that a real turn in a real editor reaches the file
   * instead of a refusal.
   */
  test("agent mode edits a file the model named by its full path", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const dir = await fs.mkdtemp(join(tmpdir(), "hivey-write-"));
    const target = join(dir, "note.txt");
    await fs.writeFile(target, "before\n", "utf8");
    // Opened, because this harness deliberately opens no folder: the tabs are the workspace here,
    // which is also an ordinary way to work on a file from a remote or an IBM i partition.
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    await vscode.window.showTextDocument(doc);

    // The two halves of the contradiction, tied together so that neither can drift from the other:
    // this is the spelling the extension ITSELF gives the model for this file, and the next lines
    // are the model handing it straight back. A file outside every open folder has no relative name
    // to be given, so what the context says is `uri.fsPath` — and the resolver refused it. The
    // extension dictated a path and then refused its own.
    assert.equal(relative(doc.uri), target, "the context names this file some other way now");

    const stub = await scriptedStub([
      { tool: { name: "edit_file", args: { path: relative(doc.uri), old: "before", new: "after" } } },
      { text: "Done." },
    ]);

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      model: config.get("chat.model"),
      local: config.get("endpoints.local"),
      confirm: config.get("privacy.confirmSend"),
      approve: config.get("permissions.autoApprove"),
    };
    await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
    await config.update("chat.model", "stub-model", vscode.ConfigurationTarget.Global);
    await config.update("endpoints.local", `http://127.0.0.1:${stub.port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);
    await config.update("permissions.autoApprove", "all", vscode.ConfigurationTarget.Global);

    // The diff-then-notification is the last gate before the edit is applied, and nothing clicks in
    // a test run. Answering it here does not weaken the assertion: what is under test is everything
    // from the tool call to the text in the document, and the click is the user's part of that.
    const realInfo = vscode.window.showInformationMessage;
    const reviewed: string[] = [];
    (vscode.window as unknown as { showInformationMessage: unknown }).showInformationMessage = (
      message: string,
      ...rest: unknown[]
    ) => {
      reviewed.push(message);
      const choices = rest.filter((r) => typeof r === "string") as string[];
      return Promise.resolve(choices.find((c) => /Apply|Appliquer/.test(c)));
    };

    try {
      await vscode.commands.executeCommand("hiveyCode.setMode", "agent");
      void vscode.commands.executeCommand("hiveyCode.askWith", "rename before to after");
      for (let i = 0; i < 200 && !doc.getText().includes("after"); i++) await delay(50);
      // ⚠️ And then for the SAVE, which happens after the buffer changes. Waiting only for the text
      // made this test a race it lost under load: it observed the edit land in the document and
      // asserted `isDirty === false` in the same breath, before `saveAfterEdit` had run. The
      // assertion was right and the wait was wrong — and a flaky test about whether work reaches the
      // disk is worse than no test, because the next person to see it red will rerun it.
      //
      // Still bounded, so a save that never happens fails here rather than hanging: the loop ends and
      // the assertions below say exactly what was missing.
      for (let i = 0; i < 100 && doc.isDirty; i++) await delay(50);
      await vscode.commands.executeCommand("hiveyCode.stopAnswer");

      const back = (JSON.parse(stub.bodies()[1] ?? "{}").messages ?? []).filter(
        (m: { role: string }) => m.role === "tool",
      );
      const said = JSON.stringify(back);
      assert.equal(/leaves the workspace/.test(said), false, `the resolver refused its own path: ${said}`);
      // ⚠️ NO review, and that is the fix rather than a regression. This test sets
      // `permissions.autoApprove: "all"`, and `confirmEdit` used to open a diff and a notification
      // ANYWAY — unconditionally, with no idea the user had already granted the edit. Two approval
      // systems that did not know about each other, reported as « le mode agent fait du compare au
      // lieu de modifier » and « il redemande les autorisations après si on clique sur toujours ».
      //
      // The review surface still exists and still appears when approval is actually needed; what it
      // must not do is re-ask a question already answered. Asserted as an absence, because an
      // absence is what the user was promised.
      assert.deepEqual(
        reviewed,
        [],
        `an edit allowed by the standing permission was still put up for review: ${reviewed.join(" | ")}`,
      );
      assert.equal(doc.getText(), "after\n", `agent mode did not change the file; the tool said ${said}`);
      // ⚠️⚠️ AND ON DISK. This assertion is the one that was missing, and its absence is the whole
      // reason the defect shipped: a `WorkspaceEdit` changes the editor's in-memory document, so
      // `doc.getText()` says "after" while the file still holds "before". Everything that is not the
      // editor reads the file — `run_command` running the tests, a watcher, a compiler, git — so the
      // agent's very next step grades it on code it did not write.
      assert.equal(doc.isDirty, false, "the approved edit was left unsaved in the editor");
      assert.equal(
        await fs.readFile(target, "utf8"),
        "after\n",
        "the editor shows the change but the file on disk does not: the next command would read the old code",
      );
    } finally {
      (vscode.window as unknown as { showInformationMessage: unknown }).showInformationMessage = realInfo;
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
      await config.update("endpoints.local", before.local, vscode.ConfigurationTarget.Global);
      await config.update("privacy.confirmSend", before.confirm, vscode.ConfigurationTarget.Global);
      await config.update("permissions.autoApprove", before.approve, vscode.ConfigurationTarget.Global);
      stub.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * A signed policy really narrows the settings, in a real editor.
   *
   * The unit tests prove the arithmetic. What they cannot prove is that the narrowing is WIRED: that
   * `readSettings()` — the function every feature in this extension reads its configuration
   * through — comes back restricted, with a user who has deliberately set the most permissive value
   * for every field. That is the claim an enterprise review is actually making, and it needs the
   * real configuration service underneath it.
   */
  test("a signed organisation policy narrows the settings the whole extension reads", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();

    const keys = generateKeyPairSync("ed25519");
    const dir = await fs.mkdtemp(join(tmpdir(), "hivey-policy-"));
    const document = Buffer.from(
      JSON.stringify({
        version: 1,
        organisation: "Crédit Foncier",
        providers: ["local"],
        escalation: "never",
        redaction: "strict",
        allowUnredacted: false,
        autoApprove: "off",
        blockedGlobs: ["**/clients/**"],
        writableLibraries: ["TSTCFC"],
        budget: { dailyUsd: 3 },
        disabled: ["completion"],
      }),
      "utf8",
    );
    await fs.writeFile(
      join(dir, "policy.json"),
      JSON.stringify({ policy: document.toString("base64"), signature: sign(null, document, keys.privateKey).toString("base64") }),
      "utf8",
    );
    await fs.writeFile(join(dir, "policy.pub"), keys.publicKey.export({ type: "spki", format: "pem" }).toString(), "utf8");

    const config = vscode.workspace.getConfiguration(SECTION);
    const before = {
      provider: config.get("chat.provider"),
      redaction: config.get("privacy.redaction"),
      allowUnredacted: config.get("privacy.allowUnredacted"),
      approve: config.get("permissions.autoApprove"),
      daily: config.get("budget.dailyUsd"),
      globs: config.get("privacy.blockedGlobs"),
      libraries: config.get("ibmi.writableLibraries"),
      completion: config.get("completion.enabled"),
    };
    const policyBefore = process.env["HIVEY_CODE_POLICY_DIR"];

    // A user who has deliberately set the most permissive value for everything.
    await config.update("chat.provider", "anthropic", vscode.ConfigurationTarget.Global);
    await config.update("privacy.redaction", "off", vscode.ConfigurationTarget.Global);
    await config.update("privacy.allowUnredacted", true, vscode.ConfigurationTarget.Global);
    await config.update("permissions.autoApprove", "all", vscode.ConfigurationTarget.Global);
    await config.update("budget.dailyUsd", 100, vscode.ConfigurationTarget.Global);
    await config.update("privacy.blockedGlobs", ["**/.env*"], vscode.ConfigurationTarget.Global);
    await config.update("ibmi.writableLibraries", ["TSTCFC", "PRODCFC"], vscode.ConfigurationTarget.Global);
    await config.update("completion.enabled", true, vscode.ConfigurationTarget.Global);

    try {
      // Unmanaged first: without a policy the permissive settings stand, which is what makes the
      // rest of this test mean anything.
      process.env["HIVEY_CODE_POLICY_DIR"] = await fs.mkdtemp(join(tmpdir(), "hivey-nopolicy-"));
      assert.equal(reloadPolicy().kind, "none");
      assert.equal(readSettings().privacy.redaction, "off", "the user's own setting must stand when nobody manages this machine");
      assert.equal(readSettings().permissions.autoApprove, "all");

      process.env["HIVEY_CODE_POLICY_DIR"] = dir;
      assert.equal(reloadPolicy().kind, "managed");

      const s = readSettings();
      assert.equal(s.chat.provider, "local", "a forbidden provider was still selected");
      assert.equal(s.privacy.redaction, "strict", "the user turned redaction off and the policy did not put it back");
      assert.equal(s.privacy.allowUnredacted, false);
      assert.equal(s.permissions.autoApprove, "off");
      assert.equal(s.budget.dailyUsd, 3);
      assert.equal(s.escalation.policy, "never");
      assert.equal(s.completion.enabled, false, "a disabled feature is still on");
      // The lists are added to, not replaced: a policy restricts, so it cannot remove a restriction.
      assert.ok(s.privacy.blockedGlobs.includes("**/.env*"));
      assert.ok(s.privacy.blockedGlobs.includes("**/clients/**"));
      // And the writable libraries are narrowed to the intersection, never widened.
      assert.deepEqual(s.ibmi.writableLibraries, ["TSTCFC"]);

      // What the interface says, and about whom.
      const managed = managedSettings();
      assert.equal(managed.organisation, "Crédit Foncier");
      assert.ok(managed.keys.includes("privacy.redaction"), `reported: ${managed.keys.join(", ")}`);
      assert.ok(managed.keys.includes("permissions.autoApprove"));

      // Now tamper with it, the way somebody would who wanted their budget back.
      const envelope = JSON.parse(await fs.readFile(join(dir, "policy.json"), "utf8")) as { policy: string; signature: string };
      const raised = Buffer.from(JSON.stringify({ version: 1, budget: { dailyUsd: 500 } }), "utf8");
      await fs.writeFile(join(dir, "policy.json"), JSON.stringify({ ...envelope, policy: raised.toString("base64") }), "utf8");
      const refused = reloadPolicy();
      assert.equal(refused.kind, "refused");
      // Safest mode, NOT the tampered policy and NOT the user's own settings.
      const safe = readSettings();
      assert.equal(safe.privacy.redaction, "strict");
      assert.equal(safe.chat.provider, "local");
      assert.equal(safe.permissions.autoApprove, "off");
      assert.notEqual(safe.budget.dailyUsd, 500);

      // And deleting the policy while the key stays pinned is not a way out either.
      await fs.rm(join(dir, "policy.json"));
      assert.equal(reloadPolicy().kind, "refused");
      assert.equal(readSettings().privacy.redaction, "strict");
    } finally {
      if (policyBefore === undefined) delete process.env["HIVEY_CODE_POLICY_DIR"];
      else process.env["HIVEY_CODE_POLICY_DIR"] = policyBefore;
      reloadPolicy();
      await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
      await config.update("privacy.redaction", before.redaction, vscode.ConfigurationTarget.Global);
      await config.update("privacy.allowUnredacted", before.allowUnredacted, vscode.ConfigurationTarget.Global);
      await config.update("permissions.autoApprove", before.approve, vscode.ConfigurationTarget.Global);
      await config.update("budget.dailyUsd", before.daily, vscode.ConfigurationTarget.Global);
      await config.update("privacy.blockedGlobs", before.globs, vscode.ConfigurationTarget.Global);
      await config.update("ibmi.writableLibraries", before.libraries, vscode.ConfigurationTarget.Global);
      await config.update("completion.enabled", before.completion, vscode.ConfigurationTarget.Global);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * The language server's own answers, in a real editor.
   *
   * These tools exist because a grep answers the same questions approximately. That claim can only be
   * checked where there IS a language server, which is here: VS Code's own TypeScript service indexes
   * this extension's source, so `workspace_symbols` has something real to find.
   */
  test("the language-server tools answer from the editor, not from a text search", async () => {
    const ext = vscode.extensions.getExtension(ID)!;
    await ext.activate();
    const tools = buildTools({ settings: () => readSettings() });
    const byName = new Map(tools.map((t) => [t.schema.name, t]));
    for (const name of ["find_references", "call_hierarchy", "workspace_symbols"]) {
      assert.ok(byName.has(name), `${name} is not in the tool set`);
    }

    const ctx = { signal: new AbortController().signal, report: () => {} };
    // A symbol this repository really declares. The harness opens no folder, so the workspace symbol
    // provider has nothing to index — which is itself the case worth asserting: the answer must say
    // a provider did not answer rather than "no such symbol".
    const result = await byName.get("workspace_symbols")!.run({ query: "verifyTurn" }, ctx as never);
    const text = String(result.content);
    if (result.isError) {
      assert.match(text, /not the same as/, "a silent provider must not read as an empty answer");
    } else {
      assert.match(text, /symbol\(s\) matching/);
    }

    // And a file that does not exist is refused with the file named, not with an empty list.
    const missing = await byName.get("find_references")!.run({ file: "no-such-file.ts", symbol: "x" }, ctx as never);
    assert.equal(missing.isError, true);
    assert.match(String(missing.content), /no-such-file\.ts/);
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
      // Which palette the panel paints itself with, so both appearances can be photographed from the
      // same sequence rather than described in prose nobody can check.
      await config.update(
        "appearance",
        process.env["HIVEY_CODE_APPEARANCE"] ?? "editor",
        vscode.ConfigurationTarget.Global,
      );
      // ⚠️ The floor on the panel's width, photographable on demand.
      //
      // It exists because this setting was broken for a whole release in a way no test could reach: it
      // was written as a style ATTRIBUTE, which this panel's CSP discards, so it did nothing and the
      // markup was perfectly correct. The fix is reasoned — the property form is what the policy
      // allows — and a reasoned fix to a defect that was invisible deserves to be LOOKED at. Setting
      // this to a width larger than the panel makes the content overflow visibly, which is the floor
      // doing its job; with the defect back, the capture is unchanged.
      if (process.env["HIVEY_CODE_MIN_WIDTH"]) {
        await config.update(
          "panel.minWidth",
          Number(process.env["HIVEY_CODE_MIN_WIDTH"]),
          vscode.ConfigurationTarget.Global,
        );
      }
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
      // The panel lives in the RIGHT-hand bar for these photographs, and everything else is put
      // away. A README image of a side panel should be a picture of the side panel: the previous
      // ones carried seven hundred pixels of editor, an activity bar, and whatever the terminal
      // happened to be showing — which on a build machine is the output of the last failed command.
      // None of that is the product, and all of it reads as clutter at README width.
      //
      // The right-hand bar rather than the left because it is where a chat panel belongs beside an
      // editor, and because `focus()` returns early when any copy is visible, so the screens that
      // follow stay in the same bar instead of pulling the panel back to the activity bar.
      const quietly = (command: string) => vscode.commands.executeCommand(command).then(undefined, () => {});
      await quietly("workbench.action.closePanel");
      await quietly("workbench.action.closeSidebar");
      await quietly("notifications.clearAll");
      await vscode.commands.executeCommand("hiveyCode.chatSide.focus");
      await new Promise((r) => setTimeout(r, 800));
      // Widened to a width somebody would actually work in.
      //
      // `decreaseViewWidth`, and the name is not a mistake: these commands act on the EDITOR GROUP,
      // not on the bar, whatever holds the focus. Pressing "increase" ten times produced a 190 px
      // panel — the editor grew and the bar was what gave way. Narrowing the editor is what widens
      // the bar. There is no way to know that from the command names, and no way to check it except
      // by looking at the photograph, which is the only test a layout command has.
      await quietly("workbench.action.focusAuxiliaryBar");
      // Three presses, measured: each one moves the boundary about sixty pixels, and three from the
      // default lands the bar at roughly 540 px — a width somebody gives a chat panel they use, and
      // wide enough for the model picker's own buttons, which wrap and clip below it.
      for (let i = 0; i < 4; i++) await quietly("workbench.action.decreaseViewWidth");
      await new Promise((r) => setTimeout(r, 500));
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
      // ⚠️ ONE exchange, photographed before the second question. Every other frame shows a
      // transcript scrolled to its end, so the TOP of it — and the way back out of the opening turn —
      // has never been in a picture. Florian reported the first message having no restore twice, and
      // both times the code said it had one: `turnBoundary` returns `{restore: true}` for it and has
      // a test. What was missing was a photograph of the only state that settles it.
      await announce("premier");
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

      // ⚠️ THE WIDTH PROBE, which exists to settle a question rather than to photograph a feature.
      //
      // "The right bar is still not locked to a minimum width" has now been reported three times, and
      // the honest answer depends on a fact nobody in this project has checked: whether VS Code lets
      // an extension widen its own view at all. There is no API for a minimum width
      // (microsoft/vscode#182201 is open), but `workbench.action.increaseViewSize` exists — and
      // microsoft/vscode#300121 says the auxiliary bar has only maximize/restore, which is a claim
      // about keybindings, not proof about this command.
      //
      // So: photograph the panel, ask the editor five times to make the focused view bigger, and
      // photograph it again. If the two frames differ, a floor can be ENFORCED rather than merely
      // declared, and this project will build it. If they are identical, the answer is no, and it can
      // be said once with a picture behind it instead of hedged a fourth time.
      if (process.env["HIVEY_CODE_WIDTH_PROBE"]) {
        await announce("width-before");
        await vscode.commands.executeCommand("hiveyCode.chatSide.focus").then(undefined, () => undefined);
        await vscode.commands.executeCommand("hiveyCode.chat.focus").then(undefined, () => undefined);
        for (let i = 0; i < 5; i++) {
          await vscode.commands.executeCommand("workbench.action.increaseViewSize").then(undefined, () => undefined);
          await new Promise((r) => setTimeout(r, 150));
        }
        await announce("width-after");
      }

      // The frame taken WHILE an answer is being written.
      //
      // Everything else here is photographed at rest, which is exactly why two scrolling defects
      // shipped: the transcript stopping following the answer, and the view drifting up into older
      // messages on its own. Both are only visible in motion, both were reported by the person
      // using the panel rather than by this suite, and neither could have been seen in any picture
      // it took. The fixture behind this one streams for half a minute so the shutter opens with
      // the answer still arriving.
      // NOT awaited, and that is the whole trick: `askWith` resolves when the turn ENDS, so awaiting
      // it here photographed a finished answer every time and proved nothing about following one.
      void vscode.commands.executeCommand("hiveyCode.askWith", "Explain the rounding options step by step.");
      await new Promise((r) => setTimeout(r, 2000));
      await announce("pendant");
      // Let it finish before anything else is photographed: a turn still running would leave a
      // spinner in the frames that follow.
      await new Promise((r) => setTimeout(r, 45_000));

      // PLAN MODE, photographed after it has thought and answered.
      //
      // Reported as "it only does the reasoning and gives no answer", and nothing in this suite had
      // ever run a turn that thinks — let alone looked at one. The export proves the answer reached
      // the conversation; only the picture proves it reached the screen, and those are different
      // claims. They were different once already, which is why the transcript is rebuilt from the
      // state rather than from what was drawn.
      await vscode.commands.executeCommand("hiveyCode.newSession");
      await vscode.commands.executeCommand("hiveyCode.setMode", "plan");
      await vscode.commands.executeCommand("hiveyCode.askWith", "Draw up a plan for the rounding.");
      await new Promise((r) => setTimeout(r, 1500));
      await announce("plan");
      const planned = vscode.window.activeTextEditor;
      await vscode.commands.executeCommand("hiveyCode.exportSession");
      const planText = vscode.window.activeTextEditor?.document.getText() ?? "";
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      if (planned) await vscode.window.showTextDocument(planned.document);
      assert.ok(
        /What I propose|Ce que je propose/.test(planText),
        `plan mode thought and said nothing:\n${planText.slice(0, 800)}`,
      );
      await vscode.commands.executeCommand("hiveyCode.setMode", "agent");

      // The card that asks permission, photographed AFTER the panel has been rebuilt under it.
      //
      // A blocked turn is the one state where the screen must contain something to act on, and that
      // card used to exist only as a message the panel had already consumed. Any rebuild destroyed
      // it and the turn waited for ever, with the request already sent and paid for. Nothing in this
      // suite could see that, because nothing in it ever photographed a turn that was waiting.
      await vscode.commands.executeCommand("hiveyCode.newSession");
      void vscode.commands.executeCommand("hiveyCode.askWith", "Please list the files in src.");
      await new Promise((r) => setTimeout(r, 3000));
      // The rebuild, through the ordinary path rather than a command: opening a document fires the
      // editor events the panel listens to, which send state, which rebuilds it — and in agent mode
      // the agent causes exactly this itself, by saving what it edits. A command that changes the
      // panel's screen would prove nothing, because it would also be the reason the card is not on
      // it.
      const scratch = await vscode.workspace.openTextDocument({ language: "typescript", content: "export const scratch = 1;\n" });
      await vscode.window.showTextDocument(scratch, { preview: true });
      await new Promise((r) => setTimeout(r, 1500));
      await announce("approbation");
      await vscode.commands.executeCommand("hiveyCode.stopAnswer");
      await new Promise((r) => setTimeout(r, 1000));
      // And start again before the next frame. Stopping resolves the pending approval as refused,
      // which leaves a red "the user declined" line in the transcript — correct behavior, and the
      // subject of its own photograph, but it then sat in the background of every frame after it.
      // A README should not open on a screenshot of something going wrong.
      await vscode.commands.executeCommand("hiveyCode.newSession");
      await new Promise((r) => setTimeout(r, 600));
      await quietly("notifications.clearAll");

      // A screen showing what an attachment actually looks like. Three separate fixes to "attach
      // all open editors" were verified by reasoning about the code, and the feature stayed broken
      // for the person using it — because nothing in the suite ever LOOKED at the result. This
      // opens real tabs and photographs the composer with them attached.
      const dir = await fs.mkdtemp(join(tmpdir(), "hivey-ctx-"));
      // One name long enough to prove the chip truncates rather than pushing its own cross off the
      // screen. It used to carry the excerpt note as well — "(outline of 211 symbols + head, …)" —
      // appended to the name, which made the attachment impossible to remove at all.
      for (const name of ["invoice.ts", "rounding.ts", "invoice-rounding-and-vat-adjustments.ts", "totals.ts"]) {
        const file = vscode.Uri.file(join(dir, name));
        await fs.writeFile(file.fsPath, `export const ${name.split(".")[0]} = 1;\n`, "utf8");
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), { preview: false });
      }
      await vscode.commands.executeCommand("hiveyCode.attachOpenEditors");
      await announce("contexte");
      // THE GATEWAY, selected and offering its own models.
      //
      // Four attempts at this path shipped broken — the provider that could not be selected, the
      // label that said "Local" whatever was chosen, the picker that buried three models under four
      // hundred and fifty-seven. Every one of them passed the tests that existed. None of them
      // survives a photograph, which is why there is one.
      await vscode.workspace
        .getConfiguration(SECTION)
        .update("endpoints.openaiCompatible", process.env["HIVEY_CODE_SCREENSHOT"], vscode.ConfigurationTarget.Global);
      await vscode.workspace
        .getConfiguration(SECTION)
        .update("chat.provider", "openai-compatible", vscode.ConfigurationTarget.Global);
      await new Promise((r) => setTimeout(r, 1500));
      await vscode.commands.executeCommand("hiveyCode.showModels");
      await announce("passerelle");

      // ⚠️ The provider screen, with a card open. It was photographed by NOTHING, and it is the one
      // Florian singled out — « c'est toujours aussi compliqué de comprendre les menus, settings ».
      // So it was changed blind, twice, and the scroll-jump it had (every keystroke in a key field
      // rebuilt the screen and returned it to the top) is exactly the kind of defect a photograph
      // catches and a unit test cannot: nothing is wrong with the DOM, the reader is just somewhere
      // else. A screen with no picture of it is a screen nobody checks.
      await vscode.commands.executeCommand("hiveyCode.setup");
      await new Promise((r) => setTimeout(r, 1500));
      // `setup` rather than a new name: the script has been waiting for exactly this one all along.
      await announce("setup");
      await vscode.workspace
        .getConfiguration(SECTION)
        .update("chat.provider", "local", vscode.ConfigurationTarget.Global);
      await vscode.workspace
        .getConfiguration(SECTION)
        .update("endpoints.openaiCompatible", undefined, vscode.ConfigurationTarget.Global);
      await new Promise((r) => setTimeout(r, 800));

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
    // Eight screens at twenty seconds each, plus a real conversation between them and one answer
    // deliberately streamed slowly so it can be photographed while it is still arriving.
    360_000,
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
/**
 * A model server that answers a scripted sequence: reply 0 to the first request, reply 1 to the
 * second, and the last one for ever after.
 *
 * `streamingStub` streams the same word until it is stopped, which is right for testing that a turn
 * can be interrupted and useless for testing what a turn DECIDES. A decision needs the model to say
 * a specific thing at a specific step — a tool call, then an answer — so that the turn reaches its
 * end and the code under test gets to look at what happened.
 */
async function scriptedStub(
  replies: Array<{ tool?: { name: string; args: unknown }; text?: string; reasoning?: string; truncated?: boolean; status?: number }>,
): Promise<{
  port: number;
  asked: () => string[];
  bodies: () => string[];
  close: () => void;
}> {
  const asked: string[] = [];
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url?.includes("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      bodies.push(body);
      try {
        asked.push(String(JSON.parse(body).model));
      } catch {
        asked.push("(unreadable)");
      }
      const reply = replies[Math.min(asked.length - 1, replies.length - 1)] ?? {};
      if (reply.status && reply.status >= 400) {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "rate limited" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      if (reply.tool) {
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } },
                  ],
                },
              },
            ],
          })}\n\n`,
        );
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
      } else {
        // Reasoning first when the script asks for it, exactly as a thinking model streams it: the
        // thinking arrives before a single word of the answer, which is the order that matters.
        if (reply.reasoning) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: reply.reasoning } }] })}\n\n`);
        }
        if (reply.text) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.text } }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reply.truncated ? "length" : "stop" }] })}\n\n`,
        );
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    port: (server.address() as { port: number }).port,
    asked: () => [...asked],
    bodies: () => [...bodies],
    close: () => server.close(),
  };
}

async function streamingStub(opts: { delayAfterFirst?: number } = {}): Promise<{
  port: number;
  open: () => number;
  /** Every model id this server was actually asked for, in order. */
  asked: () => string[];
  close: () => void;
}> {
  let open = 0;
  let served = 0;
  const asked: string[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url?.includes("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
      return;
    }
    // The body says which model the extension chose. It is read here rather than asserted on the
    // settings, because the setting is what the user picked and this is what was SENT.
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      try {
        const model = JSON.parse(body).model;
        if (typeof model === "string") asked.push(model);
      } catch {
        // A body this test cannot read is not this test's subject.
      }
    });
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
    asked: () => [...asked],
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
/**
 * Point the extension at a stub.
 *
 * `provider` matters for one thing and it is worth saying: the card that quotes a price is only
 * opened for a provider that bills, so a test about that card cannot use the local one. The card is
 * drawn before any key is needed, which is why a vendor with no key stored still reaches it.
 */
async function useStub(
  port: number,
  confirmSend: "always" | "never" = "never",
  provider: "local" | "openrouter" = "local",
): Promise<() => Promise<void>> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const key = provider === "local" ? "endpoints.local" : "endpoints.openrouter";
  const before = {
    provider: config.get("chat.provider"),
    model: config.get("chat.model"),
    endpoint: config.get(key),
    confirmSend: config.get("privacy.confirmSend"),
  };
  await config.update("chat.provider", provider, vscode.ConfigurationTarget.Global);
  await config.update("chat.model", "stub-model", vscode.ConfigurationTarget.Global);
  await config.update(key, `http://127.0.0.1:${port}/v1`, vscode.ConfigurationTarget.Global);
  await config.update("privacy.confirmSend", confirmSend, vscode.ConfigurationTarget.Global);
  return async () => {
    await config.update("chat.provider", before.provider, vscode.ConfigurationTarget.Global);
    await config.update("chat.model", before.model, vscode.ConfigurationTarget.Global);
    await config.update(key, before.endpoint, vscode.ConfigurationTarget.Global);
    await config.update("privacy.confirmSend", before.confirmSend, vscode.ConfigurationTarget.Global);
  };
}

/**
 * The smallest thing Word would recognize: a ZIP holding `word/document.xml`.
 *
 * Built here rather than committed as a binary fixture, so what is tested is the bytes a real
 * document has rather than a file nobody can read in a diff.
 */
function minimalDocx(documentXml: string): Buffer {
  const name = Buffer.from("word/document.xml", "utf8");
  const body = zlib.deflateRawSync(Buffer.from(documentXml, "utf8"));
  const raw = Buffer.from(documentXml, "utf8");

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(8, 10);
  dir.writeUInt32LE(body.length, 20);
  dir.writeUInt32LE(raw.length, 24);
  dir.writeUInt16LE(name.length, 28);
  dir.writeUInt32LE(0, 42);

  const files = Buffer.concat([local, name, body]);
  const directory = Buffer.concat([dir, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(files.length, 16);
  return Buffer.concat([files, directory, end]);
}
