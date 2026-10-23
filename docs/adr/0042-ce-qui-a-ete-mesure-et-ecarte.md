# 0042 — Ce qui a été mesuré et écarté : le journal de contexte et le niveau « Auto »

**Statut** : accepté · **Date** : 2026-10-23

## Contexte

Florian : « parfois il fait la tâche en 3 minutes et parfois il passe 1 h 30 sur une tâche simple, à
cause du contexte rempli », puis « intégrer le concept de Jev AI dans ce projet ». Deux pistes en sont
sorties, toutes deux construites, testées et mesurées, aucune fusionnée :

1. **Mieux traverser un résumé.** Quand la fenêtre se remplit en pleine tâche, le tour se résume et
   continue (compactage en direct, #82) ; chaque sortie longue reste retrouvable mot pour mot par
   `recall`. L'idée : ajouter après le résumé ce que le modèle risque de perdre.
2. **Le niveau « Auto ».** Avant chaque demande, le même modèle, réflexion coupée, répond à une
   question fermée — « simple ou complexe ? » — et la probabilité de la réponse (lue dans les
   `logprobs` de llama.cpp, comme le font les « modèles de décision ») choisit Bref ou Standard.

## Ce qui a été mesuré

Qwen3.8-27B auto-hébergé. Les idées de contexte n'agissent que sur les tâches qui se résument : à
16 384 jetons, seules ~5 des 60 tâches du banc le font, et un témoin (un outil proposé que le modèle
n'a jamais appelé) a « perdu » 3 points — **le banc de 60 tâches a un bruit de ±3**. Elles ont donc été
jugées sur un **banc ciblé** : les 6 tâches longues, fenêtre de 12 288 jetons, 3 passages de chaque
côté. La mémoire seule y réussit 45 passages sur 54 (83 %).

| Variante | Banc ciblé | Banc de 60 tâches |
|---|---|---|
| Journal exact de ce qui a été fait (fichiers, commandes, dernier résultat) | — | 57 contre 56 |
| Journal + fichiers entiers épinglés + dernières étapes mot pour mot | — | 56 contre 59 |
| Journal sélectif : extraits (zones modifiées, lignes citées par l'erreur) | **12/18** contre 16/18 | 56 contre 59 |
| Raccourcir les anciens appels déjà appliqués avant de résumer | 15/18, +27 % de temps | 59 contre 59 |
| Carnet de faits tenu par le modèle (`note`) | — | jamais appelé ; 55 contre 58 |
| Résumer plus tôt, juste après une commande réussie | **14/18** contre 16/18 | 58 contre 59 |

Auto, sur 70 tâches (les 60 et 10 tâches simples ajoutées), même code, Standard contre Auto :
**68 contre 69**, +11 % de temps. Le classement est juste (tâches simples à 98–100 % « simple »,
difficiles sous 10 %), mais les 18 tâches envoyées en Bref ont pris **335 s contre 334 s**.

## Décision

**Aucune n'est retenue.** La mémoire seule (`recall`, `search_memory`) et le compactage en direct
restent ce qu'il y a de mieux mesuré.

Ce que les chiffres disent, pour ne pas refaire le chemin :

- **Ajouter du contenu après un résumé coûte**, quel qu'il soit. Les variantes avec fichiers ou
  extraits perdent sur les mêmes tâches (`js-pager-overflow`, `py-pricing-refactor`) : la requête
  suivant le résumé occupait jusqu'à la moitié de la fenêtre, le résumé suivant venait plus vite, et le
  modèle s'appuyait sur les morceaux donnés au lieu de relire ce qui lui manquait.
- **Résumer plus tôt multiplie les résumés**, et chacun perd un peu. Le débordement reste le bon moment.
- **Ce qui remplit la fenêtre n'est pas ce qu'on croit** : près des 16 k, la réflexion pèse 34 %, les
  appels du modèle 26 %, les sorties d'outils 15 % seulement — et la réflexion ancienne est déjà
  retirée avant tout résumé.
- **Qwen ne réfléchit déjà presque pas sur une demande simple**, en Standard comme en Bref : le budget
  de Bref (#89) coupe les longues réflexions, il n'a rien à couper sur un renommage. La question de
  classement, elle, coûte 2 à 4 s à chaque demande.

## Conséquences

- Les branches restent hors de `main` ; les 10 tâches simples du banc ne sont pas ajoutées, puisqu'elles
  ne servaient qu'à mesurer Auto.
- Une nouvelle idée sur le contexte se mesure au banc ciblé, pas aux 60 tâches : leur bruit est plus
  grand que l'effet cherché.
- La lecture d'une décision par probabilité reste la bonne technique si une décision vaut un jour la
  peine d'être prise — elle a fonctionné ; c'est la décision « quel niveau de réflexion » qui n'avait
  rien à gagner sur ce modèle.
