// What Hivey Code offers to do with a piece of code you have highlighted.
//
// A list rather than a menu builder, and in core rather than beside the editor, for the reason the
// attachment rows learned the hard way: an option that exists only as a closure inside a quick pick
// cannot be tested, and every defect in one was found by a person. Here the offer is data — a
// label, where the answer lands, and the instruction actually sent — so a test can assert that
// every entry says something, that the ids are unique, and that nothing reaches the model as an
// empty instruction.
//
// Two destinations, because they are two different acts. A question about code belongs in the
// conversation, where the answer can be read, argued with and followed up. A rewrite belongs in the
// file, in the undo stack, in the diff — nobody wants "here is your function, now copy it".

import { t } from "../../shared/i18n.js";

export interface SelectionAction {
  /** Stable across translations: menus, tests and telemetry-free logs all key on this. */
  id: string;
  /** What the user reads. */
  label: string;
  /** Where the result appears: the conversation, or the file itself. */
  where: "chat" | "file";
  /** What the model is actually told. Never shown. */
  instruction: string;
  /** Offered on the lightbulb too, where only a couple of rows fit before it becomes a wall. */
  lightbulb?: boolean;
}

/**
 * The catalogue, in the order it is offered.
 *
 * Chosen by what people ask a colleague about a fragment they have highlighted, not by what a model
 * can be made to do: explain it, find what is wrong with it, cover it, describe it, tidy it, make it
 * survive failure, type it. Anything more specific than these is a question worth typing.
 */
export function selectionActions(): SelectionAction[] {
  return [
    {
      id: "explain",
      label: t("Explain this selection"),
      where: "chat",
      instruction: t("Explain what this code does, then what it is for. Be concrete about the inputs and what comes back."),
      lightbulb: true,
    },
    {
      id: "review",
      label: t("Find problems in it"),
      where: "chat",
      instruction: t(
        "Review this code for defects: wrong results, unhandled failures, races, injection, resource leaks. Say what input triggers each one. If you find nothing, say so rather than inventing something.",
      ),
      lightbulb: true,
    },
    {
      id: "test",
      label: t("Write a test for it"),
      where: "chat",
      instruction: t("Write a test for this code, in the style of the tests already in this repository."),
    },
    {
      id: "document",
      label: t("Document it"),
      where: "chat",
      instruction: t("Add concise documentation above this code, in the language and style of the file."),
    },
    {
      id: "usage",
      label: t("Show me how it is used"),
      where: "chat",
      instruction: t("Find where this is called from in the workspace and summarise how the callers use it."),
    },
    {
      id: "simplify",
      label: t("Simplify it"),
      where: "file",
      instruction: t("Simplify this code without changing what it does or the names other code depends on."),
    },
    {
      id: "errors",
      label: t("Handle the failures"),
      where: "file",
      instruction: t("Handle the ways this code can fail, in the style this file already uses. Do not swallow errors silently."),
    },
    {
      id: "types",
      label: t("Add the types"),
      where: "file",
      instruction: t("Add or tighten the type annotations for this code. Change no runtime behaviour."),
    },
  ];
}
