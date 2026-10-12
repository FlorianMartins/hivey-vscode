# ADR-0036 — Ce que le gratuit donne, et ce qu'un centime achète

- **Statut** : accepté
- **Date** : 2026-10-04
- **Chantier** : finir la mesure avec ce que le crédit permettait

## Contexte

Le préréglage `hivey` n'a pas pu être remesuré : le solde de crédit du compte OpenRouter ne finance
plus une requête de la taille d'un tour d'agent sur un modèle à un million de jetons
(`limit_source: openrouter_credits` — relever le plafond de la clé n'y change rien, et il l'a été
deux fois pour s'en assurer).

Restaient deux configurations que le crédit permettait, et toutes deux remplissent une ligne que le
tableau laissait vide depuis le début.

## La mesure

62 tâches, consignes corrigées, **aucun refus**, les deux séries comparables entre elles.

| configuration | réussi | annoncé fini à tort | jamais agi | coût |
|---|---|---|---|---|
| `remote only` — `qwen3.7-flash` | **45/62** (73 %) | 17 | 0 | **0,043 $** — 0,0007 $/tâche |
| `hivey/free` — `nemotron-3.5-lightning:free` | **32/62** (52 %) | 27 | 3 | **0,00 $** |

Deux choses qui méritent d'être dites dans cet ordre.

**Le gratuit fait la moitié du banc, pour rien.** 32 tâches sur 62 sans un centime et sans clé
payante. C'est un chiffre que ce produit peut montrer : il ne dit pas que le gratuit suffit, il dit
où il s'arrête.

**Et un modèle payant bon marché fait 73 % pour quatre centimes sur 62 tâches** — 0,0007 $ la tâche.
Le préréglage `hivey` fait 89 % à 0,0766 $ la tâche, soit **cent fois plus cher pour seize points**.
⚠️ Les deux ne sont pas strictement comparables : la ligne `hivey` a été mesurée sur 56 tâches, avant
la réparation de trois consignes. L'ordre de grandeur, lui, ne dépend pas de ces trois tâches.

## ⚠️⚠️ Et le chantier 4.4 est confirmé à l'échelle

Le rappel « tu as changé quelque chose et rien n'a vérifié » s'est déclenché :

- **23 fois sur 62** avec `qwen3.7-flash`,
- **15 fois sur 62** avec le préréglage gratuit,
- **0 fois sur 56** avec `gpt-6.1-sol-pro`.

L'ADR-0035 l'avait établi sur six tâches construites exprès ; c'est maintenant mesuré sur le banc
entier, sans tâches faites pour l'occasion. **Entre un quart et un tiers des tours d'un modèle bon
marché se terminent sur un changement que rien n'a vérifié** — et aucun de ceux d'un modèle fort.

C'est la justification que ce chantier cherchait depuis deux jours, et elle dit précisément ce que le
mécanisme est : **pas un filet pour le banc, un filet pour les modèles que ce produit existe pour
rendre utilisables.** Le modèle cher n'en a pas besoin. C'est le modèle à quatre centimes qui en vit.

## Conséquences

- Le tableau porte quatre lignes mesurées et nomme, ligne par ligne, lesquelles sont comparables.
  Les deux dernières le sont entre elles ; les deux premières datent d'avant la réparation des
  consignes et le disent.
- `local only`, `local + escalation` et `hivey/smart` restent **non mesurés** et l'affichent.

## Ce que ceci ne fait pas

- Il ne remesure pas `hivey`. Il faut du crédit sur le compte, pas un plafond de clé plus haut.
- Il ne compare pas `remote only` et `hivey` à armes égales, et le tableau le dit plutôt que de
  laisser le lecteur conclure.
- Il ne mesure chaque configuration qu'**une fois**. L'écart mesuré entre deux séries identiques est
  de trois tâches ; un écart de seize points le dépasse largement, un écart de trois non.
