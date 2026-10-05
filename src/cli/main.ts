#!/usr/bin/env node
// `hivey-code` — the terminal client. Same core as the extension: same providers, same redaction, same
// budget, same agent loop, same rule that nothing is written or run without a yes.
//
// It exists because half the work of a coding assistant happens where the editor is not: over ssh,
// in a container, in a repository you opened for ten minutes. And because a terminal client is the
// honest test of whether the core really is editor-agnostic — if something only works in the
// sidebar, it was in the wrong place.
//
// Configuration comes from `.hiveycode.json` (working directory, then home) and from the
// environment, so a team can commit a shared configuration without committing a key.

import { createInterface, type Interface } from "node:readline/promises";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { stdin, stdout } from "node:process";
import { runTurn, type TurnResult } from "../core/agent/loop.js";
import { makeProvider, PROVIDER_IDS, type ProviderId } from "../core/providers/index.js";
import { hiveyModel, isHivey } from "../core/router/hivey.js";
import { planSummary, planVerdict, type Plan } from "../core/agent/plan.js";
import { youShouldKnow, type Notice } from "../core/session/notices.js";
import { MUTATING_TOOLS, selfCheckMessage, VERIFIER_TOOLS } from "../core/router/outcome.js";
import { callSignature, safeArgs } from "../core/agent/callSignature.js";
import { catalogueWindow } from "../core/router/window.js";
import { contextBudget, repoMapBudget } from "../core/context/budget.js";
import { isProviderRefusal, refusalKind } from "../core/providers/refusal.js";
import { BUILTIN_AGENTS, parseDefinition, type AgentDefinition } from "../core/agent/definitions.js";
import { BUILTIN_SKILLS, builtinSkillsForModel } from "../core/session/skills.js";
import { skillsPrompt } from "../core/agent/definitions.js";
import { isLocalEndpoint, redactMessages, Vault, streamingRestorer } from "../core/redaction/index.js";
import type { RedactionLevel } from "../core/redaction/types.js";
import type { RunRecord } from "../core/eval/report.js";
import { Budget, SHIPPED_LIMITS, type Spend, type SpendStore } from "../core/router/budget.js";
import { costOf, makeLookup } from "../core/router/pricing.js";
import { GENERATED_PRICES } from "../core/router/catalog.generated.js";
import { Session } from "../core/session/session.js";
import { buildRepoMap } from "../core/context/repomap.js";
import { buildCliTools } from "./tools.js";
import { promptForMode, toolsForMode, MODES, type Mode } from "../core/session/modes.js";
import { t } from "../shared/i18n.js";
import { ENV } from "./env.js";

interface CliConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKeyEnv?: string;
  redaction: RedactionLevel;
  customTerms: string[];
  blockedGlobs: string[];
  budget: { perRequestUsd: number; dailyUsd: number; perRequestTokens: number };
  /** Which built-in skill families the model may reach. See `SKILL_GROUPS`. */
  skillGroups?: string[];
  contextTokens: number;
  /** Which mode the client starts in — the same three the sidebar offers. */
  mode: Mode;
}

/**
 * The provider named in the environment, if it is one this build knows.
 *
 * Validated rather than cast. `provider` selects the wire format — Anthropic's API is not the
 * OpenAI one — so an unrecognized value must fall back to something that works rather than reach
 * `makeProvider` and produce a request nobody can read. It was previously not read at all, which
 * meant the editor could open a terminal pointed at Anthropic and the client would speak OpenAI to
 * it.
 */
function providerFromEnv(): ProviderId {
  const named = process.env[ENV.provider];
  return PROVIDER_IDS.find((id) => id === named) ?? "local";
}

const DEFAULTS: CliConfig = {
  provider: providerFromEnv(),
  model: process.env[ENV.model] ?? "qwen2.5-coder:7b",
  baseUrl: process.env[ENV.url] ?? "http://127.0.0.1:11434/v1",
  redaction: "strict",
  customTerms: [],
  blockedGlobs: ["**/.env*", "**/*.pem", "**/*.key", "**/id_rsa*", "**/secrets/**", "**/.aws/**", "**/.ssh/**"],
  // From the one place that holds them, not retyped here. See `SHIPPED_LIMITS`: this file had
  // `0.25` and `2` while the editor shipped `2` and `20`, so the terminal refused what the panel
  // allowed — the same defect this project had already fixed in the panel and not in this half.
  budget: { ...SHIPPED_LIMITS },
  // 0 means "ask the catalogue what this model holds".
  //
  // ⚠️ It was 8000, hard-coded, and the `CHANGELOG` records that a fixed figure was exactly the
  // defect the panel had: 8 000 tokens is most of a small local model's window and a rounding error
  // on a modern one, and against it conversations were summarised after three exchanges and answered
  // from the digest. The panel was changed to follow the model actually chosen. This half kept the
  // constant — the same forgotten-half story as the spending caps, the plan tool and the skills —
  // and it became visible the moment a notice started reporting "the context is 100 % full" on a
  // model with a million-token window.
  contextTokens: 0,
  mode: "agent",
};

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

/**
 * Defaults, then the committed file, then the environment. In that order, and the order matters.
 *
 * The file used to win, which is right for a client started by hand and wrong for one started from
 * the editor: a repository that pins `provider: "local"` would silently ignore the model the user
 * had just chosen in the sidebar two seconds earlier. The environment is the more specific
 * statement of intent — somebody set it deliberately, for this process — so it goes last.
 *
 * Only variables that are actually present override. Reading an absent variable as an empty string
 * would let the editor blank out a working configuration by not setting something.
 */
async function loadConfig(cwd: string): Promise<CliConfig> {
  const merged: CliConfig = { ...DEFAULTS };
  for (const path of [join(homedir(), ".hiveycode.json"), join(cwd, ".hiveycode.json")]) {
    try {
      Object.assign(merged, JSON.parse(await readFile(path, "utf8")));
    } catch {
      /* absent or unreadable: defaults stand */
    }
  }
  if (process.env[ENV.provider]) merged.provider = providerFromEnv();
  if (process.env[ENV.model]) merged.model = process.env[ENV.model]!;
  if (process.env[ENV.url]) merged.baseUrl = process.env[ENV.url]!;
  return merged;
}

class FileSpendStore implements SpendStore {
  private cache: Spend | undefined;
  constructor(private readonly path: string) {}
  load(): void {
    try {
      this.cache = JSON.parse(require("node:fs").readFileSync(this.path, "utf8")) as Spend;
    } catch {
      this.cache = undefined;
    }
  }
  read(): Spend | undefined {
    return this.cache;
  }
  write(s: Spend): void {
    this.cache = s;
    void mkdir(dirname(this.path), { recursive: true })
      .then(() => writeFile(this.path, JSON.stringify(s), "utf8"))
      .catch(() => {});
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const cfg = await loadConfig(cwd);
  // A Hivey preset is a ROUTING, not a model id — sending `hivey` as a model gets a 400 saying it is
  // not one. The extension resolves it per role; the terminal resolves it once, as `deep`, because a
  // terminal turn drives the tool loop and `deep` is the role that exists for exactly that.
  //
  // Without this the presets could not be tried from the terminal at all, which also meant the
  // evaluation harness — which drives this client — could not measure them. A table that promises a
  // row per preset and a harness that cannot fill one is a table that stays empty for a reason
  // nobody can see.
  if (isHivey(cfg.model)) {
    const resolved = hiveyModel(cfg.model, "deep");
    console.log(C.dim(t("{0} → {1}", cfg.model, resolved)));
    cfg.model = resolved;
  }
  const apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : process.env[ENV.key];
  const isLocal = isLocalEndpoint(cfg.baseUrl);
  const provider = makeProvider({ id: cfg.provider, baseUrl: cfg.baseUrl, apiKey });

  const store = new FileSpendStore(join(homedir(), ".hiveycode", "spend.json"));
  store.load();
    // The built-in skills the configuration switched on, in the shape the model is offered. The
  // terminal has no settings UI, so the groups come from `.hiveycode.json` and default to the
  // general family — enough to be useful, bounded enough not to spend the context on a catalogue.
  // What this model actually holds, through the same rule the panel uses — a share of the window,
  // with a floor and a ceiling, and a configured figure winning when there is one.
  //
  // ⚠️ Not `catalogueWindow` on its own: a local runtime the catalogue has never heard of returns 0,
  // and a budget of zero collapses everything derived from it. The floor is what `contextBudget`
  // exists for, and reaching for the lookup without the rule put the terminal back in a different
  // version of the same hole.
  const contextTokens = contextBudget(cfg.contextTokens > 0 ? cfg.contextTokens : undefined, catalogueWindow(cfg.model));

  // The sub-agents this client offers: the repository's own, then the built-in ones, by the same
  // precedence the panel uses — a team that wrote an agent with that name meant theirs.
  const cliAgents = await loadCliAgents(cwd);

  const cliSkills = builtinSkillsForModel(
    BUILTIN_SKILLS.filter((sk) => (cfg.skillGroups ?? ["general"]).includes(sk.group)),
  );

  const budget = new Budget(store, cfg.budget);
  const prices = makeLookup(GENERATED_PRICES);
  const session = new Session();
  let mode: Mode = cfg.mode;

  const rl: Interface = createInterface({ input: stdin, output: stdout });

  console.log(C.bold("Hivey Code") + C.dim(t(" — sovereign coding assistant")));
  console.log(
    C.dim(
      `${cfg.model} · ${new URL(cfg.baseUrl).host} · ${t("mode")} ${cfg.mode} · ${
        isLocal ? C.green(t("local (no cost)")) : C.amber(t("remote, redaction {0}", cfg.redaction))
      }`,
    ),
  );
  console.log(C.dim(t("/help for the commands, Ctrl+C to quit.") + "\n"));

  const argv = process.argv.slice(2);
  // Approve everything without asking. Two rules make this defensible rather than reckless: it must
  // be typed by the person running it, and it changes only the ANSWER to the approval question —
  // the blocked globs, the redaction and the budget are all upstream of it and still apply. It
  // exists for the one caller that cannot answer a prompt: the evaluation harness, which runs the
  // same agent against the same tasks every night in a throwaway directory.
  const yes = argv.includes("--yes") || process.env["HIVEY_CODE_YES"] === "1";
  const oneOff = argv.filter((a) => a !== "--yes").join(" ").trim();
  if (oneOff) {
    await ask(oneOff);
    rl.close();
    return;
  }

  for (;;) {
    let line: string;
    try {
      line = (await rl.question(C.amber("› "))).trim();
    } catch {
      break; // Ctrl+C / EOF
    }
    if (!line) continue;
    if (line.startsWith("/")) {
      if (await command(line)) break;
      continue;
    }
    await ask(line);
  }
  rl.close();

  // ── Commands ──────────────────────────────────────────────────────────────────────────────

  async function command(line: string): Promise<boolean> {
    const [name, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    switch (name) {
      case "aide":
      case "help":
        console.log(
          [
            t("/new             start an empty conversation"),
            t("/context         what the next question will send"),
            t("/mute <n>        take exchange n out of the context (it stays on screen)"),
            t("/unmute <n>      put it back"),
            t("/forget <n>      delete it for good"),
            t("/mode <name>     chat (no tools), plan (read-only), agent (tools)"),
            t("/model <name>    switch model"),
            t("/cost            today's spend"),
            t("/quit"),
          ].join("\n"),
        );
        return false;
      case "new":
      case "nouveau":
        session.entries.length = 0;
        console.log(C.dim(t("empty conversation.")));
        return false;
      case "context":
      case "contexte": {
        session.entries.forEach((e, i) => {
          const flag = e.included ? " " : C.dim(t("muted"));
          console.log(`${String(i).padStart(2)} ${e.role === "user" ? t("you") : t("hivey")} ${flag} ${e.text.slice(0, 70).replace(/\n/g, " ")}`);
        });
        return false;
      }
      // Command words are what the user TYPES, so both languages are accepted and neither is
      // translated: a `case` label that moves with the interface language is a command nobody can
      // rely on.
      case "mute":
      case "unmute":
      case "muet":
      case "rendre": {
        const entry = session.entries[Number(arg)];
        if (!entry) {
          console.log(C.red(t("unknown number (see /context)")));
          return false;
        }
        const putBack = name === "rendre" || name === "unmute";
        session.setIncluded(entry.id, putBack);
        console.log(
          C.dim(putBack ? t("exchange {0} put back into the context.", arg) : t("exchange {0} removed from the context.", arg)),
        );
        return false;
      }
      case "forget":
      case "oublier": {
        const entry = session.entries[Number(arg)];
        if (entry) session.drop(entry.id);
        return false;
      }
      case "mode": {
        const wanted = MODES.find((m) => m.id === arg);
        if (wanted) mode = wanted.id;
        const current = MODES.find((m) => m.id === mode)!;
        console.log(C.dim(t("mode {0} — {1}", current.id, current.hint)));
        if (!wanted) console.log(C.dim(t("(modes: {0})", MODES.map((m) => m.id).join(", "))));
        return false;
      }
      case "model":
      case "modele":
        if (arg) cfg.model = arg;
        console.log(C.dim(t("model: {0}", cfg.model)));
        return false;
      case "cost":
      case "cout":
        console.log(
          isLocal
            ? C.green(t("local: nothing spent, by construction."))
            : t("today: ${0} of {1} · {2} call(s)", budget.spentToday().toFixed(4), cfg.budget.dailyUsd, budget.callsToday()),
        );
        return false;
      case "quit":
      case "quitter":
      case "exit":
        return true;
      default:
        console.log(C.red(t("unknown command: /{0}", String(name))));
        return false;
    }
  }

  // ── One turn ──────────────────────────────────────────────────────────────────────────────

  async function ask(text: string): Promise<void> {
    session.add({ role: "user", text });
    const vault = new Vault();
    const ctl = new AbortController();
    const onSigint = () => ctl.abort();
    process.on("SIGINT", onSigint);

    // Chat mode answers from what it is given: no repository map, no tools, no surprises.
    // The map's share of the budget, capped, from the same function the panel uses: past a few
    // thousand tokens a list of paths and symbols stops adding knowledge and starts adding haystack,
    // and it sits in the cacheable prefix so every token is paid on every turn.
    const ambient = mode === "chat" ? undefined : await repoMap(cwd, repoMapBudget(contextTokens));
    const built = session.build({
      // The same skills the panel offers, by the same mechanism: names and one line each here,
      // instructions on demand through `use_skill`. The terminal had none at all — which also meant
      // the evaluation harness, which drives this client, could not measure whether a skill helps.
      systemPrompt: promptForMode(mode) + skillsPrompt(cliSkills),
      ambient,
      maxTokens: contextTokens,
      nonce: randomNonce(),
    });

    let outgoing = built.messages;
    if (!isLocal) {
      const { messages, findings, hasSecret } = redactMessages(built.messages, vault, {
        level: cfg.redaction,
        customTerms: cfg.customTerms,
        blockOnSecret: true,
      });
      outgoing = messages;
      if (findings.length) {
        console.log(C.dim(t("pseudonymized: {0}", vault.summary().map((s) => `${s.label}×${s.count}`).join(", "))));
      }
      if (hasSecret) {
        const ok = (await rl.question(C.red(t("A credential was detected and masked. Send anyway? [y/N] ")))).toLowerCase();
        if (ok !== "y" && ok !== "o" && ok !== "yes" && ok !== "oui") {
          console.log(C.dim(t("cancelled.")));
          process.off("SIGINT", onSigint);
          return;
        }
      }
      const price = prices(cfg.model);
      const estimate = price ? (built.estimatedTokens * price.in * 1.25) / 1_000_000 : 0;
      const verdict = budget.check(estimate, built.estimatedTokens);
      if (!verdict.ok) {
        console.log(C.red(t("budget: {0}", verdict.message)));
        // Recorded, not just printed. The evaluation harness drives this client, and a task refused
        // before it started is NOT a task the model got wrong — but in the results the two were
        // indistinguishable, and forty-two refusals once became forty-two apparent model failures in
        // a measurement. A refusal has to be able to say it was a refusal.
        writeRefusal(verdict.reason);
        process.off("SIGINT", onSigint);
        return;
      }
    }

    // The plan this turn kept, if it kept one. Read at the end of the turn: a turn that finishes
    // with steps of its own plan outstanding has declared itself done against its own list.
    let turnPlan: Plan | undefined;
    const turnNotices: Notice[] = [];
    // What this turn's sub-agents spent. A sub-agent's bill belongs to the answer that ordered it,
    // not to nobody — see `runSubAgent`.
    const delegated = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: undefined as number | undefined };

    // The mode decides the tool set in code: plan mode simply has no tool that writes.
    const tools = toolsForMode(
      buildCliTools({
        cwd,
        blockedGlobs: cfg.blockedGlobs,
        showDiff: (path, before, after) => printDiff(path, before, after),
        // Printed, so the terminal shows what the panel shows — and kept, because the verdict at the
        // end of the turn reads it: a turn that ends with its own steps outstanding is a turn that
        // declared itself finished against its own list.
        agents: cliAgents,
        // One turn of its own: its body as the system prompt, its task as the question, its tools,
        // its step cap. Redacted through the same vault as the main turn, because a sub-agent's
        // request leaves by the same door — a second notion of what is safe to send would be a
        // second answer to the question this product exists to answer.
        runSubAgent: async ({ definition, task, signal }) => {
          // ⚠️ A sub-agent's tokens are the parent turn's bill. They were thrown away here: this
          // function ran a whole turn and returned only `answer.text`, so a turn that delegated was
          // reported — and MEASURED by the bench, which publishes costs — as cheaper than it was.
          // The panel already got this right (`delegatedCostUsd`); two surfaces, one answer.
          const sub = buildCliTools({
            cwd,
            blockedGlobs: cfg.blockedGlobs,
            showDiff: (path, before, after) => printDiff(path, before, after),
          }).filter((tool) => definition.tools.includes(tool.schema.name));
          const messages = [
            { role: "system" as const, content: definition.body, cacheable: true },
            { role: "user" as const, content: task },
          ];
          const prepared = isLocal
            ? messages
            : redactMessages(messages, vault, {
                level: cfg.redaction,
                customTerms: cfg.customTerms,
                blockOnSecret: true,
              }).messages;
          const answer = await runTurn({
            provider,
            model: cfg.model,
            messages: prepared,
            tools: toolsForMode(sub, mode),
            maxSteps: definition.maxSteps ?? 8,
            ...(signal ? { signal } : {}),
            approve: async () => yes,
            afterResponse: (text) => vault.restore(text),
            restoreArgs: (text) => vault.restore(text),
          });
          delegated.promptTokens += answer.usage.promptTokens;
          delegated.completionTokens += answer.usage.completionTokens;
          delegated.cachedTokens += answer.usage.cachedTokens;
          if (typeof answer.usage.costUsd === "number") {
            delegated.costUsd = (delegated.costUsd ?? 0) + answer.usage.costUsd;
          }
          return vault.restore(answer.text);
        },
        onNotice: (notice) => turnNotices.push(notice),
        onPlan: (plan) => {
          turnPlan = plan;
          const { done, total, current } = planSummary(plan);
          console.log(C.dim(`  ${t("plan")} ${done}/${total}${current ? ` · ${current.title}` : ""}`));
        },
      }),
      mode,
    );

    let printed = false;
    const startedAt = Date.now();
    // One restorer for the whole stream. A terminal cannot repaint what it has already written, so
    // a marker shown in halves stays in halves. See `streamingRestorer`.
    const live = streamingRestorer((text) => vault.restore(text));
    try {
      const result = await runTurn({
        provider,
        model: cfg.model,
        messages: outgoing,
        tools,
        signal: ctl.signal,
        maxTokens: 4096,
        // The same one self-check the panel does, by the same rule: it changed files and ran
        // nothing, so finish it before saying it is done.
        selfCheck: (trace) =>
          selfCheckMessage(
            trace.map((x) => ({
              tool: x.call.name,
              ok: !x.result.isError,
              summary: x.result.content.split("\n")[0] ?? "",
              call: callSignature(x.call.name, safeArgs(x.call.args)),
            })),
          ),
        onDelta: (d) => {
          if (d.text) {
            // Through the same restorer as the panel: a marker split across two packets is two
            // halves that match nothing, and a terminal cannot repaint what it has already written.
            stdout.write(live.push(d.text));
            printed = true;
          }
        },
        report: (m) => console.log(C.dim(`  ${m}`)),
        approve: async (req) => {
          if (yes) {
            console.log(C.dim(`  ${t("auto-approved")}: ${req.description}`));
            return true;
          }
          const answer = (await rl.question(`\n${C.amber("?")} ${req.description} — ${t("allow? [y/N]")} `)).toLowerCase();
          return answer === "y" || answer === "o" || answer === "yes" || answer === "oui";
        },
        afterResponse: (t) => vault.restore(t),
        restoreArgs: (t) => vault.restore(t),
      });
      // Whatever was still held when the stream ended, including when it ended mid-marker.
      const rest = live.flush();
      if (rest) {
        stdout.write(rest);
        printed = true;
      }
      if (printed) stdout.write("\n");

      const answer = session.add({ role: "assistant", text: result.text, model: cfg.model });
      // Computed whatever the endpoint is, and reported only when it is known. A local model is
      // not free — it is unpriced — and the two have to stay distinguishable for the evaluation
      // report, which is forbidden to print a figure it did not measure.
      // The turn's own usage plus whatever it delegated. `costUsd` is only carried when BOTH halves
      // reported one: a provider-reported total mixed with an estimate is neither, and `costOf` treats
      // the presence of `costUsd` as "the provider said so".
      const wholeUsage = {
        promptTokens: result.usage.promptTokens + delegated.promptTokens,
        completionTokens: result.usage.completionTokens + delegated.completionTokens,
        cachedTokens: result.usage.cachedTokens + delegated.cachedTokens,
        ...(typeof result.usage.costUsd === "number" && (delegated.promptTokens === 0 || delegated.costUsd !== undefined)
          ? { costUsd: result.usage.costUsd + (delegated.costUsd ?? 0) }
          : {}),
      };
      const cost = costOf(wholeUsage, prices(cfg.model));
      if (!isLocal) {
        answer.usdCost = cost.usd;
        budget.record(cost.usd);
        console.log(
          C.dim(
            // The whole turn, sub-agents included — the same figures the cost beside it is computed
            // from. Printing the parent's tokens next to the delegated total made one line disagree
            // with itself.
            t("  {0}+{1} tokens", wholeUsage.promptTokens, wholeUsage.completionTokens) +
              (cost.known ? ` · $${cost.usd.toFixed(4)}` : ` · ${t("unknown cost")}`),
          ),
        );
      }
      if (result.stoppedBecause === "max-steps") console.log(C.amber(t("  (stopped at the maximum number of steps)")));
      // The verdict the panel reaches, reached here too — and said out loud. A turn that ends with
      // its own steps outstanding has declared itself finished against its own list, and the person
      // reading the terminal is the one who should know that first.
      const unfinished = planVerdict(turnPlan);
      if (unfinished.unfinished) console.log(C.amber(`  ${t("unfinished: {0}", unfinished.why)}`));

      // "À savoir": what it noticed, what it did not verify, and the state of the tool. Two of the
      // three are derived here rather than asked of the model — see `youShouldKnow`.
      const notices = youShouldKnow({
        reported: turnNotices,
        // Derived from the trace rather than from a second notion of what a step is: a mutating
        // call that succeeded means something changed, a verifier that succeeded means something
        // checked. The set of verifiers is the router's own, exported, because two copies of it
        // would be two different answers to one question.
        changed: result.trace.some((x) => MUTATING_TOOLS.has(x.call.name) && !x.result.isError),
        verified: result.trace.some((x) => VERIFIER_TOOLS.has(x.call.name) && !x.result.isError),
        planLeft: unfinished.left.map((s) => s.title),
        ...(result.usage.promptTokens && contextTokens
          ? { contextFill: Math.min(1, result.usage.promptTokens / contextTokens) }
          : {}),
        toolCallsFromText: result.trace.some((x) => x.call.source === "text"),
        ...(result.shortenedTo ? { shortenedTo: result.shortenedTo } : {}),
      });
      if (notices.length) {
        console.log(`\n${C.dim(t("To know"))}`);
        for (const n of notices) console.log(C.dim(`  • ${n.text}${n.where ? ` (${n.where})` : ""}`));
      }
      writeRunRecord(result, Date.now() - startedAt, cfg.model, !isLocal && cost.known ? cost.usd : undefined, unfinished.left.length, wholeUsage);
    } catch (err) {
      const message = (err as Error).message;
      console.log(C.red(`\n${message}`));
      // A provider that would not serve the request is not a model that got it wrong. Recorded, so a
      // measurement cannot report it as a failure — the rule already existed for the local spending
      // guard and had a hole exactly the size of what it was built for. See `isProviderRefusal`.
      if (isProviderRefusal(message)) writeRefusal(`provider:${refusalKind(message) ?? "unknown"}`);
    } finally {
      process.off("SIGINT", onSigint);
    }
  }
}

/**
 * The sub-agent definitions this client can offer.
 *
 * Read from the repository and from the user's home, with the shared parser from `core` — the same
 * files the panel reads, so a team that wrote an agent gets it in both halves. Problems are reported
 * and skipped rather than fatal: one malformed file must not take the whole feature down.
 */
async function loadCliAgents(cwd: string): Promise<AgentDefinition[]> {
  const own: AgentDefinition[] = [];
  for (const dir of [join(cwd, ".hiveycode", "agents"), join(homedir(), ".hiveycode", "agents")]) {
    let names: string[];
    try {
      names = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const text = await readFile(join(dir, name), "utf8");
        const { definition, problems } = parseDefinition("agent", join(dir, name), text);
        for (const problem of problems) console.log(C.dim(`  ${name}: ${problem}`));
        if (definition?.kind === "agent" && !own.some((a) => a.name === definition.name)) own.push(definition);
      } catch {
        /* an unreadable definition is one fewer agent, not a broken client */
      }
    }
  }
  const taken = new Set(own.map((a) => a.name));
  return [...own, ...BUILTIN_AGENTS.filter((a) => !taken.has(a.name))];
}

async function repoMap(cwd: string, budgetTokens: number): Promise<string | undefined> {
  const { readdir, readFile: rf, stat: st } = await import("node:fs/promises");
  const files: Array<{ path: string; text: string }> = [];
  const skip = new Set([".git", "node_modules", "dist", "build", "out", "target", ".venv", "__pycache__", ".next"]);
  async function walk(dir: string): Promise<void> {
    if (files.length > 800) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || skip.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        try {
          if ((await st(full)).size > 200_000) continue;
          files.push({ path: full.slice(cwd.length + 1).split("\\").join("/"), text: await rf(full, "utf8") });
        } catch {
          /* unreadable */
        }
      }
    }
  }
  await walk(cwd);
  if (!files.length) return undefined;
  return buildRepoMap(files, budgetTokens).text;
}

/** A line diff, enough to see what is about to change. No dependency, no colors beyond two. */
function printDiff(path: string, before: string, after: string): void {
  console.log(C.bold(`\n  ${path}`));
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA > start && endB > start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  for (const line of a.slice(start, endA + 1).slice(0, 40)) console.log(C.red(`  - ${line}`));
  for (const line of b.slice(start, endB + 1).slice(0, 40)) console.log(C.green(`  + ${line}`));
  console.log("");
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  (globalThis.crypto ?? require("node:crypto").webcrypto).getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One line of JSON per turn, when the evaluation harness asks for it.
 *
 * `HIVEY_CODE_RUN_REPORT=<file>` and nothing else: no flag, because the one-off prompt is built by
 * joining every argument that is not `--yes`, so a flag with a value would end up inside the
 * question. It follows the other harness hooks (`HIVEY_CODE_YES`, `_URL`, `_MODEL`, `_PROVIDER`),
 * which are all environment too.
 *
 * It writes to a local file and nowhere else. That is what keeps it out of the no-telemetry rule:
 * the path comes from the person running the command, there is no default, and the only caller is
 * `scripts/evaluate.mjs` running in a throwaway directory.
 *
 * Appended rather than overwritten, because one task may take several turns and the harness wants
 * all of them. A failure to write is swallowed: an evaluation hook must never be able to break the
 * turn it is measuring.
 */
/**
 * A turn that never happened, and why.
 *
 * Written to the same report the harness reads, so a run that was refused can be told apart from a
 * run that failed. See the call site: the distinction is the difference between a measurement and a
 * misleading one.
 */
function writeRefusal(reason: string): void {
  const path = process.env["HIVEY_CODE_RUN_REPORT"];
  if (!path) return;
  try {
    require("node:fs").appendFileSync(path, `${JSON.stringify({ refused: reason })}\n`, "utf8");
  } catch {
    /* measuring must never break the thing being measured */
  }
}

function writeRunRecord(
  result: TurnResult,
  ms: number,
  model: string,
  usd: number | undefined,
  planLeft?: number,
  /** The turn's usage including its sub-agents'. Falls back to the turn's own. */
  wholeUsage?: { promptTokens: number; completionTokens: number },
): void {
  const path = process.env["HIVEY_CODE_RUN_REPORT"];
  if (!path) return;
  const tools: Record<string, number> = {};
  for (const step of result.trace) tools[step.call.name] = (tools[step.call.name] ?? 0) + 1;
  const record: RunRecord = {
    model,
    steps: result.steps,
    promptTokens: wholeUsage?.promptTokens ?? result.usage.promptTokens,
    completionTokens: wholeUsage?.completionTokens ?? result.usage.completionTokens,
    ...(usd === undefined ? {} : { usd }),
    stoppedBecause: result.stoppedBecause,
    truncated: result.truncated,
    tools,
    ms,
    // Absent when the turn kept no plan: most turns do not need one, and recording 0 would count
    // discipline nobody exercised.
    ...(planLeft === undefined || !result.trace.some((x) => x.call.name === "update_plan") ? {} : { planLeft }),
    // Only when it fired. `false` on every turn would be a column of noughts saying nothing; what is
    // being counted is how often the mechanism actually ran.
    ...(result.selfChecked ? { selfChecked: true } : {}),
  };
  try {
    require("node:fs").appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    /* measuring must never break the thing being measured */
  }
}

void main();
