// The permission book: what the agent may do without asking.
//
// Two lists, deliberately separated. Rules written to disk survive restarts and are the ones worth
// reading twice; grants given for the current conversation disappear on their own. Showing them in
// one list would make a temporary yes look permanent, which is the mistake that makes people stop
// trusting a permission dialog.

import { button, el, icon, ICON } from "./dom.js";
import type { ToExtension, UiPermissionRule, UiState } from "../shared/protocol.js";
import { t } from "../shared/i18n.js";

const TOOL_LABELS: Record<string, string> = {
  read_file: t("Read a file"),
  list_files: t("List files"),
  search_text: t("Search the repository"),
  get_diagnostics: t("Read diagnostics"),
  write_file: t("Write a file"),
  edit_file: t("Edit a file"),
  run_command: t("Run a command"),
};

const GRANTABLE = ["write_file", "edit_file", "run_command"];

const SCOPES: Array<{ id: "off" | "workspace" | "all"; label: string; hint: string }> = [
  { id: "off", label: t("Ask every time"), hint: t("Every change is asked for. The default.") },
  {
    id: "workspace",
    label: t("Trust this folder"),
    hint: t("Changes inside the open folder run without asking. Commands, and anything outside it, are still asked."),
  },
  {
    id: "all",
    label: t("Ask nothing"),
    hint: t("The agent may write anywhere and run anything. Dangerous."),
  },
];

/**
 * The standing policy, above the individual rules.
 *
 * It belongs on this screen and not only in the settings because this is where someone comes when
 * they are tired of dialogs — and a person who cannot find the switch here will find the one in the
 * settings that says `all` and never come back to the middle option.
 */
function scopeSection(state: UiState, send: (m: ToExtension) => void): HTMLElement {
  const box = el("section", "perm-scope");
  box.append(el("h3", "perm-scope-title", t("How often you are asked")));

  for (const scope of SCOPES) {
    const active = state.policy.scope === scope.id;
    const row = el("button", `perm-scope-row${active ? " active" : ""}${scope.id === "all" ? " danger" : ""}`);
    const main = el("div", "perm-scope-main");
    main.append(el("div", "perm-scope-label", scope.label));
    main.append(el("div", "perm-scope-hint", scope.hint));
    row.append(main);
    if (active) row.append(icon("check", "perm-scope-tick"));
    row.addEventListener("click", () => send({ type: "setApprovalScope", scope: scope.id }));
    box.append(row);
  }

  // Stated on the screen rather than only in the documentation, because it is the thing that makes
  // the dangerous option survivable and nobody reads documentation at the moment they click it.
  box.append(
    el("p", "perm-scope-note",
      t("Whatever you choose here, files excluded by the privacy policy stay excluded, and what leaves this machine is governed separately."),
    ),
  );

  // Both lists, and the denied one first — it is the one that overrides everything else, and
  // reading it after the allowances would suggest the opposite.
  const denied = state.policy.deniedPaths.length + state.policy.deniedCommands.length;
  const allowed = state.policy.allowedPaths.length + state.policy.allowedCommands.length;

  const lists = el("div", "perm-scope-lists");
  lists.append(
    el("span", "perm-list-count denied",
      denied ? t("{0} never allowed", denied) : t("Nothing is denied by name."),
    ),
  );
  lists.append(el("span", "muted", "·"));
  lists.append(
    el("span", "perm-list-count allowed",
      allowed ? t("{0} always allowed", allowed) : t("Nothing is allowed by name."),
    ),
  );
  lists.append(el("div", "spacer"));
  lists.append(button({ label: t("Edit the lists"), className: "btn tiny ghost", onClick: () => send({ type: "openSettings" }) }));
  box.append(lists);
  return box;
}

export function permissionsScreen(state: UiState, send: (m: ToExtension) => void): HTMLElement {
  const wrap = el("div", "screen permissions-screen");
  wrap.append(scopeSection(state, send));

  wrap.append(
    el("p", "screen-lede",
      t(
        "By default Hivey Code reads without asking, and asks before every write and every command. What you " +
          "allow here applies to the SHAPE of an action, never to one occurrence: allowing “npm test” " +
          "does not allow “npm publish”.",
      ),
    ),
  );

  const stored = state.permissions.filter((r) => !r.session);
  const session = state.permissions.filter((r) => r.session);

  wrap.append(sectionTitle(t("Permanent rules"), t("Written to disk, in force until you remove them.")));
  const list = el("div", "perm-list");
  if (!stored.length) list.append(el("p", "empty", t("No rule: anything that changes is asked.")));
  for (const rule of stored) list.append(ruleRow(rule, send));
  wrap.append(list);

  wrap.append(sectionTitle(t("Granted for this conversation"), t("Forgotten at the next conversation.")));
  const temp = el("div", "perm-list");
  if (!session.length) temp.append(el("p", "empty", t("Nothing yet.")));
  for (const rule of session) temp.append(ruleRow(rule, send));
  if (session.length) {
    temp.append(
      button({
        label: t("Revoke all"),
        className: "btn tiny",
        onClick: () => send({ type: "clearSessionPermissions" }),
      }),
    );
  }
  wrap.append(temp);

  wrap.append(
    sectionTitle(
      t("Add a permanent rule"),
      t("“Allow” stops asking for that action; “Refuse” blocks it without offering it."),
    ),
  );
  const add = el("div", "perm-add");
  for (const tool of GRANTABLE) {
    const row = el("div", "perm-add-row");
    row.append(el("span", "perm-tool", TOOL_LABELS[tool] ?? tool));
    row.append(el("div", "spacer"));
    row.append(
      button({
        label: t("Allow"),
        className: "btn tiny",
        title: t("This action will no longer be asked, in any workspace"),
        onClick: () => send({ type: "setPermission", tool, level: "always" }),
      }),
      button({
        label: t("Refuse"),
        className: "btn tiny danger",
        title: t("This action will be refused without being offered"),
        onClick: () => send({ type: "setPermission", tool, level: "never" }),
      }),
    );
    add.append(row);
  }
  wrap.append(add);

  wrap.append(
    el(
      "p",
      "screen-note",
      t(
        "A refusal always beats an authorisation, and paths outside the workspace — or covered by the " +
          "privacy policy — stay forbidden whatever these rules say.",
      ),
    ),
  );
  return wrap;
}

function sectionTitle(title: string, hint: string): HTMLElement {
  const wrap = el("div", "models-section");
  wrap.append(el("div", "models-section-title", title));
  wrap.append(el("div", "models-section-hint", hint));
  return wrap;
}

function ruleRow(rule: UiPermissionRule, send: (m: ToExtension) => void): HTMLElement {
  const row = el("div", `perm-row${rule.level === "never" ? " deny" : ""}`);
  row.append(icon(rule.level === "never" ? "cross" : "check", "perm-ico"));

  const main = el("div", "perm-main");
  main.append(el("span", "perm-tool", TOOL_LABELS[rule.tool] ?? rule.tool));
  if (rule.prefix) main.append(el("code", "perm-prefix", rule.prefix));
  row.append(main);

  row.append(el("span", "perm-level", rule.session ? t("this conversation") : rule.level === "never" ? t("refused") : t("allowed")));
  if (!rule.session) {
    row.append(
      button({
        icon: ICON.trash,
        title: t("Remove this rule"),
        className: "btn icon-only",
        onClick: () => send({ type: "forgetPermission", tool: rule.tool, ...(rule.prefix ? { prefix: rule.prefix } : {}) }),
      }),
    );
  }
  return row;
}
