# ADR-0016 — Compiler est un verdict, pas une action de plus

**Date** : 2026-10-02 · **Statut** : accepté

## Contexte

IBM Bob, avec son Premium Package for i, apporte un mode dédié, une quarantaine de compétences
IBM i, de la documentation curatée et la génération de tests RPG. Tout cela produit du code. Rien
dans cette liste ne **vérifie** le code produit sur la partition.

Or sur IBM i la vérification n'est pas optionnelle, et elle n'est pas graduelle : un membre qui ne
compile pas n'a pas produit un résultat partiel, il n'a rien produit. Il n'y a pas d'objet. Il n'y a
rien à inspecter, rien à exécuter, rien de « presque bon ». Un assistant qui écrit du RPG sans le
compiler rend un texte dont personne ne sait s'il est un programme.

Le dépôt avait déjà la forme de cette idée, pour un autre langage :
[ADR-0009](0009-escalader-sur-un-echec-constate.md) — le modèle local essaie, les tests ou les
diagnostics tranchent, et seul un échec **prouvé** achète un appel distant. Il manquait le seul
vérificateur qui compte sur cette plate-forme.

## Décision

**`ibmi_compile` compile le membre, lit ce que le compilateur a dit, et son résultat est un verdict
sur le tour.**

### Un verdict, au même titre qu'une suite de tests

`ibmi_compile` rejoint `VERIFIERS` dans `core/router/outcome.ts`, et la règle « c'est le dernier qui
compte, par genre de vérification » s'y applique telle quelle : un agent qui compile, lit RNF7030,
corrige le nom et recompile a une étape rouge dans sa trace et un programme qui marche — escalader
là-dessus paierait un modèle distant pour refaire du travail fini. Une compilation **encore** en
échec à la fin du tour achète l'escalade, avec la liste d'erreurs.

Une différence avec `run_command`, et elle est nette. Le code de retour d'une commande shell ne
compte que si la commande ressemblait à une vérification, parce qu'un code non nul est la façon dont
la moitié du shell répond « non » : `grep` qui ne trouve rien est une réponse parfaitement bonne.
`CRTBNDRPG` qui échoue n'a aucune lecture de ce genre. Il n'existe pas d'interprétation d'une
compilation échouée dans laquelle le travail est terminé.

### La commande vient d'une table, et un type inconnu est refusé

Les huit commandes que la feuille de route nomme, et rien d'autre. La tentation est de retomber sur
`CRTBNDRPG` pour tout ce qui ressemble à du RPG — RPG III (`.rpg`, `CRTRPGPGM`) est le candidat
évident — mais un compilateur lancé sur une source qu'il ne comprend pas produit une liste pleine
d'erreurs crédibles à propos de code qui va bien. « Je ne compile pas ce type » est une meilleure
réponse. Le type est demandé au membre lui-même (`getMemberList`) quand le modèle ne le dit pas, et
l'outil refuse plutôt que de deviner si personne ne peut le dire.

### Chaque nom est refusé plutôt qu'échappé

Bibliothèque, fichier source, membre et bibliothèque cible viennent du **modèle** et sont interpolés
dans une commande CL et dans du SQL. Un nom qui n'est pas un nom IBM i valide est rejeté. La garde
de production ne peut pas aider ici : elle relit une commande après sa construction, et celle-ci
serait une commande que *nous* avons construite pour le compte du modèle. Le nom de travail que la
partition renvoie subit le même contrôle avant de repartir dans une requête — il ne vient pas du
modèle, ce qui n'est pas une raison de le laisser entrer dans un littéral SQL.

### Trois sources, et une lacune nommée plutôt qu'un silence

Le verdict est le code de retour de la commande, un point. Tout le reste sert à l'**expliquer**, et
chaque source est tentée indépendamment :

1. ce que la commande a imprimé — toujours là, aucune autorité supplémentaire requise ;
2. la liste de compilation dans le fichier spoulé (`SYSTOOLS.SPOOLED_FILE_DATA`) — **la seule source
   qui porte des numéros de ligne** ;
3. le journal du travail (`QSYS2.JOBLOG_INFO`), où les mêmes faits arrivent en colonnes et où il n'y
   a rien à analyser.

⚠️ Le journal est lu pour **le travail que le spoule désigne**, pas pour « le travail courant ». La
commande tourne dans un travail et le SQL dans un autre, donc `JOBLOG_INFO('*')` aurait renvoyé le
journal du travail SQL : un journal sans rien sur la compilation, présenté comme la sortie du
compilateur. C'est le seul endroit de ce chantier qui aurait été faux par défaut.

Ce qui n'a pas pu être lu est **dit** : « je n'ai pas pu lire la liste de compilation ». Un modèle à
qui l'on annonce seulement « ça a échoué » invente une cause ; un modèle à qui l'on dit « ça a
échoué et je n'ai pas pu lire la liste » demande la liste.

### L'orchestration est dans le noyau, avec les appels injectés

`runCompile(request, io)` prend `command()` et `sql()` en paramètres. Ce n'est pas une préférence de
style : c'est ce qui rend **les chemins d'échec** testables — pas de fichier spoulé, un
`JOBLOG_INFO` absent de cette version, un nom de travail invalide, une source qui lève. Sans cela,
toute cette logique aurait été « non vérifiée », et les chemins d'échec sont précisément là où elle
sera fausse.

### Pas de compilateur en mode Plan

Et pas par un drapeau que l'outil se donne : `READ_ONLY` dans `core/session/modes.ts` est une
**liste blanche**, donc un outil neuf est sans pouvoir jusqu'à y être nommé. `ibmi_compile` crée des
objets ; il n'y figure pas. Un test le vérifie dans les deux sens.

## Conséquences

- L'analyseur de liste est testé sur **RPG III, ILE RPG fixe et libre, SQLRPGLE, CL et DDS**.
- ⚠️⚠️ **Les fixtures sont construites, pas enregistrées.** Il n'y a pas de partition sur la machine
  où ceci a été écrit : chaque liste de test est bâtie d'après la disposition documentée de cette
  liste, pas capturée d'une vraie compilation. Ce que cela achète : le comportement qui nous
  appartient — identifiant, gravité, numéro de ligne quand il y en a un, fusion des sources. Ce que
  cela n'achète pas : « ça marche sur une partition V7R5 ». Cela reste **non vérifié**, c'est écrit
  dans `docs/ROADMAP.md`, et c'est la raison pour laquelle l'analyseur ne dépend d'**aucune colonne
  fixe** : il cherche les trois choses que toutes ces listes portent.
- ⚠️ **Le piège du sommaire.** La liste ILE finit par un récapitulatif dont la troisième colonne est
  le **nombre d'occurrences**, pas un numéro de ligne : `*RNF7030 30      2` veut dire « deux fois »,
  et le lire comme « ligne 2 » est la façon la plus plausible de produire une liste d'erreurs
  assurée et fausse. Le sommaire est reconnu, ses nombres ne sont pas lus comme des lignes, et ses
  messages ne sont conservés que si le corps ne les portait pas déjà. Un test le prouve en retirant
  la règle.
- La liste vide de `writableLibraries` ne désactive pas la barrière pour une compilation : elle la
  rend visible. Une barrière silencieusement inactive sur l'opération qui crée des objets serait le
  pire des deux mondes.

## Rejeté

- **Ouvrir notre propre session SSH** pour compiler. Même raison qu'au premier jour de l'intégration
  IBM i : Code for IBM i a déjà négocié la connexion que l'utilisateur a configurée, avec la bonne
  liste de bibliothèques et le bon CCSID.
- **`JOBLOG_INFO('*')`**, qui est l'écriture naturelle et renvoie le journal du mauvais travail.
- **Deviner le type du membre.** Voir plus haut : le pire résultat n'est pas un refus, c'est une
  liste d'erreurs crédibles sur du code correct.
- **Échapper les noms** plutôt que les refuser. Aucun nom IBM i légitime n'a besoin d'être échappé.
- **Faire du nombre de messages le verdict.** Une compilation peut réussir avec des avertissements
  et échouer sans qu'aucun message ne soit lisible. Le verdict est le code de retour.
