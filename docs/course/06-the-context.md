# 6. The context

[← Previous chapter](05-the-three-modes-and-tools.md) · [Contents](README.md) · [Next chapter →](07-rag-and-memory.md)

A model knows **nothing** about your project. It learned from public code up to a certain date, and
your repository is not part of it. Everything it will know about your code is what was put in front of
it in the question.

This is the tool's least visible work and it is the work that decides how good the answers are. An
assistant that answers badly often answers correctly **the question it was asked**: what nobody
remembered to show it did not exist for it.

## The map of the repository

Sending the whole project is impossible: it would not fit in the window
([chapter 2](02-the-model.md)), and it would cost a fortune. So a **map** is sent: the list of files
and, for each, the **symbols** it declares — the names of functions, classes, types — without their
contents.

It is the equivalent of a table of contents. The model does not know what `calculateVAT` does, but it
knows it exists, in which file, at which line. It can then **ask** to read that file
([chapter 5](05-the-three-modes-and-tools.md)) instead of guessing.

## The project's rules

A repository can also tell the model how to work in it: "tests run with `npm test`", "no new
libraries", "commit messages are in English". These rules are written in a text file of the project,
and Hivey Code reads the first one it finds, in this order: `.hiveycode/instructions.md` (its own,
which comes first), then `AGENTS.md` and `CLAUDE.md` at the root — the ones most repositories write
today for every coding agent and for Claude Code —, then `.github/copilot-instructions.md`. They are
not added together: the first that says something wins. Its text is placed in the system prompt of
every turn, survives every compaction, and an edit counts from the next question.

They are **instructions**, not guarantees ([chapter 5](05-the-three-modes-and-tools.md)): they steer
the model, they neither give it nor take away any tool.

## What you attach yourself

- **The open file**, offered and sent by default — the selection if there is one, the whole file
  otherwise. One click sets it aside.
- **Chosen files**, through the `+` menu or by dropping them from the explorer.
- **A screenshot, a stack trace, a log** — pasted or dropped. A short paste stays in the input box; a
  wall of text becomes an attachment instead of burying what you were writing.
- **A previous conversation**, attached from the history. "What did we decide about invoices last
  week" is a question about today's work.

## The `#` notation

To name precisely what you want to attach, you write in the question:

| Notation | What it attaches |
|---|---|
| `#file:path` | that file |
| `#selection` | what you have selected |
| `#changes` | your not-yet-saved modifications |
| `#problems` | the errors the editor is reporting |
| `#codebase` | the map of the repository |
| `#terminal` | the terminal's last output |
| `#sym:name` | the symbol with that name |

This is **GitHub Copilot's notation**, deliberately: you should not have to learn a second vocabulary
in order to change tools.

One point that bears directly on privacy: all of this is **resolved on your machine** before anything
leaves. That is what makes it possible to attach unpublished code to a conversation with a local
model — nothing needed to leave for the notation to work.

## The budget, and what happens when you exceed it

Every piece of context costs tokens, and the window is finite. So the tool keeps a **budget** and
decides what to keep.

Four design choices that show in use:

- **The budget follows the window of the model actually chosen**, not a number fixed once and for all:
  the whole window, less a reserve for the answer and the steps that follow (a twentieth of the window,
  at least room for one answer), as long as `hiveyCode.context.maxTokens` is 0 (the default); 8,000
  tokens when the window is unknown. With a fixed value of 8,000 tokens, conversations were being summarised after three
  exchanges and the answer came from the summary — when 8,000 tokens are a speck for a modern model.
- **A large file is read by the part that matters.** A file of more than 800 lines asked for whole
  returns its plan — every function, class and export with its line — and its first lines; the model
  then reads the part it needs, by a range of up to 2,000 lines, or searches for the right line first.
  Nothing is out of reach, but a 14,000-line file read in one go weighed on every later step of the
  turn. Lines the conversation already holds, with no change and no command since, are not read
  again: the model is pointed to its copy.
- **An attachment that is too large arrives as an outline**: every symbol it declares with its line,
  followed by its beginning — rather than its first N lines and nothing about the rest. An outline says
  *what the file is about*; its first hundred lines say only how it starts.
- **A file attached across five exchanges is sent once**, in the message nearest the question.

## Compacting

When the conversation fills its budget, it is **compacted**: the model writes a summary of the
exchange, and it is the summary that is sent from then on.

It happens **by itself** (`hiveyCode.context.autoCompact`, on by default): at three quarters of the
budget, the conversation is summarised before the question is sent, and the question goes right after
the summary. A **Stop** during the summary also cancels what was going to follow. With the setting
off, you are **offered** a summary from 70%, and a full context asks you a question instead of
failing. `/compact` does it on demand.

If the context fills up **in the middle of a task**, the task does not stop. The oldest tool outputs
are shortened first (the model can read them again word for word, [chapter 7](07-rag-and-memory.md)).
If that is no longer enough, the turn **summarises itself and carries on**, as Claude Code does: the
same model, without tools or thinking, writes the record of the work — the request word for word, the
files changed, the commands run, the state of the errors, what comes next — and the turn goes on from
that record. What never changes stays as it is: the system prompt, the project's rules and the
repository map, that is, the start of the request, the part the cache keeps (below). Three times at
most per turn; beyond that, what has already been done is noted in the answer, the conversation is
summarised, and the task picks up where it stopped.

Either way, the summary starts from what the agent **did**, not only from what it wrote: it is given
the list of actions, failures marked, and says where the errors stand. Before, a changed file or a
command run was in it only if the answer happened to mention it.

Two things to know:

- **Nothing is erased on screen.** All the exchanges stay visible, greyed, one click from coming back.
  What changes is what *leaves*, not what you see.
- **The saving is measured and displayed** (`8,200 → 900 tokens`), not asserted. A feature that claims
  to save something without showing how much is a feature you cannot judge.

## The prompt cache

An optimisation that deserves its own paragraph, because it decides entire bills.

Some providers charge **less** for the part of a request they have already seen. Since a conversation
re-sends everything from the beginning on every turn ([chapter 2](02-the-model.md)), the same opening
is sent ten times — and can therefore be billed ten times at the reduced price, provided that opening
is **identical byte for byte**.

Hence a project rule that looks like a detail and is not one: **the start of the prompt is an asset.**
Adding "just one line about the open file" to it breaks the match and makes you pay full price for all
the rest of the conversation. The rule is held by a test that sends two turns with a different file
open and compares the first message **byte by byte**.

Your own server follows the same mechanics, with no bill but not without effect: llama.cpp re-reads a
request only from the first character that changes, and re-reading a whole conversation takes time on
every question. Two things changed that opening on almost every turn, and no longer do. The marker
that frames attached files is set once per conversation, instead of being drawn again every turn. And
the repository map is no longer rebuilt as soon as a file is created or deleted — which the agent
itself does on almost every turn: it is kept, and the files created or deleted since are listed after
the history. Past 50 changes, or on request, it is rebuilt; dependencies and build output
(`node_modules`, `dist`…) do not count.

## In Hivey Code

Every exchange can be **muted** (it stays displayed, it stops being sent), **pinned** (it survives the
cut), edited or deleted. It is the most direct lever that exists on quality **and** on cost: a
conversation with a twenty-minute false trail still lying in it goes on sending that to the model
every turn, and the model goes on taking it into account.

[← Previous chapter](05-the-three-modes-and-tools.md) · [Contents](README.md) · [Next chapter →](07-rag-and-memory.md)
