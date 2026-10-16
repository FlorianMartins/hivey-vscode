import { test } from "node:test";
import assert from "node:assert/strict";
import { sortEntries } from "./entries.js";
import { sidebarView } from "./sidebar.js";

const file = (name, path) => ({ type: "file", name, ...(path ? { path } : {}) });
const folder = (name) => ({ type: "folder", name });
const names = (entries) => entries.map((e) => e.name);

test("numbers inside names sort by value", () => {
  assert.deepEqual(names(sortEntries([file("img10.png"), file("img2.png"), file("img1.png"), file("img20.png")])), [
    "img1.png",
    "img2.png",
    "img10.png",
    "img20.png",
  ]);
  assert.deepEqual(names(sortEntries([folder("v10"), folder("v9"), folder("v1")])), ["v1", "v9", "v10"]);
});

test("case does not decide the order", () => {
  assert.deepEqual(names(sortEntries([file("readme.md"), file("Zeta.md"), file("alpha.md"), file("Beta.md")])), [
    "alpha.md",
    "Beta.md",
    "readme.md",
    "Zeta.md",
  ]);
});

test("accented letters sort with their letter", () => {
  assert.deepEqual(names(sortEntries([folder("Zoo"), folder("Écoles"), folder("eau"), folder("Fichiers")])), [
    "eau",
    "Écoles",
    "Fichiers",
    "Zoo",
  ]);
});

test("folders still come first", () => {
  assert.deepEqual(names(sortEntries([file("a10"), folder("b2"), file("a9"), folder("B10"), folder("b1")])), [
    "b1",
    "b2",
    "B10",
    "a9",
    "a10",
  ]);
});

test("entries with the same name keep their order", () => {
  const input = [file("index.js", "src/b"), file("index.js", "src/a"), file("app.js"), file("index.js", "lib")];
  const sorted = sortEntries(input);
  assert.deepEqual(
    sorted.map((e) => e.path ?? e.name),
    ["app.js", "src/b", "src/a", "lib"],
  );
});

test("the caller's array is left alone", () => {
  const input = [file("b"), file("a"), folder("c")];
  const copy = [...input];
  const sorted = sortEntries(input);
  assert.deepEqual(input, copy);
  assert.notEqual(sorted, input);
});

test("rendering the explorer does not reorder the Recent panel", () => {
  const state = {
    entries: [file("zeta.md"), folder("src"), file("alpha.md"), file("img10.png"), file("img2.png")],
  };
  const view = sidebarView(state);
  assert.deepEqual(view.explorer, ["src", "alpha.md", "img2.png", "img10.png", "zeta.md"]);
  assert.deepEqual(view.recent, ["zeta.md", "alpha.md", "img10.png", "img2.png"]);
  assert.deepEqual(sidebarView(state).recent, ["zeta.md", "alpha.md", "img10.png", "img2.png"]);
});
