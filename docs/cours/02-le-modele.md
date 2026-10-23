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

La différence se voit à l'usage, et le [chapitre 11](11-la-qualite-mesuree.md) la **mesure** sur ce
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
  en montre chaque moment sur une ligne repliée **Réflexion**, dont la pastille pulse pendant qu'il
  s'écrit ; un clic l'ouvre, rendu au fur et à mesure. Le niveau se choisit dans la zone de
  saisie : **Direct** (aucune réflexion), **Bref**, **Standard**, **Approfondi** — et seulement ceux
  que le modèle possède vraiment : son serveur le dit quand il est chez vous, sa documentation sinon.
  Chaque niveau change vraiment la requête, d'un fournisseur à l'autre : Direct **coupe** la
  réflexion là où le modèle le permet ; sur un modèle qui réfléchit toujours (Claude Opus 5.5, Gemini
  3, Grok…), Direct n'est pas proposé et le niveau le plus bas le dit. Bref, Standard et Approfondi
  demandent un effort faible, moyen et élevé (le plus élevé avant « max » quand le modèle en a un).
  Exception à connaître : chez OpenAI, en passant par Chat Completions, GPT-5.4 et suivants
  n'acceptent les outils que sans réflexion — un niveau choisi y part donc en Direct pendant un tour
  d'agent. Tant que vous n'avez rien choisi, un modèle dans le cloud reçoit exactement la même requête
  qu'avant : il réfléchit à son propre réglage par défaut, et le bouton l'indique (« Défaut du
  modèle »). Sur votre propre serveur, un niveau
  que personne n'a choisi vaut **Standard** : laissé à lui-même, un modèle comme Qwen réfléchit à son
  maximum, même pour une petite tâche. Sur ce serveur, chaque niveau est en plus un vrai **budget de
  réflexion** par étape, que le serveur fait respecter en refermant lui-même la réflexion quand il est
  dépensé : **Bref** 1 024 jetons, **Standard** 8 192 (il n'arrête que les emballements),
  **Approfondi** sans limite, **Direct** sans réflexion. Avant, un niveau n'y était qu'un mot
  (« sois bref ») que le modèle cessait de suivre dès qu'un problème devenait difficile, d'où des
  réflexions sans fin ; mesuré, Bref est aussi précis qu'avant et 29 % plus rapide. Les modèles cloud
  gardent leurs propres réglages. La réflexion n'est jamais renvoyée au modèle d'une question à
  l'autre ; l'exception est le tour d'agent, où chaque étape retrouve la réflexion des étapes
  précédentes pour ne pas tout recommencer — sur un serveur auto-hébergé, sous la forme signée que
  demandent Claude et DeepSeek, et par OpenRouter, qui demande qu'on lui rende la sienne telle quelle.
  Sans elle, un modèle comme DeepSeek repartait de zéro à chaque action ; mesuré, la rendre coûte 15 %
  de moins et prend 13 % de temps en moins.

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
