# ADR-0034 — DeepSeek est abandonné, et le banc a du bruit

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : 4.6 — DeepSeek v4.1, mesuré et non supposé

## Contexte

Le chantier posait une hypothèse chiffrable : `deepseek/deepseek-v4.1-flash` sait appeler des outils
et raisonner, coûte **6,7 fois moins cher en entrée et 8,3 fois en sortie** que le modèle du rôle
`deep` des deux préréglages payants, à fenêtre égale. S'il tient le score, il remplace ; s'il perd
des points, il est abandonné. **La décision a été écrite avant la mesure**, pour qu'elle ne soit pas
choisie après coup.

## La mesure

56 tâches, le même build, le même jour, les mêmes contrôles qui tranchent.

| configuration | réussi | « claimed done » | coût | par tâche |
|---|---|---|---|---|
| `hivey` (rôle `deep` = `gpt-6.1-sol-pro`) | **50/56** et **47/56** sur deux séries | 5 et 7 | 4,29 $ | 0,0766 $ |
| `deepseek-v4.1-flash` seul | **44/56** | **11** | **0,14 $** | **0,0024 $** |

## Décision — abandonné

44 sur 56 contre une fourchette observée de 47 à 50, et **plus du double d'échecs annoncés comme des
réussites** (11 contre 5 et 7). Il est sous l'intégralité de la plage mesurée du préréglage, donc la
direction tient même en tenant compte du bruit ci-dessous. **Abandonné pour le rôle `deep`.**

Il n'est pas non plus candidat au rôle `chore` : celui-ci tourne déjà sur `qwen3.7-flash` à 0,03 $ et
0,13 $ le million, **moins cher** que DeepSeek.

Le chiffre qui ne va pas dans le sens de la décision mérite d'être écrit : **33 fois moins cher pour
six tâches de moins.** Pour quelqu'un qui fait tourner un agent toute la journée sur du travail à
faible enjeu, ce rapport est défendable. Ce n'est pas la promesse du rôle `deep`, et réécrire la
promesse pour faire gagner le résultat qu'on vient de mesurer est précisément ce que cette phase
s'interdit.

## ⚠️⚠️ Ce que la remesure a révélé, et qui compte plus que DeepSeek

**Trois séries du même préréglage, sur les mêmes tâches, avec le même build, ont donné 48, 47 et
50 réussites.** Un écart de trois tâches sans que rien ne change entre les séries.

Conséquence : **une différence inférieure à cet écart n'est pas un résultat.** Le « 5 points » que
j'avais annoncé entre DeepSeek et le préréglage était à l'intérieur du bruit que je n'avais pas
mesuré ; la conclusion tient parce que 44 est sous *toute* la plage, pas parce que 79 % et 84 % sont
deux nombres différents.

Le tableau le dit maintenant lui-même : quand plusieurs séries d'une même configuration sont
fournies, il imprime leurs scores et leur écart, et la phrase qui en découle. **Rapporté plutôt que
moyenné** — une moyenne cache l'écart, et l'écart est ce qui dit ce que le pourcentage vaut.

C'est le genre de chiffre qu'un banc doit publier sur lui-même avant de publier quoi que ce soit sur
les modèles.

## Et le verdict sur le chantier 4.4

Le rappel de vérification a été instrumenté pour pouvoir le juger. Résultat : **déclenché 0 fois sur
56**, et l'explication est mesurée plutôt que supposée — **51 tâches sur 56 ont changé quelque chose,
et dans les 51 un contrôle a tourné.** La précondition du rappel (ça a changé, rien n'a vérifié) n'a
donc **jamais** été remplie : 0 occasion sur 51.

4.4 n'est donc pas réfuté, il est **non éprouvé par ce banc** — et la raison est structurelle : les
tâches de ce banc demandent un résultat vérifiable, donc le modèle lance un contrôle de lui-même. La
population que 4.4 visait — « change ça », sans demander de preuve — n'y est pas représentée.

Le mécanisme est **gardé**, et son état est écrit : non mesuré. La règle de la phase disait d'annuler
un chantier qui n'améliore pas le chiffre ; elle visait un chantier qui a eu sa chance et n'a rien
donné, et celui-ci n'a pas eu d'occasion. Ce qui le mesurerait est une famille de tâches dont la
consigne ne demande **pas** de vérifier — à ajouter au banc, et c'est une autre décision.

## Ce que ceci ne fait pas

- Il ne mesure DeepSeek qu'**une fois**. Compte tenu de l'écart mesuré, une seule série ne pourrait
  pas établir un écart de deux ou trois tâches ; elle suffit ici parce que l'écart est de six et que
  44 est sous toute la plage observée.
- Il ne dit rien des autres rôles ni des autres préréglages : `hivey/free` et `hivey/smart` restent
  **non mesurés** et le tableau l'affiche.
- Il ne corrige pas la variance. Un banc de 56 tâches dont trois basculent d'une série à l'autre est
  ce qu'il est ; ce qui change est qu'on le sait et que le document le dit.
