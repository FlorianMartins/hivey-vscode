# 7. RAG and memory

[← Previous chapter](06-the-context.md) · [Contents](README.md) · [Next chapter →](08-mcp.md)

## What RAG means

**RAG** stands for *Retrieval-Augmented Generation*. It is an intimidating acronym for a simple idea:
**before answering, go and fetch the useful documents and put them in the question.**

That's all. There is no magic, and above all: **the model learns nothing**. It is not modified, it is
not trained. It is simply given something to read at the right moment. If you ask "what is our
invoicing rule for Belgium?", a RAG system finds the documentation page that covers it, pastes it into
the question, and the model answers on that basis.

The benefit is twofold: the answer is about **your** information, and the model has fewer reasons to
invent ([chapter 2](02-the-model.md)) since it has the source in front of it.

## How you "find the useful documents"

This is where the approaches differ, and you need to understand both to understand the project's
choice.

**By words** (lexical search). You look for the documents containing the question's words. Simple,
fast, explainable — and blind to synonyms: a question about an "invoice" does not find a document that
says "debit note".

**By meaning** (vector search, or *embeddings*). Each document is turned into a list of numbers — a
**vector** — meant to represent its *meaning*. The same transformation is applied to the question, and
you look for the documents whose vector is nearest. The usual image is a map where texts about the
same thing are neighbours, even with no words in common. The collection of those vectors is called a
**vector index**.

It is more powerful. And it has a cost that is rarely mentioned: **to build those vectors, every
document has to be read by a model**. If that model is at a provider, then **the whole of your code
and your documentation is sent there** — not once per question, but in its entirety, at indexing time.
That is exactly what we were trying to avoid.

## What Hivey Code does, and what it refuses

The knowledge base is **optional and off by default**. When you enable it, it is **Markdown files** —
text — in one of these places:

- `.hiveycode/knowledge/` in the repository: versioned with the code, so reviewed and shared by the
  team.
- `~/.hiveycode/knowledge/`: yours, across all your projects.
- **Any folder you point at**: an internal documentation share, an exported wiki. **Markdown, plain
  text, Word and PDF** are read — the `.docx` and `.pdf` extractors are hand-written in the project,
  like the rest, to keep the "zero dependencies" promise.

Those folders are read **as they are**, with no header to add, and **read-only**: the tool never writes
into somebody else's documentation.

**There is no vector index, and that is an explicit decision of the project, not a backlog item.**
Search is on words and on **headings**. In exchange we keep the property that matters: no code and no
document is sent to an embeddings API.

Does that cost quality? Yes, on questions worded differently from the documents. It is the kind of
trade-off this project prefers to state rather than hide — and the honest next step would be an index
computed **on your machine**, which would have the gain without the sending.

## The detail that makes it fit in the budget

Sending the whole base with every question would be ruinous. So: **only the list of headings travels**
with each question — a dozen tokens per note. The model sees the headings, and **asks** to read the one
that looks useful, exactly as it asks to read a file.

## `/remember`, and the discipline that goes with it

The agent can **write** into the base, with the `/remember` command: what has been established about
this system, this business, these tools. Two rules frame it, and they come from an ordinary
experience — a badly kept knowledge base becomes a heap:

- **Writing a note whose subject already exists is refused**, showing you the notes that cover it. You
  correct the existing note rather than stacking a second, slightly different one that will contradict
  the first in six months.
- **Removing a note archives it with a reason**, instead of deleting it. "Why do we no longer believe
  that?" is a question people really do ask.

## In Hivey Code

A distinction that comes up often and is worth keeping in mind:

| | Where it lives | What it holds |
|---|---|---|
| **The context** | nowhere, rebuilt every turn | what the model sees now ([chapter 6](06-the-context.md)) |
| **The knowledge base** | Markdown files on your machine | what the team has established, durably |
| **The history** | your workspace | past conversations, searchable |

None of these three is "the model's memory". The model has no memory ([chapter 2](02-the-model.md)):
these are three ways of giving it back, every time, what it needs.

[← Previous chapter](06-the-context.md) · [Contents](README.md) · [Next chapter →](08-mcp.md)
