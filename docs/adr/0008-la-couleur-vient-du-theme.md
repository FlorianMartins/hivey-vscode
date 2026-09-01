# ADR-0008 — La couleur d'une réponse vient du thème, jamais de nous

**Date** : 2026-09-01 · **Statut** : accepté

## Contexte

Une réponse d'assistant de code est faite à 60 % de code. Rendue en une seule couleur, elle se lit
mot à mot ; il n'y a aucun moyen de repérer d'un coup d'œil la ligne qui compte. Il fallait donc
colorer la syntaxe.

Les deux solutions habituelles étaient exclues :

- **Embarquer un moteur de grammaire** (TextMate, Shiki) contredit
  [ADR-0004](0004-zero-dependance-a-l-execution.md) : quelques centaines de kilo-octets de règles
  dans une extension dont l'argument de vente est qu'une entreprise peut la relire avant de
  l'installer.
- **Coder une palette en dur** est juste sur un thème et faux sur les plusieurs centaines d'autres.

## Décision

**Un analyseur lexical écrit à la main, et pas une seule couleur à nous.**

L'analyseur ne connaît pas des langages mais des **familles** : ce qui distingue C de Rust à cette
résolution, c'est la liste des mots-clés, donc c'est la seule chose que la table contient. Un tag de
langage inconnu ne produit aucune couleur — jamais une supposition.

Un invariant gouverne le fichier et il est vérifié sur chaque langage et chaque entrée tordue :
**la concaténation des jetons reproduit l'entrée, caractère pour caractère**. Un coloriseur qui
avale une contre-oblique ou la fin d'une chaîne non terminée corrompt du code que l'utilisateur
s'apprête à coller dans son dépôt. C'est un échec bien pire, et silencieux, qu'un mot-clé rendu dans
la couleur ordinaire.

Chaque type de jeton pointe vers une **variable de thème de VS Code**. Le panneau est amarré à côté
de l'arborescence des fichiers : un extrait doit s'y lire exactement comme deux panneaux plus loin,
sur le thème clair de l'utilisateur comme sur son thème à contraste élevé, sans que ce fichier sache
lequel est installé.

### Le piège, qui a coûté une itération

`symbolIcon.keywordForeground` semble être le jeton évident pour un mot-clé. Il est enregistré comme
un **alias de la couleur de premier plan** : les mots-clés sortaient donc de la même couleur que le
texte autour. La variable existait, la règle CSS était valide, et le repli n'a jamais été employé —
un repli ne sert que si la variable est *absente*, pas si elle est *fade*.

Le bon jeton est `debugTokenExpression.name`, qui porte le violet mot-clé du plan de travail
(`#c586c0` en sombre, `#9b46b0` en clair) et retombe sur le premier plan en contraste élevé, ce qui
est précisément ce que le contraste élevé demande.

**Règle à retenir : une variable qui existe n'est pas une variable qui porte une couleur.** On la
vérifie sur une capture, pas dans la documentation.

## Conséquences

Le rendu s'applique **pendant** le flux, pas à la fin. Le panneau montrait le markdown brut le temps
de la réponse puis le remplaçait par sa version formatée : chaque réponse était lue deux fois, et la
réécriture finale déplaçait le texte sous les yeux du lecteur. Le rendu à la volée est limité à une
image par rafraîchissement d'écran et suspendu tant qu'une sélection est en cours dans la réponse —
remplacer les nœuds sous une sélection la détruit, et quelqu'un qui sélectionne du texte en cours de
réponse s'apprête à le copier.
