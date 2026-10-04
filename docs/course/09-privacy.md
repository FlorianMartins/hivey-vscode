# 9. Privacy

[← Previous chapter](08-mcp.md) · [Contents](README.md) · [Next chapter →](10-the-cost.md)

This is the project's reason for existing. A company evaluating a coding assistant asks two questions:
**what leaves?** and **can you prove it?** Most tools answer with a privacy policy. This one answers
with a door you can inspect before the first byte moves, and with a register you can read afterwards.

## The single door

Every request to a remote model goes through **one single place** in the code. That sounds incidental
and it is the architecture's most important property: if there were two paths, both would have to be
checked, and forgetting one would be enough for the promise to fall. One path is one place to audit.

That door does four things, **in this order**, because each one can prevent the next.

### 1. Block

A file whose path matches a forbidden pattern (`privacy.blockedGlobs`) **is not sent**, at all,
whatever else is configured. A *glob* is a pattern with wildcards: `**/.env` means every `.env` file
wherever it is, `secrets/**` everything in that folder.

This is deliberately the first step and the most brutal: it does not negotiate.

### 2. Pseudonymise

Everything else is **pseudonymised** — and the word is chosen. This is not anonymisation: it is
**reversible**, and it has to be.

The mechanism: before sending, recognisable items are replaced by markers. An email address becomes
`⟨EMAIL_1⟩`, a server name `⟨HOST_1⟩`, a customer name you declared (`privacy.customTerms`) becomes a
marker of its own. The model works on the marked text. When its answer comes back, the markers are
**put back** before you see it.

Why reversible: if `⟨HOST_1⟩` stayed in the answer, the tool would be unusable. The vault that holds the
correspondence **stays on your machine**; it never leaves.

### 3. Refuse

If something has the shape of a **secret credential** — an API key, a password — and survived step 2,
the request **stops** and you are told. The reasoning: pseudonymisation knows how to replace what it
recognises, so arriving here means a secret was detected *and* could not be safely replaced. Sending it
anyway is not a choice worth offering.

### 4. Ask

You see a **card**: roughly how many tokens, to which host, which model, and what was pseudonymised
(the **kinds** and their counts: `EMAIL×3, HOST×1` — never the values). You answer once, for the
session, or always.

The card appears **in the conversation**, not in a modal window over the editor. Consent itself is not
negotiable — that is the whole product argument — but a window that blocks everything for a routine
question is a window people dismiss without reading. The question appears where the answer will appear.

## What an image changes, and why you are told

An image cannot be pseudonymised. A screenshot of your application contains names, amounts, addresses,
and no marker can stand in for them.

So: when an image is about to leave, the card **says so explicitly**. And the register records it. A
line announcing "0 pseudonymisations" on a turn that sent a screenshot would be **true and
misleading** — precisely the kind of partial honesty this project tries to avoid.

## The register, and why it is chained

Every remote request leaves a line: when, where to, which model, how many tokens, how much it cost, how
many markers. **Never the content** — a log of what you were trying to keep private is not a privacy
feature.

Each line additionally carries the **hash** of the one before it.

A *hash* is a digital fingerprint of a text: short, always the same for the same text, and such that
you cannot work back from the hash to the text. The trick: if line 5 contains the fingerprint of line 4,
then **modifying** line 4 changes its fingerprint, which no longer matches what line 5 announces. And to
hide that, you would have to rewrite everything that follows. **Deleting** a line leaves a hole the
verification finds.

This does not make the register impossible to falsify — somebody who controls the machine can rewrite
everything — but it makes a **quiet** falsification impossible, and that is the difference between
"here is what we logged" and "here is what we logged, and you can check nobody touched it".

## For a company: three more things

- **A signed policy.** A file on the machine, signed with the organisation's key, that **restricts**: a
  mandated provider, a list of allowed addresses, a maximum budget. Checked before anything reads a
  setting. It can only **tighten**: a policy that could *grant* something would be a way to switch off
  a guarantee, and that is inexpressible by construction. An unsigned or modified policy is
  **refused**, not ignored.

  *Signing*, here, means producing mathematical proof that a text really comes from the holder of a key
  and has not been modified since. It is the same mechanism that protects your operating system's
  updates.

- **The register shipped to the organisation's collector.** The same log, sent as **syslog** (the
  standard system-log format, standardised as RFC 5424) over an encrypted link, or as **OTLP** (modern
  observability's format). What leaves passes through a **field allow-list**: what reaches the **SIEM** —
  the system where a company centralises its security logs — is therefore the metadata, and never the
  content, and that is demonstrable rather than promised.

- **A proof of sovereignty.** A signed report that answers an auditor's question: over this period, what
  left this machine, to whom, and is the register intact? It can carry a **timestamp** from an
  independent authority (standard RFC 3161) — proof that the document existed on a given date, and
  therefore was not written afterwards to suit the story.

## The residues, named

The project keeps a **threat model** listing what these measures do **not** do. Three examples, because
they are more instructive than the list of countermeasures:

- **Somebody who approves without reading approves anyway.** No card protects against that.
- **A compromised machine reads the keychain.** Nothing at this level stands in the way.
- **A secret with no recognisable shape** (`password = sunshine`) is not detected.

A document listing only the countermeasures would be a brochure. This one lists both.

## In Hivey Code

Two rules that sum up the whole chapter:

1. **Zero telemetry.** The project reports nothing, nowhere, ever. No "anonymous usage statistics".
2. **Zero runtime dependencies.** The delivered program carries no third-party library: everything it
   uses, it writes itself or the engine provides. That is unusual and it is deliberate — what you audit
   is the program, and nothing else. A tool that promises your code does not leave while carrying forty
   libraries it knows nothing about is making a promise it is not in a position to keep.

[← Previous chapter](08-mcp.md) · [Contents](README.md) · [Next chapter →](10-the-cost.md)
