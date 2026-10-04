# 10. Le coût

[← Chapitre précédent](09-la-confidentialite.md) · [Sommaire](README.md) · [Chapitre suivant →](11-ibm-i.md)

## Pourquoi un assistant de code coûte de l'argent

On facture au **jeton** ([chapitre 2](02-le-modele.md)), séparément à l'entrée et à la sortie, la
sortie étant plusieurs fois plus chère. Les prix s'expriment **par million de jetons** : « 2 $/M en
entrée, 10 $/M en sortie ».

Le piège est dans la structure de la conversation, pas dans le prix unitaire. Comme un modèle n'a pas
de mémoire, **chaque tour renvoie tout depuis le début**. Au dixième échange, vous payez à nouveau les
neuf premiers. Avec un gros fichier joint, la facture d'une conversation ne grandit pas
proportionnellement au nombre de questions : elle grandit **plus vite que ça**.

Et l'usage le plus coûteux n'est pas celui qu'on croit. Ce n'est pas la question difficile posée
trois fois par jour — c'est la **complétion**, une requête à chaque pause de frappe, des centaines de
fois par heure.

## Les trois leviers du projet

### 1. Le rôle décide du modèle

C'est le levier principal, et il est développé au [chapitre 3](03-ou-tourne-le-modele.md) : la
complétion sur un petit modèle local ne coûte **rien**, quelle que soit sa fréquence. L'essentiel du
volume disparaît de la facture avant même qu'on parle d'optimisation.

### 2. L'escalade sur un échec **constaté**

Voici l'idée la plus intéressante du projet, et elle mérite d'être comprise par opposition à ce qui
se fait d'habitude.

La façon habituelle de décider « cette question est difficile, prenons le gros modèle » est de
**regarder la question**. Une expression repère des mots : « architecture », « refactoriser »,
« optimiser ». C'est un **pari**, et il est mauvais dans les deux sens : il envoie à un modèle payant
des questions faciles qui contiennent un mot effrayant, et il garde en local des questions
difficiles formulées simplement. Surtout, **rien n'y apprend jamais que la tentative locale a
échoué**.

Hivey Code fait l'inverse. Il regarde ce que le tour **a fait** — quelles commandes ont tourné, ce
que les diagnostics de l'éditeur ont dit, si le même appel a échoué trois fois — et répond à une
seule question : **y a-t-il une preuve que ce n'est pas fini ?** Escalader là-dessus ne paie un
modèle cher que lorsqu'un modèle gratuit a **déjà été prouvé insuffisant**, et le modèle cher
démarre **depuis l'échec** plutôt que depuis la question.

Trois précautions qui font la différence entre une bonne idée et une fonctionnalité utilisable :

- **Un tour sans vérification n'est pas un échec.** Beaucoup de bonnes réponses ne lancent rien et ne
  changent rien. Seul un échec **observé** compte, parce que ce qu'on achète avec une mauvaise
  décision ici, c'est l'argent de l'utilisateur.
- **Le dernier contrôle gagne.** Un agent qui lance les tests, voit trois échecs, corrige et relance
  a un échec dans sa trace **et un dépôt qui marche**. Escalader là-dessus paierait un modèle distant
  pour refaire du travail fini.
- **Tous les codes de retour non nuls ne sont pas des échecs.** `grep` sort en erreur quand il ne
  trouve rien, ce qui est une excellente réponse à « est-ce que c'est utilisé ? ». Seules les
  commandes qui sont **plausiblement un contrôle** — une suite de tests, une compilation, un
  vérificateur de types — comptent. Sans cette précaution, presque chaque tour qui cherchait quelque
  chose sans le trouver achetait un second tour sur un modèle plus gros, sans que personne puisse le
  voir.

### 3. Le routage qui apprend (optionnel)

Encore un cran plus loin : l'extension peut mesurer, **par dépôt**, par genre de tâche et par modèle,
le taux de réussite réellement constaté — puis choisir **le modèle le moins cher dont le taux observé
dépasse un seuil**. Le panneau dit pourquoi : « Choisi qwen2.5-coder:7b : 9 sur 10 dans ce dépôt ».

C'est **désactivé par défaut**, et la raison est un principe : un routeur qui apprend **change quel
modèle répond**, et ce n'est pas un changement à imposer le matin où quelqu'un met l'extension à
jour. Trois limites l'encadrent : jamais un modèle que l'utilisateur n'a pas autorisé ; jamais de
confiance sur trop peu d'historique (« une réussite n'est pas un taux », et « pas d'historique » n'est
pas « mauvais ») ; et **une mesure n'existe que si quelque chose a vérifié**, sinon un modèle finit
avec un palmarès parfait après vingt questions que personne n'a contrôlées.

## Les garde-fous

- **Un plafond par requête** et **un plafond par jour**, en dollars.
- **Un plafond de taille par requête**, en jetons — et son histoire dit quelque chose. Les plafonds en
  dollars étaient calibrés quand le préréglage du milieu visait un modèle à 120 $/M ; en le passant
  aux modèles actuels à 10 $/M, un prompt emballé de 400 000 jetons (un journal de compilation collé,
  un outil qui a lu un fichier compressé) est tombé à 80 centimes et **passait sous le plafond de
  2 $**. Un plafond en dollars **se desserre à chaque baisse du marché**, ce qui pour un outil dont
  l'argument est que votre code ne part pas est la mauvaise direction. 400 000 jetons de votre dépôt
  qui s'en vont méritent une question **à n'importe quel prix**.
- **Un rapport de coût**, lisible, qui dit ce qui a été dépensé et sur quoi.

## Les préréglages Hivey

Plutôt que de choisir un modèle, vous pouvez choisir une **intention**. Trois préréglages, qui sont
des **routages** et non des modèles :

| Préréglage | Son identifiant | Promesse |
|---|---|---|
| **Hivey Free** | `hivey/free` | Uniquement des points d'accès gratuits. Ne coûte rien, et est limité en débit comme tout ce qui est gratuit. |
| **Hivey Smart** | `hivey` | Un modèle fort là où ça se sent, un modèle bon marché pour la plomberie. |
| **Hivey Pro** | `hivey/smart` | Le meilleur du catalogue sur le travail difficile, sans le payer pour écrire des messages de commit. |

⚠️ La colonne du milieu n'est pas un détail d'implémentation : le libellé et l'identifiant **ne se
correspondent pas**. « Hivey Smart » s'appelle `hivey`, et « Hivey Pro » s'appelle `hivey/smart`.
C'est un héritage de deux renommages, et c'est visible : le tableau de mesures du
[chapitre 12](12-la-qualite-mesuree.md) publie les **identifiants**, donc sans cette colonne un
lecteur ne peut pas relier une promesse à son résultat mesuré.

Chacun attribue un modèle à chacun des quatre rôles (corvée, courant, approfondi, complétion). Et le
point essentiel : **aucun nom de modèle n'est écrit en dur dans le projet**. Un fichier généré chaque
jour choisit, par règle, depuis le catalogue réel — budget, capacité, famille d'éditeur, récence.
Quand un éditeur sort un successeur, ce fichier bouge, et rien d'autre.

⚠️ Ces règles ont eu un défaut qui vaut la peine d'être raconté, parce qu'il illustre pourquoi « c'est
automatique » ne veut pas dire « c'est juste ». Le terme de **récence** était calculé comme un rapport
entre deux horodatages ; comme les deux valent environ 1,79 milliard, le rapport valait 0,999 pour
tout le monde. Sur l'ensemble du catalogue — de GPT-3.5 (2023) à un modèle de la veille — ce terme ne
variait que de **0,0885**, quand un simple bonus d'éditeur en valait 1,2. La récence était revendiquée
dans l'en-tête du fichier et n'existait pas. Résultat : le préréglage Pro faisait tourner un modèle
d'**octobre 2025 à 120 $/M** alors que son successeur de septembre 2026 était disponible à **10 $/M**
— douze fois le prix pour un modèle d'un an plus vieux. Les règles vivent maintenant dans du code
testé, et une deuxième règle y a été ajoutée : **dans une même gamme d'un même éditeur, un modèle plus
récent et pas plus cher retire l'autre de la liste**, parce que « ne jamais payer plus pour un modèle
plus vieux » est une règle et pas un équilibre de points.

## Solde, plafond, rechargement : trois choses différentes

Ces trois mots se ressemblent et désignent trois objets sans rapport. Les confondre coûte une
après-midi, et c'est arrivé sur ce projet.

- Le **solde** est de l'argent. Vous avez versé 20 $ chez le fournisseur, il vous reste 20 $, chaque
  requête en retire un peu. Quand il tombe à zéro, plus rien ne part.
- Le **plafond d'une clé** est une **autorisation**, pas de l'argent. Une clé plafonnée à 50 $ veut
  dire : « avec cette clé, on peut dépenser **jusqu'à** 50 $ **de l'argent du compte** ». C'est une
  limite de dégâts si la clé fuite, exactement comme un plafond de carte bancaire. Sur un compte à
  zéro, une clé plafonnée à 50 $ ne peut rien dépenser : 50 $ de rien font rien.
- Le **rechargement automatique** est ce qui relie les deux : « dès que le solde passe sous 5 $,
  prélève 20 $ sur ma carte ». C'est **lui**, et lui seul, qui transforme un plafond en marge
  utilisable dans le temps.

Quand une requête est refusée pour cause d'argent, le fournisseur renvoie une erreur `402 Payment
Required`. Hivey Code lit la raison exacte que le fournisseur donne et dit laquelle des trois est en
cause, parce que le message brut du fournisseur, lui, conseille généralement de relever le plafond de
la clé — ce qui ne sert à rien neuf fois sur dix.

⚠️ Le cas vécu, et pourquoi il est instructif : la clé annonçait **48,42 $ de marge sous un plafond de
70 $**, ce qui se lit naturellement comme « il y a du crédit ». Les chiffres du compte disaient autre
chose : **240,00 $ achetés depuis toujours, 240,11 $ consommés**, donc un solde de **−0,11 $**. Le
plafond était intact parce qu'un plafond ne se consomme pas ; c'est l'argent qui manquait. Et le
rechargement automatique n'avait pas eu lieu — sinon le solde n'aurait jamais atteint zéro. Trois
causes possibles, toutes invisibles depuis l'extension : il n'est pas activé, son seuil de
déclenchement n'a pas été franchi, ou **le moyen de paiement a échoué** (carte expirée, refus
bancaire — le cas le plus fréquent, et le fournisseur n'en dit rien dans l'erreur).

La leçon pour l'outil : **aucun code ne peut financer une réponse avec un solde négatif.** Ce que le
logiciel peut faire, il le fait — distinguer les trois causes, nommer la bonne, et ne pas vous
envoyer régler le mauvais réglage. Ce qu'il ne peut pas faire, il ne prétend pas le faire.

Il reste un cas où le logiciel répare vraiment, et il est différent : quand il y a **un peu** d'argent
mais pas assez pour la réponse demandée. Le refus dit alors « vous avez demandé 4 096 jetons, vous ne
pouvez en financer que 1 991 ». Hivey Code refait la requête à 1 991 jetons, et vous dit que la
réponse a été raccourcie — pour que vous ne preniez pas une réponse coupée pour une réponse complète.
En dessous d'un plancher (256 jetons), il renonce : une réponse trop courte pour être utile est un
échec plus honnête qu'un fragment.

## Dans Hivey Code

Une distinction qui revient dans tout le projet et qu'il faut tenir : **gratuit** et **non valorisé**
ne sont pas la même chose. Un modèle local ne coûte rien à facturer, mais il consomme de
l'électricité et du temps. Les rapports de ce projet écrivent donc « non valorisé » (*not priced*) là
où le prix est inconnu, et **jamais 0,00 $**, parce qu'un zéro est une affirmation.

C'est la même discipline que le [chapitre 12](12-la-qualite-mesuree.md) applique aux scores.

[← Chapitre précédent](09-la-confidentialite.md) · [Sommaire](README.md) · [Chapitre suivant →](11-ibm-i.md)
