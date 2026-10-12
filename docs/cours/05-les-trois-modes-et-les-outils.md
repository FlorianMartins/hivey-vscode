# 5. Les trois modes et les outils

[← Chapitre précédent](04-comment-on-lui-parle.md) · [Sommaire](README.md) · [Chapitre suivant →](06-le-contexte.md)

## Pourquoi trois modes et pas un

Un assistant qui peut modifier vos fichiers est utile et dangereux. Un assistant qui ne peut rien
modifier est sûr et limité. Plutôt que de choisir, Hivey Code offre **trois** niveaux, et c'est à
vous de dire lequel vous voulez — par un bouton, la palette de commandes ou un raccourci.

| Mode | Ce qu'il peut faire |
|---|---|
| **Discussion** | Répondre. Aucun outil. Il ne lit même pas vos fichiers de lui-même. |
| **Plan** | Lire le dépôt, chercher, comprendre, proposer une marche à suivre. **Il ne modifie rien.** |
| **Agent** | Lire, chercher, **modifier des fichiers**, proposer des commandes — chaque action approuvée par vous. |

## Le point important : « Plan ne modifie rien » n'est pas une consigne

C'est la règle de conception la plus importante de tout le projet, et elle se résume en une phrase :
**en mode Plan, l'outil d'écriture n'existe pas.**

La différence avec l'autre façon de faire est énorme. On pourrait écrire dans le prompt système :
« tu es en mode plan, ne modifie aucun fichier ». Ça marcherait… la plupart du temps. Un prompt est
une **demande** faite à un modèle, et un modèle qui comprend mal une demande est le cas ordinaire,
pas l'exception ([chapitre 2](02-le-modele.md)). Il suffit d'une tournure malheureuse, d'une
instruction contradictoire dans un fichier du projet, ou d'un utilisateur insistant, pour que la
consigne cède.

Ici, la liste des outils est construite **en code**, en fonction du mode. En mode Plan, la fonction
qui écrit un fichier n'est pas dans la liste envoyée au modèle. Le modèle ne peut pas l'appeler : pas
parce qu'il a accepté de ne pas le faire, mais parce qu'elle n'est pas là.

Cette idée revient partout dans le projet, et c'est elle qu'il faut retenir si vous n'en retenez
qu'une : **une garantie vit dans le code, jamais dans un prompt.**

## La boucle de l'agent, pas à pas

Voici ce qui se passe réellement quand vous écrivez, en mode Agent : « les tests échouent, corrige ».

1. **Votre question part**, avec le contexte ([chapitre 6](06-le-contexte.md)) et la liste des outils
   disponibles.
2. **Le modèle demande un outil** : « lance `npm test` ». Ce n'est pas une phrase, c'est un appel
   ([chapitre 4](04-comment-on-lui-parle.md)).
3. **Vous approuvez.** Une carte apparaît, elle dit quelle commande exactement.
4. **La commande tourne vraiment**, et sa sortie **et son code de retour** sont renvoyés au modèle.
   C'est ce qui permet de dire « corrige ce qui échoue » en un seul tour plutôt qu'en faisant
   l'aller-retour par vous.
5. **Le modèle lit l'erreur**, demande à lire le fichier concerné, puis demande à le modifier.
6. **Vous voyez un diff** — les lignes retirées, les lignes ajoutées — et vous approuvez ou non.
7. **Il relance les tests** pour vérifier. Et ainsi de suite, jusqu'à une réponse.

Le nombre d'étapes d'un tour est **plafonné** (douze), pour qu'une boucle qui tourne en rond ne vous
demande pas trente approbations d'affilée.

## Les permissions, et pourquoi elles sont par *forme* d'action

Approuver chaque action à chaque fois est épuisant ; tout approuver d'avance est imprudent. Hivey
Code demande donc, pour chaque action, le choix entre **« une fois »**, **« pour cette
conversation »** et **« toujours »**.

Le détail qui compte : « toujours » s'applique à une **forme** d'action, pas à toutes les actions.
Autoriser `npm test` pour toujours **n'autorise pas** `npm publish`. Un écran séparé montre ce qui est
permanent et ce qui expire à la fin de la conversation, parce qu'une permission qu'on ne peut pas
retrouver est une permission qu'on ne peut pas retirer.

## Ce que vous pouvez brancher dessus

- **Des hooks** — vos propres commandes, avant ou après un appel d'outil, déclarées dans un fichier
  du dépôt. Un code de retour non nul **avant** annule l'action ; le formateur de l'équipe **après**
  s'exécute sur ce qui vient d'être écrit. Comme le fichier vient du dépôt, il est relu comme du
  code — et s'il change, on vous le redemande.
- **Une tâche en arrière-plan** — « fais ça pendant que je continue ». Elle travaille dans une copie
  séparée du dépôt (un *worktree* git) et, si votre machine a un moteur de conteneurs, dans un
  conteneur **sans réseau**. Elle ne peut pas atteindre votre copie de travail, et les commandes git
  qu'on lui permet **n'incluent pas `push`** : un agent de fond qui pourrait publier est un agent de
  fond qui peut publier une erreur.
- **Un second modèle qui relit le diff** avant les changements dangereux — un réglage de sécurité, un
  fichier qui configure tout le reste, ou un diff trop gros pour avoir été lu. Il répond à une seule
  question : *est-ce que ce diff fait quelque chose que la demande n'a pas demandé ?* Ses objections
  s'affichent sur la carte d'approbation. **Local uniquement** : si ce second lecteur devait être un
  modèle facturé, il n'est pas appelé et la carte le dit — un second avis qui doublerait
  discrètement le prix de chaque modification est une fonctionnalité qu'on désactive.

## Dans Hivey Code

Un détail mesuré, et il est instructif : en mode Agent, savoir si le modèle a **réellement agi** est
une information distincte de savoir s'il a **réussi**. Le banc d'essai du projet compte les deux
([chapitre 12](12-la-qualite-mesuree.md)), et sur un petit modèle local le résultat a été : 51 tâches
sur 56 où **aucune action n'a été tentée**. Le modèle écrivait la modification dans un bloc de code
et demandait « souhaitez-vous que je procède ? ».

Ça n'est pas un détail de mesure. Un score de 0 % qui ne dit pas si le modèle s'est trompé ou s'il
n'a jamais essayé ne permet de rien décider : le premier cas se corrige avec un meilleur modèle, le
second avec le client et le prompt. Ce sont deux problèmes différents.

[← Chapitre précédent](04-comment-on-lui-parle.md) · [Sommaire](README.md) · [Chapitre suivant →](06-le-contexte.md)
