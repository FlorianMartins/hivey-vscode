// The language the user writes in — any of the common ones, not only the two the interface speaks.
//
// ⚠️ « les utilisateurs peuvent utiliser n'importe quelle langue ». The detector knew English and
// French only, so a question in Spanish or German scored as English — and the reply rule then told the
// model to ANSWER IT IN ENGLISH. The interface stays in English or French (`shared/i18n.ts`); what the
// model writes follows the person, whatever they write in.

export type UserLang = "en" | "fr" | "es" | "de" | "it" | "pt" | "nl";

/** The language's English name, as the model reads it in a rule. */
export const LANG_NAMES: Record<UserLang, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
};

/**
 * The reply rule in the user's own words. An order about French written in English is the weakest
 * form of it: measured on Qwen3.8, the English sentence moved nothing that the same order in the
 * language itself did. None for English, whose rule is already in its own words.
 */
export const REPLY_IN_OWN_WORDS: Partial<Record<UserLang, string>> = {
  fr: "Réponds en français : chaque phrase que tu écris pour l'utilisateur, notes entre les outils comprises.",
  es: "Responde en español: cada frase que escribas para el usuario, incluidas las notas entre herramientas.",
  de: "Antworte auf Deutsch: jeder Satz, den du für den Nutzer schreibst, auch die Notizen zwischen den Werkzeugen.",
  it: "Rispondi in italiano: ogni frase che scrivi per l'utente, comprese le note tra gli strumenti.",
  pt: "Responda em português: cada frase que você escreve para o usuário, incluindo as notas entre as ferramentas.",
  nl: "Antwoord in het Nederlands: elke zin die je voor de gebruiker schrijft, ook de notities tussen de tools.",
};

/**
 * The first words of the model's thinking in the user's language, on a server that continues a
 * started answer. None for English, where it thinks anyway.
 *
 * ⚠️ Measured on Qwen3.8, start by start: « Bon, je » made the thinking a narration (« Bon, je vais
 * lancer les tests maintenant »); « Réfléchissons étape par étape. » — a finished sentence — closed
 * the thinking on the spot; « …D'abord, » left one short line; a second start for later steps
 * (« Analysons ce résultat en détail : ») drifted into a generic report unrelated to the task. This
 * one kept a whole reasoning, checks included, in French — at every step.
 *
 * ⚠️ NOT USED any more, by the panel or the terminal. Measured on 10 short tasks; on long ones, every
 * step began « …La demande porte sur » and went back to the request instead of on from what it had
 * found: the same thought, the same three files read thirty times in one turn, the window filled and
 * no answer — « il boucle […] en ayant à chaque fois la même réflexion ». The model thinks in its own
 * language again; what it writes for the person is in theirs (see `withReplyLanguage`).
 */
export const THINK_STARTERS: Partial<Record<UserLang, string>> = {
  fr: "Analysons la situation en détail. La demande porte sur",
  es: "Analicemos la situación en detalle. La petición trata sobre",
  de: "Analysieren wir die Situation im Detail. Die Anfrage betrifft",
  it: "Analizziamo la situazione nel dettaglio. La richiesta riguarda",
  pt: "Vamos analisar a situação em detalhe. O pedido trata de",
  nl: "Laten we de situatie in detail analyseren. Het verzoek gaat over",
};

/** « Think in this language », in that language — said only where the thinking is started in it. */
export const THINK_IN_OWN_WORDS: Partial<Record<UserLang, string>> = {
  fr: "Réfléchis en français aussi.",
  es: "Piensa en español también.",
  de: "Denke auch auf Deutsch.",
  it: "Pensa anche in italiano.",
  pt: "Pense em português também.",
  nl: "Denk ook in het Nederlands.",
};

/** Very common words of each language — the ones that decide, and almost nothing else. */
const WORDS: Record<UserLang, string[]> = {
  en: ["the", "and", "is", "are", "for", "that", "with", "this", "please", "can", "you", "what", "why", "how", "does", "do", "not", "it", "of", "to", "in", "my", "should", "would", "could"],
  fr: ["le", "la", "les", "des", "une", "est", "et", "pour", "que", "qui", "dans", "pas", "sur", "avec", "tu", "vous", "je", "il", "ce", "cette", "mais", "fais", "peux", "plait", "plaît", "merci", "quoi", "comment", "pourquoi", "du", "au", "aux", "ne", "on", "nous"],
  // Only words that are NOT also everyday French or English (no `de`, `il`, `es`, `do`, `no`, `is`…):
  // a French question full of « de » must never read as Dutch.
  es: ["el", "los", "las", "una", "y", "para", "qué", "con", "por", "puedes", "favor", "gracias", "cómo", "como", "del", "esto", "este", "esta", "hay", "pero", "muy", "también", "porque", "cuando"],
  de: ["der", "die", "das", "und", "ist", "nicht", "mit", "für", "ein", "eine", "ich", "sie", "wie", "warum", "was", "bitte", "danke", "kannst", "auf", "zu", "den", "dem", "auch", "aber", "noch", "mein"],
  it: ["gli", "una", "è", "per", "che", "non", "di", "come", "perché", "grazie", "puoi", "questo", "questa", "sono", "anche", "mio", "della", "del", "nel", "molto", "cosa"],
  pt: ["os", "uma", "é", "para", "não", "com", "por", "você", "obrigado", "como", "porque", "isso", "este", "esta", "mas", "dos", "das", "meu", "pode", "também", "muito", "então"],
  nl: ["het", "een", "niet", "met", "voor", "dat", "dit", "ik", "jij", "wat", "waarom", "hoe", "graag", "dank", "kun", "kan", "ook", "maar", "van", "mijn", "zijn", "wordt"],
};

const SETS: Record<UserLang, Set<string>> = Object.fromEntries(
  (Object.keys(WORDS) as UserLang[]).map((l) => [l, new Set(WORDS[l])]),
) as Record<UserLang, Set<string>>;

/** Letters only one language of the list uses — a strong hint, counted for half a word. */
const LETTERS: Partial<Record<UserLang, RegExp>> = {
  fr: /[àâçèêëîïôûùœ]/,
  es: /[ñ¿¡]/,
  de: /[äöüß]/,
  pt: /[ãõ]/,
};

/**
 * The language of `text`, or `fallback` when it is too short or too technical to tell.
 *
 * English and French read exactly as `detectLanguage` reads them (a test holds the two together), so a
 * question in either is treated as before; another language wins only when it is clearly ahead.
 */
export function detectUserLanguage(text: string, fallback: UserLang): UserLang {
  const words = text.toLowerCase().replace(/`[^`]*`/g, " ").match(/[a-zàâãçèéêëîïñôõöûùüÿœß¿¡']+/g) ?? [];
  const score: Record<UserLang, number> = { en: 0, fr: 0, es: 0, de: 0, it: 0, pt: 0, nl: 0 };
  for (const w of words) {
    for (const l of Object.keys(SETS) as UserLang[]) if (SETS[l].has(w)) score[l]++;
    for (const [l, re] of Object.entries(LETTERS) as Array<[UserLang, RegExp]>) if (re.test(w)) score[l] += 0.5;
  }
  const ranked = (Object.keys(score) as UserLang[]).sort((a, b) => score[b] - score[a]);
  const best = ranked[0]!;
  // Another language only when it is clearly ahead: two words more than French and English.
  if (best !== "en" && best !== "fr" && score[best] >= Math.max(score.en, score.fr) + 2) return best;
  // Otherwise exactly `detectLanguage`.
  if (score.en + score.fr < 2) return fallback;
  return score.fr >= score.en ? "fr" : "en";
}
