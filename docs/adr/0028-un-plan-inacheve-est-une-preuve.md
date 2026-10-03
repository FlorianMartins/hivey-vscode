# ADR-0028 — Un plan inachevé est une preuve, et un refus n'est pas un échec

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : 4.1 — le plan devient une preuve, et devient mesurable

## Contexte

La phase 4 commence par le plan de l'agent. La première rédaction du chantier disait que « la boucle
est sans mémoire de son propre plan ». **C'était faux**, et je l'avais écrit sans vérifier :
`src/core/agent/plan.ts` existe depuis longtemps, avec l'analyse de ce que le modèle envoie, la règle
« une seule étape en cours », le résumé et l'affichage dans le panneau. J'ai même commencé par
**écraser ce fichier** avant de m'en apercevoir.

Ce qui manquait est ailleurs, et l'en-tête du fichier le disait lui-même : *« le plan n'est pas une
technique de prompt et il n'est pas pour le bénéfice du modèle ; c'est un affichage de progression »*.

Deux lacunes, donc :

1. **Un plan inachevé n'était pas une preuve.** Un tour qui se termine en laissant des étapes de son
   **propre** plan ouvertes est un tour qui s'est déclaré fini contre sa propre liste. C'est exactement
   la forme de preuve sur laquelle l'escalade dépense de l'argent (ADR-0009), et rien ne la lisait.
2. **Le client terminal n'avait pas l'outil**, pour une raison écrite dans le code : *« un outil que
   rien n'affiche dépense des jetons pour rien »*. Vraie tant que le plan n'était qu'un affichage.
   Fausse dès qu'il devient une preuve — et surtout : le banc d'évaluation pilote ce client, donc il
   ne pouvait **rien mesurer** du plan, ce qui rend la règle « on mesure avant et après » inapplicable.

## Décision

**`planVerdict(plan)` existe, et `verifyTurn(steps, plan)` le lit — en dernier.**

L'ordre compte : un contrôle qui échoue est une preuve concrète **sur le code** ; un plan inachevé est
le récit que le modèle fait de lui-même, ce qui est plus faible. Le plan ne parle donc que si rien de
plus dur n'a parlé. Il reste une preuve : c'est le signal le moins cher qui existe pour dire que le
travail n'est pas fini.

**Prudence symétrique à `verifyTurn` : l'absence de plan n'est pas un échec.** Beaucoup de bons tours
n'en ont pas besoin, et traiter leur absence comme une faute escaladerait chaque réponse courte —
l'erreur même de l'ancien routage par mots-clés. Une étape `skipped` compte comme réglée : le modèle
a décidé qu'elle ne servait pas, et un plan qu'on ne pourrait que terminer serait un plan sur lequel
personne ne peut changer d'avis.

Le terminal offre l'outil, l'imprime, et **atteint le même verdict**.

## Et ce que la mesure a trouvé, qui est plus important que le chantier

En lançant la mesure, les onze premières tâches ont réussi, puis **les quarante-deux suivantes ont
échoué sans produire un seul tour**.

La cause n'était pas le modèle et n'était pas le plan : **le plafond de dépense quotidien du client
terminal**. Il code en dur `perRequestUsd: 0.25` et `dailyUsd: 2`, alors que les valeurs livrées à
l'éditeur sont **2** et **20**. Le même produit refusait donc dans le terminal ce qu'il autorisait
dans le panneau, d'un facteur dix.

⚠️⚠️ **Et c'est le défaut que ce projet avait déjà corrigé une fois.** Le `CHANGELOG` le raconte pour
le panneau : un plafond quotidien de 2 $ refusait la huitième question de la journée, *silencieusement*,
« donc ce que l'utilisateur voyait était une extension qui avait cessé de fonctionner sans raison ».
Le panneau a été relevé à 20 $. **Le terminal a gardé les anciens chiffres.** C'est exactement ce que
l'en-tête de `src/cli/env.ts` met en garde contre : *« les deux moitiés en désaccord en silence »*.
Les limites livrées vivent maintenant à **un seul endroit** (`SHIPPED_LIMITS`), un test vérifie que
`package.json` dit la même chose, et un test lit le source du terminal pour refuser qu'il les
retape.

⚠️⚠️⚠️ **Mais le pire n'est pas le plafond, c'est ce que le relevé en a fait.** Dans les résultats, une
tâche **refusée avant de commencer** était indiscernable d'une tâche **que le modèle a ratée**.
Quarante-deux refus sont devenus quarante-deux échecs apparents, et un taux de réussite calculé
là-dessus aurait été publié comme une mesure. C'est précisément l'erreur que tout le travail de la
phase 3 existe pour empêcher.

Donc : le client **enregistre** le refus dans le rapport de tour, le rapport les compte, et — c'est la
règle qui compte — **un jeu qui contient un seul refus n'énonce aucun taux**. La colonne de qualité
affiche « *n* refused — no rate » au lieu d'un pourcentage. Absent plutôt que faux, comme partout
ailleurs ici.

## Conséquences

- Le rapport gagne deux chiffres : **`claimedDone`** (le tour est sorti proprement et le contrôle a
  échoué quand même — l'écart entre « le modèle dit que c'est fini » et « le contrôle passe », que le
  chantier 4.1 promettait de mesurer) et **`planLeft`** (des tours qui ont laissé leurs propres étapes
  ouvertes). `planLeft` est **absent** quand il n'y a pas eu de plan, ce qui n'est pas zéro : compter 0
  pour un tour qui n'a jamais planifié, c'est compter une discipline que personne n'a exercée.
- Le tableau publie `claimed done` à côté du score, parce qu'un modèle qui échoue bruyamment coûte un
  tour, et qu'un modèle qui échoue en annonçant une réussite coûte la confiance qui rend l'outil
  utilisable.
- ⚠️ Les identifiants de préréglage du tableau étaient **faux depuis une semaine** : il listait
  `hivey/balanced` et `hivey/pro`, qui n'existent nulle part dans le produit (ce sont `hivey` et
  `hivey/smart`). Un tableau qui nomme des configurations que personne ne peut choisir est un tableau
  qu'on ne peut pas reproduire.

## Ce que ceci ne fait pas

- **Il ne rend pas l'agent plus intelligent.** Il rend son inachèvement visible et coûteux, ce qui
  n'est pas la même chose.
- Il ne corrige pas une deuxième divergence trouvée au passage et laissée pour plus tard : le client
  terminal fixe son budget de contexte à **8 000 jetons en dur**, alors que le panneau suit la fenêtre
  du modèle réellement choisi — et le `CHANGELOG` dit que ce nombre fixe était le défaut. C'est la
  même histoire que les plafonds, dans la même moitié oubliée. Noté dans la feuille de route.
