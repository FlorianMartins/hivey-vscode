# ADR-0012 — Mesurer la qualité des réponses, avec une commande et pas un diff

**Date** : 2026-09-10 · **Statut** : accepté

## Contexte

La CI prouvait que l'extension marche : les types compilent, 562 tests unitaires passent, 27 tests
tournent dans un vrai VS Code, aucun secret ne traîne, le `.vsix` se construit.

Elle ne disait rien de la seule chose que l'utilisateur achète : **est-ce que la réponse est
bonne ?** Or le projet affirme être plus fiable que les alternatives, et une affirmation de ce genre
sans chiffre derrière est du marketing. Pire, elle est invérifiable dans le temps : rien n'aurait
signalé une régression de qualité provoquée par un changement de prompt.

## Décision

**Un jeu de petits dépôts cassés, et une commande par tâche qui décide si le résultat marche.**

`eval/tasks/<id>/` contient `task.json` (ce qu'on demande, comment on vérifie) et `files/` (un dépôt
minuscule, cassé exprès). `scripts/evaluate.mjs` copie le dépôt dans un répertoire jetable, y lance
le **vrai client terminal**, puis exécute le contrôle. Sortie 0 = réussi.

Trois choix, chacun contre une alternative plausible.

### Une commande, pas un diff

Comparer à une solution de référence note le modèle sur sa capacité à réécrire ce que quelqu'un a
déjà écrit. Une commande le note sur la seule chose qui intéresse l'utilisateur — est-ce que le code
marche maintenant — et laisse passer deux modèles qui résolvent la tâche différemment.

### Le vrai client, pas une boucle privée

Le harnais lance `hivey-code --yes` : même boucle, mêmes outils, mêmes prompts que l'extension. Une
évaluation qui pilote sa propre boucle mesure l'évaluation.

C'est ce qui a rendu nécessaire le drapeau `--yes`, qui ne répond qu'à la question d'approbation :
les globs interdits, l'anonymisation et le budget sont tous en amont et s'appliquent toujours.

### La règle qui donne un sens aux chiffres

**Le contrôle de chaque tâche doit échouer sur la version non modifiée du dépôt.**

Une tâche qui passe déjà avant que le modèle y touche note tout le monde à 100 %, elle est invisible
dans les résultats, et c'est la faute la plus facile du monde : une fixture s'écrit en cassant du
code qui marchait, et parfois la cassure ne prend pas. `--verify-tasks` vérifie les quinze tâches,
sans modèle et sans GPU — donc à chaque commit.

Elle a attrapé une de mes propres tâches au premier essai : la tâche « la virgule flottante dérive
sur les montants » ne dérivait pas, parce que multiplier par cent et arrondir est robuste sur cette
plage. Le vrai défaut de cette fixture est maintenant celui qui existe réellement — `Math.round`
arrondit vers +∞, donc tout avoir est amputé d'un centime, et tous les tests sur des montants
positifs passent.

## Conséquences

- Choisir entre deux modèles locaux devient une mesure et non une impression.
- Un changement de prompt qui dégrade la qualité devient visible.
- Le workflow nocturne a le droit de ne rien trouver : sans point d'accès configuré il le dit et
  sort en succès. Un travail programmé qui est rouge toutes les nuits est un travail que les gens
  coupent, et un travail coupé est pire qu'aucun travail.
- **Limite assumée** : ce n'est pas un banc à citer contre un autre produit. Quinze tâches, petites,
  choisies pour ressembler au travail des utilisateurs de ce projet — IBM i compris, qu'aucun banc
  public ne couvre. C'est un filet de non-régression et une façon honnête de trancher entre deux
  modèles.
- **Limite factuelle** : le harnais a été prouvé de bout en bout ici avec un modèle factice (la
  tâche qu'il sait corriger passe, celle qu'il ne sait pas corriger échoue). Il n'a jamais tourné
  contre un vrai modèle, faute de GPU sur cette machine. C'est écrit dans
  [`docs/ROADMAP.md`](../ROADMAP.md) plutôt que passé sous silence.

## Rejeté

- **Un LLM juge.** Un appel payant de plus par tâche pour une opinion, alors qu'un compilateur et une
  suite de tests répondent gratuitement et sans se tromper.
- **Des tâches réalistes tirées de vrais dépôts.** Elles auraient besoin de leurs dépendances, donc
  du réseau, donc d'un environnement reproductible qui devient lui-même le sujet. Node, Python et
  SQLite suffisent, et les tâches restent lisibles en trente secondes.
