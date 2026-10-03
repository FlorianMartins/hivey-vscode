# 12. La qualité mesurée

[← Chapitre précédent](11-ibm-i.md) · [Sommaire](README.md) · [Chapitre suivant →](13-installer-et-sen-servir.md)

## Le problème : tout le monde dit être le meilleur

Chaque assistant de code annonce qu'il est excellent. Aucune de ces annonces n'est vérifiable, parce
qu'aucune ne dit sur quoi elle a été mesurée. « Plus fiable que les alternatives » est une phrase qui
a besoin d'un chiffre derrière elle, sinon c'est de la publicité.

Ce chapitre explique comment on fabrique ce chiffre, et pourquoi la partie difficile n'est pas de
mesurer mais de s'assurer que la mesure veut dire quelque chose.

## Ce qu'est un banc d'évaluation

Un **banc d'évaluation** (*benchmark*) est un jeu de tâches avec une réponse vérifiable
automatiquement. Celui de ce projet contient **56 tâches** : des petits dépôts cassés, une consigne,
et un **contrôle** — une commande qui réussit si le travail est fait et échoue sinon.

Par exemple : un petit programme qui compte des lignes, la consigne « ajoute une option `--json` », et
un contrôle qui lance le programme avec l'option et vérifie que la sortie est bien du JSON avec les
bons nombres.

L'avantage sur une impression humaine : c'est **reproductible**, et personne n'a d'opinion sur le code
de retour d'une commande.

## La partie difficile : un banc honnête dans les deux sens

Un banc peut mentir de deux façons opposées, et il faut se protéger des deux. Ce projet le vérifie
**à chaque commit**, avec deux contrôles distincts :

**1. Chaque contrôle doit échouer sur la tâche intacte.** Si le contrôle passe *avant* que le modèle
ait touché à quoi que ce soit, la tâche donne 100 % à tout le monde et ne mesure rien. Ça arrive plus
qu'on ne croit : une tâche censée être cassée ne l'était pas, parce que `round()` en Python est exact
sur un type décimal ; une autre parce que SQLite a un cas particulier pour `MAX()`.

**2. Chaque contrôle doit passer sur la solution de référence.** Le défaut symétrique : une tâche qui
ne peut **jamais** passer — une faute de frappe dans le contrôle, un compilateur absent de la
machine, une condition que la consigne n'a jamais demandée. Celle-là donne zéro à tout le monde et
devient une preuve contre les modèles plutôt que contre elle-même.

Seuls les **deux** contrôles ensemble attrapent ces cas. C'est la moitié du travail, et c'est celle
qui donne un sens au score.

Un détail amusant et instructif : certains contrôles vérifient la **structure** du code (« a-t-il
utilisé un bloc de garde ? »). Or un fichier qui s'**explique** contient les mots qu'on cherche à
interdire dans son propre commentaire. Quatre tâches ont ainsi rejeté des solutions correctes parce
que le commentaire disait ce que le code ne devait pas faire. Il existe maintenant un petit outil qui
retire les commentaires avant les contrôles structurels.

## Ce que la mesure a trouvé

Le tableau vit dans
[`eval/QUALITY.md`](https://github.com/FlorianMartins/hivey-vscode/blob/main/eval/QUALITY.md) — les
chiffres sont là, à jour, plutôt que recopiés ici où ils vieilliraient.

Mais la **forme** du résultat vaut d'être racontée, parce qu'elle est contre-intuitive.

**Le modèle local a obtenu 0 sur 56.** Et le chiffre qui explique ce zéro n'est pas le zéro : c'est
que dans **51 cas sur 56, le modèle n'a pris aucune action**. Il écrivait la modification dans un bloc
de code et demandait « souhaitez-vous que je procède ? ». Dans les cinq cas où il a agi, il n'a
**jamais** appelé d'outil d'édition.

C'est pour ça que le tableau a une colonne **« never acted »** (jamais agi). Un score seul ne dit pas
si un modèle s'est trompé ou s'il n'a jamais essayé, et ce sont deux problèmes différents : le
premier se règle avec un meilleur modèle, le second avec le client et le prompt.

**Le même banc, sur un modèle distant moderne, a renversé le résultat** : la grande majorité des
tâches réussies, aucune tâche sans action, pour environ un dollar et une vingtaine de minutes. Le
contraste n'est pas un détail : il dit qu'un petit modèle local, aujourd'hui, ne suffit pas pour du
travail d'agent — et c'est précisément le cas pour lequel le mécanisme d'escalade
([chapitre 10](10-le-cout.md)) existe.

## Et la mesure a trouvé un défaut avant de trouver un chiffre

C'est l'épisode le plus instructif du projet, et il justifie à lui seul l'existence du banc.

La première tentative de mesure a donné zéro **pour une raison qui n'était pas le modèle**. Le modèle
produisait un appel d'outil parfaitement correct, et l'écrivait **dans le texte de sa réponse** au
lieu de la case prévue par le protocole, parce que le programme qui le servait ne remplissait pas
cette case ([chapitre 4](04-comment-on-lui-parle.md)). Le client affichait donc le JSON comme une
réponse et ne modifiait rien.

Autrement dit : **le mode agent ne fonctionnait pas du tout dans la configuration par défaut du
produit**, et aucun test du comportement de l'extension ne pouvait le voir. Il a fallu essayer pour de
vrai, sur un vrai modèle, pour le découvrir.

## Les règles que ce projet s'impose sur les chiffres

Elles sont inhabituelles et elles valent d'être connues, parce qu'elles sont la raison de faire
confiance au tableau :

- **Un chiffre jamais mesuré s'affiche « non mesuré », jamais « 0 % ».** Ce ne sont pas la même chose
  et une seule des deux est un résultat.
- **Un prix inconnu s'affiche « non valorisé », jamais « 0,00 $ ».** Un modèle local n'est pas
  gratuit : il est non facturé.
- **Aucune colonne pour GitHub Copilot ni pour IBM Bob.** Non par pudeur — c'est la comparaison que
  le produit existe pour gagner — mais parce que personne ne les a exécutés **sur ces tâches, sur
  cette machine, le même jour**. Une colonne remplie depuis un chiffre publié ailleurs compare deux
  mesures différentes, et ne survivrait pas à la première question de la réunion où on la citerait.
  Le fichier écrit à la place **ce qu'il faudrait** pour en ajouter une honnêtement.

## Et ce cours, dans tout ça

Ce cours est lui-même tenu par un contrôle. L'index déclare la version du projet pour laquelle il est
à jour, et un contrôle **refuse la construction** quand cette version n'est plus celle du projet :

```bash
npm run check:course
```

C'est la seule façon qu'un document comme celui-ci ne pourrisse pas. Un document qu'on *promet* de
maintenir n'est pas maintenu ; un document dont l'obsolescence casse le build l'est. Le même
raisonnement vaut pour les chiffres cités dans les README, vérifiés par `npm run check:numbers` —
parce qu'un nombre écrit dans une phrase n'a aucune raison de suivre la chose qu'il décrit.

[← Chapitre précédent](11-ibm-i.md) · [Sommaire](README.md) · [Chapitre suivant →](13-installer-et-sen-servir.md)
