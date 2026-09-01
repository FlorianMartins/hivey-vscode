# ADR-0007 — Compacter plutôt que tronquer

**Date** : 2026-09-01 · **Statut** : accepté

## Contexte

[ADR-0003](0003-le-transcript-n-est-pas-le-prompt.md) pose que le transcript appartient à
l'utilisateur et que le prompt en est *dérivé* à chaque tour. Restait un cas que cette dérivation
traite mal : la conversation longue.

Quand le budget de contexte est atteint, `Session.build` écarte les échanges les plus anciens. C'est
correct et c'est brutal — ce qui disparaît, ce sont précisément les décisions prises au début, celles
que la suite du travail présuppose. L'utilisateur ne voit rien : le transcript est intact à l'écran,
le modèle, lui, a perdu le début. Il répond alors à côté sans que personne puisse dire pourquoi.

Les deux échappatoires existantes ne suffisent pas. Épingler un échange demande de savoir à l'avance
lequel comptera. Ouvrir une nouvelle conversation abandonne tout.

## Décision

**Un résumé écrit par le modèle remplace les échanges dans le prompt, et ne supprime rien de
l'écran.**

L'opération réutilise le mécanisme qui existe déjà plutôt que d'en ajouter un : compacter, c'est
ajouter un message et *rendre muets* ceux qu'il couvre. Rendre muet est déjà « visible à l'écran,
absent du prompt ». Il n'y a donc pas de nouvel état à comprendre, pas de suppression, et le geste
est réversible échange par échange avec le bouton qui était déjà là.

Trois conséquences en découlent, et chacune a été payée par un défaut :

1. **Le résumé est épinglé.** Il devient le message le plus ancien dès la question suivante, donc le
   premier candidat à la troncature. Un résumé que la troncature emporte ne sert à rien.

2. **L'ordre est : rendre muet d'abord, ajouter ensuite.** L'ordre inverse rend le résumé muet avec
   les autres, puisqu'à ce moment-là il fait partie des messages que la boucle parcourt.

3. **La consigne impose une densité.** Un modèle à qui l'on demande « résume » rend volontiers les
   deux tiers de ce qu'on lui a donné : l'opération coûte une requête et ne libère rien. La consigne
   fixe donc une cible explicite — moins d'un cinquième — et énumère ce que le tour suivant a besoin
   de retrouver : décisions, impasses écartées, noms exacts, prochaine étape.

Le gain est **mesuré et affiché** (`8 200 → 900 jetons`), pas affirmé. « Compacté » dit qu'une
opération a eu lieu ; le seul renseignement exploitable est de savoir si elle valait la requête.

## La proposition

Le compactage est proposé à **deux tiers** du budget, jamais en dessous d'un plancher de quelques
milliers de jetons ni sous quatre échanges. Trop tôt, c'est du bruit ; à la limite, c'est trop tard —
la troncature silencieuse a déjà eu lieu. Sur un petit budget, quatre échanges franchissent les deux
tiers, et personne ne veut qu'on lui propose de résumer quatre échanges.

Refuser la proposition mémorise la **taille** à laquelle elle a été refusée, pas le fait du refus :
elle revient quand la conversation a grossi d'un tiers de plus. « Plus jamais dans cette
conversation » serait un contresens, puisque c'est justement la croissance qui pose le problème.

## Conséquences

Le compactage n'a demandé **aucune migration ni aucun nouvel état persistant** : le schéma d'une
session le permettait déjà, ce qui est le signe que l'abstraction d'ADR-0003 était la bonne.

Il coûte une requête, passe par la même barrière de sortie et le même budget que n'importe quelle
autre — un résumé sort de la machine comme le reste — et s'exécute **sans outils** : un tour qui
parle de la conversation n'a pas à pouvoir aller lire des fichiers, sinon il peut inventer une
matière dont personne n'a discuté.
