#!/usr/bin/env node
// A tiny todo list. The store is a JSON file: $TODO_FILE, or ./todo.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = process.env.TODO_FILE ?? "todo.json";

/** A user error: a message on stderr and exit code 2, never a stack trace. */
function fail(message) {
  console.error(`todo: ${message}`);
  process.exit(2);
}

/**
 * The store: { version: 2, nextId, items: [{ id, text, done, due? }] }.
 *
 * Version 1 was a bare array, and an item's id was its position — so removing item 1 renumbered
 * every item after it, and `done 3` marked whatever had slid into third place. Ids are stored now,
 * and never reused. A version 1 file is read as items 1..n in order, and written back as version 2
 * the next time anything changes.
 */
function load() {
  if (!existsSync(FILE)) return { version: 2, nextId: 1, items: [] };
  const data = JSON.parse(readFileSync(FILE, "utf8"));
  if (Array.isArray(data)) {
    const items = data.map((item, i) => ({ id: i + 1, text: item.text, done: Boolean(item.done) }));
    return { version: 2, nextId: items.length + 1, items };
  }
  return data;
}

function save(store) {
  writeFileSync(FILE, JSON.stringify(store, null, 2) + "\n");
}

/** A real calendar date written YYYY-MM-DD, or null. "2026-02-30" is not one. */
function parseDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

function today() {
  const override = process.env.TODO_TODAY;
  if (override !== undefined) return parseDate(override) ?? fail(`TODO_TODAY is not a date: ${override}`);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function find(store, raw) {
  const id = Number(raw);
  const item = Number.isInteger(id) ? store.items.find((it) => it.id === id) : undefined;
  return item ?? fail(`no item ${raw === undefined ? "(missing id)" : raw}`);
}

function line(item) {
  return `[${item.done ? "x" : " "}] ${item.id} ${item.text}${item.due ? ` (due ${item.due})` : ""}`;
}

function add(store, args) {
  const words = [];
  let due;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--due") {
      words.push(args[i]);
      continue;
    }
    due = parseDate(args[++i]) ?? fail(`--due needs a date as YYYY-MM-DD, got ${args[i] ?? "nothing"}`);
  }
  const item = { id: store.nextId++, text: words.join(" "), done: false, ...(due ? { due } : {}) };
  store.items.push(item);
  save(store);
  console.log(`added ${item.id}`);
}

const [command, ...args] = process.argv.slice(2);
const store = load();

switch (command) {
  case "add":
    add(store, args);
    break;
  case "list": {
    const overdue = args.includes("--overdue");
    const now = overdue ? today() : "";
    // ISO dates compare as strings.
    const shown = overdue ? store.items.filter((it) => !it.done && it.due && it.due < now) : store.items;
    for (const item of shown) console.log(line(item));
    break;
  }
  case "done":
    find(store, args[0]).done = true;
    save(store);
    break;
  case "rm": {
    const item = find(store, args[0]);
    store.items = store.items.filter((it) => it !== item);
    save(store);
    break;
  }
  default:
    console.error("usage: todo add <text> [--due YYYY-MM-DD] | list [--overdue] | done <id> | rm <id>");
    process.exit(1);
}
