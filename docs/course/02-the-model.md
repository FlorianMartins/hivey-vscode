# 2. The model

[← Previous chapter](01-the-stage.md) · [Contents](README.md) · [Next chapter →](03-where-the-model-runs.md)

## What it actually is

A **language model** (*Large Language Model*, shortened to **LLM**) is a program that does **one
thing**: given the start of a text, it guesses the most likely word to continue it. Then it does it
again, including the word it has just produced. And again. That's all.

That seems too simple to explain what ChatGPT does. It is nevertheless exactly that. The reason
"guess the next word" produces correct sentences, working code and reasoning that holds up is that to
guess the next word well in *any* text, you have to have captured an enormous number of regularities
about the way the world is described.

Two consequences to keep in mind permanently:

1. **A model does not know that it does not know.** It always produces the most plausible
   continuation. When it lacks the information, the most plausible continuation is a well-formed
   invention. This is called a **hallucination**: a wrong answer stated with the same assurance as a
   right one. It is not a bug that will be fixed; it is the mechanism.
2. **A model has no memory between two questions.** Each time, the whole conversation is sent to it
   again from the beginning. When you have the impression it "remembers" what you said ten minutes
   ago, it is because the ten minutes were re-sent.

## Tokens

A model does not read letters, nor really words: it reads **tokens**. A token is a frequent piece of
text — often a whole short word, sometimes part of a word, sometimes just a space or a punctuation
mark.

Roughly, **100 tokens ≈ 75 words** of English. The word "antidisestablishmentarianism" costs several
tokens; the word "the" costs one.

Why this is the unit that matters throughout this course: **it is the billing unit and the limit
unit**. Providers charge per token (see [chapter 10](10-the-cost.md)), and models have a limit
expressed in tokens.

## The context window

The **context window** is the amount of text a model can have in front of it at once: the question,
the conversation, the attached files, and the answer it is in the middle of writing. All of it has to
fit.

The orders of magnitude have moved a lot and will keep moving: a small model you run at home is often
somewhere around 8,000 to 32,000 tokens; the large paid models are beyond 200,000. Remember the
principle rather than the figures: **a code file is thousands of tokens before you know it**, so the
window fills faster than you would think, and somebody has to decide what goes in it. That is the
whole subject of [chapter 6](06-the-context.md).

When the conversation outgrows the window, room has to be made. Two ways: **truncate** (throw away the
beginning — brutal, and you lose what had been decided) or **compact** (ask the model to summarise the
conversation, and replace the conversation with the summary). Hivey Code compacts, and **erases
nothing on screen**: the exchanges stay visible, greyed, one click from coming back.

## A model's size, and why you can tell

You will see names like `qwen2.5-coder:7b` or `llama3.1:70b`. The number followed by **`b`** is the
number of **parameters**, in billions. A parameter is a number tuned during training; a model is a
very large table of those numbers.

- **7b** = 7 billion parameters. Fits on a decent laptop. Writes simple code correctly, gets lost on
  long tasks.
- **70b** = ten times more. Markedly better, needs a serious machine.
- The big providers' models are larger still and their sizes are not published.

A raw model takes up too much room, so it is **quantised**: its numbers are replaced with shorter
approximations. A 7-billion-parameter model goes from about 28 GB to 4 or 5 GB, for a small loss of
quality. That is the reason running a model at home became possible.

The difference shows in use, and [chapter 12](12-measured-quality.md) **measures** it on this project:
a 7-billion-parameter model scored **0 out of 56** on the bench's tasks, and — the most instructive
part — in 51 cases out of 56 it did not **even try** to act.

## The settings people talk about

- **The prompt** is the text sent to the model. It generally contains instructions the user does not
  see — the **system prompt** — telling the model what it is, what it may do and how to answer.
- **Temperature** sets the randomness. At 0 the model always takes the most likely word: repetitive
  but predictable. Higher, it varies: useful for writing, risky for code.
- Some models can **reason out loud** before answering: they first produce a draft of their thinking.
  It improves hard answers and it costs tokens. Hivey Code shows it **while** it is being written —
  the only moment it is interesting — then folds it away as soon as the answer starts, and never
  sends it back to the model.

## In Hivey Code

The project supplies **no model** and trains none. It talks to the one you choose: yours on your
machine, your company's on its network, or a provider's if you pay for one. That is the subject of
[chapter 3](03-where-the-model-runs.md).

Two design choices that follow directly from this chapter:

- **The context size follows the model actually chosen**, instead of being a number fixed once. A
  budget of 8,000 tokens is nearly the whole window of a small local model and a speck for a large
  modern one. With a fixed number, conversations were being summarised after three exchanges and the
  answer came from the summary.
- **No model version is written into the project.** Names and prices change every month; a catalogue
  refreshes itself. It is also why this course does not give you "the best model": today's answer
  would be wrong in six months.

[← Previous chapter](01-the-stage.md) · [Contents](README.md) · [Next chapter →](03-where-the-model-runs.md)
