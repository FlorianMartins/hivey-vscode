# ADR-0011 — Hacher le journal, jamais les données qui sortent

**Date** : 2026-09-10 · **Statut** : accepté

## Contexte

« Hacher les données avant de les envoyer » revient à chaque discussion sur la confidentialité d'un
assistant de code. C'est le geste qui **a l'air** d'une protection, et il n'en est pas une :
l'empreinte d'une adresse e-mail *est* une adresse e-mail pour quiconque possède une liste
d'adresses, et cela vaut pour tout ensemble de valeurs énumérable — noms d'hôtes, identifiants,
noms de personnes. C'est déjà la raison de [ADR-0002](0002-pseudonymisation-reversible.md) : ici la
substitution est réversible avec un coffre qui ne quitte pas la machine, et jamais un condensat.

Il restait pourtant une question à laquelle rien ne répondait, et c'est celle qu'un RSSI pose
réellement. Pas « que dit votre journal », mais **« comment savez-vous que personne ne l'a
modifié »**. Le journal des sorties était un tableau JSON dans l'état de l'espace de travail :
modifiable par tout ce qui peut écrire sur le disque, y compris par la personne auditée.

## Décision

**Le hachage n'apparaît qu'à un seul endroit du produit : le chaînage du journal des sorties.**

Chaque entrée porte un numéro d'ordre et l'empreinte SHA-256 de la précédente. Modifier une ligne
change son empreinte, ce qui casse le lien que porte la suivante, et toutes les suivantes : on ne
peut pas altérer une entrée sans réécrire toute la queue.

Deux détails font la différence entre un contrôle utile et un contrôle décoratif :

- **La numérotation, pas seulement les liens.** Supprimer une entrée du milieu et rechaîner le reste
  laisserait une chaîne qui se vérifie avec un trou dedans — et c'est exactement la modification que
  quelqu'un voudrait faire. Le numéro manquant la trahit.
- **La troncature est tolérée.** Le journal est plafonné à 500 entrées, donc la plus ancienne
  conservée pointe normalement vers une entrée disparue. Traiter cela comme une rupture rendrait le
  contrôle inutile dès que le plafond est atteint, et un contrôle qui crie au loup est un contrôle
  que personne ne lit.

L'export (JSONL ou syslog RFC 5424) emporte les empreintes, pour que la copie chez le collecteur
puisse être comparée à celle de la machine.

## Ce que cela prétend, exactement

Cela ne rend pas la falsification **impossible**. Cela la rend **visible**. C'est tout ce que
prétend un journal inviolable en écriture, et c'est considérablement plus que ne prétend un journal
non chaîné.

Le résidu est nommé dans [`docs/THREAT-MODEL.md`](../THREAT-MODEL.md) : une chaîne purement locale ne
protège pas contre quelqu'un qui réécrit tout le journal depuis le début, faute d'être liée à une
racine de confiance extérieure. C'est l'export vers un collecteur distant qui ferme ce trou, et il
dépend de l'exploitant.

## Conséquences

- Le journal contient toujours **exclusivement des métadonnées** : horodatage, hôte, modèle, jetons,
  coût, catégories anonymisées. Les empreintes portent sur ces métadonnées et sur rien d'autre.
  Ajouter le contenu au journal pour « mieux auditer » resterait le pire compromis possible : un
  journal de ce que vous vouliez garder privé.
- Une empreinte de plus par requête distante, ce qui est négligeable devant la requête.
- La même logique sert la vérification du `.vsix` publié, où l'empreinte n'est pas une protection de
  la vie privée mais une identité : *ce fichier-là* et pas un autre, lié par signature au commit et
  au workflow qui l'ont produit.

## Rejeté

- **Signer chaque entrée avec une clé.** Une clé que l'extension détient est une clé que la personne
  auditée détient. La valeur viendrait d'une clé extérieure, donc d'une infrastructure, donc du
  collecteur distant — que l'export sert déjà.
- **Écrire le journal dans un fichier en append-only.** Les droits POSIX ne survivent pas à un
  `chmod` du propriétaire, et cela n'aurait rien apporté de plus que la chaîne.
