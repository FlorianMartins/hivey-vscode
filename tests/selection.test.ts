// The catalogue of things offered for a highlighted fragment.
//
// It lives in core precisely so this file can exist: every previous version of these offers was a
// closure inside a quick pick or a pair of literals inside a code-action provider, and neither can
// be looked at from a test. What is asserted here is not taste — it is that nothing in the list is
// empty, mislabelled or duplicated, which is the class of defect that reaches a user as a menu row
// doing nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { selectionActions } from "../src/core/agent/selection.js";
import { setLanguage } from "../src/shared/i18n.js";

test("every offer says something and asks for something", () => {
  for (const action of selectionActions()) {
    assert.ok(action.label.trim(), `${action.id} has no label`);
    // An empty instruction would reach the model as a request to do nothing to your code, which is
    // the one outcome worse than a bad answer: an edit with no stated intent.
    assert.ok(action.instruction.trim().length > 20, `${action.id} has no real instruction`);
  }
});

test("the ids are unique", () => {
  // Menus, the lightbulb and any future keybinding all address a row by its id.
  const ids = selectionActions().map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(", "));
});

test("both destinations are offered", () => {
  // A list that lost one of the two halves would still look right in the menu: the separator for the
  // missing half simply would not appear, and the feature would be half gone silently.
  const where = new Set(selectionActions().map((a) => a.where));
  assert.deepEqual([...where].sort(), ["chat", "file"]);
});

test("the lightbulb gets a couple of rows, not the whole catalogue", () => {
  // The lightbulb is shared with every other provider in the editor. Two is a contribution; eight
  // is a takeover, and it buries the editor's own refactorings.
  const lit = selectionActions().filter((a) => a.lightbulb);
  assert.ok(lit.length >= 1 && lit.length <= 3, `${lit.length} rows on the lightbulb`);
});

test("the offers are translated, instructions included", () => {
  // The label being French while the instruction stays English is the shape this went wrong in
  // elsewhere: the visible half gets translated and the half sent to the model does not.
  try {
    setLanguage("fr");
    const fr = selectionActions();
    setLanguage("en");
    const en = selectionActions();
    for (let i = 0; i < en.length; i++) {
      assert.notEqual(fr[i]!.label, en[i]!.label, `${en[i]!.id} label not translated`);
      assert.notEqual(fr[i]!.instruction, en[i]!.instruction, `${en[i]!.id} instruction not translated`);
    }
  } finally {
    setLanguage("en");
  }
});
