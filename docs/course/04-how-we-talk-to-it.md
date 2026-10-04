# 4. How we talk to it

[← Previous chapter](03-where-the-model-runs.md) · [Contents](README.md) · [Next chapter →](05-the-three-modes-and-tools.md)

This is the most technical chapter of the course, and it is worth the effort: it explains a real
defect in the project, found in October 2026, that completely prevented the tool from working with a
local model. You cannot understand it without knowing what an API is.

## An API is a counter

An **API** (*Application Programming Interface*) is how two programs talk to each other. Not an
interface for a human: a counter for another program, with very precise forms.

The counter image is exact. There is an **address** (where to present yourself), a **form** (what you
must fill in, in the exact order), and a **reply** in a shape agreed in advance. If you fill the form
in wrong, it is handed back to you and nothing happens.

The pieces:

- **HTTP** is the web's protocol — the language browsers use to ask for pages. APIs use it too: a
  question to a model is technically the same kind of thing as opening a web page.
- **JSON** is the format of the forms. Structured text with curly braces, readable by a human who
  makes the effort. `{"role": "user", "content": "Hello"}` is a message in JSON.
- An **API key** is a long password that says who pays. It is all anybody needs in order to spend your
  money: a key is a secret, exactly as a password is.

## Streaming, and why the answer appears word by word

When you see an answer write itself progressively, that is not an animation. The model really does
produce one token after another, and they are passed on to you as they come. The technique is called
**SSE** (*Server-Sent Events*): a connection that stays open and down which the server sends pieces
until it has finished.

The point is not cosmetic: you can **stop** an answer that was going wrong before it has been fully
computed, and therefore before you have fully paid for it.

## The two languages of models

This is the chapter's important point. There is not one shape of form, there are **two**:

- **The OpenAI shape.** Invented by OpenAI, now the de facto standard. Almost everybody accepts it:
  OpenRouter, Google, DeepSeek, Mistral, Groq, Ollama, vLLM… even when it is not their original
  format, they offer it as well.
- **The Anthropic shape.** Claude's, different in the details.

So Hivey Code has exactly **two** dialogue programs: one for the OpenAI shape, which serves ten
providers out of eleven, and one for Anthropic. The choice is made by a line in a table, not by an
exception in the code — one more provider is one more line.

## How a model asks to do something

A model can do nothing by itself. It can only produce text. For it to be able to read a file, there
has to be a mechanism — and the one that won is called **tool calling**.

It works like this:

1. Along with the question, the model is sent the **list of available tools**, described in JSON: a
   name, what it does, the information expected. For example: `read_file`, "reads a file", expects a
   `path`.
2. The model, instead of answering with text, answers **"call `read_file` with `path: "account.js"`"**
   — in a reserved field of the reply form, separate from the text.
3. The program really performs the read, and sends the contents back to the model.
4. The model carries on with the information in hand.

That back-and-forth is the **agent loop**, and it is the subject of
[chapter 5](05-the-three-modes-and-tools.md).

## The defect: when the model asks in the wrong box

Here is the story, because it explains better than any theory why these details matter.

The project wanted to **measure** its quality with a local model (that is
[chapter 12](12-measured-quality.md)). First task on the bench: "add an option to this small
program". The model answered — and **nothing happened**. No file changed. Zero tools called.

Looking at what it had actually replied, this is what we found: the tool call was **perfect**. The
right name, the right file, the right text to replace. But it was written **in the body of the
reply**, in a code block, instead of being in the form's reserved box. From the program's point of
view, the model had answered with a sentence. So it displayed the sentence.

The cause: for that model, Ollama **does not fill in** the reserved box — neither in its OpenAI shape
nor in its own. And this was not an exotic configuration: it was **the model the project recommended,
on the program it told you to install**. So agent mode, which is the tool's central feature, did
nothing at all in its default configuration.

## In Hivey Code

A tool call written in the text is now **recognised**. And because that consists of turning prose into
action — the riskiest thing in the whole project — it is bounded by three rules:

1. **Only if the reserved box is empty.** A properly-formed call always wins.
2. **Only if the call is at the end of the message and delimited.** Because "here is the JSON you
   would have to send, it would delete everything" is a **sentence**, not an order. The boundary is:
   nothing may follow the call.
3. **Only for a tool that exists.** A name nobody offered is not a call, it is a model inventing.

And what this correction costs is **written down**, not hidden. Normally the text and the calls arrive
down two separate channels, which guarantees that a model *talking about* an action cannot *perform*
one. By reading calls out of the text, that separation is lost. The project does not pretend
otherwise: a call read from the text is **marked as such**, and the approval card tells you — "read
from the model's message, not from a tool call". You decide knowing how it got there.

One last point, and it is a lesson beyond this project: the fix at first existed only in the
OpenAI-shape program. But an **Anthropic-format gateway** in front of a local model — an unremarkable
corporate arrangement — would have had exactly the same problem. Fixing only one of the two meant the
defect was repaired **depending on which proxy the operator happens to run**. An automatic check now
reads both programs and requires them to agree.

[← Previous chapter](03-where-the-model-runs.md) · [Contents](README.md) · [Next chapter →](05-the-three-modes-and-tools.md)
