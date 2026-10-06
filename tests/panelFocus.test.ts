// Two things a rebuild must not take away: the cursor you are typing with, and the page following
// the answer as it is written.
//
// The panel redraws on any of sixty-odd state messages, almost none of which the user causes — a
// file saved, the caret moved in an editor, a model list arriving. Each redraw replaces the whole
// DOM, so anything that lives only in the DOM is lost unless it is explicitly carried across. The
// draft text and the caret position were carried. The FOCUS was not, so typing a question was
// interrupted by the box going dead under the keyboard: "the text area locks as if you had clicked
// somewhere else" — which is exactly what had happened.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a model's reasoning is open while it is written and shut once the answer starts", () => {
  // Both halves of "when the model thinks, the chat does not go to the last message": a shut block
  // does not GROW, so while the model was thinking there was nothing for the panel to follow. And
  // once the answer starts, the same block is in the way of it.
  //
  // Which makes this a property of the TURN rather than a preference of the reader — the right
  // answer changes halfway through, by itself — so there is no setting, and the assertion is on the
  // one line that does it.
  const source = readFileSync("src/webview/main.ts", "utf8");
  const append = source.slice(source.indexOf("appendReasoning("), source.indexOf("setPlan("));
  assert.match(append, /reasoningBlock\("",\s*\{\s*open:\s*true/, "thinking is not shown while it is written");

  const answer = source.slice(source.indexOf("appendText(chunk: string)"), source.indexOf("How much of what has arrived"));
  assert.match(answer, /this\.foldThinking\(\)/, "the reasoning is not folded when the answer takes over");
  const fold = source.slice(source.indexOf("private foldThinking()"), source.indexOf("private foldThinking()") + 400);
  assert.match(fold, /folded/, "it folds on every token instead of once, so it cannot be reopened");
});

/**
 * Asserted on the source, because there is no DOM here to assert it on.
 *
 * This project ships with no runtime dependencies, jsdom included, so the panel's behavior cannot
 * be exercised. What CAN be checked is that the two lines whose absence caused this are present —
 * which is worth more than it sounds: both defects were an omission, not a mistake, and an omission
 * is precisely what a reader does not see.
 */
test("the composer carries its focus across a rebuild", () => {
  const source = readFileSync("src/webview/chat.ts", "utf8");
  const capture = source.slice(source.indexOf("export function captureDraft"), source.indexOf("function composer("));
  assert.match(capture, /focused:\s*document\.activeElement === area/, "the draft does not record whether it had focus");
  assert.match(capture, /area\.focus\(/, "the draft is restored without its focus, so typing is interrupted by any redraw");
  assert.match(
    capture,
    /if \(draft\.focused/,
    "focus is restored unconditionally, which pulls the cursor out of the file being edited instead",
  );
});

test("reasoning arrives through the scroll-follow, like the answer does", () => {
  const source = readFileSync("src/webview/main.ts", "utf8");
  const method = source.slice(source.indexOf("appendReasoning("), source.indexOf("setPlan("));
  assert.match(method, /following\(/, "thinking is appended outside the follow, so the panel stays on the previous answer");
});

test("the composer row is the editor's own chat row, in its order", () => {
  // ⚠️ Asked for, and it REPLACES an earlier arrangement from this same session: the model had been
  // moved out of the box to sit with the provider and the approval scope. « reprend egalement les
  // positions de boutons de l'onglet chat de github copilot qui est propre », and the editor puts the
  // model picker in the chat input field beside the mode. Confirmed before moving anything, because
  // the two instructions contradict each other and undoing somebody's explicit choice in silence is
  // worse than either layout.
  //
  // The reason it is the better row and not merely the requested one: which mode answers and which
  // model answers are one decision asked twice, and splitting them across two rows is what made this
  // row never look settled.
  const source = readFileSync("src/webview/chat.ts", "utf8");
  assert.match(
    source,
    /left\.append\(contextButton\(state, deps\), modeButton\(state, deps\), modelButton\(state, deps\)\)/,
    "attach, mode and model are no longer one run at the head of the row",
  );
  // ⚠️ Skills is the exception to "the editor's order", and it is a report rather than a preference:
  // « le bouton skills and sub-agent disparait quand on diminue la largeur de la sidebar ». Last in
  // the left group, it was the first thing cut, because that group is the one carrying
  // `overflow: hidden`. The editor's own row never has to survive a 300-pixel panel; ours does. It
  // sits with the send, in the group that is never clipped.
  assert.match(source, /right\.append\(toolsButton\(state, deps\)\)/, "skills is back in the group that gets clipped");
  assert.ok(
    !/left\.append\(toolsButton/.test(source),
    "skills is in the clipped group again, so a narrow panel will eat it",
  );
  assert.match(
    source,
    /meter\.append\(providerButton\(state, deps\), approvalButton\(state, deps\)\)/,
    "the row under the box is no longer where the answer comes from and what it may do",
  );
  assert.ok(
    !/meter\.append\([^)]*modelButton/.test(source),
    "the model is in two places, so the panel can show two different answers to one question",
  );
});

test("the provider and the model do not wear the same glyph", () => {
  // They did, and it cost nothing while they sat in different rows. The moment they became neighbours
  // it became the one thing a reader cannot get past: two identical icons side by side say "these are
  // the same kind of thing" about the two choices people most need to keep apart.
  const source = readFileSync("src/webview/chat.ts", "utf8");
  const provider = source.slice(source.indexOf("function providerButton("), source.indexOf("function approvalButton("));
  const model = source.slice(source.indexOf("function modelButton("));
  assert.match(provider, /icon: ICON\.cloud/, "the provider is drawn as a chip again");
  // ⚠️ And the model wears its MAKER's mark rather than a generic chip — « rajoute une icone du
  // fournisseur devant le nom du modele comme sur github copilot ». `vendorMark` falls back to the
  // chip for anything it does not recognise, so a preset and an unknown vendor still look like a
  // model rather than like a missing image.
  assert.match(model.slice(0, 900), /icon: ICON\[vendorMark\(state\.model\)\]/);
});

test("⚠️ nothing styles this panel in a way its own CSP throws away", () => {
  // The defect that cost a whole release, and the reason it cost one: the markup was exactly right.
  //
  // The panel's CSP is `style-src ${webview.cspSource}` with NO `'unsafe-inline'`, deliberately,
  // because a model's output is rendered in this document. That forbids the `style` attribute — and
  // `cssText` and `setAttribute("style", …)`, which are the same attribute by another name. It does
  // NOT forbid assigning a property on `element.style`, which is how a runtime value must arrive.
  //
  // Two things were declared in the forbidden half and silently discarded:
  //   • `<body style="min-width:…px">`, so `hiveyCode.panel.minWidth` never applied and the side bar
  //     could be dragged to nothing — reported twice;
  //   • `probe.style.cssText` in the scrollbar measurement, so the probe had no size, the gutter was
  //     published as 0px, and the overhang it exists to remove was never removed.
  //
  // Neither could fail a test, so this is the test. It is about the PANEL only: `reports.ts` builds a
  // different document whose CSP says `style-src 'unsafe-inline'`, where the attribute is fine.
  const html = readFileSync("src/extension/chat.ts", "utf8");
  const page = html.slice(html.indexOf("<!DOCTYPE html>"), html.indexOf("</html>"));
  assert.ok(page.length > 200, "the panel's HTML is no longer where this test looks for it");
  assert.ok(
    !/\sstyle="/.test(page),
    "the panel's HTML carries a style attribute, which its own CSP discards — send the value in the state and apply it as a property",
  );
  // Asserted on the whole file: the policy is assembled above the markup, and the markup interpolates
  // it. If it ever gains `'unsafe-inline'` this test is reasoning about a document that no longer
  // exists, and should fail rather than keep passing for the wrong reason.
  assert.match(html, /`style-src \$\{webview\.cspSource\}`/, "the CSP this test reasons about has changed");
  // The policy itself, not the prose around it — this very file's comments say the words.
  const policy = html.slice(html.indexOf("const csp = ["), html.indexOf('.join("; ")'));
  assert.ok(
    !/unsafe-inline/.test(policy),
    "the panel's CSP now allows inline styles, so this guard is obsolete — read why it exists before deleting it",
  );

  // ⚠️ Comments stripped first. The guard tripped on its own explanation — the paragraph above names
  // both forbidden forms, as it must to be understood — and a guard that fails on documentation of
  // itself teaches people to stop writing it. What is being asserted is about CODE.
  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const file of ["src/webview/main.ts", "src/webview/chat.ts", "src/webview/dom.ts", "src/webview/models.ts", "src/webview/modelCombo.ts"]) {
    const source = withoutComments(readFileSync(file, "utf8"));
    assert.ok(!/\.style\.cssText/.test(source), `${file}: cssText is the style attribute by another name, and the CSP discards it`);
    assert.ok(
      !/setAttribute\(\s*["']style["']/.test(source),
      `${file}: setAttribute("style") is the style attribute by another name, and the CSP discards it`,
    );
  }
});

test("the minimum width reaches the page, and says what it cannot do", () => {
  // It travels in the state and is applied from script, because that is the only route the CSP leaves
  // open. And it is a floor on the CONTENT: VS Code gives an extension no way to set a minimum width
  // for a view, so nothing here stops the divider being dragged — the panel scrolls sideways instead of
  // reflowing into something unusable. Claiming otherwise is what made the setting look broken.
  const main = readFileSync("src/webview/main.ts", "utf8");
  assert.match(main, /document\.body\.style\.minWidth = /, "the floor is not applied as a property");
  assert.match(main, /applyMinWidth\(m\.state\.panelMinWidth\)/, "it is not applied on every state, so a setting change needs a reload");
  // Zero means "let it shrink" and undefined means "an older host did not send it". Collapsing the two
  // would make a deliberate 0 indistinguishable from no answer at all.
  assert.match(main, /if \(px === undefined\) return;/);
});

test("the way back is labelled on the bar, and only the opening question carries it in its header", () => {
  // ⚠️ Asked for by name: « je preferais le texte "Restore Checkpoint" sur la barre comme avec Github
  // copilot, tu peux remettre comme c'était […] et garder le bouton uniquement sur le premier
  // message ». Both halves matter and they are not interchangeable — the opening question has no bar
  // above it, because there is no boundary to draw before the first thing in a conversation, so it is
  // the one turn that needs the control somewhere else.
  const source = readFileSync("src/webview/chat.ts", "utf8");
  assert.match(source, /label: t\("Restore Checkpoint"\)/, "the bar lost its label again");
  assert.match(source, /if \(entry\.role === "user" && first\) \{/, "every question carries the header icon again");
  // The renderer must take `first` from the tested value rather than work it out again: a decision
  // tested in isolation and applied in a loop nothing tests is a decision nobody has checked, which
  // is the exact history of this control.
  assert.match(source, /renderEntry\(entry, state, deps, piece\.first\)/);
  // One sentence, written once. It is now offered from two places and it is the part that decides
  // whether to press — two copies of a promise drift, and the copy nobody looks at is the one that does.
  assert.match(source, /function restoreTitle\(entry: UiEntry\): string/);
  assert.equal(
    (source.match(/some changes were too large to record/g) ?? []).length,
    1,
    "the promise is written twice again, so the two places can disagree about what restoring does",
  );
});

test("⚠️ the width floor is below any ordinary side bar, and the composer looks after itself", () => {
  // ⚠️⚠️ THE PREVIOUS VERSION OF THIS TEST WAS MEASURED AND STILL WRONG, which is the part worth
  // keeping. It derived 470 px from the composer row's extent in a 540-pixel capture — correct
  // arithmetic on a false premise: that the row must always have its natural width. The row drops its
  // labels below 430 px, so it needs far less. And a floor of 470 did something much worse than being
  // generous: on a normally sized side bar it pushed the page WIDER than the panel, so every screen
  // was drawn with its right-hand side off the edge. Sentences cut mid-word is what the report « la
  // page Permissions […] vraiment incomprehensible » actually was — the page was fine, it was being
  // drawn off the edge. Proven by capturing the same screen with the floor at 0, where it is perfect.
  //
  // So the floor is asserted from both sides now. A floor you can reach by accident on an ordinary
  // panel is not a floor, it is a bug.
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { configuration: Array<{ properties: Record<string, { default?: number }> }> };
  };
  const floor = manifest.contributes.configuration
    .flatMap((section) => Object.entries(section.properties))
    .find(([id]) => id === "hiveyCode.panel.minWidth")?.[1]?.default;
  assert.ok(typeof floor === "number", "the floor is no longer declared in the manifest");
  assert.ok(floor >= 280, `${floor} px leaves a line of prose too short to read and a code block that is all scrollbar`);
  assert.ok(
    floor <= 400,
    `${floor} px is within reach of an ordinary side bar, where it pushes every screen off its own right edge`,
  );
  // And the composer survives below the floor by DROPPING LABELS rather than by being clipped, which
  // is what lets the floor be low at all.
  // ⚠️ Comments stripped: this guard has to name the forbidden form to be understood, and a guard that
  // fails on its own explanation teaches people to stop writing one. Second time in this file.
  const css = readFileSync("media/style.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /@media \(max-width: 430px\)/, "the composer no longer degrades, so the floor is load-bearing again");
  // ⚠️ And never a viewport unit for its width: `100vw` counts the vertical scrollbar, so it is
  // permanently wider than the content box and forces a horizontal overflow on every screen.
  assert.ok(
    !/width: 100vw/.test(css),
    "something is sized in `vw` again — that is a scrollbar's width of horizontal overflow, on every screen",
  );
  // The reader agrees with the manifest. They disagreed once already.
  assert.match(
    readFileSync("src/extension/config.ts", "utf8"),
    new RegExp(`c\\.get<number>\\("panel\\.minWidth",\\s*${floor}\\)`),
    "the manifest and the settings reader declare different floors",
  );
});

test("the picker and the button it fills wear the same face", () => {
  // Two places show a model, and they must agree: choosing one that shows an OpenAI mark and then
  // seeing a generic chip on the control is the kind of small inconsistency that reads as a bug in
  // something else entirely.
  const combo = readFileSync("src/webview/modelCombo.ts", "utf8");
  assert.match(combo, /icon\(vendorMark\(item\.model\.id\) as IconName, "ci-vendor"\)/);
});
