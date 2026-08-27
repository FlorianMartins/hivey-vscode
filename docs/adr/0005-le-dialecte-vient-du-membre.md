# ADR-0005 — Sur IBM i, le dialecte vient du membre, pas de son nom

**Date** : 2026-08-27 · **Statut** : accepté

## Contexte

Tous les autres langages que cette extension manipule partagent une hypothèse : l'espacement est
décoratif. Sur IBM i elle est fausse, et l'être coûte cher.

Une spécification de calcul RPG III ne veut pas dire la même chose en colonne 26 et en colonne 36.
Un nom de format d'enregistrement DDS vit en colonnes 19-28 et nulle part ailleurs. Une ligne qui
dépasse la colonne 80 n'est pas rejetée : elle est **tronquée puis compilée**, ce qui est pire
qu'une erreur puisque rien ne le signale. Un modèle entraîné surtout sur du code en format libre
écrit `if x = 1;` dans un membre en format fixe, et l'échec ne se voit qu'au spool, en identifiants
de message.

Le premier réflexe était de décider du dialecte d'après l'extension du fichier. Il ne tient pas :
`.rpgle` désigne aussi bien un membre totalement libre qu'un membre en format fixe jamais converti,
et les deux coexistent dans le même répertoire source de la même application. Se tromper de sens,
c'est produire du code qui ne compile pas — exactement l'inverse du service rendu.

## Décision

Le dialecte est déterminé par le **contenu du membre**, avec le nom comme simple indice :

- `**FREE` dans les cinq premiers caractères est l'interrupteur du compilateur lui-même : il tranche
  sans appel ;
- à défaut, une lettre de spécification en colonne 6 sur une ligne qui n'est pas un commentaire dit
  que le membre est en format fixe, quel que soit son nom ;
- le SQL embarqué est orthogonal aux deux : un membre SQLRPGLE est libre ou fixe exactement comme un
  membre RPGLE.

Une fois le dialecte connu, ses **règles immuables et sa règle de colonnes** sont ajoutées au prompt
système. Le texte est écrit à l'impératif, à destination d'un modèle, pas d'un lecteur humain : la
règle de colonnes est un mètre-ruban, pas de la documentation. Elle n'accompagne que les dialectes
en format fixe — c'est la ligne la plus chère du prompt et elle ne vaut rien pour un membre libre.

Les symboles sont lus par colonnes pour la même raison. Une procédure RPG est une spécification P :
la lettre P en colonne 6, le nom en colonnes 7-21. Une expression régulière ancrée en début de ligne
n'y trouve rien, et un dépôt IBM i produisait donc une carte **entièrement vide** — précisément le
type de dépôt où une carte vaut le plus, puisque les membres sont longs et les noms tiennent en six
caractères.

## Conséquences

Le prompt système grossit d'environ cinq cents jetons quand un membre IBM i est à l'écran. Cela
semble contredire l'ADR-0001, qui fait de la frugalité du contexte un principe ; ce n'en est pas une
contradiction. Le texte dépend du **dialecte**, dont il n'existe que douze, et non du fichier : une
conversation sur du RPG garde le même préfixe d'un bout à l'autre, donc le cache de prompt tient.
Cinq cents jetons mis en cache une fois valent mieux qu'un aller-retour de compilation.

Le prix de l'erreur est asymétrique et c'est ce qui justifie tout le reste. Un contrôle local
signale ce que le compilateur ne signalera pas, la troncature en colonne 80 en premier.

Un test par règle, avec des fixtures écrites **dans les vraies colonnes** : cinq espaces avant la
lettre de spécification. Sans cela, les assertions ne veulent rien dire.

## Ce qui n'a pas été retenu

**Une grammaire TextMate ou un vrai analyseur.** Code for IBM i et l'extension RPGLE en fournissent
déjà ; en ajouter serait entrer en conflit avec elles pour rien. Ce qui manquait n'était pas la
coloration syntaxique, c'était que le modèle connaisse les règles.

**Se fier au serveur de langage.** Il n'est présent que sur les membres ouverts, et l'essentiel d'un
dépôt IBM i ne l'est pas.
