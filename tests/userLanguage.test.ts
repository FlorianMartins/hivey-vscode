// The user's language, any of the common ones — see core/userLanguage.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectUserLanguage } from "../src/core/userLanguage.js";
import { detectLanguage, languageDirective, withReplyLanguage } from "../src/core/prompts.js";

const samples: Array<[string, string]> = [
  ["fr", "Est-ce que tu peux corriger le calcul de la remise dans le panier de la page de commande ?"],
  ["en", "Can you fix the discount calculation in the cart, please? It should not go below zero."],
  ["es", "¿Puedes corregir el cálculo del descuento en el carrito, por favor? Gracias."],
  ["de", "Kannst du bitte die Berechnung des Rabatts im Warenkorb korrigieren? Danke, das ist nicht richtig."],
  ["it", "Puoi correggere il calcolo dello sconto nel carrello per favore? Grazie, non è giusto."],
  ["pt", "Você pode corrigir o cálculo do desconto no carrinho, por favor? Obrigado, não está certo."],
  ["nl", "Kun jij de berekening van de korting in het winkelmandje verbeteren? Dank, het is niet goed."],
];

test("each common language is recognised from an ordinary request", () => {
  for (const [lang, text] of samples) assert.equal(detectUserLanguage(text, "en"), lang, text);
});

test("English and French read exactly as the old detector read them", () => {
  const texts = [
    "Que fait src/prix.js ?",
    "fix the bug",
    "corrige le bug de la page de connexion de l'application de gestion de la guilde de la semaine",
    "`npm test` fails",
    "Peux-tu regarder pourquoi le test de la fonction de paiement de la boutique échoue ?",
    "Why does the build of the docs fail on CI with the new config?",
    "ok",
  ];
  for (const t of texts) {
    for (const fb of ["en", "fr"] as const) assert.equal(detectUserLanguage(t, fb), detectLanguage(t, fb), t);
  }
});

test("the rule names the user's language and is also said in it; French is the sentence measured", () => {
  const msgs = [{ role: "system", content: "sys" }, { role: "user", content: "x" }, { role: "tool", content: "out" }];
  const es = withReplyLanguage(msgs, "es");
  assert.match(es[0]!.content, /the user writes in Spanish[\s\S]*Responde en español/);
  assert.match(es[2]!.content, /\[Reply language: Spanish\.[^\]]*Responde en español[^\]]*\]$/);
  const fr = withReplyLanguage(msgs, "fr");
  assert.ok(fr[2]!.content.endsWith("is in French. Réponds en français : chaque phrase que tu écris pour l'utilisateur, notes entre les outils comprises.]"));
  assert.match(languageDirective("de"), /Reply language: German/);
});
