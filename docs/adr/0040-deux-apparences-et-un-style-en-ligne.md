# 0040 — Deux apparences, et le style en ligne qui décide

**Statut** : accepté · **Date** : 2026-10-05

## Contexte

Florian : « je voudrais que tu refasse le design complet de l'application pour un UI vraiment
moderne/futuriste et pro ».

La demande entre en tension avec une décision que le projet a déjà prise et écrite : *« la carte
appartient maintenant à l'éditeur dans lequel elle vit, plutôt qu'à nous »*. Un panneau ancré à côté
de l'arborescence et du terminal qui ignore le thème de l'utilisateur se lit comme un corps étranger.

Les deux positions sont défendables, et annuler la première en silence serait le vrai défaut.

## Décision

**Deux apparences, un réglage, et le thème de l'éditeur par défaut.** `hiveyCode.appearance` vaut
`editor` (emprunter le thème) ou `hivey` (base bleu-noir profonde, ambre en accent, cyan pour les
liens). Florian juge l'identité futuriste sur son écran et garde celle qu'il préfère ; personne ne
perd le comportement sur lequel il comptait.

## ⚠️⚠️ Comment c'est implémenté, et le défaut qui l'a décidé

VS Code remet son thème au panneau sous forme de **propriétés personnalisées** —
`--vscode-foreground`, `--vscode-focusBorder`, et 274 autres références dans la feuille de style. Une
propriété personnalisée est une variable : un sélecteur peut donc la **redéfinir**, et les 276 points
d'appel se résolvent vers la nouvelle palette **sans qu'une seule ligne de la feuille soit modifiée**.

L'alternative — introduire `--fg`, `--bg`, `--accent` et réécrire 276 sites — est la réponse de
manuel, et c'était un diff de 4 000 lignes pour arriver au même endroit, avec autant d'occasions de se
tromper de couleur.

Sauf que la première version a échoué, et la façon dont elle a échoué est la leçon : **VS Code
n'injecte pas le thème dans une feuille de style, il l'écrit en style EN LIGNE sur l'élément
racine**. Un style en ligne bat tous les sélecteurs. Un sélecteur plus spécifique était donc la bonne
réponse théorique et une défaite par construction.

Ça n'a pas été trouvé en lisant la spécification : **la capture est revenue identique au pixel près**
à celle du thème de l'éditeur. D'où la règle, qui vaut au-delà du CSS : *une apparence décrite en
prose est une apparence que personne ne peut vérifier.* Le script de capture photographie maintenant
les deux.

`!important` sur une déclaration bat bien un style en ligne, et c'est la seule chose qui le fasse.
C'est pourquoi chaque ligne de ce bloc en porte un, et pourquoi le commentaire au-dessus l'explique :
sans la raison, quelqu'un le nettoiera.

## Le reste de la refonte

Trois changements mesurés sur une capture du vrai panneau plutôt que décidés à l'estime :

- **L'envoi devient plein dès qu'il y a quelque chose à envoyer.** La raison écrite à côté — *« le
  bouton d'envoi est spécial : un barre d'outils le dit par la position, pas par la peinture »* — est
  juste sur une zone de saisie **vide** et fausse sur une pleine. Sur l'image, six icônes fantômes en
  rang, la dernière étant la seule qui compte. L'emphase est de l'**information** (« ceci va faire
  quelque chose maintenant »), pas de la décoration : une zone vide est inchangée.
- **Le rythme vertical entre deux tours.** 16 px de marge de réponse, 16 de règle et 12 de question
  s'empilaient : 44 px de rien dans une colonne de 280 px dont le sujet est une conversation. La
  règle portait déjà la séparation ; les marges la disaient trois fois.
- **La liste d'étapes d'un tour fini se replie** au-delà de six, avec un résumé qui dit ce qu'il y a
  dedans (`9 étapes · 3 commandes · 1 modification`) — parce qu'un en-tête qui dit seulement « 9
  étapes » ne dit pas s'il faut l'ouvrir. ⚠️ **Un tour contenant un échec reste déplié** : c'est
  précisément celui dont le détail est le sujet.
