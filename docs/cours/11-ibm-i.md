# 11. IBM i

[← Chapitre précédent](10-le-cout.md) · [Sommaire](README.md) · [Chapitre suivant →](12-la-qualite-mesuree.md)

Ce chapitre explique un axe du projet qui paraît exotique et qui ne l'est pas : il concerne les
ordinateurs sur lesquels tourne une partie considérable de la banque, de l'assurance, de la
logistique et de l'industrie européennes — et dont presque personne ne parle.

## Ce qu'est un IBM i

**IBM i** (anciennement AS/400, puis iSeries) est un système d'IBM, toujours vendu, toujours
développé, qui fait tourner des applications de gestion depuis les années 1980. On appelle
*partition* une instance de ce système.

Deux propriétés expliquent sa longévité et le problème qui nous occupe :

- **Il est extraordinairement stable.** Du code écrit en 1990 tourne encore aujourd'hui, sans
  modification. C'est une qualité, et c'est pour ça que personne ne réécrit : ça marche.
- **Sa base de données est dans le système**, pas à côté. Elle s'appelle **Db2 for i**.

Conséquence humaine, et c'est le vrai sujet : les gens qui connaissent ces applications **partent à
la retraite**, et il n'y a presque pas de relève. Une entreprise peut se retrouver avec un programme
de quinze mille lignes dont personne ne comprend plus la logique, et dont dépend la facturation.

## Les langages, et la chose qui casse tout

- **RPG** est le langage historique. Il existe en plusieurs formes, et c'est là que tout se joue :
  **RPG III** (RPG/400, l'ancien), **ILE RPG en format fixe**, **ILE RPG en format totalement libre**
  (moderne, qui ressemble à un langage d'aujourd'hui), et **SQLRPGLE** (du RPG avec du SQL dedans).
- **CL** (*Control Language*) est le langage de commandes du système : `DSPFD`, `CRTBNDRPG`,
  `DLTOBJ`. Des verbes de trois ou quatre lettres, très nombreux.
- **DDS** (*Data Description Specification*) décrit les fichiers, les écrans et les états imprimés.
- **COBOL** existe aussi sur la plateforme.

Et voici ce qui rend un assistant de code ordinaire dangereux ici.

**Dans tous les autres langages, les espaces sont de la décoration.** Sur IBM i en format fixe,
c'est faux : **la colonne où se trouve un caractère change ce qu'il veut dire.** Un calcul RPG III
signifie une chose en colonne 26 et une autre en colonne 36. Un nom d'enregistrement DDS vit dans les
colonnes 19 à 28 et nulle part ailleurs. Une ligne qui dépasse la colonne 80 n'est pas rejetée : elle
est **tronquée et compilée**.

Un modèle entraîné majoritairement sur du code en format libre écrit `if x = 1;` dans un membre en
format fixe, et l'échec n'apparaît pas tout de suite : il apparaît plus tard, dans un fichier
d'impression, sous forme d'un identifiant de message.

## Ce que Hivey Code fait de différent

**Il déduit le dialecte du membre lui-même**, pas de son nom de fichier : `**FREE` en colonne 1, ou
une lettre de spécification en colonne 6. Puis il met **les règles de ce dialecte et sa règle à
colonnes** dans le prompt.

C'est la décision la plus rentable du lot : `.rpgle` ne dit **rien** du format, et annoncer le mauvais
format à un modèle est la façon la plus fiable d'obtenir du code qui ne compile pas.

Il s'appuie aussi sur ce que le système sait déjà, au lieu de le redemander au modèle :

- **Compiler, lire, corriger.** Il lance la compilation, puis **lit le fichier d'impression et le
  journal de travail** et rend les messages avec leur membre, leur ligne et leur identifiant. Une
  compilation qui échoue est un **verdict** ([chapitre 10](10-le-cout.md)), pas une erreur à
  réessayer : la boucle « compiler, lire, corriger, recompiler » tient dans un seul tour.
- **Les tests de la maison, exécutés.** Si l'équipe utilise un cadre de tests unitaires RPG, son
  résultat compte comme une vérification.
- **« Qui utilise ceci ? »** — la question qu'on pose avant chaque changement. La réponse vient du
  système (`DSPPGMREF` et le catalogue SQL), pas d'une impression du modèle.
- **Les conventions de nommage de cette boutique**, lues dans un fichier que l'équipe écrit. Un nom
  de six caractères n'est pas une documentation : `CFC1234` ne veut rien dire en général, et veut
  dire quelque chose de précis chez vous.

## La barrière de production

C'est la demande qui revient systématiquement, et ce n'était pas une demande de fonctionnalité mais
une **condition** : *« les agents ne doivent jamais toucher à la production »*.

Une condition comme celle-là ne peut pas être une phrase dans un prompt
([chapitre 5](05-les-trois-modes-et-les-outils.md)). C'est donc une barrière **en code**, et elle est
volontairement stricte aux trois endroits où être indulgent voudrait dire deviner :

- **Ce qui est inconnu modifie.** Un verbe CL que l'extension ne reconnaît pas comme lecteur est
  traité comme écrivain. Se tromper dans ce sens coûte un refus que vous pouvez lever ; se tromper
  dans l'autre coûte un fichier de production.
- **Ce qui n'est pas qualifié est refusé.** `DLTOBJ OBJ(CUSTMAST)` se résout sur la liste de
  bibliothèques du travail, qui n'est pas connaissable d'ici et qui peut très bien commencer par la
  production. Une commande qui ne dit pas de quelle bibliothèque elle parle ne peut pas être
  vérifiée, et ce qui ne peut pas être vérifié ne passe pas une barrière qui existe pour vérifier.
- **Chaque nom compte.** Une commande qui nomme quatre bibliothèques ne passe que si les quatre sont
  autorisées.

Et une commande qui porte ce qu'elle va faire **dans une chaîne de caractères** — un shell via `QSH`,
du CL passé à `QCMDEXC` — est refusée d'emblée, **même si elle semble nommer une bibliothèque
autorisée** : ce qu'elle touche est construit à l'exécution et ne peut pas être lu ici. Ce point vient
d'un vrai défaut : `QSH` figurait parmi les verbes « de lecture », donc
`QSH CMD('rm -r /QSYS.LIB/PROD.LIB')` passait la barrière sans être regardé.

La liste est **vide par défaut** : une liste par défaut serait les noms de bibliothèques d'une
entreprise livrés à toutes les autres. Tant qu'elle est vide, la barrière est inactive — et une
installation qui ne la configure pas n'a pas de périmètre.

## Dans Hivey Code

41 compétences IBM i (`/tofree` pour convertir un membre en format libre, `/sql` pour écrire du
Db2 for i et non du SQL générique, `/dds` pour expliquer un fichier écran…), **chacune adossée à une
tâche d'évaluation** qui échoue avant qu'on l'applique ([chapitre 12](12-la-qualite-mesuree.md)).

Et là où une tâche ne pouvait pas être écrite honnêtement — parce qu'elle exige une partition vivante
— la compétence **le déclare** au lieu de prétendre à une couverture. C'est moins flatteur et c'est
la seule version utilisable par quelqu'un qui doit décider s'il peut s'y fier.

Ces compétences sont rangées en **familles** (RPG, DDS, CL, Db2 for i, et une quinzaine d'autres pour
les langages du reste du monde), et une famille éteinte ne met rien dans le `/`. Jusqu'à la version
1.3.0 il fallait aller la cocher soi-même, ce que presque personne ne faisait : quelqu'un qui ouvrait
un membre RPG obtenait la famille générale et rien d'autre, donc les 41 compétences écrites pour lui
restaient éteintes pendant que le modèle devinait. Elles s'allument maintenant **d'après les fichiers
que vous avez ouverts**.

Deux détails qui en disent plus que la fonctionnalité :

- L'automatisme ne fait qu'**ajouter**. Une famille que vous avez cochée reste allumée même un jour où
  vous n'ouvrez aucun fichier de ce type. Éteindre quelque chose que quelqu'un a demandé, pour lui
  rendre service, est la version de cette fonction que personne ne garderait active.
- Il est décidé **une fois par conversation**. La liste des compétences fait partie de la portion du
  texte d'instructions que le fournisseur garde en cache et facture moins cher ([chapitre
  6](06-le-contexte.md)) ; or un cache se compare depuis le début, et un seul caractère qui change
  invalide tout ce qui suit. Une liste qui se mettrait à jour à chaque clic sur un onglet ferait donc
  repayer le préfixe entier à chaque message — la façon la plus chère possible d'être serviable.

Le même défaut touchait le banc de mesure du [chapitre 12](12-la-qualite-mesuree.md), et il y était
invisible : le banc pilote la version terminal, qui n'a pas d'éditeur à interroger, et qui offrait donc
la famille générale seule. **Tous les chiffres publiés ont été mesurés avec ces familles éteintes**, sur
un banc dont 22 des 62 tâches sont des tâches IBM i. Le tableau le dit maintenant en haut, et — c'est
le point — **les chiffres n'ont pas été retouchés**. Savoir si la correction les améliore demande de
refaire la mesure, pas de l'estimer.

[← Chapitre précédent](10-le-cout.md) · [Sommaire](README.md) · [Chapitre suivant →](12-la-qualite-mesuree.md)
