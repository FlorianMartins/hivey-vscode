# ADR-0013 — Lire la sortie du terminal, et dire quand on ne peut pas

**Date** : 2026-09-10 · **Statut** : accepté

## Contexte

`run_command` lançait la commande dans le terminal de l'utilisateur et renvoyait au modèle : « la
commande a été lancée, demandez à l'utilisateur ce qu'elle a affiché ». Un commentaire dans le code
justifiait ce choix : l'API d'intégration shell ne peut pas renvoyer la sortie de façon fiable sur
tous les shells et toutes les plateformes.

Ce commentaire avait à moitié raison, et cette moitié coûtait cher.

Le client terminal, lui, capturait la sortie depuis toujours — il lance un processus. L'éditeur ne
le faisait pas. Or « modifie, lance les tests, lis l'échec, corrige » est la boucle sur laquelle
repose tout le mode agent. Sans la lecture, chaque tour qui en avait besoin devenait un aller-retour
par un humain — et le plus souvent le modèle sautait l'aller-retour et affirmait une réussite dont
il n'avait aucune preuve.

C'est aussi ce qui rendait impossible [ADR-0009](0009-escalader-sur-un-echec-constate.md) : rien
dans le produit ne pouvait constater qu'une tentative avait échoué.

## Décision

**Lire quand c'est possible, et dire clairement quand ça ne l'est pas.**

L'API d'intégration shell de VS Code (`onDidStartTerminalShellExecution`, `execution.read()`,
`onDidEndTerminalShellExecution`, stable depuis 1.93) rend le flux et le code de retour. Elle n'est
disponible que lorsque VS Code a pu injecter son script dans le shell — ce qui couvre bash, zsh,
fish et PowerShell dans la configuration ordinaire, et ne couvre pas un shell exotique, un conteneur
sans l'injection, ou un utilisateur qui l'a désactivée.

Donc deux branches, et le modèle sait toujours dans laquelle il est :

- **Lue.** Le résultat commence par le code de retour, puis la sortie nettoyée.
- **Non lue.** Le résultat dit que ce shell n'a pas d'intégration, que la sortie n'a pas pu être
  lue, et **de ne pas supposer que ça a marché**.

Un code de retour que le shell n'a pas fourni n'est jamais interprété comme un succès : il est
signalé comme non prouvé. Un sous-shell, un `ctrl+C`, un script d'intégration qui se comporte mal
atterrissent tous là, et aucun ne signifie que la construction est passée.

La commande continue de tourner **dans le terminal que l'utilisateur voit**. Ce n'est pas une
limitation à contourner : une commande lancée dans un processus caché est une commande que personne
ne peut interrompre, et l'approbation donnée portait sur une commande qu'on regarde.

## Le nettoyage n'est pas un détail

Le flux brut contient les séquences d'échappement : couleurs, déplacements du curseur, liens
hypertextes, les marqueurs OSC 633 du shell lui-même, et **chaque image intermédiaire** d'une barre
de progression. Donner cela à un modèle est pire que ne rien lui donner — plusieurs centaines de
jetons d'échappements autour des douze caractères qui comptent, et un modèle qui se met à citer
`[2K` à l'utilisateur.

`core/terminal/output.ts` est donc du texte pur en entrée et en sortie, testé sur des captures de
la forme de ce qu'un vrai shell écrit. Un retour chariot signifie « réécris par-dessus » : seul le
dernier segment de chaque ligne est gardé, ce qui transforme cent images d'une barre de progression
en l'image sur laquelle elle s'est arrêtée — la seule qui porte une information.

## Conséquences

- `engines.vscode` passe de `^1.90.0` à `^1.93.0`. Les versions de VS Code de mi-2024 ne sont plus
  visées ; le prix est acceptable pour la fonction obtenue.
- Le prompt de l'agent dit maintenant l'inverse de ce qu'il disait. Une consigne qui décrit
  faussement l'outillage est pire qu'aucune consigne.
- Une donnée de plus circule : la sortie des commandes atteint le modèle, donc un fournisseur distant
  si la discussion est distante. Signalé dans [`docs/PRIVACY.md`](../PRIVACY.md).
- La branche « non lue » est testée autant que l'autre. Le test d'intégration demande d'abord à
  l'éditeur si ce shell annonce une intégration, et exige la capture **seulement** dans ce cas — un
  test qui accepterait les deux réponses passerait encore après la suppression du correctif, sur la
  foi de la branche qui dit « je n'ai pas pu lire ».

## Rejeté

- **Lancer la commande dans un processus caché** (`child_process`), comme le fait le client
  terminal. Cela marcherait partout, et supprimerait la seule chose qui rend l'approbation
  significative : l'utilisateur voit ce qui tourne et peut l'arrêter.
- **Ne rien changer et documenter la limite.** C'est ce qui était fait ; la conséquence était un
  modèle qui affirmait des réussites sans preuve, ce qui est la pire chose qu'un assistant puisse
  faire.
