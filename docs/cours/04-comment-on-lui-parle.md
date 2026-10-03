# 4. Comment on lui parle

[← Chapitre précédent](03-ou-tourne-le-modele.md) · [Sommaire](README.md) · [Chapitre suivant →](05-les-trois-modes-et-les-outils.md)

Ce chapitre est le plus technique du cours, et il mérite l'effort : il explique un défaut réel du
projet, trouvé il y a deux jours, qui empêchait complètement l'outil de fonctionner avec un modèle
local. On ne peut pas le comprendre sans savoir ce qu'est une API.

## Une API, c'est un guichet

Une **API** (*Application Programming Interface*) est la façon dont deux programmes se parlent. Pas
une interface pour un humain : un guichet pour un autre programme, avec des formulaires très précis.

L'image du guichet est exacte. Il y a une **adresse** (où se présenter), un **formulaire** (ce qu'on
doit remplir, dans l'ordre exact), et une **réponse** dans une forme prévue d'avance. Si vous remplissez
mal le formulaire, on vous le rend sans rien faire.

Les éléments :

- **HTTP** est le protocole du web — la langue dans laquelle les navigateurs demandent les pages.
  Les API l'utilisent aussi : une question au modèle est techniquement du même genre que l'ouverture
  d'une page web.
- **JSON** est le format des formulaires. Du texte structuré avec des accolades, lisible par un
  humain qui s'y force. `{"role": "user", "content": "Bonjour"}` est un message en JSON.
- Une **clé d'API** est un mot de passe long qui dit qui paye. C'est tout ce dont quelqu'un a besoin
  pour dépenser votre argent : une clé est un secret, au même titre qu'un mot de passe.

## Le streaming, et pourquoi la réponse apparaît mot à mot

Quand vous voyez une réponse s'écrire progressivement, ce n'est pas une animation. Le modèle produit
réellement un jeton après l'autre, et on vous les transmet au fur et à mesure. La technique s'appelle
**SSE** (*Server-Sent Events*) : une connexion qui reste ouverte et par laquelle le serveur envoie
des morceaux jusqu'à ce qu'il ait fini.

L'intérêt n'est pas cosmétique : vous pouvez **arrêter** une réponse qui partait de travers avant
qu'elle soit entièrement calculée, et donc avant de l'avoir entièrement payée.

## Les deux langues des modèles

C'est le point important du chapitre. Il n'y a pas une forme de formulaire, il y en a **deux** :

- **La forme OpenAI.** Inventée par OpenAI, devenue le standard de fait. Presque tout le monde
  l'accepte : OpenRouter, Google, DeepSeek, Mistral, Groq, Ollama, vLLM… même quand ce n'est pas leur
  format d'origine, ils l'offrent en plus.
- **La forme Anthropic.** Celle de Claude, différente dans les détails.

Hivey Code a donc exactement **deux** programmes de dialogue : un pour la forme OpenAI, qui sert à
dix fournisseurs sur onze, et un pour Anthropic. Le choix se fait par une ligne dans un tableau, pas
par une exception dans le code — un fournisseur de plus, c'est une ligne de plus.

## Comment un modèle demande à faire quelque chose

Un modèle ne peut rien faire tout seul. Il ne peut que produire du texte. Pour qu'il puisse lire un
fichier, il faut un mécanisme — et celui qui s'est imposé s'appelle **l'appel d'outil** (*tool
calling*).

Ça marche comme ça :

1. Avec la question, on envoie au modèle la **liste des outils** disponibles, décrits en JSON : un
   nom, ce que ça fait, les informations attendues. Par exemple : `read_file`, « lit un fichier »,
   attend un `path`.
2. Le modèle, au lieu de répondre du texte, répond **« appelle `read_file` avec `path: "compte.js"` »**
   — dans un champ réservé du formulaire de réponse, séparé du texte.
3. Le programme exécute vraiment la lecture, et renvoie le contenu au modèle.
4. Le modèle continue avec l'information en main.

Ce va-et-vient est la **boucle de l'agent**, et c'est le sujet du
[chapitre 5](05-les-trois-modes-et-les-outils.md).

## Le défaut : quand le modèle demande dans la mauvaise case

Voici l'histoire, parce qu'elle explique mieux que n'importe quelle théorie pourquoi ces détails
comptent.

Le projet voulait **mesurer** sa qualité avec un modèle local (c'est le
[chapitre 12](12-la-qualite-mesuree.md)). Première tâche du banc d'essai : « ajoute une option à ce
petit programme ». Le modèle a répondu — et **rien ne s'est passé**. Aucun fichier modifié. Zéro
outil appelé.

En regardant ce qu'il avait réellement répondu, on a trouvé ceci : l'appel d'outil était **parfait**.
Le bon nom, le bon fichier, le bon texte à remplacer. Mais il était écrit **dans le texte de la
réponse**, dans un bloc de code, au lieu d'être dans la case réservée du formulaire. Du point de vue
du programme, le modèle avait répondu une phrase. Alors il a affiché la phrase.

La cause : pour ce modèle-là, Ollama **ne remplit pas** la case réservée — ni par sa forme OpenAI, ni
par sa forme d'origine. Et ce n'était pas une configuration exotique : c'était **le modèle que le
projet recommandait, sur le programme qu'il disait d'installer**. Le mode agent, qui est la
fonctionnalité centrale de l'outil, ne faisait donc rien du tout dans sa configuration par défaut.

## Dans Hivey Code

Un appel d'outil écrit dans le texte est maintenant **reconnu**. Et comme ça consiste à transformer
de la prose en action — ce qui est la chose la plus risquée de tout le projet — c'est borné par trois
règles :

1. **Seulement si la case réservée est vide.** Un appel en bonne et due forme gagne toujours.
2. **Seulement si l'appel est en fin de message et délimité.** Parce que « voici le JSON qu'il
   faudrait envoyer, ça supprimerait tout » est une **phrase**, pas un ordre. La frontière est : rien
   ne doit suivre l'appel.
3. **Seulement pour un outil qui existe.** Un nom que personne n'a proposé n'est pas un appel, c'est
   un modèle qui invente.

Et ce que cette correction coûte est **écrit**, pas caché. Normalement, le texte et les appels
arrivent par deux canaux séparés, ce qui garantit qu'un modèle qui *parle* d'une action ne peut pas en
*faire* une. En lisant les appels dans le texte, on perd cette séparation. Le projet ne prétend pas
le contraire : un appel lu dans le texte est **marqué comme tel**, et la carte d'approbation vous le
dit — « lu dans le message du modèle, pas dans un appel d'outil ». Vous décidez en sachant par où
c'est arrivé.

Dernier point, et c'est une leçon qui dépasse ce projet : la correction n'existait d'abord que dans le
programme de la forme OpenAI. Or une **passerelle au format Anthropic** devant un modèle local — un
montage d'entreprise banal — aurait eu exactement le même problème. Corriger un seul des deux voulait
dire que le défaut était réparé **selon le proxy que l'exploitant fait tourner**. Un contrôle
automatique lit maintenant les deux programmes et exige qu'ils s'accordent.

[← Chapitre précédent](03-ou-tourne-le-modele.md) · [Sommaire](README.md) · [Chapitre suivant →](05-les-trois-modes-et-les-outils.md)
