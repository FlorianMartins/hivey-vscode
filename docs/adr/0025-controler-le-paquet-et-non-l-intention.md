# ADR-0025 — Contrôler le paquet, et non l'intention

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : prêt pour la soumission (point 1 après le plan de vol)

## Contexte

Publier une extension est la seule opération de ce projet sans annulation : un numéro de version
déposé sur le Marketplace ne se réutilise pas, et une page cassée l'est pour tout le monde jusqu'à la
release suivante.

Or les motifs de refus sont ennuyeux — un champ manquant, une icône deux pixels trop petite, un lien
qui résout dans le dépôt et nulle part ailleurs. Ce sont exactement les choses qu'un relecteur
remarque avant leur auteur.

`.vscodeignore` dit ce qui **devrait** partir. Le `.vsix` est ce qui **part**. Entre les deux il y a
un écart, et c'est là que vivaient les défauts — deux d'entre eux étaient déjà publiés :

1. **`README.fr.md` embarquait cinq liens d'images cassés.** `vsce` réécrit les liens relatifs du
   readme qu'il publie, et de celui-là seulement. `README.md` est traité ; `README.fr.md` est un
   fichier ordinaire du paquet, ses liens ne sont pas touchés, et `docs/images/` est exclu du paquet.
   Un lecteur francophone de l'extension installée voyait donc cinq images cassées, dans le document
   qui est censé être la page d'accueil du produit dans sa langue.
2. **Il renvoyait à `README.md`**, alors que `vsce` publie le readme sous le nom `readme.md`. Ça
   résout sur un système de fichiers insensible à la casse et renvoie 404 sur Linux.

Ni l'un ni l'autre n'est un plantage. Ni l'un ni l'autre n'aurait pu être trouvé par un test du
comportement de l'extension : ce sont des propriétés du **paquet**.

## Décision

**Le contrôle de pré-publication lit le `.vsix`.** Pas le dépôt, pas le fichier d'exclusion : l'archive
qui serait téléversée. `scripts/check-publish.mjs` l'ouvre avec le lecteur ZIP que l'extension possède
déjà (`src/core/docs/zip.ts`, écrit à la main pour lire un `.docx`), et passe son contenu réel aux
règles de `src/core/release/preflight.ts`, qui sont dans le cœur et donc testées.

Cinq familles de règles :

- **Les liens.** Tout lien relatif de tout document Markdown qui part doit désigner un fichier qui
  part aussi. **Sensible à la casse**, délibérément : un lien qui marche sur deux plateformes sur
  trois est un défaut signalé par un utilisateur plutôt que par une construction.
- **Le manifeste.** Les champs sans lesquels une soumission est refusée, plus `engines.vscode` qui ne
  peut pas valoir `*` — revendiquer la compatibilité avec des versions que personne n'a essayées n'est
  pas une revendication, et plus `repository`, dont le message dit **pourquoi** il est exigé (c'est ce
  contre quoi `vsce` réécrit les liens du readme), sinon quelqu'un « corrigera » en le supprimant.
- **L'icône**, relue comme un en-tête PNG, contre le 128×128 que le Marketplace impose.
- **Le journal des modifications**, qui doit avoir un titre pour la version expédiée. C'est le défaut
  de release le plus discret qui existe : le paquet est juste, le code est juste, et le document qui
  dit ce qui a changé s'arrête une version trop tôt.
- **Le volume** : aucune carte de source, aucun fichier source. Ce qui se lit ne doit pas pouvoir
  dériver de ce qui s'exécute.

Le contrôle tourne dans la CI juste après l'empaquetage, et une liste vide est le seul résultat qui
veuille dire « on peut soumettre ».

## Conséquences

- Les huit liens cassés que ce contrôle a trouvés à sa première exécution sont corrigés, dont **un
  lien mort dans le dépôt lui-même** : l'ADR-0010 renvoyait à un « ADR-0011 » qui n'a jamais été écrit.
- `docs/PUBLISHING.md` devient un mode opératoire exact, et nomme les quatre choses que **seul le
  mainteneur** peut faire : créer l'éditeur, créer le jeton d'accès, ouvrir un compte Open VSX,
  vérifier le domaine. Aucune ne peut être faite depuis la CI, et aucune ne devrait l'être — un jeton
  de publication ailleurs que dans les mains de la personne qui appuie sur le bouton est une clé de
  l'éditeur de quelqu'un d'autre.
- Les deux README gagnent la route d'installation **sans terminal**, qui manquait : la moitié des
  gens n'ont pas `code` dans leur PATH, et le `.vsix` n'est pas un fichier qu'on double-clique.
- Les chiffres de `docs/PUBLISHING.md` entrent dans `check:numbers`. Il annonçait 193 tests et 27
  d'intégration ; un chiffre dans un bloc de code est exactement aussi périssable qu'un chiffre dans
  une phrase, et celui-là est lu par quelqu'un qui est sur le point de publier.

## Ce que ceci ne fait pas

- **Il ne publie rien, et il ne peut pas.** Aucun jeton n'existe ici, et le projet a décidé
  (`docs/PUBLISHING.md`) que la publication n'est pas automatisée : la CI construit, teste, scanne et
  empaquette ; une personne appuie sur le dernier bouton.
- Il ne remplace pas le jugement d'un relecteur du Marketplace sur le contenu de la page.
- Il ne vérifie pas que le `.vsix` **fonctionne** — c'est le travail des 43 tests d'intégration, qui
  chargent l'extension dans un vrai éditeur.
