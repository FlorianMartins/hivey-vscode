# 1. Le décor

[← Sommaire](README.md) · [Chapitre suivant →](02-le-modele.md)

Avant de parler d'intelligence artificielle, il faut trois mots de vocabulaire. Si vous les avez
déjà, sautez au [chapitre 2](02-le-modele.md).

## Le code, c'est du texte

Un logiciel — un site web, une application de téléphone, le programme qui calcule votre paie — est
écrit sous forme de **texte**, dans des fichiers. Pas d'images, pas de schémas : des lignes de texte,
dans un langage très strict. Voici un programme complet :

```
console.log("Bonjour")
```

Cette ligne, écrite dans un langage qui s'appelle **JavaScript**, affiche le mot « Bonjour ». C'est
tout. Un logiciel réel, c'est la même chose, en centaines de milliers de lignes réparties en
milliers de fichiers.

Conséquence importante pour la suite : **un assistant qui écrit du code écrit du texte**. C'est
pour ça qu'un modèle d'intelligence artificielle entraîné sur du texte peut le faire. Et c'est aussi
pour ça que votre code peut partir sur Internet aussi facilement qu'un message : c'est du texte.

## L'éditeur de code, et VS Code

Un **éditeur de code** est le traitement de texte des développeurs. Il ressemble à Word, en moins
joli et en beaucoup plus utile pour cet usage : il colore le code pour qu'on s'y repère, il signale
les fautes pendant la frappe, il sait chercher dans dix mille fichiers.

**VS Code** (de son vrai nom *Visual Studio Code*) est l'éditeur le plus utilisé au monde. Il est
gratuit, fait par Microsoft. Deux choses à en retenir :

- Il a une **barre latérale** — une colonne sur le côté, où des outils viennent s'installer. C'est là
  que Hivey Code apparaît.
- Il a un **terminal** intégré : une zone noire où l'on tape des commandes, une par ligne. C'est
  l'autre façon de piloter un ordinateur, celle d'avant les fenêtres. Elle n'a pas disparu parce
  qu'elle est plus rapide et qu'elle s'automatise.

Il existe des variantes de VS Code faites par d'autres : **VSCodium** (le même, sans les morceaux
propriétaires de Microsoft), **Cursor** (le même, avec de l'IA intégrée). Hivey Code fonctionne dans
toutes.

## L'extension

Une **extension** est un module que l'on ajoute à l'éditeur pour lui apprendre quelque chose de
nouveau. Comme une extension dans un navigateur web : un bloqueur de publicité ajoute une capacité à
Firefox sans que Firefox ait été modifié.

**Hivey Code est une extension de VS Code.** Elle ajoute un assistant : un panneau où l'on discute,
des propositions pendant la frappe, et la capacité de modifier des fichiers si on le lui demande.

Une extension se livre sous forme d'un fichier qui finit par **`.vsix`**. C'est une archive — une
boîte, comme un `.zip` — qui contient le programme de l'extension, ses images, et sa documentation.
L'éditeur sait l'ouvrir et l'installer. On verra au [chapitre 13](13-installer-et-sen-servir.md)
comment faire.

## Le dépôt, le commit, la branche

Quand plusieurs personnes écrivent le même logiciel, il faut savoir qui a changé quoi, et pouvoir
revenir en arrière. C'est le rôle d'un outil appelé **Git**.

- Un **dépôt** (*repository*, souvent abrégé *repo*) est le dossier du projet, plus **tout son
  historique** depuis la première ligne écrite.
- Un **commit** est un instantané : « voilà l'état du projet à cet instant, et voilà pourquoi j'ai
  fait ce changement ». Chaque commit a un message. Les messages de ce projet sont en anglais ; son
  journal des modifications et ses décisions sont en français.
- Une **branche** est une ligne de travail parallèle. On en crée une pour essayer quelque chose sans
  déranger la version qui marche. La branche principale s'appelle traditionnellement `main`.
- **GitHub** est un site qui héberge des dépôts Git. Celui de ce projet est public :
  `github.com/FlorianMartins/hivey-vscode`. Public veut dire que n'importe qui peut lire tout le
  code et tout l'historique.

Un dernier mot, qui reviendra souvent : un **diff** (prononcer « diffe ») est la liste des
différences entre deux versions d'un fichier. Les lignes ajoutées, les lignes retirées. Quand Hivey
Code propose de modifier un fichier, il vous montre un diff **avant** d'écrire. C'est votre seul
vrai moyen de contrôle, et le [chapitre 5](05-les-trois-modes-et-les-outils.md) y revient.

## Dans Hivey Code

Le projet est **open source** sous licence **Apache-2.0**. « Open source » veut dire que le code
source est public et que n'importe qui peut le lire, le modifier et le réutiliser ; la licence dit
sous quelles conditions. Apache-2.0 est une licence permissive : une entreprise peut s'en servir,
y compris commercialement, à condition de garder les mentions de droit d'auteur.

Ça n'est pas un détail pour cet outil en particulier. Tout l'argument de Hivey Code est : « votre
code ne part pas ». Une promesse comme celle-là, dans un logiciel dont personne ne peut lire le
source, est une promesse qu'il faut croire sur parole. Ici, elle est **vérifiable** : le code est
public, et le [chapitre 9](09-la-confidentialite.md) montre par où il faudrait regarder.

[← Sommaire](README.md) · [Chapitre suivant →](02-le-modele.md)
