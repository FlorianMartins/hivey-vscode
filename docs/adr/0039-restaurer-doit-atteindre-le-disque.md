# 0039 — Restaurer doit atteindre le disque, et un checkpoint doit dire ce qu'il ne tient pas

**Statut** : accepté · **Date** : 2026-10-05

## Contexte

Florian : « il y a un très gros soucis sur les resultats, il a crée 76 problemes sur du CSS, il y a
une très grosse anomalie et le restore to checkpiint ne semble pas revert le code », puis « sur le
premier message d'une conversation il n'y a pas de reverse poossible ».

Quatre défauts distincts, et le premier est la pire forme qu'un défaut puisse prendre ici : **l'écran
affirmait que ça avait marché**.

## 1. La restauration n'atteignait jamais le disque

Un `WorkspaceEdit` écrit dans le **document en mémoire** de l'éditeur, pas dans le fichier. La
restauration remettait donc l'ancien contenu à l'écran pendant que chaque fichier sur le disque
gardait la version de l'agent.

Tout ce qui n'est pas l'éditeur lit le fichier : le compilateur, un observateur qui reconstruit une
feuille de style, git, la commande shell suivante. Et fermer la fenêtre sans enregistrer perdait la
restauration entièrement.

⚠️ Le raisonnement d'origine — passer par un `WorkspaceEdit` pour que `Ctrl+Z` annule la restauration —
était bon et **incomplet**. Enregistrer ne casse pas la pile d'annulation : `Ctrl+Z` fonctionne
toujours, il faut simplement enregistrer à nouveau. L'alternative, s'en remettre au réglage
`files.refactoring.autoSave` de l'utilisateur, rend une opération de **récupération** correcte
seulement pour certains réglages.

## 2. Les édits de l'agent ne l'atteignaient pas non plus

Le même défaut, un cran plus grave en mode agent : `edit_file` puis `run_command npm test` **notait le
modèle sur du code qu'il n'avait pas écrit**. Il « corrigeait » ce qui n'était pas cassé, et
recommençait.

⚠️⚠️ Le test d'intégration affirmait `doc.getText()` — le **tampon** — et jamais le disque. C'est
exactement pour cette raison que le défaut a été livré. La règle qui en sort : *quand une opération
traverse une frontière (mémoire → disque, processus → processus), l'assertion doit être prise de
l'autre côté de la frontière.* Vérifié : le test échoue sans le correctif.

## 3. Aucune conversation ne pouvait annuler son premier tour

Le bouton de restauration était accroché à la **ligne de séparation entre deux tours**, et cette ligne
n'est pas dessinée au-dessus de la première question — à juste titre, il n'y a rien à séparer. Le
retour partait avec elle.

Or le premier tour est celui où l'agent travaille sur un dépôt intact, donc **celui qu'on a le plus de
raisons d'annuler**. Deux décisions étaient confondues en une condition ; ce sont maintenant deux
champs (`turnBoundary`), et un rendu ne peut plus en perdre une en perdant l'autre.

## 4. Un checkpoint ne tient pas ce qu'une commande a fait

Un checkpoint est construit dans `confirmEdit`, au moment où l'utilisateur approuve une édition : il
tient donc exactement ce que les **outils d'édition** ont touché. Une commande est opaque —
`prettier --write`, `sed -i`, un codemod, un build qui régénère une feuille de style réécrivent des
fichiers que personne n'a photographiés, parce que rien ne savait lesquels avant qu'elle tourne.

La boîte de dialogue affirmait pourtant « 2 fichier(s) reviennent à leur état d'origine » — ou, pire,
sur un tour dont les seules écritures venaient d'une commande : « ce tour n'a changé aucun fichier,
rien ne bouge sur le disque ». Les deux sont faux dans la direction qui coûte du travail.

Le nombre de commandes est désormais retenu et **dit avant que le bouton soit pressé**.

## Conséquences

On ne peut pas rendre un checkpoint complet sans photographier le dépôt entier avant chaque commande,
ce qui est hors de proportion. Ce qui est tenable, et qui est la règle de ce projet, est de **dire ce
qui ne reviendra pas**. Un retour en arrière qui laisse en place le travail d'un formateur sans le
signaler remet le dépôt dans un état où il n'a **jamais** été, ce qui est pire que de ne pas proposer
de retour du tout.
