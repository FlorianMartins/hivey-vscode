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

Three design choices that show in use:

- **The budget follows the window of the model actually chosen**, not a number fixed once and for all.
  With a fixed value of 8,000 tokens, conversations were being summarised after three exchanges and
  the answer came from the summary — when 8,000 tokens are a speck for a modern model.
- **An attachment that is too large arrives as an outline**: every symbol it declares with its line,
  followed by its beginning — rather than its first N lines and nothing about the rest. An outline says
  *what the file is about*; its first hundred lines say only how it starts.
- **A file attached across five exchanges is sent once**, in the message nearest the question.

## Compacting

When the conversation fills its budget, it is **compacted**: the model writes a summary of the
exchange, and it is the summary that is sent from then on.

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

## In Hivey Code

Every exchange can be **muted** (it stays displayed, it stops being sent), **pinned** (it survives the
cut), edited or deleted. It is the most direct lever that exists on quality **and** on cost: a
conversation with a twenty-minute false trail still lying in it goes on sending that to the model
every turn, and the model goes on taking it into account.

[← Previous chapter](05-the-three-modes-and-tools.md) · [Contents](README.md) · [Next chapter →](07-rag-and-memory.md)
