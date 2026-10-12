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

Deux choix de conception qui se voient à l'usage :

- **Le budget suit la fenêtre du modèle réellement choisi**, et pas un nombre fixé une fois pour
  toutes. Avec une valeur fixe de 8 000 jetons, les conversations étaient résumées au bout de trois
  échanges et la réponse venait du résumé — alors que 8 000 jetons sont une poussière pour un modèle
  moderne.
- **Une pièce jointe trop grosse arrive sous forme de plan** : tous les symboles qu'elle déclare avec
  leur ligne, suivis de son début — plutôt que ses N premières lignes et rien sur le reste. Un plan
  dit *de quoi parle* le fichier ; ses cent premières lignes disent seulement comment il commence.
- **Un fichier joint dans cinq échanges est envoyé une fois**, dans le message le plus proche de la
  question.

## Le compactage

Quand la conversation remplit son budget, on **compacte** : le modèle écrit un résumé de l'échange,
et c'est le résumé qui est envoyé à partir de là.

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

## Dans Hivey Code

Chaque échange peut être **rendu muet** (il reste affiché, il ne part plus), **épinglé** (il survit à
la coupe), modifié ou supprimé. C'est le levier le plus direct qui existe sur la qualité **et** sur
le coût : une conversation où traîne une fausse piste de vingt minutes continue de l'envoyer au
modèle à chaque tour, et le modèle continue d'en tenir compte.

[← Chapitre précédent](05-les-trois-modes-et-les-outils.md) · [Sommaire](README.md) · [Chapitre suivant →](07-rag-et-memoire.md)
