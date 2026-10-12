// How many tokens one attachment may take, answered in ONE place.
//
// It used to be answered in eight, with a different constant each time: 3 000 for the file on
// screen, 6 000 for the same file attached by hand, 2 000 for a selection, 4 000 for a mention,
// 8 000 for a paste. Every one of them was chosen when the whole context budget was a flat 8 000
// tokens, and none of them moved when the budget started following the model's window. So the
// attachment the user is least aware of and most likely to be asking about — the document open in
// front of them — was cut to about two hundred lines of prose while the same file attached
// explicitly went through whole: "it only reads the first 200 lines and not the whole file".
//
// A constant in eight places is not a decision, it is eight decisions that happen to agree until
// one of them is changed.

import { contextBudget } from "../core/context/budget.js";
import { perFileBudget } from "../core/util/tokens.js";
import { hiveyModel } from "../core/router/hivey.js";
import { contextWindow } from "./models.js";
import type { Settings } from "./config.js";

/**
 * The share of the context budget one attachment may take.
 *
 * @param attachments how many are going along with it, so that two files take two halves of the
 *   share rather than two whole shares of it.
 * @param modelWindow the window of the model actually in use when the caller knows it better than
 *   the catalogue does — a provider serving its own build, say. The catalogue answers otherwise.
 */
export function attachmentTokens(settings: Settings, attachments = 1, modelWindow?: number): number {
  const id = hiveyModel(settings.chat.model, "everyday");
  const window = modelWindow || contextWindow(id);
  return perFileBudget(contextBudget(settings.context.maxTokens, window), attachments, settings.context.attachmentTokens);
}
