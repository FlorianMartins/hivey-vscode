# 13. Install it and use it

[← Previous chapter](12-measured-quality.md) · [Contents](README.md) · [Glossary →](99-glossary.md)

This chapter assumes only that you have a computer. It does not assume you can code.

## 1. Install the editor

Download **VS Code** from <https://code.visualstudio.com> and install it like any other program. It is
free.

## 2. Install the extension

Hivey Code is **not on VS Code's marketplace yet**: it lacks a publisher account, which only the
maintainer can create. So you install it from a file.

1. Go to <https://github.com/FlorianMartins/hivey-vscode/releases/tag/build> and download
   **`hivey-code.vsix`**. (That address never changes: it is rebuilt with every version. The direct link
   is <https://github.com/FlorianMartins/hivey-vscode/releases/download/build/hivey-code.vsix>.)
2. In VS Code, open the **Extensions** panel (the four-squares icon in the left bar).
3. At the top of that panel, click the **`…`** menu, then **"Install from VSIX…"**.
4. Choose the downloaded file.

That's it. If you prefer a command, it is `code --install-extension hivey-code.vsix`.

**Check that the file really is the one that was built** (optional, but it is the kind of thing this
project encourages you to do):

```bash
sha256sum hivey-code.vsix   # compare with SHA256SUMS, on the same page
```

`sha256sum` computes a **fingerprint** of the file ([chapter 9](09-privacy.md)): if it matches, you have
exactly the published file.

## 3. Install a model on your machine

Without a model, the extension has nobody to talk to. The simplest is **Ollama**.

1. Download it from <https://ollama.com> and install it.
2. Open a **terminal** (on Windows: "Terminal" or "PowerShell"; on macOS: "Terminal"; on Linux: your
   usual terminal) and type:

```bash
ollama pull qwen2.5-coder:7b
```

That downloads about 5 GB. It is a 7-billion-parameter model ([chapter 2](02-the-model.md)).

3. Then, to let it answer:

```bash
ollama serve
```

There is **nothing else to configure**: the extension's defaults already point at
`http://127.0.0.1:11434/v1`, which is Ollama's address on your own machine. `127.0.0.1` means "this
computer here".

⚠️ **Know what you are going to get.** That model answers questions and does completion well. For
**agent** work — changing files by itself — the measurement in
[chapter 12](12-measured-quality.md) is unambiguous: it cannot do it. If you want agent mode, you need
either a more recent local model that can call tools, or escalation to a remote one.

## 4. Use it

Open a folder containing code, then the **Hivey Code** panel in the right-hand bar.

- **Ask a question** in the input box. The open file is attached by default, and you are shown that it
  is.
- **Change mode** (Chat / Plan / Agent) according to what you want to allow
  ([chapter 5](05-the-three-modes-and-tools.md)). Start with **Plan**: it reads and changes nothing.
- **`Ctrl+I`** in the editor rewrites the selection in place.
- **Right click → Hivey Code** on a selection: explain, find the problems, cover with a test, document,
  show the callers, simplify.
- On an error underlined by the editor, the **lightbulb** offers "Fix with Hivey Code". That is the best
  use of a small local model: the compiler already says **what** and **where**, all that is left is the
  fixing.

## 5. If you want to plug in a paid model

You need an **API key** ([chapter 4](04-how-we-talk-to-it.md)), bought from a provider or from a gateway
like OpenRouter.

In the command palette (`Ctrl+Shift+P`), run **"Hivey Code: Store a provider key"**. The key goes into
the **operating system's keychain** — not into a project file, which would end up published in the
repository.

Then, if you want escalation rather than using the paid model for everything, fill in
`hiveyCode.escalation.model`. Read [chapter 10](10-the-cost.md) first: escalation only fires on an
**observed failure**, which is the whole point.

## 6. The settings worth a look

In VS Code's settings, search for `hiveyCode`.

| Setting | Why you will touch it |
|---|---|
| `privacy.blockedGlobs` | The files that must **never** leave ([chapter 9](09-privacy.md)) |
| `privacy.customTerms` | Your customer and project names, to be pseudonymised |
| `privacy.egressPolicy` | `ask-always` so you are asked every time |
| `budget.dailyUsd` | The daily spend cap |
| `budget.perRequestTokens` | The size beyond which a request is questioned |
| `ibmi.writableLibraries` | The libraries an agent may change ([chapter 11](11-ibm-i.md)) |
| `language` | For a machine whose editor is in one language and whose user is in another |

## And if it doesn't work

- **Nothing answers.** Check that `ollama serve` is running. In a browser,
  `http://127.0.0.1:11434` should answer something.
- **"Unauthorized".** The key is missing, or expired. Run the command that stores it again.
- **"Payment Required".** Money, and [chapter 10](10-the-cost.md) tells the three causes apart: the
  balance, the key's limit, and auto top-up. The message says which one refused — and if it says the
  balance, raising the key's limit will not help.
- **It is very slow.** Without a graphics card that is normal
  ([chapter 3](03-where-the-model-runs.md)): reckon on about ten words a second. A smaller model will be
  faster and worse.
- **It changes no files.** You are probably in Plan mode, which changes nothing **by construction**
  ([chapter 5](05-the-three-modes-and-tools.md)). If you really are in Agent mode, read the end of
  [chapter 12](12-measured-quality.md): some local models do not call tools.

[← Previous chapter](12-measured-quality.md) · [Contents](README.md) · [Glossary →](99-glossary.md)
