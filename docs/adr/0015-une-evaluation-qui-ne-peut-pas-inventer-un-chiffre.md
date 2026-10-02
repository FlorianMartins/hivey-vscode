# ADR-0015 — Une évaluation qui ne peut pas inventer un chiffre

**Date** : 2026-10-02 · **Statut** : accepté

## Contexte

Le banc `eval/` savait dire *réussi* ou *échoué*. C'est la moitié la moins intéressante de la
question : un modèle qui résout neuf tâches sur dix en quarante secondes chacune et un modèle qui
en résout neuf en neuf minutes, douze étapes et trois dollars ne sont pas le même produit, et le
second n'est pas livrable à quelqu'un qui paie au jeton.

Le chantier 0.6 demandait donc un rapport — durée, jetons, coût, nombre d'étapes, escalade — et
quarante tâches réalistes. Il posait aussi une contrainte : **n'invente aucun score**.

Cette contrainte n'est pas une formalité, parce qu'un harnais d'évaluation la viole *par défaut* :

- une somme sur rien vaut `0` ;
- une moyenne sur rien vaut `NaN` ;
- et les deux s'affichent comme un chiffre que quelqu'un citera.

« Ce modèle n'a rien coûté » et « personne ne l'a interrogé » rendent le même `0`.

## Décision

### 1. L'absence a une écriture, et ce n'est pas zéro

`src/core/eval/report.ts` — dans le noyau, donc testable sans modèle, sans GPU et sans réseau —
construit le rapport et refuse de combler un trou :

- un coût n'est donné que pour un modèle dont le prix est connu. Un modèle **local est non
  tarifé**, jamais gratuit, et un total qui n'a pas pu tarifer toutes les exécutions affiche
  `(+N unpriced)` : c'est un plancher, pas un chiffre ;
- une campagne sans modèle joignable produit un rapport qui dit **« not measured »**, sans aucun
  tableau — plutôt qu'une belle page de zéros ;
- ce qui n'a pas été mesuré est vide, jamais `0`.

Neuf tests unitaires tiennent ces règles, dont un qui vérifie qu'un rapport vide **ne contient pas
la chaîne `0 %`**. Un script ne peut pas être testé unitairement, et « n'invente aucun score » est
précisément la règle qui a besoin d'un test.

### 2. Les chiffres viennent du tour, pas d'une estimation

Avec `HIVEY_CODE_RUN_REPORT=<fichier>`, le client terminal ajoute une ligne de JSON par tour :
étapes, jetons, coût, outils appelés, et comment le tour s'est arrêté (réponse, plus d'étapes,
tronqué). Le harnais pointe ce fichier **hors de la copie de travail** : un fichier que l'agent voit
est un fichier qu'il peut modifier, et la mesure ne doit pas faire partie de ce qui est mesuré.

Pas d'option en ligne de commande : le client construit sa question en joignant tous les arguments
qui ne sont pas `--yes`, donc une option à valeur finirait *dans* la question. Les autres crochets
du harnais (`HIVEY_CODE_YES`, `_URL`, `_MODEL`, `_PROVIDER`) sont déjà des variables
d'environnement.

### 3. Un contrôle doit pouvoir réussir, pas seulement échouer

`--verify-tasks` existait : il attrape une tâche qui passe **avant** que le modèle y touche, parce
qu'elle noterait tout le monde à 100 % et ne mesurerait rien.

Rien n'attrapait l'erreur inverse, et elle est pire parce qu'elle est invisible : **un contrôle qui
ne peut jamais réussir**. Une faute de frappe dans un grep, un compilateur absent de la machine, une
condition que l'énoncé ne demande pas. La tâche note alors tous les modèles à 0 % et ressemble
exactement à une tâche difficile : elle devient une preuve *contre les modèles* au lieu d'une preuve
contre elle-même.

Donc chaque tâche livre un `solution/`, posé par-dessus `files/`, et `--verify-solutions` exige que
le contrôle passe au vert dessus. La solution est **une** façon de faire, jamais la façon : le modèle
reste noté par la commande, et deux modèles qui résolvent autrement passent tous les deux. Elle ne
sert qu'à prouver que la commande est satisfaisable. Les deux portes tournent sans modèle, donc les
deux sont des portes de CI.

### 4. Un contrôle structurel regarde le code, pas la prose

Toutes les tâches ne peuvent pas être tranchées en exécutant quelque chose : il n'y a ici ni
partition IBM i, ni JDK, ni compilateur TypeScript. Ces tâches sont donc vérifiées par la **forme**
— « plus aucun `any` », « plus de bloc `finally` », « la bibliothèque est qualifiée ».

Une vérification de forme est un grep, et un grep lit aussi les commentaires. Une réponse correcte
qui **s'explique** — « remplacé le bloc `finally` par un try-with-resources » — était donc refusée
pour avoir cité ce qu'elle venait de supprimer. La première victime a été la solution de référence.

D'où `eval/bin/codeonly`, qui imprime un fichier sans ses commentaires ; les contrôles structurels
le lisent au lieu de lire le fichier. Il est sur le `PATH` de chaque contrôle et il vit **dans le
dépôt**, pas dans la fixture : un outil que l'agent peut modifier n'est pas un contrôle.

## Conséquences

- Le banc passe de 15 à **40 tâches** : TypeScript, Python, Java, SQL, RPG fixe et libre, CL, DDS,
  Db2 for i, et la finance (arrondi, décimal, IBAN, échéancier, sous-unités monétaires). 40/40
  échouent sur la fixture intacte **et** passent sur leur solution.
- `--verify-solutions` a trouvé **quatre contrôles insatisfaisables** dès son premier passage, dont
  un présent depuis des semaines (`ibmi-sql-db2` refusait toute réponse mentionnant `pg_` dans un
  commentaire). Aucune relecture ne les avait vus ; aucune n'aurait pu.
- Les tâches Java et TypeScript sont **structurelles** et le mot est écrit dans `eval/README.md`.
  Elles établissent que le changement demandé a été fait, pas que le programme fonctionne. C'est
  plus faible, c'est dit, et c'est la même situation que les tâches IBM i depuis le début.
- Le workflow nocturne écrit le rapport dans le **résumé de l'exécution** et non seulement dans un
  artefact que personne ne télécharge — c'est tout l'intérêt de produire du Markdown.
- `dist/eval-report.mjs` est un quatrième produit du bundler, exclu du `.vsix` : rien dans
  l'extension ni dans le client ne l'importe.
- **Non mesuré** : aucun modèle n'a encore été évalué. Le harnais est prouvé de bout en bout contre
  un faux serveur de modèle (étapes, jetons, « non tarifé », ventilation par genre, sortie du
  contrôle en cas d'échec), et les chiffres de qualité des modèles restent à faire — c'est
  exactement ce que le chantier autorisait : « si aucun modèle n'est joignable, livre le harnais et
  marque les chiffres non mesurés ».

## Rejeté

- **Estimer les jetons côté harnais** depuis la longueur du prompt. C'est inventer un chiffre, et
  le client connaît le vrai : `usage` arrive du fournisseur.
- **Faire du coût zéro pour un modèle local.** C'est la confusion exacte que cet ADR existe pour
  empêcher : local veut dire *non tarifé*.
- **Un `solution/` comme barème.** Comparer la réponse du modèle à la solution noterait le modèle
  sur sa capacité à réécrire le texte de quelqu'un d'autre. La commande reste le juge
  ([ADR-0012](0012-mesurer-la-qualite-des-reponses.md)).
- **Installer un JDK et un compilateur TypeScript sur la machine du banc** pour rendre ces tâches
  exécutables. Ce serait mieux, et ce n'est pas à ce dépôt de l'imposer à une machine qu'il ne
  possède pas ; la faiblesse est nommée dans la documentation plutôt que masquée.
- **Un `codeonly` dans la fixture**, plus simple à écrire. L'agent peut modifier la fixture.
