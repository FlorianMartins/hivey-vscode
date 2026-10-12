// Handing a change to ARCAD, and the one thing the agent will never do.
//
// Two different kinds of test here. The readiness rules are ordinary logic. The promotion rule is a
// GUARANTEE, and the test for it reads the curated action list in the source — because the promise
// "the agent cannot promote to production" is kept by that list being short and by nobody adding
// the wrong thing to it, which is exactly the kind of promise that needs a test rather than a
// comment.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROMOTION_REFUSED,
  deliveryPlan,
  looksLikePromotion,
  readyToDeliver,
  type DeliveryStep,
} from "../src/core/ibmi/delivery.js";
import { BUILTIN_SKILLS } from "../src/core/session/skills.js";

const ok = (tool: string, call?: string): DeliveryStep => ({ tool, ok: true, ...(call ? { call } : {}) });
const bad = (tool: string, call?: string): DeliveryStep => ({ tool, ok: false, ...(call ? { call } : {}) });

// ── What has to be true first ────────────────────────────────────────────────────────────────────

test("a change that was never compiled is not ready, which is the common case", () => {
  // The model changed a member and believes it is done. That is the ordinary shape of this mistake,
  // not an edge case.
  const r = readyToDeliver([ok("edit_file", "DEVCFC/QRPGLESRC(CUSTRPT)")]);
  assert.equal(r.ready, false);
  assert.match(r.why, /nothing was compiled/);
});

test("a change that compiles but was never tested is not ready", () => {
  const r = readyToDeliver([ok("edit_file"), ok("ibmi_compile", "CRTBNDRPG TSTCFC/CUSTRPT")]);
  assert.equal(r.ready, false);
  assert.match(r.why, /compiling proves it is a program, not that it still works/);
});

test("a failing compile or a failing test is not ready, and says which", () => {
  const compile = readyToDeliver([bad("ibmi_compile", "CRTBNDRPG TSTCFC/CUSTRPT")]);
  assert.equal(compile.ready, false);
  assert.match(compile.why, /no object exists/);

  const tests = readyToDeliver([ok("ibmi_compile", "CRTBNDRPG TSTCFC/CUSTRPT"), bad("ibmi_test", "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)")]);
  assert.equal(tests.ready, false);
  assert.match(tests.why, /test run failed/);
  assert.match(tests.why, /RUCALLTST/);
});

test("the LAST of each counts, so fixing and re-running earns the delivery", () => {
  // The same rule as `verifyTurn`, for the same reason: a turn that compiled, failed, fixed and
  // compiled again has a red step in its trace and a working program.
  const r = readyToDeliver([
    bad("ibmi_compile", "CRTBNDRPG TSTCFC/CUSTRPT"),
    ok("edit_file"),
    ok("ibmi_compile", "CRTBNDRPG TSTCFC/CUSTRPT"),
    bad("ibmi_test", "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)"),
    ok("edit_file"),
    ok("ibmi_test", "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)"),
  ]);
  assert.equal(r.ready, true, r.why);
  assert.match(r.why, /compiled and its tests passed/);
});

test("the plan is check in and THEN ask for the build, in that order", () => {
  // A build request before the check-in builds the previous version and reports success.
  const plan = deliveryPlan([ok("ibmi_compile"), ok("ibmi_test")]);
  assert.deepEqual(plan.steps, ["checkin", "request_build"]);
});

test("a change that is not ready gets no steps at all", () => {
  const plan = deliveryPlan([ok("edit_file")]);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.readiness.ready, false);
});

// ── The guarantee ────────────────────────────────────────────────────────────────────────────────

test("the words that mean “move this towards production” are recognised", () => {
  for (const command of [
    "arcad.promoteComponent",
    "arcad.transferToProduction",
    "arcad.deployApplication",
    "arcad.releaseVersion",
    "arcad.applyChangesToProd",
    "arcad.skipperRunTransfer",
  ]) {
    assert.equal(looksLikePromotion(command), true, command);
  }
  // And the ordinary ones are not caught, or the allow-list would be empty.
  for (const command of ["arcad.checkin", "arcad.checkout", "arcad.requestBuild", "arcad.componentProperties", "arcad.searchForWord"]) {
    assert.equal(looksLikePromotion(command), false, command);
  }
});

test("no ARCAD action the agent can invoke is a promotion", () => {
  // THE test of this chantier. The promise is kept by the curated list being short and by nobody
  // adding the wrong thing to it later — so the list is read from the source and every entry is put
  // through the pattern. A comment saying "do not add a promotion here" would not have caught it.
  const source = readFileSync(join("src", "extension", "integrations", "arcad.ts"), "utf8");
  const commands = [...source.matchAll(/command:\s*"(arcad\.[A-Za-z0-9_]+)"/g)].map((m) => m[1]!);
  assert.ok(commands.length >= 8, `only ${commands.length} actions were found — has the list moved?`);
  const promoting = commands.filter((c) => looksLikePromotion(c));
  assert.deepEqual(promoting, [], "an action that moves code towards production is reachable by the agent");
});

test("the refusal names who does it instead", () => {
  // "I cannot do that" with no next step is how somebody ends up doing it by hand, outside ARCAD,
  // at five o'clock.
  assert.match(PROMOTION_REFUSED, /not something I can be configured to do/);
  assert.match(PROMOTION_REFUSED, /belongs to whoever is accountable/);
  assert.match(PROMOTION_REFUSED, /What I can do/);
  assert.match(PROMOTION_REFUSED, /done in ARCAD by a person/);
});

test("the delivery skill compiles and tests before it checks anything in, and refuses to promote", () => {
  const deliver = BUILTIN_SKILLS.find((s) => s.name === "/deliver");
  assert.ok(deliver, "/deliver is not in the skill list");
  assert.equal(deliver.group, "rpg");
  assert.match(deliver.prompt ?? "", /ibmi_compile/);
  assert.match(deliver.prompt ?? "", /ibmi_test/);
  assert.match(deliver.prompt ?? "", /checkin/);
  assert.match(deliver.prompt ?? "", /do not promote|never promote/i);
});
