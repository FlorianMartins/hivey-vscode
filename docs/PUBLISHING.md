# Publishing

What is prepared, what is left, and the exact commands. Everything below needs credentials that
belong to the maintainer, so none of it can run on a build machine without a secret — which is the
main reason this is a document rather than a workflow.

## What you need once

1. **A publisher.** Create one at <https://marketplace.visualstudio.com/manage>. Its identifier must
   match `publisher` in `package.json` — currently `hivey`, which makes the extension id
   `hivey.hivey-code`. The name cannot be changed afterwards without republishing under a new id and
   losing the install count, so decide it before the first publish, not after.
2. **An Azure DevOps token.** <https://dev.azure.com> → user menu → *Personal Access Tokens* → New:
   - **Organisation:** *All accessible organisations* (a token scoped to one organisation is
     rejected by `vsce` with an unhelpful 401).
   - **Scopes:** *Custom defined* → **Marketplace ▸ Manage**.
   - **Expiry:** the shortest you will tolerate re-creating. This token can publish under your name.
   Store it in a password manager. Never in `.env`, never in a shell history, never in the repo —
   this extension's own scanner would find it, which is the point of the scanner.
3. **Open VSX**, if you want the extension in VSCodium, Cursor, Gitpod, Windsurf or Theia. Those
   editors cannot install from the Microsoft Marketplace at all — its terms forbid it — so this is
   not optional for a large part of the audience. Create an account at <https://open-vsx.org>, sign
   the publisher agreement, and generate a token.

### Node

`@vscode/vsce@3` requires **Node ≥ 20**. Check with `node -v`; on Node 18 it fails during packaging
with a syntax error that looks like a bug in the extension and is not.

## Every release

```bash
npm ci
npm run typecheck
npm test                                # 193 tests (node:test)
xvfb-run -a npm run test:integration    # 9 tests inside a real VS Code
npm run scan:secrets                    # this repository, scanned with the extension's own rules
npm audit --audit-level=high            # 0 — five dev tools, no runtime dependency
```

Then bump and describe the release **before** packaging, because both are shipped inside the
`.vsix`:

```bash
npm version minor --no-git-tag-version
$EDITOR CHANGELOG.md
npm run build
npx @vscode/vsce@3 package --no-dependencies -o hivey-code.vsix
```

`--no-dependencies` is correct here and would be wrong in most extensions: the bundle is built by
esbuild and there is no runtime `node_modules` to include. Check what actually went in:

```bash
npx @vscode/vsce@3 ls --no-dependencies
```

`package.nls.json`, `package.nls.fr.json`, `readme.md`, `changelog.md`, `dist/` and `media/` should
be there; `docs/images/` should not — the README's screenshots are served from GitHub, and shipping
them would double the download for nothing.

**Install it and use it for an hour before publishing.**

```bash
code --install-extension hivey-code.vsix
```

The suite catches what it was written to catch. It does not catch a panel that feels wrong, a label
that reads badly at 260 px, or a model that is unbearably slow on the machine you actually have.

## Getting the .vsix without a build environment

Not everyone who needs the packaged extension can build it — a work machine behind a proxy, a
colleague testing a fix, or simply publishing from a browser because Azure DevOps will not create an
organisation on a corporate network. So every build is attached to a GitHub release, and one tag is
rolling:

    https://github.com/FlorianMartins/hivey-vscode/releases/download/build/hivey-code.vsix

That URL never changes; the asset behind it is replaced. To refresh it after a change:

```bash
npm run vsix:publish     # packages, then replaces the asset on the `build` tag
```

`build` is marked as a pre-release, so it never becomes the "Latest release" GitHub shows on the
repository page — a numbered tag stays the thing a stranger downloads.

**This is a distribution channel, not a release process.** A rolling asset means someone who
downloaded it yesterday and someone who downloads it today do not have the same file and have no way
to tell. Use it for testing and for hand-carrying a build to the Marketplace form; use a numbered
release for anything anyone will keep.

## Publishing

```bash
export VSCE_PAT=…                                # or let vsce prompt for it
npx @vscode/vsce@3 publish --no-dependencies

export OVSX_PAT=…
npx ovsx publish hivey-code.vsix -p "$OVSX_PAT"

git tag "v$(node -p 'require("./package.json").version')"
git push --tags
```

The Marketplace takes a few minutes to validate and a few hours to index. The extension is
installable by id immediately, and findable by search later — do not republish because a search
came up empty.

## What the Marketplace page is made of

| Shown | Comes from |
|---|---|
| Title, description | `displayName`, `description` in `package.json` |
| Icon | `icon` — 128×128 PNG, no transparency at the edges |
| Body of the page | `README.md`, rendered as GitHub Markdown |
| Changelog tab | `CHANGELOG.md` |
| Categories, tags | `categories`, `keywords` |
| Banner colour | `galleryBanner` |
| Q&A, Issues links | `qna`, `bugs`, `homepage` |
| “Free” label | `pricing` |

Two consequences worth knowing before the first publish:

- **Images in the README must be absolute URLs.** A relative `docs/images/x.png` works on GitHub and
  renders as a broken image on the Marketplace. Use
  `https://raw.githubusercontent.com/FlorianMartins/hivey-vscode/main/docs/images/x.png`.
- **The README is the product page.** Nobody clicks through to the docs. The first screen has to say
  what it is, who it is for, and what it does not send.

## Verified publisher

The blue tick next to the publisher name needs a domain you control, verified through Azure DevOps
(*Organisation settings → Marketplace → Verify domain*), and a DNS TXT record. It is worth doing for
an extension whose whole argument is trust: an enterprise deciding whether to let this read their
source will look at that badge before they read the threat model.

## Removing a release

You cannot delete a published version — you can only unpublish the whole extension, which frees the
id and loses everything attached to it. The real remedy for a bad release is a higher version
number:

```bash
npx @vscode/vsce@3 unpublish hivey.hivey-code   # last resort, irreversible
```

## What is deliberately not automated

Publishing from CI would mean a token with publish rights sitting in a repository secret, readable
by any workflow anyone adds, in a project whose premise is that you can see what leaves your
machine. The pipeline builds, tests, scans and packages the `.vsix` and attaches it to the run; a
person presses the last button.
