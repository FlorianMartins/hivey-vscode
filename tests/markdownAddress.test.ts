// Web addresses in an answer, shown as links — see `URL_RE` in webview/markdown.ts.
//
// « pourquoi les URL s'affichent en rouge, il faudrait une couleur plus sobre comme le bleu ».

import { test } from "node:test";
import assert from "node:assert/strict";
import { isAddress, URL_RE } from "../src/webview/markdown.js";

test("an address alone between backticks is one", () => {
  assert.ok(isAddress("https://api.gleif.org/api/v1/search/leis?q=x&page=2"));
  assert.ok(isAddress("http://localhost:3000/"));
  assert.equal(isAddress("curl https://example.com"), false, "a command that contains one stays code");
  assert.equal(isAddress("fetch(url)"), false);
});

test("a bare address stops before the punctuation that closes the sentence", () => {
  const found = (s: string): string | undefined => URL_RE.exec(s)?.[0];
  assert.equal(found("Voir https://api.dofusdb.fr/achievements."), "https://api.dofusdb.fr/achievements");
  assert.equal(found("(source : https://example.com/a?b=1), puis"), "https://example.com/a?b=1");
  assert.equal(found("« https://example.com/x »"), "https://example.com/x");
  assert.equal(found("**https://example.com/x**"), "https://example.com/x");
});
