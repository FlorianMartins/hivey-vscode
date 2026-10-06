# 12. La qualité mesurée

[← Chapitre précédent](11-ibm-i.md) · [Sommaire](README.md) · [Chapitre suivant →](13-installer-et-sen-servir.md)

## Le problème : tout le monde dit être le meilleur

Chaque assistant de code annonce qu'il est excellent. Aucune de ces annonces n'est vérifiable, parce
qu'aucune ne dit sur quoi elle a été mesurée. « Plus fiable que les alternatives » est une phrase qui
a besoin d'un chiffre derrière elle, sinon c'est de la publicité.

Ce chapitre explique comment on fabrique ce chiffre, et pourquoi la partie difficile n'est pas de
mesurer mais de s'assurer que la mesure veut dire quelque chose.

## Ce qu'est un banc d'évaluation

Un **banc d'évaluation** (*benchmark*) est un jeu de tâches avec une réponse vérifiable
automatiquement. Celui de ce projet contient **62 tâches** : des petits dépôts cassés, une consigne,
et un **contrôle** — une commande qui réussit si le travail est fait et échoue sinon.

Par exemple : un petit programme qui compte des lignes, la consigne « ajoute une option `--json` », et
un contrôle qui lance le programme avec l'option et vérifie que la sortie est bien du JSON avec les
bons nombres.

L'avantage sur une impression humaine : c'est **reproductible**, et personne n'a d'opinion sur le code
de retour d'une commande.

## La partie difficile : un banc honnête dans les deux sens

Un banc peut mentir de deux façons opposées, et il faut se protéger des deux. Ce projet le vérifie
**à chaque commit**, avec deux contrôles distincts :

**1. Chaque contrôle doit échouer sur la tâche intacte.** Si le contrôle passe *avant* que le modèle
ait touché à quoi que ce soit, la tâche donne 100 % à tout le monde et ne mesure rien. Ça arrive plus
qu'on ne croit : une tâche censée être cassée ne l'était pas, parce que `round()` en Python est exact
sur un type décimal ; une autre parce que SQLite a un cas particulier pour `MAX()`.

**2. Chaque contrôle doit passer sur la solution de référence.** Le défaut symétrique : une tâche qui
ne peut **jamais** passer — une faute de frappe dans le contrôle, un compilateur absent de la
machine, une condition que la consigne n'a jamais demandée. Celle-là donne zéro à tout le monde et
devient une preuve contre les modèles plutôt que contre elle-même.

Seuls les **deux** contrôles ensemble attrapent ces cas. C'est la moitié du travail, et c'est celle
qui donne un sens au score.

Un détail amusant et instructif : certains contrôles vérifient la **structure** du code (« a-t-il
utilisé un bloc de garde ? »). Or un fichier qui s'**explique** contient les mots qu'on cherche à
interdire dans son propre commentaire. Quatre tâches ont ainsi rejeté des solutions correctes parce
que le commentaire disait ce que le code ne devait pas faire. Il existe maintenant un petit outil qui
retire les commentaires avant les contrôles structurels.

## Ce que la mesure a trouvé

Le tableau vit dans
[`eval/QUALITY.md`](https://github.com/FlorianMartins/hivey-vscode/blob/main/eval/QUALITY.md) — les
chiffres sont là, à jour, plutôt que recopiés ici où ils vieilliraient.

Mais la **forme** du résultat vaut d'être racontée, parce qu'elle est contre-intuitive.

**Le modèle local a obtenu 0 sur 56.** Et le chiffre qui explique ce zéro n'est pas le zéro : c'est
que dans **51 cas sur 56, le modèle n'a pris aucune action**. Il écrivait la modification dans un bloc
de code et demandait « souhaitez-vous que je procède ? ». Dans les cinq cas où il a agi, il n'a
**jamais** appelé d'outil d'édition.

C'est pour ça que le tableau a une colonne **« never acted »** (jamais agi). Un score seul ne dit pas
si un modèle s'est trompé ou s'il n'a jamais essayé, et ce sont deux problèmes différents : le
premier se règle avec un meilleur modèle, le second avec le client et le prompt.

Et une colonne **« claimed done »** (annoncé fini), qui est peut-être le chiffre le plus utile de
tous : combien de ces échecs le modèle a présentés comme une réussite. Il a terminé proprement, et le
contrôle a échoué quand même. C'est ce chiffre qui décide si on peut laisser l'outil travailler seul :
un modèle qui échoue bruyamment vous coûte un tour, un modèle qui échoue **en annonçant une
réussite** coûte la confiance qui rend l'outil utilisable.

Et deux chiffres qui donnent l'échelle, mesurés sur le jeu complet : **le préréglage gratuit réussit
la moitié des tâches, pour rien** — il ne dit pas que le gratuit suffit, il dit où il s'arrête. Et un
modèle payant bon marché en réussit près des trois quarts pour **quatre centimes sur 62 tâches**.

**Le même banc, sur un modèle distant moderne, a renversé le résultat** : la grande majorité des
tâches réussies, aucune tâche sans action, pour environ un dollar et une vingtaine de minutes. Le
contraste n'est pas un détail : il dit qu'un petit modèle local, aujourd'hui, ne suffit pas pour du
travail d'agent — et c'est précisément le cas pour lequel le mécanisme d'escalade
([chapitre 10](10-le-cout.md)) existe.

## Et la mesure a trouvé un défaut avant de trouver un chiffre

C'est l'épisode le plus instructif du projet, et il justifie à lui seul l'existence du banc.

La première tentative de mesure a donné zéro **pour une raison qui n'était pas le modèle**. Le modèle
produisait un appel d'outil parfaitement correct, et l'écrivait **dans le texte de sa réponse** au
lieu de la case prévue par le protocole, parce que le programme qui le servait ne remplissait pas
cette case ([chapitre 4](04-comment-on-lui-parle.md)). Le client affichait donc le JSON comme une
réponse et ne modifiait rien.

Autrement dit : **le mode agent ne fonctionnait pas du tout dans la configuration par défaut du
produit**, et aucun test du comportement de l'extension ne pouvait le voir. Il a fallu essayer pour de
vrai, sur un vrai modèle, pour le découvrir.

## Un refus n'est pas un échec

Un épisode qui mérite d'être raconté, parce qu'il montre à quel point une mesure est fragile.

Lors d'une mesure, les onze premières tâches ont réussi, puis **les quarante-deux suivantes ont
échoué sans produire le moindre tour**. Ni le modèle ni la tâche n'étaient en cause : le **plafond de
dépense quotidien** était atteint, et chaque tâche suivante était refusée *avant de commencer*.

Dans le relevé, ces quarante-deux refus étaient **indiscernables de quarante-deux erreurs du
modèle**. Un taux de réussite calculé là-dessus aurait été publié comme une mesure.

Donc : un refus est désormais **enregistré comme un refus**, et un jeu qui en contient ne serait-ce
qu'un seul **n'énonce aucun taux** — la colonne affiche « 3 refused — no rate » au lieu d'un
pourcentage. Absent plutôt que faux. C'est la même règle que partout ailleurs ici, et c'est elle qui
rend le tableau digne de confiance : il préfère ne rien dire que dire quelque chose d'invérifiable.

## La même mesure, deux fois, ne donne pas le même chiffre

C'est la chose la plus désagréable à admettre sur un banc d'essai, et c'est mesuré ici : **trois
séries de la même configuration, sur les mêmes tâches, avec le même programme, ont donné 48, 47 et
50 réussites.** Rien n'avait changé entre elles.

La raison est dans le [chapitre 2](02-le-modele.md) : un modèle de langage ne produit pas deux fois
la même réponse. Sur 62 tâches, deux ou trois basculent d'un côté ou de l'autre.

La conséquence est sévère et vaut pour tous les chiffres que vous lirez ailleurs : **une différence
plus petite que cet écart n'est pas un résultat.** Quand un outil annonce « 3 % de mieux », la
question à poser n'est pas « 3 % de quoi » mais « combien de fois l'avez-vous mesuré ». Le tableau de
ce projet publie son propre écart dès qu'on lui donne plusieurs séries — et il le **rapporte** au lieu
d'en faire une moyenne, parce qu'une moyenne cache précisément ce dont le lecteur a besoin.

## Les règles que ce projet s'impose sur les chiffres

Elles sont inhabituelles et elles valent d'être connues, parce qu'elles sont la raison de faire
confiance au tableau :

- **Un chiffre jamais mesuré s'affiche « non mesuré », jamais « 0 % ».** Ce ne sont pas la même chose
  et une seule des deux est un résultat.
- **Un prix inconnu s'affiche « non valorisé », jamais « 0,00 $ ».** Un modèle local n'est pas
  gratuit : il est non facturé.
- **Aucune colonne pour GitHub Copilot ni pour IBM Bob.** Non par pudeur — c'est la comparaison que
  le produit existe pour gagner — mais parce que personne ne les a exécutés **sur ces tâches, sur
  cette machine, le même jour**. Une colonne remplie depuis un chiffre publié ailleurs compare deux
  mesures différentes, et ne survivrait pas à la première question de la réunion où on la citerait.
  Le fichier écrit à la place **ce qu'il faudrait** pour en ajouter une honnêtement.

## Une suite rouge n'avertit de rien

Il faut une notion pour la suite : l'**intégration continue**. À chaque fois que du code est envoyé
sur le dépôt, un ordinateur loué à l'heure récupère le projet, l'installe à neuf et exécute tous les
tests — sur plusieurs systèmes (Linux, Windows) et plusieurs versions du langage. L'intérêt est de ne
pas dépendre de « ça marche sur ma machine », qui est une phrase et pas une preuve.

Le 2026-10-06, Florian a posé une question très simple : « le CI workflow a toujours plein d'erreurs
cest normal ? » Il avait raison de la poser. Tous les envois de la semaine étaient **rouges**, pendant
que les 1 308 tests passaient en local.

Il y avait trois causes, et aucune ne venait du produit :

1. Un test de réseau démarrait un serveur sur l'adresse `127.0.0.1` — la façon d'écrire « cette
   machine » en ancienne notation — et s'y connectait par le nom `localhost`. Sur l'ordinateur loué,
   ce nom désigne d'abord l'adresse en **nouvelle** notation, `::1`. Le serveur était debout ; le
   client frappait à l'autre porte.
2. Un test vérifiait qu'une commande enfermée dans un **conteneur** (une boîte étanche, voir le
   [chapitre 5](05-les-trois-modes-et-les-outils.md)) ne pouvait pas atteindre Internet. Il demandait
   d'abord à l'outil de conteneurs s'il répondait. Il répondait. Mais sur la machine Windows cet outil
   ne sait manipuler que des boîtes Windows, et la boîte demandée était une boîte Linux. « L'outil
   répond » et « l'outil peut faire ce qu'on va lui demander » sont deux faits différents.
3. Certains tests lisent le code du projet et vérifient qu'une phrase y figure. Or les fichiers texte
   marquent la fin d'une ligne par un caractère invisible, et ce caractère **n'est pas le même** sous
   Windows et sous Linux. L'outil de versions, par défaut, le remplace en récupérant le projet sur
   Windows. Le test cherchait une phrase écrite sur deux lignes, et les deux lignes n'étaient plus
   séparées par ce qu'il attendait. Le test avait raison, le code avait raison, et la récupération du
   projet s'était interposée entre les deux.

Les trois sont réparés. Mais la leçon n'est aucune des trois, et c'est pour elle que ce passage
existe : **le vrai défaut était que la suite était rouge en permanence**. Un signal d'alarme qui sonne
tous les jours n'est plus un signal d'alarme. Les cinq échecs attendus et la vraie régression auraient
eu exactement la même apparence — du rouge — et c'est dans cet état qu'un défaut réel traverse sans
être vu. Le coût d'un test qui échoue pour une mauvaise raison n'est pas ce test : c'est **tous les
autres**, qui perdent leur pouvoir d'avertir.

Trois choses en découlent, et elles sont plus générales que ce projet :

- **Un échec « connu » doit être réparé ou retiré, jamais toléré.** Toléré, il apprend à l'équipe à ne
  plus regarder.
- **Quand une version récente passe et une ancienne échoue, la récente n'a pas raison.** Ici, la
  version récente du langage réessayait toute seule sur l'autre adresse, sans rien dire : elle
  **masquait** le défaut. Tester plusieurs versions ne sert à rien si l'on explique chaque désaccord
  par l'âge de la plus vieille.
- **« Je ne sais pas » est une troisième réponse, et il faut la dire.** Sur la machine Windows, la
  boîte Linux ne peut pas être essayée du tout : le test est maintenant *ignoré en annonçant pourquoi*,
  au lieu de passer comme s'il avait vérifié quelque chose. Un « je ne sais pas » silencieux se lit
  comme un oui.

## Et ce cours, dans tout ça

Ce cours est lui-même tenu par un contrôle. L'index déclare la version du projet pour laquelle il est
à jour, et un contrôle **refuse la construction** quand cette version n'est plus celle du projet :

```bash
npm run check:course
```

C'est la seule façon qu'un document comme celui-ci ne pourrisse pas. Un document qu'on *promet* de
maintenir n'est pas maintenu ; un document dont l'obsolescence casse le build l'est. Le même
raisonnement vaut pour les chiffres cités dans les README, vérifiés par `npm run check:numbers` —
parce qu'un nombre écrit dans une phrase n'a aucune raison de suivre la chose qu'il décrit.

[← Chapitre précédent](11-ibm-i.md) · [Sommaire](README.md) · [Chapitre suivant →](13-installer-et-sen-servir.md)
