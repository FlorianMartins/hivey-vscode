// A company's data, found and placed — and ordinary code left readable.
//
// « il faut aussi les données d'entreprises (email, chiffres, nom de compagnies, etc) mais pas le
// code […] afficher précisément le fichier et la ligne concernée ».

import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, redactMessages, Vault, DEFAULT_POLICY } from "../src/core/redaction/index.js";
import { ibanValid, luhn } from "../src/core/redaction/detectors.js";
import { masked, placeOf } from "../src/core/redaction/locate.js";

const strict = { ...DEFAULT_POLICY };
const rules = (text: string): string[] => redact(text, new Vault(), strict).findings.map((f) => f.rule);
/** What would open the warning: credentials, a person's or a company's data. */
const warned = (text: string): string[] =>
  redact(text, new Vault(), strict).findings.filter((f) => ["secret", "identity", "business"].includes(f.kind)).map((f) => f.rule);

test("a company's data is found, by its shape and its own check", () => {
  assert.deepEqual(rules("IBAN : FR76 3000 6000 0112 3456 7890 189"), ["iban"]);
  assert.deepEqual(rules("const card = '4111 1111 1111 1111';"), ["payment-card"]);
  assert.deepEqual(rules("SIRET : 732 829 320 00074"), ["company-number"]);
  assert.deepEqual(rules("TVA intracommunautaire FR40303265045"), ["vat-number"]);
  assert.deepEqual(rules("Client : Durand Conseil SARL, Lyon"), ["company-name"]);
  assert.deepEqual(rules("Chiffre d'affaires 2025 : 1 250 000 €"), ["amount"]);
  // Typeset French: narrow no-break spaces between thousands, a no-break space before the currency.
  assert.deepEqual(rules("Chiffre d'affaires : 1\u202f250\u202f000\u00a0€"), ["amount"]);
  assert.ok(ibanValid("DE89370400440532013000"));
  assert.ok(!ibanValid("FR7630006000011234567890188"), "one digit off: not an IBAN");
  assert.ok(luhn("4111111111111111") && !luhn("4111111111111112"));
});

test("…and ordinary code is left as it is", () => {
  for (const line of [
    "const total = ttc(100, 20); // 120",
    "export const VERSION = '1.14.2';",
    'd="M12 2.4.24.24 0 00-.244.248.24.24 0 00.244.249.24.24 0 00.245-.25L9.5 1.974 1.142c.167.095.238"',
    "// Prints: <Buffer 00 00 00 00 00>",
    "const ids = [123456789, 987654321, 112233445];",
    "const price = 1250; // points",
    "See https://abc:xyz@example.com and pki@example.com",
    "if (status === 'SA') return;",
  ]) {
    assert.deepEqual(warned(line), [], line);
  }
});

test("a person's phone number is still one, written the usual ways", () => {
  assert.deepEqual(rules("Appelez le 06 12 34 56 78 demain."), ["phone"]);
  assert.deepEqual(rules("tel: +33 6 12 34 56 78"), ["phone"]);
});

test("each finding says where it is: the file and the line, or what it came from", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "Corrige l'export.\n\n--- attached context ---\n[file] src/export.js\nconst a = 1;\nconst iban = 'FR7630006000011234567890189';\n" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", args: '{"path":"config/clients.json","from":40}' }] },
    { role: "tool", toolCallId: "c1", content: '{\n  "name": "Durand Conseil SARL",\n  "mail": "compta@durand.fr"\n}' },
    { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "search_text", args: '{"pattern":"SIRET"}' }] },
    { role: "tool", toolCallId: "c2", content: "src/a.js:3: x\ndocs/legal.md:12: SIRET : 732 829 320 00074" },
    { role: "user", content: "Écris à jean.dupont@acme.fr" },
  ];
  const { findings } = redactMessages(messages, new Vault(), strict);
  const where = findings.map((f) => {
    const p = placeOf(messages, f);
    return p.from === "file" ? `${f.rule} ${p.file}:${p.line}` : `${f.rule} ${p.from}`;
  });
  assert.deepEqual(where.sort(), [
    "company-name config/clients.json:41",
    "company-number docs/legal.md:12",
    "email config/clients.json:42",
    "email typed",
    "iban src/export.js:2",
  ]);
});

test("a value in the warning is recognisable without being shown whole", () => {
  assert.equal(masked("FR7630006000011234567890189"), "FR76…0189");
  assert.equal(masked("compta@durand.fr"), "comp…d.fr");
  assert.equal(masked("12345"), "…");
});
