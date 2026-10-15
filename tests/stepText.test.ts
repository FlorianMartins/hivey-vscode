// What a tool said, in the reader's language — for display only.
//
// « dans les réponses il continue de basculer entre les langues ».

import { test } from "node:test";
import assert from "node:assert/strict";
import { setLanguage } from "../src/shared/i18n.js";
import { stepText } from "../src/shared/stepText.js";

test("a tool's first line is shown in the reader's language; data stays as it is", () => {
  setLanguage("fr");
  try {
    assert.equal(stepText("Edited public/guilde.js."), "public/guilde.js modifié.");
    assert.equal(stepText("Wrote test/stats.test.js (8 lines)."), "test/stats.test.js écrit (8 lignes).");
    assert.equal(stepText("No diagnostics."), "Aucun diagnostic.");
    assert.equal(stepText("exit code 1"), "code de sortie 1");
    assert.equal(stepText("Plan updated (2/5 done)."), "Plan mis à jour (2/5 faits).");
    assert.equal(stepText("(no match)"), "(aucun résultat)");
    // A path, a match, a log line: data, not words of ours.
    assert.equal(stepText("public/index.html:6: Le site a été mis à jour"), "public/index.html:6: Le site a été mis à jour");
    assert.equal(stepText("'use strict';"), "'use strict';");
  } finally {
    setLanguage("en");
  }
  assert.equal(stepText("Edited a.ts."), "Edited a.ts.", "in English, unchanged");
});
