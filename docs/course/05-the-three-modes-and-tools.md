# 5. The three modes and tools

[← Previous chapter](04-how-we-talk-to-it.md) · [Contents](README.md) · [Next chapter →](06-the-context.md)

## Why three modes and not one

An assistant that can change your files is useful and dangerous. An assistant that can change nothing
is safe and limited. Rather than choose, Hivey Code offers **three** levels, and it is for you to say
which one you want — by a button, the command palette or a keyboard shortcut.

| Mode | What it can do |
|---|---|
| **Chat** | Answer. No tools. It does not even read your files of its own accord. |
| **Plan** | Read the repository, search, understand, propose a course of action. **It changes nothing.** |
| **Agent** | Read, search, **change files**, propose commands — every action approved by you. |

## The important point: "Plan changes nothing" is not an instruction

This is the most important design rule in the whole project, and it comes down to one sentence: **in
Plan mode, the writing tool does not exist.**

The difference from the other way of doing it is enormous. One could write in the system prompt: "you
are in plan mode, do not modify any file". That would work… most of the time. A prompt is a **request**
made of a model, and a model misunderstanding a request is the ordinary case, not the exception
([chapter 2](02-the-model.md)). It takes one unfortunate turn of phrase, one contradictory instruction
in a project file, or one insistent user, for the instruction to give way.

Here, the list of tools is built **in code**, according to the mode. In Plan mode, the function that
writes a file is not in the list sent to the model. The model cannot call it: not because it agreed
not to, but because it is not there.

This idea comes back everywhere in the project, and it is the one to remember if you remember only
one: **a guarantee lives in code, never in a prompt.**

## The agent loop, step by step

Here is what actually happens when you write, in Agent mode: "the tests are failing, fix it".

1. **Your question leaves**, with the context ([chapter 6](06-the-context.md)) and the list of
   available tools.
2. **The model asks for a tool**: "run `npm test`". That is not a sentence, it is a call
   ([chapter 4](04-how-we-talk-to-it.md)).
3. **You approve.** A card appears, saying exactly which command.
4. **The command really runs**, and its output **and its exit code** are sent back to the model. That
   is what makes "fix what is failing" possible in a single turn rather than by doing the round trip
   through you.
5. **The model reads the error**, asks to read the file concerned, then asks to change it.
6. **You see a diff** — lines removed, lines added — and you approve or you don't.
7. **It runs the tests again** to check. And so on, until an answer.

The number of steps in a turn is **capped** (twelve), so that a loop going round in circles does not
ask you for thirty approvals in a row.

## Permissions, and why they are per *shape* of action

Approving every action every time is exhausting; approving everything in advance is reckless. So for
each action Hivey Code asks you to choose between **"once"**, **"for this conversation"** and
**"always"**.

The detail that matters: "always" applies to a **shape** of action, not to all actions. Allowing
`npm test` forever **does not allow** `npm publish`. A separate screen shows what is permanent and
what expires at the end of the conversation, because a permission you cannot find again is a
permission you cannot withdraw.

## What you can plug into it

- **Hooks** — your own commands, before or after a tool call, declared in a file in the repository. A
  non-zero exit code **before** cancels the action; the team's formatter **after** runs on what has
  just been written. Since the file comes from the repository, it is reviewed like code — and if it
  changes, you are asked again.
- **A background task** — "do that while I carry on". It works in a separate copy of the repository (a
  git *worktree*) and, if your machine has a container engine, in a container **with no network**. It
  cannot reach your working copy, and the git commands it is allowed **do not include `push`**: a
  background agent that could publish is a background agent that can publish a mistake.
- **A second model that reviews the diff** before dangerous changes — a security setting, a file that
  configures everything else, or a diff too large to have been read. It answers a single question:
  *does this diff do something the request did not ask for?* Its objections appear on the approval
  card. **Local only**: if that second reader would have to be a billed model, it is not called and
  the card says so — a second opinion that would quietly double the price of every change is a
  feature you turn off.

## In Hivey Code

One measured detail, and it is instructive: in Agent mode, knowing whether the model **actually
acted** is information distinct from knowing whether it **succeeded**. The project's bench counts both
([chapter 12](12-measured-quality.md)), and on a small local model the result was: 51 tasks out of 56
where **no action was attempted**. The model was writing the change in a code block and asking "would
you like me to proceed?".

That is not a measurement detail. A score of 0% that does not say whether the model got it wrong or
never tried lets you decide nothing: the first case is fixed with a better model, the second with the
client and the prompt. They are two different problems.

[← Previous chapter](04-how-we-talk-to-it.md) · [Contents](README.md) · [Next chapter →](06-the-context.md)
