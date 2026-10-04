# 10. The cost

[← Previous chapter](09-privacy.md) · [Contents](README.md) · [Next chapter →](11-ibm-i.md)

## Why a coding assistant costs money

You are billed per **token** ([chapter 2](02-the-model.md)), separately for input and output, output
being several times dearer. Prices are expressed **per million tokens**: "$2/M in, $10/M out".

The trap is in the shape of the conversation, not in the unit price. Because a model has no memory,
**every turn re-sends everything from the beginning**. At the tenth exchange, you pay again for the
first nine. With a large file attached, a conversation's bill does not grow in proportion to the
number of questions: it grows **faster than that**.

And the most expensive use is not the one you would think. It is not the hard question asked three
times a day — it is **completion**, one request at every pause in typing, hundreds of times an hour.

## The project's three levers

### 1. The role decides the model

This is the main lever, developed in [chapter 3](03-where-the-model-runs.md): completion on a small
local model costs **nothing**, whatever its frequency. Most of the volume disappears from the bill
before optimisation is even discussed.

### 2. Escalation on an **observed** failure

Here is the project's most interesting idea, and it deserves to be understood by contrast with what is
usually done.

The usual way of deciding "this question is hard, let's take the big model" is to **look at the
question**. An expression spots words: "architecture", "refactor", "optimise". That is a **bet**, and
it is a bad one in both directions: it sends easy questions containing a frightening word to a paid
model, and it keeps hard questions phrased simply on the local one. Above all, **nothing in it ever
learns that the local attempt failed**.

Hivey Code does the opposite. It looks at what the turn **did** — which commands ran, what the editor's
diagnostics said, whether the same call failed three times — and answers a single question: **is there
evidence that this is not finished?** Escalating on that pays for an expensive model only when a free
one has **already been proven insufficient**, and the expensive model starts **from the failure** rather
than from the question.

Three precautions that make the difference between a good idea and a usable feature:

- **A turn with no verification is not a failure.** Many good answers run nothing and change nothing.
  Only an **observed** failure counts, because what a wrong decision here buys is the user's money.
- **The last check wins.** An agent that runs the tests, sees three failures, fixes them and re-runs has
  a failure in its trace **and a working repository**. Escalating on that would pay a remote model to
  redo finished work.
- **Not every non-zero exit code is a failure.** `grep` exits with an error when it finds nothing, which
  is an excellent answer to "is this used?". Only commands that are **plausibly a check** — a test
  suite, a compilation, a type checker — count. Without that precaution, nearly every turn that looked
  for something and didn't find it was buying a second turn on a bigger model, with nobody able to see
  it.

### 3. Routing that learns (optional)

One notch further: the extension can measure, **per repository**, per kind of task and per model, the
success rate actually observed — then choose **the cheapest model whose observed rate clears a
threshold**. The panel says why: "Chose qwen2.5-coder:7b: 9 out of 10 in this repository".

It is **off by default**, and the reason is a principle: a routing that learns **changes which model
answers**, and that is not a change to impose on the morning somebody updates the extension. Three
limits frame it: never a model the user has not allowed; never trust on too little history ("one
success is not a rate", and "no history" is not "bad"); and **a measurement does not exist unless
something verified**, otherwise a model ends up with a perfect record after twenty questions nobody
checked.

## The guard rails

- **A per-request cap** and **a per-day cap**, in dollars.
- **A per-request size cap**, in tokens — and its story says something. The dollar caps were calibrated
  when the middle preset aimed at a $120/M model; moving it to today's $10/M models, a runaway prompt of
  400,000 tokens (a pasted build log, a tool that read a compressed file) dropped to 80 cents and
  **passed under the $2 cap**. A cap in dollars **loosens with every fall in the market**, which for a
  tool whose argument is that your code does not leave is the wrong direction. 400,000 tokens of your
  repository going out deserve a question **at any price**.
- **A cost report**, readable, saying what was spent and on what.

## The Hivey presets

Rather than choosing a model, you can choose an **intention**. Three presets, which are **routings**
and not models:

| Preset | Its identifier | Promise |
|---|---|---|
| **Hivey Free** | `hivey/free` | Free endpoints only. Costs nothing, and is rate-limited like everything free. |
| **Hivey Smart** | `hivey` | A strong model where you feel it, a cheap one for the plumbing. |
| **Hivey Pro** | `hivey/smart` | The best of the catalogue on the hard work, without paying it to write commit messages. |

⚠️ The middle column is not an implementation detail: the label and the identifier **do not match**.
"Hivey Smart" is called `hivey`, and "Hivey Pro" is called `hivey/smart`. It is a legacy of two
renamings, and it shows: the measurement table in [chapter 12](12-measured-quality.md) publishes the
**identifiers**, so without this column a reader cannot connect a promise to its measured result.

Each one assigns a model to each of the four roles (chore, everyday, deep, completion). And the
essential point: **no model name is hard-coded in the project**. A file generated every day chooses, by
rule, from the real catalogue — budget, capability, vendor family, recency. When a vendor ships a
successor, that file moves, and nothing else does.

⚠️ Those rules had a defect worth telling, because it illustrates why "it's automatic" does not mean
"it's right". The **recency** term was computed as a ratio between two timestamps; since both are about
1.79 billion, the ratio was 0.999 for everybody. Across the whole catalogue — from GPT-3.5 (2023) to a
model released the day before — that term varied by only **0.0885**, when a simple vendor bonus was
worth 1.2. Recency was claimed in the file's header and did not exist. Result: the Pro preset was
running a model from **October 2025 at $120/M** when its September 2026 successor was available at
**$10/M** — twelve times the price for a model a year older. The rules now live in tested code, and a
second rule was added: **within one vendor's same line, a newer model that is no dearer removes the
other from the list**, because "never pay more for an older model" is a rule and not a balance of
points.

## Balance, limit, top-up: three different things

These three words look alike and name three unrelated objects. Confusing them costs an afternoon, and
that happened on this project.

- The **balance** is money. You paid the provider $20, you have $20 left, each request takes a little
  away. When it reaches zero, nothing more leaves.
- A **key's limit** is a **permission**, not money. A key capped at $50 means: "with this key, up to $50
  **of the account's money** may be spent". It is a damage limit if the key leaks, exactly like a card
  limit. On an account at zero, a key capped at $50 can spend nothing: $50 of nothing is nothing.
- **Auto top-up** is what connects the two: "as soon as the balance drops below $5, charge $20 to my
  card". It is **that**, and that alone, which turns a limit into headroom usable over time.

When a request is refused for money reasons, the provider returns a `402 Payment Required` error. Hivey
Code reads the exact reason the provider gives and says which of the three is to blame, because the
provider's own raw message generally advises raising the key's limit — which is useless nine times out
of ten.

⚠️ The case as it happened, and why it is instructive: the key reported **$48.42 of headroom under a $70
limit**, which naturally reads as "there is credit". The account's figures said something else: **$240.00
purchased ever, $240.11 consumed**, so a balance of **−$0.11**. The limit was intact because a limit is
not consumed; it was the money that was missing. And auto top-up had not happened — otherwise the
balance would never have reached zero. Three possible causes, all invisible from the extension: it is
not enabled, its trigger threshold was not crossed, or **the payment method failed** (expired card,
bank refusal — the most frequent case, and the provider says nothing about it in the error). On this
project it was the first: auto top-up was indeed switched off, and once credit was added the same
requests went through.

The lesson for the tool: **no code can fund an answer from a negative balance.** What the software can
do, it does — tell the three causes apart, name the right one, and not send you to adjust the wrong
setting. What it cannot do, it does not pretend to do.

There remains one case where the software really does repair, and it is different: when there is **a
little** money but not enough for the answer requested. The refusal then says "you asked for 4,096
tokens, you can only afford 1,991". Hivey Code reissues the request at 1,991 tokens, and tells you the
answer was capped — so that you do not take a cut-off answer for a complete one. Below a floor (256
tokens) it gives up: an answer too short to be useful is a more honest failure than a fragment.

## In Hivey Code

A distinction that recurs throughout the project and has to be held: **free** and **not priced** are not
the same thing. A local model costs nothing to bill, but it consumes electricity and time. So this
project's reports write "not priced" where the price is unknown, and **never $0.00**, because a zero is
an assertion.

It is the same discipline [chapter 12](12-measured-quality.md) applies to scores.

[← Previous chapter](09-privacy.md) · [Contents](README.md) · [Next chapter →](11-ibm-i.md)
