# ADR-0037 — Un 402 qui dit ce qu'il peut payer n'est pas une impasse

- **Statut** : accepté
- **Date** : 2026-10-04
- **Signalé par** : Florian — « il y a de nouveau le souci de l'erreur 402, alors qu'il y a du crédit »

## Contexte

Le symptôme était exactement celui-là : un 402 *Payment Required* alors que le compte paraît
approvisionné. Et les deux moitiés de la phrase sont vraies, ce qui est tout le problème.

Le refus d'OpenRouter dit, en entier :

```
This request requires more credits, or fewer max_tokens.
You requested up to 4096 tokens, but can only afford 1991.
To increase, visit …/keys/… and adjust the key's weekly limit
  metadata.limit_source: "openrouter_credits"
  metadata.remedy_hint:  "Add credits …, or lower max_tokens / prompt size
                          to fit your remaining balance."
```

Trois choses à en tirer, et deux défauts de notre côté.

**« Il y a du crédit » désigne le plafond de la clé, pas de l'argent.** La clé annonçait 48,42 $ de
marge sous une limite de 70 $. Ce n'est pas un solde, c'est un **plafond** : ce que la clé a le droit
de dépenser si l'argent existe. Le `limit_source` dit `openrouter_credits` — c'est le **solde du
compte** qui est épuisé. ⚠️ Et le texte d'OpenRouter conseille de **relever la limite de la clé**, ce
qui ne change rien : cette limite a été relevée deux fois pour s'en assurer.

**Et le refus porte sa propre solution** : il nomme ce qu'il peut financer. Une requête peut donc
être **refaite pour ce montant**.

## Défaut 1 — le 402 n'atteignait jamais le code qui répare

Le client possède déjà `adaptRequest`, qui reprend une requête que le serveur a rejetée pour un champ
— un `max_tokens` renommé, une température refusée. La ligne d'entrée était :

```ts
if (res.ok || res.status !== 400 || tries >= 2) return res;
```

**Seul un 400.** Donc le seul refus qui porte son propre remède était précisément celui qui
n'atteignait jamais le code des remèdes. Un compte presque vide obtenait une impasse là où une
réponse plus courte était disponible.

## Défaut 2 — et quand il y arrivait, il faisait l'inverse

Pire : la règle générique d'`adaptRequest` retire « tout champ que le serveur nomme ». Or le message
du 402 **contient les mots `max_tokens`** (« requires more credits, **or fewer max_tokens** »). Le
plafond était donc **supprimé**, et la requête rejouée **sans aucun plafond** — c'est-à-dire en
demandant une réponse illimitée au moment exact où le serveur demandait d'en demander moins. Refusée
derechef.

Deux défauts, dont l'un cachait l'autre : corriger le second ne changeait rien tant que le premier
tenait.

## Décision

**Le plafond est abaissé à ce que le fournisseur dit pouvoir financer, jamais supprimé**, et la règle
du solde est traitée **avant** la règle générique, pour que celle-ci ne puisse plus l'inverser.
`affordableTokens` lit le nombre dans le refus ; un 402 entre désormais dans l'adaptation comme un
400.

Deux bornes :

- **Un plafond déjà inférieur n'est pas touché.** Le refus porte alors sur le **prompt** et non sur
  la réponse, et rabaisser un plafond déjà plus petit prétendrait avoir réparé quelque chose.
- **Sous 256 jetons, le refus tient.** Une réponse de cent cinquante jetons n'est pas une réponse
  courte, c'est un fragment — et un fragment rendu en silence est **pire que l'erreur**, parce que le
  lecteur le prend pour l'avis du modèle.

**Et la réponse dit qu'elle a été raccourcie.** `shortenedTo` traverse le tour jusqu'à la section
« À savoir » : *« le fournisseur n'a pas financé une réponse entière, celle-ci est plafonnée à 1 991
jetons ; ajoutez du crédit si elle vous paraît coupée »*. C'est la seule phrase qui dit que c'est le
**solde**, et non le modèle, qui a décidé où la réponse s'arrêtait.

## Vérification

Éprouvé **en vrai**, sur la clé qui refusait à l'instant : la requête est refusée, relancée
automatiquement à 1 991 jetons, appelle son outil, répond juste, et affiche la mention. La même
requête rendait une impasse une minute plus tôt.

## Ce que ceci ne fait pas

- **Il n'ajoute pas de crédit.** Un solde vide reste un solde vide ; ce qui change est qu'on obtient
  une réponse tant qu'il reste de quoi en financer une, et qu'on sait pourquoi elle est courte.
- Il ne réduit pas le **prompt**. Si le refus persiste parce que c'est l'entrée qui ne tient pas, le
  message du fournisseur le dit et c'est lui qui s'affiche.
- Il ne corrige pas le conseil d'OpenRouter, qui envoie vers la limite de la clé. Le message du
  client dit maintenant lequel des deux plafonds a refusé (ADR-0036), ce qui est le mieux que nous
  puissions faire depuis ce côté.
