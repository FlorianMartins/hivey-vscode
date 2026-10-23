# 6. Le contexte

[← Chapitre précédent](05-les-trois-modes-et-les-outils.md) · [Sommaire](README.md) · [Chapitre suivant →](07-rag-et-memoire.md)

Un modèle ne sait **rien** de votre projet. Il a appris sur du code public jusqu'à une certaine date,
et votre dépôt n'en fait pas partie. Tout ce qu'il saura de votre code, c'est ce qu'on lui aura mis
sous les yeux dans la question.

C'est le travail le moins visible de l'outil et c'est celui qui décide de la qualité des réponses.
Un assistant qui répond mal répond souvent correctement **à la question qu'on lui a posée** : ce
qu'on a oublié de lui montrer n'existait pas pour lui.

## La carte du dépôt

Envoyer tout le projet est impossible : il ne tiendrait pas dans la fenêtre
([chapitre 2](02-le-modele.md)), et il coûterait une fortune. On envoie donc une **carte** : la liste
des fichiers et, pour chacun, les **symboles** qu'il déclare — les noms des fonctions, des classes,
des types — sans leur contenu.

C'est l'équivalent d'une table des matières. Le modèle ne sait pas ce que fait `calculerTVA`, mais il
sait qu'elle existe, dans quel fichier, à quelle ligne. Il peut alors **demander** à lire ce fichier
([chapitre 5](05-les-trois-modes-et-les-outils.md)) au lieu de deviner.

## Les règles du projet

Un dépôt peut aussi dire au modèle comment y travailler : « les tests se lancent avec `npm test` »,
« on n'ajoute pas de bibliothèque », « les messages de commit sont en anglais ». Ces règles s'écrivent
dans un fichier texte du projet, et Hivey Code lit le premier qu'il trouve, dans cet ordre :
`.hiveycode/instructions.md` (le sien, prioritaire), puis `AGENTS.md` et `CLAUDE.md` à la racine —
ceux que la plupart des dépôts écrivent aujourd'hui pour tous les agents de code et pour Claude
Code —, puis `.github/copilot-instructions.md`. Ils ne s'additionnent pas : le premier qui dit quelque
chose l'emporte. Son texte est placé dans le prompt système de chaque tour, survit à tous les
compactages, et une modification compte dès la question suivante.

Ce sont des **consignes**, pas des garanties ([chapitre 5](05-les-trois-modes-et-les-outils.md)) :
elles orientent le modèle, elles ne lui donnent ni ne lui retirent aucun outil.

## Ce que vous joignez vous-même

- **Le fichier ouvert**, proposé et envoyé par défaut — la sélection s'il y en a une, le fichier
  entier sinon. Un clic le met de côté.
- **Des fichiers choisis**, par le menu `+` ou en les déposant depuis l'explorateur.
- **Une capture d'écran, une trace d'erreur, un journal** — collés ou déposés. Un collage court reste
  dans la zone de saisie ; un mur de texte devient une pièce jointe au lieu d'enterrer ce que vous
  écriviez.
- **Une conversation précédente**, attachée depuis l'historique. « Qu'est-ce qu'on avait décidé pour
  les factures la semaine dernière » est une question sur le travail d'aujourd'hui.

## La notation `#`

Pour désigner précisément ce que vous voulez joindre, on écrit dans la question :

| Notation | Ce qu'elle attache |
|---|---|
| `#file:chemin` | ce fichier |
| `#selection` | ce que vous avez sélectionné |
| `#changes` | vos modifications non encore enregistrées |
| `#problems` | les erreurs que l'éditeur signale |
| `#codebase` | la carte du dépôt |
| `#terminal` | la dernière sortie du terminal |
| `#sym:nom` | le symbole qui porte ce nom |

C'est **la notation de GitHub Copilot**, délibérément : on ne devrait pas avoir à apprendre un second
vocabulaire pour changer d'outil.

Un point qui touche directement la confidentialité : tout ça est **résolu sur votre machine** avant
que quoi que ce soit ne parte. C'est ce qui permet d'attacher du code non publié à une conversation
avec un modèle local — rien n'a eu besoin de sortir pour que la notation fonctionne.

## Le budget, et ce qui se passe quand on le dépasse

Chaque élément de contexte coûte des jetons, et la fenêtre est finie. L'outil tient donc un
**budget** et décide quoi garder.

Quatre choix de conception qui se voient à l'usage :

- **Le budget suit la fenêtre du modèle réellement choisi**, et pas un nombre fixé une fois pour
  toutes : toute la fenêtre, moins une réserve pour la réponse et les étapes suivantes (un
  vingtième de la fenêtre, au moins de quoi écrire une réponse), tant que
  `hiveyCode.context.maxTokens` vaut 0 (le défaut) ; 8 000 jetons si la fenêtre est inconnue. Avec une valeur fixe de 8 000 jetons, les
  conversations étaient résumées au bout de trois échanges et la réponse venait du résumé — alors que
  8 000 jetons sont une poussière pour un modèle moderne.
- **Un gros fichier se lit par la partie utile.** Un fichier de plus de 800 lignes demandé en entier
  rend son plan — chaque fonction, classe et export avec sa ligne — et ses premières lignes ; le
  modèle lit ensuite la partie qu'il lui faut, par une plage de 2 000 lignes au plus, ou cherche
  d'abord la bonne ligne. Rien n'est inaccessible, mais un fichier de 14 000 lignes lu d'un bloc
  encombrait chaque étape suivante du tour. Des lignes que la conversation contient déjà, sans
  modification ni commande depuis, ne sont pas relues : le modèle est renvoyé à sa copie.
- **Une pièce jointe trop grosse arrive sous forme de plan** : tous les symboles qu'elle déclare avec
  leur ligne, suivis de son début — plutôt que ses N premières lignes et rien sur le reste. Un plan
  dit *de quoi parle* le fichier ; ses cent premières lignes disent seulement comment il commence.
- **Un fichier joint dans cinq échanges est envoyé une fois**, dans le message le plus proche de la
  question.

## Le compactage

Quand la conversation remplit son budget, on **compacte** : le modèle écrit un résumé de l'échange,
et c'est le résumé qui est envoyé à partir de là.

Ça se fait **tout seul** (`hiveyCode.context.autoCompact`, activé par défaut) : arrivée aux trois
quarts du budget, la conversation est résumée avant l'envoi de la question, qui part juste après le
résumé. Un **Stop** pendant le résumé annule aussi ce qui devait suivre. Réglage désactivé, on vous
**propose** de résumer à partir de 70 %, et un contexte plein vous pose la question au lieu d'une
erreur. `/compact` le fait à la demande.

Si le contexte se remplit **en pleine tâche**, la tâche ne s'arrête pas. Les plus anciens résultats
d'outils sont d'abord raccourcis (le modèle peut les relire mot pour mot,
[chapitre 7](07-rag-et-memoire.md)). Si ça ne suffit plus, le tour **se résume lui-même et continue**,
comme le fait Claude Code : le même modèle, sans outils ni réflexion, écrit le compte rendu du travail
— la demande mot pour mot, les fichiers modifiés, les commandes lancées, l'état des erreurs, la
suite — et le tour repart de ce compte rendu. Ce qui ne change jamais reste tel quel : le prompt
système, les règles du projet et la carte du dépôt, c'est-à-dire le début de la requête, celui que
garde le cache (plus bas). Trois fois au plus par tour ; au-delà, ce qui a déjà été fait est noté dans
la réponse, la conversation est résumée, et la tâche reprend là où elle s'était arrêtée.

Dans tous les cas, le résumé part de ce que l'agent a **fait**, pas seulement de ce qu'il a écrit :
il reçoit la liste des actions, échecs marqués, et dit où en sont les erreurs. Avant, un fichier
modifié ou une commande lancée n'y figurait que si la réponse le mentionnait.

Deux choses à savoir :

- **Rien n'est effacé à l'écran.** Tous les échanges restent visibles, grisés, à un clic de revenir.
  Ce qui change, c'est ce qui *part*, pas ce que vous voyez.
- **Le gain est mesuré et affiché** (`8 200 → 900 jetons`), pas affirmé. Une fonctionnalité qui
  prétend économiser quelque chose sans montrer combien est une fonctionnalité qu'on ne peut pas
  juger.

## Le cache de prompt

Une optimisation qui mérite son paragraphe, parce qu'elle décide de factures entières.

Certains fournisseurs facturent **moins cher** la partie d'une requête qu'ils ont déjà vue. Comme une
conversation renvoie tout depuis le début à chaque tour ([chapitre 2](02-le-modele.md)), le même
début est envoyé dix fois — et peut donc être facturé dix fois au prix réduit, à condition que ce
début soit **identique octet pour octet**.

D'où une règle du projet qui ressemble à un détail et n'en est pas un : **le début du prompt est un
actif**. Y ajouter « juste une ligne sur le fichier ouvert » casse la correspondance et fait payer
plein tarif tout le reste de la conversation. Cette règle est tenue par un test qui envoie deux tours
avec un fichier différent ouvert et compare le premier message **octet par octet**.

Votre propre serveur suit la même mécanique, sans facture mais pas sans effet : llama.cpp ne relit une
requête qu'à partir du premier caractère qui change, et relire toute une conversation prend du temps à
chaque question. Deux choses changeaient ce début à presque chaque tour, et ne le changent plus. Le
marqueur qui encadre les fichiers joints est fixé une fois par conversation, au lieu d'être tiré à
nouveau à chaque tour. Et la carte du dépôt n'est plus refaite dès qu'un fichier est créé ou supprimé
— ce que l'agent fait lui-même presque à chaque tour : elle est gardée, et les fichiers créés ou
supprimés depuis sont listés après l'historique. Au-delà de 50 changements, ou à la demande, elle est
refaite ; les dépendances et la sortie de build (`node_modules`, `dist`…) ne comptent pas.

## Dans Hivey Code

Chaque échange peut être **rendu muet** (il reste affiché, il ne part plus), **épinglé** (il survit à
la coupe), modifié ou supprimé. C'est le levier le plus direct qui existe sur la qualité **et** sur
le coût : une conversation où traîne une fausse piste de vingt minutes continue de l'envoyer au
modèle à chaque tour, et le modèle continue d'en tenir compte.

[← Chapitre précédent](05-les-trois-modes-et-les-outils.md) · [Sommaire](README.md) · [Chapitre suivant →](07-rag-et-memoire.md)
