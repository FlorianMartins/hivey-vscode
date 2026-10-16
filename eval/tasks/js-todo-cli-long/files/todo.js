#!/usr/bin/env node
// A tiny todo list. The store is a JSON file: $TODO_FILE, or ./todo.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = process.env.TODO_FILE ?? "todo.json";

function load() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
}

function save(items) {
  writeFileSync(FILE, JSON.stringify(items, null, 2) + "\n");
}

const [command, ...args] = process.argv.slice(2);
const items = load();

switch (command) {
  case "add": {
    items.push({ text: args.join(" "), done: false });
    save(items);
    console.log(`added ${items.length}`);
    break;
  }
  case "list": {
    items.forEach((item, i) => console.log(`[${item.done ? "x" : " "}] ${i + 1} ${item.text}`));
    break;
  }
  case "done": {
    items[Number(args[0]) - 1].done = true;
    save(items);
    break;
  }
  case "rm": {
    items.splice(Number(args[0]) - 1, 1);
    save(items);
    break;
  }
  default:
    console.error("usage: todo add <text> | list | done <id> | rm <id>");
    process.exit(1);
}
