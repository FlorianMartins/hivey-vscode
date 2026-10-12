# ADR-0035 — Les tâches qui ne demandent pas de vérifier, et ce qu'elles ont trouvé

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : éprouver le chantier 4.4 (demande de Florian)

## Contexte

Le chantier 4.4 — « tu as changé quelque chose et rien n'a vérifié, finis » — s'était déclenché **0
fois sur 56 tâches**, avec une raison mesurée : 51 tâches sur 56 changeaient quelque chose, et dans
les 51 un contrôle tournait. L'ADR-0034 avait laissé la suite ouverte : *« ce qui le mesurerait est
une famille de tâches dont la consigne ne demande pas de vérifier »*.

## Décision — six tâches, et le piège qui les rend utiles

`kind: "noverify"`, six tâches. La propriété définissante est une propriété des **consignes** : aucune
ne contient « test », « vérifie », « lance », « compile », « assure-toi ». Un test de garde le vérifie,
parce qu'un seul « et assure-toi que les tests passent » ajouté en rangeant sortirait silencieusement
une tâche de la famille.

⚠️ **Et le point qu'il ne fallait pas rater** : une tâche dont l'édition naïve est déjà correcte
déclencherait le rappel et ne changerait rien — le mécanisme tournerait sans rien produire. Chaque
fixture porte donc un **second endroit** que le changement doit atteindre : un autre appelant, une
constante dupliquée, un `switch` exhaustif, une liste blanche fermée, un `insert` positionnel. Les
quatre pièges mécanisables ont été éprouvés un par un : l'édition d'un seul fichier échoue bien.

⚠️ **La porte d'honnêteté m'a corrigé** : deux de mes six contrôles **passaient sur la fixture
intacte**, parce qu'ils vérifiaient le *comportement*, qui ne change pas quand on renomme une fonction
ou qu'on réordonne deux paramètres. Ils vérifient désormais aussi le **changement demandé**.

## Le résultat — 4.4 est justifié

| | rappel | déclenché | réussi | annoncé fini à tort |
|---|---|---|---|---|
| `qwen3.7-flash` | **désactivé** | — | **0/6** | 6/6 |
| `qwen3.7-flash` | **actif** | **4/6** | **4/6** | 2/6 |
| `gpt-6.1-sol-pro` | actif | **0/6** | 5/6 | 1/6 |

**Sur un modèle faible, le rappel fait passer la famille de 0 à 4 sur 6**, et la chaîne causale est
observable tâche par tâche : le rappel part, un contrôle tourne, la tâche passe. Le 0/6 n'est pas un
artefact — le modèle a édité sur les six, est sorti proprement sur les six, et n'a vérifié qu'une
fois : le mode d'échec « annoncé fini » à l'état pur.

Sur le modèle fort, il ne se déclenche **jamais** : sans qu'aucune consigne ne le demande, il vérifie
de lui-même. Donc 4.4 n'est pas un filet pour le banc, c'est **un filet pour les modèles bon
marché** — exactement la population que ce produit cherche à rendre utilisable.

Réserve honnête : six tâches est un petit échantillon, et l'écart mesuré du banc complet est de trois
tâches. Mais 0 → 4 sur 6, avec le mécanisme qui part exactement 4 fois, n'est pas une différence de
la taille du bruit.

## ⚠️⚠️ Le défaut que ces tâches ont révélé, et qui corrompait le banc depuis des mois

Les consignes passaient par un shell. Elles étaient interpolées avec `JSON.stringify`, qui produit
des guillemets **doubles** — et dans des guillemets doubles, `sh` exécute toujours les accents graves.

Donc chaque identifiant écrit entre accents graves dans une consigne était **exécuté comme une
commande** : `` `any` `` disparaissait (commande inconnue), et `` `open` `` était **remplacé par la
sortie d'aide de `xdg-open`** — ce que le modèle a signalé lui-même, en demandant de quel statut on
parlait.

**Trois tâches des 56 d'origine étaient touchées**, et tous les chiffres publiés par ce banc les
incluaient : « No `any` and no `as` casts are to remain » arrivait au modèle comme « No and no casts
are to remain », une phrase privée de son sujet.

La consigne passe maintenant en **argv**, sans shell. Et le fond est plus large qu'une faute de
citation : une consigne est du contenu de dépôt qui atteignait `sh -c`. Que ce soit notre propre
contenu était de la chance, pas de la conception.

## Deux autres défauts trouvés en mesurant

**Un refus du fournisseur n'était pas un refus.** La règle « un refus n'est pas un échec » existait
pour le plafond *local* et avait un trou de la taille exacte de ce pour quoi elle a été construite :
OpenRouter a répondu `HTTP 402 — cette requête dépasserait vos crédits disponibles compte tenu de vos
requêtes en vol` à 54 tâches sur 62, et le harnais a enregistré **8 réussites sur 62**. Il aurait
publié **13 %** comme la qualité de cette configuration : pas un chiffre faux, **un chiffre qui ne
parle de rien**. Un 402 ou un 429 est désormais enregistré comme refus, et un jeu qui en contient
n'énonce aucun taux.

**La concurrence se découvre au lieu d'être décidée.** Un fournisseur retient du crédit pour chaque
requête en vol ; sur un modèle à un million de jetons la réserve est grosse, et aucun nombre fixe
n'est juste pour tous les comptes. Le harnais halve sa concurrence à chaque refus, remet la tâche en
file, et ne descend jamais sous un. Il va aussi vite que le compte l'autorise et pas plus — la seule
vitesse qui vaille.

**Et la colonne `time` du tableau se lisait comme une durée** alors qu'elle est la **somme** des
durées de tâches : avec six en parallèle, l'horloge murale en est le sixième. J'avais annoncé « 62
min » et « 65 min » comme des attentes. Renommée `model time`, et le document dit ce qu'elle est.

## Ce que ceci ne fait pas

- **La série de remplacement sur les 62 tâches n'a pas pu tourner.** OpenRouter refuse les requêtes
  de cette taille faute de marge sous la limite mensuelle de la clé (28,47 $ restants, une requête
  minimale passe, un tour d'agent non). Le tableau porte donc ses chiffres **avec leurs réserves**,
  dont celle-ci — ce qui a demandé de lui apprendre à en porter.
- Il ne corrige pas les trois tâches trop dures : elles étaient mesurées avec une consigne mutilée, et
  leur score d'alors n'est pas comparable à celui d'après.
