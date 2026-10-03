# ADR-0021 — Une preuve qui dit ce qu'elle ne prouve pas

**Date** : 2026-10-03 · **Statut** : accepté

## Contexte

Tout ce qu'il faut pour une preuve de conformité existait déjà : le registre dit ce qui est sorti, la
chaîne dit si le registre a été modifié, le pseudonymiseur dit ce qui a été remplacé. Ce qui
manquait, c'était un moyen de remettre tout cela à quelqu'un **en un seul morceau**, sur une période
qu'il choisit, sous une forme qu'il peut vérifier **sans faire confiance à la personne qui la
produit**.

Et il manquait la réponse au résidu n°9 du modèle de menace, écrit et assumé depuis la 0.39.0 : une
chaîne locale rend visible la modification d'une ligne, mais **rien ne la lie à une racine de
confiance extérieure**, donc réécrire tout le journal depuis le début était indétectable.

## Décision

**Un rapport signé, qui porte ses propres limites, et dont la tête de chaîne est horodatée par une
autorité que l'organisation choisit.**

### 1. Le rapport dit ce qu'il ne prouve pas

C'est la décision centrale, et elle est inconfortable : **un document qui ressemble à une preuve et
n'en est pas une est pire que pas de document**, parce que c'est celui qui sera cité.

Donc les limites sont **dans le rapport** et non dans sa documentation, et un test les exige :

- il est signé par **cette machine**, donc la signature établit qu'il n'a pas changé depuis son
  émission — **pas** que le registre dont il est tiré était vrai. Rien produit sur la machine
  auditée ne peut l'établir ;
- la chaîne montre si une ligne a été modifiée ; elle ne montre pas que l'ensemble n'a pas été
  réécrit depuis le début ;
- le registre ne conserve que les entrées récentes, donc une période plus ancienne que la rétention
  est rapportée comme **tronquée** et non comme vide ;
- le volume est compté en **jetons**, parce que c'est ce que le registre enregistre. Pas en octets,
  qu'il n'a jamais enregistrés — inventer un nombre d'octets depuis un nombre de jetons serait
  exactement le chiffre que quelqu'un citerait ;
- rien ici ne voit une requête faite par un **autre** outil sur cette machine.

### 2. L'horodatage porte sur la tête de la chaîne, et rien d'autre ne sort

Horodater le *rapport* prouverait quand le rapport a été écrit, ce que personne ne demande. La
**tête** est la chose qu'on ne peut pas réécrire après coup : une seule empreinte part vers
l'autorité, qui répond à une seule question — « cette empreinte existait à cet instant ».

C'est précisément la question qu'un journal réécrit ne peut pas satisfaire. **Le résidu n°9 est
fermé** — à la condition, dite dans le rapport, qu'une autorité soit configurée.

### 3. L'extension n'affirme pas vérifier ce qu'elle ne vérifie pas

⚠️ Elle **construit** la requête, l'envoie et **conserve le jeton verbatim**. Elle ne vérifie **pas**
la signature de l'autorité : le faire correctement demande une implémentation CMS complète et un
magasin de confiance des autorités de l'organisation, et une extension qui prétendrait vérifier en
faisant quelque chose de plus faible serait pire qu'une qui ne le prétend pas.

La vérification est un acte séparé, accompli par celui qui audite, avec **sa** racine de confiance —
et le dossier livré contient la commande à exécuter. Le jeton est la preuve : nous l'obtenons et le
conservons, ils le vérifient.

Conséquence de cette honnêteté : le `genTime` que le rapport imprime est **informatif**, pour qu'un
humain reconnaisse la date. La valeur qui fait foi est dans le jeton signé.

### 4. DER écrit à la main, vérifié par un tiers

La requête est encodée en DER à la main (ADR-0004), et c'est la partie de ce chantier la plus
susceptible d'être subtilement fausse. Elle est donc **vérifiée contre une implémentation que
personne ici n'a écrite** : le test fabrique la requête et la fait relire par `openssl ts -query` et
`openssl asn1parse`, et il **échoue** si `openssl` manque plutôt que de passer sans avoir rien
testé.

Deux pièges attrapés par là : une longueur DER doit être la **plus courte** représentation, et un
INTEGER est **signé** — donc un nonce aléatoire sur deux a besoin d'un zéro de tête, sans quoi
l'autorité lit un nombre négatif et le nonce de la réponse ne correspond pas.

### 5. La clé de signature est dans le trousseau

Générée à la première utilisation, Ed25519, dans le trousseau du système. **Jamais dans un
réglage** : une clé de signature dans `settings.json` est une clé de signature dans une capture
d'écran, dans une sauvegarde et dans un ticket de support. La clé publique est écrite à côté de
chaque rapport, pour que l'organisation l'épingle la première fois et remarque si elle change.

## Conséquences

- Le dossier livré contient le rapport, sa signature, la clé publique, un `HOW-TO-CHECK.txt` qui dit
  ce que la signature prouve et ce qu'elle ne prouve pas, et le couple `head.tsq`/`head.tsr` quand une
  autorité était configurée.
- **Un rapport est produit même si l'autorité est en panne**, avec la raison. Le document signé vaut
  d'être eu sans horodatage, et prétendre le contraire signifierait aucun rapport du tout chaque fois
  que l'autorité est injoignable.
- La chaîne est vérifiée sur **tout le registre** et non sur la fenêtre demandée : une chaîne n'a de
  sens que de bout en bout, et un rapport qui vérifierait les liens d'une semaine manquerait une
  modification faite la semaine précédente — qui est la semaine où quelqu'un modifierait.
- La **troncature est tolérée** et la **lacune de numérotation ne l'est pas**. Supprimer une ligne du
  milieu et rechaîner laisse tous les liens valides : c'est la numérotation qui trahit, et elle est
  donc vérifiée séparément.

## Rejeté

- **Horodater le rapport.** Voir §2.
- **Prétendre vérifier le jeton.** Voir §3.
- **Convertir les jetons en octets** pour avoir un « volume » qui ressemble davantage à un volume.
- **Vérifier la chaîne seulement sur la période demandée**, qui est plus rapide et manque l'édition.
- **Une clé de signature dans un réglage**, pour qu'un administrateur puisse la déployer. Une clé
  déployable par script est une clé que plusieurs machines partagent, et le rapport ne dirait plus
  quelle machine l'a émis.
