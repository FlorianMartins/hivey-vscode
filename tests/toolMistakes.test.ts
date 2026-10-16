// What the tools say when the model's request is the mistake — so it can see its own mistake.
//
// « il corrige et ensuite dit que ce n'est pas bon » : a real session lost a dozen steps to a word it
// had misspelt (`skincare` for `skinator`) and to edits that replaced a text with the same text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nameDistance, nearestName } from "../src/core/text/nearest.js";
import { IDENTICAL_EDIT } from "../src/core/text/findText.js";
import { buildCliTools } from "../src/cli/tools.js";

test("the file the model meant is found from the one it misspelt", () => {
  assert.equal(nearestName("skincare-page.js", ["guilde.js", "skinator-page.js", "bandeaux.css"]), "skinator-page.js");
  assert.equal(nearestName("Panier.JS", ["panier.js"]), "panier.js", "case is not a different name");
  assert.equal(nearestName("index.html", ["guilde.js", "bandeaux.css"]), undefined, "a far name is not a typo");
  assert.equal(nameDistance("kitten", "sitting"), 3);
});

test("an edit that replaces a text with the same text is refused as such, and the file is left alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hivey-identical-"));
  await writeFile(join(dir, "a.js"), "const skinator = 1;\n");
  const edit = buildCliTools({ cwd: dir, blockedGlobs: [], showDiff: () => undefined }).find((t) => t.schema.name === "edit_file")!;
  const r = await edit.run({ path: "a.js", old: "skinator", new: "skinator" }, { report: () => undefined });
  assert.equal(r.isError, true);
  assert.equal(r.content, IDENTICAL_EDIT);
  assert.match(r.content, /same text, character for character/);
  assert.equal(await readFile(join(dir, "a.js"), "utf8"), "const skinator = 1;\n");
});
