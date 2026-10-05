# 13. Installer et s'en servir

[← Chapitre précédent](12-la-qualite-mesuree.md) · [Sommaire](README.md) · [Glossaire →](99-glossaire.md)

Ce chapitre suppose uniquement que vous avez un ordinateur. Il ne suppose pas que vous savez coder.

## 1. Installer l'éditeur

Téléchargez **VS Code** sur <https://code.visualstudio.com> et installez-le comme n'importe quel
logiciel. C'est gratuit.

## 2. Installer l'extension

Hivey Code n'est **pas encore sur la place de marché** de VS Code : il manque un compte d'éditeur,
que seul le mainteneur peut créer. Donc on l'installe depuis un fichier.

1. Allez sur
   <https://github.com/FlorianMartins/hivey-vscode/releases/tag/build> et téléchargez
   **`hivey-code.vsix`**. (Cette adresse ne change jamais : elle est reconstruite à chaque version.)
2. Dans VS Code, ouvrez le panneau **Extensions** (l'icône de quatre carrés dans la barre de gauche).
3. En haut de ce panneau, cliquez sur le menu **`…`**, puis sur **« Installer à partir d'un VSIX… »**.
4. Choisissez le fichier téléchargé.

C'est fini. Si vous préférez une commande, c'est `code --install-extension hivey-code.vsix`.

**Vérifier que le fichier est bien celui qui a été construit** (facultatif, mais c'est le genre de
chose que ce projet vous encourage à faire) :

```bash
sha256sum hivey-code.vsix   # à comparer avec SHA256SUMS, dans la même page
```

`sha256sum` calcule une **empreinte** du fichier ([chapitre 9](09-la-confidentialite.md)) : si elle
correspond, vous avez exactement le fichier publié.

## 3. Installer un modèle sur votre machine

Sans modèle, l'extension n'a personne à qui parler. Le plus simple est **Ollama**.

1. Téléchargez-le sur <https://ollama.com> et installez-le.
2. Ouvrez un **terminal** (sous Windows : « Terminal » ou « PowerShell » ; sous macOS :
   « Terminal » ; sous Linux : votre terminal habituel) et tapez :

```bash
ollama pull qwen2.5-coder:7b
```

Ça télécharge environ 5 Go. C'est un modèle de 7 milliards de paramètres
([chapitre 2](02-le-modele.md)).

3. Puis, pour le laisser répondre :

```bash
ollama serve
```

Il n'y a **rien d'autre à configurer** : les valeurs par défaut de l'extension visent déjà
`http://127.0.0.1:11434/v1`, qui est l'adresse d'Ollama sur votre propre machine. `127.0.0.1` veut
dire « cet ordinateur-ci ».

⚠️ **Sachez ce que vous allez obtenir.** Ce modèle-là répond bien aux questions et à la complétion.
Pour du travail d'**agent** — modifier des fichiers tout seul — la mesure du
[chapitre 12](12-la-qualite-mesuree.md) est sans ambiguïté : il n'y arrive pas. Si vous voulez le
mode agent, il faut soit un modèle local plus récent qui sache appeler des outils, soit une escalade
vers un modèle distant.

## 4. S'en servir

Ouvrez un dossier contenant du code, puis le panneau **Hivey Code** dans la barre de droite.

- **Posez une question** dans la zone de saisie. Le fichier ouvert est joint par défaut, et on vous
  le montre.
- **Changez de mode** (Discussion / Plan / Agent) selon ce que vous voulez autoriser
  ([chapitre 5](05-les-trois-modes-et-les-outils.md)). Commencez par **Plan** : il lit et ne modifie
  rien.
- **`Ctrl+I`** dans l'éditeur réécrit la sélection sur place.
- **Clic droit → Hivey Code** sur une sélection : expliquer, trouver les problèmes, couvrir par un
  test, documenter, montrer les appelants, simplifier.
- Sur une erreur soulignée par l'éditeur, l'**ampoule** propose « Corriger avec Hivey Code ». C'est le
  meilleur usage d'un petit modèle local : le compilateur dit déjà **quoi** et **où**, il ne reste
  qu'à corriger.

## 4 bis. Parler plutôt que taper

Un bouton micro apparaît dans la zone de saisie — mais **seulement si deux conditions sont réunies** :
que votre éditeur donne un micro au panneau, et que vous ayez dit **où** transcrire. Un bouton qui
aurait l'air d'écouter sans écouter vous coûterait un paragraphe entier parlé dans le vide.

Pourquoi il faut configurer quelque chose : **un enregistrement de votre voix ne peut pas être
pseudonymisé** ([chapitre 9](09-la-confidentialite.md)). C'est, avec une image, l'une des deux seules
choses que l'outil ne sait pas masquer avant de les envoyer. L'envoyer quelque part est donc une
décision, jamais un défaut.

La voie recommandée est **une commande sur votre machine**. Si vous avez installé un transcripteur
(whisper.cpp, faster-whisper…), renseignez `hiveyCode.dictation.command` :

```
whisper-cli -f {file} --no-timestamps --output-txt -
```

`{file}` est l'endroit où l'enregistrement sera écrit ; le texte imprimé par la commande arrive dans
la zone de saisie. Rien ne sort de votre machine.

Si vous n'avez pas de transcripteur local, `hiveyCode.dictation.endpoint` accepte une adresse
compatible OpenAI — et là, le consentement est demandé **à chaque fois, sans « toujours »**. C'est la
seule permission de ce produit qui ne peut pas être accordée une fois pour toutes.

⚠️ Le texte transcrit **arrive dans la zone de saisie, il n'est jamais envoyé tout seul**. Un
reconnaisseur se trompe, et une question dictée qui s'enverrait d'elle-même serait une question que
personne n'a relue. Échap pendant l'enregistrement jette tout : changer d'avis au milieu d'une phrase
n'est pas une demande de transcription.

## 4 ter. Changer l'apparence

`hiveyCode.appearance` a deux valeurs :

| Valeur | Ce que ça fait |
|---|---|
| `editor` (défaut) | Le panneau reprend les couleurs de **votre thème** VS Code. |
| `hivey` | La palette propre au produit : base bleu-noir profonde, ambre en accent. |

Le défaut n'est pas un hasard. Un panneau ancré à côté de l'arborescence et du terminal qui ignore
votre thème se lit comme un corps étranger — c'est une décision prise tôt dans le projet. L'apparence
`hivey` existe parce que l'autre envie est légitime aussi, et un réglage est la seule façon honnête de
servir les deux sans annuler la première en silence.

## 5. Si vous voulez brancher un modèle payant

Il faut une **clé d'API** ([chapitre 4](04-comment-on-lui-parle.md)), achetée chez un fournisseur ou
chez une passerelle comme OpenRouter.

Dans la palette de commandes (`Ctrl+Maj+P`), lancez **« Hivey Code: Store a provider key »**. La clé
va dans le **trousseau du système d'exploitation** — pas dans un fichier du projet, qui finirait
publié dans le dépôt.

Puis, si vous voulez l'escalade plutôt que l'usage systématique du modèle payant, renseignez
`hiveyCode.escalation.model`. Relisez le [chapitre 10](10-le-cout.md) avant : l'escalade ne se
déclenche que sur un **échec constaté**, ce qui est tout l'intérêt.

## 6. Les réglages qui valent le détour

Dans les réglages de VS Code, cherchez `hiveyCode`.

| Réglage | Pourquoi vous y toucherez |
|---|---|
| `privacy.blockedGlobs` | Les fichiers qui ne doivent **jamais** partir ([chapitre 9](09-la-confidentialite.md)) |
| `privacy.customTerms` | Vos noms de clients et de projets, à pseudonymiser |
| `privacy.egressPolicy` | `ask-always` pour qu'on vous demande à chaque fois |
| `budget.dailyUsd` | Le plafond de dépense par jour |
| `budget.perRequestTokens` | La taille au-delà de laquelle une requête est questionnée |
| `ibmi.writableLibraries` | Les bibliothèques qu'un agent peut modifier ([chapitre 11](11-ibm-i.md)) |
| `language` | Pour un poste dont l'éditeur est dans une langue et l'utilisateur dans une autre |

## Et si ça ne marche pas

- **Rien ne répond.** Vérifiez qu'`ollama serve` tourne. Dans un navigateur,
  `http://127.0.0.1:11434` doit répondre quelque chose.
- **« Unauthorized ».** Il manque la clé, ou elle est périmée. Relancez la commande qui l'enregistre.
- **C'est très lent.** Sans carte graphique, c'est normal ([chapitre 3](03-ou-tourne-le-modele.md)) :
  comptez une dizaine de mots par seconde. Un modèle plus petit sera plus rapide et moins bon.
- **Ça ne modifie aucun fichier.** Vous êtes probablement en mode Plan, qui ne modifie rien **par
  construction** ([chapitre 5](05-les-trois-modes-et-les-outils.md)). Si vous êtes bien en mode Agent,
  relisez la fin du [chapitre 12](12-la-qualite-mesuree.md) : certains modèles locaux n'appellent pas
  d'outils.

[← Chapitre précédent](12-la-qualite-mesuree.md) · [Sommaire](README.md) · [Glossaire →](99-glossaire.md)
