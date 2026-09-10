# ADR-0009 — Escalader sur un échec constaté, pas sur une question qui a l'air difficile

**Date** : 2026-09-10 · **Statut** : accepté

## Contexte

Depuis [ADR-0001](0001-local-d-abord.md), l'escalade vers un modèle payant se décidait **avant** le
travail, à partir de la question elle-même : une liste d'expressions régulières classait
« architecture », « race condition », « threat model » comme difficiles, et le reste comme
ordinaire.

Ce pari se trompe dans les deux sens, et il se trompe silencieusement.

- Il **paie** pour une question facile dont la formulation contient un mot alarmant. « Explique-moi
  l'architecture de ce dossier » est une question à laquelle un modèle 7 B répond très bien.
- Il **laisse en local** une question réellement difficile formulée simplement. « Fais passer ce
  test » ne contient aucun signal, et c'est pourtant là que les petits modèles échouent le plus.
- Surtout, il **n'apprend jamais**. Le même utilisateur pouvait poser dix fois la même question, la
  voir échouer dix fois en local, et le routeur reprenait le même chemin la onzième.

La cause de fond de ce dernier point n'était pas le routeur : c'était que l'éditeur ne savait pas
lire la sortie d'une commande. `run_command` renvoyait « demandez à l'utilisateur ce que ça a
affiché ». Rien dans le produit ne pouvait donc **constater** qu'une tentative avait échoué.

## Décision

**Le modèle local essaie. La preuve tranche. Seul un échec prouvé achète un appel distant, et il
part avec la preuve.**

`core/router/outcome.ts` lit ce que le tour a fait — les commandes lancées et leur code de retour,
ce qu'ont dit les diagnostics, si le même appel a échoué plusieurs fois de suite — et rend un
verdict. Le routeur a priori subsiste (la complétion ne s'escalade toujours jamais, un contexte plus
grand que la fenêtre locale reste un signal), mais il n'est plus la seule décision.

Trois règles, et la première est celle qui fait tout le travail :

1. **Le dernier mot de chaque type de vérification.** Un agent qui lance les tests, les voit
   échouer, corrige et les relance a un échec dans sa trace et un dépôt qui marche. Escalader sur
   « il y a un échec quelque part » paierait un modèle distant pour refaire du travail fini — sur la
   majorité des tours réussis, puisque voir un échec et le corriger est précisément ce que la boucle
   fait. Ce qui compte est l'état dans lequel le tour se **termine**, et par type de contrôle : des
   tests qui passent ne réparent pas une erreur de typage.
2. **Un échec de lecture n'est pas une preuve.** Un modèle qui devine un chemin, se fait dire que le
   fichier n'existe pas, et le cherche correctement, est un modèle qui travaille bien. Seuls les
   outils qui portent un **jugement sur le travail** comptent (`run_command`, `get_diagnostics`).
3. **Un tour qui n'a rien vérifié n'est accusé de rien.** Beaucoup de bonnes réponses ne lancent
   rien. L'absence de preuve n'est pas une preuve d'échec, et escalader là-dessus rendrait payant
   tout échange conversationnel.

S'y ajoute un motif qu'aucun contrôle d'état final n'attrape : le même appel, avec les mêmes
arguments, qui échoue trois fois. Rien n'a été vérifié, donc rien n'a échoué au sens de la règle 1 —
et c'est le signal le plus clair qu'un petit modèle est dépassé.

Le modèle qui reprend la main reçoit `handoverNote()` : le verdict, la sortie complète de la
vérification qui a échoué, et le **diff de ce que la tentative a laissé sur le disque**. Sans ce
dernier point, le second modèle lit la version d'origine dans le transcript, réécrit un changement
qui est déjà là, et annonce que c'est fait.

## Conséquences

- Un utilisateur qui ne rencontre jamais d'échec ne paie jamais d'escalade. C'est l'argument de
  [ADR-0001](0001-local-d-abord.md) appliqué à l'escalade elle-même.
- Un appel distant part d'un meilleur point de départ qu'avant : il a l'erreur et le changement, pas
  seulement la question.
- Une seule escalade par tour. Un tour d'escalade ne s'escalade pas à son tour, sans quoi une
  question difficile remonterait toute la chaîne des prix.
- Cela **dépend** de la capture de sortie du terminal, qui dépend de l'intégration shell de VS Code,
  qui dépend du shell de l'utilisateur. Sur un shell sans intégration, le verdict ne dispose plus que
  des diagnostics — moins de signal, jamais de faux signal, parce que le résultat dit alors
  explicitement que la sortie n'a pas pu être lue.

## Rejeté

- **Demander à un modèle de juger si la réponse est bonne.** Un appel de plus par tour, payé, pour
  une opinion, alors que le compilateur et la suite de tests répondent gratuitement et sans se
  tromper.
- **Escalader sur n'importe quel outil en échec.** Écrit, puis abandonné en écrivant le test : cela
  se déclenche sur presque tous les tours d'agent réussis.
- **Réessayer en local avant d'escalader.** Le modèle local vient de faire douze étapes ; une
  treizième avec le même modèle et le même contexte donne la même réponse.
