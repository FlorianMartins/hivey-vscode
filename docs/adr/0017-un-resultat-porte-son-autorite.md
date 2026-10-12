# ADR-0017 — Un résultat porte son autorité et ses limites

**Date** : 2026-10-02 · **Statut** : accepté

## Contexte

Trois chantiers de la phase 1 produisent des réponses que quelqu'un va **citer** : « qui utilise ce
fichier » (1.3) finit collé dans une demande de modification, « quel index poser » (1.4) finit dans
un ticket de performance, « que veut dire CPF4131 » (1.5) finit dans une procédure de reprise.

Pour les trois, la mauvaise réponse n'est pas une réponse fausse. C'est une réponse **vraie dont on
ignore ce qu'elle vaut** :

- `DSPPGMREF` est un fait, une recherche dans les sources est un indice, et les deux se présentent
  comme une liste de noms ;
- `QSYS2.SYSIXADV` est la liste des index que l'optimiseur a **souhaités**, et lue comme une liste de
  tâches elle donne une table à quatorze index où chaque insertion paie les quatorze ;
- le texte d'IBM dit ce qui s'est passé ; une note interne dit ce que cette maison a décidé, peut-être
  en 2011 — et un modèle qui ne les distingue pas présentera une procédure périmée avec l'autorité
  d'un manuel.

Dans les trois cas, le dommage ne vient pas du contenu mais de l'**autorité implicite** d'une sortie
d'outil bien formatée.

## Décision

**Tout résultat de ces outils porte, dans le résultat lui-même : sa méthode, ce que cette méthode ne
peut pas voir, et ce qui n'a pas pu être lu.** Pas en annexe, pas sur demande, pas dans la
documentation de l'outil — dans le texte que le modèle reçoit et recopiera.

Quatre règles concrètes en découlent, et elles sont testées une par une :

1. **La méthode est la première ligne.** `ibmi_impact` commence par « d'après les listes de
   références des objets (DSPPGMREF) » ou « d'après une recherche dans les sources » : la différence
   entre un fait et une piste doit se lire avant la liste.
2. **Zéro n'est jamais « rien ».** « Aucun programme de ces bibliothèques n'enregistre de référence »
   est un fait sur ces bibliothèques, pas sur le système. « L'optimiseur n'a demandé aucun index »
   n'est pas « les index sont bons » : le conseiller est vidé par un IPL. « Je n'ai reconnu aucun
   test » n'est pas « aucun test n'a échoué » (ADR-0016).
3. **Une lacune est nommée.** Ce qui n'a pas pu être lu est dit — la statistique absente, la
   bibliothèque illisible, le fichier de messages non autorisé. Un modèle à qui l'on annonce
   seulement un résultat maigre le complète par déduction ; un modèle à qui l'on dit ce qui manque le
   demande.
4. **Deux autorités ne se mélangent pas.** Le texte d'IBM d'abord et étiqueté comme tel ; les notes
   de la maison ensuite, étiquetées comme celles de l'organisation et « possiblement périmées », avec
   la consigne de dire sur laquelle des deux on s'appuie.

Et un corollaire qui n'est pas de la prose : **un chiffre absent reste absent.** `Number("")` vaut 0
et 0 est fini, donc une colonne que le catalogue n'a pas renvoyée devenait « cette table a zéro
ligne » — une mesure que personne n'a faite. C'est la même règle que le rapport d'évaluation
([ADR-0015](0015-une-evaluation-qui-ne-peut-pas-inventer-un-chiffre.md)), appliquée au catalogue.

## Conséquences

- Les sorties sont plus longues. C'est le prix, et il est payé une fois par appel d'outil contre un
  risque qui se paie une fois par décision prise sur une mauvaise base.
- Les limites sont **des données, pas des commentaires** : `PROGRAM_REFERENCE_LIMITS`,
  `SOURCE_SEARCH_LIMITS`, `ADVICE_LIMITS` sont des constantes exportées, donc un test peut exiger
  qu'elles soient présentes dans la réponse. Une mise en garde écrite en commentaire n'atteint
  jamais l'utilisateur.
- ⚠️ **Les références croisées ARCAD ne sont pas appelées** (1.3). Elias les a réellement, et le
  catalogue d'endpoints REST d'ARCAD n'est pas publié ; inventer un chemin produirait une intégration
  qui casse chez le client. La forme honnête de « utiliser ARCAD quand il est là » est donc : dire
  qu'il est là, dire qu'il sait mieux, et nommer la porte (`arcad_rest`, avec un chemin fourni par
  l'administrateur ARCAD). C'est la position déjà écrite en tête de `integrations/arcad.ts`.
- L'index des identifiants de message cités dans la documentation interne (1.5) est **calculé à la
  lecture** et non stocké à côté des notes — pour la raison que la base de connaissance donne
  déjà pour sa propre recherche : un second index est une seconde chose à tenir à jour, et celle qui
  dérive est celle que personne ne regarde.
- **Non vérifié** : aucun de ces trois outils n'a tourné contre une partition. Les décisions
  ci-dessus sont testées sur des fixtures ; les requêtes et les noms de colonnes ne le sont pas, d'où
  la lecture par `cell()` sous plusieurs orthographes partout.

## Rejeté

- **Mettre les limites dans la description de l'outil** plutôt que dans le résultat. La description
  est lue une fois, au moment où le modèle choisit l'outil ; le résultat est ce qu'il recopie.
- **Un drapeau `confidence: "high" | "low"`.** Un mot abstrait ne dit pas *quoi* vérifier. « Un champ
  atteint par un mot-clé PREFIX sera manqué » est actionnable ; « confiance faible » ne l'est pas.
- **Recommander un index.** L'outil rapporte les chiffres de l'optimiseur ; la décision coûte du
  disque et ralentit chaque écriture, et elle appartient à quelqu'un qui connaît la charge.
