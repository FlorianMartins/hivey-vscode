# Understanding Hivey Code — the course

**Up to date for version 1.12.0.**

This course explains what Hivey Code is, what every technology it uses is for, and how they fit
together — **without assuming you can program**. If you don't know what a "token", an "API" or a
"repository" is, you are exactly the person it was written for.

It exists for a precise reason. This project has plenty of technical documentation: a
[README](https://github.com/FlorianMartins/hivey-vscode/blob/main/README.md), an
[architecture](../ARCHITECTURE.md), a [threat model](../THREAT-MODEL.md), 41 reasoned decisions. All
of it is written for somebody who codes. But the questions people actually ask about
this tool — *does my code go anywhere? what can it do that Copilot can't? how does it really work?* —
are questions you should be able to answer without knowing how to code, and should be able to
**explain to somebody else**. That is the goal: by the end, you should be able to talk about it.

## How to read this

The chapters follow on from each other, and each one assumes only the ones before it. You can also
dip in: every technical word is **bold on its first appearance** and repeated in the
[glossary](99-glossary.md).

Each chapter ends with an **"In Hivey Code"** section, which says what the project chose to do and
*why* — because most of these choices are trade-offs, not obvious answers.

| | Chapter | What you will be able to explain |
|---|---|---|
| 1 | [The stage](01-the-stage.md) | A code editor, an extension, a repository, a commit |
| 2 | [The model](02-the-model.md) | What a language model is, a token, a context window |
| 3 | [Where the model runs](03-where-the-model-runs.md) | Local, remote, gateway — and what "sovereign" means |
| 4 | [How we talk to it](04-how-we-talk-to-it.md) | An API, a key, streaming, and the two "languages" of models |
| 5 | [The three modes and tools](05-the-three-modes-and-tools.md) | Chat, Plan, Agent — and how an AI "does" something |
| 6 | [The context](06-the-context.md) | What the model sees of your project, and what that costs |
| 7 | [RAG and memory](07-rag-and-memory.md) | What RAG means, and why there is no vector index here |
| 8 | [MCP](08-mcp.md) | Plugging in an external service, and the risk that creates |
| 9 | [Privacy](09-privacy.md) | Pseudonymisation, a tamper-evident log, a signed policy |
| 10 | [The cost](10-the-cost.md) | Why it costs money elsewhere, and how it tends to zero here |
| 11 | [IBM i](11-ibm-i.md) | The computers nobody shows you that everything depends on |
| 12 | [Measured quality](12-measured-quality.md) | How you prove an assistant is good — or bad |
| 13 | [Install it and use it](13-install-and-use.md) | Getting it working on your machine, step by step |
| — | [Glossary](99-glossary.md) | Every term, alphabetically |

## Why this course replaced the old French README

There used to be a `README.fr.md`: a translation of the English README. It had two faults. It
**doubled the work** without adding anything — two documents to maintain, so one of them always
behind (it announced 284 tests when there were 700, and version `0.11.1` when the project was at
`0.61.0`). And it addressed **the same people** as the English one: people who code.

This course translates nothing. It explains. And it is kept current by a check that **refuses the
build** when the version announced at the top of this page is no longer the project's — see
[chapter 12](12-measured-quality.md). A document somebody promises to maintain is not maintained; a
document whose staleness breaks the build is.

⚠️ There are now two editions of this course, French (`docs/cours/`) and English (`docs/course/`),
and the same check holds them together: neither may carry a chapter the other lacks, and both must
declare the same version. A translation is the single most reliable thing in a repository to fall
behind, and the result is worse than staleness — two editions that disagree, with no way for a
reader to tell which one is current.
