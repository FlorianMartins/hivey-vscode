# ADR-0010 — Le préfixe du prompt est un actif, pas un endroit où écrire

**Date** : 2026-09-10 · **Statut** : accepté

## Contexte

Tous les caches de prompt — celui d'Anthropic, marqué explicitement par `cache_control`, ceux
d'OpenAI et d'OpenRouter, implicites — fonctionnent sur un **préfixe**. Le cache est touché jusqu'au
premier octet qui diffère, et manqué sur tout ce qui suit.

Cette propriété a une conséquence que le code ne montre nulle part : une ligne du prompt système qui
change à chaque tour ne coûte pas cette ligne, elle coûte **tout ce qui vient après**. Dans une
conversation avec carte du dépôt, c'est l'essentiel de la facture.

Deux choses vivaient dans ce préfixe et changeaient :

- la **note de dialecte**, dérivée du fichier actif et des pièces jointes — donc différente dès que
  l'utilisateur change d'onglet ;
- la **carte du dépôt** elle-même, reclassée autour du fichier édité — donc reconstruite à chaque
  changement d'onglet, et différente à chaque fois.

Autrement dit, changer d'onglet jetait le cache de prompt de toute la conversation. Personne
n'aurait jamais fait le lien entre les deux, et le taux de cache — journalisé depuis le début — n'a
jamais été montré à personne.

## Décision

**Ce qui est stable et ce qui change sont deux moitiés distinctes, et la frontière est tenue par le
type, pas par la vigilance.**

`stablePrompt()` prend les parties stables comme **champs nommés** : le prompt du mode, la note
d'espace de travail, les règles de la maison, l'index de la base de connaissances, la liste des
compétences. `turnDirectives()` prend ce qui suit l'utilisateur : la note de dialecte, le
participant nommé. Le second est envoyé **après** le transcript, ce qui a l'avantage supplémentaire
d'être l'endroit qu'un modèle lit en dernier.

La carte du dépôt est **gelée** pour la durée d'une conversation. Elle est reconstruite aux moments
où le préfixe est de toute façon réécrit : nouvelle conversation, compactage, ou demande explicite.

Le taux de cache est affiché, dans l'infobulle de l'anneau de contexte.

## Pourquoi une carte périmée ne coûte rien

C'est le point qui rend la décision facile. La carte est une liste de chemins et de symboles de
tête ; le modèle peut demander n'importe quel fichier. Le classement ne décide donc pas de **ce que
le modèle peut voir**, il décide de **ce qu'il voit en premier**. Une carte en retard d'un changement
d'onglet propose un ordre légèrement moins bon, une fois, contre un cache de prompt conservé sur
toute la conversation.

## Conséquences

- Ajouter « juste une ligne sur le fichier ouvert » au prompt système redevient un changement
  délibéré qu'un relecteur voit, au lieu d'une concaténation de plus.
- L'invariant ne se lit pas dans le code, donc il est tenu par un test d'intégration : deux tours,
  un fichier différent ouvert à chaque fois, et le premier message des deux requêtes comparé **octet
  par octet**. Retirer le correctif fait tomber ce test.
- Le classement de la carte peut maintenant utiliser la **question** (voir
  [ADR-0011](0011-la-carte-est-classee-par-la-question.md)) sans coût de cache : il est calculé une
  fois, à l'ouverture de la conversation.
- Un utilisateur qui veut une carte fraîche a une commande pour cela ; ce n'est plus un effet de
  bord de son navigation.

## Rejeté

- **Marquer plusieurs segments comme cachables.** Anthropic accepte quatre points de rupture, mais
  les autres fournisseurs n'en acceptent aucun : optimiser pour un seul fournisseur en laissant les
  autres manquer aurait été une complexité pour un cas.
- **Reconstruire la carte à chaque tour et espérer.** C'était l'état antérieur.
