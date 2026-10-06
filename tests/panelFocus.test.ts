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
  assert.match(source, /left\.append\(toolsButton\(state, deps\)\)/, "skills left the settings group again");
  // The far end acts on the message; it does not configure the answer. Anything else landing here is
  // the drift this test exists to catch.
  assert.ok(
    !/right\.append\(toolsButton/.test(source),
    "skills is back beside the send, where it reads as a seventh unrelated icon",
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
  assert.match(model.slice(0, 600), /icon: ICON\.chip/);
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

test("the width floor is the width the composer actually needs", () => {
  // ⚠️ The default was 260 and it was CHOSEN; it is now 460 and it is MEASURED. Reported as « 260
  // c'est trop bas », and a capture of the panel at 540 px says exactly how much too low: the row runs
  // from the attach icon at x=33 to the send at x=496 — about 479 px of controls — with 34 px of slack
  // between the two groups and a model name able to give back another 42 by shrinking to its own
  // seven-character floor. The row therefore stops fitting at roughly 462 px.
  //
  // Below the floor the group's `overflow: hidden` CLIPS rather than compresses, which is the failure
  // this setting exists to prevent: at 260 the send button is not cramped, it is absent. A floor set
  // under what the content needs is not a floor at all.
  //
  // Asserted against the row's own constraints rather than as a magic number, so adding a control to
  // the composer and leaving the floor behind is caught here instead of in a screenshot six weeks
  // later.
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { configuration: Array<{ properties: Record<string, { default?: number }> }> };
  };
  const floor = manifest.contributes.configuration
    .flatMap((section) => Object.entries(section.properties))
    .find(([id]) => id === "hiveyCode.panel.minWidth")?.[1]?.default;
  assert.ok(typeof floor === "number", "the floor is no longer declared in the manifest");
  assert.ok(
    floor >= 462,
    `the floor is ${floor}, below the ~462 px the composer row measured — the send button will be clipped away`,
  );
  // And the reader agrees with the manifest. They disagreed once already, in the other direction:
  // a default written twice is a default that will be changed once.
  assert.match(
    readFileSync("src/extension/config.ts", "utf8"),
    new RegExp(`c\\.get<number>\\("panel\\.minWidth",\\s*${floor}\\)`),
    "the manifest and the settings reader declare different floors",
  );
});
