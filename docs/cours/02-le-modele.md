# 2. Le modèle

[← Chapitre précédent](01-le-decor.md) · [Sommaire](README.md) · [Chapitre suivant →](03-ou-tourne-le-modele.md)

## Ce que c'est, vraiment

Un **modèle de langage** (en anglais *Large Language Model*, abrégé **LLM**) est un programme qui
fait **une seule chose** : étant donné un début de texte, il devine le mot le plus probable pour
continuer. Puis il recommence, en incluant le mot qu'il vient de produire. Et encore. C'est tout.

Ça paraît trop simple pour expliquer ce que fait ChatGPT. C'est pourtant exactement ça. La raison
pour laquelle « deviner le mot suivant » produit des phrases justes, du code qui fonctionne et des
raisonnements qui tiennent, c'est que pour bien deviner le mot suivant dans *n'importe quel* texte,
il faut avoir capturé énormément de régularités sur la façon dont le monde est décrit.

Deux conséquences qu'il faut avoir en tête en permanence :

1. **Un modèle ne sait pas qu'il ne sait pas.** Il produit toujours la continuation la plus
   plausible. Quand il n'a pas l'information, la continuation la plus plausible est une invention
   bien formée. C'est ce qu'on appelle une **hallucination** : une réponse fausse énoncée avec le
   même aplomb qu'une réponse juste. Ce n'est pas un bug qu'on corrigera ; c'est le mécanisme.
2. **Un modèle n'a aucune mémoire entre deux questions.** À chaque fois, on lui renvoie toute la
   conversation depuis le début. Quand vous avez l'impression qu'il « se souvient » de ce que vous
   avez dit il y a dix minutes, c'est qu'on lui a réexpédié les dix minutes.

## Les jetons

Un modèle ne lit pas des lettres ni vraiment des mots : il lit des **jetons** (*tokens*). Un jeton
est un morceau de texte fréquent — souvent un mot court entier, parfois un bout de mot, parfois juste
un espace ou un signe de ponctuation.

En gros, **100 jetons ≈ 75 mots** en français. Le mot « anticonstitutionnellement » coûte plusieurs
jetons ; le mot « le » en coûte un.

Pourquoi c'est l'unité qui compte partout dans ce cours : **c'est l'unité de facturation et l'unité
de limite**. Les fournisseurs facturent au jeton (voir [chapitre 10](10-le-cout.md)), et les modèles
ont une limite exprimée en jetons.

## La fenêtre de contexte

La **fenêtre de contexte** est la quantité de texte qu'un modèle peut avoir sous les yeux en une
fois : la question, la conversation, les fichiers joints, et la réponse qu'il est en train d'écrire.
Tout doit tenir dedans.

Les ordres de grandeur ont beaucoup bougé et continueront : un petit modèle qu'on fait tourner chez
soi tourne souvent autour de 8 000 à 32 000 jetons ; les gros modèles payants sont au-delà de
200 000. Retenez le principe plutôt que les chiffres : **un fichier de code, c'est vite des milliers
de jetons**, donc la fenêtre se remplit plus vite qu'on ne le croit, et quelqu'un doit décider ce
qu'on met dedans. C'est tout le sujet du [chapitre 6](06-le-contexte.md).

Quand la conversation dépasse la fenêtre, il faut faire de la place. Deux façons : **tronquer**
(jeter le début — brutal, et on perd ce qui avait été décidé) ou **compacter** (demander au modèle de
résumer la conversation, et remplacer la conversation par le résumé). Hivey Code compacte, et
**n'efface rien à l'écran** : les échanges restent visibles, grisés, à un clic de revenir.

## La taille d'un modèle, et pourquoi ça se voit

Vous verrez des noms comme `qwen2.5-coder:7b` ou `llama3.1:70b`. Le nombre suivi de **`b`** est le
nombre de **paramètres**, en milliards (*billions* en anglais). Un paramètre est un nombre réglé
pendant l'entraînement ; un modèle, c'est une très grande table de ces nombres.

- **7b** = 7 milliards de paramètres. Tient sur un ordinateur portable correct. Écrit du code simple
  correctement, se perd sur les tâches longues.
- **70b** = dix fois plus. Nettement meilleur, demande une machine sérieuse.
- Les modèles des grands fournisseurs sont plus gros encore et leur taille n'est pas publiée.

Un modèle brut occupe trop de place, alors on le **quantise** : on remplace ses nombres par des
approximations plus courtes. Un modèle de 7 milliards de paramètres passe ainsi d'environ 28 Go à
4 ou 5 Go, pour une perte de qualité faible. C'est la raison pour laquelle faire tourner un modèle
chez soi est devenu possible.

La différence se voit à l'usage, et le [chapitre 12](12-la-qualite-mesuree.md) la **mesure** sur ce
projet : un modèle de 7 milliards de paramètres a obtenu **0 sur 56** sur les tâches du banc d'essai,
et — c'est le plus instructif — dans 51 cas sur 56 il n'a **même pas essayé** d'agir.

## Les réglages dont on parle

- **Le prompt** (ou *invite*) est le texte qu'on envoie au modèle. Il contient en général des
  consignes que l'utilisateur ne voit pas — le **prompt système** — qui disent au modèle ce qu'il
  est, ce qu'il peut faire et comment répondre.
- La **température** règle le hasard. À 0, le modèle prend toujours le mot le plus probable : il est
  répétitif mais prévisible. Plus haut, il varie : utile pour écrire, risqué pour du code.
- Certains modèles savent **raisonner à voix haute** avant de répondre : ils produisent d'abord un
  brouillon de réflexion. Ça améliore les réponses difficiles et ça coûte des jetons. Hivey Code
  l'affiche **pendant** qu'il s'écrit — c'est le seul moment où c'est intéressant — puis le replie
  dès que la réponse commence, et ne le renvoie jamais au modèle.

## Dans Hivey Code

Le projet ne fournit **aucun modèle** et n'en entraîne aucun. Il parle à celui que vous choisissez :
le vôtre sur votre machine, celui de votre entreprise sur son réseau, ou celui d'un fournisseur si
vous en payez un. C'est l'objet du [chapitre 3](03-ou-tourne-le-modele.md).

Deux choix de conception qui découlent directement de ce chapitre :

- **La taille du contexte suit le modèle réellement choisi**, au lieu d'être un nombre fixé une fois.
  Un budget de 8 000 jetons, c'est presque toute la fenêtre d'un petit modèle local et une poussière
  pour un gros modèle moderne. Avec un nombre fixe, les conversations étaient résumées au bout de
  trois échanges et la réponse venait du résumé.
- **Aucune version de modèle n'est écrite en dur** dans le projet. Les noms et les prix changent tous
  les mois ; un catalogue se rafraîchit tout seul. C'est aussi pourquoi ce cours ne vous donne pas
  « le meilleur modèle » : la réponse d'aujourd'hui serait fausse dans six mois.

[← Chapitre précédent](01-le-decor.md) · [Sommaire](README.md) · [Chapitre suivant →](03-ou-tourne-le-modele.md)
