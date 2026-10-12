# 1. The stage

[← Contents](README.md) · [Next chapter →](02-the-model.md)

Before talking about artificial intelligence, we need three words of vocabulary. If you already have
them, skip to [chapter 2](02-the-model.md).

## Code is text

A piece of software — a website, a phone app, the program that works out your payslip — is written as
**text**, in files. No pictures, no diagrams: lines of text, in a very strict language. Here is a
complete program:

```
console.log("Hello")
```

That line, written in a language called **JavaScript**, displays the word "Hello". That's all. Real
software is the same thing, in hundreds of thousands of lines spread across thousands of files.

An important consequence for what follows: **an assistant that writes code writes text**. That is why
an artificial intelligence model trained on text can do it. And it is also why your code can leave
for the internet as easily as a message can: it is text.

## The code editor, and VS Code

A **code editor** is a developer's word processor. It looks like Word, less pretty and far more useful
for this purpose: it colours the code so you can find your way around, it flags mistakes as you type,
it can search ten thousand files.

**VS Code** (properly *Visual Studio Code*) is the most used editor in the world. It is free, made by
Microsoft. Two things to remember about it:

- It has a **sidebar** — a column down one side where tools install themselves. That is where Hivey
  Code appears.
- It has a built-in **terminal**: a black area where you type commands, one per line. It is the other
  way of driving a computer, the one from before windows. It hasn't gone away because it is faster
  and because it can be automated.

There are variants of VS Code made by others: **VSCodium** (the same thing, without Microsoft's
proprietary parts), **Cursor** (the same thing, with AI built in). Hivey Code works in all of them.

## The extension

An **extension** is a module you add to the editor to teach it something new. Like an extension in a
web browser: an ad blocker adds a capability to Firefox without Firefox having been modified.

**Hivey Code is a VS Code extension.** It adds an assistant: a panel where you have a conversation,
suggestions as you type, and the ability to change files if you ask it to.

An extension is delivered as a file ending in **`.vsix`**. It is an archive — a box, like a `.zip` —
containing the extension's program, its images and its documentation. The editor knows how to open
and install it. [Chapter 13](13-install-and-use.md) shows how.

## The repository, the commit, the branch

When several people write the same piece of software, you need to know who changed what, and to be
able to go back. That is the job of a tool called **Git**.

- A **repository** (often shortened to *repo*) is the project's folder, plus **its entire history**
  since the first line was written.
- A **commit** is a snapshot: "here is the state of the project at this moment, and here is why I made
  this change". Every commit has a message. This project's messages are in English; its changelog and
  its decisions are in French.
- A **branch** is a parallel line of work. You create one to try something without disturbing the
  version that works. The main branch is traditionally called `main`.
- **GitHub** is a site that hosts Git repositories. This project's is public:
  `github.com/FlorianMartins/hivey-vscode`. Public means anybody can read all the code and all the
  history.

One last word, which will come back often: a **diff** is the list of differences between two versions
of a file. The lines added, the lines removed. When Hivey Code offers to change a file, it shows you a
diff **before** writing. That is your only real means of control, and
[chapter 5](05-the-three-modes-and-tools.md) returns to it.

## In Hivey Code

The project is **open source** under the **Apache-2.0** licence. "Open source" means the source code
is public and anybody may read it, modify it and reuse it; the licence says on what conditions.
Apache-2.0 is a permissive licence: a company may use it, commercially included, as long as it keeps
the copyright notices.

That is not a detail for this tool in particular. Hivey Code's entire argument is: "your code doesn't
leave". A promise like that, in software whose source nobody can read, is a promise you have to take
on trust. Here it is **checkable**: the code is public, and [chapter 9](09-privacy.md) shows you where
you would have to look.

[← Contents](README.md) · [Next chapter →](02-the-model.md)
