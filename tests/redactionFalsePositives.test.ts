// Ordinary code is not a credential.
//
// ⚠️ « il se déclenche alors qu'il n'y a pas de données sensibles (juste le projet avec du code) ».
// Over a thousand files of ordinary code (this repository and its dependencies), one in twenty was
// flagged as holding a credential, so the warning opened on nearly every request that sent a few files.
// Every line below was one of those.

import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, Vault, DEFAULT_POLICY } from "../src/core/redaction/index.js";
import { madeOfWords } from "../src/core/redaction/detectors.js";

const strict = { ...DEFAULT_POLICY };
const flags = (text: string): string[] => redact(text, new Vault(), strict).findings.filter((f) => f.kind === "secret").map((f) => f.value);

test("a URL, a path or a long type name is words, not a key", () => {
  for (const line of [
    "See [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array).",
    'type CipherChaCha20Poly1305Types = "chacha20-poly1305";',
    "import x from './src/dashboard/guilde/boutiqueRefonteOrnements2025.js';",
    "background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==);",
  ]) {
    assert.deepEqual(flags(line), [], line);
  }
  assert.equal(madeOfWords("CipherChaCha20Poly1305Types"), true);
  assert.equal(madeOfWords("Zx9Kq2Lm4Np7Rt5Vw8Yb1Dg3Hj6Kl0Qs"), false);
});

test("a variable, a type or a sentence after `password:` is not a password", () => {
  for (const line of [
    "function encrypt(algorithm: string, password: BinaryLike, options?: object) {}",
    "const client = new Client({ token: discordToken });",
    "app.use({ auth: requireAuth });",
    "const password = 'Password used to generate key';",
    "const url = new URL('https://abc:xyz@example.com');",
  ]) {
    assert.deepEqual(flags(line), [], line);
  }
});

test("…while real credentials are still caught", () => {
  for (const line of [
    "token: Zx9Kq2Lm4Np7Rt5Vw8Yb1Dg3Hj6Kl0Qs",
    'password = "hT7-x92Kd0qLm4"',
    "API_TOKEN=9f8d7a6b5c4e3f2a1b0c9d8e",
    "DATABASE_URL=postgres://app:h7Fk29QeL@10.0.0.4:5432/prod",
    'const key = "AIzaSyA1234567890abcdefghijklmnopqrstuvw";',
  ]) {
    assert.notDeepEqual(flags(line), [], line);
  }
});
