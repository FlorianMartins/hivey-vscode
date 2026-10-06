# 11. IBM i

[← Previous chapter](10-the-cost.md) · [Contents](README.md) · [Next chapter →](12-measured-quality.md)

This chapter explains a strand of the project that looks exotic and is not: it concerns the computers
running a considerable part of European banking, insurance, logistics and manufacturing — and that
almost nobody talks about.

## What an IBM i is

**IBM i** (formerly AS/400, then iSeries) is an IBM system, still sold, still developed, that has been
running business applications since the 1980s. An instance of it is called a *partition*.

Two properties explain its longevity and the problem that concerns us:

- **It is extraordinarily stable.** Code written in 1990 still runs today, unmodified. That is a
  virtue, and it is why nobody rewrites: it works.
- **Its database is inside the system**, not beside it. It is called **Db2 for i**.

The human consequence, and it is the real subject: the people who know these applications are
**retiring**, and there is almost no succession. A company can find itself with a fifteen-thousand-line
program whose logic nobody understands any more, and on which its invoicing depends.

## The languages, and the thing that breaks everything

- **RPG** is the historic language. It exists in several shapes, and that is where it all happens:
  **RPG III** (RPG/400, the old one), **ILE RPG in fixed format**, **ILE RPG in fully free format**
  (modern, which looks like a language of today), and **SQLRPGLE** (RPG with SQL inside it).
- **CL** (*Control Language*) is the system's command language: `DSPFD`, `CRTBNDRPG`, `DLTOBJ`.
  Three- or four-letter verbs, a great many of them.
- **DDS** (*Data Description Specification*) describes files, screens and printed reports.
- **COBOL** also exists on the platform.

And here is what makes an ordinary coding assistant dangerous here.

**In every other language, spaces are decoration.** On IBM i in fixed format, that is false: **the
column a character sits in changes what it means.** An RPG III calculation means one thing in column 26
and another in column 36. A DDS record name lives in columns 19 to 28 and nowhere else. A line that
runs past column 80 is not rejected: it is **truncated and compiled**.

A model trained mostly on free-format code writes `if x = 1;` into a fixed-format member, and the
failure does not show up at once: it shows up later, in a spooled file, as a message identifier.

## What Hivey Code does differently

**It infers the dialect from the member itself**, not from its file name: `**FREE` in column 1, or a
specification letter in column 6. Then it puts **that dialect's rules and its column rule** in the
prompt.

This is the highest-return decision of the lot: `.rpgle` says **nothing** about the format, and
announcing the wrong format to a model is the most reliable way to get code that does not compile.

It also leans on what the system already knows, instead of asking the model again:

- **Compile, read, fix.** It runs the compilation, then **reads the spooled file and the job log** and
  renders the messages with their member, their line and their identifier. A failed compilation is a
  **verdict** ([chapter 10](10-the-cost.md)), not an error to retry: the "compile, read, fix, recompile"
  loop fits in a single turn.
- **The shop's own tests, run.** If the team uses an RPG unit-test framework, its result counts as a
  verification.
- **"Who uses this?"** — the question asked before every change. The answer comes from the system
  (`DSPPGMREF` and the SQL catalogue), not from the model's impression.
- **This shop's naming conventions**, read from a file the team writes. A six-character name is not
  documentation: `CFC1234` means nothing in general, and means something precise at your site.

## The production barrier

This is the request that came up every single time, and it was not a feature request but a
**condition**: *"agents must never touch production"*.

A condition like that cannot be a sentence in a prompt
([chapter 5](05-the-three-modes-and-tools.md)). So it is a barrier **in code**, and it is deliberately
strict at the three places where being lenient would mean guessing:

- **What is unknown modifies.** A CL verb the extension does not recognise as a reader is treated as a
  writer. Being wrong in that direction costs a refusal you can lift; being wrong in the other costs a
  production file.
- **What is not qualified is refused.** `DLTOBJ OBJ(CUSTMAST)` resolves against the job's library list,
  which is not knowable from here and may perfectly well start with production. A command that does not
  say which library it means cannot be checked, and what cannot be checked does not pass a barrier that
  exists in order to check.
- **Every name counts.** A command naming four libraries passes only if all four are allowed.

And a command that carries what it is going to do **inside a string** — a shell through `QSH`, CL handed
to `QCMDEXC` — is refused outright, **even if it appears to name an allowed library**: what it touches is
built at run time and cannot be read from here. This point comes from a real defect: `QSH` was among the
"reading" verbs, so `QSH CMD('rm -r /QSYS.LIB/PROD.LIB')` passed the barrier unexamined.

The list is **empty by default**: a default list would be one company's library names shipped to every
other. While it is empty the barrier is inactive — and an installation that does not configure it has no
perimeter.

## In Hivey Code

41 IBM i skills (`/tofree` to convert a member to free format, `/sql` to write Db2 for i rather than
generic SQL, `/dds` to explain a display file…), **each backed by an evaluation task** that fails before
it is applied ([chapter 12](12-measured-quality.md)).

And where a task could not be written honestly — because it requires a live partition — the skill
**declares it** instead of claiming coverage. That is less flattering and it is the only version usable
by somebody who has to decide whether they can rely on it.

Those skills are filed into **families** (RPG, DDS, CL, Db2 for i, and fifteen or so more for the rest
of the world's languages), and a family that is off puts nothing in the `/` list. Until version 1.3.0
you had to go and tick it yourself, which almost nobody did: somebody opening an RPG member got the
general family and nothing else, so the 41 skills written for them stayed switched off while the model
guessed. They now switch on **according to the files you have open**.

Two details say more than the feature does:

- The automation only ever **adds**. A family you ticked stays on even on a day when you open no file
  of that kind. Switching off something somebody asked for, in order to be helpful, is the version of
  this feature nobody would keep enabled.
- It is decided **once per conversation**. The skills list is part of the portion of the instruction
  text the provider keeps in a cache and bills less for ([chapter 6](06-the-context.md)); a cache is
  compared from the beginning, and a single character that differs invalidates everything after it. A
  list that updated itself every time you clicked a tab would therefore make you re-pay for the whole
  prefix on every message — the most expensive possible way to be helpful.

The same defect reached the bench in [chapter 12](12-measured-quality.md), and there it was invisible:
the bench drives the terminal version, which has no editor to ask, and which therefore offered the
general family alone. **Every published figure was measured with those families switched off**, on a
bench where 22 of the 62 tasks are IBM i tasks. The table now says so at the top and — this is the
point — **the figures were not retouched**. Finding out whether the fix improves them means running
the measurement again, not estimating it.

[← Previous chapter](10-the-cost.md) · [Contents](README.md) · [Next chapter →](12-measured-quality.md)
