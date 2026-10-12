# 0038 — Deux éditions du cours, tenues ensemble par un contrôle

**Statut** : accepté · **Date** : 2026-10-04

## Contexte

Florian : « et tu peux faire une version des cours en anglais aussi s'il te plaît ? ». Le cours
(`docs/cours/`, 14 chapitres) est le seul document du dépôt écrit pour quelqu'un qui ne code pas, et
il est tenu à jour par `check:course`, qui **refuse la construction** quand la version déclarée en
tête de son index n'est plus celle du projet.

Le réflexe était de copier le dossier et de traduire. C'est exactement ce que le projet a déjà fait
une fois, avec `README.fr.md` : une traduction du README anglais qui a fini par annoncer **284 tests
alors qu'il y en avait 700, et la version 0.11.1 alors que le projet était à 0.61.0**. Personne n'a
menti. Un second document n'a simplement aucune raison de suivre le premier.

Le résultat est pire que l'obsolescence d'un seul document : deux éditions qui **se contredisent**, et
un lecteur qui n'a aucun moyen de savoir laquelle est courante.

## Décision

Deux éditions — `docs/cours/` (français) et `docs/course/` (anglais) — et **un seul contrôle qui les
tient ensemble**. `check:course` exige désormais trois choses :

1. Chaque édition déclare la version du projet, dans sa propre langue (`**À jour pour la version
   X.Y.Z.**` / `**Up to date for version X.Y.Z.**`).
2. Chaque édition lie tous ses chapitres, et ne lie que des chapitres qui existent.
3. **Aucune édition ne porte un chapitre que l'autre n'a pas.**

La troisième règle est celle qui compte : elle rend une modification d'une édition **non finissable**
sans l'autre. Ce n'est pas une promesse de maintenir la traduction, c'est un build rouge.

⚠️ La parité se juge sur le **numéro** de chapitre, jamais sur le nom de fichier. Les slugs sont
traduits — `10-le-cout.md` ↔ `10-the-cost.md` — et comparer les noms déclarerait chaque chapitre
manquant des deux côtés, ce qui est le genre de garde-fou qu'on désactive dans la semaine. Le numéro
est la seule partie du nom qui survit à la traduction.

La version, elle, reste **non corrigeable automatiquement**, pour la raison d'origine : réécrire le
numéro est précisément ce qui ne doit pas être automatique, puisque l'intérêt est de forcer quelqu'un
à lire ce qui a changé et à décider ce que le cours doit en dire — dans les deux langues.

## Conséquences

Écrire le cours anglais a trouvé **deux chiffres faux dans le cours français**, et les deux pour la
même raison :

- l'index annonçait « **vingt-six** décisions motivées » alors qu'il y en avait **37** (38 avec
  celui-ci — et c'est désormais le dépôt qui compte, pas la mémoire de qui écrit) ;
- le chapitre IBM i annonçait « **Quarante** compétences » alors qu'il y en a **41**
  (`rpg` 15 + `db2i` 11 + `cl` 8 + `dds` 7).

⚠️⚠️ Les deux étaient invisibles à `check:numbers` pour une raison qui mérite d'être retenue : **un
nombre écrit en lettres ne peut pas être vérifié.** Le contrôle lit des motifs qui capturent des
chiffres ; « vingt-six » ne ressemble à rien qu'il sache lire. Les deux sont passés en chiffres et
ajoutés à `check:numbers`, avec leur source calculée depuis le dépôt (le nombre de fichiers d'ADR, et
le nombre de `group:` des quatre familles IBM i) plutôt que mémorisée.

C'est la troisième fois sur ce projet qu'un contrôle existant ne voyait pas ce qu'il était censé
couvrir **parce que la forme de la donnée l'en empêchait**, et la règle générale se dégage : *un
garde-fou ne couvre pas un sujet, il couvre une forme — vérifier que la donnée a la forme qu'il lit.*

Troisième trouvaille, de même nature : le tableau des préréglages ne donnait que les **libellés**
(« Hivey Smart », « Hivey Pro ») alors que le chapitre 12 publie les **identifiants** (`hivey`,
`hivey/smart`), qui ne leur correspondent pas — héritage de deux renommages. Un lecteur ne pouvait pas
relier une promesse à son résultat mesuré. Les deux éditions portent maintenant la colonne des
identifiants et disent que le décalage existe.

Et une date relative — « trouvé il y a deux jours » — est devenue « trouvé en octobre 2026 », parce
qu'un document maintenu ne peut pas porter de date relative.
