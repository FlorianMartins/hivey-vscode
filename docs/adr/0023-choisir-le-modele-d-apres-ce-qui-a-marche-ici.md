# ADR-0023 — Choisir le modèle d'après ce qui a marché *ici*

**Date** : 2026-10-03 · **Statut** : accepté

## Contexte

L'escalade décide déjà sur des preuves plutôt que sur une intuition
([ADR-0009](0009-escalader-sur-un-echec-constate.md)) : le modèle local essaie, les tests tranchent, et
seul un échec **prouvé** achète un appel payant.

Ce qu'elle ne sait pas faire, c'est **se souvenir**. Chaque conversation repart de la même hypothèse,
donc un dépôt où le modèle 7B réussit neuf fois sur dix paie exactement la même première tentative
qu'un dépôt où il n'a jamais marché une seule fois. Le modèle cher est toujours le choix sûr et
toujours le mauvais défaut.

## Décision

**Mesurer, par dépôt, par genre de tâche et par modèle, le taux de réussite constaté par
`verifyTurn()` — et choisir le modèle le moins cher dont le taux observé dépasse un seuil.**

Trois limites rendent la chose défendable plutôt qu'astucieuse, et chacune a son test.

### 1. Jamais hors de ce que l'utilisateur a autorisé

Les candidats sont **exactement deux** : le modèle de conversation qu'il a configuré et son modèle
d'escalade. Rien ici ne peut produire un modèle absent de cette liste, **quel que soit son
historique** — un taux de réussite observé ne justifie pas d'envoyer une question à un modèle que
personne n'a autorisé.

Un préréglage Hivey est délibérément exclu : c'est déjà un routeur, et router un routeur produit un
choix qu'on ne peut pas expliquer en une phrase.

### 2. Jamais de confiance trop tôt

**Une réussite n'est pas un taux.** En dessous d'un nombre minimal d'essais, un modèle n'a pas
d'historique — et « pas d'historique » n'est **pas** « mauvais » : l'ordre configuré gagne, et la
phrase le dit ainsi plutôt que de laisser croire que le modèle économique a échoué.

Le seuil est haut (80 %) parce que se tromper coûte **un tour perdu ET une escalade payante** : le
modèle économique doit avoir fiablement raison, pas souvent raison.

### 3. Une mesure n'existe que si quelque chose a vérifié

Un tour qui n'a rien exécuté n'est ni une réussite ni un échec, et **n'est pas enregistré**. Sans
cela, un modèle finit avec un historique parfait après avoir répondu à vingt questions que personne
n'a vérifiées.

### 4. Toujours expliqué avec les vrais chiffres

« Choisi : 9 sur 10 dans ce dépôt » est une phrase avec laquelle on peut être en désaccord. « Choisi
par le routeur appris » est une phrase qu'on peut seulement ne pas croire.

### 5. L'exploration ne remesure jamais ce qui est déjà mesuré

Dépenser un tour à remesurer un modèle qui a quarante essais derrière lui n'achète rien ; un modèle
que personne n'a essayé est la seule chose dont une mesure puisse parler. Et le tirage est **injecté**,
parce qu'une fonctionnalité dont le comportement dépend d'un tirage non testable est une
fonctionnalité que personne ne peut raisonner le jour où elle surprend.

### 6. ⚠️ Désactivé par défaut

Ceci n'est pas dans la feuille de route et c'est un arbitrage que j'assume : **un routeur qui apprend
change quel modèle répond**, et ce n'est pas un changement à imposer le matin où quelqu'un met
l'extension à jour. Celui qui l'active a décidé que « moins cher quand c'est prouvé » est ce qu'il
veut ; celui qui ne l'active pas obtient exactement ce qu'il a configuré.

## Conséquences

- Les mesures vivent dans l'état de l'**espace de travail**, donc par dépôt naturellement : deux
  copies du même projet sont deux jeux de mesures, et c'est correct — le petit modèle peut réussir
  dans l'une et pas dans l'autre.
- Deux commandes : **ce qui a été appris ici** et **oublier ce qui a été appris ici**. Des données
  locales dont personne ne peut voir le contenu ni se débarrasser ne sont pas des données locales,
  c'est un cache.
- Une **escalade n'est jamais réroutée** par ce qui a été appris : elle existe parce qu'un modèle a
  déjà échoué, et l'avis du routeur appris sur ce modèle est l'avis qui vient de perdre.
- Le genre de tâche vient de **ce que le tour a fait** et non de la façon dont la question était
  formulée : un tour qui a modifié des fichiers est un `edit`, quelle que soit la phrase. Et les
  genres sont volontairement peu nombreux — une découpe plus fine n'atteint jamais une taille
  d'échantillon.

## Rejeté

- **Dériver les candidats d'un catalogue** pour avoir plus de choix. Voir §1.
- **Un seuil bas**, pour économiser davantage. Voir §2 : le coût d'un faux positif est double.
- **Compter les tours non vérifiés** comme des réussites, ce qui rendrait tout modèle excellent.
- **Un historique global** plutôt que par dépôt. C'est la moyenne de deux situations différentes, et
  elle a tort dans les deux.
- **Activé par défaut.** Voir §6.
