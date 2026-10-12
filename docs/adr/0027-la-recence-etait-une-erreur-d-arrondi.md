# ADR-0027 — La récence était une erreur d'arrondi

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : préréglages Hivey — tester de bout en bout, corriger, suivre les derniers modèles

## Contexte

Les trois préréglages (`hivey/free`, `hivey`, `hivey/smart`) ne sont pas des modèles : ce sont des
**routages**. Un fichier généré chaque jour dit, pour chaque préréglage et chaque rôle, quel modèle
répond. L'en-tête de ce fichier revendiquait quatre critères : « budget, capacité, famille d'éditeur,
**récence** ».

La récence n'existait pas.

Le terme était `1.5 * (created / newest)`, sur deux horodatages Unix. Les deux valent environ
1,79 × 10⁹, donc le rapport vaut ~0,999 pour tout le monde : mesuré sur le catalogue réel, le terme
**variait de 0,0885 entre GPT-3.5 (2023) et un modèle publié la veille**, quand un bonus d'éditeur
vaut 1,2 et le rang de prix 1,6. Ce n'était pas un critère, c'était une erreur d'arrondi portant son
nom.

Ce que ça produisait n'était pas subtil :

- `hivey` faisait tourner `claude-opus-5` (juillet, 25 $/M) alors que `claude-opus-5.5` (septembre,
  **20 $/M**) tenait dans le même budget — plus récent **et** moins cher, et il perdait.
- `hivey/smart`, le préréglage qui existe pour être le meilleur, faisait tourner `gpt-5-pro` —
  **octobre 2025, à 120 $/M** — quand `gpt-6.1-sol-pro` (septembre 2026) était disponible à
  **10 $/M**. Douze fois le prix pour un modèle d'un an plus vieux.

Le second cas a une seconde cause, plus intéressante : pour un rôle qui veut de la capacité, le prix
était lu **comme indice de capacité** (`+1.6 × rang de prix`). C'était défendable quand les nouveaux
modèles coûtaient plus cher. C'est devenu nuisible maintenant qu'une nouvelle génération est souvent
meilleure **et** moins chère : la règle préférait le passé coûteux.

Et rien de tout cela ne pouvait être attrapé, parce que les règles vivaient dans
`scripts/update-models.mjs` — un script, donc hors de portée des tests.

## Décision

**Les règles déménagent dans `src/core/router/curate.ts`**, avec quatorze tests, et le script importe
le paquet construit. C'est la raison pour laquelle le workflow quotidien fait désormais `npm ci` et
`npm run build` avant de tourner : le coût est réel et il est inférieur à celui d'une règle que
personne ne peut éprouver.

Quatre règles, et elles ne sont pas de même nature.

1. **La récence est rangée**, comme le prix l'était déjà. Un rang s'étale sur [0, 1] quelles que
   soient les unités — c'est précisément pourquoi l'échelle de prix n'a jamais eu ce défaut.

2. **Un modèle strictement périmé est retiré avant le classement.** Dans **une même gamme d'un même
   éditeur**, un modèle plus récent, pas plus cher, avec au moins autant de contexte et au moins
   autant de support d'outils remplace l'autre — et aucune pondération ne doit pouvoir le
   ressusciter. Un score est un équilibre entre choses désirables ; ceci n'est pas un équilibre,
   c'est « ne jamais payer plus pour un modèle plus vieux de la même gamme », et un filtre dit ça où
   un terme additif ne peut pas.

   ⚠️ **« Même gamme » a été appris à la dure, au premier essai.** La règle était d'abord
   « même éditeur », et Anthropic publie Opus et Sonnet en même temps, à des tailles et des prix
   différents : `claude-sonnet-5.5` est plus récent qu'`claude-opus-5.5` et deux fois moins cher,
   donc la règle a déclaré le vaisseau amiral périmé par le modèle milieu de gamme. Il ne l'est pas.
   La gamme est déduite de l'identifiant en retirant ce qui ressemble à une version ou à une taille.

3. **Le prix est lu vers le haut proportionnellement au budget du préréglage.** Un budget n'est pas
   une limite qu'on essaie d'éviter, c'est ce à quoi sert le préréglage : « le meilleur du catalogue
   sur le travail difficile » est la promesse de Pro, et une promesse qu'il ne peut pas tenir s'il
   choisit le même modèle que le préréglage moins cher.

4. **Un modèle sans prix coté est refusé** là où la règle le dit. Elle lisait `outPrice(m) > 0`, et
   `outPrice` rend `Infinity` pour une ligne non cotée : `Infinity > 0` laissait donc passer
   exactement ce que cette ligne existe pour exclure. C'était inoffensif **par accident** — le
   plafond du rôle les rejetait plus loin. Une règle qui tient parce qu'autre chose l'attrape est une
   règle qui cesse de tenir quand l'autre chose bouge.

## Ce qui est reporté plutôt que corrigé

Une fois la récence réparée, `hivey` et `hivey/smart` ont choisi **le même modèle** pour le rôle
`deep`. La marge entre ce modèle et le suivant était de **0,007 point**. À cette distance, le choix
est du bruit, et ajuster les poids jusqu'à ce que les deux préréglages diffèrent aurait été ajuster
les règles à un catalogue d'un après-midi.

La lecture honnête est plus simple : **le meilleur modèle actuel tient déjà dans le budget du
préréglage moins cher, donc le plus cher n'a rien de mieux à acheter.** C'est un fait sur le marché,
il cessera d'être vrai à la prochaine sortie d'un vaisseau amiral cher, et d'ici là le produit doit
le **dire** au lieu de prétendre à une différence qu'il ne peut pas livrer. `HIVEY_OVERLAPS`, dans le
fichier généré, nomme les rôles concernés.

## Conséquences

- Le client terminal **résout un préréglage** (`hivey` → le modèle de son rôle `deep`). Il ne le
  faisait pas : envoyer `hivey` comme identifiant de modèle donnait une erreur 400. Donc les
  préréglages ne pouvaient pas être essayés depuis le terminal, **ni mesurés** — le banc pilote ce
  client. Un tableau qui promet une ligne par préréglage et un harnais incapable d'en remplir une,
  c'est un tableau vide pour une raison invisible.
- ⚠️ **Un garde-fou est sorti de sa plage**, et c'est la conséquence la plus instructive. Les plafonds
  de dépense étaient calibrés quand le préréglage du milieu visait un modèle à 120 $/M ; en passant
  aux modèles actuels à 10 $/M — une amélioration de dix fois — le même prompt emballé de 400 000
  jetons est tombé à 80 centimes, sous un plafond de 2 $, et passait **sans question**. Un plafond en
  dollars se **desserre** à chaque baisse du marché, ce qui pour un outil dont l'argument est que
  votre code ne part pas est exactement la mauvaise direction. Il existe donc maintenant un plafond
  **en jetons** (`hiveyCode.budget.perRequestTokens`, 200 000 par défaut) : 400 000 jetons de votre
  dépôt qui partent méritent une question à n'importe quel prix. Une politique d'entreprise peut le
  resserrer, jamais le desserrer.

## Ce que ceci ne fait pas

- Il ne mesure pas la qualité des modèles choisis. C'est le travail du banc, et il a enfin les
  moyens de le faire.
- Il ne garantit pas que trois préréglages soient toujours trois choix distincts : c'est le catalogue
  qui en décide, et quand ils coïncident c'est écrit.
- La déduction de la « gamme » est une heuristique. Elle ne décide que si un modèle peut en **retirer**
  un autre d'une liste ; se tromper du côté prudent laisse les deux en lice, où le score tranche.
