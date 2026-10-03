# 3. Où tourne le modèle

[← Chapitre précédent](02-le-modele.md) · [Sommaire](README.md) · [Chapitre suivant →](04-comment-on-lui-parle.md)

C'est **la** question de ce projet. Tout le reste en découle.

Quand vous utilisez ChatGPT, votre texte part sur les ordinateurs d'OpenAI, le calcul s'y fait, la
réponse revient. Rien ne se passe sur votre machine. Pour une question de culture générale, c'est
sans conséquence. Pour le code source de votre entreprise, c'est une décision — et souvent une
décision que personne n'a prise consciemment.

Il y a trois endroits possibles.

## 1. Sur votre machine (« local »)

Le modèle est un fichier sur votre disque. Un programme le charge en mémoire et calcule les réponses
avec votre processeur, ou votre carte graphique si vous en avez une.

Les programmes qui font ça :

- **Ollama** — le plus simple. Une commande pour télécharger un modèle, et il reste en fond à
  répondre. C'est celui que ce projet suppose par défaut.
- **LM Studio** — la même chose avec une interface graphique.
- **llama.cpp** — le moteur en dessous de beaucoup des autres. Pour les gens qui veulent régler.
- **vLLM** — fait pour servir **plusieurs utilisateurs** depuis un serveur. C'est ce qu'une entreprise
  installe pour toute une équipe.

Ce que ça demande, en pratique :

- De la **mémoire** : un modèle quantisé de 7 milliards de paramètres occupe 4 à 5 Go, qu'il faut
  avoir en plus de tout le reste.
- De la **vitesse** : une **carte graphique** (*GPU*) fait ce calcul dix à cinquante fois plus vite
  qu'un processeur. Sans GPU, ça marche quand même — lentement. Pour donner un ordre de grandeur
  mesuré sur la machine de ce projet (12 cœurs, pas de carte graphique) : environ **8 mots par
  seconde**, et une tâche du banc d'essai prend une trentaine de secondes.

Ce que ça donne : **rien ne sort**. Pas de facture, pas de clé, pas de question à se poser sur ce
qu'on écrit. Et la qualité d'un modèle qui tient sur votre machine, c'est-à-dire pas celle des gros.

## 2. Chez un fournisseur (« distant »)

Vous payez un compte chez quelqu'un qui fait tourner de très gros modèles, et vous lui envoyez vos
questions. Les fournisseurs que ce projet sait joindre directement : **OpenAI**, **Anthropic**
(Claude), **Google** (Gemini), **DeepSeek**, **Qwen**, **Mistral**, **xAI**, **Groq**,
**Perplexity**.

Vous obtenez la meilleure qualité disponible, et vous payez au jeton. Et **votre code part**, chez un
tiers, dans un pays qui n'est peut-être pas le vôtre, soumis à des lois qui ne sont peut-être pas les
vôtres. C'est parfaitement acceptable dans beaucoup de situations — et interdit dans d'autres.

## 3. Par une passerelle

Une **passerelle** (*gateway*) est un intermédiaire : vous lui parlez, elle parle aux fournisseurs.

- **OpenRouter** — un seul compte, une seule clé, l'accès à des centaines de modèles de tous les
  fournisseurs. Pratique pour comparer sans ouvrir dix comptes.
- **Azure OpenAI** — les modèles d'OpenAI servis par Microsoft, dans la région que vous choisissez,
  sous contrat d'entreprise. C'est la forme que prend la conformité dans beaucoup de grands groupes.
- **LiteLLM** — une passerelle que vous installez **vous-même**. Vos postes parlent à votre
  passerelle ; elle seule connaît les clés et décide quel modèle répond.

Retenez l'avertissement, parce qu'il est contre-intuitif : **une passerelle sur votre réseau n'est
pas un modèle local**. Si votre passerelle réexpédie vers un fournisseur public, votre code part —
il part juste avec une étape de plus. Ce que vous voyez est l'adresse de la passerelle, pas la
destination finale.

## Ce que « souverain » veut dire

Le mot revient sans arrêt dans ce projet. Il ne veut pas dire « gratuit », ni « sans IA », ni
« hors ligne ». Il veut dire : **vous décidez où va votre code, et vous pouvez le vérifier**.

Ce qui suppose trois choses concrètes, qui sont exactement les trois promesses de l'outil :

1. **Le choix existe** et il est à vous, pas au fournisseur de l'outil.
2. **Ce qui part est visible avant de partir** — pas dans une politique de confidentialité, dans une
   carte qui s'affiche et qui demande.
3. **Ce qui est parti est enregistré** — pour pouvoir répondre, un mois plus tard, à la question
   « qu'est-ce qui est sorti d'ici ? ». C'est le [chapitre 9](09-la-confidentialite.md).

## Dans Hivey Code

Le choix se fait **par rôle**, et c'est le cœur du modèle économique de l'outil. Il y a au moins
trois rôles :

- **La complétion** — les propositions pendant la frappe. Très fréquentes, courtes, faciles. Un
  petit modèle local suffit, et comme c'est de loin l'usage le plus répété, c'est là que se joue la
  facture.
- **La discussion** — vos questions. Un modèle local y répond souvent bien.
- **L'escalade** — un modèle plus fort, appelé **seulement quand c'est nécessaire**. Le
  [chapitre 10](10-le-cout.md) explique comment « nécessaire » est décidé, et c'est plus intéressant
  qu'il n'y paraît : pas d'après la question, mais d'après un **échec constaté**.

Deux détails qui disent beaucoup sur la façon dont le projet est construit :

- **« Local » est décidé par l'adresse, pas par le nom du réglage.** Quelqu'un qui configure le
  fournisseur « local » en le pointant vers `api.openai.com` obtient quand même la pseudonymisation
  et la carte de consentement. Le réglage ne décide pas si vos données sortent ; l'adresse le décide.
- **Une adresse sur votre réseau compte comme locale** : rien n'est facturé et rien n'est
  pseudonymisé, parce que rien ne sort du réseau. C'est pour cette raison que l'avertissement sur les
  passerelles ci-dessus est écrit en gras : c'est à vous de savoir si la vôtre réexpédie.

[← Chapitre précédent](02-le-modele.md) · [Sommaire](README.md) · [Chapitre suivant →](04-comment-on-lui-parle.md)
