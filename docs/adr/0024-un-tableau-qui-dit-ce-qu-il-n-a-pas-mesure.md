# ADR-0024 — Un tableau qui dit ce qu'il n'a pas mesuré

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : 3.5 — tableau de qualité publié

## Contexte

La feuille de route demande, à la fin de la phase 3, que `eval/` produise « un tableau comparatif
mesuré : local seul, local plus escalade, et chaque préréglage, avec la qualité et le coût par
tâche », versionné dans le dépôt et repris dans le README.

Ce produit prétend être défendable. Un argument du genre « meilleur que les solutions en place » a
besoin d'un chiffre derrière lui, sinon c'est de la publicité — et c'est précisément pour cela que ce
tableau est demandé.

Or deux faits s'opposent à sa production :

1. **Aucun modèle n'est joignable depuis cette machine.** Pas de GPU, pas de clé, pas d'endpoint.
2. La feuille de route interdit explicitement d'inventer un score, et de ne comparer à Copilot ou à
   IBM Bob que des chiffres réellement mesurés dans les mêmes conditions.

La tentation est claire : remplir le tableau avec des ordres de grandeur « raisonnables », ou avec les
chiffres publiés par les autres. Les deux produisent un document qui a l'air d'une mesure.

## Décision

**Le générateur est livré, et le fichier versionné dit que rien n'a été mesuré.**

`src/core/eval/table.ts` produit `eval/QUALITY.md` depuis les mêmes totaux que le rapport
(`totalsFor`), avec trois règles tenues par des tests :

1. **Une configuration que personne n'a exécutée affiche « not measured », jamais « 0 % ».** Ce ne
   sont pas la même chose et une seule des deux est un résultat. C'est la règle de l'ADR-0015,
   appliquée à l'artefact que les gens citent vraiment.

2. **Aucune colonne Copilot ni IBM Bob.** Non par pudeur — c'est la comparaison que ce produit existe
   pour gagner — mais parce que personne ici ne les a exécutés sur ces tâches. Une colonne remplie
   depuis un chiffre publié compare deux mesures différentes, sur deux jeux de tâches, sur deux
   machines, à deux dates. Elle ne survivrait pas à la première question de la réunion où elle serait
   citée. Le fichier écrit à la place **ce qu'il faudrait** pour en ajouter une honnêtement : les
   mêmes tâches, à travers ce produit, sur cette machine, le même jour, avec les mêmes contrôles qui
   tranchent. C'est une journée de travail, et ça vaut la peine d'être fait ; d'ici là, la colonne est
   absente plutôt qu'estimée.

3. **Une ligne appartient à exactement une configuration.** Le harnais reçoit un **modèle**, pas une
   configuration, et le même modèle exécuté deux fois — seul, puis autorisé à escalader — produit des
   résultats que rien ne distingue sinon un champ. Les additionner donne une qualité que personne ne
   peut reproduire, parce que c'est la qualité d'aucun des deux montages. `rowsFromOutcomes` sépare
   sur ce champ, et c'est la seule raison pour laquelle cette fonction existe plutôt qu'un `groupBy`
   d'une ligne.

Le fichier généré énonce aussi ce qui **est** prouvé, parce que c'est la moitié difficile et qu'elle
est acquise : le contrôle de chacune des 56 tâches **échoue sur sa fixture intacte** et **passe sur sa
solution de référence**, à chaque commit. Un banc honnête dans les deux sens sans modèle vaut mieux
qu'un score sur un banc dont personne n'a vérifié qu'il mesure quelque chose.

## Conséquences

- Les deux README renvoient à `eval/QUALITY.md` en disant que les chiffres n'y sont pas mesurés. Le
  document perd en force de vente ce qu'il gagne en défendabilité, et c'est l'arbitrage voulu : le
  lecteur à convaincre est un responsable sécurité ou un architecte, et celui-là reconnaît un chiffre
  non sourcé.
- Quiconque a un modèle local produit le tableau réel en une commande, et le fichier la contient.
- Le nombre de tâches annoncé par le tableau est tenu par `check:numbers` **et** par un test, parce
  qu'un tableau qui dit 51 après qu'on en a ajouté cinq est faux de la manière la plus discrète qui
  soit : rien ne casse, le chiffre a simplement cessé d'être vrai.

## Ce que ceci ne fait pas

- **Il ne mesure rien.** Aucune ligne du tableau livré n'est un résultat. Le seul travail fait ici est
  de rendre l'absence de mesure impossible à confondre avec une mauvaise mesure.
- Il ne compare pas les préréglages entre eux, puisqu'aucun n'a été exécuté.
- Il ne dit rien du coût réel : un prix n'apparaît que pour les tours dont le prix était connu, et un
  total dont des tours ne sont pas valorisés est annoncé comme un **plancher**, jamais comme un
  chiffre.
