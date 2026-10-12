// Buttons and menus in Hivey Code's language, not only VS Code's.
//
// "it's when VS Code is in English, despite the language selected in the settings": the title-bar
// buttons ("Search this conversation", "New conversation") and the context menus are titled by
// VS Code from package.nls according to ITS display language. Each is now declared twice, with
// literal English and French titles, and shown by the context key the extension sets — see
// scripts/localize-menus.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const fr = JSON.parse(readFileSync("package.nls.fr.json", "utf8"));
const en = JSON.parse(readFileSync("package.nls.json", "utf8"));
const c = pkg.contributes;
const title = (id: string) => c.commands.find((x: { command: string }) => x.command === id)?.title as string | undefined;

test("package.json is in step with the menu localizer", () => {
  // A menu or a title changed without re-running the generator would ship a button in one language.
  execFileSync(process.execPath, ["scripts/localize-menus.mjs", "--check"], { stdio: "pipe" });
});

test("⚠️ the title-bar buttons have literal French and English twins", () => {
  for (const id of ["hiveyCode.searchConversation", "hiveyCode.exportSession", "hiveyCode.openSettings"]) {
    const key = /^%(.+)%$/.exec(title(id) ?? "")?.[1];
    assert.ok(key, `${id} has no nls title`);
    assert.equal(title(`${id}.l10n.fr`), fr[key!], `${id}: French twin`);
    assert.equal(title(`${id}.l10n.en`), en[key!], `${id}: English twin`);
  }
  assert.equal(title("hiveyCode.searchConversation.l10n.fr"), "Rechercher dans cette conversation");
  const sub = c.submenus.find((s: { id: string }) => s.id === "hiveyCode.newConversation.l10n.fr");
  assert.equal(sub?.label, "Nouvelle conversation", "the 'New conversation' submenu");
});

test("every menu entry shows in exactly one form for each language", () => {
  for (const [menu, entries] of Object.entries(c.menus as Record<string, Array<Record<string, string>>>)) {
    if (menu === "commandPalette" || menu.includes(".l10n.")) continue;
    for (const e of entries) {
      const id = e["command"] ?? e["submenu"]!;
      if (id.includes(".l10n.")) continue;
      for (const lang of ["en", "fr"]) {
        const twin = entries.find((x) => (x["command"] ?? x["submenu"]) === `${id}.l10n.${lang}`);
        assert.ok(twin, `${menu}: ${id} has no ${lang} twin`);
        assert.match(twin!["when"]!, new RegExp(`hiveyCode\\.l10n == '${lang}'$`));
      }
      assert.match(e["when"]!, /!hiveyCode\.l10n$/, `${menu}: the plain ${id} must only show before activation`);
    }
  }
});

test("the twins stay out of the command palette", () => {
  const twins = c.commands.filter((x: { command: string }) => x.command.includes(".l10n.")).map((x: { command: string }) => x.command);
  const hidden = new Set(c.menus.commandPalette.filter((e: { when: string }) => e.when === "false").map((e: { command: string }) => e.command));
  assert.deepEqual(twins.filter((id: string) => !hidden.has(id)), []);
});
