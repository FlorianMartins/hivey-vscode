import { test } from "node:test";
import assert from "node:assert/strict";
import { SOH, build } from "./fix.js";

const FIELDS = [
  ["35", "D"],
  ["49", "SENDER"],
  ["56", "TARGET"],
  ["34", "1"],
  ["52", "20261003-11:30:00"],
  ["11", "ORD1"],
  ["55", "FR0000120271"],
  ["54", "1"],
  ["38", "100"],
  ["40", "2"],
  ["44", "58.25"],
];

/** The two fields a counterparty checks before it reads anything else. */
function parts(message) {
  const bodyLength = /\x019=(\d+)\x01/.exec(message)?.[1];
  const checksum = /\x0110=(\d{3})\x01$/.exec(message)?.[1];
  return { bodyLength: Number(bodyLength), checksum };
}

test("the body length counts the bytes between tag 9 and tag 10", () => {
  const message = build(FIELDS);
  const { bodyLength } = parts(message);
  const start = message.indexOf(`${SOH}9=`);
  const afterNine = message.indexOf(SOH, start + 1) + 1;
  const ten = message.lastIndexOf(`10=`);
  assert.equal(bodyLength, ten - afterNine, "the counterparty computes this and compares");
});

test("the checksum is three digits, and covers everything before tag 10", () => {
  const message = build(FIELDS);
  const { checksum } = parts(message);
  assert.ok(checksum, "the checksum must be three digits, zero-padded");
  const upTo = message.slice(0, message.lastIndexOf("10="));
  let sum = 0;
  for (const char of upTo) sum += char.charCodeAt(0);
  assert.equal(checksum, String(sum % 256).padStart(3, "0"));
});

test("a one-field message is still well formed", () => {
  const message = build([["35", "0"]]);
  const { bodyLength, checksum } = parts(message);
  assert.ok(bodyLength > 0);
  assert.equal(checksum?.length, 3);
});
