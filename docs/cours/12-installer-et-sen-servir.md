# 12. Installer et s'en servir

[← Chapitre précédent](11-la-qualite-mesuree.md) · [Sommaire](README.md) · [Glossaire →](99-glossaire.md)

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
[chapitre 11](11-la-qualite-mesuree.md) est sans ambiguïté : il n'y arrive pas. Si vous voulez le
mode agent, il faut soit un modèle local plus récent qui sache appeler des outils, soit une escalade
vers un modèle distant.

## 4. S'en servir

Ouvrez un dossier contenant du code, puis le panneau **Hivey Code** dans la barre de droite.

- **Posez une question** dans la zone de saisie. Le fichier ouvert est joint par défaut, et on vous
  le montre.
- **Changez de mode** (Discussion / Plan / Agent) selon ce que vous voulez autoriser
  ([chapitre 5](05-les-trois-modes-et-les-outils.md)). Commencez par **Plan** : il lit et ne modifie
  rien.
- **Choisissez combien il réfléchit** : Direct, Bref, Standard ou Approfondi, à côté du mode
  ([chapitre 2](02-le-modele.md)). Seuls les niveaux que le modèle connaît sont proposés, et chacun
  change vraiment sa réflexion — sur votre propre serveur, c'est un budget de jetons par étape ;
  Direct manque sur un modèle qui ne peut pas cesser de réfléchir.
- **Stop** arrête le tour tout de suite. Sur un serveur partagé occupé par quelqu'un d'autre, le tour
  affiche « En file d'attente… 12 s » plutôt qu'un « réfléchit… » trompeur : il attend son tour, et il
  n'y a plus de délai au bout duquel il serait abandonné.
- **Pendant qu'il travaille**, la zone de saisie reste ouverte (« Corriger ou préciser — lu à la
  prochaine étape ») : **Entrée** envoie votre message dans la tâche en cours. Il s'affiche dans la
  réponse, et le modèle le lit à sa prochaine étape, après les actions en cours — sans Stop ni nouvelle
  question —, avec les fichiers ou images joints au même moment. Envoyé pendant les derniers mots, il rouvre le tour ; arrivé trop tard, il devient la
  question suivante ; après un Stop, il revient dans la zone de saisie. Dans la ligne de commande
  (`hivey`), une ligne tapée pendant un tour fait de même.
- **Un tour se lit comme une frise**, à la manière de Claude Code : chaque moment de réflexion est une
  ligne repliée **Réflexion** (sa pastille pulse pendant qu'elle s'écrit, et un clic l'ouvre en
  entier), chaque action une ligne compacte — `Read(src/x.ts)`, `Bash(npm test)`,
  `Update(src/y.ts)` — dont la pastille dit si elle a réussi, et ce que le modèle écrit entre les deux,
  en paragraphes. Une commande ne fait plus apparaître le terminal : un clic sur sa ligne montre ce
  qu'elle a affiché. Tant que le tour tourne, **votre demande reste épinglée** en haut de la
  conversation dès qu'elle sort de l'écran ; un clic y revient. Au survol de la réponse s'affichent
  l'heure à laquelle elle s'est terminée et la durée de la requête. L'heure de chacun de vos messages
  s'affiche à côté de « Vous » ; une question réessayée ou modifiée prend celle du nouvel envoi.
- **Après une réponse**, la prochaine demande probable s'affiche en grisé dans la zone de saisie :
  **Tab** (ou une flèche) en fait votre texte, **Entrée** l'envoie. Réglage
  `hiveyCode.chat.suggestNext`.
- **`Ctrl+I`** dans l'éditeur réécrit la sélection sur place.
- **Clic droit → Hivey Code** sur une sélection : expliquer, trouver les problèmes, couvrir par un
  test, documenter, montrer les appelants, simplifier.
- Sur une erreur soulignée par l'éditeur, l'**ampoule** propose « Corriger avec Hivey Code ». C'est le
  meilleur usage d'un petit modèle local : le compilateur dit déjà **quoi** et **où**, il ne reste
  qu'à corriger.

## 4 bis. Parler plutôt que taper

Un bouton micro apparaît dans la zone de saisie là où la dictée peut fonctionner. VS Code ne donne pas
de micro au panneau d'une extension : l'enregistrement est fait par un programme de votre machine
(`arecord`, `pw-record`, `ffmpeg`…), et le texte vient d'un **transcripteur**. Sous Windows et Linux,
le premier appui propose d'en **installer un sur votre machine** (whisper.cpp, environ 150 Mo avec le
modèle par défaut, une seule fois) — demandé **avant** l'enregistrement, pour ne pas vous laisser
parler dans le vide.

Pourquoi la transcription reste chez vous par défaut : **un enregistrement de votre voix ne peut pas être
pseudonymisé** ([chapitre 9](09-la-confidentialite.md)). C'est, avec une image, l'une des deux seules
choses que l'outil ne sait pas masquer avant de les envoyer. L'envoyer quelque part est donc une
décision, jamais un défaut.

Si vous avez déjà votre propre transcripteur (whisper.cpp, faster-whisper…), renseignez plutôt `hiveyCode.dictation.command` :

```
whisper-cli -f {file} --no-timestamps --output-txt -
```

`{file}` est l'endroit où l'enregistrement sera écrit ; le texte imprimé par la commande arrive dans
la zone de saisie. Rien ne sort de votre machine.

Si vous n'avez pas de transcripteur local, `hiveyCode.dictation.endpoint` accepte une adresse
compatible OpenAI (une clé OpenAI ou Groq déjà configurée comme fournisseur est aussi empruntée) — et
là, le consentement est demandé **à chaque fois, sans « toujours »**. C'est la seule permission de ce
produit qui ne peut pas être accordée une fois pour toutes.

⚠️ Le texte transcrit **arrive dans la zone de saisie, il n'est jamais envoyé tout seul**. Un
reconnaisseur se trompe, et une question dictée qui s'enverrait d'elle-même serait une question que
personne n'a relue. Échap pendant l'enregistrement jette tout : changer d'avis au milieu d'une phrase
n'est pas une demande de transcription.

**Plusieurs micros ?** Sous Windows avec ffmpeg, il n'existe pas d'entrée « par défaut » sur laquelle
se rabattre : il faut nommer le périphérique. Avec une seule entrée, elle est prise d'office ; avec
plusieurs et aucune choisie, le premier appui sur le micro demande laquelle, et s'en souvient.
**Hivey Code : Choisir un micro**, dans le menu du panneau, permet d'en changer ensuite — et c'est
proposé directement dès qu'une entrée ne peut pas être ouverte.

## 4 ter. Changer l'apparence

`hiveyCode.appearance` a deux valeurs :

| Valeur | Ce que ça fait |
|---|---|
| `editor` (défaut) | Le panneau reprend les couleurs de **votre thème** VS Code. |
| `hivey` | Les surfaces et accents propres au produit : ambre sur une base froide. |

⚠️ Deux limites, mesurées sur une capture du vrai panneau plutôt qu'affirmées : **la couleur de fond
de la fenêtre reste celle de l'éditeur** — VS Code la peint en dehors du document que l'extension
contrôle — et **un thème clair conserve l'apparence de l'éditeur**, parce qu'une palette réglée pour
un fond sombre posée sur un fond clair n'est pas un style, c'est un défaut de contraste.

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
| `budget.dailyUsd` | Le plafond de dépense par jour (20 $ par défaut) |
| `budget.perRequestTokens` | La taille au-delà de laquelle une requête est questionnée — 0 (par défaut) : jamais, la limite est la fenêtre du modèle |
| `context.autoCompact` | Le résumé automatique quand la conversation approche de la fenêtre ([chapitre 6](06-le-contexte.md)) — activé par défaut |
| `agent.maxSteps` | Un plafond d'étapes par tour d'agent — 0 (par défaut) : aucun ([chapitre 5](05-les-trois-modes-et-les-outils.md)) |
| `agent.commandRunner` | Comment l'agent lance les commandes — `auto` (par défaut) et `process` : en processus, partout, dont la sortie est lue directement, sans ouvrir le terminal : la commande et ce qu'elle affiche apparaissent dans le tour, et dans un terminal *Hivey Code (commandes)* que vous pouvez ouvrir, où Ctrl+C l'arrête ; `terminal` : dans le terminal intégré |
| `chat.suggestNext` | La suggestion de la prochaine demande — activée par défaut |
| `language` | Pour un poste dont l'éditeur est dans une langue et l'utilisateur dans une autre |

## Et si ça ne marche pas

- **Rien ne répond.** Vérifiez qu'`ollama serve` tourne. Dans un navigateur,
  `http://127.0.0.1:11434` doit répondre quelque chose.
- **« Unauthorized ».** Il manque la clé, ou elle est périmée. Relancez la commande qui l'enregistre.
- **« Payment Required ».** C'est l'argent, et le [chapitre 10](10-le-cout.md) distingue les trois
  causes : le solde, le plafond de la clé, et le rechargement automatique. Le message dit laquelle a
  refusé — et s'il dit le solde, relever le plafond de la clé ne servira à rien.
- **C'est très lent.** Sans carte graphique, c'est normal ([chapitre 3](03-ou-tourne-le-modele.md)) :
  comptez une dizaine de mots par seconde. Un modèle plus petit sera plus rapide et moins bon.
- **Ça ne modifie aucun fichier.** Vous êtes probablement en mode Plan, qui ne modifie rien **par
  construction** ([chapitre 5](05-les-trois-modes-et-les-outils.md)). Si vous êtes bien en mode Agent,
  relisez la fin du [chapitre 4](04-comment-on-lui-parle.md) : certains modèles locaux n'appellent pas
  d'outils comme ils le devraient.

[← Chapitre précédent](11-la-qualite-mesuree.md) · [Sommaire](README.md) · [Glossaire →](99-glossaire.md)
