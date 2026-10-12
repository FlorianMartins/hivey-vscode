# 3. Where the model runs

[← Previous chapter](02-the-model.md) · [Contents](README.md) · [Next chapter →](04-how-we-talk-to-it.md)

This is **the** question of this project. Everything else follows from it.

When you use ChatGPT, your text leaves for OpenAI's computers, the computation happens there, and the
answer comes back. Nothing happens on your machine. For a general-knowledge question, that has no
consequence. For your company's source code, it is a decision — and often a decision nobody made
consciously.

There are three possible places.

## 1. On your machine ("local")

The model is a file on your disk. A program loads it into memory and computes the answers with your
processor, or your graphics card if you have one.

The programs that do this:

- **Ollama** — the simplest. One command to download a model, and it stays in the background
  answering. It is the one this project assumes by default.
- **LM Studio** — the same thing with a graphical interface.
- **llama.cpp** — the engine underneath many of the others. For people who want to tune things.
- **vLLM** — built to serve **several users** from a server. This is what a company installs for a
  whole team.

What it takes, in practice:

- **Memory**: a quantised 7-billion-parameter model occupies 4 to 5 GB, which you need on top of
  everything else.
- **Speed**: a **graphics card** (*GPU*) does this computation ten to fifty times faster than a
  processor. Without a GPU it still works — slowly. For a measured order of magnitude on this
  project's machine (12 cores, no graphics card): about **8 words per second**, and a bench task
  takes some thirty seconds.

What you get: **nothing leaves**. No bill, no key, no question to ask yourself about what you write.
And the quality of a model that fits on your machine, which is to say not that of the large ones.

## 2. At a provider ("remote")

You pay for an account with somebody who runs very large models, and you send them your questions.
The providers this project can reach directly: **OpenAI**, **Anthropic** (Claude), **Google**
(Gemini), **DeepSeek**, **Qwen**, **Mistral**, **xAI**, **Groq**, **Perplexity**.

You get the best quality available, and you pay per token. And **your code leaves**, to a third party,
in a country that may not be yours, subject to laws that may not be yours. That is perfectly
acceptable in many situations — and forbidden in others.

## 3. Through a gateway

A **gateway** is a middleman: you talk to it, it talks to the providers.

- **OpenRouter** — one account, one key, access to hundreds of models from every provider. Handy for
  comparing without opening ten accounts.
- **Azure OpenAI** — OpenAI's models served by Microsoft, in the region you choose, under a corporate
  contract. This is the shape compliance takes in many large organisations.
- **LiteLLM** — a gateway you install **yourself**. Your machines talk to your gateway; it alone knows
  the keys and decides which model answers.

Remember the warning, because it is counter-intuitive: **a gateway on your network is not a local
model**. If your gateway forwards to a public provider, your code leaves — it just leaves with one
extra hop. What you see is the gateway's address, not the final destination.

## What "sovereign" means

The word comes up constantly in this project. It does not mean "free", nor "without AI", nor
"offline". It means: **you decide where your code goes, and you can check it**.

Which supposes three concrete things, and they are exactly the tool's three promises:

1. **The choice exists** and it is yours, not the tool vendor's.
2. **What leaves is visible before it leaves** — not in a privacy policy, in a card that appears and
   asks.
3. **What has left is recorded** — so that a month later you can answer the question "what went out of
   here?". That is [chapter 9](09-privacy.md).

## In Hivey Code

The choice is made **per role**, and that is the heart of the tool's economics. There are at least
three roles:

- **Completion** — the suggestions as you type. Very frequent, short, easy. A small local model is
  enough, and since this is by far the most repeated use, it is where the bill is decided.
- **Chat** — your questions. A local model often answers these well.
- **Escalation** — a stronger model, called **only when necessary**. [Chapter 10](10-the-cost.md)
  explains how "necessary" is decided, and it is more interesting than it sounds: not from the
  question, but from an **observed failure**.

Two details that say a lot about how the project is built:

- **"Local" is decided by the address, not by the name of the setting.** Somebody who configures the
  "local" provider while pointing it at `api.openai.com` still gets pseudonymisation and the consent
  card. The setting does not decide whether your data leaves; the address decides.
- **An address on your network counts as local**: nothing is billed and nothing is pseudonymised,
  because nothing leaves the network. That is why the warning about gateways above is in bold: it is
  up to you to know whether yours forwards.

[← Previous chapter](02-the-model.md) · [Contents](README.md) · [Next chapter →](04-how-we-talk-to-it.md)
