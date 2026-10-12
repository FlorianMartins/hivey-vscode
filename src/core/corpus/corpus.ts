// What this machine learned, kept on this machine.
//
// Every time a local model fails and a remote one succeeds, something specific happened: a task this
// codebase contains, at a difficulty the small model could not reach, with a verifiable answer. That
// is the single most valuable training example a team can have — and it is the one thing a hosted
// service cannot collect without taking the code.
//
// So it is collected here, and it never leaves. Two exports come out of it:
//
//   • evaluation tasks, in the shape `eval/tasks` already uses, so the bench grows from the work
//     rather than from somebody inventing fixtures;
//   • a conversation set for fine-tuning a local model, so next month's small model can do what this
//     month's needed a paid one for.
//
// ⚠️ OFF BY DEFAULT, and the reason is not timidity. An episode holds the request, the content of the
// files it touched and the diff — which is to say it holds source code, on disk, outside the
// repository, for as long as the retention says. That is a reasonable thing to keep and an
// unreasonable thing to start keeping without being asked. The organisation's policy can forbid it;
// it cannot turn it on, because a policy that could GRANT would be a file worth forging
// ([ADR-0019](../../docs/adr/0019-la-politique-ne-fait-que-restreindre.md)).

export interface EpisodeFile {
  /** Workspace-relative. */
  path: string;
  /** The content BEFORE any attempt — which is what a fixture needs to be a fixture. */
  before: string;
}

export interface Episode {
  at: number;
  /** The question, as the user asked it. */
  request: string;
  /** The files the work touched, as they were before it started. */
  files: EpisodeFile[];
  /** What the local model did, and what the check said about it. */
  local: { model: string; diff: string; error: string };
  /** What the remote model did. */
  final: { model: string; diff: string };
  /** The command whose exit code decided it worked. Empty when the verdict came from diagnostics. */
  check: string;
  /** Files left out because they matched a blocked glob, so a thin episode is explainable. */
  omitted: number;
}

export interface Redacted {
  episode: Episode;
  /** True when nothing useful was left — the caller should not keep it. */
  empty: boolean;
}

/**
 * An episode with the forbidden paths removed.
 *
 * The privacy list applies here exactly as it applies to a request: a file nobody is willing to send
 * to a model is a file nobody wants sitting in a training corpus either. What is NOT removed is the
 * diff — a diff of a blocked file would never have been produced, because the tool that wrote it
 * refuses the path first.
 *
 * An episode whose every file was blocked is reported as empty rather than stored: a fixture with no
 * files is a fixture nobody can run.
 */
export function redactEpisode(
  episode: Episode,
  blockedGlobs: string[],
  matches: (path: string, glob: string) => boolean,
): Redacted {
  const kept = episode.files.filter((file) => !blockedGlobs.some((glob) => matches(file.path, glob)));
  const omitted = episode.files.length - kept.length;
  return {
    episode: { ...episode, files: kept, omitted: episode.omitted + omitted },
    empty: kept.length === 0,
  };
}

/**
 * What is kept, given a retention and a ceiling.
 *
 * Both, because they answer different questions: the retention is a promise to the person whose code
 * this is ("nothing older than ninety days"), and the ceiling is a promise to their disk. A
 * retention of zero means keep nothing, which is how somebody turns the feature off without losing
 * what they already have — the purge command is for losing it.
 */
export function trim(episodes: Episode[], retentionDays: number, max: number, now = Date.now()): Episode[] {
  const cutoff = retentionDays > 0 ? now - retentionDays * 86_400_000 : now + 1;
  return episodes
    .filter((e) => e.at >= cutoff)
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, max));
}

// ── Export one: evaluation tasks ─────────────────────────────────────────────────────────────────

export interface ExportedTask {
  /** The directory name under `eval/tasks`. */
  id: string;
  /** `task.json`, already serialised. */
  taskJson: string;
  /** `files/<path>` → content, the state before anything was attempted. */
  files: Record<string, string>;
}

/**
 * An episode as an evaluation task.
 *
 * The fixture is the BEFORE state, so the check fails on it — which is the one property the bench
 * requires of every task and the reason this export is worth anything. ⚠️ It is not PROVEN here:
 * proving it means running the check against the fixture, which is what `npm run eval:verify` does,
 * and the command that writes these says so rather than claiming it.
 *
 * `solution/` is deliberately NOT written from the final diff. A reference solution's job is to prove
 * the check is satisfiable, and a patch applied by hand to a fixture directory may not apply at all —
 * a task whose solution does not apply is worse than one with no solution, because `eval:solutions`
 * then reports the check as unsatisfiable and somebody goes looking for a bug in the check.
 */
export function toEvalTask(episode: Episode, index: number): ExportedTask {
  const slug = episode.request
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "");
  const id = `learned-${slug || "task"}-${index}`;
  const files: Record<string, string> = {};
  for (const file of episode.files) files[file.path] = file.before;
  return {
    id,
    taskJson: `${JSON.stringify(
      {
        title: episode.request.split("\n")[0]?.slice(0, 80) ?? "learned task",
        kind: "bug",
        prompt: episode.request,
        check: episode.check || "echo 'no check was recorded for this episode' && exit 1",
        timeoutMs: 180_000,
      },
      null,
      2,
    )}\n`,
    files,
  };
}

// ── Export two: a conversation set ───────────────────────────────────────────────────────────────

export interface Conversation {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

/**
 * The episodes as conversations, for fine-tuning a local model.
 *
 * The shape is the one every trainer accepts: a list of messages. What matters is what is in them —
 * the request, the files as they were, and the answer that WORKED. The local model's failed attempt
 * is deliberately NOT included as an assistant turn: training on a wrong answer labelled as the
 * conversation's answer is how a model learns the wrong thing. It appears as context in the user
 * turn instead, which is what actually happened.
 */
export function toConversations(episodes: Episode[], system: string): Conversation[] {
  return episodes.map((episode) => ({
    messages: [
      { role: "system" as const, content: system },
      {
        role: "user" as const,
        content: [
          episode.request,
          "",
          ...episode.files.flatMap((file) => [`--- ${file.path}`, file.before]),
          ...(episode.local.diff
            ? ["", "A first attempt produced this change, and it did not work:", episode.local.diff]
            : []),
          ...(episode.local.error ? ["", "What the check said:", episode.local.error] : []),
        ].join("\n"),
      },
      { role: "assistant" as const, content: episode.final.diff },
    ],
  }));
}

/** JSONL, one conversation per line, which is what every trainer reads. */
export function toJsonl(conversations: Conversation[]): string {
  return conversations.map((c) => JSON.stringify(c)).join("\n") + (conversations.length ? "\n" : "");
}

/** What the user is told before anything is written, so "nothing leaves" is not just a promise. */
export const EXPORT_NOTE = [
  "These files hold source code from this workspace: the files each task touched, as they were, and",
  "the change that fixed it. Nothing here has left this machine and nothing in this feature sends",
  "anything — but a corpus is a copy, so treat the folder you are writing to the way you would treat",
  "the repository itself.",
  "",
  "The evaluation tasks are written with their BEFORE state as the fixture, which is what makes a",
  "task's check fail before the work is done. That is not proven by writing them: run",
  "`npm run eval:verify` over them, and `npm run eval:solutions` will report them as unsatisfiable",
  "until somebody adds a reference solution by hand.",
].join("\n");
