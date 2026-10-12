// Menus and buttons in the language Hivey Code chose — not only in VS Code's.
//
// "the hover text of the buttons is still in English when French is selected — 'Search this
// conversation', 'New conversation'". Those tooltips are not drawn by the extension: VS Code draws
// the view's title bar, the context menus and the submenus, and takes their text from
// `package.nls.*.json` according to ITS display language. An extension cannot re-title a command
// at runtime, so `hiveyCode.language: fr` on an English VS Code left every button in English.
//
// The way round it is declarative. Every command placed in a menu gets two twins, `<id>.l10n.en`
// and `<id>.l10n.fr`, whose titles are written out literally from the two nls files; every submenu
// gets twins the same way. Each menu entry is then shown in exactly one form, chosen by the context
// key `hiveyCode.l10n` that the extension sets to the language it resolved (`en` | `fr`). The plain
// entry only shows before activation, when the key is not set yet. The twins are hidden from the
// command palette, which keeps VS Code's own titles.
//
// Generated, idempotent: run `node scripts/localize-menus.mjs` after changing a menu or a title;
// `--check` fails when package.json is out of date (the unit tests run it).
import { readFileSync, writeFileSync } from "node:fs";

const LANGS = ["en", "fr"];
const KEY = "hiveyCode.l10n";
const SUFFIX = ".l10n.";
const ONLY_BEFORE = `!${KEY}`;

const raw = readFileSync("package.json", "utf8");
const pkg = JSON.parse(raw);
const nls = { en: JSON.parse(readFileSync("package.nls.json", "utf8")), fr: JSON.parse(readFileSync("package.nls.fr.json", "utf8")) };
const resolve = (value, lang) => {
  if (typeof value !== "string") return value;
  const m = /^%(.+)%$/.exec(value);
  if (!m) return value;
  const text = nls[lang][m[1]] ?? nls.en[m[1]];
  if (text === undefined) throw new Error(`no nls entry for ${value}`);
  return text;
};
const isTwin = (id) => typeof id === "string" && id.includes(SUFFIX);
const twin = (id, lang) => `${id}${SUFFIX}${lang}`;
const and = (a, b) => (a ? `(${a}) && ${b}` : b);
const stripOurs = (when) => {
  if (!when) return when;
  if (when === ONLY_BEFORE) return undefined;
  const m = /^\((.*)\) && !hiveyCode\.l10n$/.exec(when);
  return m ? m[1] : when;
};

const c = pkg.contributes;

// 1. Undo any previous generation, so running twice changes nothing.
c.commands = c.commands.filter((cmd) => !isTwin(cmd.command));
c.submenus = (c.submenus ?? []).filter((s) => !isTwin(s.id));
for (const key of Object.keys(c.menus)) {
  if (isTwin(key)) {
    delete c.menus[key];
    continue;
  }
  c.menus[key] = c.menus[key]
    .filter((e) => !isTwin(e.command) && !isTwin(e.submenu))
    .map((e) => {
      const when = stripOurs(e.when);
      const out = { ...e };
      if (when === undefined) delete out.when;
      else out.when = when;
      return out;
    });
}

// 2. Twins for every command and submenu shown in a menu (the palette keeps VS Code's titles).
const menuKeys = Object.keys(c.menus).filter((k) => k !== "commandPalette");
const commandIds = new Set();
const submenuIds = new Set();
for (const key of menuKeys) {
  for (const e of c.menus[key]) {
    if (e.command) commandIds.add(e.command);
    if (e.submenu) submenuIds.add(e.submenu);
  }
}
const byId = new Map(c.commands.map((cmd) => [cmd.command, cmd]));
for (const id of [...commandIds].sort()) {
  const cmd = byId.get(id);
  if (!cmd) throw new Error(`menu refers to an undeclared command: ${id}`);
  for (const lang of LANGS) {
    const out = { ...cmd, command: twin(id, lang), title: resolve(cmd.title, lang) };
    if (cmd.category) out.category = resolve(cmd.category, lang);
    if (cmd.shortTitle) out.shortTitle = resolve(cmd.shortTitle, lang);
    c.commands.push(out);
  }
}
const subById = new Map(c.submenus.map((s) => [s.id, s]));
for (const id of [...submenuIds].sort()) {
  const sub = subById.get(id);
  if (!sub) throw new Error(`menu refers to an undeclared submenu: ${id}`);
  for (const lang of LANGS) c.submenus.push({ ...sub, id: twin(id, lang), label: resolve(sub.label, lang) });
}

// 3. Every entry in exactly one form: the plain one before activation, then the chosen language's.
for (const key of menuKeys) {
  const entries = c.menus[key];
  const next = [];
  for (const e of entries) {
    next.push({ ...e, when: and(e.when, ONLY_BEFORE) });
    for (const lang of LANGS) {
      const t = { ...e, when: and(e.when, `${KEY} == '${lang}'`) };
      if (e.command) t.command = twin(e.command, lang);
      if (e.submenu) t.submenu = twin(e.submenu, lang);
      next.push(t);
    }
  }
  c.menus[key] = next;
}
// A submenu's own items follow the same rule, under each twin of the submenu.
for (const id of submenuIds) {
  for (const lang of LANGS) {
    c.menus[twin(id, lang)] = c.menus[id]
      .filter((e) => e.when?.endsWith(`${KEY} == '${lang}'`))
      .map((e) => ({ ...e }));
  }
}

// 4. Hidden from the command palette.
c.menus.commandPalette = (c.menus.commandPalette ?? []).filter((e) => !isTwin(e.command));
for (const id of [...commandIds].sort()) for (const lang of LANGS) c.menus.commandPalette.push({ command: twin(id, lang), when: "false" });

const out = JSON.stringify(pkg, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (out !== raw) {
    console.error("package.json menus are not localized — run: node scripts/localize-menus.mjs");
    process.exit(1);
  }
  console.log(`✓ menus localized (${commandIds.size} commands, ${submenuIds.size} submenus)`);
} else {
  writeFileSync("package.json", out);
  console.log(`localized ${commandIds.size} commands and ${submenuIds.size} submenus`);
}
