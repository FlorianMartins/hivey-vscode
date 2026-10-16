import { test } from "node:test";
import assert from "node:assert/strict";
import { GAP, pageItems } from "./pager.js";
import { footerModel } from "./footer.js";

/** Every rule of the contract in pager.js, for one input. Returns a reason, or null. */
function violation(total, current, siblings) {
  const items = siblings === 1 ? pageItems(total, current) : pageItems(total, current, siblings);
  const where = `pageItems(${total}, ${current}, ${siblings}) = ${JSON.stringify(items)}`;
  const slots = 2 * siblings + 5;
  if (!Array.isArray(items)) return `${where}: not an array`;
  if (total <= 0) return items.length === 0 ? null : `${where}: no pages must give an empty bar`;
  if (items.length > slots) return `${where}: ${items.length} slots, the bar holds ${slots}`;
  if (total > slots && items.length !== slots) return `${where}: the bar must keep its width of ${slots}`;
  if (total <= slots) {
    const all = Array.from({ length: total }, (_, i) => i + 1);
    return JSON.stringify(items) === JSON.stringify(all) ? null : `${where}: every page fits, so every page is shown`;
  }
  if (items[0] !== 1) return `${where}: the first page is missing`;
  if (items.at(-1) !== total) return `${where}: the last page is missing`;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === GAP) {
      if (i === 0 || i === items.length - 1) return `${where}: a gap at an end`;
      const before = items[i - 1];
      const after = items[i + 1];
      if (before === GAP || after === GAP) return `${where}: two gaps in a row`;
      if (after - before < 3) return `${where}: a gap between ${before} and ${after} hides fewer than two pages`;
    } else {
      if (!Number.isInteger(item) || item < 1 || item > total) return `${where}: ${item} is not a page`;
      if (i > 0 && items[i - 1] !== GAP && item !== items[i - 1] + 1) return `${where}: ${items[i - 1]} then ${item} with no gap`;
    }
  }
  const page = Math.min(Math.max(current, 1), total);
  for (let p = Math.max(1, page - siblings); p <= Math.min(total, page + siblings); p++) {
    if (!items.includes(p)) return `${where}: page ${p} (current ${page} or a sibling) is missing`;
  }
  return null;
}

test("the contract holds for every page of every list up to 40 pages, siblings 1", () => {
  const broken = [];
  for (let total = 0; total <= 40; total++) {
    for (let current = 1; current <= Math.max(total, 1); current++) {
      const why = violation(total, current, 1);
      if (why) broken.push(why);
    }
  }
  assert.deepEqual(broken.slice(0, 5), []);
});

test("the contract holds with other sibling counts", () => {
  const broken = [];
  for (const siblings of [0, 2]) {
    for (let total = 0; total <= 30; total++) {
      for (let current = 1; current <= Math.max(total, 1); current++) {
        const why = violation(total, current, siblings);
        if (why) broken.push(why);
      }
    }
  }
  assert.deepEqual(broken.slice(0, 5), []);
});

test("a current page out of range is the nearest valid one", () => {
  const broken = [];
  for (const total of [1, 3, 7, 8, 12, 40]) {
    for (const current of [0, -3, total + 1, total + 20]) {
      const why = violation(total, current, 1);
      if (why) broken.push(why);
    }
  }
  assert.deepEqual(broken.slice(0, 5), []);
});

test("eight to ten pages no longer overflow", () => {
  assert.deepEqual(pageItems(10, 5), [1, GAP, 4, 5, 6, GAP, 10]);
  assert.deepEqual(pageItems(8, 4), [1, 2, 3, 4, 5, GAP, 8]);
});

test("the footer highlights the page the bar shows, even when the request was out of range", () => {
  const model = footerModel({ totalItems: 25, pageSize: 10, page: 9 });
  const current = model.slots.filter((s) => s.current);
  assert.equal(current.length, 1, "exactly one page is highlighted");
  assert.equal(current[0].page, 3);
});

test("the footer of an empty list has no slots", () => {
  const model = footerModel({ totalItems: 0, pageSize: 10, page: 1 });
  assert.equal(model.label, "No results");
  assert.deepEqual(model.slots, []);
});
