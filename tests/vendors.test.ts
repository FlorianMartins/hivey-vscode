// The provider table, and the four places that used to hold their own copy of it.
//
// The defect these tests exist against is not a crash: it is a provider that is offered in the
// composer's menu, absent from the manifest, and therefore impossible to select — or one whose
// "Get a key" button opens nothing because its address never reached the link allow-list. Every one
// of those is invisible from the code and obvious to the user, which is the wrong way round.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnthropicProvider, makeProvider, OpenAICompatibleProvider } from "../src/core/providers/index.js";
import {
  defaultEndpoints,
  DIRECT_VENDORS,
  endpointSettingKey,
  PROVIDER_IDS,
  REMOTE_VENDORS,
  vendor,
} from "../src/core/providers/vendors.js";

// Read from the working directory, the way the i18n tests read `src`: these run bundled, where
// `import.meta.url` points into `dist-tests` and no longer says where the repository is.
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const nls = JSON.parse(readFileSync("package.nls.json", "utf8"));
const nlsFr = JSON.parse(readFileSync("package.nls.fr.json", "utf8"));

function setting(key: string): any {
  for (const block of manifest.contributes.configuration) {
    if (block.properties[key]) return block.properties[key];
  }
  return undefined;
}

test("every vendor is one identity: an id, an address, a key shape and somewhere to buy one", () => {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const v of REMOTE_VENDORS) {
    assert.equal(ids.has(v.id), false, `${v.id} is listed twice`);
    ids.add(v.id);
    assert.equal(keys.has(v.settingKey), false, `${v.settingKey} is used by two vendors`);
    keys.add(v.settingKey);
    assert.ok(v.label && v.short && v.hint, `${v.id} has nothing to show in a menu`);
    assert.ok(v.keysUrl?.startsWith("https://"), `${v.id} has no https address for its keys`);
    // A settings key segment is not a free-form string: `openai-compatible` is not one, which is
    // why that vendor spells its setting differently from its id.
    assert.match(v.settingKey, /^[A-Za-z][A-Za-z0-9]*$/, `${v.settingKey} is not a legal settings key`);
  }
});

test("an address is https, or it is the user's own to supply", () => {
  for (const v of REMOTE_VENDORS) {
    if (v.needsUrl) {
      assert.equal(v.baseUrl, "", `${v.id} asks for an address and ships one`);
      continue;
    }
    assert.match(v.baseUrl, /^https:\/\//, `${v.id} would send a key over plain http`);
  }
});

test("every provider has an address to reach it at", () => {
  // A provider in the union with no default endpoint throws on the first question rather than on
  // the choice, and the error names a setting instead of a thing to do.
  const endpoints = defaultEndpoints();
  for (const id of PROVIDER_IDS) {
    if (vendor(id)?.needsUrl) continue;
    assert.match(endpoints[id] ?? "", /^https?:\/\//, `${id} has no address`);
  }
});

test("the dialect follows the vendor, not the caller", () => {
  // Anthropic's API is not OpenAI's. Getting this wrong produces a request the server cannot read,
  // which is reported as a malformed body rather than as the wrong client.
  assert.ok(makeProvider({ id: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "k" }) instanceof AnthropicProvider);
  for (const v of REMOTE_VENDORS.filter((x) => x.wire === "openai")) {
    const p = makeProvider({ id: v.id, baseUrl: v.baseUrl || "https://gateway.example/v1", apiKey: "k" });
    assert.ok(p instanceof OpenAICompatibleProvider, `${v.id} would be spoken to in the wrong dialect`);
    assert.equal(p.isLocal, false, `${v.id} would skip pseudonymisation`);
  }
});

test("the settings spell every vendor's address, with the same default", () => {
  for (const v of REMOTE_VENDORS) {
    const key = `hiveyCode.${endpointSettingKey(v.id)}`;
    const declared = setting(key);
    assert.ok(declared, `${key} is not in the manifest, so the address cannot be changed`);
    assert.equal(declared.default, v.baseUrl, `${key} defaults to something else than the table says`);
    const nlsKey = declared.description?.replace(/%/g, "");
    assert.ok(nls[nlsKey], `${nlsKey} has no English text`);
    assert.ok(nlsFr[nlsKey], `${nlsKey} has no French text`);
  }
});

test("the manifest offers exactly the providers the table knows", () => {
  // The enum is what the settings UI shows and what a settings.json written by hand is validated
  // against: a provider missing from it can be chosen in the panel and is then reported as an
  // invalid value by the editor.
  assert.deepEqual(setting("hiveyCode.chat.provider").enum, PROVIDER_IDS);
  assert.deepEqual(
    setting("hiveyCode.escalation.provider").enum,
    PROVIDER_IDS.filter((id) => id !== "local"),
    "escalating to this machine is not an escalation",
  );
});

test("the vendors a user pays directly are the ones asked what they serve", () => {
  // OpenRouter is excluded because the generated catalogue already names its models with prices;
  // the gateway is excluded because it has no address until someone supplies one.
  const ids = DIRECT_VENDORS.map((v) => v.id);
  assert.equal(ids.includes("openrouter"), false);
  assert.equal(ids.includes("openai-compatible"), false);
  for (const id of ["openai", "deepseek", "qwen", "perplexity", "mistral", "google", "groq", "xai"]) {
    assert.ok(ids.includes(id as never), `${id} would never show a model in the picker`);
  }
});
