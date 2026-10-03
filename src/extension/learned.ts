// What has been measured in THIS repository, and the model it points at.
//
// The decisions are in `core/router/learned.ts`. This file holds the storage and one judgement call
// that belongs in the open:
//
// ⚠️ IT IS OFF BY DEFAULT. The roadmap asks for a router that learns, and a router that learns
// changes which model answers — which is a change of behaviour nobody asked for on the morning they
// update the extension. A user who turns it on has decided that cheaper-when-proven is what they
// want; a user who has not gets exactly what they configured. The feature is worth having and it is
// not worth surprising somebody with.
//
// The candidates are also deliberately narrow: the model the user configured, the escalation model
// they configured, and nothing else. Deriving a wider set from a catalogue would mean sending a
// question to a model nobody authorised, which no observed success rate can justify.

import * as vscode from "vscode";
import {
  DEFAULT_POLICY,
  choose,
  classify,
  describe,
  forget,
  observe,
  type Candidate,
  type Choice,
  type Policy,
  type Stats,
} from "../core/router/learned.js";
import { makeLookup } from "../core/router/pricing.js";
import { isHivey } from "../core/router/hivey.js";
import { loadPrices } from "./prices.js";
import type { Settings } from "./config.js";
import { SECTION } from "./config.js";
import { t } from "../shared/i18n.js";

const KEY = "hiveyCode.routing.learned";

export class LearnedRouting {
  /** The same catalogue the rest of the product prices with: no second table to drift. */
  private readonly price = makeLookup(loadPrices());

  constructor(private readonly state: vscode.Memento) {}

  private policy(): Policy {
    const c = vscode.workspace.getConfiguration(SECTION);
    return {
      threshold: Math.min(1, Math.max(0, c.get<number>("routing.threshold", DEFAULT_POLICY.threshold))),
      minAttempts: Math.max(1, c.get<number>("routing.minAttempts", DEFAULT_POLICY.minAttempts)),
      explore: Math.min(0.5, Math.max(0, c.get<number>("routing.explore", DEFAULT_POLICY.explore))),
    };
  }

  enabled(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>("routing.learned", false);
  }

  /** The repository, as a key. The folder path: two checkouts of the same project are two repositories. */
  private repo(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  }

  private read(): Stats {
    return this.state.get<Stats>(KEY, []);
  }

  /**
   * The models this user has authorised, cheapest decided by the generated catalogue.
   *
   * A Hivey preset is left out on purpose: it is already a router, and routing a router produces a
   * choice nobody can explain in one sentence.
   */
  private candidates(settings: Settings): Candidate[] {
    const out: Candidate[] = [];
    const add = (model: string, provider: string) => {
      if (!model.trim() || isHivey(model) || out.some((c) => c.model === model)) return;
      out.push({ model, provider, price: this.price(model)?.in ?? 0 });
    };
    add(settings.chat.model, settings.chat.provider);
    add(settings.escalation.model, settings.escalation.provider);
    return out;
  }

  /** The model to try, or nothing when the feature is off or there is only one candidate. */
  decide(settings: Settings, tools: string[]): Choice | undefined {
    if (!this.enabled()) return undefined;
    const candidates = this.candidates(settings);
    if (candidates.length < 2) return undefined;
    return choose(this.read(), {
      repo: this.repo(),
      kind: classify(tools),
      candidates,
      policy: this.policy(),
    });
  }

  /** One more observation, after the turn's verdict is in. */
  async observe(model: string, tools: string[], ok: boolean): Promise<void> {
    if (!this.enabled()) return;
    await this.state.update(
      KEY,
      observe(this.read(), { repo: this.repo(), kind: classify(tools), model }, ok),
    );
  }

  async show(): Promise<void> {
    const text = describe(this.read(), this.repo(), this.policy().minAttempts);
    if (!this.enabled()) {
      void vscode.window.showInformationMessage(
        t("Learned routing is off, so nothing is being measured. What is on disk from before:\n{0}", text),
      );
      return;
    }
    void vscode.window.showInformationMessage(text, { modal: true });
  }

  async forget(): Promise<void> {
    const before = this.read().filter((r) => r.repo === this.repo()).length;
    if (!before) {
      void vscode.window.showInformationMessage(t("Nothing has been measured in this repository yet."));
      return;
    }
    await this.state.update(KEY, forget(this.read(), this.repo()));
    void vscode.window.showInformationMessage(t("{0} measurement(s) for this repository forgotten.", before));
  }
}
