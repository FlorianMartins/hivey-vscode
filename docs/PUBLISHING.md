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
npm test                                # 1357 tests (node:test)
xvfb-run -a npm run test:integration    # 44 tests, headless, inside a real VS Code
npm run eval:verify                     # every task's check fails on its untouched fixture
npm run eval:solutions                  # and passes on its reference solution
npm run scan:secrets                    # this repository, scanned with the extension's own rules
npm run check:numbers                   # the figures the documents claim
npm audit --audit-level=high            # 0 — five dev tools, no runtime dependency
```

Then bump and describe the release **before** packaging, because both are shipped inside the
`.vsix`:

```bash
npm version minor --no-git-tag-version
$EDITOR CHANGELOG.md
npm run build
npx @vscode/vsce@3.9.2 package --no-dependencies -o hivey-code.vsix
```

`--no-dependencies` is correct here and would be wrong in most extensions: the bundle is built by
esbuild and there is no runtime `node_modules` to include. Check what actually went in:

```bash
npx @vscode/vsce@3.9.2 ls --no-dependencies
```

`package.nls.json`, `package.nls.fr.json`, `readme.md`, `changelog.md`, `dist/` and `media/` should
be there; `docs/images/` should not — the README's screenshots are served from GitHub, and shipping
them would double the download for nothing.

Then ask the **package** whether it would survive a submission. Not the repository: `.vscodeignore`
says what should ship and the `.vsix` is what does, and the gap between the two is where this has
already gone wrong.

```bash
npm run check:publish                   # reads hivey-code.vsix itself
```

It checks the fields a submission is refused without, the icon against the 128×128 the Marketplace
enforces, that the shipped changelog has a heading for the version being shipped, that no source map
or source file slipped in — and **every relative link in every Markdown document that ships**,
case-sensitively. It runs in CI too, straight after packaging.

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
npx @vscode/vsce@3.9.2 publish --no-dependencies

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

- **`vsce` rewrites relative links in the readme it publishes, and in that one only.** This is worth
  understanding precisely, because getting it half-right is what shipped five broken images for a
  whole release. `README.md` is processed: its relative links are rewritten against `repository`, so
  they work on the Marketplace. **Every other Markdown file in the package is left alone** — this was
  found on the French README, which shipped five relative links into `docs/images/`, a directory the
  package excludes, so a French reader of the installed extension saw five broken images. (That file
  has since been replaced by `docs/cours/`.) Anything other than the published readme needs its own
  absolute URLs
  (`https://raw.githubusercontent.com/FlorianMartins/hivey-vscode/main/docs/images/x.png`).
  `npm run check:publish` is what makes sure this stays true.
- **The published readme is `readme.md`, lower-case.** A document linking to `README.md` resolves on
  macOS and Windows and 404s on Linux. Same check.
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
npx @vscode/vsce@3.9.2 unpublish hivey.hivey-code   # last resort, irreversible
```

## What only the maintainer can do

Everything above is in place and verified by CI. What is left needs an identity nobody else can
create, and it is the whole reason this extension is not on the Marketplace:

1. **A Marketplace publisher.** Create the publisher `hivey` at
   <https://marketplace.visualstudio.com/manage>, with a Microsoft account. The id in
   `package.json` (`"publisher": "hivey"`) must match, or the upload is refused.
2. **A personal access token**, from Azure DevOps, scoped to *Marketplace → Manage* and to **all
   accessible organisations** — a token scoped to one organisation fails with an error that does not
   say that. Then `export VSCE_PAT=…`.
3. **An Open VSX account**, for VSCodium, Cursor, Gitpod and the editors that cannot use Microsoft's
   gallery at all. Sign in at <https://open-vsx.org> with GitHub, sign the publisher agreement, create
   a token, then `export OVSX_PAT=…`. This matters more than it sounds for this product: a shop that
   has chosen VSCodium has usually chosen it for the same reasons it would choose this extension.
4. **The domain verification**, if the blue tick is wanted — see below.

None of these can be done from CI or by a tool on the maintainer's behalf, and none of them should
be: a token with publish rights, held anywhere other than in the hands of the person pressing the
button, is a key to somebody else's editor.

## What is deliberately not automated

Publishing from CI would mean a token with publish rights sitting in a repository secret, readable
by any workflow anyone adds, in a project whose premise is that you can see what leaves your
machine. The pipeline builds, tests, scans and packages the `.vsix` and attaches it to the run; a
person presses the last button.

## Vérifier un `.vsix` publié

Chaque `.vsix` de la release `build` est construit par la CI et porte de quoi le vérifier :

```bash
gh attestation verify hivey-code.vsix --repo FlorianMartins/hivey-vscode
sha256sum hivey-code.vsix        # à comparer avec SHA256SUMS, dans la même release
```

L'attestation est une signature Sigstore émise par le workflow lui-même, via l'identité OIDC que
GitHub émet pour cette exécution précise. Elle répond à : « ce fichier a-t-il bien été construit par
ce workflow, depuis ce commit ». Personne d'autre que ce job ne peut en produire une.

**La reproductibilité octet pour octet n'est pas promise**, et c'est délibéré plutôt qu'à faire : un
`.vsix` est un zip, un zip enregistre la date de modification de chaque fichier, deux constructions
du même commit diffèrent donc. Aucun `vsce` déterministe n'existe aujourd'hui. Ce qui est offert à la
place — l'empreinte du fichier réellement publié, signée et liée au commit — répond à la question qui
compte : *ce que j'installe est-il ce qui est sur GitHub ?*

Les outils de construction sont **épinglés à une version exacte** (`@vscode/vsce@3.9.2`,
`@cyclonedx/cyclonedx-npm@6.0.1`). Un `@latest` dans une CI, c'est la prochaine release compromise
qui s'exécute dans le build.
