# ADR-0030 — « À savoir » : trois sources, une section, et deux d'entre elles ne dépendent pas du modèle

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : « you should know » (demande de Florian), et la moitié de 4.4 qui en relève

## Contexte

Un assistant termine une tâche et trois sortes de choses vraies et utiles restent non dites.

1. **Ce qu'il a remarqué.** En travaillant sur un fichier il en lit quatre autres, et voit le même
   calcul arrondir dans l'autre sens, un `.env` suivi par git, trois tests ignorés. Il n'avait que
   deux options et les deux sont mauvaises : corriger en silence — ce qui met dans le diff un
   changement que personne n'a demandé — ou ne rien dire, ce qui gaspille la seule lecture du code
   que quelqu'un a payée.
2. **Ce qu'il n'a pas vérifié.** « C'est fait » est bon marché à dire. Un tour qui a modifié quatre
   fichiers et n'a rien lancé n'a pas fini, il s'est arrêté — et la réponse ne permet pas de
   distinguer les deux.
3. **L'état de l'outil.** Le contexte est à 91 %, le modèle choisi n'émet pas d'appels d'outils
   natifs, le budget du jour est presque épuisé. Chacune de ces trois choses change ce que vaudra la
   prochaine réponse, et aucune n'est visible dans la réponse.

## Décision

**Une section, trois sources — et les sources ne sont pas de même nature.**

**Deux des trois sont dérivées de faits que le produit possède déjà** : la trace du tour, le plan,
le budget, et la *forme* des appels d'outils qui sont revenus. Elles ne dépendent donc pas de la
bonne volonté du modèle. C'est la décision de conception qui compte : une fonctionnalité qui
reposerait sur un modèle choisissant d'être prévenant serait absente précisément sur les modèles qui
en ont le plus besoin.

Seule la première source a besoin du modèle, et elle reçoit **un outil** (`note_aside`) plutôt qu'une
convention sur la prose — pour la raison qui a fait du plan un outil : une convention est une
demande, et ce qui revient d'une demande n'a pas de forme.

Quatre règles, toutes sur la retenue :

- **Une notice n'est pas une action.** Rien de ce qui est signalé n'a été modifié, et l'outil le dit
  au modèle dans son résultat même : *« noté pour l'utilisateur. Ne le corrige pas. »* C'est toute la
  valeur : la trouvaille atteint la personne sans que le diff grossisse de ce qu'elle n'a pas demandé.
- **Rien quand il n'y a rien.** Pas de section plutôt qu'une section vide. Ce dépôt l'a déjà appris
  à propos des revues : *« une revue qui trouve toujours quelque chose est une revue que personne ne
  relit »*, et un pied de réponse toujours présent est du mobilier.
- **Borné à cinq.** Une liste de douze apartés est une seconde réponse, et elle enterre la première.
- **Ordonné par ce dont ça parle** : votre code, puis cette réponse, puis cette session. Distance
  décroissante au travail, donc distance croissante à ce sur quoi on peut agir aujourd'hui.

Activé par défaut (`hiveyCode.notices.enabled`) : ça n'envoie rien, ça ne modifie rien, et ce que ça
dit est ce que quelqu'un voudrait savoir. Le désactiver est une préférence, pas une protection.

## Ce que l'essai contre un vrai modèle a trouvé

Au premier essai de bout en bout, la section a affiché deux observations justes avec leur
`fichier:ligne` — et une troisième, fausse : **« le contexte est à 100 % »** sur un modèle qui tient
un million de jetons.

La cause n'était pas la notice : le client terminal fixait sa fenêtre de contexte à **8 000 jetons en
dur**. Et le `CHANGELOG` raconte qu'un chiffre fixe **était** exactement le défaut du panneau — 8 000
jetons, c'est presque toute la fenêtre d'un petit modèle local et une poussière sur un modèle
moderne ; le panneau a été corrigé pour suivre le modèle réellement choisi, et cette moitié a gardé
la constante. C'est la **cinquième** fois dans cette phase que la moitié terminal est la moitié
oubliée, après l'outil de plan, les plafonds de dépense, les compétences et les sous-agents.

La recherche de fenêtre vit maintenant dans le cœur (`core/router/window.ts`) et les deux moitiés
posent la même question. Et c'est la bonne leçon sur cette section : **une notice qui se déclenche à
chaque tour à cause d'une constante périmée est le mobilier qu'elle était censée ne pas être.**

## Une duplication trouvée en chemin

`chat.ts` contenait une copie de l'ensemble `VERIFIERS` du routeur — **les cinq mêmes noms, dans deux
fichiers**, que rien ne tenait synchronisés. Ajouter un vérificateur au routeur aurait silencieusement
cessé de le compter dans le panneau, et le routage appris aurait continué de mesurer l'ancien
ensemble. Supprimée ; les deux moitiés importent `VERIFIER_TOOLS` et `MUTATING_TOOLS`.

## Ce que ceci ne fait pas

- Il ne garantit pas que le modèle remarque quelque chose d'utile. Les sources dérivées sont vraies
  sans lui ; la première vaut ce que vaut le modèle.
- Il ne mesure pas encore son effet. Une notice change ce que la **personne** fait ensuite, pas le
  résultat de la tâche, donc le banc ne peut pas en juger — et le dire est plus honnête que de
  fabriquer une métrique qui bougerait pour une autre raison.
- Il n'archive rien : la section vit avec la réponse, et un aparté sur un fichier édité il y a une
  heure n'est pas quelque chose qu'il faut savoir maintenant.
