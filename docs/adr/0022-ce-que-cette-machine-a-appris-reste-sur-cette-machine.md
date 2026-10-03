# ADR-0022 — Ce que cette machine a appris reste sur cette machine

**Date** : 2026-10-03 · **Statut** : accepté

## Contexte

Chaque fois qu'un modèle local échoue et qu'un modèle distant réussit, quelque chose de précis s'est
produit : **une tâche que ce code contient**, à une difficulté que le petit modèle n'a pas atteinte,
avec une réponse **vérifiable** — la commande qui est passée du rouge au vert.

C'est l'exemple d'apprentissage le plus utile qu'une équipe puisse posséder. Et c'est exactement ce
qu'un service hébergé ne peut pas recueillir sans prendre le code.

## Décision

**Le recueillir ici, et ne jamais l'envoyer.** Deux exports en sortent : des tâches au format
`eval/tasks`, pour que le banc grandisse à partir du travail réel plutôt que de fixtures inventées, et
un jeu de conversations pour affiner un modèle local — pour que le petit modèle du mois prochain sache
faire ce qui a exigé un modèle payant ce mois-ci.

### 1. Désactivé par défaut, et la raison n'est pas la timidité

Un épisode contient la demande, **le contenu des fichiers touchés** et les diffs. C'est du code
source, sur le disque, **hors du dépôt**, pour la durée de la rétention. C'est une chose raisonnable à
conserver et une chose déraisonnable à **commencer** à conserver sans qu'on le demande.

Hors du dépôt précisément : un corpus dans l'espace de travail est un corpus que le `git add -A` de
quelqu'un finit par committer.

La politique de l'organisation peut le **désactiver**. Elle ne peut pas l'activer : une politique qui
pourrait *accorder* serait un fichier qui vaut la peine d'être falsifié
([ADR-0019](0019-la-politique-ne-fait-que-restreindre.md)). La feuille de route disait « autoriser ou
interdire » ; la forme honnête de « autoriser » sous cet invariant est « laisser disponible ».

### 2. Seules les escalades qui ont RÉUSSI

Un épisode n'est conservé que si la vérification est passée **au vert après le modèle distant**. Un
épisode dont le diff final ne marche pas n'est pas un exemple d'apprentissage : c'est **deux mauvaises
réponses**, et un corpus qui en contient apprend à un modèle à produire la seconde.

L'épisode est donc assemblé **avant** le second tour et conservé **après** lui, pour exactement un
tour. Avant, parce qu'ensuite le diff de la tentative locale est indiscernable de celui du modèle
distant : les deux sont sur le disque. Et pour un seul tour, parce que le porter plus loin
attacherait un diff que personne ne peut rattacher à la question qui l'a produit.

### 3. La fixture est l'état AVANT

C'est ce qui donne sa valeur à l'export : une tâche dont la fixture est l'état d'origine est une tâche
dont **le contrôle échoue**, ce qui est la première règle du banc. Les fichiers viennent du
`checkpoint` du tour, qui conserve déjà le `before` de chaque fichier touché.

⚠️ Et ce n'est **pas prouvé** par le fait de les écrire. Le prouver veut dire exécuter le contrôle
contre la fixture, ce que fait `npm run eval:verify` — et le fichier `READ-THIS-FIRST.txt` du dossier
exporté le dit, au lieu que l'export le prétende.

### 4. Aucune solution de référence n'est écrite depuis le diff final

Tentant, et faux. Le rôle d'un `solution/` est de prouver que le contrôle est **satisfaisable**, et un
correctif appliqué à la main dans un répertoire de fixture peut ne pas s'appliquer du tout. Une tâche
dont la solution ne s'applique pas est **pire** qu'une tâche sans solution : `eval:solutions` rapporte
alors le *contrôle* comme insatisfaisable et quelqu'un part chercher un défaut dans le contrôle.

### 5. La mauvaise réponse n'est jamais un tour d'assistant

Dans le jeu de conversations, la tentative échouée apparaît **comme contexte dans le tour
utilisateur** — ce qui est ce qui s'est réellement passé — et le tour d'assistant est la réponse qui a
**marché**. S'entraîner sur une mauvaise réponse étiquetée comme la réponse de la conversation est la
façon dont un modèle apprend la mauvaise chose.

## Conséquences

- **La liste des globs interdits s'applique** : un fichier qu'on refuse d'envoyer à un modèle est un
  fichier qu'on ne veut pas dans un corpus. Un épisode dont **tous** les fichiers étaient bloqués est
  **jeté** plutôt que conservé amputé — une fixture sans fichier est une fixture que personne ne peut
  exécuter — et le nombre de fichiers omis est conservé, pour qu'un épisode maigre soit explicable.
- **Rétention et plafond** répondent à deux questions différentes : la rétention est une promesse à la
  personne dont c'est le code (« rien de plus vieux que quatre-vingt-dix jours »), le plafond est une
  promesse à son disque. Une rétention de `0` n'en garde plus aucun **sans détruire l'existant** : la
  commande de purge est là pour ça.
- Trois commandes, un geste chacune, dans la palette : ce qu'il contient, l'exporter, le supprimer.
  Un répertoire de code source hors du dépôt a besoin que quelqu'un puisse voir combien il y en a.
- **Aucune requête réseau n'existe dans ce code**, et un test lit le source pour la refuser. Ce n'est
  pas un oubli à combler plus tard : une seule requête depuis ce module serait la fonctionnalité qui
  se contredit.
- Flux documenté dans [`docs/PRIVACY.md`](../PRIVACY.md) et [`docs/THREAT-MODEL.md`](../THREAT-MODEL.md),
  avec le résidu assumé : **un poste compromis lit ce répertoire comme il lit le dépôt**, et c'est
  pour cela que la fonctionnalité demande à être allumée.

## Rejeté

- **Activé par défaut**, avec un avertissement. Un avertissement n'est pas un consentement.
- **Conserver aussi les escalades qui ont échoué**, « pour l'analyse ». C'est un corpus de mauvaises
  réponses, et la première personne qui l'entraîne obtient un modèle pire que celui qu'elle avait.
- **Écrire un `solution/` depuis le diff final.** Voir §4.
- **Entraîner sur la tentative locale** comme une réponse. Voir §5.
- **Un corpus dans l'espace de travail**, plus facile à retrouver et committé par accident.
