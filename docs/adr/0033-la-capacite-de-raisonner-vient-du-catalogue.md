# ADR-0033 — La capacité de raisonner vient du catalogue, pas d'une liste de versions

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : 4.5 — le raisonnement suit les derniers modèles, re-dérivé du code

## Contexte

Le projet énonce un invariant : **aucune version de modèle ni aucun prix n'est écrit en dur.** Il est
tenu pour les prix, pour les fenêtres de contexte et pour les préréglages, par un catalogue
régénéré chaque jour.

Il ne l'était pas pour la capacité de raisonner. `extension/models.ts` contenait :

```
/o[134]|gpt-5|claude|sonnet|opus|haiku|fable|deepseek|qwen3|reason|think|magistral|grok-[34]|gemini-[23]/i
```

Et cette expression a pourri exactement comme une version écrite en source pourrit toujours : elle
reconnaît `gpt-5`, et le marché est passé à `gpt-6`.

Conséquence, vérifiée sur le catalogue du jour : **`openai/gpt-6.1-sol-pro` — le modèle vers lequel
les *deux* préréglages payants envoient le travail approfondi — était déclaré incapable de
raisonner.** Et comme ce drapeau commande l'affichage même du contrôle de budget de réflexion,
**l'utilisateur ne pouvait pas activer la réflexion sur le modèle le plus fort du produit.**
`poolside/laguna-s-2.1`, le modèle de complétion des deux mêmes préréglages, était dans le même cas.
OpenRouter, lui, annonce `reasoning: true` pour les deux.

## Décision

**Le catalogue répond.** Le générateur relève `supported_parameters` et écrit `GENERATED_REASONING`
exactement comme il écrit déjà `GENERATED_VISION` — 327 modèles sur 454 le jour où ceci est écrit —
et le fichier est régénéré par le même workflow quotidien que les prix.

**Le repli reste, et ne nomme aucune version.** Il doit rester : le catalogue ne peut pas répondre
pour un modèle qu'aucune passerelle ne liste, et un runtime local servant `qwen3-coder` est
précisément ce cas — une réponse purement catalogue couperait la réflexion de **tous** les modèles
locaux d'un coup. Mais le repli ne retient que des **familles d'éditeur**, stables pour des années,
et les deux mots qui décrivent la capacité elle-même. Un repli qui nommerait des versions serait ce
même défaut, un étage plus bas ; un test lit son source et refuse qu'il contienne un chiffre.

## Ce que ce chantier n'avait pas besoin de faire

Sa rédaction demandait aussi que **le niveau** de réflexion soit choisi d'après ce que le modèle sait
faire. Re-dérivé du code, il n'y a rien à corriger :

- La traduction par fournisseur est déjà juste et déjà sans version : `reasoning: { effort }` chez
  OpenRouter, `reasoning_effort` sur l'API d'OpenAI, un budget de jetons chez Anthropic.
- L'interaction délicate est déjà traitée, avec son commentaire : Anthropic refuse
  `max_tokens <= budget_tokens`, et la réponse doit tenir **après** la réflexion.
- Et il n'y a rien à adapter au-delà du oui/non : la capacité que le catalogue publie est **binaire**.
  « Choisir le niveau d'après le modèle » n'a pas de matière.

C'est la **quatrième fois sur cinq** dans cette phase qu'un chantier avait été rédigé depuis une
hypothèse plutôt que depuis le code. La partie fausse est consignée ici plutôt que silencieusement
abandonnée.

## Conséquences

- Un test exige que **chaque modèle vers lequel un préréglage payant envoie le travail approfondi**
  puisse raisonner. C'est le défaut énoncé comme la chose qu'il cassait : un préréglage qui confie le
  travail difficile à un modèle que le produit croit incapable de penser cache le contrôle là
  précisément où il compte.
- La règle vit dans le cœur (`core/router/reasoning.ts`), donc le client terminal pourra poser la
  même question le jour où il offrira ce contrôle.
- Les trois tests tombent si l'on rétablit l'ancienne expression.

## Ce que ceci ne fait pas

- Il ne choisit pas le niveau à la place de l'utilisateur. La réflexion coûte des jetons, et le
  budget est une décision qui lui appartient.
- Il ne devine pas la granularité acceptée par un modèle : le catalogue ne la publie pas, et
  l'inventer serait exactement ce que ce fichier existe pour arrêter.
