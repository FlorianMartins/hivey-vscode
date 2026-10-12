// Where the episodes live, and the three commands that are the whole of the user's control over them.
//
// The decisions are in `core/corpus/corpus.ts`. This file holds the storage and the honesty: a folder
// of source code outside the repository needs somebody to be able to see how much of it there is,
// export it, and destroy it — in one gesture each, found in the command palette rather than in a
// settings file.
//
// ⚠️ Nothing here opens a socket. That is not an oversight to be filled in later: the premise of the
// feature is that this is the thing a hosted service cannot collect without taking the code, and a
// single request from this module would be the feature contradicting itself. A test reads the source
// and refuses one.

import * as vscode from "vscode";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  EXPORT_NOTE,
  redactEpisode,
  toConversations,
  toEvalTask,
  toJsonl,
  trim,
  type Episode,
} from "../core/corpus/corpus.js";
import { matchGlob } from "../core/util/glob.js";
import { featureDisabled } from "../core/policy/policy.js";
import { policyState } from "./policy.js";
import { readSettings, SECTION } from "./config.js";
import { t } from "../shared/i18n.js";

/** How many episodes are kept whatever the retention says. A promise to the disk. */
const MAX_EPISODES = 500;

export class Corpus {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
  ) {}

  private get file(): string {
    // Global storage, not the workspace: an episode holds source code, and a corpus inside the
    // repository is a corpus that gets committed by somebody's `git add -A`.
    return join(this.context.globalStorageUri.fsPath, "corpus.json");
  }

  /** On unless the user asked for it, and off if the organisation forbade it. */
  enabled(): boolean {
    if (featureDisabled(policyState(), "corpus")) return false;
    return vscode.workspace.getConfiguration(SECTION).get<boolean>("corpus.enabled", false);
  }

  private retentionDays(): number {
    return Math.max(0, vscode.workspace.getConfiguration(SECTION).get<number>("corpus.retentionDays", 90));
  }

  async read(): Promise<Episode[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Episode[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async write(episodes: Episode[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(episodes, null, 2)}\n`, "utf8");
  }

  /**
   * Keep one episode, if the feature is on and there is anything left after the privacy list.
   *
   * Called only when the verification went GREEN after the remote model: an episode whose final diff
   * does not work is not a training example, it is two wrong answers.
   */
  async record(episode: Episode): Promise<void> {
    if (!this.enabled()) return;
    const { episode: redacted, empty } = redactEpisode(episode, readSettings().privacy.blockedGlobs, matchGlob);
    if (empty) {
      this.log.appendLine("[corpus] an episode was dropped: every file it touched is on the privacy list.");
      return;
    }
    const kept = trim([redacted, ...(await this.read())], this.retentionDays(), MAX_EPISODES);
    await this.write(kept);
    this.log.appendLine(
      `[corpus] kept an episode (${redacted.files.length} file(s)${redacted.omitted ? `, ${redacted.omitted} omitted` : ""}); ${kept.length} in all.`,
    );
  }

  /** What the user sees when they ask what is being kept. */
  async status(): Promise<void> {
    const episodes = trim(await this.read(), this.retentionDays(), MAX_EPISODES);
    if (!this.enabled()) {
      void vscode.window.showInformationMessage(
        featureDisabled(policyState(), "corpus")
          ? t("Your organisation has switched the learning corpus off. {0} episode(s) are still on disk.", episodes.length)
          : t("The learning corpus is off. {0} episode(s) are on disk from when it was on.", episodes.length),
      );
      return;
    }
    const files = episodes.reduce((n, e) => n + e.files.length, 0);
    void vscode.window.showInformationMessage(
      t(
        "{0} episode(s), {1} file(s) of source, kept for {2} day(s), in this extension's storage and nowhere else.",
        episodes.length,
        files,
        this.retentionDays(),
      ),
    );
  }

  /** Both exports, into a folder the user chooses. */
  async export(): Promise<void> {
    const episodes = trim(await this.read(), this.retentionDays(), MAX_EPISODES);
    if (!episodes.length) {
      void vscode.window.showInformationMessage(t("There is nothing in the corpus to export."));
      return;
    }
    const target = await vscode.window.showSaveDialog({
      title: t("Where should the corpus go?"),
      defaultUri: vscode.Uri.file(join(require("node:os").homedir() as string, `hivey-code-corpus-${new Date().toISOString().slice(0, 10)}`)),
    });
    if (!target) return;
    const root = target.fsPath;

    await mkdir(root, { recursive: true });
    await writeFile(join(root, "READ-THIS-FIRST.txt"), `${EXPORT_NOTE}\n`, "utf8");

    // One: tasks in the shape the bench already uses.
    for (const [i, episode] of episodes.entries()) {
      const task = toEvalTask(episode, i + 1);
      const dir = join(root, "tasks", task.id);
      await mkdir(join(dir, "files"), { recursive: true });
      await writeFile(join(dir, "task.json"), task.taskJson, "utf8");
      for (const [path, content] of Object.entries(task.files)) {
        const at = join(dir, "files", path);
        await mkdir(dirname(at), { recursive: true });
        await writeFile(at, content, "utf8");
      }
    }

    // Two: a conversation set.
    await writeFile(
      join(root, "conversations.jsonl"),
      toJsonl(
        toConversations(
          episodes,
          "You are a coding assistant working inside the user's editor on their own infrastructure.",
        ),
      ),
      "utf8",
    );

    const answer = await vscode.window.showInformationMessage(
      t("{0} task(s) and {1} conversation(s) written. Nothing left this machine.", episodes.length, episodes.length),
      t("Open the folder"),
    );
    if (answer) void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(join(root, "READ-THIS-FIRST.txt")));
  }

  /** Destroy everything. One gesture, and it says what it destroyed. */
  async purge(): Promise<void> {
    const episodes = await this.read();
    if (!episodes.length) {
      void vscode.window.showInformationMessage(t("The corpus is already empty."));
      return;
    }
    const go = await vscode.window.showWarningMessage(
      t("Delete {0} episode(s) from the learning corpus? This cannot be undone.", episodes.length),
      { modal: true },
      t("Delete them"),
    );
    if (go !== t("Delete them")) return;
    await rm(this.file, { force: true });
    void vscode.window.showInformationMessage(t("{0} episode(s) deleted.", episodes.length));
  }
}
