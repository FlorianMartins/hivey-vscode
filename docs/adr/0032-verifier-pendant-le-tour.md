# ADR-0032 — Vérifier pendant le tour, pas seulement après

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : 4.4 — la vérification pendant, re-dérivée du code

## Contexte

Re-dérivé du code avant d'être engagé, comme la phase l'exige désormais. Deux faits, vérifiés :

1. **`if (!res.toolCalls.length) return done("answer")`** — un tour se termine **à l'instant** où le
   modèle arrête d'appeler des outils. Rien ne demande si le travail a été vérifié.
2. **`edit_file` rend `"Edited src/app.ts."`** et rien d'autre. Le modèle vient de changer un fichier
   et le seul moyen d'apprendre s'il compile encore est de **choisir** d'appeler `get_diagnostics`.

Et une moitié du chantier était déjà faite : *« une réponse qui dit ce qu'elle n'a pas vérifié »* est
livrée par la section « À savoir » (ADR-0030).

Le produit avait donc deux réponses à « ça a l'air inachevé », et les deux sont chères :
**le dire à l'utilisateur**, ou **escalader vers un modèle plus gros et facturé**. Le milieu bon
marché manquait : **demander au même modèle de finir ce qu'il a commencé.** Il en est généralement
capable — il a oublié, il n'a pas échoué.

## Décision 1 — un seul rappel, à la fin du tour

`runTurn` accepte un `selfCheck` : interrogé quand le modèle arrête d'appeler des outils, il rend un
message correctif ou rien. La **politique** vit chez l'appelant (`selfCheckMessage`, dans le routeur)
pour que la boucle reste sans opinion sur ce qui compte comme vérifié ; le **mécanisme** est dans la
boucle et il est délibérément petit.

- **Au plus un par tour.** Un second serait une discussion, et un modèle qui insiste ferait du
  plafond d'étapes le seul frein. Un seul attrape l'oubli — ce pour quoi il existe — et ne négocie
  pas.
- **Il coûte une étape.** C'est un vrai aller-retour et de l'argent réel ; un budget qui ne le
  compterait pas mentirait sur le tour.
- **La réponse prématurée est jetée.** Elle disait que c'était fini ; le modèle est sur le point de
  la remplacer, et afficher les deux se lirait comme l'assistant se contredisant à deux lignes
  d'intervalle. Ce qu'il a fait reste dans la trace, qui est l'endroit où l'on relit.
- **Le message est en forme de preuve, pas de question.** « Tu es sûr ? » invite un modèle à
  rassurer ; nommer ce qui a été observé — ces fichiers ont changé, aucun contrôle n'a tourné — ne
  laisse qu'une chose à faire. Et il ferme l'échappatoire qui serait prise : *« s'il n'y a vraiment
  rien à lancer, dis-le en une ligne et arrête-toi — n'invente pas de commande »*.

La politique ne parle que si quelque chose a **changé** et que **rien** n'a vérifié. ⚠️ « Rien n'a
vérifié » veut dire *aucun contrôle n'a tourné*, et non *aucun contrôle n'est passé* : un modèle qui
a lancé les tests et les a vus échouer a un autre problème, que `verifyTurn` escalade déjà — lui dire
de lancer un contrôle serait du bruit. Ce rappel existe pour le tour où **personne n'a regardé**.

## Décision 2 — une modification dit ce qu'elle a cassé

`edit_file` et `write_file` rapportent les **erreurs** que l'éditeur signale pour ce fichier après la
modification. Le serveur de langage tourne déjà, analyse déjà à chaque changement, et a déjà raison
sur le langage — trois choses que l'avis d'un modèle sur son propre diff ne peut pas revendiquer.

- **Les erreurs seulement.** Pas les avertissements : un avertissement est une opinion de style, et
  une modification qui en imprimerait serait du bruit à chaque tour — c'est ainsi qu'un signal
  devient du mobilier.
- **Rien quand il n'y en a pas.** Pas « aucun problème trouvé ». Un serveur de langage temporise :
  une liste vide quelques millisecondes après une modification veut dire « il n'a pas encore
  répondu » aussi souvent que « c'est bon », et ce ne sont pas la même affirmation. Le silence ne
  coûte aucun jeton et n'affirme rien — et la règle de ce projet est qu'une absence n'est jamais
  rapportée comme un zéro.
- **L'attente est bornée et se résout tôt**, au premier changement de diagnostics pour ce fichier :
  sans attente, le rapport décrit l'état *d'avant* la modification ; avec une longue, chaque
  modification paraît lente.

## Conséquences

- Le chiffre que cela doit déplacer est **`claimedDone`** — « sorti proprement, et le contrôle a
  échoué quand même » — ajouté au rapport par le chantier 4.1 précisément pour pouvoir juger
  celui-ci. La mesure du lot 4.1 → 4.3 tourne sur un build figé et sert de référence.
- Les deux moitiés posent la même question par la même règle ; un test lit les deux sources.
- Un client qui ne passe pas de `selfCheck` — un sous-agent, un appel unique — se comporte exactement
  comme avant. Le mécanisme est opt-in depuis l'appelant.

## Ce que ceci ne fait pas

- **Il ne fait pas écrire le test avant le correctif.** C'est une question de prompt, et la phase
  s'interdit d'ajuster un prompt jusqu'à ce que le banc remonte. Un rappel adossé à un fait observé
  est défendable ; une consigne de style ajustée contre une mesure ne l'est pas.
- Il ne relit pas le fichier entier après une modification. Renvoyer le contenu coûterait des jetons
  à chaque édition pour dire ce que le serveur de langage dit mieux en une ligne.
- Il ne garantit pas qu'un contrôle existe. Si le dépôt n'a rien à lancer, le modèle est explicitement
  autorisé à le dire et à s'arrêter.
