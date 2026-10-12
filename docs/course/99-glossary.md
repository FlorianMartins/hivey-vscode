# Glossary

[← Contents](README.md)

Alphabetical. The chapter given is the one where the term is explained in detail.

**Agent (mode)** — The mode where the assistant can read, change files and propose commands, every
action approved. → [5](05-the-three-modes-and-tools.md)

**API** — How two programs talk to each other: an address, a precise form, an expected reply.
→ [4](04-how-we-talk-to-it.md)

**API key** — A long password that says who pays. It is a secret. → [4](04-how-we-talk-to-it.md)

**Balance, key limit, auto top-up** — Three different things. The balance is money; a key's limit is
permission to spend money the account has; auto top-up is what refills the balance. A `402 Payment
Required` means one of the three, and raising a limit does nothing about a balance.
→ [10](10-the-cost.md)

**Branch** — A parallel line of work in a repository. → [1](01-the-stage.md)

**CL** — IBM i's command language. → [11](11-ibm-i.md)

**Commit** — A snapshot of the project, with a message saying why. → [1](01-the-stage.md)

**Compacting** — Replacing an over-long conversation with a summary the model writes, erasing nothing on
screen. → [6](06-the-context.md)

**Completion** — The suggestions as you type. The most frequent use, so the one that decides the bill.
→ [10](10-the-cost.md)

**Context window** — The amount of text a model can have in front of it at once. → [2](02-the-model.md)

**Db2 for i** — The database built into IBM i. → [11](11-ibm-i.md)

**DDS** — The language describing IBM i's files, screens and printed reports. → [11](11-ibm-i.md)

**Diff** — The list of differences between two versions of a file: lines added, lines removed. What the
extension shows you **before** writing. → [1](01-the-stage.md)

**Embeddings** — Turning a text into a list of numbers meant to represent its meaning. Building
embeddings means having the text **read** by a model, which is the problem.
→ [7](07-rag-and-memory.md)

**Escalation** — Moving to a more powerful model **after** an observed failure, not from the way the
question was phrased. → [10](10-the-cost.md)

**Extension** — A module that teaches the editor something new. → [1](01-the-stage.md)

**Fingerprint** (*hash*) — A short digital signature of a text, always the same for the same text, and
from which the text cannot be recovered. → [9](09-privacy.md)

**Gateway** — A middleman between you and the providers. → [3](03-where-the-model-runs.md)

**Git** — The tool that tracks a project's history. → [1](01-the-stage.md)

**Glob** — A path pattern with wildcards: `**/.env` means every `.env` file. → [9](09-privacy.md)

**GPU** — Graphics card. Runs a model ten to fifty times faster than a processor.
→ [3](03-where-the-model-runs.md)

**Hallucination** — A wrong answer stated with the same assurance as a right one. Not a bug that will be
fixed: it is the mechanism. → [2](02-the-model.md)

**Hivey preset** — An **intention** rather than a model: a routing that assigns a model to each role.
⚠️ Its label and its identifier do not match. → [10](10-the-cost.md)

**Hook** — Your own command, run before or after a tool call.
→ [5](05-the-three-modes-and-tools.md)

**HTTP** — The web's protocol, used by APIs too. → [4](04-how-we-talk-to-it.md)

**IBM i** — IBM's system (formerly AS/400) that has run business applications since the 1980s.
→ [11](11-ibm-i.md)

**JSON** — A structured text format, readable by a human who makes the effort.
→ [4](04-how-we-talk-to-it.md)

**LLM** (*Large Language Model*) — A language model: a program that guesses the next word.
→ [2](02-the-model.md)

**Local** — Running on your machine or your network. ⚠️ A **gateway** on your network is not local if it
forwards elsewhere. → [3](03-where-the-model-runs.md)

**Map of the repository** — The list of files and the symbols they declare, without their contents: a
table of contents of the project, for the model. → [6](06-the-context.md)

**MCP** (*Model Context Protocol*) — The convention that lets an external service be plugged into any
assistant, without either side knowing the other. → [8](08-mcp.md)

**Ollama** — The simplest program for running a model at home. → [3](03-where-the-model-runs.md)

**Open source** — Whose source code is public and reusable under conditions. What makes a privacy promise
**checkable** instead of believable. → [1](01-the-stage.md)

**OpenRouter** — A gateway: one account, one key, hundreds of models.
→ [3](03-where-the-model-runs.md)

**Parameters** (of a model) — The numbers tuned during training. `7b` = 7 billion.
→ [2](02-the-model.md)

**Plan (mode)** — The mode where the assistant reads and changes nothing. Guaranteed **because the
writing tool does not exist**, not because it was asked not to.
→ [5](05-the-three-modes-and-tools.md)

**Prompt** — The text sent to the model, invisible instructions included (the *system prompt*).
→ [2](02-the-model.md)

**Pseudonymisation** — Replacing recognisable items with **reversible** markers, the matching vault
staying on your machine. → [9](09-privacy.md)

**Quantisation** — Shortening a model's numbers so it fits in memory: 28 GB → 5 GB, for a small loss.
→ [2](02-the-model.md)

**RAG** (*Retrieval-Augmented Generation*) — Fetching the useful documents and putting them in the
question. The model **learns nothing**. → [7](07-rag-and-memory.md)

**Recency** — How new a model is, used to choose the newest. ⚠️ It was claimed in this project and **did
not exist**, through a rounding error. → [10](10-the-cost.md)

**Repository** (*repo*) — A project's folder, plus its entire history. → [1](01-the-stage.md)

**RPG** — IBM i's historic language, in several shapes, some of which **the column changes the meaning**
in. → [11](11-ibm-i.md)

**SIEM** — The system where a company centralises its security logs. → [9](09-privacy.md)

**Signature** — Mathematical proof that a text comes from the holder of a key and has not been modified.
→ [9](09-privacy.md)

**Sovereign** — You decide where your code goes, and you can check it. Neither "free" nor "offline".
→ [3](03-where-the-model-runs.md)

**SSE** (*Server-Sent Events*) — The technique that makes an answer appear word by word, and lets you
stop it before having paid for all of it. → [4](04-how-we-talk-to-it.md)

**Symbol** — A name declared by code: a function, a class, a type. → [6](06-the-context.md)

**Temperature** — The randomness setting in answers. → [2](02-the-model.md)

**Terminal** — The area where you type commands, one per line. → [1](01-the-stage.md)

**Token** — The unit a model reads and produces; about 100 tokens to 75 words. It is the billing unit and
the limit unit. → [2](02-the-model.md)

**Tool calling** — The mechanism by which a model asks for an action to be performed for it. It normally
arrives in a reserved box of the reply, separate from the text. → [4](04-how-we-talk-to-it.md)

**Tool poisoning** — An MCP server that writes hidden instructions into its tools' descriptions, which
the model reads as orders. → [8](08-mcp.md)

**Vector index** — A collection of embeddings that lets you search by meaning. **This project has none**,
deliberately. → [7](07-rag-and-memory.md)

**VS Code** — The most used code editor, the one this extension is written for. → [1](01-the-stage.md)

**`.vsix`** — A VS Code extension's file: an archive you install. → [1](01-the-stage.md),
[13](13-install-and-use.md)

**Worktree** — A separate working copy of a git repository, where a background task works without
touching yours. → [5](05-the-three-modes-and-tools.md)

[← Contents](README.md)
