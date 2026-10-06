# Changelog

Notable changes, newest first. Dates are the day the work landed on `main`.

## 1.12.0 — 2026-10-06

### Ajouté

- **⚠️ On peut enfin choisir son micro.** « mon ami qui a plusieurs sources d'entrée de son […] son
  micro n'a rien entendu ». Rien n'était cassé : l'enregistreur prenait ce que le système appelle le
  **périphérique par défaut**, enregistrait un fichier parfaitement valide de silence, et la panne
  refaisait surface trois étapes plus loin sous la forme d'une plainte du transcripteur à propos d'un
  chemin temporaire. *Un réglage qui convient à presque tout le monde et se trompe en silence chez les
  autres est pire qu'un réglage manquant.*

  Nouvelle commande **« Hivey Code : choisir un micro »**, qui demande à l'enregistreur en place ce
  qu'il voit — `ffmpeg -list_devices` sous Windows et macOS, `arecord -L` sous Linux — et écrit le
  choix dans `hiveyCode.dictation.device`.

  ⚠️ Chacun de ces outils répond sur **stderr** et **sort en erreur** ensuite, parce que lister n'était
  pas ce que la commande prétendait faire. Les deux sont normaux : traiter la sortie non nulle comme un
  échec annoncerait « aucun micro » sur une machine qui en a quatre.

  ⚠️ Et l'enregistreur intégré de Windows **le dit** au lieu d'offrir une liste inutilisable : MCI
  ouvre le WAVE_MAPPER, qui **est** le périphérique par défaut de Windows. Pour choisir, il faut soit
  changer le défaut dans les paramètres de son, soit installer ffmpeg — et la commande l'explique en
  une phrase plutôt que de laisser chercher.

## 1.11.1 — 2026-10-06

### Corrigé

- **⚠️⚠️ Un enregistrement cassé était transmis tel quel au transcripteur, et c'est SON message
  d'erreur que l'utilisateur recevait.** Signalé depuis la machine d'un collègue : `failed to read the
  frames of the audio data (Invalid argument)`, suivi d'un chemin temporaire. C'est vrai, c'est
  inutile, et c'est inquiétant — c'est l'avis d'un lecteur C++ sur un fichier dont personne n'avait
  parlé.

  Le fichier est désormais **ouvert et examiné avant d'être transmis** : « rien n'a été enregistré »
  est la phrase sur laquelle on peut agir, et elle ne peut être dite qu'en regardant. L'examen est
  volontairement tolérant sur tout ce qui n'empêche pas de transcrire — l'ordre des morceaux, un
  `LIST`, une taille déclarée plus grande que ce qui est sur le disque quand un enregistreur a été
  interrompu — et strict sur ce qui l'empêche : pas un WAV, pas de données, pas une seconde de son.

- **⚠️ Le script Windows avalait ses propres erreurs.** Tous les appels à `mci` étaient dirigés vers
  `Out-Null` : un périphérique qui refusait de s'ouvrir — pas d'entrée, ou un autre programme qui le
  retient — produisait un **échec parfaitement silencieux** et un fichier avec un en-tête et aucune
  trame. Chaque appel est maintenant vérifié et traduit en clair par `mciGetErrorString`, et
  l'enregistreur qui sort en erreur fait remonter **ses propres mots** au lieu de les laisser mourir.
  Au passage, `set hv format tag pcm` est ajouté : c'est lui qui fait tenir le reste du réglage.

## 1.11.0 — 2026-10-06

### Corrigé

- **⚠️⚠️ L'onde ne bougeait pas, et la cause n'était pas celle que j'avais annoncée.** « l'animation
  elle ne fonctionne pas, je voudrais vraiment faire vibrer en mode onde sonore les bords ». Grâce à
  « tu peux installer ffmpeg si tu veux tester », la chaîne a pu être **mesurée** ici plutôt que
  raisonnée — et elle a révélé deux erreurs à moi :

  1. **ffmpeg tamponne sa sortie.** Sans `-flush_packets 1`, le WAV arrive **d'un seul bloc à la fin**
     et le bord ne bouge jamais. Neuf secondes de capture en temps réel donnent **71 relevés de niveau
     avec le drapeau, et zéro sans**. J'avais classé ffmpeg comme « diffuse » sans le vérifier.
  2. **Sur Windows, ffmpeg n'était jamais essayé.** Le recours intégré était premier et, étant
     `builtin`, il correspond **toujours** — donc la recherche ne l'atteignait pas, et une machine qui
     avait ffmpeg était servie par le chemin inférieur quand même. ffmpeg passe devant.

  ⚠️ La courbe du niveau a aussi été **recalibrée sur un vrai enregistrement** : il manquait un
  **plancher**. Sans lui, le bruit de la pièce tenait le bord allumé au quart et la différence entre le
  silence et une voix était invisible — ce qui est exactement ce à quoi sert cette animation. L'écart
  mesuré passe de 0,29 à 0,41, et le vrai silence rend zéro.

  Et là où l'enregistreur n'écrit qu'à l'arrêt — le recours Windows — le bord **respire** lentement au
  lieu de rester plat : *un anneau qui ne bouge jamais est indiscernable d'un anneau cassé, et en
  inventer un niveau serait pire que les deux — ce serait prétendre entendre quelque chose.*

- **⚠️ La proposition d'installer le modèle arrive au PREMIER clic.** « on doit cliquer deux fois comme
  si on voulait envoyer un message alors que l'outil n'est pas installé ». Elle vivait dans la
  transcription, donc **après** l'enregistrement. Tout ce dont une chose a besoin se demande avant de
  la faire, pas après.

- **La langue est désormais suggérée au lieu d'être devinée.** « si je dis "Hello est ce que tu
  m'entend" il écrit "Elo, is what you're trying to do?" ». ⚠️ **Whisper choisit UNE langue pour tout
  le clip**, d'après ses premières secondes : le mot « Hello » décide anglais, et le français qui suit
  est entendu comme de l'anglais. C'est ainsi que le modèle fonctionne et aucun réglage de notre côté
  n'y change rien — mais **le laisser deviner est un choix**, et c'est le mauvais pour quelqu'un dont
  l'éditeur est en français. La langue de l'éditeur sert donc d'indication par défaut, et
  `hiveyCode.dictation.language` l'emporte pour qui dicte dans une langue qu'il ne lit pas.

## 1.10.0 — 2026-10-06

### Corrigé

- **⚠️⚠️ Une carte d'autorisation répondue hors d'un tour restait à l'écran pour toujours.** « une
  fenetre qui s'est ouvert et ne se ferme pas avec écrit "Allowed once." et un message sous la zone de
  chat qui pareil ne part pas avec écrit "Waiting for your answer above" ».

  `forgetApproval` retirait bien la question, et **personne ne renvoyait l'état au panneau**. C'était
  vrai depuis toujours et invisible depuis toujours : chaque autorisation se posait **à l'intérieur
  d'un tour**, et l'étape suivante du tour renvoyait l'état un instant plus tard. La première question
  posée hors d'un tour — *puis-je installer un enregistreur ?* — n'avait rien derrière elle, et le
  résidu est devenu tout ce qu'on pouvait voir.

- **⚠️ Le micro s'allumait avant que quoi que ce soit n'ait commencé.** « il faut cliquer puis
  recliquer pour arreter et seulement il propose d'installer ». Le panneau se déclarait « en écoute »
  à l'instant du clic, sans attendre l'extension — donc sans enregistreur sur la machine, le bouton
  avait l'air d'écouter et le clic suivant « arrêtait » un enregistrement qui n'avait jamais commencé.
  Le bouton suit désormais **ce qui est**, pas ce qui a été demandé : l'extension dit quand elle a
  démarré.

- **⚠️⚠️ Le modèle par défaut ne comprenait que l'anglais.** « quand je parle ça écrit juste "(speaking
  in foreign language)" ou encore "Ito es que chimonto." au lieu de "Hello est ce que tu m'entend" ».
  `tiny.en` avait été choisi pour sa taille. **Un modèle anglais-seul n'échoue pas sur du français, il
  hallucine** — ce qui est pire, parce que la sortie ressemble à une transcription. Le défaut est
  désormais `base`, multilingue : soixante-dix mégaoctets de plus, une seule fois, contre une
  fonctionnalité inutilisable par quiconque ne parle pas anglais.

### Modifié

- **L'anneau d'écoute suit votre voix, et il est aux couleurs du thème.** « l'animation atour de la
  zone de saisie est trop grande et en rouge […] changer l'animation pour faire des petites vibrations
  sur les bord en fonction de l'intonation de la voix ».

  Le rouge était la couleur que cette interface emploie pour un **refus** et pour une **erreur** ; un
  micro qui fonctionne n'est ni l'un ni l'autre. Le liseré fait maintenant un pixel, dans l'accent du
  workbench, **et il n'a aucune image-clé** : l'extension mesure le volume dans le fichier à mesure
  qu'il s'écrit et le bord suit. *Un anneau qui pulse sur une horloge dit « il se passe quelque
  chose » ; un anneau qui suit la voix dit « je vous entends », qui est la question que se pose
  vraiment quelqu'un en train de dicter.*

  ⚠️ Là où l'enregistreur n'écrit son fichier qu'à l'arrêt — celui de Windows — aucun niveau n'arrive
  et le bord garde sa taille de repos. **Une barre qui ne bouge pas vaut mieux qu'une barre qui invente
  une voix.**

## 1.9.1 — 2026-10-06

### Ajouté

- **⚠️ Windows enregistre avec ce que Windows a déjà — rien à installer.** « je suis sur Windows et
  j'ai ce message ». Windows est le seul système qui ne livre aucun enregistreur en ligne de commande,
  et « installe ffmpeg avant de pouvoir parler » n'était pas le cahier des charges. `winmm` fait partie
  de Windows depuis trente ans et PowerShell sait l'appeler : le recours intégré ouvre un périphérique
  `waveaudio`, enregistre en 16 kHz mono, et sauvegarde.

  ⚠️ Il est arrêté par **une ligne sur son entrée standard, jamais par un signal** — c'est pour cela
  que chaque enregistreur déclare désormais comment on l'arrête. Son fichier est produit par un `save`
  explicite, et un processus tué ne l'atteint jamais : l'enregistrement serait perdu exactement au
  moment où l'on vient de finir de parler. Les autres outils, eux, referment leur en-tête WAV sur
  SIGINT — c'est pourquoi on les arrête ainsi.

- **Le micro propose d'installer ce qui manque, au lieu de donner une commande à recopier.** « si il
  faut installer un widget on ne peut pas faire en sorte que quand on clique sur le micro qu'il demande
  un approuval pour faire la commande dans le terminal pour installer ? » — et c'est la bonne forme :
  cette extension demande déjà avant d'exécuter quoi que ce soit, donc une installation est la même
  question qu'elle pose tous les jours, avec une carte qui dit exactement ce qui va s'exécuter. **Dans
  un terminal**, pas en silence : une installation affiche ce qu'elle fait, pose parfois ses propres
  questions, et prend du temps — quelqu'un qui la regarde est quelqu'un qui peut l'arrêter.

## 1.9.0 — 2026-10-06

### Corrigé

- **⚠️⚠️ LE PANNEAU N'A PAS DROIT AU MICRO, ET C'EST VS CODE QUI LE DÉCIDE.** « quand je clique sur le
  micro j'ai ce message et aucun moyen d'activer ». Il n'y en a effectivement aucun, et notre message
  demandait l'impossible. La preuve est dans le code de l'éditeur, dans son processus principal :

  ```js
  a = {pointerLock, notifications, clipboard-read, …}      // ← une origine vscode-webview://
  l = {pointerLock, notifications, media, local-fonts, …}  // ← le workbench
  setPermissionRequestHandler((…, perm, allow, d) =>
    isWebview(d.requestingUrl) ? allow(a.has(perm)) : isWorkbench(…) ? allow(l.has(perm)) : allow(false));
  ```

  `media` est accordé à l'éditeur et **refusé au panneau d'une extension** — sans invite, sans réglage,
  sans contournement. C'est aussi pourquoi le micro du Chat de VS Code fonctionne : il n'est pas dans
  un panneau.

  **L'enregistrement sort donc du panneau.** L'extension cherche un enregistreur sur la machine —
  `arecord`, `pw-record`, `parecord`, `rec`, `ffmpeg` — et lance celui qu'elle trouve ; le bouton micro
  n'est plus qu'un départ et un arrêt. Quand il n'y en a aucun, le message **nomme le paquet à
  installer** au lieu de demander une permission qui ne peut pas être donnée, et
  `hiveyCode.dictation.recordCommand` permet d'écrire exactement ce qui marche sur sa machine — ce qui
  est la seule réponse praticable sous Windows, qui ne livre rien qui enregistre vers un fichier en
  ligne de commande.

  ⚠️ Le processus est arrêté par **SIGINT et non SIGKILL**, et ce n'est pas de la politesse : tous ces
  outils finalisent l'en-tête WAV sur SIGINT et laissent un fichier tronqué sur SIGKILL. L'en-tête
  porte le nombre d'échantillons — un fichier jamais refermé déclare qu'il est vide.

- **⚠️ Le message sous le composer ne s'effaçait jamais.** « et le message ne disparait pas... » :
  rien ne le nettoyait, et comme le panneau ne se redessine que lorsque l'extension lui envoie quelque
  chose, un échec de dictée — qui n'envoie plus rien ensuite — restait affiché jusqu'à la fin de la
  session. Un **état** (« Écoute… ») ne s'efface toujours pas, parce qu'il est vrai tant qu'il l'est ;
  un **événement** disparaît au bout de huit secondes.

### Modifié

- **Les trois modes portent l'accent du thème.** « rajoutes les couleurs du thème vscode sur le mode
  chat et le mode plan aussi pour une cohérence graphique comme pour le mode agent ». C'était Agent
  seul pendant une heure — au motif qu'il est le seul mode qui **modifie vos fichiers** — un
  raisonnement juste à propos d'un **avertissement** et faux à propos de cette marque, qui n'en est pas
  un : une rangée où une pastille est allumée et deux sont grises se lit comme deux pastilles
  désactivées. Un seul accent pour les trois, jamais une palette de trois : ce qui distingue les modes,
  c'est le mot écrit dedans.

## 1.8.0 — 2026-10-06

### Ajouté

- **⚠️⚠️ UN WHISPER LOCAL : la dictée sans compte, sans clé et sans réseau après la première fois.**
  « oui construis le Whisper local ». Trois autres réponses avaient été écartées **par la mesure** :
  l'API vocale de VS Code est *proposée* et réservée à ses propres extensions, le reconnaisseur du
  navigateur répond `not-allowed` dans un panneau, et les systèmes n'exposent leur dictée à une
  commande que sous Windows — où le moteur scriptable est l'ancien. Ce qui reste et qui marche
  pareil partout, c'est un modèle qui tourne sur la machine.

  Au premier appui sur le micro sans rien de configuré, le panneau **demande** : *installer un
  transcripteur sur cette machine ? (85 Mo, une seule fois)*, en disant d'où il vient. Après quoi
  votre voix devient des mots **ici**, gratuitement, et rien ne part nulle part.

  - **Rien n'est une dépendance npm** : une archive est récupérée et un programme est exécuté. Le
    lecteur `tar` a été écrit à la main, comme le lecteur ZIP, le rendu markdown, le diff et le client
    MCP avant lui.
  - **Le build est épinglé**, jamais « latest » : une mesure doit être reproductible et un rapport de
    bogue aussi. « Ça ne transcrit plus » a une réponse quand tout le monde a le même binaire.
  - **Le local passe avant tout service**, y compris une clé déjà configurée — c'est la même règle de
    confidentialité qui faisait déjà gagner une commande configurée.
  - **macOS n'a pas de binaire prêt à l'emploi** et c'est dit, pas contourné : le projet publie un
    `xcframework` à embarquer dans une application, pas un programme. `brew install whisper-cpp` suffit,
    et la même détection le trouve ensuite.

  ⚠️⚠️ **Deux prémisses fausses de ma part, attrapées en exécutant et non en lisant :**
  1. *« une release de binaires compilés ne contient pas de liens symboliques »*. Si : `libwhisper.so.1`
     pointe vers `libwhisper.so.1.9.5`. Les ignorer donnait une installation propre qui mourait à
     l'exécution sur `cannot open shared object file`. Ils sont désormais **matérialisés en copies** —
     jamais suivis, ce qui est la plus vieille faille d'extraction d'archive qui soit.
  2. *le format audio*. whisper.cpp décode du WAV, du FLAC et du MP3 — **pas** l'Opus dans WebM que
     produit tout `MediaRecorder`. Les services l'acceptaient, donc personne en amont n'avait jamais eu
     à s'en soucier. Le panneau enregistre maintenant un **WAV 16 kHz mono** quand les mots seront
     fabriqués ici, et l'encodeur WAV tient en quarante-quatre octets d'en-tête, donc il est écrit ici
     plutôt qu'importé.

  **Vérifié de bout en bout sur cette machine** : téléchargement, extraction, exécution, et la phrase
  de l'échantillon transcrite correctement. Pas raisonné — exécuté.

## 1.7.1 — 2026-10-06

### Ajouté

- **⚠️ La dictée a enfin une réponse valable sur les trois systèmes : Groq.** « quelle serait meilleure
  solution pour le micro du coup ? il faut que ce soit disponible pour tous les OS. le mode speech de
  VSCode n'est pas du tout exploitable ? » — deux questions, deux vérifications plutôt que deux
  opinions :

  **1. Le mode vocal de VS Code est hors de portée.** Son API stable — les 18 963 lignes de
  `@types/vscode` — ne contient **aucune** occurrence de `speech`, `dictation` ni `voice`. La surface
  existe (`ExtHostSpeech`, `MainThreadSpeechProvider`), elle est *proposée* : réservée aux extensions
  de Microsoft. Ses commandes vocales sont par ailleurs attachées à son propre chat.

  **2. La reconnaissance vocale du navigateur ne répond pas.** Mesurée, pas supposée : un sondage posé
  dans le panneau rapporte `SpeechRecognition error=not-allowed`, alors que `mediaDevices` fonctionne
  — c'est pourquoi l'enregistrement, lui, marche déjà. ⚠️ Et le sondage lui-même a d'abord été
  invisible, parce qu'il posait son style avec `setAttribute("style", …)` : **le défaut corrigé le
  matin même**, reproduit à l'identique quelques heures plus tard.

  **La réponse est donc un service, et il en existe un qui coûte zéro :** le point d'accès de Groq est
  compatible OpenAI, tourne whisper-large-v3-turbo, et son palier gratuit offre **2 000 transcriptions
  par jour sans carte bancaire**. Multi-OS par construction. Il rejoint OpenAI et Azure parmi les
  fournisseurs **empruntés automatiquement** : si c'est déjà votre fournisseur de modèles, le micro
  fonctionne sans un réglage de plus.

  ⚠️ Et le nom du transcripteur suit la maison : `whisper-1` est le nom **d'OpenAI**, pas celui du
  modèle. L'envoyer à Groq est un 404 sur une requête qui porte déjà votre voix — précisément l'échec
  que tout ce fichier est agencé pour éviter. Le réglage par défaut devient vide et chaque fournisseur
  reçoit le nom qu'il emploie.

## 1.7.0 — 2026-10-06

### Modifié

- **⚠️⚠️ Hivey Smart devient le haut de gamme, et c'est Anthropic de bout en bout.** « retravaille le
  modele Hivey Smart qui doit etre le modele le plus puissant (principalememt sur anthropic :
  raisonnement fable5, code opus 5.5, quotidien sonnet 5.5 et petites taches haiku) ».

  | rôle | Hivey Smart |
  |---|---|
  | petites tâches | Haiku 4.5 |
  | quotidien | Sonnet 5.5 |
  | travail difficile | **Opus 5.5** |
  | complétion | Haiku 4.5 |

  **Écrit comme une règle, jamais comme quatre identifiants** — ce dépôt s'interdit un numéro de
  version dans ses sources, parce qu'un fournisseur est stable des années et une version des semaines.
  La règle tient en deux choses : un **fournisseur préféré** et quatre **plafonds**. Quand Anthropic
  sortira un successeur, le fichier généré bougera et rien d'autre.

  ⚠️ Et il a fallu une règle de plus, qui vaut d'être dite : **à l'intérieur d'une même maison, le prix
  EST l'échelle de capacité.** Entre fournisseurs c'est faux — ce fichier le dit deux fois, « le prix ne
  dit que ce que quelqu'un a décidé de facturer ». Chez un seul fournisseur, c'est son propre
  classement de ses propres modèles, qu'il publie : haiku sous sonnet sous opus. Sans cela, le rôle
  « travail difficile » prenait le modèle Anthropic **le plus récent** et non le plus fort — donc le
  modèle du quotidien — et toute la promesse du préréglage partait avec.

  ⏭️ **Ce qui n'y est pas** : Fable 5 pour le raisonnement. Le routeur a **quatre** rôles et aucun ne
  sépare « raisonner » de « coder » — `deep` est les deux. Lui en ajouter un cinquième est un vrai
  changement, et je préfère te le dire plutôt que de ranger Fable quelque part où il ne correspond
  à rien.

- **⚠️ L'échelle des préréglages s'inverse, sans qu'une seule garantie soit affaiblie.** `hivey` passe
  du milieu au sommet, donc « Hivey Pro » devient l'intermédiaire. Les invariantes qui protègent
  l'échelle — *un préréglage plus cher n'est jamais servi un modèle pire qu'un moins cher* — **nommaient
  les identifiants en dur** : elles auraient continué à passer en affirmant le contraire de ce qu'elles
  voulaient dire. Elles parcourent désormais l'**ordre déclaré**. C'est ce qui a permis aux deux
  préréglages d'échanger leur place en sécurité.

### Corrigé

- **Seul le mode Agent porte l'accent du thème.** « uniquement le mode agent doit avoir la couleur du
  theme VsCode pas le mode chat ou plan » — et c'est la bonne règle, pas seulement celle demandée :
  Agent est le seul mode qui **modifie vos fichiers**. Chat répond, Plan propose. Un avertissement
  porté par deux modes sur trois est une décoration. Au passage, ces règles peignaient le **bouton
  entier** avec une couleur de *graphique* et un **hexadécimal en dur** — ce que le projet s'interdit
  partout ailleurs. L'icône porte la couleur, les mots ne la portent pas, comme le fait déjà le
  contrôle du fournisseur juste en dessous.

- **Les vraies icônes de fournisseur.** « est ce que tu peux prendre les vraies icones ». Dix-sept
  marques officielles (lobehub/lobe-icons, MIT), récupérées une fois par un script et **commitées** —
  rien n'est chargé à l'exécution, la CSP du panneau l'interdit et l'extension n'a aucune dépendance.
  Elles sont remplies et dessinées sur une grille 24×24 : une marque redessinée à la main est un autre
  logo, et c'est justement la différence qu'on utilise pour reconnaître un fournisseur d'un coup d'œil.

- **Autant d'espace à droite qu'à gauche.** Le composer était large de `100vw` moins la gouttière
  mesurée — **deux mesures soustraites portent leurs deux erreurs**, et il restait 19 px d'air à droite
  contre 13 à gauche. La page publie désormais sa largeur réelle (`documentElement.clientWidth`), qui
  est le seul nombre qui réponde directement à la question.

- **La dictée emprunte le fournisseur déjà configuré** quand il sait transcrire, au lieu d'exiger un
  second service. ⚠️ Seulement quand il **sait** : emprunter une adresse qui ne répond pas
  `/audio/transcriptions` donne un micro qui enregistre votre voix, l'envoie et échoue — pire qu'un
  micro qui annonce qu'il faut le configurer. OpenRouter est l'absence instructive : c'est le
  fournisseur dont la plupart ont une clé, et il n'offre aucune transcription.

## 1.6.0 — 2026-10-06

### Corrigé

- **⚠️⚠️ TOUT LE PANNEAU ÉTAIT DESSINÉ HORS DE SON BORD DROIT, et c'était moi.** Signalé comme « la page
  Permissions […] est vraiment incomprehensible » — et la page n'y était pour rien : ses phrases étaient
  **coupées en plein mot** par un débordement horizontal, sur tous les écrans. Deux causes, les deux
  introduites dans cette session :

  1. le composer avait été épinglé à `width: 100vw`, or **une unité de fenêtre compte la barre de
     défilement verticale** que la zone de contenu n'a pas : il était donc en permanence plus large que
     la place disponible. Il mesure désormais `100vw` **moins** la gouttière, que la page mesure
     elle-même au démarrage — ce à quoi cette mesure servait ;
  2. le plancher de largeur à 470 px, qui était **mesuré et pourtant faux** : l'arithmétique était
     juste, la prémisse ne l'était pas. Elle supposait que la rangée du composer exige toujours sa
     largeur naturelle, alors qu'elle sait maintenant **abandonner ses libellés** sous 430 px. Un
     plancher qu'on atteint par accident sur une barre latérale ordinaire n'est pas un plancher, c'est
     un défaut. Il redescend à **320 px**, et il ne parle plus du composer — qui se débrouille seul —
     mais de la surface de lecture.

  Prouvé par la capture du même écran avec le plancher à 0, où il est parfait.

- **La page Permissions, une fois lisible, est aussi plus courte.** « Règles permanentes » et
  « Accordées pour cette conversation » avaient chacune son titre, son explication et son état vide :
  sur un profil neuf, les deux premiers tiers de l'écran disaient « rien », deux fois, avant d'arriver
  à quoi que ce soit d'actionnable. **Une seule liste** désormais — la distinction est réelle et elle
  est conservée là où elle a toujours été, dans le mot au bout de chaque ligne. Et un état vide
  **s'aligne à gauche** : centré au milieu d'un écran dont toutes les lignes commencent à la même
  marge, il ne se lit pas comme « cette liste est vide » mais comme quelque chose qui a raté sa mise en
  page.

- **⚠️ Une campagne de captures ne contamine plus les tests.** Le scénario de capture écrit des réglages
  au niveau **global** — un point d'accès, un modèle, une langue — parce que c'est la seule façon de
  photographier un panneau configuré. Ils vivaient dans le profil que toutes les exécutions suivantes
  relisent : la suite d'intégration a ensuite échoué sur « settings read back with the defaults the
  manifest declares », annonçant `local` là où le manifeste dit `openai-compatible`. Rien n'était
  cassé ; une exécution précédente avait laissé ses meubles. *Un test qu'une exécution sans rapport
  peut faire échouer est un test qu'on finira par ne plus croire.* Profils séparés.

### Modifié

- **Les boutons de la zone de saisie rapetissent.** « la seule reel difference avec le design de github
  copilot cest les boutons qui sont plus petit » — vérifié côte à côte plutôt que discuté : la rangée
  **dans** la boîte repasse à 24 px de haut, celle du bas garde ses 30 px (« garder […] la barre tout
  en bas à l'identique »).

- **Le modèle porte la marque de son fabricant.** « rajoute une icone du fournisseur devant le nom du
  modele comme sur github copilot (exemple icone openai, icone antrhopic, etc) ». Dix marques
  simplifiées, dessinées sur la même grille 16×16 que le reste et héritant de la couleur du panneau —
  sur le bouton **et** dans la liste de choix, car les deux doivent s'accorder. Ce que la table ne
  reconnaît pas garde la puce, de sorte qu'un fournisseur inconnu ressemble à un modèle et non à une
  image manquante. Un test la confronte au catalogue réel, dans les deux sens.

- **Le bouton Skills ne disparaît plus en rétrécissant.** Il était dernier du groupe de gauche, et
  c'est ce groupe qui porte `overflow: hidden` : il était donc la première chose coupée. Il rejoint
  l'envoi, dans le groupe qui n'est jamais rogné.

## 1.5.1 — 2026-10-06

### Corrigé

- **⚠️ Le plancher de largeur passe de 260 à 470 px, et cette fois le chiffre est MESURÉ.** « mets le
  plancher par defaut plus haut, 260 c'est trop bas ». Il l'était, et d'à peu près la moitié.

  Mesuré sur une capture du panneau à 540 px, contrôle par contrôle : la rangée du composer court de
  l'icône de pièce jointe à x=33 jusqu'à l'envoi à x=496 — environ **479 px de contrôles** — avec 34 px
  de mou entre les deux groupes et un nom de modèle capable d'en rendre 42 de plus en s'élidant jusqu'à
  son propre plancher de sept caractères. La rangée cesse donc de tenir vers **462 px**. 470 plutôt que
  462 parce que la mesure a été lue sur une image : l'erreur bon marché est celle qui laisse un peu
  d'air, l'erreur chère est celle qui rogne un contrôle.

  Car c'est bien de rognage qu'il s'agit : sous le plancher, la règle de débordement **coupe** au lieu
  de comprimer. **À 260 px, le bouton d'envoi n'était pas à l'étroit, il n'était plus là.** Un plancher
  posé sous ce dont le contenu a besoin n'est pas un plancher.

  Un test attache désormais la valeur à ce que la rangée exige, et vérifie que le manifeste et le
  lecteur de réglages annoncent le même chiffre — ils avaient déjà divergé une fois.

## 1.5.0 — 2026-10-06

### Modifié

- **La rangée du composer est celle de l'onglet Chat de l'éditeur.** « reprend egalement les positions
  de boutons de l'onglet chat de github copilot qui est propre ». Vérification faite, VS Code place le
  sélecteur de **modèle dans la boîte de saisie**, à côté du mode — ce qui **contredit** une demande
  faite plus tôt dans la même session, qui l'en avait sorti. La question a donc été posée avant de
  bouger quoi que ce soit : défaire un choix explicite en silence est pire que l'une ou l'autre
  disposition.

  La rangée est désormais `[+] [mode] [modèle] [réflexion] [outils]` … `[micro] [envoi]`. Et c'est
  aussi la meilleure : *quel mode répond* et *quel modèle répond* sont une seule décision posée deux
  fois, et les séparer sur deux rangées est la raison pour laquelle celle-ci n'a jamais eu l'air posée.
  Sous la boîte reste ce qui concerne la **conversation** et non le message : d'où vient la réponse, et
  ce qui s'exécute sans demander.

  La **réflexion** reste visible alors que l'éditeur la cache dans son sélecteur de modèle, parce
  qu'elle a été demandée dans l'autre sens — accessible sur un modèle Gateway comme sur un modèle local
  — et qu'un contrôle qui n'existe qu'au fond d'un autre menu est un contrôle que personne ne trouve.

- **Plus de bordures sur les chips.** `.btn.ghost` veut dire « pas de contour tant qu'on ne le cherche
  pas » et `.btn.tiny` en reposait un : même spécificité, la règle la plus bas l'emporte. Toutes les
  pastilles portaient donc un contour qu'elles avaient demandé à ne pas avoir, dans un panneau dont
  toutes les autres surfaces sont sans bordure. ⚠️ Le premier correctif ramenait le contour **au
  survol**, ce qui déplaçait le bruit au lieu de le retirer ; ce qui répond à « est-ce un contrôle ? »
  est le fond au survol, comme dans l'éditeur. Le contour ne subsiste que pour `:focus-visible`, où il
  est la seule chose dont dispose quelqu'un au clavier.

- **« Set up a model » passe dans le menu `...`.** Un élément du groupe `navigation` est dessiné comme
  une icône de la barre de titre, tout autre groupe tombe dans le menu : déplacer le groupe **est**
  déplacer le bouton. Il y rejoint Langue et Paramètres.

- **Les contrôles ne changent plus d'état en une seule image.** 120 ms sur la couleur et le bord —
  jamais sur la taille ni la position, parce qu'un contrôle qui **bouge** sous le pointeur est un
  contrôle qu'on rate, et que ce serait une régression déguisée en finition. Entièrement désactivé si
  le système demande moins de mouvement.

### Corrigé

- **⚠️⚠️ Le retour en arrière avait été supprimé pour réparer un défaut qu'il n'avait pas.** Le
  commentaire du code affirmait que ce bouton « avait été signalé invisible au-dessus de **chaque**
  question ». C'était une sur-lecture de trois signalements qui disaient tous la même chose, plus
  étroite : il n'y avait pas de retour en arrière sur le **premier** message. Ce qui était vrai, et
  avait une cause évidente — la première question n'a pas de barre au-dessus d'elle. Le bouton de
  toutes les autres barres fonctionnait depuis le début.

  *Un signalement nomme un symptôme ; l'élargir en théorie puis agir sur la théorie, c'est ainsi qu'un
  contrôle qui marche se fait supprimer.* Le texte **« Restore Checkpoint » est donc de retour sur la
  barre**, et l'icône ne reste que sur le premier message — le seul tour qui n'a pas de barre.

  Au passage, `transcriptPieces` porte désormais `first` comme **valeur testée** au lieu de laisser le
  rendu le recalculer, et la phrase qui décrit ce que la restauration fera ou ne fera pas est écrite
  **une seule fois** pour les deux endroits.

## 1.4.1 — 2026-10-06

### Corrigé

- **⚠️⚠️ Le banc refuse d'énoncer un taux quand c'est le chronomètre qui a décidé.** Trouvé en
  **lançant** la mesure, pas en la lisant : une série `hivey/free` est revenue avec **55 % des tâches
  tuées à 180 s** — le client est tué avant d'écrire son rapport — et chacune était comptée comme un
  échec du modèle. Le même préréglage faisait 32/62 deux jours plus tôt avec 3 délais dépassés.

  **Diagnostiqué par découpage, pas supposé.** Le suspect évident était l'activation automatique des
  compétences du même jour, qui ajoute ~40 noms au prompt d'une tâche IBM i. Si c'était la cause, les
  tâches IBM i auraient souffert et les autres non. Elles souffrent pareil : IBM i 9 % → 53 %, autres
  **2 % → 55 %**. *Une cause qui n'épouse pas la forme du changement n'est pas ce changement.* Le point
  d'accès gratuit est simplement devenu beaucoup plus lent.

  Un tel jeu mesure **le débit du fournisseur** et le publie comme la qualité du modèle — ce qui est
  pire que de ne rien publier, parce que ça ressemble à une mesure. Le banc gagne donc le frère du
  garde-fou qu'il avait déjà pour les refus : `timedOut` compté, et le tableau **retire le taux**
  au-delà d'un seuil **dérivé** du bruit propre du banc mesuré par l'ADR-0034 (3 tâches). En dessous,
  un délai reste un échec légitime — les deux séries publiées en contenaient 2 et 3, et les invalider
  rétroactivement serait faux. Nouveau drapeau `--timeout` (le chronomètre était une constante
  inatteignable) et chronomètre **enregistré dans les résultats** : une ligne publiée ne disait jamais
  sous quelle horloge elle avait été obtenue.

- **La liste des familles dit « déjà active » au lieu de « ce que vous avez ouvert ».** C'était vrai
  quand le drapeau signifiait « on cocherait ça pour vous » ; il signifie désormais que la famille
  **est en jeu** pour cette conversation — la ligne peut rester décochée et la famille répond quand
  même. Une étiquette qui minimise ce qui a déjà eu lieu est la demi-vérité qui fait passer une
  fonctionnalité pour cassée.

## 1.4.0 — 2026-10-06

### Corrigé

- **⚠️⚠️ La largeur minimum du panneau n'avait JAMAIS pris effet — sa propre politique de sécurité la
  jetait.** Florian, pour la deuxième fois : « la second side bar a droite n'est toujours pas bloquée…
  on peu la reduire au maximum sans quelle se bloque alors que j'ai demandé un bloquage de largeur
  minimum ».

  Le plancher était écrit `<body style="min-width:…px">`. Or la CSP de ce panneau déclare
  `style-src` **sans** `'unsafe-inline'` — délibérément, parce que la sortie d'un modèle est rendue
  dans ce document — et c'est exactement ce qu'interdit cette directive. **Le plancher était donc
  déclaré au seul endroit où la politique du document garantit qu'il sera jeté.** Le balisage était
  parfaitement correct, aucun test ne pouvait le voir, et le réglage n'a rien fait pendant toute une
  version.

  La valeur voyage maintenant dans l'état et la page l'applique comme **propriété** de style, ce que la
  même politique autorise. Un test refuse désormais `style="…"`, `cssText` et
  `setAttribute("style", …)` dans tout ce qui compose ce panneau.

  **⚠️ Et un deuxième style mort est tombé avec le premier** : la mesure de la largeur de l'ascenseur
  posait sa sonde avec `cssText`, donc la sonde n'avait aucune taille, le calcul rendait `0px` — et le
  défaut qu'elle existe pour corriger (le composer plus large d'un ascenseur que tout le texte
  au-dessus) n'avait jamais été corrigé. Trouvé en cherchant le premier.

  **⚠️ Ce que cela ne fait pas, dit clairement** : c'est un plancher sur le **contenu**, pas un verrou
  sur la barre. VS Code n'offre à une extension **aucun moyen** de fixer une largeur minimum à une vue
  — [microsoft/vscode#182201](https://github.com/microsoft/vscode/issues/182201) est toujours ouverte.
  Ce que l'on gagne : en dessous du plancher la mise en page cesse de se réorganiser et le panneau
  défile latéralement, au lieu de se replier en silence vers quelque chose d'illisible. Rien, dans une
  extension, ne peut empêcher de tirer la poignée.

- **⚠️⚠️ Hivey Smart et Hivey Pro affichaient le même prix.** Florian : « comment ça se fait que les
  modeles Hivey pro et Hivey smart sortent le meme prix ? le smart est censé utiliser les meilleurs
  modeles ».

  Parce que la ligne affichait le prix du modèle qui répond à un tour **ordinaire** et le présentait
  comme le prix du préréglage. Le raisonnement d'origine était défendable — « la ligne ne peut pas
  porter quatre prix » — et le résultat était indéfendable : les deux modèles *everyday* coûtent
  exactement **2 $/M en lecture**, donc la pastille les rendait identiques.

  Et la réponse honnête est qu'**aucun nombre unique ne sépare ces deux préréglages** : sur le
  catalogue du jour ils partagent le modèle bon marché des corvées, le modèle fort du travail
  difficile, et le même prix d'entrée partout. Ce qui diffère est le prix de **sortie** d'un seul rôle
  (6 $ contre 10 $) et quel modèle répond à une question ordinaire. L'interface cesse donc de réduire
  un préréglage à un prix :

  - la pastille montre une **fourchette** (`$0.03–2/M`) au lieu d'un quart de la réponse ;
  - le prix affiché est celui du rôle **le plus cher** — un prix ne doit jamais annoncer le tarif bon
    marché et facturer le cher ;
  - le contexte affiché est celui du rôle **le plus petit**, parce que c'est la fenêtre sur laquelle on
    peut compter — et c'est aussi ce qui sépare *honnêtement* les deux préréglages (Smart retombe à
    500 k sur un tour ordinaire, Pro non) ;
  - l'infobulle nomme **les quatre rôles, leurs modèles et leurs prix**, et **dit** quand un préréglage
    plus cher tombe sur le modèle qu'un moins cher utilise déjà. Ce n'est pas un défaut — cela veut
    dire que le meilleur modèle du moment tenait déjà dans le budget le moins cher. Le fichier généré
    le savait depuis toujours (`HIVEY_OVERLAPS`) ; l'interface ne l'avait jamais dit, et tu ne
    pouvais donc lire ces deux lignes que comme deux préréglages décoratifs.

### Modifié

- **Le choix du modèle sort de la zone de saisie.** Demandé : « le choix du modele tu peux le sortir de
  la zone de saisie user au niveau du choix du mode de reponse […] et du bouton approuval », puis « en
  premier le mode comme cest actuellement, ensuite le modeles et ensuite approuvals ». La rangée sous
  le composer est donc **fournisseur → modèle → approbations**, qui est aussi l'ordre de la question :
  *d'où* vient la réponse, *quel* modèle la donne, *ce qu'il peut faire* sans demander.

  Ce n'est pas qu'un rangement : ces trois-là sont des réglages de la **conversation**, tandis que la
  pièce jointe, le mode et l'effort de réflexion concernent **ce message-ci**. La boîte contenait un
  bouton de l'autre groupe, et c'est pour ça que la rangée n'a jamais eu l'air posée. Au passage, elle
  rend la largeur dont la barre du composer manquait.

  Le fournisseur prend une icône de **nuage** : il portait la même puce que le modèle, ce qui ne
  coûtait rien tant qu'ils étaient dans deux rangées différentes et devenait illisible dès qu'ils sont
  devenus voisins.

## 1.3.0 — 2026-10-06

### Corrigé

- **⚠️⚠️ L'intégration continue était rouge depuis des semaines, et pas une seule fois à cause du
  produit.** Florian : « et le CI workflow a toujours plein d'erreurs cest normal ? ». Non. Et le
  vrai défaut n'est aucun des trois qui suivent : c'est que **personne ne regardait**. Une suite qui
  échoue à chaque poussée n'avertit plus de rien — elle a cessé d'être un signal pour devenir du
  décor, et c'est dans cet état qu'une vraie régression passe sans être vue. Les trois causes étaient
  **toutes environnementales**, ce qui est précisément ce qui les a rendues faciles à ignorer.

  **1. Le collecteur SIEM écoutait sur l'autre pile.** Cinq tests échouaient, sur le job Node 18
  d'Ubuntu et nulle part ailleurs, avec `connect ECONNREFUSED ::1:35751`. Le serveur de test se liait
  à `127.0.0.1` tandis que les tests se connectent à `localhost` — volontairement, parce que le
  certificat porte `DNS:localhost` et que **vérifier ce nom est la moitié de ce que ces tests
  affirment**. Sur le runner, `localhost` résout d'abord en `::1` : le collecteur était bien debout,
  sur l'autre pile. Pourquoi Node 18 seulement ? Parce que Node 20 a activé *Happy Eyeballs*
  (`autoSelectFamily`) par défaut et **réessayait silencieusement en IPv4** — la version récente
  masquait le défaut au lieu de le révéler. Le test se lie désormais là où le nom pointe réellement.

  **2. « Docker répond » et « Docker peut exécuter ce bac à sable » sont deux faits différents.** Le
  runner Windows *a* un démon — en mode conteneurs Windows, donc `alpine:latest` n'a pas de manifeste
  correspondant et l'exécution meurt sur `no matching manifest for windows(10.0.26100)/amd64`. Le
  garde-fou existant interrogeait `{{.Server.Version}}`, qui répond très bien, et concluait que le
  bac à sable était vérifiable. Il interroge maintenant `{{.Server.Os}}`. Le test reste un **échec
  dur** partout où le démon est Linux — c'est-à-dire tous les jobs Ubuntu et toutes les machines de
  développement : la promesse « une commande de fond ne peut pas atteindre le réseau » n'est pas
  prise sur parole. Là où la machine ne peut rien en dire, la réponse est la **troisième**, « je ne
  sais pas », et elle est nommée au lieu d'être déguisée en succès.

  **3. Le checkout changeait les octets sous les tests.** Plusieurs tests lisent le source du projet
  et affirment sur lui, et certaines de ces affirmations **traversent un retour à la ligne**. Avec le
  `core.autocrlf=true` que git met par défaut sur Windows, chaque LF devenait un CRLF à la sortie du
  dépôt : le fichier lu par le test ne contenait plus ce que le test cherchait. **Le test avait
  raison, le source avait raison, et le checkout s'était interposé.** Les fins de ligne sont du
  contenu du dépôt, pas une préférence locale : `.gitattributes` les épingle (`* text=auto eol=lf`),
  ce qui l'emporte sur `core.autocrlf` pour tout le monde. Un test garde l'épingle **et son effet**,
  parce qu'un correctif que rien ne surveille est un correctif qui sera retiré.

  La règle qui en sort — *une suite rouge n'avertit de rien* — est écrite dans
  [`ADR-0041`](docs/adr/0041-une-suite-rouge-n-avertit-de-rien.md).

  Rien de tout ceci ne concerne les fichiers que **vous** éditez : ceux-là arrivent avec les fins de
  ligne qu'ils ont, et `findText.ts` est ce qui fait que `edit_file` les retrouve dans les deux cas.

### Ajouté

- **⚠️⚠️ Les fichiers ouverts activent leurs familles de compétences tout seuls.** Florian : « la
  detection automatique des programmes ouverts ne semble pas faire l'activation et desactivation des
  skills automatisé non plus, ce qui expliqierai pourquoi il créé autant d'erreur, tu peux verifier ce
  point s'il te plait ? ». Vérifié, et c'était vrai — **et pire que ça**.

  `detectGroups` existait depuis longtemps et ne faisait presque rien de sa réponse : il **pré-cochait
  une case** dans un assistant que la plupart des gens n'ouvrent jamais. Quelqu'un qui édite du RPG
  avec les réglages par défaut obtenait donc `general` et rien d'autre — quarante compétences IBM i,
  chacune adossée à une tâche d'évaluation, restaient éteintes pendant que le modèle devinait. Le
  commentaire du réglage affirmait même que les familles « default to the ones that apply whatever is
  open » : c'était l'intention, pas le code.

  Deux règles rendent l'automatisme sûr :
  - **il n'ajoute jamais que.** Une famille que vous avez choisie n'est pas retirée parce que les
    fichiers du jour ne l'impliquent pas — éteindre une compétence que quelqu'un a demandée, pour lui
    rendre service, c'est la version de cette fonction que personne ne laisserait allumée. La
    désactivation existe bien, et c'est la version inoffensive : une famille qui n'était là **que**
    pour un fichier ouvert a disparu de la conversation suivante ;
  - **il est décidé une fois par conversation, pas à chaque tour.** Cette liste est dans le préfixe mis
    en cache : un préfixe qui changerait à chaque fois qu'on clique sur un autre onglet serait **repayé
    en entier à chaque message**, carte du dépôt comprise. Ce serait la façon la plus chère possible
    d'être serviable. L'automatisme se sent donc au **début** d'une conversation — ouvrez ce sur quoi
    vous travaillez, puis demandez.

  Réglage `hiveyCode.skills.auto` pour l'éteindre. Et le menu des familles **dit** celles qui sont déjà
  actives grâce aux fichiers ouverts au lieu de les pré-cocher : les pré-cocher les écrirait dans le
  réglage dès qu'on valide une ligne sans rapport, transformant une chose qui s'éteint toute seule en
  un choix permanent que personne n'a fait.

- **⚠️⚠️ Le même défaut touchait le banc d'évaluation, et il y était invisible.** Le banc pilote le
  **terminal**, et le terminal n'a pas d'éditeur à interroger : il lisait `cfg.skillGroups ?? ["general"]`
  et **aucun appelant ne renseigne `skillGroups`**. Donc **tous les chiffres de `eval/QUALITY.md` ont
  été mesurés les familles éteintes** — sur un banc où **22 des 62 tâches sont des tâches IBM i**, dont
  les familles RPG, DDS, CL et Db2 for i existaient précisément pour elles.

  Le terminal détecte maintenant depuis les fichiers **présents** dans l'arbre, ce qui est la même
  question posée à la seule chose qu'il puisse voir (`groupsForPaths`, `languageIdForPath`).

  Ce qui n'a **pas** été fait : toucher aux chiffres. Ils restent la mesure réelle d'une configuration
  réelle — celle que le terminal servait par défaut. Savoir si la correction les **améliore** n'est
  **pas mesuré**, et aucune case ne sera ajustée pour le deviner : une liste de compétences n'est pas
  gratuite, elle coûte des jetons de préfixe à chaque tour, et un modèle à qui l'on donne quarante noms
  de plus peut aussi s'y perdre. La direction est plausible ; ce n'est pas un résultat. `QUALITY.md` le
  dit en haut de son tableau.

- **⚠️ Un résultat tronqué le dit.** La leçon que `read_file` avait déjà coûtée, appliquée partout où
  elle s'applique. `search_text` et `list_files` ont exactement la même forme : un plafond, appliqué
  en silence. Une recherche qui rend soixante occurrences sur deux cents sans le dire a affirmé au
  modèle **qu'il y en a soixante** — il raisonne alors sur une image complète qu'il n'a pas, et c'est
  pire qu'une erreur, parce que rien n'a l'air anormal. Chaque résultat coupé nomme maintenant le
  plafond atteint et l'appel qui resserre la recherche.

- **La taille du changement s'affiche aussi pour `write_file`.** C'est celui qui en avait le plus
  besoin : il remplace un fichier **entièrement**, donc « écrire src/guilde.js » sur une carte
  d'autorisation ne dit rien du tout sur le fait que quatre lignes ou quatre mille vont partir.

## 1.2.0 — 2026-10-06

### Ajouté

- **⚠️⚠️ Le retour en arrière remet aussi ce qu'une COMMANDE a changé.** Florian : « il faudrait qu'il
  fasse un flash du ou des programmes avant la modification pour y revenir par la suite ».

  Le cliché qu'il demande **existe déjà, et il n'est pas de nous** : un arbre de travail git **est**
  l'état précédent du fichier, tenu par un outil fait pour ça. Un fichier qui était **propre** quand le
  tour a commencé et qui est modifié maintenant a été changé par le tour, et git en détient la version
  exacte. Au démarrage d'un tour d'agent, la liste des fichiers déjà modifiés est retenue ; à la
  restauration, tout ce qui est devenu sale depuis est remis par l'extension Git de l'éditeur — sans
  shell, sans copie du dépôt, sans nouveau format.

  Trois choses qu'il **refuse** de toucher, et chacune pour une raison :
  - **un fichier que vous aviez déjà modifié** avant le tour — jeter vos modifications pour annuler
    les nôtres est le seul résultat pire que de ne pas annuler les nôtres ;
  - **un fichier que le checkpoint tient déjà** — deux mécanismes qui se disputent un fichier, c'est
    l'un des deux qui gagne par accident ;
  - **un fichier non suivi** — git n'a aucun état précédent pour ce qu'il n'a jamais vu, et la boîte
    de dialogue doit le dire plutôt que laisser croire que le tour a été annulé.

- **⚠️ La fenêtre de contexte prend par défaut tout ce que le modèle offre.** « si le modèle propose
  1M, prendre le 1M plutôt que 64k ». Le plafond de 32 000 jetons qui l'en empêchait n'était **pas
  technique**, il était financier : *« un budget sans limite sur une fenêtre d'un million transforme
  chaque question en facture »*. L'argument est juste et il était fait au mauvais endroit — les
  plafonds de dépense existent déjà et, eux, **demandent** avant d'envoyer. Le plafond de contexte
  faisait le même travail en retenant la fenêtre du modèle **en silence**, c'est-à-dire dans la version
  que l'utilisateur ne voit pas, ne peut pas arbitrer et ne peut pas peser.

  Le budget est désormais *la fenêtre, moins ce dont le tour a encore besoin* — une réserve d'un
  cinquième, et jamais moins que la place de trois réponses. Ce n'est pas une préférence : un prompt
  qui remplit toute la fenêtre ne laisse rien pour la réponse, ni pour les résultats d'outils des
  étapes suivantes. Un modèle d'un million donne maintenant plus de 700 000 jetons de contexte.

## 1.1.0 — 2026-10-06

### Corrigé — pourquoi le mode agent faisait tant d'erreurs

Florian a collé le rapport complet d'une session sur un vrai projet. Six appels `edit_file` y échouent
avec « That snippet does not appear in the file », et le modèle **diagnostique les causes lui-même**
avant de les contourner. Les contournements étaient le symptôme, pas le problème.

- **⚠️⚠️ `edit_file` échouait sur les fins de ligne Windows.** Dans ses mots : « Le premier edit
  multi-ligne échoue sans doute à cause des fins de ligne Windows. Je refais la modification sur une
  seule ligne. » Il écrivait de **moins bonnes** éditions pour esquiver un bug. Un fichier enregistré
  sous Windows contient `\r\n`, un modèle écrit `\n` : identiques à l'écran, différents pour
  `indexOf`, donc **toute** édition multi-ligne échouait sur un dépôt Windows. La correspondance se
  fait maintenant aussi sur les fins de ligne unifiées, et la zone remplacée couvre bien le `\r`
  — sinon un retour chariot orphelin reste derrière.

- **⚠️ Supprimer du texte était impossible.** « Le paramètre `new` vide est refusé. » Pour supprimer,
  on remplace par rien — et avec `new` **obligatoire**, un modèle envoie soit `""` et rencontre un
  fournisseur qui jette les arguments vides, soit omet le champ et échoue à la validation. Dans la
  session, il a fini par supprimer deux lignes avec `node -e`. `new` est désormais **facultatif**, et
  l'omettre supprime.

- **⚠️⚠️ Le mode agent ne montre plus de comparaison — demandé trois fois.** « le mode agent ne
  devrait même pas faire de diff ». L'approbation avait **déjà** eu lieu sur la carte du panneau, puis
  `confirmEdit` ouvrait un **onglet de diff** — volant l'onglet en cours — et reposait la même
  question dans une notification. Deux demandeurs pour une décision, ce qui explique aussi pourquoi
  « Toujours » semblait ne pas prendre : il satisfaisait le premier, le second continuait de demander.

  Ce qui remplace le diff n'est pas rien : la carte porte désormais **l'ampleur** du changement
  (`+12 −3`), la liste des étapes nomme chaque fichier, le checkpoint les remet, et l'annulation de
  l'éditeur est intacte. Le second relecteur survit, parce qu'il n'est pas une approbation : il répond
  à « ce diff fait-il quelque chose que la demande n'a pas demandé », et il bloque encore.

- **Le retour en arrière du premier message disait qu'il ne pouvait rien faire — et c'était vrai.**
  « il ouvre une fenêtre qui dit qu'il ne peut pas modifier et restore les modifications. » Le tour en
  question avait écrit ses fichiers par `node -e`, **parce que `edit_file` échouait** : rien ne sait
  quels fichiers une commande va toucher avant qu'elle tourne, donc le checkpoint ne tenait
  effectivement rien. Les deux causes ci-dessus réparent la cause ; le message, lui, **nomme
  désormais le remède** (git) au lieu de s'arrêter au constat.

## 1.0.4 — 2026-10-06

### Corrigé

- **⚠️ La barre d'outils revient sur UNE ligne, et le panneau retrouve son plancher.** J'avais ajouté
  `flex-wrap` pour que le nom du modèle cesse d'être tronqué en « qwe… ». Ça a coûté deux choses qui
  comptent davantage, et Florian a vu les deux : le `+`, le mode, le modèle et la réflexion sont
  **passés au-dessus** du micro, des compétences et de l'envoi — ce n'est pas là qu'on les avait mis ;
  et **la barre latérale pouvait être refermée entièrement**, alors qu'avant le contenu la tenait
  ouverte. ⚠️ *Une rangée qui passe à la ligne ne réclame plus sa largeur* — donc plus rien ne
  résistait. La pression revient sur le nom du modèle, qui a un plancher et une infobulle portant
  l'identifiant complet : la seule étiquette qui peut céder des caractères sans céder son sens. Les
  icônes, elles, ne rétrécissent pas — un bouton d'envoi écrasé à neuf pixels n'est plus un bouton.

- **⚠️⚠️ Le mode de réflexion est de nouveau réglable sur une passerelle et sur un modèle local.**
  « avec le modèle Gateway on ne peut pas changer le mode de réflexion et ça doit être pareil avec un
  modèle local. »

  La cause est épistémique, pas technique : le catalogue est celui d'OpenRouter, et **il ne peut pas
  répondre** pour un modèle servi par la passerelle de quelqu'un ou tournant sur sa machine. Répondre
  `false` revenait à affirmer « ce modèle ne sait pas raisonner » — ce que personne n'a jamais dit —
  et le panneau cachait le contrôle en conséquence. **Trois états, pas deux** : `oui`, `non`, et
  *« on ne sait pas »*, qui n'est pas un `non` plus doux.

  Dans l'inconnu, l'utilisateur en sait plus que le catalogue : le contrôle est offert **et l'effort
  est envoyé**. ⚠️ Et il prend la voie **native**, pas la voie guidée, parce que les deux erreurs ne
  coûtent pas pareil — un bloc guidé envoyé à un modèle qui raisonne déjà le fait réfléchir deux fois
  et dépenser son budget de réponse sur la seconde ; un effort natif envoyé à un modèle qui n'en veut
  pas coûte un champ ignoré, ou un 400 que `adaptRequest` sait déjà retirer. On prend l'erreur bon
  marché. Le seul vrai `non` reste celui d'un éditeur que le catalogue **liste** et dont ce
  modèle-là n'est pas un modèle de raisonnement.

## 1.0.3 — 2026-10-05

### Simplifié

- **Un seul retour en arrière, celui qui marche.** La règle entre deux tours portait un bouton
  « Restore checkpoint » que Florian ne voyait au-dessus d'**aucune** question, sur une installation
  où ce fichier le dessine pourtant. La cause n'a jamais été trouvée — ce qui a été trouvé, c'est que
  la même action vit maintenant dans l'en-tête de la question, où ni condition de survol ni position
  de défilement ne peut la cacher.

  ⚠️ Deux contrôles pour une action, à 24 px l'un de l'autre, dont un qui n'atteint
  démonstrablement pas la personne qui s'en sert, c'est pire qu'un seul qui fonctionne. La règle
  redevient ce qu'elle disait être : **une séparation**. Et l'infobulle qui disait ce qu'un retour ne
  pourra PAS annuler — les commandes — a suivi sur le bouton restant, parce que cette information
  décide du clic et doit arriver avant, pas dans la boîte de dialogue d'après.

### Corrigé

- **Les sous-agents avaient 8 étapes** quand le tour principal est passé à 30, et ce 8 était écrit en
  dur dans **les deux** clients. Un sous-agent reçoit une tâche plus étroite, pas plus facile :
  l'explorateur lit trois fichiers et cherche deux fois avant de pouvoir répondre — et `read_file`
  rend désormais une **plage**, donc un fichier long coûte plusieurs appels là où il en coûtait un
  tronqué. Huit étapes contre ça produit un sous-agent qui rapporte où il en était plutôt que ce
  qu'on lui demandait, ce qui est exactement « les agents et subagent ne fonctionnent pas » vu du
  dehors. **15**, dans une seule constante que les deux clients lisent.

### Nettoyé

- Trois symboles laissés orphelins par les corrections précédentes : `headToTokens` importé et plus
  employé dans le client terminal, `MAX_READ_TOKENS` remplacé par un budget en caractères, et
  `compilePattern` dont `searchPattern` fait désormais le travail. ⚠️ Ce dernier n'était plus appelé
  que par ses propres tests — *du code que seuls ses tests emploient n'est pas du code qui marche*.

## 1.0.2 — 2026-10-05

### Corrigé

- **⚠️⚠️ Le retour en arrière est dans l'en-tête de chaque question, où rien ne le cache.** Florian :
  « je ne la vois au-dessus d'aucune question », puis « avant ça fonctionnait, je voulais juste
  ajouter sur le premier message ».

  Ce contrôle a été « ajouté » trois fois sans qu'il en voie un seul, et **chaque tentative a échoué
  pour une raison différente** :

  1. **Sur la règle au-dessus du tour** — qu'il ne voit au-dessus d'aucune question. Elle est toujours
     dessinée et visible sur les captures de ce dépôt ; quelque chose l'en empêche chez lui, et je n'ai
     pas la cause. Ce n'est plus ce sur quoi le produit s'appuie.
  2. **Dans la rangée d'actions du message** (1.0.1) — qui vit à `opacity: 0` jusqu'au survol. Un
     correctif que personne ne peut voir sans déjà tenir la souris sur le message.
  3. **Avec `opacity: 1` sur ce bouton pour l'exempter de la rangée** — ce qui ne fait **rien** :
     ⚠️ *l'opacité ne s'hérite pas, elle se multiplie.* Un enfant d'un parent transparent ne peut pas
     être opaque. Attrapé avant livraison, contrairement aux deux précédents.

  L'en-tête d'un message n'a ni règle d'opacité ni condition de survol : un contrôle placé là existe
  dès que le message existe. C'est d'ailleurs ce que le projet exige explicitement pour celui-ci —
  *« quelque chose qui réécrit l'arbre de travail ne doit jamais se découvrir par accident »*.

- ⚠️ Et la leçon qui vaut au-delà de ce bouton : **une correction qu'on ne peut pas voir n'est pas une
  correction.** Trois livraisons ont annoncé un contrôle ajouté ; aucune ne l'avait rendu visible.

## 1.0.1 — 2026-10-05

### Corrigé

- **⚠️⚠️ « Il n'y a toujours pas le restore sur le premier message » — signalé trois fois, et le code
  disait trois fois qu'il était là.** Il l'était. Une photographie d'une conversation à un seul
  échange a tranché : le bouton existe, **24 px au-dessus du premier pixel visible**.

  La règle qui porte le retour est dessinée en **haut** de son tour, donc pour la première question
  elle est en haut de tout le fil — et le panneau s'ouvre défilé **en bas**. Sur n'importe quelle
  conversation qui dépasse d'un écran, ce contrôle est au-dessus de la ligne de flottaison. Un
  contrôle qu'on n'atteint qu'en remontant tout en haut d'une longue conversation est un contrôle que
  personne ne trouve.

  Le retour est donc aussi **sur la question elle-même**, dans sa rangée d'actions, atteignable sans
  défiler nulle part. La duplication est le correctif, pas de l'encombrement.

- ⚠️ **Et la raison pour laquelle trois corrections n'ont rien corrigé** : `turnBoundary` avait un
  test qui disait « la première question est restaurable », et ce test ne pouvait pas voir si le
  rendu l'appelait, sautait l'entrée avant, ou dessinait quoi que ce soit. *Une décision testée
  isolément et appliquée dans une boucle que rien ne teste est une décision que personne n'a
  vérifiée.* L'ordre du fil est maintenant une **valeur** (`transcriptPieces`), testée sans DOM, et
  le rendu ne fait plus que transformer des valeurs en nœuds.

- Le fil gagne de l'air en haut : une première ligne collée au cadre se lit comme coupée, quoi qu'il
  en soit par ailleurs.

### Mesuré

- La séquence de capture photographie un **premier échange** (`premier`). Toutes les autres images
  montrent un fil défilé en bas, donc le haut — et le retour du tour d'ouverture — n'avait jamais été
  sur une photo. C'est cette image, et elle seule, qui a réglé la question.

## 1.0.0 — 2026-10-05

### Corrigé — le mode agent, pour de bon

Florian a collé le journal de l'agent lui-même, et c'était l'empreinte exacte de défauts dans **ce**
dépôt :

> « Les outils se contredisent. Les diagnostics de l'éditeur signalent `copierDepuis` à la ligne 6545,
> alors que `search_text` et `git_diff` ne le voient pas. »

Les diagnostics lisent le **tampon** de l'éditeur ; `search_text` et `git_diff` lisent le **disque**.

- **⚠️⚠️ La sauvegarde après édition ne se faisait pas, et se déclarait réussie.** Le correctif de la
  0.99.0 cherchait le document par comparaison de chaînes d'URI (`d.uri.toString() === uri.toString()`)
  — or `openTextDocument` **normalise** ce qu'il renvoie, donc la recherche pouvait échouer sur le
  document qu'on venait d'éditer. Et `if (!doc?.isDirty) return ""` confondait « rien à enregistrer »
  avec « je ne l'ai pas trouvé » : **le seul cas que cette fonction existe pour attraper était celui
  qu'elle rapportait comme normal.** L'appelant passe désormais le document qu'il tient déjà, et une
  recherche infructueuse est **dite**.

- **⚠️⚠️ `edit_file` échouait sur les accents.** Le modèle l'avait compris et contournait : « Le
  fichier contient des caractères accentués que ma copie ne reproduit pas à l'identique. Je découpe
  donc l'édition en petits morceaux sans accents. » C'est de la **normalisation Unicode** : `é` vaut
  soit un seul point de code, soit `e` suivi d'un accent combinant. Identiques à l'écran, différents
  pour `indexOf`. La correspondance se fait maintenant sur la forme composée quand la littérale
  échoue, en remontant aux décalages du texte **d'origine** — et l'unicité survit à la normalisation.

- **⚠️ `edit_file` annonçait des succès qu'il n'avait pas vérifiés.** « deux modifications réussies,
  mais `elCoord` n'a pas changé ». Il relit maintenant le document et refuse de dire « modifié » si
  rien n'a bougé. Un outil qui annonce un succès non vérifié envoie le modèle dépenser ses étapes à
  se méfier de sa propre trace, ce qu'a fait cette session.

- **⚠️⚠️ Deux systèmes d'approbation qui s'ignoraient.** `confirmEdit` ouvrait un diff et une
  notification à **chaque** édition, sans jamais consulter les autorisations. Donc « toujours »
  arrêtait un demandeur et laissait l'autre demander — « le mode agent fait du compare au lieu de
  modifier » et « il redemande les autorisations après si on clique sur toujours » sont **le même
  défaut**. Le magasin d'autorisations avait toujours raison ; le second demandeur ne le lisait pas.

- **Trois boutons, pas quatre.** « il faudrait juste le bouton Accept, toujours ou deny ». Les deux
  entrées du milieu promettaient la même chose dite autrement, et celle qui disait « cette
  conversation » était justement celle qui semblait ne pas marcher. **Accepter · Toujours · Refuser.**

- **`read_file` ne tronque plus en silence.** « read_file coupe le fichier avant la zone utile. »
  Il prend `from` et `to`, et dit **toujours** quelles lignes sont revenues et l'appel exact pour lire
  la suite. ⚠️ Un outil qui tronque sans dire comment continuer a dit au modèle que le fichier
  s'arrête là — d'où le recours à `sed` par `run_command`.

- **Le plafond d'étapes passe de 12 à 30.** « il arrête une tâche en plein milieu ». Douze était
  calibré sur des tours qui marchent ; un tour qui rencontre un défaut ne dépense pas ses étapes sur
  la tâche. Trente, c'est environ trois passes de lire–éditer–vérifier sur trois endroits, soit la
  forme d'un vrai changement. Toujours borné : un modèle qui tourne en rond doit s'arrêter seul.

## 0.99.2 — 2026-10-05

### Design — et le verdict sur la 0.99.1

Florian : « Je ne vois pas les modification d'UI que tu as fait... c'est toujours aussi compliqué de
comprendre les menus, settings, etc et surtout c'est pas suffisamment aéré on ne comprend rien du
tout. »

Il a raison, et l'état mesuré dit pourquoi la passe précédente était invisible : **4 px entre les
contrôles, 3 px de padding vertical, 18 px d'interligne**. Cinq contrôles et un nom de modèle tassés
dans une colonne de 280 px sans rien entre eux. À cette densité l'œil ne trouve pas où un contrôle
finit et où le suivant commence : la rangée se lit comme une seule bande de mots. Aucun étiquetage ne
corrige ça, il faut d'abord bouger l'espacement.

⚠️ Ce sont des pas **entiers** de l'échelle, pas des fractions. *Un changement que personne ne voit
est un changement qui ne valait pas la peine* — c'est la vraie leçon de la tentative précédente.

- Les contrôles font **30 px de haut**, pas 24 — la taille des barres d'outils de l'éditeur lui-même.
- La barre d'outils **passe à la ligne** au lieu de tronquer. Le nom du modèle rétrécissait jusqu'à
  « qwe… » pour tenir sur une ligne : on échangeait la seule étiquette porteuse d'information contre
  une ligne de rien.
- **Chaque menu porte le glyphe de son sujet** (bouclier pour ce qui est permis, puce pour le modèle,
  étincelle pour la réflexion). Fermés, ils n'affichaient que leur **valeur** : « Agent ·
  qwen2.5-coder · Direct » ne dit pas que le troisième parle de raisonnement.
- Les cartes de réglages ont un vrai cadre et une vraie marge. Une carte est une **décision**, et une
  décision a besoin d'un bord que l'œil trouve.

### Corrigé

- **« so far » à côté du prix est retiré**, comme demandé — « c'est moche et inutile ». ⚠️ Mais
  l'ambiguïté qu'il rapiéçait n'était pas dans le mot, elle était dans l'**adjacence** : la taille du
  contexte et le total de la conversation se touchaient et se lisaient comme un ratio. Ils sont
  maintenant aux deux bouts de la rangée — c'est le correctif qui aurait dû venir en premier.

- **Le bouton de dictée est visible.** Il était caché tant qu'aucun transcripteur n'était configuré,
  au nom de « un bouton qui a l'air d'écouter sans écouter est pire que pas de bouton ». Le
  raisonnement est juste et appliqué au mauvais objet : il vaut contre un bouton qui prétend
  **enregistrer**, pas contre un qui propose de configurer la dictée. Le cacher rendait la
  fonctionnalité introuvable pour la personne qui l'avait demandée. Il ouvre maintenant le réglage,
  filtré sur la bonne clé.

- **L'écran des réglages ne remonte plus en haut.** `captureScroll` ne regardait que `.transcript`,
  et uniquement sur l'écran de discussion — donc tous les autres écrans repartaient du haut à chaque
  redessin, et l'écran des réglages se redessine à **chaque frappe** dans un champ de clé. ⚠️ Le
  commentaire au-dessus décrivait un problème propre au fil de discussion, et c'est donc ce que le
  code avait résolu.

## 0.99.1 — 2026-10-05

### Corrigé

- **⚠️ L'autre moitié du parcours de clé, à l'endroit où un nouvel utilisateur le rencontre vraiment.**
  La 0.99.0 avait réparé le parcours de la **palette de commandes** ; l'**écran d'installation** —
  celui qu'on voit en premier — avait toujours ses deux boutons séparés, « Enregistrer l'adresse »
  puis « Enregistrer la clé ». C'est mot pour mot ce que Florian décrivait, et je l'avais corrigé à
  côté.

  Un seul formulaire, un seul bouton (**Connecter**), les deux champs validés **à la frappe** contre
  les mêmes règles que l'autre parcours, et une vérification réelle avant d'écrire quoi que ce soit.
  Deux enregistrements, c'était aussi deux occasions de laisser une demi-configuration derrière soi :
  une clé rangée face à aucune adresse a l'air configurée jusqu'à la première question.

  ⚠️ Un problème **bloquant** et un **avertissement** ne se ressemblent plus : « ce n'est probablement
  pas ce que vous vouliez » et « ceci ne peut pas être enregistré » mènent à des gestes différents, et
  les peindre pareil apprend à ignorer le premier — qui est celui qui a généralement raison.

## 0.99.0 — 2026-10-05

### Corrigé — ce que Florian a signalé

- **⚠️⚠️ « Le restore to checkpoint ne semble pas revert le code » — et c'était pire que ça.** Un
  `WorkspaceEdit` écrit dans le **document en mémoire** de l'éditeur, pas dans le fichier. La
  restauration remettait l'ancien code à l'écran pendant que chaque fichier sur le disque gardait la
  version de l'agent. Tout ce qui n'est pas l'éditeur lit le disque : le compilateur, un observateur
  qui reconstruit une feuille de style, git, la commande suivante. Fermer la fenêtre sans enregistrer
  perdait la restauration entièrement.

  **Et les édits de l'agent lui-même n'étaient pas enregistrés non plus**, ce qui est plus grave en
  mode agent : `edit_file` puis `run_command npm test` **notait le modèle sur du code qu'il n'avait
  pas écrit**. ⚠️⚠️ Le test d'intégration affirmait `doc.getText()` — le **tampon** — et jamais le
  disque ; c'est exactement pour ça que c'est passé. Il affirme les deux, et il échoue sans le
  correctif (vérifié). [`ADR-0039`](docs/adr/0039-restaurer-doit-atteindre-le-disque.md).

- **Aucune conversation ne pouvait annuler son premier tour.** Le bouton était accroché à la ligne de
  séparation **entre** deux tours, et cette ligne n'est pas dessinée au-dessus de la première
  question. Le retour partait avec elle — alors que le premier tour est celui où l'agent travaille sur
  un dépôt intact, donc celui qu'on a le plus de raisons d'annuler.

- **Un checkpoint ne tient pas ce qu'une commande a fait, et le disait le contraire.** `prettier
  --write`, `sed -i`, un build qui régénère une feuille de style réécrivent des fichiers que rien n'a
  photographiés. La boîte disait « ce tour n'a changé aucun fichier ». Le nombre de commandes est
  retenu et dit **avant** que le bouton soit pressé.

- **⚠️ `search_text` était uniquement regex.** Un modèle qui cherche où une fonction est appelée tape
  `total(` : « Unterminated group », et la recherche ne répondait rien. **Cinq motifs sur huit** pris
  d'une recherche de code ordinaire échouent de la même façon (`cost.usd(`, `?.length`, `C++`,
  `foo)`), et tous sont évidemment des littéraux. Un motif qui ne compile pas est cherché comme du
  **texte**, et le résultat le dit — sinon le modèle croit que `total(` est une regex valide. Les
  drapeaux en ligne (`(?i)`, valides en ripgrep, Go, Rust, Python, PCRE) sont traduits ; un drapeau
  **nié** reste refusé, JavaScript ne pouvant pas l'exprimer et le retirer appliquerait l'inverse.

- **⚠️ `run_command`, deux causes.** L'intégration du shell avait **3 s** fixes, or le script de VS
  Code s'exécute dans le démarrage du shell : sur le premier terminal d'une session, derrière
  oh-my-zsh, un profil PowerShell ou WSL, il arrive trop tard et **toutes** les commandes du reste de
  la session répondaient « sortie illisible ». Un terminal neuf a 15 s, payées une fois. Et `grep`
  qui sort en 1 **a répondu** : c'était dessiné comme un échec, rapporté au modèle comme une erreur
  d'outil, et compté par `verifyTurn` comme un contrôle échoué — trois mauvaises conclusions tirées
  d'une commande correcte. ⚠️ La frontière est une frontière de **commande**, pas un espace : `npm
  test` contient le mot `test`, et traiter une suite de tests en échec comme « aucune correspondance »
  aurait été le pire faux positif possible (attrapé par le test).

- **Le bloc de raisonnement ne suivait pas son propre texte.** `.collapsible-body` est plafonné à
  260 px avec son propre ascenseur : la page pouvait être parfaitement positionnée pendant que la
  réflexion grandissait dans une boîte qui ne défilait jamais. Il suit, et s'arrête si le lecteur le
  remonte lui-même.

- **L'anneau autour de la zone de saisie** n'était posé qu'à la **construction** du composer : il
  durait donc jusqu'au prochain redessin, et `turnEnd` ne redessinait pas. Il est maintenant appliqué
  au nœud vivant quand l'état change.

- **⚠️ « Pour 40k token ça coûte 3,60 $ » — l'arithmétique était juste.** 3,60 $ est le coût **cumulé
  de la conversation**, affiché sans libellé à côté des 40 k de **contexte**. Lus ensemble : 90 $/M,
  soit 45 fois le prix d'entrée de Sonnet. Le texte visible dit « jusqu'ici ». (Vérifié sur trois
  requêtes réelles : 7 541+829 jetons → 0,023372 $, exactement `7541×2/1e6 + 829×10/1e6`.)

- **L'ajout d'une clé API se fait en un passage.** L'adresse n'était **jamais demandée** — pour une
  passerelle, la clé était enregistrée et l'adresse restait à trouver dans les réglages, sans que rien
  ne le dise. Et rien n'était vérifié, alors que le tableau des fournisseurs porte un `placeholder`
  dont le commentaire dit qu'il existe « pour qu'un mauvais collage soit visible avant d'être
  enregistré ». Désormais : adresse préremplie, clé, les deux validées à la frappe, **un GET qui ne
  coûte aucun jeton** pour prouver que ça marche, et le couple enregistré ensemble ou pas du tout.

### Ajouté

- **Dictée.** Un bouton micro dans la zone de saisie. ⚠️ **Local par défaut et éteint tant qu'il
  n'est pas configuré** : un enregistrement de voix est l'une des deux seules choses que l'extension
  ne peut pas pseudonymiser (l'autre étant une image). La voie première est une commande sur votre
  machine (`hiveyCode.dictation.command`, `{file}` substitué) ; la voie distante existe et demande le
  consentement **chaque fois, sans « toujours »**. Le texte arrive **dans la zone de saisie**, jamais
  envoyé : un reconnaisseur se trompe, et une question dictée qui s'envoie seule est une question que
  personne n'a relue. (Pas la Web Speech API : elle est inerte dans Electron.)

- **Deux apparences.** `hiveyCode.appearance` vaut `editor` (emprunter le thème, par défaut) ou
  `hivey` (surfaces et accents propres au produit, ambre sur une base froide). ⚠️⚠️ VS Code n'injecte
  pas le thème dans une feuille de style mais en **style en ligne** sur l'élément racine, qui bat tous
  les sélecteurs : la première version a échoué et **la capture est revenue identique au pixel près**.
  Et même corrigée, la capture suivante a montré la **vraie limite** : le fond du panneau est peint
  par VS Code **en dehors du document** que l'extension contrôle, donc `hivey` restyle ce que cette
  feuille dessine **par-dessus la base de l'éditeur**. La promesse a été corrigée partout plutôt que
  l'effet maquillé, et **un thème clair garde l'apparence de l'éditeur** — une palette sombre sur un
  fond clair qu'on ne peut pas changer n'est pas un style, c'est un défaut de contraste. D'où la règle
  — *une apparence décrite en prose est une apparence que personne ne peut vérifier*.
  [`ADR-0040`](docs/adr/0040-deux-apparences-et-un-style-en-ligne.md).

- **La bascule de langue atteint tout l'extension.** `t()` résolu à l'appel ne suffisait pas : un
  module qui écrit `export const MODES = [{ label: t("Chat") }]` appelle `t()` **pendant son
  évaluation**, avant que l'extension ait lu son propre réglage. Les étiquettes de mode, les 20
  familles de compétences et les ~117 indices restaient dans la langue de l'OS. ⚠️ `modes.ts` portait
  un commentaire affirmant le contraire de ce que faisait son code. Une limite honnête demeure et est
  **dite** : la palette de commandes et la page des réglages suivent la langue d'affichage de VS Code,
  qu'aucune extension ne peut changer.

### Design

- **L'envoi devient plein dès qu'il y a quelque chose à envoyer** — information, pas décoration.
- **Le rythme vertical entre deux tours** : 44 px de marges empilées disaient trois fois ce que la
  règle disait déjà.
- **Une liste d'étapes finie se replie** au-delà de six, avec un résumé qui dit ce qu'il y a dedans.
  ⚠️ Un tour contenant un **échec** reste déplié.
- **L'approbation d'une édition dit son ampleur** (`+12 −3`) : entre un correctif de deux lignes et
  une réécriture de 400, c'est le fait qui décide d'un oui rapide ou d'une lecture attentive.

### Mesuré

- `MUTATING_TOOLS` ignorait `git_stage`, `knowledge_write`, `knowledge_retire` et `arcad_action` — un
  tour dont le seul changement était de promouvoir du code en production était classé comme n'ayant
  rien changé. Et le test du mode Plan tournait sur **sept outils synthétiques** sans jamais voir le
  registre réel de 45 ; deux listes écrites indépendamment sont maintenant croisées.
- Les jetons d'un **sous-agent** étaient jetés par le client terminal, donc le banc publiait des coûts
  **sous-estimés**.
- ⚠️ Un **octet NUL** dans `outcome.ts` rendait le fichier binaire pour `grep`, `file(1)` et `diff`.
  Trouvé parce qu'une recherche d'un symbole que le fichier exporte ne renvoyait rien. Un garde-fou
  refuse désormais tout octet de contrôle dans une source.

## 0.98.2 — 2026-10-04

### Ajouté

- **Le cours existe en anglais** (`docs/course/`, 14 chapitres), demandé par Florian. Ce n'est pas une
  traduction mot à mot : c'est la même progression, écrite pour la même personne — celle qui ne code
  pas — et les chapitres portent des slugs anglais (`10-the-cost.md`).

  ⚠️ Et il est **tenu par le même contrôle**, parce que le projet a déjà payé l'autre approche :
  `README.fr.md` avait fini par annoncer 284 tests alors qu'il y en avait 700. `check:course` exige
  donc maintenant que les **deux éditions** déclarent la version du projet **et qu'aucune ne porte un
  chapitre que l'autre n'a pas** — ce qui rend une modification d'une édition non finissable sans
  l'autre. La parité se juge sur le **numéro** de chapitre, pas sur le nom de fichier : les slugs sont
  traduits, et comparer les noms déclarerait chaque chapitre manquant des deux côtés.
  [`ADR-0038`](docs/adr/0038-deux-editions-du-cours-tenues-ensemble.md).

### Corrigé

- **⚠️⚠️ Deux chiffres faux dans le cours français, trouvés en écrivant l'anglais — et tous les deux
  invisibles au contrôle pour la même raison.** L'index annonçait « vingt-six décisions motivées »
  (il y en avait **37**) et le chapitre IBM i « Quarante compétences » (il y en a **41**).

  `check:numbers` ne pouvait rien y voir : **un nombre écrit en lettres ne peut pas être vérifié.**
  Les deux sont passés en chiffres, ajoutés au contrôle, et leur source est **calculée depuis le
  dépôt** — le nombre de fichiers d'ADR, et le nombre de `group:` des quatre familles IBM i — plutôt
  que mémorisée. Troisième fois sur ce projet qu'un garde-fou manquait son sujet parce que la
  **forme** de la donnée l'en empêchait.

- **Le tableau des préréglages ne permettait pas de relier une promesse à sa mesure.** Il donnait les
  libellés (« Hivey Smart », « Hivey Pro ») quand le chapitre sur la qualité publie les identifiants
  (`hivey`, `hivey/smart`) — et les deux **ne se correspondent pas**, héritage de deux renommages.
  Les deux éditions portent la colonne des identifiants et disent que le décalage existe.

- **Une date relative dans un document maintenu** : « trouvé il y a deux jours » est devenu « trouvé
  en octobre 2026 ».

### Mesuré

- **La série `hivey` rejouée après ajout de crédit.** Le diagnostic de la 0.98.1 est confirmé par
  Florian : *« j'ai mis des credits, le auto-fill etait effectivement desactivé »*. La même série qui
  avait donné **2/62** — entièrement à cause des 402 — repasse normalement, et une requête payante
  réelle a été vérifiée de bout en bout (5 étapes, 17 519 jetons, 0,0459 $, aucun raccourcissement).
  Les refus n'étaient pas du bruit de mesure : ils **étaient** la mesure.

## 0.98.1 — 2026-10-04

### Corrigé

- **⚠️⚠️ « Le crédit est à zéro mais la limite de la clé est à 50 avec rechargement auto, il faut que
  ça fonctionne jusqu'à la limite » — et la réponse honnête est qu'aucun code ne peut faire ça.**
  Reproche de Florian sur la 0.98.0 : « je veux que tu corriges, pas que tu rajoutes juste un
  message ». Il avait raison sur le principe, et les chiffres du compte disent pourquoi le correctif
  demandé n'existe pas.

  **Mesuré** (`GET /api/v1/credits`) : `total_credits: 240,00` $ achetés depuis toujours,
  `total_usage: 240,11` $ consommés. Le solde est donc de **−0,11 $**. Pendant ce temps la clé
  affichait **48,42 $ de marge sous un plafond de 70 $** — intacte, parce qu'**un plafond ne se
  consomme pas**.

  ⚠️ **Un plafond de clé est une autorisation de dépenser, pas de l'argent.** « 50 $ » veut dire
  « jusqu'à 50 $ **de l'argent du compte** ». Sur un compte à zéro, 50 $ de rien font rien. Ce qui
  transforme un plafond en marge utilisable dans le temps est le **rechargement automatique** — et
  il n'avait pas eu lieu, sinon le solde ne serait jamais tombé à zéro. Trois causes, toutes
  invisibles depuis l'extension : pas activé, seuil non franchi, ou **moyen de paiement refusé** (le
  cas le plus fréquent, et le fournisseur n'en dit rien).

  Donc **pas de nouvelle tentative sur un 402 de solde** : réessayer un compte vide ne le remplit
  pas, ça fait attendre pour échouer quand même. Ce qui change, c'est ce que l'outil **affirme** —
  et c'est un correctif, pas un message de plus, parce que l'ancien texte envoyait régler le mauvais
  réglage :

  > That is the account **BALANCE**, not your key's limit — a limit is permission to spend money the
  > account has. Check the balance and auto top-up (a declined card is the usual cause); raising the
  > key's limit does nothing.

  Le plafond de la clé a été relevé deux fois avant de comprendre, en suivant le conseil du message
  brut d'OpenRouter. Trois assertions interdisent maintenant de revenir en arrière sur chacune des
  trois affirmations.

  Le cas où le logiciel **répare** vraiment reste celui de la 0.98.0, et il est différent : quand il
  y a un peu d'argent mais pas assez, le refus porte son propre remède (« 4 096 demandés, 1 991
  finançables ») et la requête est refaite à ce montant.

### Documentation

- `docs/cours/10-le-cout.md` gagne **« Solde, plafond, rechargement : trois choses différentes »** —
  les trois mots se ressemblent, désignent trois objets sans rapport, et les confondre a coûté une
  après-midi. Avec les chiffres réels et la raison pour laquelle l'outil ne peut pas s'en sortir seul.
- [`docs/adr/0037`](docs/adr/0037-un-402-qui-dit-ce-qu-il-peut-payer.md) complété : un 402 de solde et
  un 402 de plafond de réponse sont deux refus différents, un seul a un remède.

## 0.98.0 — 2026-10-04

### Corrigé

- **⚠️⚠️ Un `402 Payment Required` n'est plus une impasse — et il y avait deux défauts, dont un cachait
  l'autre.** Signalé par Florian : « de nouveau l'erreur 402, alors qu'il y a du crédit ». Les deux
  moitiés de la phrase étaient vraies, et c'est tout le problème.

  ⚠️ **« Il y a du crédit » désigne le plafond de la clé, pas de l'argent.** La clé annonçait 48,42 $
  de marge sous une limite de 70 $ : ce n'est pas un solde, c'est ce qu'elle a le **droit** de
  dépenser si l'argent existe. `limit_source: openrouter_credits` dit que c'est le **solde du compte**
  qui est épuisé — et le texte d'OpenRouter conseille de relever la limite de la clé, ce qui ne change
  rien (elle a été relevée deux fois pour s'en assurer).

  Et le refus **porte sa propre solution** : « vous avez demandé 4096 jetons, vous ne pouvez en
  financer que 1991 ». La requête est donc refaite pour ce montant.

  **Défaut 1 — le 402 n'atteignait jamais le code qui répare.** `adaptRequest` reprend une requête
  rejetée pour un champ, et sa porte d'entrée lisait `res.status !== 400` : **seul un 400**. Donc le
  seul refus qui porte son propre remède était précisément celui qui n'atteignait jamais les remèdes.

  **Défaut 2 — et quand il y arrivait, il faisait l'inverse.** La règle générique retire « tout champ
  que le serveur nomme », et le message du 402 **contient les mots `max_tokens`** (« requires more
  credits, **or fewer max_tokens** »). Le plafond était donc **supprimé** et la requête rejouée **sans
  plafond** : demander une réponse illimitée à l'instant où le serveur demande d'en demander moins.
  Corriger ce second défaut ne changeait rien tant que le premier tenait.

  Désormais : le plafond est **abaissé** à ce que le fournisseur dit pouvoir financer, jamais
  supprimé ; la règle du solde passe **avant** la générique pour que celle-ci ne puisse plus
  l'inverser ; un plafond déjà inférieur n'est pas touché (le refus porte alors sur le prompt) ; et
  **sous 256 jetons le refus tient**, parce qu'une réponse de 150 jetons est un fragment, et qu'un
  fragment rendu en silence est **pire que l'erreur** — le lecteur le prend pour l'avis du modèle.

  **Et la réponse dit qu'elle a été raccourcie** : « le fournisseur n'a pas financé une réponse
  entière, celle-ci est plafonnée à 1 991 jetons ; ajoutez du crédit si elle vous paraît coupée ».
  C'est la seule phrase qui dit que c'est le **solde**, et non le modèle, qui a décidé où la réponse
  s'arrêtait.

  **Éprouvé en vrai** sur la clé qui refusait à l'instant : refus, relance automatique à 1 991 jetons,
  appel d'outil, réponse juste, mention affichée — là où la même requête rendait une impasse une
  minute plus tôt. Voir [ADR-0037](docs/adr/0037-un-402-qui-dit-ce-qu-il-peut-payer.md).

## 0.97.0 — 2026-10-04

### Documentation

- **La phase 5 est écrite, et dérivée des chiffres plutôt que d'impressions** — c'est la règle que la
  phase 4 a imposée en se trompant quatre fois sur cinq. Chaque chantier porte le nombre dont il
  vient, relevé sur les trois séries complètes des 3 et 4 octobre, ou une lacune qu'un de mes propres
  ADR avait déclarée dans sa section « ce que ceci ne fait pas ». **Un chantier sans nombre n'entre pas
  dans cette phase.**

  - **5.1 rendre le banc capable de trancher** — 48, 47 et 50 sur trois séries **identiques** : un
    chantier qui déplace deux tâches n'est pas jugeable, et plusieurs des suivants en déplacent deux.
    La répétition devient le défaut, le tableau rend la médiane **avec** son écart, et un effet situé
    dans l'écart est déclaré non jugeable au lieu d'être accepté au hasard. Ce chantier passe devant
    tous les autres.
  - **5.2 une réponse ne peut pas contredire son propre verdict** — **10 des 17** échecs que
    `qwen3.7-flash` a annoncés comme des réussites sont survenus **après** un rappel de vérification,
    et **5** avec un échec visible dans la trace que le modèle avait lue. Le produit connaît déjà la
    contradiction (`verifyTurn`) et la réponse n'en porte rien.
  - **5.3 vérifier la bonne chose** — les **5 autres** n'ont rien vu échouer : le contrôle lancé
    n'était pas celui qui décide. ⚠️ **7 des 10 cas sont des tâches IBM i**, dont le contrôle est
    *structurel* — il n'existe souvent aucune commande à lancer qui le refléterait. C'est donc autant
    une propriété du banc qu'un défaut du modèle, et c'est dit avant de corriger quoi que ce soit.
  - **5.4 les compétences offertes ne servent jamais** — `use_skill` appelé **0 fois sur 180 tours**,
    sur trois configurations. Le chantier 4.2 les a rendues atteignables ; le modèle ne les a jamais
    demandées. **Offrir n'est pas utiliser.** Décision annoncée d'avance : forcer la compétence sur la
    famille correspondante, et selon le résultat réparer la **sélection** ou **sortir les 85
    descriptions du préfixe** — on ne paie pas des jetons à chaque tour pour une capacité que rien
    n'emploie.
  - **5.5 la délégation offerte ne sert jamais** — `run_agent` appelé **1 fois sur 180**. Même
    protocole.
  - **5.6 `local only` est inutilisable** — **0/56**, dont 51 tâches sans une seule étape d'outil,
    alors que c'est la configuration dont tout le discours du produit dépend. L'ADR-0026 a rendu
    l'agent local *possible*, pas *capable*.

- **Le cours gagne un chapitre d'honnêteté sur les bancs d'essai** : « la même mesure, deux fois, ne
  donne pas le même chiffre », avec les 48/47/50 mesurés ici et ce qu'il faut en conclure — quand un
  outil annonce « 3 % de mieux », la question n'est pas « 3 % de quoi » mais « combien de fois l'avez-vous
  mesuré ».

## 0.96.0 — 2026-10-04

### Mesuré

- **Deux configurations de plus, sur les 62 tâches, sans aucun refus** — et ce sont les deux premières
  lignes du tableau mesurées avec les consignes corrigées, donc les deux seules comparables entre
  elles. Voir [ADR-0036](docs/adr/0036-ce-que-le-gratuit-donne.md).

  | configuration | réussi | annoncé fini à tort | coût |
  |---|---|---|---|
  | `remote only` — `qwen3.7-flash` | **45/62** (73 %) | 17 | **0,043 $** — 0,0007 $/tâche |
  | `hivey/free` — `nemotron-3.5-lightning:free` | **32/62** (52 %) | 27 | **0,00 $** |

  **Le gratuit fait la moitié du banc, pour rien.** Et un modèle payant bon marché fait 73 % pour
  **quatre centimes sur 62 tâches**, là où le préréglage `hivey` fait 89 % à 0,0766 $ la tâche — cent
  fois plus cher pour seize points. ⚠️ Les deux ne sont pas strictement comparables : la ligne `hivey`
  date d'avant la réparation de trois consignes. L'ordre de grandeur ne dépend pas de ces trois
  tâches ; le tableau dit lesquelles sont comparables, ligne par ligne.

- **⚠️⚠️ Le chantier 4.4 est confirmé à l'échelle, et il dit maintenant précisément ce qu'il est.** Le
  rappel « tu as changé quelque chose et rien n'a vérifié » s'est déclenché **23 fois sur 62** avec
  `qwen3.7-flash`, **15 fois sur 62** avec le préréglage gratuit, et **0 fois sur 56** avec
  `gpt-6.1-sol-pro`. L'ADR-0035 l'avait établi sur six tâches construites exprès ; c'est maintenant
  mesuré sur le banc entier, sans tâche faite pour l'occasion. **Entre un quart et un tiers des tours
  d'un modèle bon marché se terminent sur un changement que rien n'a vérifié**, et aucun de ceux d'un
  modèle fort. Ce n'est pas un filet pour le banc : c'est un filet pour les modèles que ce produit
  existe pour rendre utilisables. Le modèle cher n'en a pas besoin ; c'est celui à quatre centimes qui
  en vit.

### Corrigé

- ⚠️ **Deux messages se contredisaient sur un `402`, et ça a coûté un détour entier.** OpenRouter
  disait « ajuste la limite mensuelle de la clé » pendant que ce client disait « c'est le solde du
  compte, pas la clé ». Le client avait raison — mais les deux phrases se valaient à la lecture, donc
  le plafond de la clé a été relevé **deux fois** sans effet. OpenRouter renvoie en fait un champ
  structuré, `limit_source`, que personne ne lisait. Le message dit désormais **lequel** des deux a
  refusé : `openrouter_credits` → « seul l'ajout de crédit y change quelque chose » ; un plafond
  configuré → « c'est un plafond, pas le solde ». Envoyer quelqu'un vers le mauvais des deux coûte un
  après-midi.

- ⚠️ **Le harnais démarrait tous ses ouvriers au même instant**, ce qui déclenchait la cascade de refus
  que sa propre temporisation existe pour encaisser : quatre tours d'agent ouverts dans la même
  seconde réservent quatre lots de crédit avant qu'aucun n'ait répondu, le fournisseur refuse, et la
  concurrence ne redescend qu'**après** les dégâts. Ils démarrent à une seconde d'intervalle.

### Non fait

- **Le préréglage `hivey` n'a pas pu être remesuré.** Le solde de crédit du compte ne finance plus une
  requête de cette taille sur un modèle à un million de jetons. Il faut du crédit sur le **compte**,
  pas un plafond de clé plus haut — le tableau le dit dans ses réserves.

## 0.95.0 — 2026-10-03

### Corrigé

- **⚠️⚠️ Les consignes du banc passaient par un shell, et trois d'entre elles étaient corrompues depuis
  des mois.** Elles étaient interpolées avec `JSON.stringify`, qui produit des guillemets **doubles**
  — et dans des guillemets doubles, `sh` exécute toujours les accents graves. Chaque identifiant écrit
  entre accents graves était donc **exécuté comme une commande** : `` `any` `` disparaissait, et
  `` `open` `` était **remplacé par la sortie d'aide de `xdg-open`**, ce que le modèle a signalé
  lui-même en demandant de quel statut on parlait. « No `any` and no `as` casts are to remain »
  arrivait au modèle comme « No and no casts are to remain » — une phrase privée de son sujet. La
  consigne passe maintenant en **argv**, sans shell. Et le fond dépasse la citation : une consigne est
  du contenu de dépôt qui atteignait `sh -c` ; que ce soit le nôtre était de la chance.

- **⚠️⚠️ Un refus du fournisseur n'était pas enregistré comme un refus.** La règle « un refus n'est pas
  un échec » existait pour le plafond de dépense **local** et avait un trou de la taille exacte de ce
  pour quoi elle a été construite. OpenRouter a répondu `HTTP 402 — cette requête dépasserait vos
  crédits disponibles compte tenu de vos requêtes en vol` à **54 tâches sur 62**, et le harnais a
  compté **8 réussites sur 62**. Il aurait publié **13 %** comme la qualité de cette configuration :
  pas un chiffre faux, **un chiffre qui ne parle de rien**. Un 402 ou un 429 est désormais un refus,
  et un jeu qui en contient **n'énonce aucun taux**.

- ⚠️ **La colonne `time` du tableau se lisait comme une durée** alors qu'elle est la **somme** des
  durées de tâches : avec six en parallèle, l'horloge murale en est le sixième. J'ai annoncé « 62 min »
  et « 65 min » comme des temps d'attente ; c'étaient des sommes. Renommée **`model time`**, et le
  document dit ce qu'elle est. Un chiffre dont le nom invite à la mauvaise lecture sera mal lu.

### Ajouté

- **Six tâches dont la consigne ne demande pas de vérifier** (`kind: "noverify"`), pour éprouver le
  chantier 4.4. La propriété définissante est une propriété des **consignes** — aucune ne contient
  « test », « vérifie », « lance », « compile » — et un test de garde la protège : un seul « assure-toi
  que les tests passent » ajouté en rangeant sortirait silencieusement une tâche de la famille.

  ⚠️ Et le point qu'il ne fallait pas rater : une tâche dont l'édition naïve est déjà correcte
  déclencherait le rappel **sans rien changer**. Chaque fixture porte donc un second endroit que le
  changement doit atteindre — un autre appelant, une constante dupliquée, un `switch` exhaustif, une
  liste blanche fermée, un `insert` positionnel — et les quatre pièges mécanisables sont éprouvés un
  par un. ⚠️ La porte d'honnêteté m'a corrigé au passage : deux de mes six contrôles **passaient sur
  la fixture intacte**, parce qu'ils vérifiaient le comportement, qui ne change pas quand on renomme
  une fonction.

- **Le harnais découvre la concurrence que le compte autorise** au lieu qu'on la lui dise. Un
  fournisseur retient du crédit pour chaque requête en vol ; sur un modèle à un million de jetons la
  réserve est grosse, et aucun nombre fixe n'est juste pour tous les comptes. À chaque refus il divise
  sa concurrence par deux, remet la tâche en file, et ne descend jamais sous un.

- **Le tableau peut porter ses propres réserves** (`--note`). Il ne pouvait pas dire « ces chiffres ont
  un défaut connu », et les deux seules issues étaient d'effacer une mesure réelle ou de présenter une
  mesure défectueuse comme propre. Ni l'une ni l'autre n'est honnête ; une réserve imprimée **au-dessus**
  du tableau l'est — une réserve placée après le chiffre est une réserve que personne ne lit.

### Mesuré

- **Le chantier 4.4 est justifié, et le chiffre est net.** Sur `qwen3.7-flash`, la famille passe de
  **0/6 sans le rappel à 4/6 avec**, le rappel partant exactement **4 fois sur 6** ; la chaîne causale
  est observable tâche par tâche. Le 0/6 n'est pas un artefact : le modèle a édité sur les six, est
  sorti proprement sur les six, et n'a vérifié qu'une fois — le mode d'échec « annoncé fini » à l'état
  pur. Sur `gpt-6.1-sol-pro` il ne se déclenche **jamais** : sans qu'on le lui demande, ce modèle
  vérifie de lui-même. **4.4 n'est donc pas un filet pour le banc, c'est un filet pour les modèles bon
  marché** — la population même que ce produit cherche à rendre utilisable. Voir
  [ADR-0035](docs/adr/0035-les-taches-qui-ne-demandent-pas-de-verifier.md).

### Non fait

- **La série de remplacement sur les 62 tâches n'a pas pu tourner.** OpenRouter refuse les requêtes de
  cette taille faute de marge sous la limite mensuelle de la clé — 28,47 $ restants, une requête
  minimale passe, un tour d'agent non. Le tableau porte donc ses chiffres **avec leurs réserves**,
  dont celle-ci.

## 0.94.0 — 2026-10-03

### Corrigé

- **⚠️⚠️ Une correction annoncée dans ce journal n'avait jamais eu lieu.** Les identifiants de
  préréglage du tableau de qualité (`hivey/balanced`, `hivey/pro` — qui n'existent nulle part dans le
  produit) étaient déclarés corrigés en 0.90.0. L'édition censée le faire était **un remplacement de
  chaîne qui n'a rien trouvé**, et dont je n'ai pas regardé le résultat. Le tableau a donc nommé
  pendant trois versions des configurations que personne ne peut choisir, pendant que le journal
  affirmait le contraire. C'est la même faute que la sortie de construction masquée plus tôt dans la
  journée : **une opération dont on ne vérifie pas le résultat**. Réparé, avec un test qui compare la
  liste du tableau aux préréglages réels, et l'entrée mensongère porte sa correction.

### Ajouté

- **⚠️⚠️ Le banc tourne les tâches en parallèle, et ce n'était pas un détail de confort.** La boucle
  était strictement séquentielle : 56 tâches à une ou deux minutes chacune font **une heure et demie
  de temps réel pour répondre à une question** — et la question est d'ordinaire « est-ce que ce
  changement a aidé ? », posée deux fois. Deux heures et demie pour comparer deux choses est une
  mesure que personne ne lance, et une mesure que personne ne lance est une règle que le projet
  prétend seulement suivre. Rien n'avait besoin d'être séquentiel, sauf une ligne :
  `process.env["HIVEY_CODE_MODEL"] = model`, un global qui ne peut pas valoir deux choses à la fois.
  Passé à l'enfant ; **six tâches à la fois par défaut** ; les 56 passent de ~90 à **~7 minutes**.

  Et chaque tâche reçoit son propre `HOME`, donc plus aucun état partagé — et une mesure qui ne lit
  plus le `~/.hiveycode.json` de celui qui l'exécute. Un banc contaminé par son opérateur n'est pas
  reproductible, ce qui est la seule propriété qui le rende utile.

- **Le tableau peut tenir plusieurs séries** (`--from a.json,b.json`) et **publie son propre bruit**.
  ⚠️⚠️ Trois séries du **même** préréglage, sur les mêmes tâches et le même build, ont donné **48, 47
  et 50** réussites : un écart de trois tâches sans que rien ne change entre elles. Donc **une
  différence inférieure à cet écart n'est pas un résultat** — et un tableau qui montre une série par
  ligne invite précisément à cette erreur. Rapporté plutôt que moyenné : une moyenne cache l'écart, et
  l'écart est ce qui dit ce que le pourcentage vaut. C'est le genre de chiffre qu'un banc doit publier
  sur lui-même avant d'en publier sur les modèles.

- **Le rappel de vérification est instrumenté** (`TurnResult.selfChecked`), parce que le chantier 4.4
  ne pouvait pas être jugé sans ça.

### Mesuré

- **Chantier 4.6 — DeepSeek v4.1 est abandonné.** 44/56 contre une plage observée de 47 à 50 pour le
  préréglage, et **plus du double d'échecs annoncés comme des réussites** (11 contre 5 et 7). Sous
  l'intégralité de la plage mesurée, donc la direction tient malgré le bruit. La décision avait été
  écrite avant la mesure. Mais le chiffre qui ne va pas dans son sens est écrit aussi : **33 fois
  moins cher** — 0,0024 $ la tâche contre 0,0766 $. Voir
  [ADR-0034](docs/adr/0034-deepseek-abandonne-et-le-bruit-du-banc.md).

- **Chantier 4.4 — non éprouvé par ce banc, et ce n'est pas un échec.** Le rappel s'est déclenché
  **0 fois sur 56**, et l'explication est mesurée plutôt que supposée : **51 tâches sur 56 ont changé
  quelque chose, et dans les 51 un contrôle a tourné.** La précondition (ça a changé, rien n'a
  vérifié) n'a jamais été remplie — **0 occasion sur 51** — parce que les tâches de ce banc demandent
  un résultat vérifiable, donc le modèle lance un contrôle de lui-même. La population que 4.4 visait,
  « change ça » sans demander de preuve, n'y est pas représentée. Le mécanisme est **gardé** et son
  état est écrit : non mesuré. La règle de la phase visait un chantier qui a eu sa chance ; celui-ci
  n'a pas eu d'occasion.

## 0.93.0 — 2026-10-03

### Corrigé

- **⚠️⚠️ Chantier 4.5 — le contrôle de réflexion était caché sur le modèle le plus fort du produit.**
  Le projet énonce un invariant : aucune version de modèle en dur. Il est tenu pour les prix, les
  fenêtres et les préréglages — et ne l'était pas pour la capacité de raisonner, décidée par une
  expression régulière **nommant des versions** (`o[134]|gpt-5|…|grok-[34]|gemini-[23]`). Elle
  reconnaît `gpt-5` ; le marché est passé à `gpt-6`.

  Donc **`openai/gpt-6.1-sol-pro` — le modèle vers lequel les *deux* préréglages payants envoient le
  travail approfondi — était déclaré incapable de raisonner**, et comme ce drapeau commande
  l'affichage du contrôle, l'utilisateur **ne pouvait pas activer la réflexion** dessus. Idem pour
  `poolside/laguna-s-2.1`, leur modèle de complétion. OpenRouter annonce `reasoning: true` pour les
  deux. La capacité est désormais relevée de `supported_parameters` et régénérée par le workflow
  quotidien comme les prix — 327 modèles sur 454. Voir
  [ADR-0033](docs/adr/0033-la-capacite-de-raisonner-vient-du-catalogue.md).

  Le repli subsiste, parce que le catalogue ne peut rien dire d'un modèle local qu'aucune passerelle
  ne liste — une réponse purement catalogue couperait la réflexion de **tous** les modèles locaux
  d'un coup. Mais **il ne nomme aucune version** : des familles d'éditeur, stables pour des années, et
  les deux mots qui décrivent la capacité. Un repli qui nommerait des versions serait ce même défaut
  un étage plus bas, et un test lit son source pour refuser qu'il contienne un chiffre.

### Ajouté

- **Chantier 4.4 — vérifier pendant le tour, pas seulement après.** Un tour se terminait **à
  l'instant** où le modèle arrêtait d'appeler des outils, et rien ne demandait si le travail avait été
  vérifié. Le produit avait deux réponses à « ça a l'air inachevé », toutes deux chères : le dire à
  l'utilisateur, ou **escalader vers un modèle facturé**. Le milieu bon marché manquait — demander au
  **même** modèle de finir ce qu'il a commencé. Il en est généralement capable : il a oublié, il n'a
  pas échoué. Voir [ADR-0032](docs/adr/0032-verifier-pendant-le-tour.md).

  **Au plus un rappel par tour** (un second serait une discussion, et un modèle qui insiste ferait du
  plafond d'étapes le seul frein) ; **il coûte une étape**, parce que c'est un vrai aller-retour et de
  l'argent réel ; **la réponse prématurée est jetée**, parce qu'afficher les deux se lirait comme
  l'assistant se contredisant à deux lignes d'intervalle ; et le message est **en forme de preuve**,
  pas de question — « tu es sûr ? » invite un modèle à rassurer, « tu as changé `src/a.ts` et aucun
  contrôle n'a tourné » ne laisse qu'une chose à faire. Il ferme aussi l'échappatoire qui serait
  prise : « s'il n'y a vraiment rien à lancer, dis-le et arrête-toi — n'invente pas de commande ».

  ⚠️ Subtilité corrigée par son propre test : « rien n'a vérifié » veut dire **aucun contrôle n'a
  tourné**, et non *aucun contrôle n'est passé*. Un modèle qui a lancé les tests et les a vus échouer
  a un autre problème, que `verifyTurn` escalade déjà.

- **Une modification dit ce qu'elle a cassé.** `edit_file` et `write_file` rapportent les **erreurs**
  que l'éditeur signale pour ce fichier. Le serveur de langage tourne déjà, analyse à chaque
  changement et a raison sur le langage — trois choses que l'avis d'un modèle sur son propre diff ne
  peut pas revendiquer. **Les erreurs seulement** : un avertissement est une opinion de style, et une
  modification qui en imprimerait serait du bruit à chaque tour. **Rien quand il n'y en a pas** : une
  liste vide quelques millisecondes après une modification veut dire « il n'a pas encore répondu »
  aussi souvent que « c'est bon », et une absence ne se rapporte jamais comme un zéro. L'attente est
  bornée et se résout au premier changement de diagnostics.

### Précisé

- **Ce que 4.5 n'avait pas besoin de faire** : sa rédaction demandait que le *niveau* de réflexion soit
  choisi d'après le modèle. Vérifié dans le code — la traduction par fournisseur est déjà juste et sans
  version, l'interaction `max_tokens`/`budget_tokens` d'Anthropic est déjà traitée avec son
  commentaire, et la capacité publiée par le catalogue est **binaire**. **Quatrième prémisse fausse
  sur cinq chantiers** de cette phase.

## 0.92.0 — 2026-10-03

### Corrigé

- **⚠️⚠️ Chantier 4.3 — la délégation était transitive et non bornée.** `toolsForAgent` rendait **tous**
  les outils disponibles quand une définition de sous-agent n'a pas de ligne `tools:`. C'est le bon
  défaut pour lire et écrire — un fichier de définition ne doit pas pouvoir s'accorder un outil que le
  mode n'offre pas — et c'était le mauvais pour **le seul outil qui récurse** : `run_agent` en faisait
  partie. Un sous-agent défini sans restriction pouvait donc dispatcher des sous-agents, qui
  pouvaient en dispatcher à leur tour. La largeur de chaque niveau est bornée par son plafond
  d'étapes ; **la profondeur ne l'était par rien**, et aucune garde ni aucun test n'existait nulle
  part.

  La règle posée est celle que la description de l'outil **promettait déjà** — « il travaille seul et
  ne rend que sa conclusion » : **un sous-agent est une feuille**. `NEVER_DELEGATES`, soustrait des
  **deux** branches, parce que demander explicitement n'est pas une autorisation. Pas un réglage :
  c'est une garantie, et une garantie vit dans le code. Voir
  [ADR-0031](docs/adr/0031-un-sous-agent-est-une-feuille.md).

- ⚠️ **Une ligne de trace ne nommait jamais le sous-agent dispatché.** `callSignature` déclarait
  `run_agent: ["agent", "task"]` alors que le paramètre du schéma s'appelle `name` : l'argument
  n'existait jamais, le repli prenait `task`, et la trace montrait la tâche **sans dire quel agent
  l'avait reçue**. C'est précisément le défaut que ce fichier existe pour empêcher — « quelqu'un qui
  relit ce qu'un agent a fait à son dépôt a besoin de l'appel ».

### Ajouté

- **Le terminal a des sous-agents.** Quatrième moitié oubliée de cette phase, et comme à chaque fois
  la conséquence n'était pas seulement la fonctionnalité absente : le banc **pilote ce client**, donc
  rien de la délégation n'était mesurable. Il lit les définitions du dépôt et du dossier personnel
  avec l'analyseur du cœur — les mêmes fichiers que le panneau — puis les fusionne avec les quatre
  intégrés (`explorer`, `reviewer`, `tester`, `dba`), les siennes d'abord. Un fichier mal formé est
  signalé et ignoré : il doit coûter un agent, pas la fonctionnalité. Les agents en **lecture seule**
  peuvent partir à plusieurs, les autres non — la règle est une propriété des agents, pas du client.
  Et un sous-agent du terminal est **anonymisé par le même coffre** que le tour principal : sa requête
  sort par la même porte, et une seconde notion de ce qu'il est sûr d'envoyer serait une seconde
  réponse à la question que ce produit existe pour répondre.

  Vérifié de bout en bout contre un vrai modèle : le terminal dispatche `explorer`, l'agent travaille,
  rend sa conclusion, et la trace le nomme.

### Précisé

- **Ce que 4.3 n'avait pas besoin de faire**, et que sa rédaction affirmait manquant : le parallélisme
  est entièrement implémenté (`Promise.all` sur les appels voisins déclarés sûrs, approbations
  résolues avant et une par une, voisins seuls fusionnés pour préserver l'ordre) et la synthèse **est**
  le mécanisme — la conclusion revient comme résultat d'outil. Quatrième fois dans cette phase qu'un
  chantier a été écrit depuis une hypothèse ; troisième fois que la prémisse était fausse.
- ⚠️ Et une erreur plus bête, le même jour : j'ai masqué la sortie de la construction du paquet de
  tests, la compilation a échoué, et j'ai lu un **compte de tests périmé** comme un succès. **Un
  contrôle dont on ne regarde pas la sortie n'est pas un contrôle.**

## 0.91.0 — 2026-10-03

### Ajouté

- **« À savoir » : ce qu'il a remarqué, ce qu'il n'a pas vérifié, et l'état de l'outil.** Une section
  sous la réponse, et **deux de ses trois sources sont dérivées de faits que le produit possède
  déjà** — la trace du tour, le plan, le budget, et la *forme* des appels d'outils revenus. C'est la
  décision qui compte : une fonctionnalité qui reposerait sur un modèle choisissant d'être prévenant
  serait absente précisément sur les modèles qui en ont le plus besoin. Seule la première source a
  besoin de lui, et elle reçoit **un outil** (`note_aside`) plutôt qu'une convention sur la prose.
  Voir [ADR-0030](docs/adr/0030-a-savoir.md).

  Quatre règles de retenue, tenues par onze tests : **une notice n'est pas une action** — le résultat
  de l'outil dit au modèle « noté pour l'utilisateur, ne le corrige pas », parce que toute la valeur
  est que la trouvaille atteigne la personne sans que le diff grossisse de ce qu'elle n'a pas
  demandé ; **rien quand il n'y a rien**, parce qu'un pied de réponse toujours présent est du
  mobilier ; **cinq au maximum**, parce qu'une liste de douze apartés enterre la réponse ; et
  **ordonné par ce dont ça parle** — votre code, puis cette réponse, puis cette session.

  Activé par défaut (`hiveyCode.notices.enabled`) : ça n'envoie rien et ça ne modifie rien.

### Corrigé

- ⚠️⚠️ **Le terminal fixait sa fenêtre de contexte à 8 000 jetons en dur**, et c'est la nouvelle
  section qui l'a révélé : au premier essai contre un vrai modèle elle a affiché « le contexte est à
  100 % » sur un modèle qui tient **un million** de jetons. Le journal de ce projet raconte qu'un
  chiffre fixe **était** exactement le défaut du panneau — 8 000 jetons, c'est presque toute la
  fenêtre d'un petit modèle local et une poussière sur un modèle moderne, et contre lui les
  conversations étaient résumées au bout de trois échanges. Le panneau a été corrigé ; cette moitié a
  gardé la constante. **Cinquième fois dans cette phase que la moitié terminal est la moitié
  oubliée**, après l'outil de plan, les plafonds de dépense, les compétences et les sous-agents. La
  recherche de fenêtre vit maintenant dans le cœur et les deux moitiés posent la même question.

  La leçon porte sur la section elle-même : **une notice qui se déclenche à chaque tour à cause d'une
  constante périmée est le mobilier qu'elle était censée ne pas être.**

- ⚠️ **`chat.ts` contenait une copie de l'ensemble `VERIFIERS` du routeur** — les cinq mêmes noms,
  dans deux fichiers, que rien ne tenait synchronisés. Ajouter un vérificateur au routeur aurait
  **silencieusement** cessé de le compter dans le panneau, et le routage appris aurait continué de
  mesurer l'ancien ensemble. Supprimée ; `VERIFIER_TOOLS` et `MUTATING_TOOLS` sont exportés et
  importés par les deux moitiés.

### Précisé

- **Le chantier 4.3 a été re-dérivé du code**, comme la phase l'exige désormais. Sa rédaction était
  **fausse une troisième fois** : le parallélisme des sous-agents est entièrement implémenté
  (`Promise.all` sur les appels voisins déclarés sûrs, approbations résolues avant, une par une, et
  seuls des voisins fusionnés pour préserver l'ordre), et la synthèse **est** le mécanisme — la
  conclusion revient comme résultat d'outil. Les trois vraies lacunes sont inscrites : **la délégation
  est transitive et non bornée** (une définition sans ligne `tools:` reçoit `run_agent` et peut
  déléguer récursivement, sans garde ni test nulle part), le terminal n'a aucun sous-agent, et une
  ligne de trace ne nomme jamais l'agent dispatché (`callSignature` déclare `agent`, le schéma dit
  `name`).

## 0.90.0 — 2026-10-03

### Corrigé

- **⚠️⚠️ Le client terminal refusait ce que le panneau autorisait, d'un facteur dix** — et c'est le
  défaut que ce projet avait **déjà corrigé une fois**. Le journal le raconte pour le panneau : un
  plafond quotidien de 2 $ refusait la huitième question de la journée, *silencieusement*, « donc ce
  que l'utilisateur voyait était une extension qui avait cessé de fonctionner sans raison ». Le
  panneau est passé à 20 $. **Le terminal a gardé `0.25` et `2` codés en dur dans ses propres
  valeurs par défaut.** C'est exactement ce contre quoi l'en-tête de `src/cli/env.ts` met en garde :
  *« les deux moitiés en désaccord en silence »*. Les limites livrées vivent maintenant à **un seul
  endroit** (`SHIPPED_LIMITS`), un test vérifie que `package.json` dit la même chose, et un test lit
  le source du terminal pour refuser qu'il les retape.

- **⚠️⚠️⚠️ Et dans le relevé du banc, un refus était indiscernable d'un échec.** C'est ainsi que le
  défaut a été trouvé : onze tâches ont réussi, puis **les quarante-deux suivantes ont échoué sans
  produire un seul tour**, parce que le plafond quotidien était atteint. Un taux de réussite calculé
  là-dessus aurait été publié comme une mesure — l'erreur même que toute la phase 3 existe pour
  empêcher. Le client **enregistre** désormais le refus, le rapport le compte, et **un jeu qui
  contient un seul refus n'énonce aucun taux** : la colonne affiche « *n* refused — no rate » au lieu
  d'un pourcentage. Absent plutôt que faux, comme partout ailleurs ici.

- ⚠️ **Les identifiants de préréglage du tableau étaient faux depuis une semaine** : `hivey/balanced`
  et `hivey/pro` n'existent nulle part dans le produit (ce sont `hivey` et `hivey/smart`). Un tableau
  qui nomme des configurations que personne ne peut choisir est un tableau qu'on ne peut pas
  reproduire.

  ⚠️⚠️ **CORRECTION (0.94.0) : cette entrée était fausse. Le correctif n'avait pas été appliqué.**
  L'édition censée le faire était un remplacement de chaîne qui n'a rien trouvé, et dont personne n'a
  regardé le résultat — donc le tableau a continué de nommer `hivey/balanced` et `hivey/pro` pendant
  trois versions, pendant que ce journal affirmait le contraire. Réparé en 0.94.0, avec un test qui
  compare la liste du tableau aux préréglages réels du produit.

### Ajouté

- **Chantier 4.1 — un plan inachevé est une preuve.** `verifyTurn(steps, plan)` lit maintenant le plan
  du tour, **en dernier** : un contrôle qui échoue est une preuve concrète sur le code, un plan
  inachevé est le récit que le modèle fait de lui-même, donc il ne parle que si rien de plus dur n'a
  parlé. Un tour qui se termine en laissant des étapes de son **propre** plan ouvertes s'est déclaré
  fini contre sa propre liste, et c'est la forme de preuve sur laquelle l'escalade dépense de l'argent.
  Prudence symétrique : **l'absence de plan n'est pas un échec**, et une étape `skipped` compte comme
  réglée. Voir [ADR-0028](docs/adr/0028-un-plan-inacheve-est-une-preuve.md).

- **Le client terminal a l'outil de plan.** Il ne l'avait pas, pour une raison écrite dans le code —
  *« un outil que rien n'affiche dépense des jetons pour rien »* — vraie tant que le plan n'était
  qu'un affichage, fausse dès qu'il devient une preuve. Et surtout : le banc pilote ce client, donc il
  ne pouvait **rien** mesurer du plan, ce qui rendait inapplicable la règle « on mesure avant et
  après » de toute la phase.

- **Deux chiffres de plus dans le rapport et le tableau.** **`claimed done`** : le tour est sorti
  proprement et le contrôle a échoué quand même — c'est l'écart entre « le modèle dit que c'est fini »
  et « le contrôle passe », que le chantier 4.1 promettait de mesurer, et c'est le chiffre qui décide
  si on peut laisser l'outil travailler seul. Un modèle qui échoue bruyamment coûte un tour ; un
  modèle qui échoue en annonçant une réussite coûte la confiance. Et **`planLeft`**, absent quand il
  n'y a pas eu de plan — compter 0 pour un tour qui n'a jamais planifié serait compter une discipline
  que personne n'a exercée.

- **Chantier 4.2 — les compétences intégrées deviennent atteignables par le modèle.** Les
  quatre-vingt-cinq compétences — quarante pour IBM i, huit pour la finance, chacune adossée à une
  tâche d'évaluation qui échoue avant qu'on l'applique — étaient réservées à un utilisateur **qui
  connaissait la commande à taper**. Qui ne sait pas que `/packed` existe n'en bénéficiait jamais :
  tout un axe de l'expertise du produit dépendait d'un mot magique. Elles passent désormais par le
  mécanisme qui existait déjà (`skillsPrompt` + `use_skill`) : **le nom et une ligne dans le prompt,
  les instructions seulement si le modèle les demande**. Filtrées par ce que l'utilisateur a activé —
  ce qui borne le coût et évite d'annoncer une compétence qu'il ne peut pas invoquer ; une compétence
  qui est une *action* sur la conversation (`/compact`) est exclue, faute d'instructions à lire ; et
  une compétence du dépôt qui porte le même nom gagne, parce que l'équipe qui a écrit la sienne
  voulait la sienne. Voir [ADR-0029](docs/adr/0029-les-competences-etaient-invisibles-au-modele.md).

- **Le terminal a les compétences, comme il a maintenant le plan.** Il n'en avait aucune — ni celles
  du dépôt, ni les intégrées — donc le banc, qui pilote ce client, ne pouvait pas mesurer si une
  compétence sert. Troisième fois dans cette phase que la moitié terminal était la moitié oubliée.

- **Une barre de contexte, qui dit de quoi les 84 % sont faits.** L'anneau affiche un pourcentage
  depuis longtemps, et « 84 % » répond à la mauvaise moitié de la question : celle sur laquelle on
  peut agir est **84 % de QUOI** — détacher ce fichier, réduire cette sélection, résumer la
  conversation, relever le budget. Une attribution existait déjà et ne vivait que sur la carte de
  consentement, un écran qui n'apparaît que pour un fournisseur distant, une fois par session. La
  barre est dans le menu de l'anneau — *« l'endroit où l'on regarde après avoir lu 84 % est le
  84 % »* — avec une légende, l'espace libre, et les couleurs prises **à la palette de graphiques de
  l'éditeur** et non choisies ici. Règles tenues par des tests : les tranches sous 2 % sont **fondues
  en une seule** (une barre de vingt éclats d'un tiers de pourcent est une texture, pas une
  information), l'espace libre **n'est jamais négatif** (au-delà du budget la barre le *dit*), et une
  fenêtre inconnue **n'invente aucune part** — on montre le compte seul. Et elle annonce qu'elle est
  approximative : elle mesure les **sources** et non les messages assemblés, parce qu'une ventilation
  qui devrait être exacte devrait être maintenue au pas de l'assemblage, et serait abandonnée à la
  première divergence.

- **Un audit de prompt : exactement ce qui est parti.** `Hivey Code : Auditer le dernier prompt`
  ouvre un document en lecture seule avec la **dernière requête telle qu'elle a été envoyée** —
  chaque message, son rôle, sa taille, et les outils offerts. Le registre des sorties répond à « qu'est-ce
  qui est parti dans le temps » et **ne contient aucun contenu, par conception** ; cette commande
  répond à l'autre question, celle qu'on pose une fois avant de faire confiance à l'outil, et de
  nouveau la première fois qu'une réponse est étrange. Trois règles : c'est **la forme
  pseudonymisée**, parce que c'est elle qui est partie (montrer l'original dirait que le nom du
  client est sorti alors qu'un marqueur est sorti) ; **rien n'est conservé** — en mémoire, pour la
  session, et un test lit le source pour refuser que ce module puisse écrire où que ce soit ; et
  **chaque message porte sa taille**, parce que « pourquoi cette requête fait 40 000 jetons » se
  répond par la liste et pas par le total. ⚠️ La clôture du bloc de code s'adapte à son contenu : un
  prompt qui contient trois accents graves aurait fermé le bloc au milieu de ce que l'audit était
  ouvert pour montrer.

### Précisé

- ⚠️⚠️ **Les deux premières rédactions de la phase 4 étaient fausses, et c'est un défaut de méthode.**
  4.1 affirmait que « la boucle est sans mémoire de son propre plan » : `src/core/agent/plan.ts`
  existait, avec l'analyse, la règle « une seule étape en cours », le résumé et l'affichage — et j'ai
  commencé par **écraser ce fichier** avant de m'en apercevoir. 4.2 affirmait que 85 compétences
  encombraient le prompt : elles n'y étaient pas du tout, et celles du dépôt utilisaient déjà la
  divulgation progressive, avec le raisonnement écrit dans le code.

  Les six chantiers de la phase avaient été rédigés d'affilée **depuis ce que je croyais savoir du
  produit**, pas depuis le code. Ce qui a évité le pire n'est pas de la prudence : c'est que le dépôt
  force à vérifier — la compilation a refusé un import inexistant, un test qui lit le source a refusé
  une affirmation fausse. La **rédaction** d'une feuille de route n'a pas de contrôle de ce genre.
  Conséquence inscrite : **4.3 à 4.6 sont à re-dériver du code avant d'être engagés.**

## 0.89.0 — 2026-10-03

### Corrigé

- **⚠️⚠️ « Récence » était revendiquée dans l'en-tête du fichier généré et n'existait pas.** Le terme
  valait `1.5 × (created / newest)` sur deux horodatages Unix : mesuré sur le catalogue réel, il
  **variait de 0,0885 entre GPT-3.5 (2023) et un modèle publié la veille**, quand un bonus d'éditeur
  vaut 1,2. Ce n'était pas un critère, c'était une erreur d'arrondi portant son nom. Conséquences :
  `hivey` tournait sur `claude-opus-5` (juillet, **25 $/M**) alors que `claude-opus-5.5` (septembre,
  **20 $/M**) tenait dans le même budget — plus récent **et** moins cher ; et `hivey/smart`, le
  préréglage qui existe pour être le meilleur, tournait sur `gpt-5-pro` — **octobre 2025, 120 $/M** —
  quand `gpt-6.1-sol-pro` était disponible à **10 $/M**. **Douze fois le prix pour un modèle d'un an
  plus vieux.** Voir [ADR-0027](docs/adr/0027-la-recence-etait-une-erreur-d-arrondi.md).

- **Les règles de sélection déménagent dans le cœur** (`src/core/router/curate.ts`, 14 tests) et le
  script importe le paquet construit. Elles vivaient dans un script, donc hors de portée des tests —
  et le défaut ci-dessus est exactement celui qu'un test attrape et qu'une relecture ne voit pas.

- ⚠️ **Un modèle sans prix coté n'était pas refusé** là où la règle le disait : elle lisait
  `outPrice(m) > 0` et `outPrice` rend `Infinity`, donc `Infinity > 0` laissait passer précisément ce
  que cette ligne existe pour exclure. Inoffensif **par accident** — le plafond du rôle les rejetait
  plus loin. Une règle qui tient parce qu'autre chose l'attrape cesse de tenir quand l'autre chose
  bouge.

- **Le client terminal résout un préréglage.** Envoyer `hivey` comme identifiant de modèle donnait une
  erreur 400 : les préréglages ne pouvaient donc pas être essayés depuis le terminal **ni mesurés**,
  puisque le banc pilote ce client. Un tableau qui promet une ligne par préréglage et un harnais
  incapable d'en remplir une, c'est un tableau vide pour une raison invisible.

### Ajouté

- **Un plafond de taille par requête** (`hiveyCode.budget.perRequestTokens`, 200 000 par défaut), et
  la raison est la conséquence la plus instructive de ce chantier. Les plafonds de dépense étaient
  calibrés quand le préréglage du milieu visait un modèle à 120 $/M ; en le passant aux modèles
  actuels à 10 $/M — **une amélioration de dix fois** — le même prompt emballé de 400 000 jetons est
  tombé à 80 centimes, sous un plafond de 2 $, et **passait sans question**. Un plafond en dollars se
  **desserre à chaque baisse du marché**, ce qui pour un outil dont l'argument est que votre code ne
  part pas est exactement la mauvaise direction. 400 000 jetons de votre dépôt qui partent méritent
  une question à n'importe quel prix. Une politique d'entreprise peut le resserrer, jamais le
  desserrer ; et « toujours autoriser » relève désormais le plafond **de taille** et non un plafond en
  dollars que personne n'avait interrogé.

- **Un filtre de péremption** : dans une même gamme d'un même éditeur, un modèle plus récent, pas plus
  cher, avec au moins autant de contexte et d'outils **retire** l'autre avant le classement. Un score
  est un équilibre entre choses désirables ; « ne jamais payer plus pour un modèle plus vieux de la
  même gamme » est une règle, et une règle va dans un filtre. ⚠️ **« Même gamme » a été appris à la
  dure au premier essai** : la règle était « même éditeur », et comme Anthropic publie Opus et Sonnet
  ensemble, `claude-sonnet-5.5` (plus récent, moitié prix) a déclaré le vaisseau amiral périmé par le
  milieu de gamme.

- **`HIVEY_OVERLAPS`** dans le fichier généré : les rôles où un préréglage plus cher a acheté la même
  chose qu'un moins cher. ⚠️ Une fois la récence réparée, `hivey` et `hivey/smart` ont choisi le même
  modèle pour `deep`, à **0,007 point** près. À cette distance le choix est du bruit, et ajuster les
  poids jusqu'à ce qu'ils diffèrent aurait été ajuster les règles à un catalogue d'un après-midi. La
  lecture honnête : le meilleur modèle actuel tient déjà dans le budget du moins cher, donc le plus
  cher n'a rien de mieux à acheter. Le produit le **dit** au lieu de prétendre le contraire.

### Documentation

- **`README.fr.md` est supprimé, et remplacé par un cours.** Il avait deux défauts. Il **doublait le
  travail** sans rien ajouter — deux documents à maintenir, donc un des deux toujours en retard, et
  c'était toujours le français (il a annoncé 284 tests quand il y en avait 700, et la version
  `0.11.1` quand le projet était à `0.61.0`). Et il s'adressait **au même lecteur** que l'anglais :
  quelqu'un qui code.

  À la place, **`docs/cours/`** : treize chapitres et un glossaire qui expliquent le produit **à
  quelqu'un qui ne sait pas programmer** — ce qu'est un modèle de langage, un jeton, une fenêtre de
  contexte ; où tourne le modèle et ce que « souverain » veut dire ; ce qu'est une API et comment un
  modèle demande à agir ; les trois modes et pourquoi « Plan ne modifie rien » est une propriété du
  code et non une consigne ; ce que **RAG** veut dire et pourquoi il n'y a **pas** d'index vectoriel
  ici ; ce qu'est **MCP**, comment on en branche un et ce qu'est l'empoisonnement d'outils ; la
  chaîne de confidentialité étape par étape, hachage et signature expliqués ; le coût et l'escalade ;
  IBM i et pourquoi une colonne change le sens d'une ligne ; comment on mesure la qualité ; et une
  installation pas-à-pas sans terminal. Chaque chapitre finit par ce que le projet a **choisi** et
  pourquoi, parce que la plupart de ces choix sont des arbitrages.

- **Et il est tenu par un contrôle, parce qu'une promesse n'est pas un mécanisme.** L'index déclare la
  version pour laquelle il est à jour, et `npm run check:course` **refuse la construction** quand ce
  n'est plus celle du projet. ⚠️ **Délibérément non réparable automatiquement** : réécrire le numéro
  est exactement ce qui ne doit pas être automatique, puisque le travail est de lire ce qui a changé
  et de décider ce que le cours doit dire. Le contrôle attrape aussi un chapitre que l'index ne cite
  pas, et un lien de l'index vers un chapitre qui n'existe pas — les deux faces d'une édition laissée
  à moitié.

- La méthode (`docs/PROMPT-ROADMAP.md`) demande désormais de mettre à jour le chapitre concerné quand
  un réglage change ce que l'utilisateur peut comprendre du produit.

### Précisé

- Le prix est lu vers le haut **proportionnellement au budget du préréglage** : un budget n'est pas
  une limite qu'on évite, c'est ce à quoi sert le préréglage.
- Le workflow quotidien du catalogue fait désormais `npm ci` et `npm run build`, puisque les règles
  qu'il applique sont dans le cœur et testées.

## 0.88.0 — 2026-10-03

### Corrigé

- **Le filet des appels d'outils en texte s'applique aux deux formats de fil, pas seulement à celui
  où le défaut a été trouvé.** Le bug a été vu sur Ollama, qui parle la forme OpenAI. Une
  **passerelle au format Anthropic** devant un modèle local — un déploiement d'entreprise ordinaire
  (LiteLLM, un proxy maison, un relais Bedrock) — aurait échoué à l'identique : `api.anthropic.com`
  rend toujours ses `tool_use` nativement, ce qui se trouve devant une passerelle, non. Corriger un
  seul client voulait dire que le défaut était réparé **selon le proxy que l'exploitant fait tourner**.

  Un test lit maintenant les deux sources et exige qu'elles s'accordent : le filet présent dans les
  deux, et dans les deux **gardé par « le protocole n'a rien rendu »**, pour qu'il remplace un appel
  manquant au lieu de concurrencer un appel natif.

## 0.87.0 — 2026-10-03

### Corrigé

- **⚠️⚠️ LE MODE AGENT NE FAISAIT RIEN SUR UN MODÈLE LOCAL.** Trouvé en lançant la première vraie
  mesure, et c'est exactement ce qu'une mesure sert à trouver.

  Ollama ne rend **pas** les appels d'outils de `qwen2.5-coder:7b` par le protocole — ni par sa couche
  compatible OpenAI, ni par son endpoint natif. Il les écrit **en texte, dans `content`**, avec
  `tool_calls: null` et `finish_reason: "stop"`. Le client voyait donc un message ordinaire sans appel
  d'outil, imprimait le JSON comme s'il s'agissait d'une réponse, et ne modifiait aucun fichier
  (`steps: 0`, `tools: {}`). Ce n'est pas une configuration exotique : c'est **la configuration par
  défaut**, le modèle que ce README nomme sur le runtime que ce même README dit d'installer.

  Un appel d'outil écrit dans le message est désormais reconnu, avec trois bornes : **seulement si le
  protocole n'a rien rendu**, **seulement si l'appel est délimité et en fin de message** — « voici le
  JSON que tu enverrais, ça supprimerait tout » reste une phrase — et **seulement pour un outil
  réellement offert**. Voir [ADR-0026](docs/adr/0026-un-appel-d-outil-ecrit-dans-le-message.md).

  ⚠️ **La règle a été assouplie une fois, après mesure** : la première version exigeait que le message
  ne contienne *rien d'autre* que l'appel, et ces modèles **narrent avant d'agir** (« Avant de faire
  quoi que ce soit, je vais vérifier que `count.js` existe… »), donc l'agent restait inopérant. Ce qui
  est gardé est la frontière qui porte la garantie : **rien ne doit suivre l'appel**.

  ⚠️ **Ce que ça coûte est dit, pas masqué.** Lire un appel dans la prose **réunit deux canaux que le
  protocole tient séparés** : avec un appel natif, un modèle qui *parle* d'une action ne peut pas en
  *faire* une. La compensation n'est pas de l'astuce, c'est de le dire — l'appel porte
  `source: "text"` et **la carte d'approbation l'affiche** (« lu dans le message du modèle, pas dans
  un appel d'outil »). L'action est contrôlée exactement comme un appel natif. Inscrit comme résidu
  dans `docs/THREAT-MODEL.md`.

### Ajouté

- **`eval/QUALITY.md` porte enfin un chiffre mesuré — et il est mauvais.** `local only`
  (`qwen2.5-coder:7b` sur Ollama, 12 cœurs, sans GPU) obtient **0 sur 56**, en 33 minutes. Le chiffre
  qui l'explique est à côté : **51 des 56 tâches sans une seule étape d'outil**. Et dans les 5 où le
  modèle a agi, il n'a **jamais** appelé d'outil d'édition — `run_command` quatre fois, `list_files`
  une fois, une étape chacune. Ce n'est donc pas une mesure du raisonnement du modèle mais de sa
  **disposition à agir**, sur ce runtime, à travers ce client.

  Le chiffre est publié plutôt qu'enterré : c'est l'état honnête de la chose, et il dit quoi corriger
  ensuite. `local + escalation` et les préréglages restent à **not measured** — aucun n'a été exécuté,
  et aucun n'est deviné.

- **Une colonne *never acted*** dans le tableau. Un score seul ne dit pas si un modèle s'est trompé ou
  s'il n'a jamais essayé, et ce sont deux problèmes différents : l'un se règle avec un meilleur
  modèle, l'autre avec le client et le prompt. Comptée sur les **tâches** et avant la sortie
  anticipée, parce qu'une tâche dont le client n'a rien rapporté n'a pas pris d'étape non plus.

- **`--as <configuration>`**, parce que le harnais reçoit un *modèle* et que seule la personne qui
  l'exécute sait de quelle configuration ce modèle tenait la place. Nommé plutôt que déduit.
- **`--from <results.json>`**, pour régénérer le tableau depuis un run déjà fait : une mesure prend
  une demi-heure, la relabelliser ne doit pas la refaire payer.
- Le tableau mesuré explique maintenant **comment le lire** (ce que valent *never acted* et *not
  priced*) et **comment le reproduire**, avec l'endpoint et le modèle réellement employés.

### Précisé

- **Les résultats sont écrits après chaque tâche**, plus seulement à la fin. Un modèle local sur
  processeur prend une à deux minutes par tâche ; un run qui n'écrit qu'en terminant perd tout à la
  première interruption, et ce qui est sur le disque est désormais toujours ce qui a été mesuré.
- Les deux README annonçaient « aucun chiffre mesuré » : ils portent le résultat, la cause, et ce qui
  reste non mesuré.

## 0.86.0 — 2026-10-03

### Ajouté

- **Prêt pour la soumission : le contrôle de pré-publication lit le `.vsix`, pas l'intention.**
  `npm run check:publish` ouvre l'archive qui serait téléversée — avec le lecteur ZIP que l'extension
  possède déjà pour lire un `.docx` — et vérifie ce pour quoi une soumission est refusée : les champs
  du manifeste, l'icône contre le 128×128 imposé, le journal des modifications qui doit avoir un titre
  pour la version expédiée, l'absence de carte de source et de code source, et **tout lien relatif de
  tout document Markdown qui part**, de façon **sensible à la casse**. Il tourne dans la CI juste après
  l'empaquetage. Voir [ADR-0025](docs/adr/0025-controler-le-paquet-et-non-l-intention.md).

  ⚠️⚠️ **Huit liens cassés trouvés à la première exécution, dont deux déjà publiés.** `vsce` réécrit
  les liens relatifs du readme qu'il publie **et de celui-là seulement** : `README.fr.md` est un
  fichier ordinaire du paquet, ses liens ne sont pas touchés, et `docs/images/` est exclu du paquet —
  donc un lecteur francophone de l'extension installée voyait **cinq images cassées**, dans le
  document censé être la page d'accueil du produit dans sa langue. Il renvoyait en plus à `README.md`
  alors que `vsce` publie le readme en `readme.md` : ça résout sur macOS et renvoie 404 sur Linux.
  Aucun des deux n'est un plantage, et aucun n'aurait pu être trouvé par un test du comportement de
  l'extension — ce sont des propriétés du **paquet**.

  ⚠️ **Et un lien mort dans le dépôt lui-même** : l'ADR-0010 renvoyait à un « ADR-0011 » qui n'a
  jamais été écrit (le numéro 0011 est allé au hachage du registre).

### Corrigé

- ⚠️ **Un défaut dans ma propre règle, trouvé par son test** : la vérification de l'icône exigeait
  plus de 24 octets alors que 24 suffisent exactement à lire la largeur et la hauteur — un PNG
  tout juste assez long était déclaré « pas un PNG ».
- `README.fr.md` n'offrait que la compilation depuis les sources, avec un `cd hivey-code` erroné
  (le dépôt est `hivey-vscode`). Elle est passée à parité : téléchargement, vérification par
  signature et empreinte, et compilation.

### Précisé

- **La route d'installation sans terminal**, qui manquait dans les deux langues : *Extensions → menu
  `…` → Installer à partir d'un VSIX…*. La moitié des gens n'ont pas `code` dans leur PATH, et un
  `.vsix` n'est pas un fichier qu'on double-clique.
- **`docs/PUBLISHING.md` nomme les quatre choses que seul le mainteneur peut faire** : créer
  l'éditeur Marketplace, créer le jeton d'accès (étendu à *toutes* les organisations accessibles —
  un jeton limité à une seule échoue avec un message qui ne le dit pas), ouvrir un compte **Open VSX**
  (VSCodium, Cursor, Gitpod — une boutique qui a choisi VSCodium l'a souvent fait pour les raisons qui
  lui feraient choisir cette extension), et vérifier le domaine. Aucune ne peut être faite depuis la
  CI, et aucune ne devrait l'être.
- Les chiffres de `docs/PUBLISHING.md` entrent dans `check:numbers` : il annonçait **193** tests et
  **27** d'intégration alors que les suites étaient à 1067 et 43. Un chiffre dans un bloc de code est
  aussi périssable qu'un chiffre dans une phrase, et celui-là est lu par quelqu'un qui est sur le
  point de publier.
- Le lecteur ZIP sait maintenant **lister** les entrées d'une archive en plus d'en lire une. La boucle
  sur le répertoire central est factorisée : deux copies de cette arithmétique à longueur variable
  feraient deux endroits où se tromper, dont un seul serait testé.

## 0.85.0 — 2026-10-03

### Ajouté

- **Chantier 3.5 — le tableau de qualité publié, et ce qu'il refuse de contenir.**
  `node scripts/evaluate.mjs --table eval/QUALITY.md` produit le tableau comparatif que la feuille de
  route demandait : chaque configuration qu'on peut réellement choisir — le modèle local seul, le
  local avec escalade, chaque préréglage — avec la qualité et le coût par tâche, dans un fichier
  versionné qu'on peut donc **comparer d'une exécution à l'autre**.

  ⚠️⚠️ **Tous les chiffres du fichier livré disent « not measured », et c'est la décision.** Aucun
  modèle n'est joignable depuis cette machine : chaque cellule aurait donc été inventée, et un banc
  d'essai inventé est le seul artefact de ce projet qui vaudrait **moins que rien**, parce que c'est
  celui qu'on cite. Ce qui **est** prouvé, à chaque commit, c'est la moitié difficile : le contrôle de
  chacune des 56 tâches **échoue sur sa fixture intacte** et **passe sur sa solution de référence**.
  Ce qui manque est une machine avec un modèle dessus, et le fichier donne la commande.

  ⚠️ **Aucune colonne Copilot, aucune colonne IBM Bob.** Non par pudeur — c'est la comparaison que ce
  produit existe pour gagner — mais parce que personne ici ne les a exécutés sur ces tâches. Une
  colonne remplie depuis un chiffre publié compare deux mesures différentes, sur deux jeux de tâches,
  sur deux machines, à deux dates ; elle ne survivrait pas à la première question de la réunion où on
  la citerait. Le fichier écrit à la place **ce qu'il faudrait** pour en ajouter une honnêtement.

  Voir [ADR-0024](docs/adr/0024-un-tableau-qui-dit-ce-qu-il-n-a-pas-mesure.md).

### Précisé

- ⚠️ **Une ligne du tableau appartient à exactement une configuration.** Le harnais reçoit un
  *modèle*, pas une configuration, et le même modèle exécuté seul puis autorisé à escalader produit
  des résultats que rien ne distingue sinon un champ. Les additionner donnerait une qualité que
  personne ne peut reproduire — celle d'aucun des deux montages. `rowsFromOutcomes` sépare sur ce
  champ, et un test le prouve en retirant la séparation.
- ⚠️ **Le test a d'abord échoué sur ma propre prose** : il refusait `0 %` dans tout le document, or le
  document explique justement qu'une configuration non mesurée ne doit jamais s'afficher `0 %`. C'est
  la cinquième fois dans ce dépôt qu'un grep structurel rejette un fichier pour s'être expliqué ; le
  contrôle porte désormais sur les **lignes du tableau**.
- Le nombre de tâches annoncé par le tableau est tenu par `check:numbers` **et** par un test : un
  tableau qui dit 51 après qu'on en a ajouté cinq est faux de la façon la plus discrète qui soit —
  rien ne casse, le chiffre a simplement cessé d'être vrai.

### Documentation

- **Les deux README rattrapent les phases 1 à 3.** Ils décrivaient la version 0.67 : ni la boucle de
  compilation IBM i, ni les tests RPG, ni `ibmi_impact`, ni les quarante compétences, ni la politique
  signée, ni l'expédition du registre vers un SIEM, ni la preuve de souveraineté, ni les hooks, ni la
  tâche de fond isolée, ni la revue de branche, ni les outils de serveur de langage, ni le second
  lecteur, ni le routage qui apprend, ni le corpus local, ni la famille `finance` n'y figuraient. Le
  `.vsix` embarquait donc quinze chantiers que sa page d'accueil ne mentionnait pas.
- Les deux renvoient à `eval/QUALITY.md` **en disant que les chiffres n'y sont pas mesurés**. Le
  document perd en force de vente ce qu'il gagne en défendabilité, et c'est l'arbitrage voulu : le
  lecteur à convaincre reconnaît un chiffre non sourcé.

## 0.84.0 — 2026-10-03

### Ajouté

- **Chantier 3.4 — une famille de compétences `finance`.** Huit compétences, activables comme les
  autres par `skills.groups` : **`/rounding`** (demi-loin-de-zéro contre demi-au-pair, et le cas
  négatif que `Math.round`, le `round` de Python et `BigDecimal.ROUND_HALF_UP` tranchent
  différemment), **`/decimal`** (de l'argent sans flottant, y compris aux frontières — un nombre JSON
  est un double), **`/packed`** (décimal packé et zoné, intermédiaires dimensionnés pour qu'un produit
  ne déborde pas en silence), **`/settlement`** (T+1, T+2, et les jours fériés en **paramètre** —
  jamais un calendrier dans le code), **`/markethours`** (le fuseau de la place et sa séance en heure
  locale : une fenêtre écrite en UTC est juste la moitié de l'année), **`/identifiers`** (ISIN par
  Luhn, LEI par ISO 17442 / ISO 7064 MOD 97-10, BIC par sa forme), **`/fixmsg`** (BodyLength et
  CheckSum, et une somme de contrôle à deux chiffres est juste 99 fois sur 100, ce qui est pire que
  d'avoir toujours tort) et **`/amortise`** (des échéanciers dont les parts font le tout).

- **Cinq tâches d'évaluation de plus**, qui portent cette famille : identifiants ISIN/LEI/BIC
  (Python), dates de règlement avec jours fériés fournis (JavaScript), heures de marché à travers un
  changement d'heure (Python, `zoneinfo`), message FIX avec sa longueur et sa somme de contrôle
  (JavaScript) et décimal packé/zoné avec débordement et MONITOR (RPG). Le banc passe à **56 tâches**,
  56/56 honnêtes dans les deux sens.

### Précisé

- **Chaque compétence `finance` déclare la tâche qui l'éprouve**, et le test qui l'exigeait pour les
  familles IBM i l'exige maintenant pour celle-ci — avec une différence assumée : **aucune lacune n'y
  est admise**. Une partition IBM i est une excuse ; de l'arithmétique décimale n'en est pas une.
- Un test vérifie aussi que les tâches derrière cette famille **couvrent au moins trois langages**,
  parce que la feuille de route demandait JavaScript, Python, Java et RPG là où c'est pertinent.
- ⚠️ `/fix` existait déjà dans la famille générale : la compétence FIX s'appelle **`/fixmsg`**. Trouvé
  par le test qui exige que les noms soient uniques — ce que l'utilisateur tape ne peut pas désigner
  deux choses.

## 0.83.0 — 2026-10-03

### Ajouté

- **Chantier 3.3 — un second modèle relit le diff avant les dangereux.** La carte d'approbation
  montre déjà le diff, et le résidu écrit dans le modèle de menace est que **celui qui approuve sans
  lire approuve quand même**. Or les changements où cela coûte le plus sont les **petits** : une ligne
  ajoutée à une liste de globs interdits, un réglage qui désactive un contrôle, une permission élargie
  d'un mot. Trois lignes, qui ressemblent à ce qui était demandé, et qui retirent une garantie.

  Un second modèle lit donc la demande et le diff, et répond à **une seule question** : est-ce que ce
  diff fait quelque chose que la demande n'a pas demandé ? Pas « revois ce code » — c'est le travail
  du premier modèle, qui a plus de contexte. Ses objections apparaissent sur la carte, avec le nom du
  modèle qui les a faites.

  Trois déclencheurs : un **réglage gardé** (la liste est celle des choses que ce produit traite comme
  des garanties ailleurs), un **fichier qui configure le comportement de tout le reste**, ou un diff
  **trop gros pour avoir été lu**.

  ⚠️ **Local uniquement, pris au mot** : si le second lecteur serait un modèle facturé, il n'est pas
  appelé et la carte le dit. Un second avis qui doublerait discrètement le prix de l'édition d'un
  fichier de réglages est une fonctionnalité qu'on désactive, et un qui le facturerait sans le dire
  serait pire.

  ⚠️ **Consultatif par défaut** : les objections vont sur la carte et l'humain décide. Elles ne
  bloquent que si la politique de l'organisation l'exige — ce qui est une restriction, donc dans ce
  qu'une politique peut faire. Un second modèle qui pourrait mettre son veto serait un modèle dont
  les propres erreurs arrêtent le travail, et rien ici n'a mesuré sa fréquence d'erreur.

### Précisé

- **Une réponse illisible est signalée comme illisible, jamais comme « aucune objection »** : tout
  l'intérêt est de mettre quelque chose sur la carte, et un échec d'analyse rendant une liste vide y
  mettrait un rien rassurant. Un second lecteur injoignable est dit aussi — « personne n'a vérifié
  ceci à part vous ».
- Un tableau vide **est** la réponse attendue la plupart du temps, et le prompt le dit : « le dire est
  plus utile que de trouver quelque chose à dire ».
- La politique n'a **aucune valeur qui désactive** le second lecteur : une politique peut durcir un
  contrôle, pas le retirer.

## 0.82.0 — 2026-10-03

### Ajouté

- **Chantier 3.2 — le routage apprend, par dépôt.** L'extension mesure, par dépôt, par genre de tâche
  et par modèle, le taux de réussite constaté par `verifyTurn()`, et choisit **le modèle le moins cher
  dont le taux observé dépasse un seuil**. Le modèle cher est toujours le choix sûr et toujours le
  mauvais défaut ; ceci est ce qui rend le modèle économique défendable. Le panneau dit pourquoi :
  « Choisi qwen2.5-coder:7b : 9 sur 10 dans ce dépôt ».

  Trois limites, chacune avec son test : **jamais hors de ce que l'utilisateur a autorisé** (les
  candidats sont exactement son modèle de conversation et son modèle d'escalade — un taux observé ne
  justifie pas d'envoyer une question à un modèle que personne n'a autorisé) ; **jamais de confiance
  trop tôt** (une réussite n'est pas un taux, et « pas d'historique » n'est pas « mauvais ») ; et
  **une mesure n'existe que si quelque chose a vérifié** — sans quoi un modèle finit avec un
  historique parfait après vingt questions que personne n'a vérifiées.

  Deux commandes : ce qui a été appris ici, et l'oublier. Des données locales dont personne ne peut
  voir le contenu ni se débarrasser ne sont pas des données locales, c'est un cache.
  Voir [ADR-0023](docs/adr/0023-choisir-le-modele-d-apres-ce-qui-a-marche-ici.md).

### Précisé

- ⚠️ **Désactivé par défaut**, et ce n'est pas ce que la feuille de route demandait : un routeur qui
  apprend **change quel modèle répond**, et ce n'est pas un changement à imposer le matin où quelqu'un
  met l'extension à jour. Celui qui l'active a décidé que « moins cher quand c'est prouvé » est ce
  qu'il veut.
- Le seuil est **haut** (80 %) parce que se tromper coûte un tour perdu **et** une escalade payante.
- **L'exploration ne remesure jamais** un modèle qui a déjà un historique, et son tirage est injecté :
  une fonctionnalité dont le comportement dépend d'un tirage non testable est une fonctionnalité que
  personne ne peut raisonner le jour où elle surprend.
- Une **escalade n'est jamais réroutée** par ce qui a été appris : l'avis du routeur sur le modèle qui
  vient d'échouer est l'avis qui vient de perdre.
- Le genre de tâche vient de **ce que le tour a fait**, pas de la formulation de la question.
- Les mesures vivent dans l'état de l'espace de travail, donc par dépôt : deux copies du même projet
  sont deux jeux de mesures, et c'est correct.

## 0.81.0 — 2026-10-03

### Ajouté

- **Chantier 3.1 — ce que cette machine a appris reste sur cette machine.** Quand un modèle local
  échoue et qu'un modèle distant réussit **avec une vérification au vert**, l'extension conserve
  localement la demande, les fichiers touchés **tels qu'ils étaient**, le diff et l'erreur de la
  tentative locale, le diff final et la commande qui a tranché. C'est l'exemple d'apprentissage le
  plus utile qu'une équipe puisse avoir — et exactement ce qu'un service hébergé ne peut pas recueillir
  sans prendre le code.

  Deux exports : des **tâches au format `eval/tasks`** dont la fixture est l'état **avant** (ce qui est
  ce qui fait échouer leur contrôle), et un **jeu de conversations JSONL** pour affiner un modèle
  local. Trois commandes, un geste chacune : ce que le corpus contient, l'exporter, le supprimer.

  ⚠️⚠️ **Désactivé par défaut**, et la raison n'est pas la timidité : un épisode contient du code
  source, sur le disque, **hors du dépôt**. C'est raisonnable à conserver et déraisonnable à
  *commencer* à conserver sans qu'on le demande. **Rien ne sort** — aucune requête réseau n'existe
  dans ce code, et un test lit le source pour la refuser.

  ⚠️ **Seules les escalades qui ont réussi.** Un épisode dont le diff final ne marche pas n'est pas un
  exemple, c'est **deux mauvaises réponses**. Et dans le jeu de conversations, la tentative échouée est
  du **contexte** et non un tour d'assistant : s'entraîner sur une mauvaise réponse étiquetée comme la
  bonne est la façon dont un modèle apprend la mauvaise chose.

  Voir [ADR-0022](docs/adr/0022-ce-que-cette-machine-a-appris-reste-sur-cette-machine.md), et le flux
  documenté dans `docs/PRIVACY.md` et `docs/THREAT-MODEL.md`.

### Précisé

- **La liste des globs interdits s'applique**, et un épisode dont **tous** les fichiers étaient bloqués
  est **jeté** plutôt que conservé amputé : une fixture sans fichier est une fixture que personne ne
  peut exécuter. Le nombre de fichiers omis est conservé, pour qu'un épisode maigre soit explicable.
- **Aucune solution de référence n'est écrite depuis le diff final** : un correctif appliqué à la main
  dans un répertoire de fixture peut ne pas s'appliquer, et une tâche dont la solution ne s'applique
  pas est pire qu'une tâche sans solution — `eval:solutions` rapporterait le *contrôle* comme
  insatisfaisable.
- La **rétention** et le **plafond** répondent à deux questions : l'une est une promesse à la personne
  dont c'est le code, l'autre à son disque. `0` n'en garde plus aucun sans détruire l'existant.
- La politique de l'organisation peut **désactiver** la fonctionnalité ; elle ne peut pas l'activer,
  parce qu'une politique qui pourrait accorder serait un fichier qui vaut la peine d'être falsifié.

## 0.80.0 — 2026-10-03

### Ajouté

- **Chantier 2.6 — la revue de branche.** `Hivey Code : Revoir cette branche` détecte le point de
  départ, lit `git diff <base>...HEAD` et rend des **constats structurés** — fichier, ligne, gravité,
  catégorie, et le correctif proposé — qui atterrissent dans le **panneau Problèmes** comme
  diagnostics. Ce n'est pas un choix de présentation : c'est ce qui donne la navigation, le
  regroupement par fichier, le compteur dans la barre d'état, et un endroit où les constats
  **restent**. Une revue imprimée dans une conversation est une revue qui défile.

  ⚠️ **Trois points d'exigence.** Le diff est en **trois points** (`base...HEAD`), sinon les commits
  de quelqu'un d'autre sur la base apparaissent comme le travail de cette branche. La base est
  **demandée à git** (`merge-base` sur plusieurs candidats), parce qu'un dépôt dont la branche par
  défaut est `master`, `develop` ou `trunk` est ordinaire et qu'une comparaison contre une branche
  inexistante rapporterait tout le dépôt comme nouveau. Et **une réponse illisible n'est jamais une
  revue vide** — un tableau de constats vide sans explication se lit comme « rien à signaler », ce
  qui est la seule conclusion qu'un échec d'analyse ne doit pas produire.

  ⚠️ **La publication en commentaires de pull request n'est pas là et n'y sera pas.** Cela voudrait
  dire que cette extension détient un identifiant de forge et écrit au nom de quelqu'un sur un
  serveur — la seule catégorie d'action extérieure que ce produit ne prend pas. Qui le veut configure
  un serveur MCP pour sa forge et l'approuve par son nom ; la porte existe et elle est à lui.

- **Chantier 2.7 — ce que le serveur de langage sait déjà.** Trois outils en lecture :
  `find_references`, `call_hierarchy` et `workspace_symbols`, via
  `vscode.executeReferenceProvider`, `vscode.prepareCallHierarchy` et
  `vscode.executeWorkspaceSymbolProvider`. Ils rejoignent la liste blanche du **mode Plan** — « qui
  appelle ceci » décide s'il faut changer une signature, et décider est ce à quoi le mode Plan sert.

  ⚠️ **Un serveur qui n'a pas répondu n'est jamais rendu par une réponse vide.** « Aucune référence »
  d'un serveur qui indexe encore n'est pas « aucune référence », et confondre les deux est la façon
  dont un agent conclut qu'un symbole est inutilisé et le supprime. Les trois outils le disent, dans
  les mots de leur propre question, et le signalent comme une erreur.

### Corrigé

- ⚠️ **Un tableau de constats vide était traité comme un échec d'analyse** : « j'ai trouvé zéro
  problème » est une réponse légitime, et la confondre avec « je n'ai pas su lire » aurait transformé
  chaque revue propre en avertissement. Trouvé par le test qui l'affirmait.

### Précisé

- La compétence `/review` est désormais consciente de la branche : si rien n'est joint, elle revoit
  ce que **cette branche** change plutôt que de lire tout le dépôt — et elle dit ce qu'elle n'a pas
  revu. Le comportement sur un fichier joint ne change pas.
- La revue passe par la vue de conversation et non par son propre chemin de requête : sinon il y
  aurait un **second endroit** par lequel une requête peut quitter la machine, et ce produit en a un.
  Un test lit le module de revue et refuse tout accès réseau direct.
- Un diff coupé est **annoncé au modèle**, pour que son silence sur la suite ne se lise pas comme une
  revue propre.
- Les outils de symboles **disent à quelle position ils ont posé la question** : les fournisseurs
  prennent une position et un modèle a un nom, donc le nom est localisé d'abord — juste presque
  toujours, et faux pour un nom employé avant sa déclaration. Le dire rend l'erreur visible.

## 0.79.0 — 2026-10-03

### Ajouté

- **Chantier 2.5 — une tâche en arrière-plan, isolée.** « Lancer une tâche en arrière-plan » crée un
  **worktree git sur une nouvelle branche** et y exécute la boucle d'agent. Plusieurs tâches peuvent
  tourner en parallèle — chacune a son worktree, donc elles ne voient ni le travail des autres ni
  celui de la personne qui les a lancées. À la fin : la branche, un résumé, le diff ouvert dans
  l'éditeur, et **le verdict de `verifyTurn()`** — parce qu'un agent qui a écrit un fichier, lancé les
  tests, vu l'échec et s'est arrêté a « terminé » sans avoir réussi, et que l'auteur doit le savoir
  avant de lire le diff.

  ⚠️⚠️ **C'est la fonctionnalité au pire mode de défaillance du produit**, et la règle n'est donc pas
  « demander moins puisque personne ne regarde » mais l'inverse : **sans moteur de conteneur,
  `run_command` est REFUSÉ** et non exécuté sur l'hôte. Avec un moteur : **aucun réseau**
  (`--network none`), **seul le worktree monté**, quotas de processeur et de mémoire,
  `no-new-privileges`. Un test le vérifie **contre un vrai conteneur** — pas d'interface réseau, pas
  de résolution de noms, un chemin hors du worktree illisible — et **échoue** si aucun moteur n'est
  joignable.

  ⚠️ **L'image n'est jamais devinée** : la première commande d'une tâche a autant de chances d'être
  `make` que `npm test`, et se tromper produit un « command not found » qui se lit comme une
  fonctionnalité cassée. Sans `background.image`, les commandes sont refusées.

  ⚠️ **L'agent ne pousse jamais** : il n'y a aucun outil git du tout, la branche reste locale, et un
  test lit les modules pour vérifier qu'aucune invocation n'est un `push`.

### Précisé

- **Les outils de fichier d'une tâche de fond sont un jeu à part**, enraciné dans le worktree et dont
  chaque chemin passe par la règle d'appartenance (`underRoot`). Réutiliser ceux de l'éditeur aurait
  permis à l'agent de modifier le fichier que son auteur a ouvert, au milieu de sa propre édition.
  Le jeu est délibérément petit : pas de diagnostics (il n'y a pas d'éditeur), pas d'outil de plan
  (personne ne le regarde se construire), aucun outil IBM i (une partition est partagée, et un agent
  de fond qui en atteint une est l'inverse d'isolé).
- **La commande est un seul argument** passé à `sh -c` dans le conteneur : construire la ligne comme
  une chaîne et laisser un shell la découper est la façon dont un `; --privileged` dans une commande
  devient un conteneur privilégié. Un test l'exige.
- **L'absence de moteur est dite avant que la tâche démarre**, pas quand la première commande est
  refusée : quelqu'un qui l'apprend vingt minutes plus tard a perdu vingt minutes.
- Le worktree est créé sur une **branche nommée** depuis `HEAD` — pas détaché (du travail qu'il faut
  secourir) et pas depuis un distant (chercher est une opération réseau qu'une tâche de fond n'a pas
  à faire). Le répertoire est **laissé en place** à la fin : le supprimer emporterait le diff.

## 0.78.0 — 2026-10-03

### Ajouté

- **Chantier 2.4 — des hooks avant et après un outil.** Déclarés dans `.hiveycode/hooks.json`
  (versionné, donc partagé par l'équipe) ou dans les réglages, filtrés par outil et par glob de
  chemin. **Avant** un outil, un code de retour non nul **refuse l'appel** ; **après**, il est
  signalé au modèle et **compte pour `verifyTurn()`** — au même titre qu'un test en échec, parce que
  c'est ce que c'est : le contrôle de l'équipe disant que la modification n'est pas acceptable.

  ⚠️⚠️ **Un hook venu du dépôt est une exécution de code**, donc il reçoit exactement le traitement
  d'un serveur MCP en stdio : la question nomme **chaque commande**, et l'approbation est **épinglée
  à une empreinte** de ce qui s'exécute. Une commande qui change redemande ; un hook renommé ne
  redemande pas, parce que poser la question sur une étiquette est la façon d'apprendre aux gens à
  cliquer oui. Un refus est **retenu** : être interrogé à chaque appel d'outil est la façon dont un
  non devient un oui.

  Un hook écrit dans les **réglages** n'est pas soumis à cette question — l'utilisateur l'a écrit
  lui-même, sur sa propre machine, et c'est toute la différence avec un fichier arrivé par un
  `git clone`.

### Précisé

- **Tous les outils sont enveloppés d'un coup**, plutôt que chaque outil appelant les hooks :
  un outil qui devait y penser l'oublierait, et celui qu'il oublierait est celui pour lequel
  quelqu'un a écrit le hook.
- **Un hook qui n'a pas fini n'a pas dit non.** Un `before` dont le verdict est inconnu ne laisse pas
  passer l'appel ; refuser sur un délai dépassé ferait d'un linter lent un agent cassé, donc le cas
  est **rapporté** plutôt que traité comme un refus.
- **Un `after` ne peut pas refuser** : l'appel a déjà eu lieu, et prétendre le contraire serait
  mentir au modèle sur l'état du disque. Son verdict est **ajouté** au résultat de l'outil, pas
  substitué : le modèle a besoin de ce qu'il a fait **et** de ce que le contrôle en dit.
- **La sortie du hook est transmise**, tronquée : la plainte d'un linter EST l'instruction, et « le
  hook a échoué » sans rien d'autre est une impasse à laquelle le modèle répond en devinant.
- Un hook qui ne peut pas être lancé est un hook qui a échoué, avec la raison. Un hook déclaré sans
  `command`, sans `when` ou sans `tool` est **signalé par son rang** dans le fichier, jamais ignoré
  en silence.
- Un hook filtré par chemin **ne se déclenche pas** sur un appel sans chemin : « après `write_file`
  sur `src/**` » parle d'un fichier, et le lancer quand l'agent a lancé une commande serait le lancer
  sur le mauvais événement.

## 0.77.0 — 2026-10-03

### Ajouté

- **Chantier 2.3 — une preuve de souveraineté, et le résidu n°9 du modèle de menace est fermé.**
  `Hivey Code : Produire une preuve de souveraineté` écrit un dossier qu'on remet à un auditeur :
  nombre de requêtes, destinations avec le volume sorti vers chacune, catégories anonymisées,
  images envoyées, et **le verdict de la chaîne** en haut du document.

  **L'horodatage porte sur la TÊTE de la chaîne**, auprès d'une autorité RFC 3161 que
  l'organisation configure — **une seule empreinte sort**. C'est ce qui ferme le résidu n°9 : une
  chaîne locale rendait visible la modification d'une ligne, et rien ne la liait à une racine de
  confiance extérieure, donc réécrire tout le registre depuis le début était indétectable.
  Réécrire produit une tête différente, qu'aucune autorité n'a jamais vue.

  ⚠️⚠️ **Le rapport dit ce qu'il ne prouve pas**, et c'est la décision centrale : un document qui
  ressemble à une preuve sans en être une est pire que pas de document, parce que c'est celui qui
  sera cité. Les limites sont **dans le rapport** et un test les exige — il est signé par *cette*
  machine (donc la signature établit qu'il n'a pas changé depuis l'émission, pas que le registre
  était vrai), le volume est compté en **jetons** parce que c'est ce que le registre enregistre, et
  rien ici ne voit la requête d'un autre outil.

  ⚠️ **L'extension n'affirme pas vérifier ce qu'elle ne vérifie pas** : elle obtient et conserve le
  jeton verbatim, elle ne valide pas la signature de l'autorité. Le faire demanderait une
  implémentation CMS complète et le magasin de confiance de l'organisation ; le dossier livré
  contient la commande `openssl ts -verify` à exécuter par celui qui audite, avec *sa* racine.
  Voir [ADR-0021](docs/adr/0021-une-preuve-qui-dit-ce-qu-elle-ne-prouve-pas.md).

### Précisé

- Le DER de la requête d'horodatage est écrit à la main et **vérifié contre une implémentation que
  personne ici n'a écrite** : le test la fait relire par `openssl ts -query` et `openssl asn1parse`,
  et **échoue** si `openssl` manque. Deux pièges attrapés par là : une longueur DER doit être la plus
  courte représentation, et un INTEGER est **signé** — donc un nonce aléatoire sur deux a besoin d'un
  zéro de tête, sans quoi l'autorité lit un nombre négatif.
- La chaîne est vérifiée sur **tout le registre** et non sur la fenêtre demandée : un rapport qui
  vérifierait les liens d'une semaine manquerait une modification faite la semaine précédente, qui
  est la semaine où quelqu'un modifierait.
- **La troncature est tolérée, la lacune de numérotation ne l'est pas.** Supprimer une ligne du
  milieu et rechaîner laisse tous les liens valides : c'est la numérotation qui trahit.
- Un rapport est produit **même si l'autorité est en panne**, avec la raison : le document signé vaut
  d'être eu sans horodatage.
- La clé de signature est générée à la première utilisation et vit dans le **trousseau du système** —
  jamais dans un réglage, qui est une clé dans une capture d'écran, une sauvegarde et un ticket de
  support.

## 0.76.0 — 2026-10-03

### Ajouté

- **Chantier 2.2 — le registre des sorties part vers le collecteur de l'organisation.**
  **Désactivé par défaut.** Deux transports écrits à la main : syslog RFC 5424 sur TLS (RFC 5425)
  avec `node:tls`, et journaux OTLP/HTTP en JSON vers le collecteur de l'organisation. Les
  organisations ont l'une de deux choses et jamais les deux.

  ⚠️⚠️ **Jamais de contenu, et ce n'est pas une intention** : la ligne exportée est **construite**
  depuis une liste blanche de champs, pas obtenue en retirant ceux qu'on juge sensibles. Une liste
  noire laisserait passer **par défaut** le champ ajouté au registre le mois prochain — et c'est
  exactement celui où quelqu'un aura mis un chemin de fichier. Un test tient la liste ; un second
  vérifie qu'aucun formateur ne peut émettre de contenu quoi que porte la ligne.

  **Une file sur disque, et une ligne non envoyée reste visible.** Un expéditeur qui perd des lignes
  quand le collecteur est en panne est pire que pas d'expéditeur : le SIEM montre un après-midi
  calme et personne ne sait s'il était calme ou si le tuyau était cassé. Une ligne n'est retirée que
  lorsque le collecteur l'a prise, l'acquittement retire **les lignes envoyées et non les n
  premières** (une ligne peut avoir été mise en file pendant que le lot était en vol), et la borne de
  la file **compte** ce qu'elle perd. Nouvelle commande « Où en est le flux d'audit ».

  **L'identité est choisie, jamais découverte** : `siem.userId` est vide par défaut et rien ne le
  remplit. Une adresse e-mail prise dans une configuration git serait une donnée personnelle
  expédiée sans consentement, dans un système avec sa propre rétention. Un test lit le source et
  refuse toute tentative de la découvrir.

  Voir [ADR-0020](docs/adr/0020-expedier-le-registre-sans-jamais-expedier-de-contenu.md).

### Corrigé

- ⚠️ **Les lignes étaient acquittées sur une écriture dans le tampon du noyau.** Un collecteur qui
  terminait la poignée de main TLS puis raccrochait obtenait un succès pour des lignes qui
  n'arrivaient nulle part — le cas exact que ce module existe pour empêcher. L'acquittement est
  désormais la **fermeture propre** du socket après l'écriture complète. Trouvé par le test qui
  affirmait la garantie.

### Précisé

- **Le cadrage compte des octets, pas des caractères** : un nom de modèle avec un caractère
  non-ASCII fait divergher `string.length` et la longueur en octets, et le collecteur lit alors le
  début du message suivant comme la fin de celui-ci.
- **Les trois caractères que la RFC 5424 réserve** (`"`, `\`, `]`) sont échappés : s'y tromper ne
  produit pas un message rejeté mais un message analysé **dans les mauvais champs**, ce qui a l'air
  correct.
- La vérification du certificat est **activée par défaut**, désactivable délibérément — l'alternative
  est un opérateur avec un collecteur auto-signé et une échéance qui désactive tout.
- ⚠️ **Limite assumée** : syslog n'a aucun accusé de réception applicatif. « Envoyé » signifie « la
  connexion TLS s'est terminée sans erreur » ; un collecteur qui accepte les octets et les jette est
  indiscernable d'un qui les stocke. **Un test enregistre cette limite** au lieu de la cacher. OTLP
  rend un code HTTP, et c'est la seule des deux voies où un refus est connu.
- Tests contre un **vrai serveur TLS local** : envoi et cadrage, collecteur absent, raccrochage
  pendant la poignée de main, certificat signé par une autorité non épinglée, et reprise de la file
  après la panne. ⚠️ Le certificat est fabriqué par `openssl` à l'exécution du test — une clé privée
  dans le dépôt n'est pas l'alternative — et le test **échoue** si `openssl` manque plutôt que de
  passer sans avoir rien testé.

## 0.75.0 — 2026-10-03

### Ajouté

- **Chantier 2.1 — une politique d'entreprise signée, que l'utilisateur ne peut pas desserrer.**
  Un fichier JSON signé en Ed25519 (`node:crypto`), déposé par la DSI à un emplacement **machine**,
  avec la clé publique épinglée à côté : fournisseurs et adresses permis, plafond d'escalade,
  niveau d'anonymisation **minimal**, globs et commandes interdits additionnels,
  `writableLibraries`, plafonds de budget, fonctionnalités désactivées.

  **La politique ne fait que restreindre.** Elle ne peut rien accorder — il n'existe aucune
  politique qui désactive l'anonymisation ou autorise une adresse que l'utilisateur n'a pas
  configurée. C'est cette asymétrie qui rend le fichier sûr à déployer par script : le pire qu'une
  politique erronée puisse faire est de rendre l'extension **moins capable, jamais moins prudente**.
  Et un développeur plus strict que sa politique est laissé tranquille.

  ⚠️⚠️ **Un échec n'est pas une absence.** Fichier illisible, signature invalide, version inconnue,
  **ou clé épinglée sans politique à côté** : l'extension passe dans son mode le plus sûr et le dit.
  Le repli silencieux sur les réglages utilisateur ferait de la suppression d'un fichier la façon
  d'échapper à la politique. Une version inconnue est refusée plutôt qu'appliquée à moitié :
  appliquer la part comprise serait annoncer une conformité qu'on n'a pas.

  ⚠️⚠️ **La politique n'est jamais lue depuis l'espace de travail** — une politique arrivée avec un
  `git clone` serait écrite par celui qui a envoyé le dépôt. Un test lit le code du chargeur et
  refuse tout accès à l'espace de travail.

  ⚠️ **La signature couvre les octets qui sont analysés** : la politique voyage en base64 dans son
  enveloppe. Signer un objet JSON exigerait une forme canonique, et chaque schéma qui s'y est essayé
  a eu un défaut où deux documents différents se canonicalisent identiquement.

  Voir [ADR-0019](docs/adr/0019-la-politique-ne-fait-que-restreindre.md).

### Corrigé

- ⚠️ **La restriction était appliquée deux fois**, et seul le test d'intégration pouvait le voir :
  idempotent sur les valeurs, donc invisible partout — sauf que l'interface aurait affirmé
  qu'**aucun réglage n'était géré** sur un poste entièrement géré.

### Précisé

- Nouvelle commande **« Recharger la politique de l'organisation »**. Le rechargement est un acte
  délibéré et non un observateur de fichier : une politique écrite un demi-fichier à la fois serait
  lue en cours d'écriture et refusée, mettant le poste en mode sûr parce qu'un administrateur était
  au milieu d'un déploiement.
- La restriction est appliquée dans **`readSettings()`**, un seul point d'étranglement. Vérifier la
  politique au point d'usage est la version de ceci qui a un trou dès qu'on ajoute une
  fonctionnalité.
- Une **liste vide est parfois l'état le plus permissif** : `writableLibraries` vide veut dire « la
  garde est inactive », donc ce n'est pas un accord avec la politique.
- ⚠️ **Non défendu, et dit** : qui peut écrire dans le répertoire de politique possède la politique,
  puisque la clé y est épinglée. C'est le périmètre de confiance voulu.

## 0.74.0 — 2026-10-02

### Ajouté

- **Chantier 1.7 — remettre le changement à ARCAD, et la seule chose que l'agent ne fera jamais.**
  Sur une partition gérée par ARCAD Elias, un changement n'entre pas en production parce que
  quelqu'un a édité un membre : il est extrait, modifié, réintégré, construit, puis **promu** par une
  personne qui en répond.

  Une compétence **`/deliver`** prépare la remise, et l'ordre des étapes est le contenu de la
  compétence : compiler, **puis** tester, **puis** réintégrer, **puis** demander la construction.
  Chacune de ces préconditions a une raison qu'un modèle n'invente pas — un membre qui ne compile
  pas n'a produit aucun objet, donc il n'y a rien à livrer ; compiler prouve que c'est un programme
  et pas qu'il fait encore ce qu'il faisait ; et une construction demandée **avant** la
  réintégration construit la version précédente et annonce une réussite. `readyToDeliver` tient ces
  règles dans le noyau, avec la même règle « c'est le dernier qui compte » que `verifyTurn` : un tour
  qui a compilé, échoué, corrigé et recompilé a bien gagné sa remise.

### Précisé

- ⚠️⚠️ **La promotion vers la production n'est pas un outil de l'agent, et ne peut pas être
  configurée pour l'être.** La garantie tient à la **liste blanche** d'actions `arcad.*` que le pont
  expose, et non à une consigne dans un prompt : **un test lit cette liste dans le source** et refuse
  toute entrée qui ressemble à une promotion. C'est le même raisonnement que l'outillage du mode Plan
  et que la garde des bibliothèques inscriptibles — un modèle qui lit mal une consigne est le cas
  ordinaire, pas l'exception — et c'est surtout ce qui tient la promesse dans six mois, quand
  quelqu'un ajoutera une commande à la liste. Prouvé en ajoutant une commande de promotion : le test
  rougit.
- Et le refus **dit qui le fait à la place**. « Je ne peux pas faire ça » sans étape suivante est la
  façon dont quelqu'un finit par le faire à la main, hors d'ARCAD, à dix-sept heures.
- ⚠️ **Non vérifié** : rien de ceci n'a tourné contre une installation ARCAD. Les actions employées
  sont celles que l'extension Elias enregistre elle-même — une surface déclarée et versionnée — et
  aucun chemin REST n'est inventé, conformément à la position déjà écrite en tête de
  `integrations/arcad.ts`.

## 0.73.0 — 2026-10-02

### Ajouté

- **Chantier 1.6 — quarante compétences IBM i, et chacune adossée à une tâche qui échoue d'abord.**
  21 nouvelles compétences complètent les quatre familles : **14 RPG** (indicateurs nommés,
  `MOVE`/`MOVEL` vers des affectations explicites, sortie du cycle, `/COPY` et prototypes, monolithe
  vers programme de service, contrôle de validation, pointeurs et stockage basé), **7 DDS** (fichier
  logique, clés et sélection, DDS vers DDL SQL, sous-fichier), **11 Db2 for i** (index sur preuves,
  isolation, déclencheurs, performance d'une requête, gestion des nulls) et **8 CL** (`SBMJOB`
  explicite, sortir de la liste de bibliothèques, messages exploitables, surveillance du message qui
  peut arriver, contrôle des paramètres avant d'agir).

  ⚠️ Et le critère qui coûte : **une compétence est une poignée de lignes de texte**, donc quarante
  compétences jamais éprouvées sont quarante lignes dans un tableau comparatif. Chaque compétence
  IBM i **déclare donc la tâche d'évaluation qui l'éprouve** (`evalTask`), et trois tests lisent
  cette déclaration : au moins quarante compétences et au moins cinq par famille, la tâche nommée
  **existe sur le disque**, et c'est bien une tâche IBM i — ce qui empêche la triche évidente
  d'adosser `/tofree` à une tâche JavaScript. Les deux portes du banc font le reste : la tâche doit
  échouer sur la fixture intacte et réussir sur sa solution.
  Voir [ADR-0018](docs/adr/0018-une-competence-nomme-la-tache-qui-l-eprouve.md).

- **Le banc passe de 40 à 51 tâches**, dont 21 IBM i : indicateurs numérotés, `MOVE`/`MOVEL`,
  `/COPY` et prototypes, programme de service avec source de reliure et signature, documentation
  d'un membre, tests RPGUnit écrits, accès par enregistrement vers curseur SQL, fichier logique avec
  clé et sélection, DDS vers `CREATE TABLE` avec `LABEL ON`, `SBMJOB` explicite et surveillé,
  fichier imprimante avec en-têtes et saut de page. 51/51 échouent avant et passent sur leur
  solution.

### Précisé

- ⚠️ **Deux compétences ne peuvent pas être éprouvées par le banc**, et elles le **déclarent**
  (`evalGap`) : `/impact` et `/whouses` répondent depuis une partition vivante, et une fixture qui en
  tiendrait lieu deviendrait la chose testée. Les deux autres réponses possibles étaient mauvaises —
  les adosser à une tâche voisine mais sans rapport rend le critère décoratif, les laisser
  silencieusement sans rien le rend faux sans que personne le sache. Un test exige que ces lacunes
  restent au plus quatre et qu'elles disent ce qui manque.
- ⚠️ **Non vérifié** : aucune de ces compétences n'a été exécutée contre un modèle réel. On sait que
  les tâches sont honnêtes ; on ne sait pas encore que les compétences les résolvent — c'est
  exactement ce que le chantier 0.6 a livré le moyen de mesurer.

## 0.72.0 — 2026-10-02

### Ajouté

- **Chantier 1.4 — pourquoi cette requête est lente, d'après ce que la base sait déjà.**
  `ibmi_index_advice` lit ce que l'optimiseur de Db2 for i a **souhaité** avoir pendant que de vraies
  requêtes tournaient (`QSYS2.SYSIXADV`), avec la taille et le nombre d'index de la table
  (`QSYS2.SYSTABLESTAT`). C'est la différence entre « pose un index sur CUSTNO, ça aide en général »
  et « l'optimiseur a demandé cette clé exacte 4 812 fois, sur 2,1 millions de lignes, et a construit
  un index temporaire pour elle ». La compétence `/sql` l'appelle **avant** de proposer un index, et
  n'en propose pas sans lui.

  ⚠️ Et le rapport ne recommande rien : le conseiller est une **liste de souhaits, pas une
  conception**. Lu comme une liste de tâches il donne une table à quatorze index où chaque insertion
  paie les quatorze. Chaque réponse porte donc ce que le conseiller ne veut pas dire — une clé
  demandée deux fois est du bruit, l'ordre des colonnes EST l'index, un conseiller vide ne veut pas
  dire que les index sont bons — et rappelle que créer l'index est une **modification**, bornée comme
  les autres.

- **Chantier 1.5 — ce que veut dire un identifiant, et ce que la maison en fait.**
  `ibmi_message` rend le texte IBM de premier et de second niveau depuis le fichier de messages
  (`QSYS2.MESSAGE_FILE_DATA`) **et** les notes de la documentation interne qui citent cet
  identifiant. Le texte d'IBM dit ce qui s'est passé ; il ne dit pas quoi faire, parce que quoi faire
  est une décision que cette maison a prise et écrite quelque part.

  ⚠️ Les deux moitiés sont **étiquetées**, et c'est tout l'intérêt : IBM d'abord, comme fait ; les
  notes ensuite, comme celles de l'organisation et « possiblement périmées », avec la consigne de dire
  sur laquelle on s'appuie. Un modèle qui ne les distingue pas présente une procédure de 2011 avec
  l'autorité d'un manuel.

### Précisé

- Les deux outils ne font que lire, donc ils sont disponibles en **mode Plan** — c'est là que les
  questions « pourquoi est-ce lent » et « que veut dire cette erreur » se posent le plus.
- Créer un index reste une **écriture** : `isReadOnlySql` ne laisse passer que `select`/`with`/
  `values`, donc un `CREATE INDEX` passe par la garde comme n'importe quelle autre modification. Un
  test l'exige explicitement.
- ⚠️ **Un chiffre absent reste absent.** `Number("")` vaut 0 et 0 est fini, donc une colonne que le
  catalogue n'a pas renvoyée devenait « cette table a zéro ligne » — une mesure que personne n'a
  faite. Trouvé par un test. Même règle que le rapport d'évaluation, appliquée au catalogue.
- La décision structurante commune à 1.3, 1.4 et 1.5 est écrite dans
  [ADR-0017](docs/adr/0017-un-resultat-porte-son-autorite.md) : un résultat porte sa méthode, ce que
  cette méthode ne peut pas voir, et ce qui n'a pas pu être lu — dans le résultat lui-même, parce que
  c'est ce que le modèle recopie.
- ⚠️ **Non vérifié** : aucun de ces outils n'a tourné contre une partition. D'où la lecture des
  colonnes par `cell()` sous plusieurs orthographes partout.

## 0.71.0 — 2026-10-02

### Ajouté

- **Chantier 1.3 — qui utilise ceci ?** `ibmi_impact` répond à la question posée avant chaque
  modification d'un fichier sur cette plate-forme, et que le membre sous les yeux ne peut pas
  trancher : un fichier physique est utilisé par des programmes dont personne ne se souvient, à
  travers des logiques dont les noms ne disent rien, depuis une bibliothèque qui n'est pas dans la
  liste courante. Changer la longueur d'un champ est une édition de cinq minutes et une recherche de
  quatre heures.

  **Deux niveaux, et ce ne sont pas deux réponses de même valeur** — c'est toute la conception :
  au niveau objet, `DSPPGMREF` lit la liste de références que le compilateur a enregistrée, et c'est
  un **fait** ; au niveau champ, c'est une **recherche** dans les sources qu'on peut lire, qui
  manque tout programme dont la source a disparu, toute référence construite à l'exécution et tout
  champ renommé par un mot-clé PREFIX. Chaque réponse porte donc sa **méthode en première ligne** et
  ses **limites** en toutes lettres : ce résultat finit collé dans une demande de modification, et
  la différence entre « le compilateur a enregistré ceci » et « j'ai cherché dans ce que je pouvais
  lire » est la différence entre un fait et une piste.

  Nouvelle compétence **`/impact`**, qui l'appelle *avant* de proposer quoi que ce soit.

### Précisé

- **`QTEMP` est la seule bibliothèque qu'un outil en lecture peut écrire, et la garde le sait
  explicitement** (`SCRATCH_LIBRARY`). Demander « quels programmes utilisent ce fichier » passe par
  un fichier de sortie, donc un outil qui ne fait que lire doit malgré tout écrire quelque part. La
  raison n'est pas une convention mais une propriété : QTEMP est créée par travail, détruite avec
  lui, invisible des autres travaux. L'exemption vit dans la garde et non dans chaque outil — un
  outil qui s'accorde une exemption peut se tromper, et le suivant recopie l'exemption sans recopier
  la raison. Elle ne blanchit pas les autres bibliothèques nommées dans la même commande, et
  `ibmi_impact` fait passer **sa propre commande** par la garde avant de la lancer.
- **Trouver zéro n'est jamais rendu par « rien ne l'utilise ».** Au niveau objet c'est « aucun
  programme de ces bibliothèques n'enregistre de référence — c'est un fait sur ces bibliothèques,
  pas sur le système » ; au niveau champ, c'est une preuve faible, et c'est dit.
- ⚠️ **ARCAD : la feuille de route demandait ses références croisées, et je ne les appelle pas.**
  Elias les a réellement, et le catalogue d'endpoints REST d'ARCAD n'est pas publié — inventer un
  chemin produirait une intégration qui casse chez le client d'une façon indébogable, ce qui est
  déjà la position écrite en tête de `integrations/arcad.ts`. La forme honnête : la réponse dit que
  ARCAD est installé, qu'il sait mieux, et nomme la porte (`arcad_rest` avec un chemin fourni par
  l'administrateur ARCAD) au lieu de prétendre à une réponse d'un produit qu'on devine.

## 0.70.0 — 2026-10-02

### Ajouté

- **Chantier 1.2 — les tests RPG de la maison sont exécutés, et leur résultat compte.**
  `ibmi_test` lance RPGUnit (`RUCALLTST`) contre un programme de test compilé et rend les cas passés
  et les cas en échec. Le compilateur répond « est-ce un programme ? » ; ceci répond à la question
  qu'une banque pose vraiment : « fait-il encore ce qu'il faisait ? » — en exécutant les tests que
  la maison a déjà, pas en inventant un cadriciel.

  Comme la compilation, un échec est un **verdict sur le tour** : un programme qui compile et rate
  ses tests n'est pas fini. Les deux verdicts sont séparés — la réussite de la compilation ne couvre
  pas l'échec des tests.

  Nouvelle compétence **`/rpgtest`** : lire ce que le membre promet, écrire les cas, les compiler
  avec `ibmi_compile`, puis les **exécuter**. L'instruction qui compte est la dernière : un modèle à
  qui l'on demande d'écrire des tests écrit des tests et crie victoire, et sur cette plate-forme une
  source de test qui n'a jamais été compilée n'est pas un test, c'est un fichier texte dans
  QRPGLESRC.

### Corrigé

- **`/compile` n'invente plus sa commande.** La compétence disait au modèle de construire un `CRT…`
  à la main avec `ibmi_command` — c'est précisément ainsi qu'une bibliothèque cible ou un jeu
  d'options finit par être inventé. Elle utilise maintenant `ibmi_compile`.

### Précisé

- **L'outil refuse d'être rassurant.** Si RPGUnit n'est pas installé, il le dit et n'exécute rien :
  « aucun test en échec » sur une partition sans cadriciel de test est la phrase la plus coûteuse
  que cet outil pourrait produire. Et « je n'ai pas pu interroger le catalogue » est un **troisième
  cas**, distinct de « pas installé » : un catalogue illisible n'est pas une partition sans RPGUnit.
- La présence est demandée au **catalogue d'objets** et non en lançant la commande pour voir : un
  `RUCALLTST` qui n'existe pas échoue d'une façon qu'aucun code de retour ne distingue d'un test en
  échec.
- ⚠️ **Non vérifié, et dit clairement** : ce qui est connu de première main, c'est le contrat de
  `RUCALLTST` — il prend le programme de test et se termine en erreur quand un test échoue. Le
  **texte** qu'il imprime ne l'est pas. La conception est donc faite pour que l'ignorer soit sans
  danger : le verdict est le code de retour et jamais les compteurs lus, une ligne n'est lue comme
  un résultat que si elle en est clairement un, l'analyseur **dit** combien de lignes il n'a pas su
  lire, et la sortie brute voyage toujours avec le résultat. « Je n'ai reconnu aucun test » n'est
  jamais rendu par « aucun test n'a échoué ».
- ⚠️ Un nom de **procédure** n'est pas un nom d'objet : la règle des dix caractères refusait
  `testRoundsHalfUp`, qui est un nom de procédure RPG parfaitement ordinaire. Trouvé par un test.

## 0.69.0 — 2026-10-02

### Ajouté

- **Chantier 1.1 — compiler, lire les erreurs, corriger : la boucle qu'IBM Bob ne revendique pas.**
  `ibmi_compile` compile un membre sur la partition avec la commande de son type (`CRTBNDRPG`,
  `CRTSQLRPGI`, `CRTRPGMOD`, `CRTBNDCL`, `CRTPF`, `CRTLF`, `CRTDSPF`, `CRTPRTF`) et revient avec ce
  que le compilateur a dit : identifiant, gravité, membre, ligne, texte.

  **Et c'est un verdict sur le tour**, au même titre qu'une suite de tests. Sur IBM i la
  vérification n'est pas graduelle : un membre qui ne compile pas n'a pas produit un résultat
  partiel, il n'a rien produit — il n'y a pas d'objet. `ibmi_compile` rejoint donc `VERIFIERS` dans
  `core/router/outcome.ts`, avec la règle « c'est le dernier qui compte » : compiler, lire RNF7030,
  corriger et recompiler n'est pas un échec, tandis qu'une compilation encore en échec à la fin du
  tour achète l'escalade avec la liste d'erreurs. Contrairement à `run_command`, le code de retour
  compte **toujours** — un `grep` qui échoue est une réponse, un `CRTBNDRPG` qui échoue n'en est pas
  une. Voir [ADR-0016](docs/adr/0016-compiler-est-un-verdict.md).

  Trois sources expliquent le verdict, chacune tentée séparément : ce que la commande a imprimé, la
  liste de compilation du fichier spoulé (la seule qui porte des numéros de ligne) et le journal du
  travail. ⚠️ Le journal est lu pour **le travail que le spoule désigne** et non pour « le travail
  courant » : la commande tourne dans un travail et le SQL dans un autre, donc `JOBLOG_INFO('*')`
  aurait renvoyé un journal sans rien sur la compilation, présenté comme la sortie du compilateur.
  Ce qui n'a pas pu être lu est dit, parce qu'un modèle à qui l'on annonce seulement « ça a échoué »
  invente une cause.

  Pas de compilateur en mode Plan, et pas par un drapeau que l'outil se donne : `READ_ONLY` est une
  liste blanche, et créer un objet n'y figure pas.

### Corrigé

- **Un type de membre inconnu n'est plus compilé avec le compilateur le plus proche.** Il est
  refusé. RPG III est le cas tentant — `.rpg` ressemble à du RPG et `CRTBNDRPG` existe — mais un
  compilateur lancé sur une source qu'il ne comprend pas produit une liste pleine d'erreurs
  crédibles à propos de code qui va bien, ce qui est une pire réponse qu'un refus.

### Précisé

- **Chaque nom est refusé plutôt qu'échappé.** Bibliothèque, fichier source, membre et bibliothèque
  cible viennent du modèle et sont interpolés dans une commande CL et dans du SQL.
  `CUSTRPT) MONMSG MSGID(CPF0000) DLTLIB LIB(PROD` est une chaîne acceptable et une commande
  catastrophique, et la garde de production ne peut rien y faire : elle relit une commande *après*
  sa construction, et celle-ci aurait été construite par nous pour le compte du modèle. Le nom de
  travail que la partition renvoie subit le même contrôle avant de repartir dans une requête.
- `hiveyCode.ibmi.writableLibraries` borne aussi la compilation, à une différence près : la liste
  vide ne désactive pas la barrière, elle la rend **visible** — la compilation est toujours soumise
  à approbation et la carte dit que rien ne la borne.
- ⚠️ **Non vérifié, et dit clairement** : les fixtures de l'analyseur sont **construites d'après les
  dispositions documentées, pas enregistrées** sur une vraie partition. Elles établissent le
  comportement qui nous appartient ; elles n'établissent pas « ça marche sur une V7R5 ». D'où un
  analyseur qui ne dépend d'aucune colonne fixe.

## 0.68.1 — 2026-10-02

### Corrigé

- **Le banc d'évaluation partait dans le `.vsix`** : 156 fichiers et 57 Ko de quarante dépôts cassés
  exprès, de leurs solutions de référence et des résultats qu'une campagne avait laissés. `eval/` est
  dans `.gitignore` pour ses résultats, ce qui n'a rien à voir avec être exclu du paquet — `vsce`
  empaquette ce qui est sur le disque. Même argument que `dist-integration/**` juste au-dessus dans
  `.vscodeignore`, et la même erreur un dossier plus loin. Le paquet passe de 193 à 37 fichiers.

## 0.68.0 — 2026-10-02

### Ajouté

- **Chantier 0.6 — un rapport d'évaluation qui ne peut pas inventer un chiffre.**
  `npm run eval -- --report <dossier>` écrit `report.json` et `report.md` : par tâche et par
  modèle, réussite, durée, nombre d'étapes, jetons entrants et sortants, coût, et comment le tour
  s'est arrêté (réponse, plus d'étapes, tronqué). Réussi ou échoué était la moitié la moins
  intéressante : un modèle qui résout neuf tâches en quarante secondes chacune et un modèle qui en
  résout neuf en neuf minutes et douze étapes ne sont pas le même produit.

  Les chiffres viennent du tour lui-même : avec `HIVEY_CODE_RUN_REPORT=<fichier>`, le client
  terminal ajoute une ligne de JSON par tour. Le harnais pointe ce fichier **hors de la copie de
  travail** — un fichier que l'agent voit est un fichier qu'il peut modifier, et la mesure ne doit
  pas faire partie de ce qui est mesuré.

  Et il refuse de combler un trou : un modèle local est **non tarifé**, jamais gratuit ; un total
  qui n'a pas pu tarifer toutes les exécutions est marqué comme un plancher ; une campagne sans
  modèle joignable dit « not measured » sans aucun tableau, plutôt qu'une page de zéros. Ces règles
  sont dans `src/core/eval/report.ts` et tenues par neuf tests, dont un qui exige qu'un rapport
  vide ne contienne pas la chaîne `0 %`. Voir
  [ADR-0015](docs/adr/0015-une-evaluation-qui-ne-peut-pas-inventer-un-chiffre.md).

- **Le banc passe de 15 à 40 tâches.** TypeScript, Python, Java, SQL, RPG fixe et libre, CL, DDS,
  Db2 for i, et la finance : arrondi demi-loin-de-zéro, décimal exact, IBAN mod-97, échéancier dont
  les mensualités doivent totaliser le capital au centime, sous-unités monétaires ISO 4217 (le yen
  n'a pas de centimes, le dinar tunisien en a trois). Les tâches Python, SQL et JavaScript sont
  **exécutées** ; les tâches Java, TypeScript et IBM i sont **structurelles** — il n'y a ici ni JDK,
  ni compilateur TypeScript, ni partition — et le mot est écrit dans `eval/README.md` plutôt que
  sous-entendu.

### Corrigé

- **Un contrôle d'évaluation pouvait être impossible à satisfaire, et rien ne le disait.**
  `--verify-tasks` attrapait une tâche qui passe avant que le modèle y touche. L'erreur inverse est
  pire parce qu'elle est invisible : un contrôle qui ne peut **jamais** réussir note tous les
  modèles à 0 % et ressemble exactement à une tâche difficile — il devient une preuve contre les
  modèles au lieu d'une preuve contre lui-même. Chaque tâche livre désormais un `solution/`, et
  `npm run eval:solutions` exige que le contrôle passe au vert dessus. Les deux portes tournent sans
  modèle, donc les deux sont en CI.

  Il a trouvé **quatre contrôles insatisfaisables** à son premier passage, dont un présent depuis
  des semaines, et la cause était la même à chaque fois : un contrôle structurel est un grep, et un
  grep lit aussi les commentaires. Une réponse correcte qui s'explique — « remplacé le bloc
  `finally` par un try-with-resources » — était refusée pour avoir cité ce qu'elle venait de
  supprimer. `ibmi-sql-db2` refusait toute réponse mentionnant `pg_` dans un commentaire. La
  première victime a été la solution de référence. D'où `eval/bin/codeonly`, qui imprime un fichier
  sans ses commentaires ; il est sur le `PATH` de chaque contrôle et vit dans le dépôt, pas dans la
  fixture, parce qu'un outil que l'agent peut modifier n'est pas un contrôle.

### Précisé

- Le workflow nocturne écrit le rapport dans le **résumé de l'exécution** et plus seulement dans un
  artefact : c'est tout l'intérêt de produire du Markdown, la comparaison entre deux nuits doit être
  lisible sans rien décompresser.
- **Non mesuré, et assumé** : aucun modèle n'a encore été évalué. Le harnais est prouvé de bout en
  bout contre un faux serveur de modèle ; les chiffres de qualité des modèles restent à produire sur
  une machine qui en héberge un.

## 0.67.0 — 2026-10-02

### Corrigé

- **Le mode agent ne modifiait plus rien : l'extension dictait un chemin au modèle, puis refusait
  le sien.** Le résolveur de chemins refusait tout chemin **absolu** avec « leaves the workspace »,
  en confondant « absolu » et « hors du projet » — alors que `/home/moi/projet/src/a.ts` et
  `src/a.ts` sont le même fichier quand ce dossier est ouvert. Or c'est exactement l'écriture que
  l'extension donne elle-même au modèle : un fichier qui n'appartient à aucun dossier ouvert n'a
  pas de nom relatif à donner, et le contexte le nomme donc par son chemin complet (`relative()`
  renvoie `uri.fsPath`). Le modèle rendait ce chemin, l'outil le refusait, et le tour se terminait
  par une description de la modification au lieu de la modification. La même écriture arrive par
  les diagnostics de l'éditeur, la sortie du terminal et les piles d'appel, qui sont tous absolus.

  D'où une panne qui paraissait intermittente : un fichier **dans** le dossier ouvert passait par
  un chemin relatif et fonctionnait ; un membre source IBM i, un fichier distant, un fichier glissé
  dans l'éditeur ou un fichier d'un second dossier ne passait jamais. Dès que le travail porte sur
  des membres, plus rien n'est modifiable.

  L'appartenance est désormais décidée en résolvant le chemin puis en regardant où il a atterri
  (`src/core/fs/within.ts`, sans `vscode`, parce qu'une telle règle se trompe aux bords : barre
  oblique finale, lettre de lecteur, dossier voisin dont le nom commence par celui de la racine).
  Un chemin absolu est accepté s'il tombe dans un dossier ouvert, ou s'il **est** l'un des fichiers
  ouverts ; refusé sinon, avec une phrase qui dit lequel des deux cas s'applique. Un chemin relatif
  ne change pas : un `..` est refusé, jamais interprété. La politique de confidentialité est
  maintenant appliquée à la partie sous la racine, car `**/.env*` ne correspond pas à
  `/home/moi/.env`. Voir [ADR-0014](docs/adr/0014-un-chemin-absolu-n-est-pas-un-chemin-dehors.md).

  Le défaut existait depuis la première version et aucun test ne l'avait vu : les quarante tests
  d'intégration affirment **tous** sur ce qui a été envoyé ou sur ce que le panneau dit, aucun sur
  le contenu d'un fichier. Le quarante et unième fait modifier un fichier par un vrai tour dans un
  vrai éditeur, et noue les deux moitiés de la contradiction — il affirme d'abord que `relative()`
  donne bien ce chemin-là, puis fait rendre ce même chemin par le modèle, de sorte qu'aucun des
  deux côtés ne peut plus dériver de l'autre. Vérifié en retirant le correctif : le test redevient
  rouge sur le message d'origine.

## 0.66.0 — 2026-10-02

### Corrigé

- **Chantier 0.5 — les chiffres annoncés par la documentation ne pouvaient que vieillir.**
  `README.md` annonçait 562 tests unitaires et la version 0.39.0 alors que le dépôt était bien
  au-delà ; `README.fr.md` en était resté à 284 tests et à `0.11.1`. Personne n'a menti : un chiffre
  écrit en prose n'a aucune raison de suivre ce qu'il décrit, et une valeur qu'il faut penser à
  mettre à jour sera fausse à la version suivante.

  `scripts/check-numbers.mjs` compare neuf affirmations à la réalité du dépôt — version, tests
  unitaires, tests d'intégration, tâches d'évaluation — et la CI l'exécute. `--fix` les réécrit.

  ⚠️ Ce qui compte comme vérité est **volontairement bon marché à calculer** : un test est un
  `test(` en tête de ligne dans un fichier de tests, ce que `node:test` rapporte, et une tâche est
  un répertoire sous `eval/tasks`. Lancer la suite pour compter en ferait une barrière lente que
  personne ne mettrait dans la CI. Les deux comptes ont été validés contre la réalité : 724 et 40,
  exactement ce que les deux suites annoncent.

  ⚠️ Les endroits vérifiés sont **listés** et non devinés : une expression assez large pour trouver
  toutes les tournures serait assez large pour réécrire un nombre qui n'était pas une affirmation.
  Ajouter une affirmation, c'est l'ajouter à cette liste — c'est le moment où quelqu'un décide que
  c'en est une.

  ⚠️ Friction assumée : chaque test ajouté périme le chiffre, donc `npm run check:numbers -- --fix`
  fait désormais partie de la préparation d'un commit. Le contrôle l'a d'ailleurs prouvé sur
  lui-même, en signalant le test que je venais d'écrire pour lui.

## 0.65.0 — 2026-10-02

### Corrigé

- **Chantier 0.4 — la suite de tests dépendait de la version de Node qui la lançait.**
  `node --test dist-tests/` avait l'air d'être l'appel évident et ne l'est pas : ce qu'un argument
  positionnel **signifie** pour le lanceur a changé entre les versions — un répertoire sous Node 18
  et 20, un chemin ou un motif sous Node 22, où l'ensemble correspondant n'est pas le même. Et un
  motif littéral n'est pas une réponse non plus : Node 18 ne sait pas les développer, et npm exécute
  ses scripts par `cmd.exe` sous Windows, qui ne les développe pas davantage — le motif arriverait
  donc à Node sous forme de texte précisément là où il ne peut pas être lu.

  `scripts/run-tests.mjs` énumère les fichiers et les passe **explicitement**. Une liste de chemins
  a toujours voulu dire la même chose, dans toutes les versions et sur toutes les plateformes. Le
  lanceur employé est `process.execPath` et non `node` : celui qui exécute le script, pas celui qui
  se trouve en tête du `PATH`.

- **`engines` annonçait Node 18 ou plus et la CI n'exécutait que Node 20** : deux des trois
  promesses n'étaient jamais éprouvées. Nouveau travail `unit` en matrice — 18, 20 et 22 sur Linux,
  plus un passage Windows sous 22, puisque la fragilité de l'ancien appel était justement une
  histoire de `cmd.exe`. Deux tests gardent l'invariant : l'appel ne reçoit ni répertoire ni motif,
  et la version la plus basse annoncée par `engines` figure dans la matrice.

  ⚠️ **Non vérifié ici** : seul Node 18 est installé sur cette machine, donc je n'ai pas pu
  reproduire l'échec sous Node 22 ni le constater corrigé. C'est la matrice de CI qui l'établira au
  prochain passage, et c'est précisément pour cela qu'elle est ajoutée.

## 0.64.0 — 2026-10-02

### Corrigé

- ⚠️⚠️ **Chantier 0.3 — `QSH` était classé parmi les verbes de lecture.** Un shell n'est pas un
  lecteur : `QSH CMD('rm -r /QSYS.LIB/PROD.LIB')` était donc considéré comme un regard et passait
  sans être examiné la barrière qui existe pour tenir l'agent hors de la production. `STRSQL` y
  figurait aussi.

  Les deux quittent la liste des lecteurs, et une catégorie de refus est ajoutée : **opaque**. Une
  commande qui porte ce qu'elle va faire dans une chaîne — `QSH`, `STRQSH`, du CL passé à `QCMDEXC`
  ou `QCAPCMD` — est refusée d'emblée dès que la liste est renseignée, **même lorsqu'elle semble
  nommer une bibliothèque autorisée** : ce qu'elle touche se construit à l'exécution, et sembler
  viser `DEVCFC` n'est pas viser `DEVCFC`. La détection porte sur tout le texte et non sur le verbe,
  donc un shell enveloppé dans une soumission — `SBMJOB CMD(QSH CMD('…'))` — reste un shell ; et les
  frontières de mot évitent qu'un membre nommé `QSHELLDOC` soit pris pour un interpréteur.

  ⚠️ Vérifié : `SBMJOB CMD(DLTF FILE(PROD/X))` était **déjà** correctement refusé, le paramètre `CMD`
  étant lu comme le reste. ⚠️ Vérifié en retirant le correctif : trois tests retombent.

### Précisé

- `docs/THREAT-MODEL.md` §4 décrit maintenant la barrière IBM i, ses trois rigueurs et son résidu :
  elle borne le **périmètre**, pas le geste — une commande autorisée peut détruire quelque chose
  dans une bibliothèque autorisée — et elle est **vide par défaut**.

## 0.63.0 — 2026-10-02

### Corrigé

- **Chantier 0.2 — un marqueur coupé entre deux fragments s'affichait brut.** `vault.restore()` était
  appliqué fragment par fragment, et un modèle n'envoie pas des mots : il envoie ce qui tient dans
  un paquet. Un marqueur arrivait donc coupé — `⟨EMA`, puis `IL_1⟩` — et aucune des deux moitiés ne
  correspond au motif. Le lecteur voyait le marqueur apparaître brut, puis **rester** brut, parce
  qu'un texte déjà affiché n'est jamais repris.

  `streamingRestorer` (`core/redaction/`) examine la fin de chaque fragment : un crochet ouvrant
  sans fermant, assez proche de la fin pour pouvoir encore devenir un marqueur, est **retenu** et
  recollé au fragment suivant. Tout ce qui précède part immédiatement — une réponse vivante qui
  attend est pire qu'une réponse qui attend un paquet. Deux refus assumés : il ne retient **jamais
  indéfiniment** (la prose peut contenir `⟨` ; au-delà de 32 caractères le texte part tel quel), et
  il ne **perd rien** (`flush` rend ce qui était retenu à la fin du flux, y compris quand
  l'utilisateur arrête le tour). Il sert à la réponse, à la réflexion, au résumé et au client
  terminal.

  ⚠️ Vérifié en retirant le correctif : trois tests retombent. ⚠️ Le garde-fou écrit sur le source
  a trouvé **un troisième chemin de streaming** que je n'avais pas vu — celui du résumé — ce qui est
  exactement ce pour quoi une règle vaut mieux qu'une relecture.

## 0.62.0 — 2026-10-01

### Corrigé

- **Chantier 0.1 — les marqueurs n'arrivaient pas jusqu'aux arguments des outils.** `vault.restore()`
  s'appliquait à ce que l'utilisateur **lit** — la réponse, la réflexion — et pas à ce que les outils
  **font**. En mode agent contre un point d'accès distant, c'est la différence entre une
  modification qui aboutit et une qui ne peut pas : `write_file` écrivait `⟨HOST_1⟩` sur le disque,
  et `edit_file` cherchait dans un fichier un extrait contenant un marqueur que ce fichier n'a
  jamais porté.

  La restauration est désormais appliquée **récursivement à toutes les chaînes** d'un appel d'outil
  — clés comprises, car un outil indexé par chemin porterait sinon un marqueur comme nom de la chose
  à modifier — et elle a lieu **avant la validation du schéma, avant la carte d'autorisation et
  avant l'exécution** : la phrase que vous approuvez décrit ce qui va réellement se passer. Seuls
  les marqueurs que ce coffre a émis sont remplacés ; un marqueur inventé par le modèle ou tapé par
  l'utilisateur reste tel quel, parce que lui en substituer un serait inventer une valeur. Le client
  terminal reçoit le même correctif.

  ⚠️ Vérifié en retirant le correctif : le test retombe. ⚠️ **Non vérifiable en test d'intégration
  ici** — `EgressGate.prepare` saute la porte de sortie pour un point d'accès local, et tous les
  stubs de la suite écoutent en loopback, donc aucun coffre ne peut être peuplé. L'invariant est
  gardé autrement : un test lit le source et refuse qu'un tour restaure sa réponse sans restaurer
  ses arguments.

## 0.61.0 — 2026-10-01

### Ajouté

- **La base de connaissance lit les Word et les PDF.** Toute la documentation interne est dans ces
  formats, donc les refuser revenait à refuser la fonctionnalité. Les deux extracteurs sont **écrits
  à la main**, dans `core/docs/`, comme le rendu Markdown, le diff, le glob et le client MCP l'ont
  été : `node:zlib` est un module du runtime et non une dépendance, donc la promesse de **zéro
  dépendance** tient.

  - Un `.docx` est une archive ZIP dont `word/document.xml` porte la prose. Le lecteur ZIP lit le
    **répertoire central** plutôt que les en-têtes locaux, parce qu'un en-tête local peut annoncer
    des tailles nulles avec les vraies derrière les données. Ce qui est perdu est de la mise en
    forme, pas du contenu : les cellules d'un tableau deviennent du texte séparé par des tabulations.
  - Un `.pdf` est plus rude, et l'ancienne prudence du projet était justifiée. L'extracteur est
    borné — flux `FlateDecode`, opérateurs `Tj`/`TJ`, chaînes littérales et hexadécimales — et
    surtout **il dit s'il faut le croire**. Un scan sans couche de texte, un fichier chiffré, ou des
    polices sous-ensemble dont les octets sont des indices de glyphes : le résultat est **écarté**
    plutôt qu'attaché. ⚠️ *La règle n'a pas changé — attacher du charabia est pire que refuser,
    parce qu'un modèle y répond avec une parfaite assurance — c'est la décision qui se prend
    désormais sur le RÉSULTAT et non sur l'extension du fichier.*
  - ⚠️ Les noms de fichiers ne sont plus jugés : « Création d'un client.docx » devient un identifiant
    utilisable, et le **titre garde l'original**, qui est ce qu'on reconnaît dans l'index.

### Précisé

- `hiveyCode.knowledge.folders` et `hiveyCode.ibmi.writableLibraries` sont des **listes**, modifiables
  par chacun et inscriptibles au niveau du dépôt (`.vscode/settings.json`, versionné) comme au niveau
  de l'utilisateur. Plusieurs chemins, plusieurs bibliothèques : c'était déjà le cas depuis la
  0.60.0, et la documentation le dit maintenant.

- Le commentaire de `isTextLike` disait que `.docx` et `.pdf` ne sont pas lisibles « faute d'un
  analyseur que ce projet ne livre pas ». Ce n'est plus vrai de la base de connaissance ; cela reste
  vrai d'un **collage**, qui n'a nulle part où poser la question à laquelle ces extracteurs répondent
  — est-ce le document, ou est-ce du bruit ?

## 0.60.0 — 2026-10-01

### Ajouté

- **`hiveyCode.ibmi.writableLibraries` — la production devient inatteignable.** La demande n'était
  pas une fonctionnalité mais une condition : « les agents ne doivent jamais interagir avec la
  prod ». Une condition pareille ne peut pas vivre dans un prompt — un prompt est une requête faite
  à un modèle, et un modèle qui la lit de travers est le cas ordinaire. C'est donc une **barrière
  dans le code**, du même genre que l'outillage du mode Plan.

  Quand la liste est renseignée (`["TSTCFC", "DEVCFC"]`), toute commande CL ou instruction SQL qui
  **modifie** quelque chose doit nommer sa bibliothèque, et chacune doit y figurer. Trois rigueurs
  assumées, parce qu'être souple aux trois endroits reviendrait à deviner : ⚠️ **inconnu = écrivain**
  (un verbe CL absent de la courte liste des lecteurs compte comme modifiant — se tromper ainsi coûte
  un refus qu'on lève, se tromper dans l'autre sens coûte un fichier de production) ; ⚠️ **non
  qualifié = refusé** (`DLTOBJ OBJ(CUSTMAST)` se résout sur la liste de bibliothèques du travail, qui
  n'est pas connaissable ici) ; ⚠️ **toutes** les bibliothèques nommées comptent, pas la première
  (`CPYF FROMFILE(PRDCFC/…) TOFILE(TSTCFC/…)` touche la production). La lecture n'est jamais
  restreinte. Vide par défaut : un défaut serait les noms d'une entreprise livrés à toutes les
  autres.

- **`hiveyCode.knowledge.folders` — de la documentation interne depuis n'importe quel chemin.** Un
  partage réseau, un wiki récupéré. ⚠️ Ces dossiers sont lus **tels quels** : pas de
  `.hiveycode/knowledge` en dessous, et **pas d'en-tête `title:` exigé** — une documentation interne
  est du Markdown ordinaire, et personne ne va ajouter un en-tête à quatre cents pages de wiki. Le
  titre vient du premier titre de niveau 1, sinon du nom de fichier. Le format strict reste là où il
  se mérite : les bases que l'extension **écrit**, où l'en-tête est un contrat. ⚠️⚠️ **Lecture
  seule** : `/remember` n'y écrit jamais et retirer une note n'en sort jamais une de là — la
  documentation d'une équipe n'est pas un brouillon qu'un agent modifie. Un test d'intégration le
  vérifie en lisant le dossier après coup.

### Corrigé

- **Toutes les bibliothèques n'étaient pas proposées.** Les deux catalogues interrogés étaient
  traités comme des **alternatives** (`if (added) break`) alors qu'ils sont **complémentaires** :
  `OBJECT_STATISTICS` porte les descriptions et dépend des droits objet, `SYSSCHEMAS` liste ce que
  SQL voit. Le premier qui répondait décidait donc de toute la liste, et les bibliothèques que seul
  l'autre connaissait n'étaient jamais offertes. Les deux sont désormais fusionnés.

### Non fait, et pourquoi

- **Piloter le 5250 de Code for i.** Écrire dans le terminal est possible, **lire l'écran ne l'est
  pas** — une session 5250 n'a pas d'intégration shell, donc rien ne permet de savoir ce qui
  s'affiche. Piloter un écran vert à l'aveugle, c'est taper des touches en espérant. Pour « créer un
  client en suivant la procédure », la voie est `ibmi_command` (CALL du programme) ou `ibmi_sql` :
  scriptable, vérifiable, et soumis à la barrière ci-dessus.

## 0.59.0 — 2026-10-01

### Corrigé

- **Une pièce jointe au nom long ne pouvait plus être retirée du contexte.** La croix était poussée
  hors d'une boîte en `overflow: hidden` : présente dans le DOM, absente de l'écran. Deux causes.
  Le nom était en `flex: 0 0 auto` — il ne pouvait pas rétrécir du tout — alors que seul le dossier
  avait le droit de céder ; il cède maintenant **en dernier**, le dossier mille fois plus volontiers,
  et ce qui ne cède jamais est la croix. Et surtout, la note d'extrait ajoutée en 0.50.0
  — « (outline of 211 symbols + head, 16 000 of 48 177 tokens) » — était **collée au nom** : elle
  décrit ce qui a été fait au fichier, pas son identité, et elle vit désormais dans l'infobulle.

### Modifié

- **Le résumé automatique disparaît ; l'offre reste.** La bascule « Summarise automatically » est
  retirée du menu du budget de contexte, avec le réglage et la compaction silencieuse qui allaient
  avec. Ce qui reste est le résumé **manuel** et l'offre dans la conversation, qui apparaît
  désormais à **70 %** du budget plutôt qu'aux deux tiers : une proposition ne vaut d'être faite que
  lorsqu'elle est presque nécessaire, et une bannière qui arrive tôt apprend à fermer les bannières.

- **Orthographe anglaise unifiée sur l'américain**, qui est celle de VS Code : `summarize`,
  `pseudonymize`, `behavior`, `color`, `center`, `license` et leur famille — 76 fichiers, le code,
  les tests, les scripts, les textes d'interface et le README. ⚠️ Ce n'étaient pas des fautes mais
  de l'anglais britannique, cohérent d'un bout à l'autre ; l'uniformiser sur la convention de
  l'éditeur est néanmoins le bon choix pour une extension VS Code. Les **valeurs françaises** de la
  table de traduction n'ont pas été touchées — `mise`, `utilise`, `reprise` y sont français — seules
  les **clés** ont suivi leur source, ce que les deux tests i18n prouvent ligne par ligne. Le
  CHANGELOG est laissé tel quel : c'est un registre de ce qui a été écrit, pas un texte courant.

### Ajouté

- **`/compile`** — compiler un membre et corriger ce que dit le compilateur. La plomberie existait
  déjà (`ibmi_command` exécute du CL et cite `CRTBNDRPG` ; `run_command` couvre Maven, Gradle, npm,
  make) : ce qui manquait n'était pas un outil mais **de savoir comment un atelier compile**. La
  compétence fait déduire la commande du type source, lire la directive de compilation en tête du
  membre, reprendre les options de l'objet existant plutôt que de les inventer, puis lire les
  identifiants de message (RNF…, SQL…, CPD…) et ne corriger que ce dont le compilateur s'est plaint.

## 0.58.1 — 2026-10-01

### Corrigé

- **Le compteur de la recherche de membres IBM i restait à 0 pendant toute la recherche.** Il était
  publié **une fois, avant le travail**, et jamais ensuite : avec une seule bibliothèque — le cas
  ordinaire — « BIB — 0 trouvé » s'affichait du premier instant au dernier pendant que des milliers
  de membres étaient lus. Un chiffre qui ne peut pas bouger est pire que pas de chiffre : il se lit
  comme une recherche qui ne trouve rien.

  La notification dit maintenant ce qu'elle **fait** : « BIB — lecture de la liste des membres… »,
  puis « BIB/QRPGLESRC — 1 240 membres lus » au fil du parcours. Des membres **lus**, qui est ce que
  l'on sait pendant qu'on lit ; combien d'entre eux **correspondent** n'est connu qu'après le
  filtrage, et c'est le sélecteur qui le dit dans son propre titre.

  ⚠️ Les deux chemins de lecture n'ont pas la même marge : la requête SQL unique est un aller-retour
  qui ne peut rien annoncer entre-temps, le repli parcourt les fichiers source un par un et a
  quelque chose de vrai à dire à chaque étape. `ibmiAllMembers` rend compte des deux. Et le même
  défaut existait dans la **seconde** recherche de membres — celle des bibliothèques de version —
  corrigé aussi.

## 0.58.0 — 2026-09-30

### Corrigé

- **La passerelle ne pouvait pas être choisie, et affichait « Local » quand on la choisissait.**
  Quatre défauts distincts, tous sur le même chemin, tous passés à travers les tests existants.

  - `providerReady` demandait une **clé avant de regarder l'adresse**. Une passerelle avec une
    adresse et sans clé n'était donc jamais « prête », et le menu du composeur refuse de basculer
    vers ce qui ne l'est pas : il ouvrait l'écran de configuration à la place. Choisir « Votre
    propre passerelle » ne faisait rien, jamais. ⚠️ Cette règle **contredisait `providerFor`**, qui
    autorise explicitement une clé absente pour une passerelle — un proxy sur son propre réseau n'en
    a généralement pas. Un test affirmait même l'ancien comportement.
  - **La puce affichait « Local ».** En 0.55.0 j'ai réutilisé `state.remote` — qui voulait dire
    « ça quitte la machine » — pour dire « ça coûte de l'argent ». Une passerelle ne facture rien,
    donc l'étiquette la déclarait locale quel que soit le fournisseur choisi. Les deux faits sont
    séparés à nouveau : `remote` pour l'endroit, `billed` pour l'argent.
  - **La liste n'était pas reconstruite** quand le fournisseur ou une adresse changeait, alors que
    ce qu'elle a le droit d'offrir en dépend. On basculait sur la passerelle et le sélecteur
    continuait d'afficher les 457 lignes calculées quand le fournisseur local était sélectionné.
  - **Les modèles de la passerelle étaient avalés** par la déduplication : un proxy servant les
    mêmes noms qu'un Ollama local ne produisait aucune ligne. Ce sont deux destinations — une autre
    machine, une autre facture, une autre fenêtre — donc deux lignes.

- **L'écran Modèles a sa propre section « Sur votre passerelle »**, comme le sélecteur l'avait déjà.
  Les deux ne s'accordaient pas : une passerelle interne étant en loopback, ses modèles tombaient
  dans « Sur votre machine » et ressemblaient à des doublons. ⚠️ C'est exactement pourquoi cela
  paraissait correct à un endroit et faux à l'autre.

- **Sur la passerelle, le catalogue OpenRouter disparaît même si une clé OpenRouter existe.** Qui
  travaille par son proxy choisit entre les trois ou quatre modèles qu'il sert ; 457 lignes ne sont
  pas une liste plus longue pour lui, c'est la raison pour laquelle il ne trouve pas la courte.

### Ajouté

- Une **capture d'écran permanente** de la passerelle sélectionnée. Quatre versions de ce chemin ont
  été livrées cassées en passant les tests qui existaient ; aucune ne survit à une photographie.

## 0.57.0 — 2026-09-30

### Corrigé

- ⚠️ **Une adresse de passerelle prise pour une clé, déplacée dans le coffre et effacée des
  réglages.** Le détecteur ajouté en 0.48.0 ne se contentait pas des préfixes que les fournisseurs
  publient : il **devinait** aussi — pas de point, pas de barre oblique, vingt-quatre caractères ou
  plus, et sûrement rien d'autre ne ressemble à ça. Un nom d'hôte interne ressemble exactement à ça.
  `llm-gateway-internal-prod-01` était donc déplacé dans le coffre **et supprimé des réglages**,
  automatiquement, à chaque changement de configuration. On ne pouvait alors plus ni choisir sa
  passerelle ni voir ses modèles, et rien à l'écran ne reliait ces deux symptômes à une adresse
  saisie des jours plus tôt.

  Le détecteur ne reconnaît plus une clé **que par un préfixe publié par un fournisseur**. Un faux
  négatif coûte un message confus ; un faux positif détruit un réglage — quand la preuve est une
  supposition, il n'y a pas de preuve. Et les installations déjà touchées sont **réparées au
  démarrage** : une adresse utilisable rangée comme clé de passerelle, alors qu'aucune adresse n'est
  configurée, retourne dans les réglages et vous en êtes informé. Un vrai préfixe de clé n'est
  jamais promu en adresse.

- **« Enregistrer l'adresse » ne choisissait pas la passerelle.** Enregistrer une *clé* changeait de
  fournisseur — « quelqu'un qui colle une clé OpenRouter veut utiliser OpenRouter » — et enregistrer
  une *adresse* ne le faisait pas. Ce qui laissait le seul fournisseur pouvant se passer de clé sans
  aucun moyen d'être sélectionné : on saisissait l'adresse de son proxy, le composeur continuait
  d'afficher « Local », et les modèles servis n'apparaissaient jamais. Uniquement pour un
  fournisseur dont l'adresse n'a pas de valeur par défaut : modifier l'URL d'OpenAI pour un
  déploiement Azure est un changement d'adresse, pas un changement d'avis sur le fournisseur.

## 0.56.0 — 2026-09-30

### Ajouté

- **Les modèles de vos propres serveurs se synchronisent tout seuls.** `ollama pull` se fait dans un
  terminal, c'est-à-dire ailleurs — et un modèle ajouté à un proxy interne encore plus. La liste
  était construite une fois au réveil du panneau, puis seulement si quelqu'un appuyait sur
  *Actualiser* : un bouton que personne n'utilise, parce que personne ne sait qu'une liste est
  périmée avant d'avoir cherché en vain ce qu'il vient d'installer.

  Trois moments : **à l'ouverture du sélecteur** (c'est là que ça coûte quelque chose), **au retour
  sur le panneau**, et **toutes les deux minutes** tant qu'il est visible. Seules **vos** sources
  sont interrogées — la machine, le réseau, la passerelle. Les fournisseurs distants sont laissés
  tranquilles : ce sont des appels contre un compte avec une limite de débit, et leurs catalogues
  changent quelques fois par an, pas quelques fois par après-midi.

  Rien n'est rebâti si la réponse n'a pas changé ; quand elle change, la liste est reconstruite
  exactement comme *Actualiser* l'aurait fait. ⚠️ Le **premier** regard est une référence et jamais
  une nouvelle — écrit dans l'autre sens, chaque fenêtre ouverte reconstruisait sa liste pour rien.
  Et l'ordre n'est pas une information : deux serveurs qui répondent dans un ordre différent ne sont
  pas un modèle de plus.

- **Le sélecteur ouvert se redessine** quand la liste arrive. Il capturait l'état de son ouverture,
  donc la réponse à la question qu'il venait lui-même de poser ne changeait rien sous lui : le
  modèle fraîchement installé n'apparaissait qu'à la deuxième ouverture. Le texte de recherche et le
  curseur ne sont pas touchés — seules les lignes sont redessinées.

## 0.55.0 — 2026-09-30

### Modifié

- **Le sélecteur n'offre plus que ce que vous pouvez atteindre.** Il portait ses 457 lignes de
  catalogue quelle que soit votre configuration — or **toutes passent par OpenRouter**, comme les
  trois préréglages Hivey qui sont un routage sur le même catalogue. Sans clé là-bas, ce ne sont pas
  des choix : c'est une vitrine. Utile à qui n'a encore rien configuré, et du bruit pour qui accède
  à ses modèles par une passerelle privée qui en sert trois.

  La règle porte sur l'**atteignabilité**, pas sur les passerelles : dès que vous avez configuré une
  source à vous — une passerelle, ou un fournisseur dont vous détenez la clé — et pas de clé
  OpenRouter, le catalogue disparaît. ⚠️ Un modèle **local découvert ne compte pas** : quelqu'un qui
  a seulement Ollama n'a pas choisi d'où viennent ses modèles distants, et lui cacher le catalogue
  retirerait la seule chose qui dit ce qu'une connexion apporterait. Le modèle sélectionné n'est
  jamais retiré, quoi qu'il arrive.

- **Les modèles de la passerelle sont groupés avec votre infrastructure**, sous « Sur votre
  passerelle », juste après votre machine et votre réseau — au lieu d'être classés à la lettre « g »
  entre DeepSeek et Google. ⚠️ Le classement ne pouvait pas se faire sur « est-ce distant ? » : une
  passerelle interne est en loopback ou sur un réseau privé, donc marquée locale.

- **Un nom tapé dans la recherche est proposé sur la passerelle** quand rien ne lui correspond. Une
  passerelle n'est pas un catalogue : elle sert ce qu'on lui a donné, et `/models` est facultatif
  dans l'API OpenAI. Il n'y avait alors aucune ligne à choisir et aucun moyen de nommer un modèle
  hors de `settings.json`.

- **Plus de carte d'estimation quand rien n'est facturé.** Elle s'ouvrait à chaque tour, y compris
  local, pour annoncer « sur votre machine, rien n'est facturé » — et attendre un clic. Une question
  dont la réponse est toujours zéro n'est pas une question, c'est une étape. Elle est désormais
  réservée aux fournisseurs qui facturent : vos clés et OpenRouter. La passerelle en est exemptée
  pour la même raison qu'elle n'a pas de prix dans le sélecteur — c'est votre proxy, et cette
  extension n'a pas sa grille tarifaire.

  ⚠️ La règle porte sur le **fournisseur choisi**, pas sur l'adresse. La version « prudente » qui
  regardait aussi l'adresse rendait la carte **intestable** — tous les stubs de la suite écoutent en
  loopback — et c'est précisément ainsi qu'était née la carte d'approbation que personne ne voyait.

## 0.54.0 — 2026-09-30

### Corrigé

- **Le modèle réfléchissait et ne répondait pas, surtout en mode Plan.** La boucle d'agent
  **jetait** la raison d'arrêt du fournisseur : une réponse coupée par la limite de sortie et une
  réponse terminée étaient indiscernables. Or un modèle qui raisonne paie sa réflexion **sur le même
  budget de sortie que sa réponse** — avec un `max_tokens` de 4 096 écrit en dur, une longue
  réflexion consommait tout et le tour se terminait sur un bloc de raisonnement complet et pas un
  mot de réponse. Le mode Plan le sentait en premier : c'est celui qui demande d'enquêter avant
  d'écrire.

  - La troncature remonte jusqu'à l'appelant (`TurnResult.truncated`).
  - Le budget de sortie devient un réglage, **`hiveyCode.chat.maxOutputTokens`, défaut 8 192**.
  - Quand il ne reste **rien** à montrer, la requête est **rejouée une fois avec quatre fois la
    place**, et c'est dit. Une réponse tronquée mais lisible est laissée telle quelle : elle est
    imparfaite et elle est à vous, redemander la ferait payer deux fois.
  - Si elle reste vide, la conversation le dit en toutes lettres et nomme le réglage à augmenter.

- **Mode Plan jamais couvert par un test.** Il change le prompt système **et tout l'outillage**, et
  aucun test n'y jouait un tour — parce qu'il n'y avait aucun moyen d'y entrer hors du menu du
  composeur. Nouvelle commande **`hiveyCode.setMode`** (palette et raccourci : *Hivey Code : changer
  de mode*), et deux gardes : un tour de bout en bout en mode Plan, et **une capture d'écran** du
  résultat — l'export prouve que la réponse a atteint la conversation, seule l'image prouve qu'elle
  a atteint l'écran, et ce sont deux affirmations différentes.

- **« No endpoint configured for openai-compatible ».** La phrase nommait un préfixe et non une clé,
  et ignorait l'écran de configuration du panneau qui a un champ pour exactement ça. C'est pourtant
  le seul fournisseur sans adresse par défaut — c'est la passerelle de quelqu'un, personne ne peut
  deviner où elle vit — donc ce message est toute l'instruction que son utilisateur reçoit. Il nomme
  désormais le réglage exact, renvoie vers *Hivey Code : configurer un modèle*, et précise qu'**une
  clé est facultative** pour une passerelle. Deux tests neufs : une passerelle répond dès que son
  adresse est posée, sans clé ; et le message nomme un réglage qui existe dans le manifeste.

## 0.53.0 — 2026-09-30

### Corrigé

- **La zone de saisie se « verrouillait » en cours de frappe.** Le panneau se reconstruit à chaque
  message d'état — une soixantaine, dont presque aucun n'est provoqué par l'utilisateur : un fichier
  enregistré, le curseur qui bouge dans un éditeur, une liste de modèles qui arrive. Chaque
  reconstruction remplace la zone de texte, donc **le focus partait avec l'ancienne**. Le texte et
  la position du curseur étaient bien reportés ; le focus, non. Taper une question était donc
  interrompu par une boîte qui devenait sourde sous les doigts, « comme si on cliquait à côté » —
  ce qui est exactement ce qui se passait. Le focus est reporté lui aussi, et **seulement s'il y
  était** : le rendre sans condition arracherait le curseur au fichier en cours d'édition, ce qui
  est le même défaut dans l'autre sens.

- **HTTP 402 « payment required » avec une clé valide et du crédit.** OpenRouter répond 402 pour
  deux choses sans rapport : le solde, et son **budget de dépense « en vol »** — du crédit
  provisoirement réservé par des requêtes qui n'ont pas fini. Leur documentation est explicite : le
  second cas s'attend et se rejoue, et se reconnaît à un en-tête `Retry-After`. Tout le code
  traitait le 402 comme définitif et l'annonçait dans une phrase sur le solde du compte. Un compte
  approvisionné s'entendait donc dire qu'il était vide, sans qu'aucune tentative ne soit faite. Le
  402 avec en-tête est désormais attendu puis rejoué (deux fois, jamais plus de trente secondes,
  interrompu par l'arrêt du tour) ; celui sans en-tête n'est pas rejoué, parce qu'aucune tentative
  ne remplit un compte. Les deux messages ne disent plus la même chose.

- **Le sélecteur de modèles ignorait la place qu'on lui donnait.** Sa largeur était calculée depuis
  le bouton qui l'ouvre — un petit contrôle — donc le plancher de 320 px gagnait toujours : chaque
  nom de modèle tronqué au même endroit, et une rangée de trois boutons qui ne tenait pas sur une
  ligne et dont le dernier était coupé en deux par le `overflow: hidden` du widget. Il prend la
  largeur du panneau, et la rangée passe à la ligne.

### Modifié

- **Le raisonnement s'affiche pendant qu'il s'écrit, et se replie quand la réponse commence.** Il
  était replié par défaut, et les deux moitiés du problème n'en faisaient qu'une : un bloc replié ne
  **grandit pas**, donc pendant toute la réflexion le panneau n'avait rien à suivre et restait sur
  la réponse précédente. C'est une propriété du **tour**, pas une préférence du lecteur — la bonne
  réponse change à mi-chemin, toute seule — donc il n'y a pas de réglage.

- **Captures d'écran refaites.** Le panneau est dans la **barre latérale droite**, élargi, la barre
  latérale gauche et le terminal fermés, la barre de titre et la barre d'état recadrées : le sujet
  d'une image de panneau latéral, c'est le panneau. Les anciennes portaient sept cents pixels
  d'éditeur et la sortie de la dernière commande en échec de la machine de build. La conversation
  repart aussi de zéro après la capture de la carte d'autorisation, dont le refus laissait une ligne
  rouge en arrière-plan de toutes les images suivantes.

- **README et README.fr à jour** : le contexte à la taille du modèle, le plan d'un gros fichier
  joint, un fichier envoyé une seule fois, et le comportement du raisonnement.

## 0.52.0 — 2026-09-25

### Corrigé

- **Un document joint n'était lu que sur ses deux cents premières lignes.** Il n'y avait aucune
  limite de lignes nulle part : il y avait **huit constantes de jetons différentes**, une par chemin
  — 3 000 pour le fichier à l'écran, 6 000 pour le même fichier joint à la main, 2 000 pour une
  sélection, 4 000 pour une mention, 8 000 pour un collage, plus trois autres pour les membres
  source IBM i et le diff d'un message de commit. Toutes choisies quand le budget de contexte valait
  8 000 jetons à plat, et **aucune n'a bougé** quand le budget s'est mis à suivre la fenêtre du
  modèle. 3 000 jetons, c'est environ **214 lignes de prose**.

  Le plus trompeur : c'est le fichier **ouvert devant vous** qui avait la plus petite part — celui
  dont on est le moins conscient et dont la question parle le plus souvent — pendant que le même
  fichier joint explicitement passait presque entier.

  Tout passe désormais par un seul point, `attachmentTokens()`. Sur un modèle courant un document
  joint monte de 3 000 à **16 000 jetons, soit environ 1 140 lignes**, et `0` dans
  `hiveyCode.context.attachmentTokens` envoie les fichiers entiers.

  ⚠️ Un test lit désormais **le source** pour refuser toute nouvelle constante de jetons écrite à un
  point de jonction — c'est là que vivait le défaut : chaque nombre pris isolément était défendable,
  et le défaut était qu'il y en avait huit. Il en a trouvé cinq de plus que ceux cherchés à la main.

- **La fenêtre du modèle retombait à zéro quand la liste des modèles n'était pas chargée**, et le
  budget avec elle, jusqu'à son plancher. La liste est récupérée par fournisseur, échoue en silence
  quand le point d'accès ne répond pas, et est simplement absente pendant les premières secondes de
  chaque fenêtre. Le catalogue généré prend le relais — il connaît la fenêtre de quatre cents
  modèles. Le symptôme n'était pas une erreur : c'était une pièce jointe silencieusement coupée.

## 0.51.0 — 2026-09-15

### Corrigé

- **Le même fichier était renvoyé à chaque tour.** Le fichier à l'écran est rattaché à chaque
  question, et un fichier joint à la main reste dans le compte rendu du tour où il l'a été : une
  conversation de cinq tours sur un module portait donc **cinq copies** de ce module, et
  l'estimation grossissait de sa taille à chaque question. Un fichier identique **octet pour octet**
  n'est désormais envoyé **qu'une fois**, dans le message le plus proche de la question — là où un
  modèle lit le plus fidèlement — et les tours précédents y renvoient en une ligne. Rien n'est
  perdu : chaque tour dit toujours de quel fichier il parlait, et un fichier qui a **changé** entre
  deux tours est envoyé deux fois, parce que ce sont deux choses différentes.

- **Le calibrage des jetons dérivait vers le haut à cause des images.** Il s'apprend d'une paire :
  ce qu'on a estimé pour une requête, contre ce que le fournisseur a compté pour elle. Les images
  manquaient de notre moitié — 1 300 jetons chacune — donc **toute requête portant une capture
  d'écran** enseignait un rapport supérieur à 1 pour une raison étrangère à la tokenisation. Le
  facteur montait vers son plafond de 2,5× et **gonflait toutes les estimations suivantes**, le
  chiffre de la carte de consentement et celui que le plafond de dépense contrôle. Une mesure qui
  compare deux choses différentes enseigne quelque chose, et ce quelque chose est faux.

  Ce qui avait été appris par cette mesure est **jeté** plutôt que moyenné (la clé de stockage
  change de génération) : le porter dix requêtes de plus serait porter l'erreur.

## 0.50.0 — 2026-09-15

### Modifié

- **Un gros fichier joint n'est plus coupé, il est résumé par son plan.** « Un prompt plus deux
  fichiers = 234 k jetons. » Le budget par pièce jointe ne faisait que *couper* : deux fichiers
  vraiment gros passaient donc presque entiers. Et couper est la pire des réponses disponibles — un
  module de 3 000 lignes réduit à ses 400 premières parle au modèle des imports et des deux
  premières fonctions, et **cache l'existence de tout le reste**. Le modèle répond alors sur un
  fichier qu'il croit avoir lu.

  Au-delà de son plafond, un fichier arrive désormais comme **son plan complet** — chaque symbole
  qu'il déclare avec son numéro de ligne, plus ses imports — suivi de son début. C'est une autre
  projection du même fichier, pas une portion : la fin du fichier redevient visible, et pour une
  fraction du prix. Quand le plan lui-même ne tient pas, il est **échantillonné sur toute la
  longueur** (jamais coupé en tête), et le dernier symbole en fait toujours partie.

### Ajouté

- **`hiveyCode.context.attachmentTokens`** — ce qu'une pièce jointe peut prendre au maximum, quel
  que soit le budget de contexte. Défaut **16 000** jetons, soit environ deux mille lignes ; `0`
  retire le plafond et envoie les fichiers entiers. C'est le levier direct sur le coût d'une
  question : le budget de contexte est un plafond sur *la conversation*, et il était lu comme une
  cible pour *chaque fichier*.

  Mesuré sur deux gros fichiers de ce dépôt : 74 193 jetons entiers → **32 027** envoyés avec un
  grand budget, **19 227** avec le budget automatique.

## 0.49.0 — 2026-09-15

### Corrigé

- **Une question et deux fichiers estimés à 468 726 jetons.** Chaque pièce jointe recevait deux
  cinquièmes du budget de contexte, **sans jamais regarder combien il y en avait** : deux fichiers
  réclamaient donc quatre cinquièmes du budget, trois en réclamaient plus que la totalité, et rien
  en aval ne rattrapait ça. Le défaut dormait tant que le budget valait 8 000 jetons — deux
  cinquièmes de 8 000 passent sous l'ancien plancher de 4 000, donc le plancher gagnait toujours —
  et **la 0.46.0 l'a réveillé** en faisant suivre au budget la fenêtre du modèle.

  Il n'y a plus qu'une règle, et elle porte sur **l'ensemble** : tout ce qui est joint prend au plus
  trois cinquièmes du budget, partagés à parts égales. Le plancher par fichier descend à 1 000
  jetons, parce que huit fichiers à mille jetons valent mieux que deux fichiers à quatre mille.

- **Trois mentions n'avaient aucune limite.** `@changes` envoyait le diff non commité **entier** —
  un fichier généré, un fichier de verrouillage, un premier commit, et c'est la requête tout
  entière ; `@problems` envoyait tous les diagnostics d'un projet en pleine refonte ; `@codebase`
  envoyait la carte sans tenir compte du reste. Les trois sont coupées comme tout le reste.

- **La question posée pouvait être jetée de sa propre requête.** Une entrée plus grosse que le
  budget échouait au même test qu'une vieille entrée et était écartée : une question portant une
  pièce jointe surdimensionnée disparaissait donc de la requête qu'on venait de taper, et le modèle
  répondait à ce qui restait. La dernière entrée n'est plus jamais écartée — elle est **coupée par
  la fin**, là où se trouvent les pièces jointes, jamais la phrase à laquelle il faut répondre.

### Ajouté

- **La carte d'estimation dit où vont les jetons.** Un seul grand nombre n'est pas un fait sur
  lequel agir : « 468 726 jetons pour un message et deux fichiers » était une anomalie, et rien sur
  la carte ne disait lequel des deux fichiers, ni même si c'étaient les fichiers. Les trois plus
  gros postes sont nommés avec leur taille, dès qu'ils pèsent au moins un dixième de la requête.

## 0.48.0 — 2026-09-15

### Corrigé

- **Une clé d'API collée dans le réglage d'adresse — et le pire message que ce produit ait produit.**

      L'adresse configurée pour « openrouter » n'a pas de schéma : « sk-or-v1-… ».
      Elle devrait être « https://sk-or-v1-… ».

  Ce message n'est pas seulement inutile : il est affirmatif, il est faux, et **il dit au lecteur
  d'aggraver le réglage**. C'était la dernière chose lue avant de conclure que l'extension ne
  marchait pas. La cause est structurelle : les clés vivent dans le coffre de l'éditeur — c'est la
  bonne décision — donc l'éditeur de réglages n'affiche **qu'une seule case portant le nom du
  fournisseur**, et c'est l'adresse. On y colle sa clé, et plus rien ne fonctionne.

  - Une clé est **reconnue comme telle**, à partir des préfixes que la table des fournisseurs
    publie déjà (`sk-or-v1-`, `sk-ant-`, `AIza`, `gsk_`, `xai-`, `pplx-`) — pas d'une liste écrite
    une deuxième fois. Le contrôle reste prudent : tout ce qui contient un point, une barre oblique
    ou un deux-points peut être une adresse et n'est pas touché.
  - Elle est **rangée toute seule** dans le coffre, et l'adresse revient à celle du fournisseur.
    Sans demander : quelqu'un qui tape une clé dans une case a déjà dit ce qu'il voulait. C'est
    aussi strictement plus sûr — la valeur quitte `settings.json`, qui est en clair, synchronisé
    entre machines et parfois versionné. Annoncé après coup, jamais journalisé.
  - Même geste dans le panneau : une clé collée dans le champ d'adresse d'une passerelle est
    enregistrée comme clé.
  - Les réglages `hiveyCode.endpoints.*` disent désormais **« ceci est une adresse, pas votre
    clé »**, et où va la clé.

- **Un serveur de votre réseau n'exige plus qu'on tape le schéma.** `192.168.1.50:11434/v1` était
  refusé ; il est complété, comme partout ailleurs dans le produit.

## 0.47.0 — 2026-09-15

### Corrigé

- **Une question difficile posée en français était envoyée au modèle bon marché.** Les préréglages
  Hivey choisissent le modèle selon la difficulté de la question : « difficile » va au modèle fort,
  le reste au modèle courant. Les motifs qui décident étaient écrits **en anglais uniquement** —
  `why does`, `race condition`, `security review`, `memory leak`. Donc « pourquoi est-ce que ça
  plante », « condition de course », « revue de sécurité », « fuite mémoire » étaient classés comme
  des tours ordinaires. Le routage était sûr de lui sur une question qu'il n'avait pas comprise, et
  le seul symptôme visible était que les réponses étaient plus vagues que ce que le préréglage
  promettait. Les motifs existent désormais dans les deux langues, et deux tests apparient les
  formulations pour que l'ajout d'un signal dans une seule langue casse la suite.

  ⚠️ Au passage : `\b` ne marque pas de frontière de mot après un « é » en JavaScript, les
  caractères accentués n'étant pas des caractères de mot. `revue de sécurité\b` ne pouvait pas
  correspondre. Les motifs français utilisent des limites Unicode.

- **La carte du dépôt était hiérarchisée en partie par de la prose française.** Le classement des
  fichiers se fait sur les mots de la question, en écartant une liste de mots vides — **anglaise
  uniquement**. « Peux-tu corriger l'erreur dans ce fichier » apportait donc `corriger`, `erreur` et
  `fichier` comme s'ils nommaient quelque chose. Ce classement décide ce que le modèle lit **en
  premier**, c'est-à-dire la qualité de la réponse quand le budget s'épuise. La liste française est
  ajoutée ; un identifiant nommé dans une question française reste prioritaire.

## 0.46.0 — 2026-09-15

### Corrigé

- **Le budget de contexte de 8 000 jetons faisait répondre à partir d'un résumé.** Ce nombre datait
  de l'époque où le seul modèle joignable tournait sur le portable de l'utilisateur ; les modèles
  vers lesquels le produit route ont des fenêtres de 200 000 à 1 000 000. L'offre de résumé se
  déclenche aux deux tiers du budget, donc une conversation était remplacée par un digest d'elle-même
  **au bout de deux ou trois échanges** — à partir de là le modèle ne raisonnait plus sur ce qui
  avait été dit mais sur un résumé, et les réponses se dégradaient sans que rien ne l'explique.
  « En 3 messages j'ai atteint presque tout le contexte. »

  Le budget est désormais **déduit de la fenêtre du modèle réellement choisi** : 40 % de celle-ci,
  entre 8 000 et 32 000 jetons. Le chiffre de l'utilisateur l'emporte dès qu'il en a posé un, et le
  menu sous l'anneau de contexte propose « Automatique » en tête. Trois bornes rendent la déduction
  sûre : un plancher (un modèle dont la fenêtre est inconnue se comporte comme avant), un plafond
  (le budget est aussi ce que le plafond de dépense mesure), et une fraction bien inférieure à 1 (la
  fenêtre doit contenir la réponse, et en mode agent les résultats d'outils de chaque étape).

  La carte du dépôt est plafonnée à 12 000 jetons indépendamment : elle vit dans le préfixe
  cacheable, donc chacun de ses jetons est payé à chaque tour, et au-delà de quelques milliers une
  liste de chemins cesse d'être du savoir pour devenir de la paille. Les pièces jointes, elles,
  suivent le budget : un fichier attaché n'est plus coupé à la part de l'ancien plancher.

- **La carte du dépôt survivait au dépôt qu'elle décrit.** Gelée pour la durée de la conversation —
  ce qui est juste, une re-hiérarchisation à chaque changement d'onglet réécrit le préfixe pour
  rien — elle ne repartait jamais. En mode agent, l'agent **crée des fichiers lui-même**, puis
  continuait à raisonner sur un dépôt où ils n'existaient pas. Elle est maintenant reconstruite quand
  un fichier apparaît ou disparaît ; une sauvegarde ne la reconstruit pas.

- **Une erreur survenue en traitant une action du panneau** (joindre un fichier, changer de modèle,
  restaurer un point de reprise) était postée puis détruite au rendu suivant, comme l'était celle du
  tour. Elle est écrite dans la conversation.

### Ajouté

- **« Pour cette conversation » sur la carte de dépassement de budget.** Un plafond est une habitude,
  un chantier est une exception : personne ne devrait avoir à répondre à la même question à chaque
  tour, ni à déplacer durablement une limite choisie exprès. L'exception est gardée en mémoire et
  disparaît avec la conversation. Les quatre choix sont désormais *Envoyer quand même*, *Pour cette
  conversation*, *Relever le plafond*, *Ne pas envoyer*.

## 0.45.0 — 2026-09-15

### Corrigé

- **Le plafond de dépense tuait le tour en silence, et c'est ce qui donnait une extension qui « ne
  fait plus rien ».** Le plafond est vérifié avant l'envoi, sur une estimation qui compte tout le
  prompt au prix d'entrée plus un quart au prix de sortie — environ 34 $ le million de jetons sur un
  modèle haut de gamme. Personne n'avait posé la multiplication contre le catalogue : avec le
  plafond journalier livré de **2 $**, un tour d'agent ordinaire sur le modèle vers lequel le
  préréglage *Hivey Smart* route coûte ≈ 0,22 $, donc **la huitième question de la journée était
  refusée, et toutes les suivantes jusqu'à minuit**.

  Le refus se faisait en postant un message. Le panneau consomme les messages et les redessine : la
  ligne rouge apparaissait une fraction de seconde et disparaissait. Pas de réponse, pas de carte,
  un contexte qui se remplit de questions que personne n'a traitées, et **aucun mot « budget » nulle
  part**. La dépense du jour et son plafond étaient envoyés au panneau depuis le début et **dessinés
  nulle part**.

  Trois changements, et il faut les trois :

  - **Dépasser un plafond ouvre une carte** dans la conversation — *Envoyer quand même / Relever le
    plafond / Ne pas envoyer* — au lieu de terminer le tour. « Relever le plafond » place la limite
    au-dessus de cette requête et envoie. Un refus, quand il arrive, est **écrit dans la
    conversation** : il survit au rendu suivant et se retrouve dans l'export.
  - **Les plafonds livrés passent de 0,25 $ à 2 $ par requête et de 2 $ à 20 $ par jour.** Un tour
    ordinaire passe sur tous les modèles vers lesquels le produit route ; un prompt emballé de
    400 000 jetons est toujours arrêté. Deux tests le vérifient contre le catalogue généré, donc ils
    se déclencheront si un vendeur change ses prix.
  - **La dépense du jour s'affiche** à côté de l'anneau de contexte dès qu'elle approche du plafond,
    en couleur d'avertissement puis d'erreur. Ce qui peut interrompre l'utilisateur doit être
    lisible avant de le faire.

- **Une erreur survenue avant le contact du modèle ne laissait aucune trace.** Elle n'était
  enregistrée que si une réponse vide existait déjà, c'est-à-dire seulement une fois le modèle
  contacté. Tout ce qui échouait avant — adresse invalide, clé absente, requête refusée, assemblage
  du prompt — était posté puis détruit au rendu suivant. L'erreur est désormais toujours écrite dans
  la conversation, apparaît dans l'export (`> Échec : …`) et déclenche une notification unique avec
  *Ouvrir le journal*.

### Modifié

- `estimateCost` quitte `src/extension/chat.ts` pour `src/core/router/pricing.ts`. Une formule qui
  décide si le produit répond doit être atteignable par un test qui n'a pas besoin de VS Code.

## 0.44.0 — 2026-09-15

### Corrigé

- **La régression qui cassait tout depuis la 0.41.0, trouvée en comparant la requête réellement
  envoyée.** « Je pose une question, pas de réponse, mais les jetons sont utilisés », quatre fois de
  suite, et mes trois corrections précédentes portaient sur de vrais défauts qui n'étaient pas
  celui-là. La bonne méthode était celle qu'on m'a indiquée : regarder ce qui avait changé.

  Le client a été lancé contre un serveur qui enregistre le corps de la requête, à la version qui
  marchait puis à la version actuelle, et les deux ont été comparés. **Une seule différence** : deux
  messages dont le `content` était passé d'une chaîne à un tableau de parties. C'est le marquage du
  cache de prompt d'Anthropic, ajouté en 0.41.0 et activé pour tout le monde — le marqueur ne peut se
  placer que sur une partie de contenu, donc la demander change la forme de la requête. Quelque part
  derrière OpenRouter, cette forme produisait une complétion **vide**, facturée, sans la moindre
  erreur : l'extension paraissait simplement avoir cessé de fonctionner.

  Le marquage devient une option, `hiveyCode.chat.promptCache`, **désactivée par défaut**. La requête
  par défaut est de nouveau identique — à l'octet près, vérifié — à celle de la version qui
  fonctionnait. Le gain reste réel et reste disponible ; ce qui ne reste pas, c'est qu'il soit activé
  pour tout le monde sans que personne ait pu le vérifier.

  **Le test qui manquait est ajouté** : par défaut, le contenu de chaque message doit être une
  chaîne, chez tous les fournisseurs. Rien de tout cela ne se voyait en relisant le code ; ce qui l'a
  rendu visible, c'est d'enregistrer ce qui part réellement et de le diffuser contre la version
  d'avant. Ce test est ce diff, conservé.

## 0.43.0 — 2026-09-15

### Ajouté

- **Reposer une question.** Un bouton sur n'importe quel message de la conversation, distinct de
  « modifier et renvoyer » : la raison la plus courante de vouloir une autre réponse est que la
  première était mauvaise, pas que la question l'était. La réponse **s'ajoute en dessous** plutôt que
  de remplacer : celle qui ne convenait pas est justement celle à laquelle on veut comparer la
  nouvelle, et la masquer ou la supprimer est déjà à un clic. La question repart avec **les pièces
  jointes qu'elle avait**, pas avec ce qui est joint maintenant — la même question posée sur un autre
  contexte n'est pas la même question.

- **Faire répondre plusieurs modèles à la même question.** Trois choix, chacun un refus de la
  solution évidente. Pas de côte à côte : le panneau fait 300 px une fois ancré, deux colonnes de
  prose y sont une colonne coupée en deux — les réponses arrivent dans la conversation, l'une après
  l'autre, chacune portant le nom du modèle qui l'a écrite. Pas d'outils : la comparaison tourne en
  mode discussion quel que soit le réglage, parce que trois agents qui modifient les mêmes fichiers
  pour répondre à la même question ne sont pas une comparaison mais une collision. Et **le prix est
  dans le sélecteur** : comparer quatre modèles coûte quatre réponses, et une fonction qui dépense
  quatre fois sans le dire est une fonction dont on se méfie ensuite.

  Chaque modèle reçoit **exactement la même entrée** — la question et ses pièces jointes, pas la
  conversation autour. Une comparaison où l'un reçoit le transcript et l'autre le transcript plus la
  réponse du premier n'en est pas une.

## 0.42.0 — 2026-09-15

« Je pose une question, je n'ai pas de réponse… mais les jetons sont utilisés. » Trois corrections
précédentes cherchaient au mauvais endroit. Voici la bonne, et la raison pour laquelle je l'avais
manquée.

### Corrigé

- **Un tour bloqué sur une approbation invisible attendait pour toujours.** En mode agent, chaque
  appel d'outil ouvre une carte demandant la permission — et cette carte n'existait **que** comme un
  message que le panneau avait déjà consommé, dessiné dans le tour en cours. Tout ce qui
  reconstruisait le panneau pendant qu'elle était affichée la détruisait : le curseur qui bouge dans
  un éditeur, un fichier qu'on ouvre, l'agent qui enregistre ce qu'il vient de modifier — tous
  envoient un état. La promesse derrière la carte n'était alors jamais résolue. La requête avait été
  envoyée et payée ; plus rien n'arrivait, sans une erreur pour le dire.

  Les trois sortes de questions — un outil qui demande la permission, le consentement à envoyer, une
  modification à relire — passent maintenant par un seul chemin et **vivent dans l'état**. N'importe
  quelle reconstruction les redessine. C'est la même leçon que pour le transcript, apprise deux fois :
  **ce qui doit survivre à un rendu doit être dans l'état.**

  Prouvé en image, avant et après : sans le correctif, le panneau montre la question, « thinking… »,
  et rien d'autre.

- **Le tour en cours n'était conservé que pendant qu'une réponse s'écrivait.** Il existe dès le
  début du tour, et la première chose qu'il peut porter est justement une question. Lier sa survie à
  l'existence d'une réponse le détruisait exactement pendant la fenêtre où le tour attendait
  l'autorisation de commencer.

### Modifié

- **« En attente » n'est plus affiché comme « au travail ».** Un tour bloqué sur une question
  ressemblait trait pour trait à un tour qui réfléchit. La ligne sous la zone de saisie le dit
  désormais.

- **Le banc de captures photographie un tour qui attend.** Rien dans la suite ne regardait jamais un
  tour bloqué, ce qui est précisément pourquoi ce défaut a survécu à trois corrections.

## 0.41.2 — 2026-09-14

« Plus de message d'erreur, mais il ne fait plus rien — ni raisonnement ni réponse — et le nombre de
jetons semble exploser. » Deux défauts que j'ai introduits moi-même, et qui se cachaient l'un
l'autre : le premier rendait le second invisible.

### Corrigé

- **Le panneau cessait d'être dessiné pendant toute la durée d'un tour.** En 0.40, pour empêcher un
  message d'état de détruire la réponse en cours, j'ai gelé **tout** le transcript tant qu'un tour
  tournait. Cela corrigeait le défilement et introduisait bien pire : pendant un tour, plus rien
  n'était dessiné depuis l'état — ni réponse, ni étape, **ni erreur**. Si quoi que ce soit laissait
  le panneau croire qu'un tour tournait encore, il devenait muet et le restait, sans un mot pour
  dire pourquoi, avec un compteur de jetons qui montait derrière.

  Le transcript est de nouveau reconstruit à chaque fois. Le seul nœud qui ne peut pas l'être — le
  tour en cours, qui porte l'état de l'animation de frappe — est **transporté** dans le nouvel arbre,
  et la réponse qu'il écrit est désormais explicitement marquée dans l'état pour que le transcript la
  lui laisse. Rien n'est dessiné deux fois, et rien ne peut plus figer l'affichage.

- **`grep` qui ne trouve rien déclenchait une escalade payante.** Un code de retour non nul n'est pas
  un échec : c'est ainsi que la moitié du shell répond « non ». `grep` sort en 1 quand il ne trouve
  rien, `git diff --quiet` sort en 1 quand il y a des changements, `test -f` et `which` répondent par
  un statut — et un agent explore avec exactement ces outils-là. Le classifieur d'échec les prenait
  pour la preuve que le travail avait raté et achetait un **second tour complet sur un modèle plus
  cher**, à peu près chaque fois qu'une recherche ne trouvait rien. Invisible, à cause du défaut
  ci-dessus. Le code de retour ne compte désormais que si la commande était plausiblement un
  contrôle — une suite de tests, une compilation, un vérificateur de types, un linter. Une commande
  non reconnue n'est une preuve dans aucun sens.

## 0.41.1 — 2026-09-14

Deux pannes signalées ensemble — « l'extension ne fonctionne plus », « invalid URL », « crédit à
recharger » — et deux causes distinctes, toutes deux capables à elles seules de donner l'impression
que rien ne marche.

### Corrigé

- **Une adresse sans schéma cassait tout, définitivement, avec le pire message possible.**
  `api.openai.com/v1` est ce que montre une page de documentation et ce qu'accepte un navigateur.
  Pour `fetch`, c'est un chemin relatif : la requête échoue sur `Invalid URL`, qui ne nomme aucune
  cause et ne suggère aucune action — à chaque question, pour la durée du réglage, alors que la clé
  est bonne et le compte est bon. L'adresse est désormais **vérifiée là où elle est saisie** (le
  schéma manquant est complété : `https://` en général, `http://` pour une adresse loopback, parce
  qu'aucun serveur de modèles local n'a de certificat) et **revérifiée au point d'usage**, puisqu'un
  réglage peut arriver par `settings.json` ou par synchronisation sans jamais passer par le champ.
  Un schéma qui n'est ni http ni https est refusé plutôt que deviné : `htp://` peut être l'un ou
  l'autre, et choisir au hasard enverrait parfois une clé en clair.

- **Choisir un fournisseur ne faisait rien tant que le modèle était un préréglage Hivey.** Un
  préréglage est un routage sur le catalogue d'OpenRouter, donc `route()` l'envoie à OpenRouter
  **avant même de lire** `chat.provider`. Quelqu'un qui enregistrait une clé OpenAI, sélectionnait
  OpenAI dans le composeur et gardait un préréglage comme modèle voyait « OpenAI » pendant que
  chaque requête partait chez OpenRouter, sur le solde OpenRouter — et quand ce solde s'épuisait,
  l'erreur lui demandait de recharger un compte qu'il n'avait pas choisi d'utiliser. Rien à l'écran
  ne reliait les deux. Le panneau annonce maintenant **où la requête va réellement**, et choisir un
  autre fournisseur sous un préréglage le dit et propose d'aller prendre un de ses modèles.

- **Un 402 n'avait aucune explication.** C'est le solde du compte, pas la clé : ni une nouvelle clé
  ni un nouvel essai n'y changent rien. Le message le dit, et nomme le fournisseur qui a réellement
  répondu — avec un préréglage, ce n'est pas celui que le panneau affiche. Les erreurs
  d'authentification le nomment aussi : « vérifiez la clé d'API » est un conseil inutile à quelqu'un
  qui vient de vérifier la clé d'API du fournisseur qu'il croit utiliser.

## 0.41.0 — 2026-09-11

Une version entièrement sur le coût, partie d'une question : « 43,7 k jetons pour 14,13 $, ça me
semble cher ». Le chiffre n'était pas faux. Ce qui était faux, c'est qu'on payait le plein tarif
pour du texte qui aurait dû venir du cache — et que rien dans le panneau ne permettait de s'en
apercevoir.

### Corrigé

- **Le cache de prompt n'était jamais demandé sur OpenRouter.** Le cache d'Anthropic n'est pas
  automatique : il ne s'applique qu'aux préfixes qu'une requête marque explicitement. Le marqueur
  existait depuis le début et **seul le client Anthropic natif l'émettait**. Donc toute conversation
  Claude passant par OpenRouter — la route payante par défaut, et celle qu'utilisent les préréglages
  Hivey — payait le prix d'entrée plein sur son prompt système, sa carte du dépôt et tout son
  transcript, à **chaque** requête. Le prix de lecture d'un cache est le dixième du prix d'entrée :
  5 $/M contre 0,50 $/M sur Opus 5.
- **Le cache ne couvrait que la partie qui ne grandit pas.** Le préfixe marqué était le prompt
  système et la carte ; tout ce qu'un tour **produit** — les appels d'outils, le fichier lu, la
  sortie de la commande — était renvoyé à l'étape suivante et facturé plein tarif, puis de nouveau à
  l'étape d'après. Le coût d'un tour de douze étapes croissait avec le **carré** de sa longueur. Un
  point de rupture supplémentaire à la fin de chaque requête en fait une droite. Sur un tour de douze
  étapes avec un prompt de 43,7 k, aux tarifs du catalogue : **2,62 $ avant, 0,60 $ après**.
- **Un sous-agent dépensait et rien ne le comptait.** Un sous-agent est un tour complet — jusqu'à
  huit étapes sur un modèle payant — et son coût n'apparaissait ni dans le budget censé pouvoir le
  refuser, ni dans le journal qui prétend contenir chaque requête sortie de la machine, ni dans le
  total affiché. De l'argent partait et rien ne le comptait.
- **Le nombre de jetons affiché ignorait l'élagage.** Le panneau annonçait « ce que la prochaine
  question envoie » en montrant le poids **entier** de la conversation, alors que `build` coupe les
  plus anciens échanges quand le budget est court. Sur une longue conversation, l'écart est
  l'essentiel du nombre.

### Modifié

- **Le prix d'une réponse s'explique.** Un nombre seul est indiscutable et indiagnosticable : « 14,13 $ »
  à côté de « 43,7 k jetons » se lit comme une erreur, et rien ne permettait de découvrir que le
  premier est ce que toute la conversation a dépensé pendant que le second est ce qu'elle pèse
  maintenant. L'infobulle d'une réponse donne désormais ce qu'elle a envoyé, ce qui venait du cache
  et ce qu'elle a reçu ; celle du compteur de jetons dit ce que les deux nombres mesurent.
- **Jamais plus de quatre points de rupture.** Anthropic refuse la requête entière au-delà, et un
  dépôt avec deux compétences chargées plus le point de rupture mobile atteint cinq sans que
  personne ait rien fait d'inhabituel. Les derniers l'emportent : un point de rupture met en cache
  tout ce qui le précède, donc un point tardif absorbe un point précoce.

## 0.40.0 — 2026-09-11

### Corrigé

- **Le panneau suit de nouveau la réponse pendant qu'elle s'écrit, et cesse de remonter tout seul
  dans les anciens messages.** Les deux signalés par l'utilisateur, invisibles pour une suite de
  tests qui ne photographiait que des écrans au repos, et une seule cause de fond : un message
  d'état reconstruit tout le panneau, et les messages d'état arrivent pour des raisons étrangères à
  la conversation — le curseur a bougé dans un éditeur, un fichier a été ouvert, et en mode agent
  l'agent enregistre lui-même des fichiers. Chaque reconstruction détruisait le tour en cours,
  l'animation de frappe et la position de lecture sous une réponse en train d'arriver. Le transcript
  appartient maintenant au tour tant qu'un tour tourne.

  Trois autres choses, chacune suffisant à tuer le suivi à elle seule : le conteneur du tour est plus
  haut que la tolérance qui décide si l'on est « en bas », et il était ajouté avant qu'on pose la
  question ; les positions de défilement étaient appliquées à la frame suivante, et un jeton arrivant
  entre-temps mesurait une position que personne n'avait choisie ; et « laisser le lecteur
  tranquille » était codé comme « ne pas toucher au défilement », ce qui n'est pas la même chose —
  un tour d'agent écrit ses étapes et son plan **au-dessus** de la réponse, donc chaque outil insère
  des lignes au-dessus de la tête du lecteur. C'est cela, le transcript qui remonte tout seul. Il
  s'ancre désormais sur l'élément en haut de la vue et se décale d'exactement ce qui a bougé.

  **L'instrument compte autant que la correction.** Tout ce que le banc de captures photographiait
  était au repos, ce qui est précisément pourquoi deux défauts de comportement **en mouvement** ont
  été livrés deux fois. Il y a maintenant une image prise pendant l'écriture d'une réponse, derrière
  une fixture qui diffuse pendant quarante secondes. Correction retirée, elle montre le panneau posé
  sur la première question de la conversation, bouton de retour au dernier message affiché, pendant
  que la troisième reçoit sa réponse — le rapport de bug, en photo.

### Ajouté

- **Coller ou déposer un élément en contexte.** Une capture d'écran, une trace de pile, un journal,
  un fichier venu de l'explorateur : collé ou déposé sur le composeur et joint à la question. Un
  collage court va toujours dans la zone de saisie, comme partout ailleurs ; un mur de texte devient
  une pièce jointe au lieu d'enterrer ce qu'on est en train d'écrire.

  Les images sont réduites à 1 600 px avant de voyager, et ne partent qu'aux modèles dont le
  catalogue dit qu'ils les lisent — **lu chez le fournisseur, jamais deviné d'après le nom** : `gpt`
  lit les images, `gpt-oss` non, et une heuristique sur les noms est fausse la semaine suivante.
  Quand le modèle choisi ne les lit pas, on vous le dit, au lieu qu'il réponde à propos d'une image
  que personne n'a regardée.

  Ce qu'un `.docx` ou un `.pdf` ne peut pas devenir honnêtement est refusé plutôt que joint en
  charabia : les lire demande un analyseur que ce projet n'embarque pas, et un modèle répond avec
  aplomb à propos du bruit.

  **Une image est la seule donnée que l'anonymisation ne peut pas toucher.** Toute l'architecture de
  confidentialité travaille sur du texte ; une capture d'écran peut porter un bureau entier. La carte
  de consentement le dit en toutes lettres avant le départ, et le journal des sorties enregistre le
  nombre d'images — une ligne « 0 anonymisation » sur un tour qui a envoyé une capture serait vraie
  et trompeuse.

## 0.39.0 — 2026-09-10

Une version sur un seul thème : **fermer la boucle de rétroaction**. L'agent pouvait agir et ne
pouvait pas observer le résultat de ses actions, et presque tout ce qui suit en découle.

### Corrigé

- **La sortie des commandes est lue.** `run_command` renvoyait « demandez à l'utilisateur ce que ça
  a affiché ». Le client terminal capturait depuis toujours ; l'éditeur, non. Donc chaque tour du
  genre « lance les tests et corrige ce qui casse » passait par un aller-retour humain — et le plus
  souvent le modèle sautait l'aller-retour et affirmait une réussite sans preuve. L'intégration
  shell de VS Code rend le flux et le code de retour. Elle n'est pas disponible partout, ce dont
  l'ancien commentaire avait à moitié raison : sur un shell sans intégration, le résultat **dit** que
  la sortie n'a pas pu être lue, et n'invente jamais un code de retour. Les deux branches sont
  testées dans un vrai éditeur.
- **Le graphe d'imports de la carte du dépôt ne s'était jamais déclenché.** Il comparait un
  spécificateur `./helper.js` à une racine de chemin `src/helper` — or dans un projet TypeScript
  ESM tout import finit en `.js` et tout fichier finit en `.ts`. Cette moitié du classement était
  morte depuis le début, sur exactement le genre de dépôt dans lequel l'extension est écrite.
  Trouvée en écrivant le test du classement au second degré, pas en relisant le code.
- **Le cache de prompt était jeté à chaque changement d'onglet.** Tout cache de prompt est touché
  jusqu'au premier octet qui diffère : une ligne du prompt système qui suit l'onglet ouvert ne coûte
  donc pas cette ligne, elle coûte **tout le préfixe**, carte du dépôt comprise. Deux choses s'y
  trouvaient et changeaient — la note de dialecte et la carte elle-même, reclassée autour du fichier
  de devant. Le préfixe est maintenant construit par une fonction qui prend les parties stables
  comme champs nommés, la carte est gelée pour la durée d'une conversation, et un test d'intégration
  compare le premier message de deux requêtes **octet par octet**.
- **Les appels d'outils presque valides ne sont plus refusés.** Un modèle 7 B produit du JSON à peu
  près juste : une clôture markdown autour, une virgule finale, `True` au lieu de `true`, et surtout
  de vrais retours à la ligne dans le `content` d'un `write_file` — parce que c'est ce que contient
  un fichier multi-lignes. La boucle répondait « ce ne sont pas des arguments JSON valides,
  renvoyez l'appel », et un petit modèle renvoie la même chose : trois étapes de budget pour rien.
  Ce qui a une lecture unique est réparé ; ce qui n'en a pas est refusé avec une phrase qui nomme le
  champ fautif. Rien n'est deviné : un `write_file` mal réparé écrit la mauvaise chose sur le disque
  sans jamais signaler d'erreur.
- **Un 429 ne termine plus le tour.** Le préréglage gratuit route vers des points d'accès gratuits
  *parce qu'ils* sont limités en débit, donc c'était le cas ordinaire et il perdait la réponse.

### Ajouté

- **L'escalade se décide sur un échec constaté.** C'était un pari pris sur la formulation de la
  question : une expression régulière décidait que « refactor the architecture » était difficile et
  achetait un appel distant, pendant que « fais passer ce test » restait en local et revenait faux.
  Maintenant le modèle local essaie, les tests ou les diagnostics tranchent, et seul un échec
  **prouvé** achète un appel distant — avec le diff de ce que la tentative a laissé sur le disque et
  l'erreur qu'elle a produite, pour que le second modèle finisse au lieu de recommencer. Qui ne
  rencontre jamais d'échec ne paie jamais rien.

  La subtilité est dans `verifyTurn` : un agent qui lance les tests, les voit échouer, corrige et les
  relance a un échec dans sa trace et un dépôt qui marche. Escalader sur « il y a un échec quelque
  part » paierait un modèle distant pour refaire du travail fini, sur la majorité des tours réussis.
  Ce qui compte est le dernier mot de chaque type de contrôle — plus un motif qu'aucun contrôle
  n'attrape : le même appel, avec les mêmes arguments, qui échoue trois fois de suite.
- **La modification qui suit celle qu'on vient de faire.** La complétion répond « qu'est-ce qui vient
  après le curseur », ce qui est la mauvaise question une fois sur deux : l'essentiel de l'édition
  consiste à propager un changement aux trois autres endroits qui le mentionnent, et ces endroits ne
  sont pas sous le curseur. Après une modification, le modèle de complétion cherche **ailleurs dans
  le fichier** l'édition qui en découle, et la propose en indice avec un correctif rapide. Cent
  frappes deviennent un seul diff avant que le modèle les voie. Chaque proposition est vérifiée
  contre le fichier : un extrait absent, présent deux fois, sur la ligne en cours de frappe, ou qui
  réécrit la moitié du fichier est écarté sans un mot. Activé par défaut sur un point d'accès local,
  désactivé sur un point d'accès payant sauf demande explicite.
- **Un banc d'évaluation.** La CI prouvait que l'extension marche et ne disait rien de la qualité des
  **réponses**. Quinze petits dépôts cassés, une commande par tâche qui décide si le résultat marche
  — une commande et non un diff, pour que deux modèles qui résolvent autrement passent tous les
  deux. Le harnais pilote le vrai client terminal. La règle qui donne un sens aux chiffres tourne à
  chaque commit : **le contrôle de chaque tâche doit échouer sur la version non modifiée**. Elle a
  attrapé une de mes propres tâches au premier essai.
- **Repli automatique entre fournisseurs.** Sur 429, 5xx ou panne réseau : le rôle moins cher du même
  préréglage, puis la machine. Jamais vers plus cher, jamais sur un 400 (la requête est mauvaise,
  l'envoyer ailleurs l'envoie deux fois), jamais après qu'un mot soit arrivé à l'écran, et jamais en
  silence. La moitié qu'aucun assistant hébergé ne peut offrir : quand le réseau tombe, il y a
  généralement déjà un modèle sur la machine.
- **Le journal des sorties est chaîné.** Chaque entrée porte l'empreinte de la précédente : modifier
  une ligne oblige à réécrire toute la queue, et supprimer une ligne du milieu laisse un trou que la
  numérotation trahit. Export JSONL ou syslog RFC 5424, et une commande qui vérifie. Cela ne rend pas
  la falsification impossible, cela la rend visible. À noter ce qui n'est **pas** haché : les données
  qui sortent. L'empreinte d'une adresse e-mail est une adresse e-mail pour qui possède une liste
  d'adresses.
- **Les définitions d'outils MCP sont épinglées.** Le dialogue d'approbation nomme une **commande**,
  or le pouvoir d'un outil sur la conversation est dans sa **description** — le texte que le modèle
  lit pour décider quand l'appeler. Un serveur pouvait servir une description inoffensive le jour de
  l'approbation et une autre une semaine plus tard, sans que rien redemande ; les noms consacrés sont
  *tool poisoning* et *rug pull*. L'approbation porte maintenant sur les descriptions et les schémas,
  et un changement redemande en **nommant** ce qui a changé — un dialogue qui dit seulement « quelque
  chose a changé » apprend aux gens à cliquer « oui ». Les descriptions qui atteignent le modèle sont
  encadrées comme la parole d'un tiers, aplaties et plafonnées.
- **Le `.vsix` publié se vérifie.** Empreinte SHA-256 publiée et attestation de provenance Sigstore
  émise par le workflow, vérifiable avec `gh attestation verify`. La reproductibilité octet pour
  octet n'est **pas** promise et c'est écrit : un `.vsix` est un zip, un zip porte les dates de
  modification. Les outils de construction sont épinglés à une version exacte.
- **`--yes` sur le client terminal**, qui ne répond qu'à la question d'approbation : les globs
  interdits, l'anonymisation et le budget sont en amont et s'appliquent toujours. C'est ce qui permet
  au banc d'évaluation de lancer le vrai client.

### Modifié

- **L'estimation de jetons se calibre.** Il n'y a pas de tokenizer BPE ici, par choix, donc
  l'estimation était une supposition pessimiste tirée des classes de caractères — et un budget
  pessimiste refuse des requêtes qui passaient. Chaque réponse rapporte pourtant le compte du
  fournisseur pour le texte qu'on vient d'estimer. Par modèle, borné, et décroissant vers les mesures
  récentes.
- **La carte du dépôt est classée par la question.** Le signal le plus fort était le seul à ne pas
  être utilisé.
- **La documentation.** Le README annonçait `0.11.1` et « cherchez Hivey Code sur le Marketplace »,
  alors que le manifeste était en `0.38.0` et que rien n'est publié ; la feuille de route était
  restée figée à `0.3.0` pendant trente-cinq versions. Un acheteur lit cela comme « pas maintenu »
  avant d'avoir lu une ligne d'ADR. Corrigé, avec cinq nouvelles décisions écrites
  ([ADR-0009](docs/adr/0009-escalader-sur-un-echec-constate.md) à
  [ADR-0013](docs/adr/0013-lire-la-sortie-du-terminal.md)) et une feuille de route qui distingue
  « testé », « vérifié à la main » et « jamais exécuté dans ses conditions réelles » — cette dernière
  liste n'est pas vide et elle est nommée.

### Prérequis

- **VS Code 1.93** au lieu de 1.90 : l'API d'intégration shell y est stable. Les versions de mi-2024
  ne sont plus visées.

## 0.38.0 — 2026-09-08

### Added

- **Nine providers you can pay directly, instead of one gateway.** OpenRouter is one key for four
  hundred models, and it was the only way in for anyone who was not running a model locally — which
  told everyone already paying OpenAI, Google, DeepSeek, Qwen, Mistral, xAI, Groq or Perplexity that
  this extension did not support them, while the wire format it has always spoken is theirs. Each is
  now a card on the first screen with its own key, its own address, and a link to the console where
  the key is bought; the key goes to the OS keychain like every other, and the address is a setting,
  so a region, a proxy or an Azure deployment is a field rather than a fork. The picker asks each
  configured provider what it serves and lists the answer under **On your own account** — nothing is
  hard-coded, because a model id written by hand answers 404 within weeks of a rename.
- **A request the server can correct.** "OpenAI-compatible" is a family, not a specification: OpenAI
  refuses `max_tokens` on its reasoning models and demands `max_completion_tokens`, refuses any
  temperature but the default on the same models, and some gateways reject a field they do not know
  rather than ignoring it. Each of those is an HTTP 400 that ends the answer. Rather than a table of
  which vendor refuses what — wrong the week a model is renamed — the request goes out as written,
  and when the server names a parameter it will not take, that parameter is dropped or renamed and
  the question asked again. At most twice, and only ever by removing something.

### Changed

- **The list of providers exists once.** It used to exist five times — the manifest's enums, the
  settings reader, the setup screen, the composer's menu, and two command-palette pickers — so a
  provider added in four of them half worked. They now all read one table, and a test fails if the
  manifest and the table disagree. Prices and context windows for a model served by its own vendor
  are read from the catalogue under its bare name, so a budget still applies to it.

## 0.37.0 — 2026-09-07

### Fixed

- **The transcript follows the answer again while it is being written.** It was meant to, and the
  rule was right: stick to the bottom while the reader is at the bottom, never move them once they
  have gone up. What broke it was the typing animation added in 0.35 — the panel asked "is the
  reader at the end?" *after* adding the text rather than before, and a frame that lands a code
  block or a step row moves the end further than the tolerance allows. One frame later the reader
  who had not moved at all counted as "gone up", and the follow stopped for the rest of the answer.
  The measurement is now taken before the change and applied after, on every mutation of a live turn
  — text, steps, plan, errors, approval cards and the final re-render. The other half is unchanged
  and is the point: scroll up to re-read something and nothing pulls you back down.

### Added

- **The button back to the end says an answer is being written.** A reader who has scrolled up loses
  the only sign that the turn is still going — the text growing below. The control they would use to
  go back now carries a ring that breathes while the answer arrives, and says so in its tooltip. It
  does not move: it lives in a strip a few pixels tall between the last answer and the composer, and
  anything moving there touches one of the two.
- **An open approval breathes.** An approval card stops the turn — nothing else happens until it is
  answered — and at the bottom of a long transcript a still card is indistinguishable from the text
  around it, so the panel looks as though it has quietly stopped. The one edge that carries meaning
  now fades in and out over two and a half seconds: enough to catch an eye passing over it, never
  enough to read as an alarm. It stops the moment the card is answered, and both animations are off
  under `prefers-reduced-motion`, which states the same thing in colour instead.
- **The Hivey presets are on the Models screen too**, in their own section at the top. Filed under
  `hivey` among the vendors — which is where they landed when they were added an hour ago — they sat
  between Google and Meta: three rows nobody scrolling a catalogue would read as the way out of
  scrolling it. Found by looking at a screenshot of the real panel rather than at the code.

## 0.36.0 — 2026-09-07

### Added

- **The Hivey presets, in the model picker.** Three rows above the four hundred models — **Hivey
  Free**, **Hivey Smart**, **Hivey Pro** — each a routing rather than a model: an ordinary question,
  an agent turn, an inline completion and a chore (a summary, a commit message) each go to the model
  that suits them, so the one kept for the hard work is not the one writing commit messages. Brought
  over from the Hivey sidebar and the web HiveyCode, with one deliberate difference: neither of them
  can know what you are about to ask, so both pay a small model to classify the request first — a
  whole round trip before the first word. This extension already knows whether it is completing a
  line, summarising a transcript or running an agent, and already grades a hard question with the
  router's own free classifier. The routing is read from what is happening rather than bought.
  - **Nothing is named.** Which model each preset uses is generated daily from OpenRouter's own
    catalogue by rule — budget, tool support, context, vendor family, recency — and committed as a
    diff. No model version appears anywhere in this repository's source, which is the rule the two
    sibling projects arrived at the expensive way: a hard-coded id is right the day it is written
    and 404s a few weeks later, in silence.
  - **A preset never reaches a provider.** `hivey/free` is not a model id and no API has heard of
    it. It is resolved on every path out — chat, agent, sub-agent, summarising, inline edits,
    completion — and an id retired from the presets falls back rather than being sent as it stands.
    Proven where it counts: a test in a real editor reads what came out of the socket.
  - **A preset decides where it is served**, so the panel's promise about what leaves the machine
    follows the model rather than the provider setting that no longer applies.

### Fixed

- **Db2 for i is no longer switched on by a file extension.** Any `.sql` file — a Postgres
  migration, a SQLite query, anything — put the whole Db2 for i dialect into the system prompt:
  "this is Db2 for i, not Db2 LUW, not Oracle and not SQL Server", `FETCH FIRST` rather than `LIMIT`,
  the QSYS2 catalogue. On a machine that has never seen a partition. The platform's rules now have
  to be earned: by the IBM i side being in play at all (the same switch the IBM i tools are behind),
  by a path that is a member, or by the source saying so — `QSYS2`, `*LIBL`, `LABEL ON`. `.rpgle`,
  `.dspf` and the other extensions nothing else uses are unaffected; `.cmd` (a Windows batch file),
  `.cl` (Common Lisp), `.pf` and `.table` are gated the same way as `.sql`.
- **A three-segment path was read as a source member.** `db/migrations/0007_add_index.sql` looked
  exactly like `LIBRARY/SOURCEFILE/MEMBER.SQL`, so it was one — the second half of the same defect,
  and the reason the first fix was not enough. An object name on this platform is at most ten
  characters, which is the platform's own rule and now the test.

### Changed

- **The approval card is the theme's colour, not a warning colour.** The frame's leading edge was
  `editorWarning` yellow: a hue that says something has gone wrong, on a card that asks a routine
  question and expects a routine yes — and a hue closer to this extension's own brand than to the
  workbench it is docked in. It now takes `focusBorder`, which every theme defines as "this is what
  you are being asked about". The egress card keeps its link colour and gains a heavier edge, so the
  two are told apart by weight rather than by a second hue to learn.
- **The dialect rules follow what is ATTACHED, not only the focused tab.** Reading them off the
  active editor alone meant that attaching a source member and then looking at the README — or
  asking about three files at once, which is how anyone asks how programs fit together — sent the
  model into a dialect it had been told nothing about. Up to two dialects, deduplicated; each of
  these is a paragraph of rules and, for a fixed-format one, a column ruler.

## 0.35.0 — 2026-09-03

### Added

- **A knowledge base the agent keeps for itself.** Optional and off by default
  (`hiveyCode.knowledge.enabled`). What it is for decides everything about it: an assistant that is
  new to a business every morning spends the first half of every conversation being told what it was
  told yesterday — which library holds the production programmes, that amounts are stored in cents,
  that nobody touches the settlement job before the batch. That knowledge changes slowly, which is
  exactly the kind worth writing down once.
  - **Files, not a black box.** One note per subject, Markdown with a header, in
    `.hiveycode/knowledge/` — versioned, reviewed and arriving with a clone, the argument that made
    skills files rather than settings — or in `~/.hiveycode/knowledge/` for what is true of you
    across projects. A base nobody can read is a base nobody can correct, and the first time it says
    something false about the business, correcting it is the only thing that matters. It can also
    live on a server you plug in (`hiveyCode.knowledge.endpoint`, four routes, small enough to
    implement in an afternoon).
  - **The index is ambient; the knowledge is not.** Each question carries a list of titles — about a
    dozen tokens a note, capped and honest about what it left out — and nothing else. A note is read
    when the model decides it needs it. A base that put itself in every prompt would cost more than
    it saves by the fiftieth note.
  - **It is curated, not accumulated.** Writing a note whose subject already exists is refused, with
    the notes that cover it, so the model updates the right one instead of leaving the next reader
    to choose between three versions of a rule. Retiring moves a note to `.archive/` with the reason
    and the date: a base that can only grow is useless, and one that can quietly lose things is
    worse.
  - **`/remember`** records what a conversation established, working like a librarian rather than a
    scribe — searching first, writing what is true of the system rather than what happened in the
    chat, and recording nothing when nothing durable came out of it.
  - **Show the knowledge base** (palette, and the panel's `⋯`) lists every note and opens the file,
    or writes a new one with its header already in place.

### Changed

- **The agent's steps say what it did, not only what came back.** A step showed the first line of the
  result, so six commands in a row read as six identical lines saying "started in the terminal",
  naming none of them. Each line now carries the call itself — the command, the path, the query — in
  the font the rest of the product writes data in, with the result after it when it adds something.
- **The steps stay above the answer.** They were appended wherever the writing happened to be, so
  text started, a step landed under it, more text went back above it — and at the end the turn was
  redrawn from the record, where steps sit above the answer, so everything moved one last time
  exactly when the reader had settled on it. One container, placed once.
- **The answer is written rather than dropped in blocks.** A model does not send words, it sends
  whatever fits in a packet: three tokens, then eleven, then one. The characters are now released at
  a steady rate, paced by how much is waiting, so a fast model is never held behind an animation.
  Anyone who has asked their system for less movement gets the text as it arrives, unpaced.
- The button back to the end of the conversation sits one pixel higher: at its old place it grazed
  the composer's edge, and a control touching another control reads as attached to it.

### Fixed

- **"The agent said my folder was not open, and it is."** Two causes, both real. In a window with
  files open and no folder — ordinary when they come from a remote or an IBM i partition — every
  file tool answered "No folder is open", which to somebody looking at their open files reads as the
  extension having lost the workspace; the open tabs are now the workspace in that case. And in a
  multi-root workspace, paths were resolved against the FIRST folder only, while the paths the model
  is shown carry the folder name — so every file outside the first folder was unreachable, and said
  so in words that sound like a missing folder. Paths now name their folder when there is more than
  one, and are resolved against it.

## 0.34.2 — 2026-09-03

### Fixed

- **The stop button was dead whenever the send confirmation had been on screen — the actual cause.**
  Every question passes through that card (`privacy.confirmSend` is "always" by default), and the
  card waited on a promise with no second way out. Press stop in that window and the cancellation
  travelled to a turn parked on a question nobody was going to answer: the turn never ended, the
  panel kept its stop button, and pressing it again aborted a controller that was already aborted.
  A dead button for the rest of the conversation, and nothing in any log to say why. The two other
  cards in the panel — approval and egress — always had the listener that answers them on
  cancellation; this one, the one everybody sees, did not. Answering "no" had a second version of
  the same fault: it returned from a point the turn's own cleanup never reaches, so the panel was
  told the answer had ended while the extension still held a live turn for it.
  It was found by CI failing where this machine passed, and the difference between them was that
  setting — a profile here had answered the card "always" long ago. The test now says which it
  wants, and there is a new one that stops with the card up and refuses to finish until the turn
  does.

## 0.34.1 — 2026-09-03

### Fixed

- **Stopping an answer.** Reported as "the stop button does not work", and the first thing built was
  not a fix but a way to find out: a test that runs a real turn against a server which starts
  answering and never stops, presses stop, and asserts that the turn ends and the connection to the
  model closes. It passes — so the wiring from the button to the abort was sound — and getting there
  turned up four things around it that were not:
  - **A stop is now instant.** It used to end the turn only once the cancellation had finished
    travelling. Most of a turn cancels in a millisecond; a query on a partition, a REST call to a
    server that is thinking, or a command behind somebody else's API cancels when it is ready — and
    waiting for those is exactly what makes a stop button feel broken, since the reason anyone
    presses it is that something is already taking too long. The panel is released immediately and
    the rest unwinds on its own time.
  - **A stopped turn can no longer disturb the next one.** Its cleanup used to clear the current
    turn unconditionally — including a turn started since — which left nothing for the next stop to
    abort. Its callbacks are silenced too: no text, status, plan or error from a turn the user gave
    up on arriving under the question that followed it.
  - **The panel no longer decides on its own whether an answer is running.** That state was two
    events and a local flag, with no way back: a turn whose end never arrived left a stop button
    over a conversation where nothing was running — a button that could not work. The extension now
    says so on every state message, so the panel corrects itself.
  - **It says "Stopped."** Cancellation takes a moment, and in that moment the only thing telling
    "stopping" from "the button is broken" is a line saying which one it is. The words already
    streamed stay: the answer is kept on the entry as it arrives, so stopping shows what was said
    rather than an empty bubble.
- **Cancelling a request now covers its whole life.** `fetch` resolves when the response headers
  arrive, and the bridge from the caller's cancellation was taken down at that moment — so from the
  first byte on, nothing could cancel the request. In practice the stream readers were dropping the
  connection anyway, which is why nobody saw it; it mattered for everything that is not a stream,
  where a stop had no effect at all. One listener per signal rather than one per request, so a
  twenty-step turn does not trip Node's leak warning.

### Added

- **Stop the answer, as a command.** In the palette, and returning whether anything was actually
  stopped — which is what made the behaviour testable at all: a click cannot be driven from a test,
  and "stopped it" versus "nothing was running" are the two states worth telling apart when the
  complaint is that a button does nothing.

## 0.34.0 — 2026-09-03

### Added

- **What to do with a selection, as a menu.** Right-click in the editor and there is now a **Hivey
  Code** submenu: rewrite the selection in place, ask about it, add it to the conversation without
  asking anything, or open the full list — explain it, find problems in it, write a test for it,
  document it, show where it is called from, simplify it, handle the failures, add the types. Each
  row says where the answer lands, because that is the only difference that touches your file: the
  questions are answered in the conversation, the rewrites arrive as an ordinary edit that undo
  takes back and the diff shows. The lightbulb (`Ctrl+.`) carries two of them plus a way to the
  rest, and it is the same list — both surfaces are built from one catalogue in `core`, so an option
  cannot exist in one and be missing from the other. Which is also what let it be tested: every
  previous version of these offers was a closure inside a quick pick, and a quick pick cannot be
  driven from a test.
- **Summarising happens by itself, if you say so.** `hiveyCode.context.autoCompact`, off by
  default: with it on, a conversation that reaches two thirds of its budget is summarised before the
  next question is sent, instead of an offer appearing. It is set from the offer itself — the
  **Always** button — or from the ring, and one failure switches it off for the rest of the session
  rather than putting an error in front of every question from then on. The ordering matters and is
  worth stating: the summary is taken **before** the new question is recorded, because compacting
  mutes what it summarises, and a question added first would be summarised and muted in the same
  breath.
- **The context ring is where summarising lives.** Click the ring by the token count and under the
  budget steps there is now *This conversation*: summarise it now, or summarise automatically. The
  panel's `⋯` menu holds the things that are true of the extension — where it sits, what left the
  machine, what it cost, the settings — while this acts on one conversation, the one whose fill the
  ring is showing. The place to look after reading "84 %" is the 84 %.

### Changed

- **The `⋯` menu is grouped, with the settings last.** Four groups with a rule between them: the
  conversation, then what can be inspected (outgoing data, cost, permissions, definitions, MCP),
  then where the panel sits, then language and settings at the bottom. Ordering and separators are
  all a manifest can ask for here: a VS Code menu item has one slot on its left and it belongs to
  the checkmark, so **no icon can be shown in that dropdown** — verified in the editor's own
  stylesheet rather than assumed. Command icons still exist for every row, and they do appear when
  a command is promoted to the title bar.

### Fixed

- **A submenu can be declared and never filled, and nothing says so.** Both halves are strings in
  the manifest, matched by name, so getting one wrong removes a menu entry silently. There is now a
  test, in a real editor, that every submenu a menu points at exists and has rows in it — and
  another that the offers on a selection all carry a command that is actually registered.

## 0.33.1 — 2026-09-03

### Fixed

- **The approval and egress cards had two border colours at once.** The frame was
  `inputValidation-warningBorder` on all four sides — the colour a text field turns when what you
  typed is wrong, which is not what "confirm this" means, and it made a routine question the loudest
  thing in the transcript. The egress card then drew a blue leading edge over one side of that
  orange box: two colours on one card, which reads as a rendering fault rather than as a
  distinction. Now it is the panel's own frame plus a leading edge carrying the one colour that
  matters — warning for something the agent wants to do, the link colour for something leaving the
  machine, and the icon follows the edge. That is the language the rest of the panel already speaks,
  so the edge says which kind of card it is without a legend.

## 0.33.0 — 2026-09-03

### Added

- **`ibmi_where_is`: which libraries hold a member with this name.** The reverse of reading one —
  the question is "where is this program" rather than "what does it do" — and it is one query across
  every schema, so it can be answered directly. Generic names work: `CUST*`.
- **`/whouses`: what on this system uses an object.** A skill rather than a tool, and the difference
  matters. The information lives in DSPPGMREF and in catalogue views whose names and columns differ
  between releases, so the skill tells the model how to find out instead of hard-coding what to ask:
  run DSPPGMREF into a temporary file, `SELECT *` five rows to see what the columns are called on
  *this* release, and only then write the query. Code that guesses those names works at one customer
  and misleads at the next; a model that looks first does not. It is also told to say which step is
  the evidence for each answer — a caller inferred from a naming convention is not a caller.

## 0.32.1 — 2026-09-03

### Fixed

- **The library list stopped at your own library list.** When the catalogue query came back empty
  the only libraries left were the ones Code for IBM i already had — which is indistinguishable from
  a machine that has no others, and is exactly what it looked like. There are two queries now: the
  object catalogue first, because it carries the text descriptions and a screen of bare names is a
  screen nobody can choose from, then the SQL schemas, which answer on systems where the first does
  not. The diagnosis command reports both, and how many libraries the extension ends up with.
- **`ARC*` matched nothing in the library picker.** That step still used the built-in filter, which
  is fuzzy and takes the star as a character to find — so the one syntax anybody would reach for
  here was the one that could not work. It uses the same rule as everywhere else now: `ARC*` finds
  ARCAD_ENG, and `arc` on its own finds it too.
- **The "type a name" row no longer disappears when you type.** It was filtered along with
  everything else, so it vanished precisely when nothing matched — which is the moment it exists
  for.

## 0.32.0 — 2026-09-03

### Fixed

- **Typing `531` in the member list also matched `5331`.** That is the quick pick's own filter,
  which is fuzzy: it accepts the characters in order with gaps between them. Right for a command
  palette, where you are half-remembering a name; wrong for a list of members, where 531 and 5331
  are two different programs. The list is now filtered with the same rule as the search box —
  contains, or the glob if there is a `*` in it.
- **A file attached from the editor said "(truncated)" almost every time.** The cap was four
  thousand tokens, flat — the right number when the whole context budget was eight, and a setting
  from another era once the budget started following the model. It is two fifths of the budget now,
  with the old number as the floor, so a 200k window keeps 80k of a file rather than 4k. And the
  label says how much was kept rather than only that something was lost, because "truncated" with no
  number is a warning nobody can act on.

### Added

- **ARCAD: the same member across versions.** Back in the `+` menu, and asking the question that
  suits it: the component's name first, then which libraries to look in — the reverse of the other
  flow, because when two versions are on the table you already know the name. Every match comes back
  ticked, since having asked for one component in several versions, wanting all of them is the
  ordinary case. It does not guess which library is which version: that mapping lives in the ARCAD
  repository and Elias publishes no way to read it.

## 0.31.1 — 2026-09-03

### Added

- **`Hivey Code: Diagnose the IBM i connection`.** Listings were coming back empty on a real
  partition, and there is none here to try anything against — so every fix was a hypothesis handed
  to somebody else to test, three times over. This runs each step in turn and reports what came
  back: whether the extension is connected, what its own object listing returned and with which
  attributes, whether there is an SQL job at all, and what the two catalogue views answered —
  **including the raw column names as the driver spelled them**. That last one cannot be inferred
  from a distance and is the likeliest cause: asking for `TABLE_NAME` when the answer says
  `table_name` yields undefined for every row, and a list of blank rows looks exactly like a list of
  none. It reads and never writes.

## 0.31.0 — 2026-09-03

### Changed

- **Attaching a member is lists, not typing.** It was three menus deep — library, then source file,
  then member — and every step could come back empty with a field underneath it, so the way through
  was usually to type a name by hand. That is the slowest way to do this and the one most likely to
  be wrong: the point of being connected is that the names are already known over there. Now: pick
  libraries, say what the name looks like, pick members from what was found. The source file stops
  being a step and becomes part of what each row says, because nobody looking for a program thinks
  "it is in QRPGLESRC" first — they think of its name.
- **Every library on the system is offered**, with the ones in your library list first, rather than
  only the library list. An ARCAD version library or a colleague's is now reachable without typing.
- **Libraries and members are both multi-select**, which is what makes holding two versions of the
  same component a single gesture.

### Fixed

- **Columns were read in the wrong case.** The SQL fallbacks asked for `TABLE_NAME` while the driver
  may return `table_name`, which yields undefined for every row — a list of blank entries, which on
  screen is indistinguishable from a query that found nothing. Every column is read
  case-insensitively now, and trimmed, since Db2 pads CHAR columns and a member called `CUST      `
  is not the member the next call asks for. This is the most likely reason listings came back empty.
- **The member listing is one query instead of one per source file**, from `SYSPARTITIONSTAT`, which
  holds a row per member of every file in the library. The per-file walk remains for systems where
  that view is not available.

## 0.30.0 — 2026-09-03

### Added

- **Search for a member by name, with `*` anywhere.** `*531*` finds every member with 531 in its
  name — a search the platform itself cannot express, since a generic name on IBM i only ever means
  "starts with". A pattern with no star at all is treated as "contains", because typing `531` into
  a search box and being told nothing exists — as no member is *called* 531 — is how a search comes
  to feel broken. Searching runs across every source file in the library, and says which file it is
  looking in while it does.
- **Search across several libraries at once**, ticking the results you want. That is what comparing
  versions means on this platform: ARCAD keeps each version in its own set of libraries, so the
  versions of a component are members of the same name in different libraries. Nothing here guesses
  which library belongs to which version — that mapping lives in the ARCAD repository — but once the
  names are known, finding the same member in all of them is one search.
- **A setting for whether the IBM i side appears at all** (`hiveyCode.ibmi.integration`). `auto`, the
  default, shows it when Code for IBM i is connected — nothing for anyone who does not use the
  platform. `on` shows it whenever that extension is installed; `off` never. It governs the `+` menu
  and the tools the model is given, together.

### Fixed

- **Every step now says how many things it found.** A list that came back empty looked exactly like
  a list that had not loaded, which is why "it finds nothing" and "I cannot tell whether it found
  anything" were the same report. Counts in the placeholder, the source file being searched in the
  progress, and an explicit message naming the pattern and the number of source files looked in when
  a search comes back with nothing.
- **Members are asked for twice when the first answer is empty**, the same way source files already
  were: the extension's own listing, then Db2 for i.

## 0.29.2 — 2026-09-03

### Fixed

- **The `+` menu said "open editors" under two different headings.** "The editor" held *all of them*
  and *choose among them*; "Open editors" listed them. Three routes to the same files under two
  titles, leaving the reader to work out that they were the same files. What divides them is not one
  editor versus several but WHICH editor: the one in front of you, or the set. The current editor's
  selection and file stay under "The editor"; everything about the set is under "Open editors",
  where the list already was. "The editor" is no longer drawn at all when there is no editor, since
  a heading over nothing is worse than no heading.
- Ticking boxes only beats picking from the list once there are several to tick, so *Choose
  several…* appears past three open editors rather than past one.

## 0.29.1 — 2026-09-03

### Fixed

- **Picking a library said "No source physical file" and stopped there.** The step listed `*FILE`
  objects and kept the ones whose attribute was exactly `PF-SRC` — a heuristic, with nothing behind
  it when it missed. The library was full of source files; the panel simply failed to recognise
  them, and then told the user their library was empty. The match is loose now, Db2 for i is asked
  when the extension's answer is empty, and — the part that actually matters — **there is always a
  way to type the name**. A picker built on discovery has to let you say what you already know.
- The same applies to the member: the list is searchable by typing, and when there is no list, the
  name can be typed instead of the step ending.

## 0.29.0 — 2026-09-03

### Added

- **A member and everything it uses, in one step.** `ibmi_program_context` for the assistant and
  **Member and what it uses…** in the `+` menu: the member is read, its `/COPY` copybooks and the
  programs it calls are pulled out of the source, and each is fetched from the partition across the
  library list. Every one arrives as its own attachment, so you can see what came in and take any of
  it back out — a single item labelled "and 7 others" is a context nobody can correct.
- Dependencies are read from the SOURCE rather than from a catalogue, and the difference is the
  point: a cross-reference file says what the compiled object binds, the source says what the
  programmer wrote — including the copybook carrying the data structure the whole program is about.
  The other direction, *who calls this program*, is not something source can answer; that stays with
  `ibmi_sql` and `ibmi_command`, where the shop's own DSPPGMREF or ARCAD cross-references can be
  named rather than guessed at.

### Fixed

- **The context budget stopped short of the model's own window.** It was capped at three quarters,
  on the reasoning that the answer needs room too — which is true, and is not this setting's decision
  to make. A model with a million tokens of context has a million; a menu that refuses to say so is
  arguing with the number printed beside it. The window is on the list now, and the entry says what
  it costs instead of hiding the option.
- **The budget menu existed twice** and the two copies had drifted: one still promised "room left
  for the answer" after the other had stopped capping. One section, used in both places.

## 0.28.0 — 2026-09-03

### Added

- **Attach a source member by browsing to it, and a stream file by path.** The `+` menu grows an
  IBM i group when Code for IBM i is connected: **Source member** walks library, then source file,
  then member — each a list read from the partition, the library list first because that is what
  this user works in today — and **Stream file (IFS)** takes a path. Nothing is downloaded into the
  workspace, nothing is checked out, and no tab is opened. A member comes through Code for IBM i's
  own connection and a stream file through the file system it registers, so the right library list,
  the right CCSID and the warm SQL job are the ones already negotiated.
- Typing `#member:LIB/SRCFILE(MBR)` already worked; what was missing was finding one without
  knowing its name, and the IFS, which had no route at all.

## 0.27.0 — 2026-09-03

### Fixed

- **The context budget offered numbers that belonged to a ladder, not to the model.** The steps were
  absolute — 4k, 8k, 16k and up — and merely filtered by the model's window, which failed at both
  ends of the same mistake: on a model holding 200k the first offer was 4 000 tokens, which is not a
  choice anybody would make, and the ladder stopped at 200k however large the model was, so three
  quarters of a 200k window and most of a million-token one could not be chosen at all. They are
  fractions of the selected model's window now — an eighth, a quarter, a half, three quarters — so
  Claude offers 25k · 50k · 100k · 150k and a million-token model offers 125k · 250k · 500k · 750k.
  The largest is still three quarters: the answer has to fit in the window too.
- The numbers are rounded to ones a person would say. An eighth of 131 072 is 16 384, which is
  arithmetic rather than a choice; the step widens with the size, because nobody distinguishes 147k
  from 150k and everybody distinguishes 500 from 600.

### Changed

- **Token counts read as counts again.** "200.0 k" claimed a decimal place nobody measured, and a
  window of "1000.0 k" had to be converted in the head before it meant anything: whole thousands
  lose the decimal, and millions get their own unit.

## 0.26.1 — 2026-09-02

### Fixed

- **A key that was already stored was called "not set up".** The extension reads the keychain into
  the state the composer consults — but only on a first run, or when nothing could answer. For
  anyone already installed it therefore stayed empty for the whole session: the setup screen was
  right, because opening it does that read, and the menu beside it was wrong because nothing ever
  did. It is read whenever the panel comes up now. An empty list means "not read yet" just as much
  as "nothing there", which is a distinction worth a test rather than an assumption.
- **The provider no longer switches to something that cannot answer.** Choosing a gateway with no
  key left the panel configured to fail: the composer said "Anthropic", the next question said 401,
  and the setting had to be put back by hand. An unconfigured choice now only opens that provider's
  card; the switch happens where the key or the model is actually supplied, which both already do.
- **The context ring was missing on a fresh conversation.** It kept a threshold inherited from the
  bar it replaced — nothing below a fiftieth full — which existed because a long grey line with a
  dot at the end reads as a rendering fault. A ring does not, so there was no reason to hide it, and
  an indicator that vanishes reads as one that was removed. Its background is stronger too: at half
  strength the empty state was a smudge beside the token count.

## 0.26.0 — 2026-09-02

### Added

- **Choosing a provider you have not set up now says so, and takes you there.** The menu carries
  each one's actual state — no key yet, no model server found on this machine, needs an address and
  a key — and picking one that has nothing behind it opens its own card on the setup screen, already
  expanded, with the field that is missing. It used to switch in silence and fail one question later
  with an HTTP 401: the worst moment and the worst place to learn that a key was needed. The panel
  knew all of this already; the setup screen is drawn from the same state. It simply was not being
  consulted at the moment the choice is made.
- **A route into a local model rather than a single command.** Two numbered steps, then three models
  with what they weigh and the machine each suits — a laptop with no discrete GPU, a machine with
  8 GB of VRAM, a workstation. Three and not thirty: the point is to end the decision, not open it.
  Somebody who has just learned they need a model server does not also want to compare
  quantisations.

## 0.25.0 — 2026-09-02

### Added

- **A context budget, sized by the model you chose.** How much of the model's window this
  conversation may fill — offered as steps rather than a number to type, because the choice is
  coarse and a field asking for a token count is a field asking the user to know what a token is.
  The steps come from the catalogue's window for the model actually selected and stop at three
  quarters of it: offering 128k on a model that holds 8k is a promise the run cannot keep, and a
  budget equal to the window leaves nowhere for the answer. A model whose window is unknown — a
  local runtime that reports no such number — gets fixed steps instead of an invented ceiling.
- It is set from the ring under the composer, and from the thinking menu when the model has one.
  The ring was already drawn, already about exactly this, and already beside the token count; a
  control of its own in the toolbar cost 22 px, and a capture showed where they came from — the
  model name, the one label in that row carrying something nobody can guess, went from
  "qwen2.5-co…" to "qwen2…".

### Fixed

- **Changing where the answer comes from drew a fake answer.** The panel showed a Hivey Code turn,
  apparently thinking, containing "413 models". Refreshing the catalogue reported its result on the
  `status` channel — which is how a RUNNING turn says "read this file, ran those tests" — and the
  panel gives anything arriving there a live turn to sit in. So a piece of housekeeping nobody asked
  for invented a turn to announce itself in. Background news now goes where the editor puts
  background news, and the panel refuses to build a turn for a message that arrives outside one.
- **The support button was the brightest thing under the composer**, at full foreground while both
  its neighbours are muted. The words are muted like theirs now and the icon carries the colour —
  green on this machine, accent through a gateway — which is the distinction worth keeping.
- **The search bar could not be closed.** Escape worked only while the caret was still in the field
  — which is the one place a reader is not, once they are looking at what the search found — and the
  magnifier reopens rather than toggles. There is a cross in the bar now, and Escape closes it from
  anywhere; closing clears the query, because the query filters the transcript and a bar that shut
  while still holding a word would leave messages missing with nothing on screen to say why.

## 0.24.0 — 2026-09-02

### Changed

- **How full the context is, as a ring.** Fourteen pixels where there were ninety. The row under the
  composer holds the provider, the approval setting, a token count and a price on one line in a
  side bar 280 px wide, and a bar spanning a third of it to say "22 %" was the least information per
  pixel on the screen. The ring is the editor's own shape for the same reading — background circle,
  arc starting at twelve o'clock — and the percentage waits behind a hover, four characters nobody
  needs at 12 % and everybody wants at 90. It no longer has to hide below a fifth full, either: a
  ring is legible when nearly empty, which a long grey line with a dot on the end was not.
- **"Latest" is the chevron alone.** The word named the destination the arrow already names, and it
  was the widest thing in the one strip where nothing else is allowed to be.
- **The composer's outline is a trace rather than a rule.** It was drawn at the weight of a divider
  around a box already separated from everything by its own background, which is why it read as
  heavier than the editor's own input — where the same fallback is `transparent`.

### Fixed

- **134 French entries for text the product no longer says.** The test that exists to catch exactly
  this was looking for the key as a substring ANYWHERE in the source, so a mention in a comment kept
  an entry alive, and so did being the prefix of a longer string. It now asks whether the key is
  passed to `t()` — fragments joined — or present as a literal, which are the only two ways a key
  can be reached.

## 0.23.0 — 2026-09-02

### Changed

- **Attachments are shaped like the editor's own, and carry the kind of file they are.** The remove
  cross used to fade in on hover while keeping its width — the worst of both, since every chip had
  an empty slot at its end and the only control it has could not be found without discovering it.
  It is always there now, as it is in the workbench's chat. It could also be cut off entirely: it
  sat at the end of a box with `overflow: hidden`, behind a folder path long enough to push it out
  of view. The folder is now the only part allowed to shrink.
- The shape itself takes the workbench's numbers from `.chat-attached-context-attachment` — a
  border instead of a fill, a low radius, four pixels of gap — and the icon says what the file IS:
  source, structured data, prose or picture, from the extension, IBM i members included. Four marks
  is as far as this goes honestly: the editor draws the language's own icon from a theme a webview
  cannot reach, and a logo redrawn by hand at twelve pixels is a smudge.
- **The composer is shorter**, closer to the height the editor's own chat gives itself.

## 0.22.1 — 2026-09-02

### Fixed

- **The same scheme filter was in two more places**, found by checking the built package for the
  string rather than trusting the fix. `#open` — the mention that hands over every open editor —
  returned nothing over SSH, in a container or on an IBM i; and the file you are looking at was
  never offered as context there either, refused by `activeContext` for being somewhere other than
  a local disk. That last one is the one that matters most: the tab in front of you, silently not
  offered, for every remote user of an extension whose reason to exist is IBM i.
- The rule now lives in one place, `isDocumentUri`, and is written as what it EXCLUDES: an output
  channel, a settings editor, the release notes, a git revision — documents the editor synthesises,
  which can be listed because the editor is what makes them. An allow-list of schemes answers "is it
  on this machine", which is a question nobody asked. The two mistakes do not cost the same: a
  deny-list that misses something attaches an odd document once, an allow-list that misses something
  makes the feature not exist for a whole class of user, silently.

## 0.22.0 — 2026-09-02

### Fixed

- **"Attach all open editors" attached nothing over SSH, in WSL, in a dev container, or on an
  IBM i.** The fourth report of this feature being broken, and the first cause a local file could
  never show: the tabs were filtered by `uri.scheme === "file"`. That is true on a laptop and false
  everywhere the files are not on the laptop — including every member and stream file Code for IBM i
  opens, which arrive under the scheme it registers. Reading them was never the problem;
  `openTextDocument` resolves any scheme with a provider. What decides now is the KIND of tab
  (`TabInputText`), which is what excludes a diff, a notebook or a settings editor — never where the
  bytes live. Three earlier fixes and an integration test had all been written against `file:` tabs,
  which is why none of them caught it; the test now opens one that is not.

### Changed

- **The composer's labels are a step smaller than the conversation.** Mode, model and effort are
  settings of the box you are typing in; at the size of the text above them they read as content.



- **The margins are the editor's own.** Rather than guess how much to give back after removing the
  20 px VS Code injects, this is the number the workbench's chat gives its messages:
  `.interactive-item-container { padding: 12px 16px }`. Sixteen, with the composer a little wider,
  as it is there.
- **The send button has no styling of its own.** It carries the same classes as the six controls
  beside it and a different glyph, which is the whole change. It was `primary` — an accent-filled
  tile with its own size — and then flat but accent-coloured, which is the same mistake in a smaller
  dose: a highlight on the control you press LAST catches the eye every time you are reading rather
  than sending. That it is the send is said by the arrow and by where it sits.
- **"Latest" sits between the two positions that were each wrong in one direction.**

## 0.21.0 — 2026-09-02

### Fixed

- **Every change of state jumped the conversation to the last message.** Pinning an answer was where
  it showed, but pinning was not the cause: the panel is rebuilt on every message from the
  extension, and the rebuild ended at the bottom of the transcript unconditionally. Mute an
  exchange, delete one, attach a file — same jump, away from the thing you had just acted on. The
  reading position is kept across a rebuild now, and given up only when you were already at the end
  or are arriving from another screen.

### Changed

- **A few pixels back at the edges.** Removing the 20 px the editor injects took the content right
  to the frame, which reads as zoomed rather than as full width: a line of text needs a margin to be
  a line rather than an edge. Ten pixels — a third of what was there, and this time deliberate.
- **Skills sits next to the send button**, not at the end of the row on the other side. The two
  groups are pushed apart, so "last on the left" and "next to send" are not the same place; and this
  is the control you reach for while writing a message, not while configuring a conversation.
- **Your name is as visible as the assistant's.** At 60 % of the foreground the question's author
  read as an annotation on the answer rather than as the other half of a conversation.
- **The send arrow is the same weight as its neighbours.** A blue glyph among six grey ones is a
  highlight, and a highlight on the control you press last catches the eye every time you are
  reading rather than sending.
- **"Latest" sits lower**, in the middle of the space that is actually there: the transcript keeps
  its own padding under the last message, so the gap starts higher than the strip does.

## 0.20.0 — 2026-09-02

### Fixed

- **The side margins that would not go away.** The panel's own horizontal padding had been cut
  three times and the empty strips down both edges never moved, because they were never the
  panel's: VS Code prepends a stylesheet to every webview document, and in it
  `body { padding: 0 20px }`. Forty pixels on a 280 px side bar — one seventh of the line — spent
  by a rule that is in the editor's own files and that nothing here reports. The content now runs
  to the panel's edge, with the small inset the composer's border needs and nothing else. (Same
  trap as the grey band that used to sit behind every code block: `code { background }` from the
  same injected stylesheet.)
- **The controls under a message were inside the message.** Visible the moment an answer was
  pinned: the tint that marks a pinned block ran under the buttons, because as far as the DOM was
  concerned they were part of the answer. They are a control strip that belongs to the message the
  way a scrollbar belongs to a list, and they now sit outside the article.

- **A skill could only ever be a repository's.** Writing one in a window with no folder open
  answered "Open a folder first" and stopped there, so the feature did not exist at all in that
  window — and even with a folder, a habit of your own had to be committed to somebody's project
  before you could use it. Definitions now also live in `~/.hiveycode/`: the same files one level
  up, yours, in every project you open. With a folder there are two honest answers and creating one
  asks which; without one there is nothing to ask. A repository's definition wins over a personal
  one of the same name, for the reason both win over the built-ins.

### Changed

- **Your side, their side.** A question's name is right-aligned and an answer's stays left, so a
  transcript of two speakers stops reading as one column of blocks. The mark stays on the outside of
  the name in both — mirrored rather than merely pushed over — and the controls under your own
  message follow it.
- **A more modern send button** — an arrow up in a square, the glyph every composer settled on,
  instead of a paper plane. The plane is a mail metaphor: it says the message goes off somewhere and
  you will hear back later, which is the opposite of what a chat does.
- **The control strip holds its height again.** Opening it on hover removed the empty band and paid
  for it with everything below sliding down whenever the pointer crossed a message — worse than the
  band, because a transcript that moves under the cursor cannot be read. It is out of the message
  now, so holding its height costs the pair nothing.
- **The buttons are readable.** Back to a 22 px square around a 14 px glyph, at 90 % of the
  foreground instead of 72: at that weight, in a row you have to look for, they were a shade of the
  background as much as of the text.
- **"Latest" is smaller** — 10 px text, a 12 px chevron — and re-centred for its new height. It is
  a way back, not a call to action.

## 0.19.0 — 2026-09-02

### Changed

- **The controls under a message take no room until you point at one.** Every entry reserved the
  height its hover buttons would need — deliberately, so the transcript would not reflow — which
  meant every message in the conversation carried a band of empty air the width of six invisible
  buttons, and on a question that band stood between the question and its own answer. The row now
  opens under the message the pointer is on and closes when it leaves: nothing above the cursor
  moves, and a transcript nobody is pointing at reserves nothing at all.
- **A question and its answer are closer still**, which is the same change seen from the other end.
- **The buttons themselves are smaller** — a 20 px square around a 13 px glyph instead of 22 around
  14 — so the row reads as one control rather than as six separate ones.
- **Code blocks are a veil rather than a panel.** `textCodeBlock-background` is opaque in most
  themes: it puts a slab on top of the answer, and on a light theme it is very nearly the panel's
  own white, so the block read as a rectangle of border with nothing in it. A grey mixed from the
  foreground and left partly transparent lifts the code by the same small amount in every theme and
  keeps the tint of what is behind it. The copy and insert buttons take the same material.
- **The way back to the end of the conversation sits in the middle of the gap it lives in.** It was
  centred in the 26 px strip the transcript reserves, but the composer adds 4 px of its own below
  that — so the space the eye reads is 30, and the button sat on the last line of the answer with
  seven pixels of nothing under it.

### Fixed

- **Skills and sub-agents can be written from the panel's `…` menu.** That entry only ever LISTED
  them, which is the one thing the interface already does everywhere else — they are in the
  composer, in the `/` menu, in the tools picker. Writing one was reachable only from the command
  palette. It now offers **New skill…** and **New sub-agent…** first, with the repository's own
  below: opening one is how you edit it.
- **A CSS rule that had never run.** `.entry-head .entry-actions` described moving a question's
  buttons up into its header, at length, in a comment — and nothing in the panel has ever built
  that element, so the rule matched nothing and the band of empty air it was meant to remove stayed
  where it was. A selector that matches nothing is reported by nothing.

## 0.18.1 — 2026-09-02

### Fixed

- **Four paragraphs of the French interface were in English** — the permissions screen's rule about
  the shape of an action, the note that a refusal beats an authorisation, and both explanations in
  the egress and cost reports. Each was translated; each translation was unreachable. A sentence
  written across several source lines joined by `+` reaches `t()` as ONE string, while the coverage
  test read only the first fragment — so it checked a key that never exists at runtime and passed
  while the interface showed English. The test now joins the fragments, which is what found these
  four. Seen first on a screenshot: nothing else was ever going to notice.

## 0.18.0 — 2026-09-02

### Added

- **A rule between one exchange and the next, carrying the way back.** A transcript is a stack of
  question-and-answer pairs and nothing said so: every message was separated from the next by the
  same amount of space, so a question sat as far from its own answer as from a different turn. The
  line is now drawn at the boundary that matters — above a question, never between a question and
  its reply — and the restore rides on it, the way the editor's own chat marks a restore point.
  There used to be two lines at every boundary, one under the answer and one above the next
  question, both restoring to different points; there is one.
- **A turn that changed no file can be rewound too.** Restoring refused unless something had been
  written to disk, which made the restore point an agent-mode feature — while the thing most people
  want to undo is a question that sent the answer off in the wrong direction, which costs nothing on
  disk and everything in context. Every boundary now carries the restore, and the confirmation says
  which of the two it is about to do.
- **Making a skill or a sub-agent is back in the menu that lists them.** It had become reachable
  only from the command palette, which means reachable only by someone who already knew it was
  there. **New skill…**, **New sub-agent…** and **Share with the team** sit under a rule in
  *Skills and sub-agents*, and "no sub-agent is defined" now offers the button that defines one
  instead of being a dead end.
- **`Hivey Code: Pin or unpin the last answer`**, so pinning can go on a keybinding — and so the
  path can be driven by a test. The button lives in a hover row, which nothing but a person can
  press, which is why it was reported twice as doing nothing.

### Changed

- **A question and its answer are pulled together.** The gap inside a pair is halved; the space
  goes to the boundary between pairs, where the rule is.
- **A pinned answer is unmistakable.** An edge, a tint across the whole block and a badge in the
  header — three signals, because the two before them went unnoticed: what pinning showed for
  itself was a word in the muted colour inside the row that fades when the pointer leaves. The pin
  button also keeps the accent while the state is on, so the answer to "did that work?" is under
  the pointer that just clicked.

## 0.17.1 — 2026-09-01

### Added

- **The permission lists can be edited from the panel.** Allowed and denied paths and commands were
  settings, shown here as two numbers — "3 allowed, 1 refused" — and changing one meant knowing they
  were settings, finding them among thirty-nine, and editing JSON. A list whose length you can see
  and whose contents you cannot is a list nobody trusts. Refusals come first, because that is the
  rule: a denied path beats an allowed one whatever was written first.
- **"Attach all open editors" is a command** (`Hivey Code: Attach all open editors`), so it can go
  on a keybinding — and so the path could be tested end to end. The menu row was a closure inside a
  quick pick, which no test can drive, which is why three separate failures in this one feature were
  each found by a person rather than by the suite.

### Fixed

- **Pinning looked as though it did nothing.** It worked: the state round-tripped and survived
  trimming. What it showed for it was the word "pinned" in the muted colour, inside the header row
  that fades to nothing when the pointer leaves — so the only visible consequence of the button
  disappeared a second after it was pressed. A pinned exchange now carries a mark that does not
  fade and an accented edge you can find down a transcript without reading anything.
- **The open file appeared twice** when it had also been attached by hand — once as the suggestion,
  once as the attachment. Found on a screenshot taken to prove attaching works, which it did.

### Changed

- **Narrower margins again**: the content runs almost to the panel's edge. What is left is the inset
  the composer's border needs so as not to sit on the frame.

### Verified

- Three separate reports that "all open editors" attaches nothing. It is now covered by an
  integration test that opens three real tabs in a real editor with no workspace folder, asserts
  every one is found, runs the whole attach path through the new command, and asserts three
  attachments arrive and a second pass adds none — and by a screenshot of the composer holding them.

## 0.17.0 — 2026-09-01

### Fixed

- **"All open editors" attached nothing**, for a second and different reason. The tabs were found
  correctly; each was then turned back into a path and re-joined onto the first workspace folder —
  which produces a URI pointing nowhere for any file outside it, and which was skipped entirely when
  no folder was open (`if (!folder) break`). It uses the tabs' own URIs now. And when nothing comes
  of it, it says so: silence is what made an empty result look like a broken feature, and "empty"
  has causes you can act on — no tabs, or a privacy rule.
- **Attaching a file outside the workspace** failed the same way, silently. An absolute path is used
  as it stands.
- **The sort control sat on a line of its own** in the history, because the rule that was meant to
  place it named `.search-input-wrap` — a class invented while writing the rule rather than read
  from the function that builds the box. It matched nothing.

### Changed

- **The settings are in seven sections** — General, Model & endpoints, Skills sub-agents & MCP,
  Privacy & budget, Permissions, Context, Inline completion — instead of thirty-nine entries under
  one heading. They were all present, documented and translated, and could not be found.
- **Attachments look like the editor's own**: an icon, the file name, then its folder in the muted
  colour, and the × on hover. A full path truncated from the left is unreadable and truncated from
  the right is every file in the folder.
- **The skills menu returns to its first screen** after each choice instead of closing. Configuring
  these is rarely one decision — you pick the areas, and the skills you then want are the ones that
  just appeared.
- **The guided start says "Next"**, in white on the accent, and closes with a cross rather than the
  word "Skip" — which read as "skip this step" beside a Next button, and meant nothing at all on the
  last screen.
- **The history loses "Paid only"** and gains its sort beside the search. The "most expensive" order
  answers the same question without a switch that has to be remembered.
- **The empty conversation is centred** on the transcript rather than a third of the way down it.

## 0.16.2 — 2026-09-01

### Fixed

- **"All open editors" attached one file.** It read `visibleTextEditors` — what is laid out on
  screen right now, which is one document or two in a split — so the count beside it was right while
  the result was wrong. It reads the tabs, like the row above it.
- **Bold containing code showed its own punctuation.** `**a `x` b**` came out as the literal
  characters, because the bold branch set its contents as text rather than parsing them. Emphasis
  containing an identifier is not an edge case in an answer about code — it is most of the bold in
  one. Every emphasis span now nests, bounded by construction: the delimiters are removed before
  recursing, so the string is strictly shorter every time.
- **The "latest" button** sits a few pixels lower, centred in the strip rather than on its top edge.

### Changed

- **The skills picker is two levels.** One list held eighteen family rows, then every skill under
  its own separator, then the sub-agents — forty rows answering three different questions at once,
  with a thin grey line to tell them apart. It is now *areas*, *skills*, *sub-agents*, one screen
  each, and the first says how many are on in each.
- **The guided start asks properly.** The families are rows carrying their subject, their examples
  and how many skills sit behind them, rather than eighteen chips; and the skills that follow are
  grouped under the family they came from, with an "all" beside each heading.
- **Comments in code are green**, not grey. No colour is registered for a comment — syntax colours
  come from a TextMate theme a webview cannot read — so it takes the ANSI palette, which every theme
  defines and which is designed for text.
- **"Use in another conversation" is on every history row**, including the one you are in, where it
  means "start a fresh conversation with this one attached". Hiding it there made the whole feature
  look absent, since that is the row anyone reaches for first.
- **Narrower margins again**, and the placeholders ask rather than instruct: "What can I do for
  you?" and "What can we plan together?" instead of "Describe the change".
- "The file I am looking at" is **"This file"**.

## 0.16.1 — 2026-09-01

### Fixed

- **The context picker had lost most of itself.** Every group was built in one `try`, so a failure
  in any of them — the file system, a language server, the tab list — took the whole picker with it
  and left a handful of rows. Each group is now built independently: one that cannot be built is
  missing, the rest still opens. The open editors are listed **inline** again, so attaching the file
  you are switching between is one click rather than two, and "All open editors" is always shown —
  saying "no editor is open" rather than vanishing, because a row that disappears when there is
  nothing to attach is indistinguishable from a feature that has been removed.
- **The "latest" button, for the third time.** The first fix moved it off a hand-measured offset,
  the second gave the transcript a box to hold it — and it was still being appended to the SCREEN,
  whose bottom edge is below the composer. Same symptom, a different cause each time, which is why
  it kept looking unfixed.
- **A specialised conversation survived being left.** Opening another conversation from the history
  left the guided start running over it, still asking questions about a conversation that already
  existed. It ends when you leave.
- **Inline code looked like raw markdown.** Its background was removed in 0.14.0 to stop a paragraph
  reading as a row of chips — but the real offender was the block below it, where VS Code's injected
  `code { background }` painted a band per line. With that fixed, a tint on an identifier is what
  makes `;` read as a character from the code rather than as stray punctuation. Code blocks get
  their surface back for the same reason.

### Changed

- **The `+` is a dropdown, not a dialog.** Two ways to start, under the button that was pressed —
  it was briefly a quick pick, which answers a click in the corner of a side bar with a modal list
  in the middle of the screen.
- **An empty conversation is empty**: the mark, the name, and the one line that changes — whether
  anything leaves the machine. It held three mode cards, a family chooser and a list of tips, in
  answer to someone who had just pressed "new conversation" and wanted to type. All of it is still
  one click away, in the composer or behind the `+`.
- **More air and more colour in answers**: wider gaps between blocks, a longer line height, coloured
  list markers, an accented quotation, a hairline under a top-level heading.
- **The model and the cost moved to the button row**, at its far end and on hover. In the header
  they competed with the name and the tags for a row that is tight at a docked width, and were read
  on every turn by nobody.
- **"Use in another conversation"** takes a forward arrow. The tray-with-a-down-arrow said
  "download", which is what people read it as.

## 0.16.0 — 2026-09-01

### Added

- **A specialised conversation**, from the `+` at the top. Three questions, answered locally and in
  order because each narrows the next: what may it do, what is this about, and which of those skills
  do you want — then "What would you like to do?" and the floor is yours. Nothing it produces is a
  message: the steps are drawn from state and are gone the moment you ask something, so a
  specialised conversation looks like any other afterwards.
- **Eighteen families instead of nine.** HTML & CSS and JavaScript & TypeScript are separate, as are
  C & C++, Go and Rust, and IBM i is now RPG & ILE, DDS, Db2 for i and CL. A Go developer and a Rust
  developer want different skills; "Systems" was a filing decision, not a user's. Every family holds
  at least three skills, asserted by a test.
- **Pick a whole family in one click** in the skills picker: family rows govern membership, the rows
  under them govern what is off inside a family in play. Sub-agents sit under their own heading with
  their own icon, because a nested turn with its own tools is not a slash-command.
- **The open editors, properly.** "All N open editors", and a picker to tick the four you mean.

### Changed

- **Families are opt-in and only the general one starts on.** Everything was ticked in a picker
  whose purpose is choosing, which is worse than no question at all. Skills INSIDE a family in play
  stay opt-out, so one committed by a colleague into a family you use arrives working.
- **Narrower side margins** through the transcript, the composer and the guided start. At 280 px the
  old padding was six per cent of the line, spent on habit.
- **The attachments row** gains a heading with the count and total once there is more than one, a
  way to clear it, an icon per kind, and a scroll rather than half the panel.
- "Whole file" is now **"The file I am looking at"**, and "Selection" **"The lines I have
  selected"** — the reader's question is *which* file, not how much of it.
- **No badge on the skills icon.** It counted what was off, which was a signal while everything was
  on by default and became permanently lit the moment families became opt-in.

### Fixed

- **"Open editors" was empty for anyone with tabs they had not clicked.** It read
  `workspace.textDocuments`, which holds the documents the editor has *loaded* — a tab restored from
  the last session and never focused is not among them. It reads `window.tabGroups` now, which is
  what the Open Editors view itself reads.
- **`hiveyCode.newSession` asked a question**, which broke anything invoking it non-interactively. A
  command on a keybinding or in the palette must act; the choice belongs to the `+`, and now lives
  in a command of its own.

## 0.15.1 — 2026-09-01

### Added

- **The file you have open is offered as context, and sent by default** — the editor's own chat
  behaviour. It appears as an outlined chip above the box, showing the selection's line range when
  there is one and the whole file otherwise, and it follows the active tab. One click puts it aside;
  opening a different file brings the offer back, because the dismissal means "not this file" rather
  than "never again".
  - It is deliberately **not** an attachment: an attachment is something you chose and that stays,
    while this changes under you as you switch tabs. Merging the two would mean every tab switch
    quietly adding a file to a list you thought you were curating — so it is drawn differently,
    outlined where an attachment is filled.
  - **The privacy block list applies to it.** Attaching `.env` on request earns a warning and a
    refusal, which is a conversation; a `.env` attaching itself because it is the open tab is the
    exact failure that list exists to prevent, and it would be silent. Output channels, diff views
    and settings editors are excluded too; an unsaved buffer is not, because asking about code you
    have just typed is an ordinary case.

### Changed

- The skills button takes the workbench's **sliders** glyph. A wrench read as "settings" and sent
  people looking for a preferences page; a wand read as decoration. Sliders say "adjust what is on".

### Fixed

- **The toolbar overflowed onto the send button.** The model name had a floor of 12 characters, the
  row deliberately does not wrap, and four controls plus send no longer fitted a docked side bar — so
  it neither wrapped nor shrank, and simply overlapped. The floor is low enough to always be met, and
  the group can no longer paint outside itself.

## 0.15.0 — 2026-09-01

### Added

- **Around 70 skills, grouped by family**: Web, Python, Java, .NET, Systems (C, C++, Go, Rust),
  Mobile (Flutter and Dart), SQL & data, Build & deploy, **Design & UX**, **Security**, and a much
  larger IBM i set — display files, printer files, CL, embedded SQL, ILE structure, commitment
  control, moving native I/O to SQL. Each names the tools of its subject: a test refuses any whose
  prompt is the generic one with a word changed.
- **"What are you working on?"** on every new conversation, answered **locally — nothing is sent to
  ask it and nothing is sent to record it**. Choosing "Web" narrows seventy skills to the dozen that
  apply, so the `/` list is the one for today's work. What the editor has open is pre-ticked, as a
  visible guess rather than a silent one.
- **Sub-agents that ship with the extension** — `explorer`, `reviewer`, `tester`, `dba` — where
  before there was machinery and nothing using it. A repository that defines one of the same name
  wins. All of them, and the skills, are switched on and off in the same picker.
- **Sub-agents run in parallel** when they can only read. Neighbouring tool calls the tool declares
  safe now go at once, while approvals stay strictly one at a time — two dialogs is not an
  interface. Only *consecutive* safe calls are fused, so read → write → read keeps its order.
- **A pre-send card** showing what the question will send and cost, with **Send / Always / Cancel**.
  In the conversation, never as a dialog; **Always** switches it off for good.
- **Share a message into another conversation** from the hover row: it arrives as an attachment
  carrying where it came from, rather than as pasted text indistinguishable from your own words.
- **The context picker is complete**: the editor, open editors, files, symbols, recent, the
  repository, **instructions**, conversations.
- **The panel's language** is one command away rather than a settings search.

### Changed

- **Headings are size, not decoration.** They had an accent bar instead of a larger type size, so
  every heading read as a quoted block and a document made of them read as a form.
- **No frames** on the provider and approval controls under the composer.
- The skills button moved to the right of the reasoning selector and became a wand: the spanner said
  "settings" and sent people looking for a preferences page.
- **On the multi-agent mode:** not built, deliberately. The modes answer "what is this allowed to
  do" and are enforced in code; "multi-agent" is a strategy, not a permission, so it would be a
  fourth mode with agent's powers and unpredictable behaviour. The capability it was for now exists
  without it.

### Removed

- **The command that opened the terminal client from the editor.** It never worked reliably enough
  to keep. The likely cause, found while removing it: in PowerShell — the default shell on Windows —
  `"C:\…\Code.exe" "…cli.js"` prints the path instead of running it, because PowerShell needs a
  leading `&` for a quoted command. The `hivey-code` CLI itself is unchanged and still launched from
  a shell.

### Fixed

- **Uninstalling left the panel on screen until a restart.** Stopping an MCP server is a child
  process being signalled and waited for, and it was registered as a `dispose()` — which the editor
  calls synchronously and does not await. It moved to `deactivate`, which the editor *does* await.
- **The screenshot harness pointed one directory too high** (`../../` from `dist-integration` is the
  repository's *parent*). VS Code does not fail on that: it scans for nested extensions, finds the
  repository, and caches the description it resolves. Everything appeared to work — and a change
  could be built, be present in the bundle, and not be on the picture, with nothing saying why.

## 0.14.0 — 2026-09-01

### Fixed

- **The band behind every line of code.** Blocks looked as though their contents were selected, and
  two attempts at "remove the fill from the code block" did not touch it — because the fill was
  never ours. VS Code injects its own stylesheet into every webview, containing
  `code { background-color: var(--vscode-textPreformat-background) }` and a `pre code` rule that
  resets the *padding* and not the background. Being an inline element, that fill paints one box per
  line, each ending exactly where its line of text ends: the shape of a selection. Found by reading
  the CSS the host injects, which is on disk next to the editor.
- **Adding context is the editor's own picker now.** The webview menu it replaces could not offer
  what the workbench offers, and was one more surface behaving almost-but-not-quite like everything
  around it. The categories follow the question people are answering: the editor, files & folders,
  the repository, earlier conversations.
- **The README screenshots use VS Code's default theme.** They were captured under a deep-navy theme
  nobody chose: the profile said `"Dark Modern"`, which VS Code does not resolve — and an
  unresolvable theme name does not fall back to the default, it leaves whatever was there. The full
  identifier is now passed, and the result is checked by sampling a pixel rather than by reading the
  setting back.

### Added

- **Skills for other languages**, grouped by family so a whole one is switched on or off in a
  gesture: **Web** (accessibility audit against WCAG, semantic markup, stylesheet review, TypeScript
  types), **Python** (pytest, type hints, docstrings, idiom), **Java** (JUnit 5, Javadoc, streams,
  null-safety), alongside the general set and IBM i. Each carries the conventions of its language —
  a prompt that says "write tests, in Java" is the generic one with a word changed, and is worth
  nothing.
- **Configuring skills** opens the editor's own multi-select picker, the way its "Configure Tools"
  does. Accepting replaces the whole selection, so ticking one family and nothing else is exactly
  "use these for this work".
- **The provider switch** under the composer: this machine, OpenRouter, Anthropic, your own gateway.
  Its colour says whether anything leaves the machine, which should never take reading to establish.

### Changed

- **Approvals and the readings moved out of the box**, onto a row under it: they are settings for the
  conversation, not parts of the message being written, and inside the border they read as controls
  of the text. Their labels are one word each — "Ask every time" truncated to "Ask ever…", which is
  worse than a word that fits.
- **Restore checkpoint is a rule across the transcript**, above the question it returns to, the way
  the editor's chat marks one. Visible without hovering, unlike every other per-message control: it
  is the only one that writes to the working tree, and something that overwrites files should not be
  discovered by accident.
- **The "latest" button** floats at the bottom of the transcript rather than at a hand-measured
  offset from the screen, so it stays put when the composer grows a row.

## 0.13.0 — 2026-09-01

The panel moves towards the editor's own chat, in behaviour as much as in looks.

### Added

- **Restore checkpoint.** Every question the agent answered by editing files carries the state of
  those files as they were before it. Restoring puts them back and rewinds the conversation to that
  point, with the question returned to the composer — the unit people undo is "that whole idea",
  not one keystroke across four files. It writes through a `WorkspaceEdit`, so the rollback is
  itself undoable with Ctrl+Z; it says what it will overwrite before it does; and when a turn
  changed something too large to record, it says the restore is partial rather than pretending.
- **The agent's plan, as a collapsible to-do.** A new `update_plan` tool the model keeps up to
  date; the panel shows the step happening now and a count of what is left, opening while the turn
  runs and closing when it is done. Exactly one step may be in progress — enforced in the parser,
  because the display has no honest way to show two.
- **A skills control in the composer.** Switch built-in and repository skills on and off, create
  one, or share them. Sharing does the two things that are actually useful — show the folder, or
  copy the files as Markdown — because a skill is a file that travels with the repository, which
  was the whole point of using files.
- **Approvals in one click**, from the same menu: ask every time, inside this folder, never ask.
  The icon carries the state, so a session left on "never ask" yesterday is visible today.
- **"At the cursor"** on every code block, alongside "Replace". They are different intentions, and
  conflating them silently deleted whatever was selected.
- **An earlier conversation, and all open tabs**, promoted into the `+` menu. Attaching every open
  tab already existed, buried under twelve file names — invisible and absent are the same thing.
- **The session's cost** beside the token count, hidden entirely on a local model where it is
  structurally zero.

### Changed

- **Attaching now searches.** The file picker was a fixed list of the first hundred files, which
  cannot find anything in a repository of any size. It is a live search over the whole workspace,
  files **and symbols** — and a symbol attaches the lines it occupies rather than its whole file.
- **The transcript stops dragging you to the bottom.** Streaming follows the answer only while you
  are already at the end; once you scroll up nothing moves you again, and a "Latest" button appears.
- **Scrollbars are thin overlays** that fade when the pointer leaves, like the workbench's own. The
  rail they replaced is where the "answers should be wider" complaint came from: the answers were
  not narrow by design, they were narrow by a reserved gutter nobody had accounted for.
- **Answers have room.** More space between blocks, and the user's question sits on a tinted card
  derived from the theme's own accent — so a long transcript is scannable without reading a word.
- **Code blocks lost a surface.** The block had a fill and its header had a different one, so code
  sat on a band inside a box; inline code had a background AND a border AND padding, three
  treatments for one idea. Colour alone now says "this is a name from the code".
- **Actions and cost live under the message, on hover** — the editor's own behaviour, and what stops
  a transcript reading as a table of controls.
- **One ring on the composer.** Focus drew an outline outside the border while the working animation
  drew a different weight inside it, so the box changed size depending on what it was doing. Both
  now draw the same thickness in the same place. The box is shorter, full-width again, and its
  placeholder is three words instead of a sentence.

### Fixed

- Skills and approvals were briefly two separate buttons, and the model name collapsed to `qwe…`
  within the hour: every icon in that row is width the one label carrying real information does not
  have. They are one menu, which is what the editor's chat does and for the same reason.

## 0.12.0 — 2026-09-01

### Added

- **Compacting a conversation.** `/compact`, or the offer that appears once the conversation fills
  two thirds of its budget: the model writes a summary that replaces the exchanges **in the
  prompt**, and nothing is deleted. Every exchange stays on screen, muted, one click from coming
  back — the mechanism [ADR-0003](docs/adr/0003-le-transcript-n-est-pas-le-prompt.md) already
  provided, so it needed no new state and no migration. The summary is pinned (it becomes the
  oldest message the moment you ask the next question, and would otherwise be the first thing
  trimmed), and the gain is **measured and shown** — `8 200 → 900 tokens` — rather than asserted.
  See [ADR-0007](docs/adr/0007-compacter-plutot-que-tronquer.md).
- **An earlier conversation as context.** A button on every row of the history attaches that
  transcript to the conversation you are in, instead of leaving for it. Fenced as untrusted, like
  any other attachment: a transcript contains whatever the assistant read while it was running.
- **Syntax colour in answers**, written by hand — no grammar engine, no runtime dependency, and no
  palette of ours: every colour is one of the editor's own variables, so a snippet reads correctly
  on a light theme, a dark one and a high-contrast one. Families rather than languages, and an
  unknown language tag is left entirely plain. RPG (fixed and free), DDS, CL and Db2 for i are
  included, columns and all. See [ADR-0008](docs/adr/0008-la-couleur-vient-du-theme.md).
- **Tables, checklists and horizontal rules** in answers, and the answer is now **rendered as it
  streams** rather than shown as raw markdown and reformatted at the end — which meant reading
  every answer twice and having the text move under your eyes as it finished.
- **Every model server on your machine, and on your network.** The picker used to list what one
  configured address served; it now lists every runtime that answers, under **“On your machine”**
  and **“On your network”** — two homes, because one works on a train and the other is somebody
  else's to reboot. A team's GPU box is declared in `hiveyCode.endpoints.servers` or from the setup
  screen, and an address on your own network counts as local: nothing billed, nothing
  pseudonymised. Choosing a model now carries its address, so a model served by a second runtime no
  longer fails on the first question.

### Fixed

- **The terminal mode never worked behind a gateway.** The editor handed the terminal client a URL
  and a model and never the provider or the key, so anyone not running a local server opened it,
  typed a question and got `HTTP 401 Unauthorized` — which reads as a broken feature rather than as
  a missing hand-off. Both halves of the contract now live in one file. The key travels in the
  process environment (never on the command line, which is world-readable on Linux and lands in
  shell history everywhere) and **only when the endpoint is remote**. If no key is stored, it says
  so *before* opening the terminal.
- **The panel stopped jumping to the left sidebar.** Pressing History — or the model picker, the
  search, the setup screen, or any editor command — in the right-hand panel revealed the
  activity-bar copy and moved the conversation there. Two ways to bring the panel forward existed
  and disagreed; there is now one, and it does nothing at all when a copy is already on screen.
- **The composer overhung the answers.** The transcript reserves a gutter for its scrollbar and the
  composer did not, so the box you type in sat that many pixels wider than everything above it. The
  gutter is now measured on the machine it runs on rather than assumed.

### Changed

- The composer is **three rows** rather than two, and its border **turns clockwise** while the model
  is answering — the only motion in the interface, and switched off for anyone who has asked their
  system for reduced motion.
- The history's filters take **one row per question**: when, then what kind. Eight chips sharing a
  line meant the grouping changed with the width of the panel.
- The context meter gains a **bar**, shown only once the conversation genuinely fills a fifth of the
  budget. At 3 % it drew a dot at the end of a grey line, which reads as a rendering fault.

## 0.11.1 — 2026-08-27

### Fixed

- **The model picker vanished from the composer** on a narrow panel. Caused by 0.10.0: the toolbar
  stopped wrapping, and the model button was the only item allowed to shrink — so it absorbed every
  pixel of pressure and collapsed to nothing, which reads as the control having been removed rather
  than as a narrow row. It now keeps a floor wide enough to stay recognisable, and the mode button
  no longer shrinks at all: "Ag…" tells the reader nothing, while a truncated model name is one
  hover away from its full id.
- **The model name is shortened** to the part someone would say out loud —
  `anthropic/claude-sonnet-4.5` rather than the whole id, `qwen2.5-coder` rather than
  `qwen2.5-coder:7b`. The vendor is repeated in the picker and the size tag is a deployment detail.
  The full id is in the tooltip.

## 0.11.0 — 2026-08-27

**Both sides, at once.**

- **The panel is now declared in the activity bar AND in the right-hand bar**, and both work at the
  same time on the same conversation. Every previous attempt at this moved it: a view container
  lives in exactly one place, so declaring one home is choosing a default rather than offering a
  choice. Declaring it twice, with one provider serving both views, is what actually offers the
  choice — open either, or both; the state lives in the extension and the panels only draw it.
- **The setup screen has a visible icon** in the title bar. It was reachable by command and from the
  model picker, and both of those are the same as unreachable for anyone who has not gone looking
  behind a "…".
- **The context meter is outside the box**, on the panel background above it. It was inside the
  border, where it still read as part of the field you type into — which is precisely what it should
  not be. It is a reading about the conversation, not a control of the message.
- Commands that need the panel now bring forward **whichever copy is on screen**, instead of always
  reaching for the activity bar's one and yanking you back to the left.

## 0.10.0 — 2026-08-27

### Changed

- **The consent to send is asked in the conversation, not in a modal.** The consent itself is not
  negotiable — it is the whole privacy argument — but a modal at the moment of sending stops the
  world for a routine action, and a question that stops the world gets dismissed rather than read.
  It now appears as a card where the answer will appear, with **Send**, **Always to this model** and
  **Do not send**. There is no "this conversation": consent belongs to a destination, and a
  conversation is not one.

  The one case that stays modal is a detected credential. Interrupting is right when something that
  looks like a password is about to leave.
- **The context meter moved above the box**, right-aligned. Inside the toolbar it sat between the
  model name and the send button and competed with both for the same few pixels.
- **The composer's toolbar no longer wraps.** Wrapping was a way to survive a very narrow panel and
  it cost more than it saved: the send button dropped to a line of its own, which reads as a broken
  layout rather than a narrow one. `hiveyCode.panel.minWidth` already stops the panel getting narrow
  enough for the question to arise, so the row refuses to break and the model name ellipsises.

### Fixed

- **The panel is back in the activity bar**, on the left, where an extension's icon belongs. Moving
  it to the secondary side bar in 0.8.0 was a mistake: a view container lives in one place at a
  time, so declaring a home is choosing a DEFAULT — and I changed the default instead of offering
  the choice. `Hivey Code: Move the panel` now opens the editor's own destination picker, which
  offers every placement it supports, in its own words, and remembers what you choose.
- **The quick-connect screen was unreachable** once dismissed. It now opens whenever the configured
  model could not answer — a remote provider with no key in the keychain — because a conversation
  that fails on its first question is a worse first impression than a screen that asks. It is also
  one click from the model picker, which is where someone goes when they want a model they cannot
  yet use. Every provider carries a link to where its key is issued.

## 0.9.1 — 2026-08-27

### Fixed

- **The `#` list vanished the moment you reached for it**, so nothing could be picked. Two causes,
  and the second is the one that mattered. The rows listened for `click`, which arrives after focus
  has moved and after anything the blur set off — by which time the row was gone. And `render()`
  empties the whole panel and rebuilds it, so *any* message from the extension destroyed the list.
  It also destroyed the half-written question underneath it, which nobody had reported because it
  looks like a slip of the hand rather than a bug. The composer's text and caret are now taken out
  before the rebuild and put back after, and the list with them.
- The logic behind the list moved into core, where it can be tested: which word is under the caret,
  and what replaces it. Ten tests, including one that parses every suggestion back — a suggestion
  the parser rejects is a trap, because the user types what was offered and nothing happens.

### Added

- **"Whole file" in the `+` menu**, alongside "Selection" — the same thing `#editor` attaches. The
  single "Active file" entry silently chose between them, so with three lines highlighted there was
  no way to attach the file they live in, which is exactly when you want to. Both entries now name
  the file, and the selection says how many lines it covers.

## 0.9.0 — 2026-08-27

### Security

- **`privacy.blockedGlobs` never blocked anything.** The glob matcher was a chain of `.replace()`
  calls, each rewriting the output of the last: the step that expanded `**/` emitted `?` and `*`,
  and the two later steps rewrote the characters it had just emitted. `**/.env*` compiled to
  `^([^/]:.[^/]*/)[^/]\.env[^/]*$` — a pattern that matches nothing at all. Every shipped default
  starts with `**/`, so `.env`, private keys, `secrets/**`, `.aws/**` and `.ssh/**` were all
  attachable and all sendable.

  There was no test on the matcher. The extension's central promise was untested and therefore
  untrue. It is now compiled in a single pass — a replacement chain cannot be safe when the
  replacement text is in the same alphabet as its input — with fourteen tests, including one that
  asserts the shipped defaults against the paths they exist to stop.

### Added — permissions the user controls

- **`hiveyCode.permissions.autoApprove`**: `off` (the default), `workspace` (changes inside the open
  folder run; commands and anything outside still ask) or `all` (nothing is asked). The middle one
  is the one worth having, and `all` asks for confirmation once, because it is the setting whose
  cost is not visible from its label until something has happened.
- **A denied list and an allowed list**, for paths and for commands. Refusals are evaluated first
  and cannot be overridden — a path on the denied list is refused even when the allowed list says
  `**/*` and approvals are off. That ordering is what makes it safe to offer the dangerous scope.
- **The two command rules pull in opposite directions, deliberately.** An allowance is narrow:
  `npm test` covers `npm test --watch` and *not* `npm test && rm -rf /`. A refusal is broad: denying
  `git push` also refuses `ls && git push`, because a refusal escaped by typing `&&` protects
  nobody. Word boundaries hold in both, so denying `rm` does not deny `rmdir`. There is a test whose
  only job is to stop a later reader merging the two functions.
- The scope and both lists appear on the **Permissions screen**, not only in the settings. Someone
  who cannot find the middle option here will find the one in the settings that says `all`.
- A denied path is about what may be **touched**; `privacy.blockedGlobs` is about what may **leave**.
  Neither is the other, and both apply.

### Fixed

- The model picker stayed open over whatever screen you moved to next. It is a floating element on
  the body, so it outlived the screen that opened it.

## 0.8.0 — 2026-08-27

### Fixed

- **Changing model failed outright** with *"Unable to write to workspace settings because no
  workspace is opened"*. Three preferences were written with `ConfigurationTarget.Workspace`, which
  throws when the editor was launched on a single file or on nothing — so the picker raised an error
  and changed nothing, which is most of a first try. The target now follows reality: the workspace
  when there is one, the user's own settings when there is not.

### Added

- **A "Recommended" group** at the top of the model picker: a handful worth using, one per family,
  each with a clause saying why. Nothing in it names a version. It holds FAMILIES with a reputation
  for code, matched against whatever the endpoint actually serves — so when a family ships a new
  version the recommendation follows it the next day, and when one stops being served it stops
  appearing. A hard-coded list would be correct today and quietly wrong in two months, which is
  worse than none, because an out-of-date recommendation looks exactly like a current one.
- **`hiveyCode.panel.minWidth`** (default 260). Below it the panel scrolls sideways instead of
  rearranging itself, so dragging the side bar narrow can no longer reshuffle the layout. `0` lets
  it shrink freely.

### Changed

- **The panel lives in the secondary side bar**, on the right, where the editor's own chat lives.
  `Hivey Code: Move the panel…` sends it back to the left for anyone who prefers that.
- **The panel's own header holds only the conversation's name, centred.** Search, new conversation,
  history and the overflow behind them are drawn by the editor one row above; drawing them again
  produced a second row that read as a mistake, because it was one. Search moved up to join them,
  and everything that was behind the panel's overflow button now sits in the editor's own.

## 0.7.0 — 2026-08-27

**Skills and sub-agents, defined by you.**

The request was "total control of the tool", and the shape that answers it is not a settings page:

```
.hiveycode/skills/review-rpg.md      instructions you invoke with /review-rpg
.hiveycode/agents/db-explorer.md     a sub-agent with its own prompt, tools and model
```

Files, for three reasons that are the whole design. They are **versioned** — a team's conventions
belong next to the code they govern, reviewed like code, arriving with a clone. They are
**readable** — a skill is prose with a header, and someone who has never seen this extension can
open one and know what it will do. And the **format is already known**: it is Claude Code's, so
anyone who has written one has written all of them.

The model is told each skill's name and description, never its contents — a dozen skills' full text
in every prompt would spend the context budget before the question. It fetches the instructions when
one applies.

### The rule that is not yours to change

A sub-agent's `tools:` line is a **request, not a grant**. Its tools are intersected with what the
current mode already allows, never added to it. A definition file arrives with a cloned repository;
if it could grant itself `run_command` in plan mode, the mode would stop being a guarantee. Listing
a tool the mode does not offer is not an error either — it is a definition written for agent mode
being used in plan mode, and it should quietly do less rather than refuse.

Whatever a sub-agent does goes through the same approver, the same egress gate and the same
pseudonymisation vault as its parent. Being called by a sub-agent is not a way around a dialog.

Skills are absent in chat mode, along with the block naming them. A skill is instructions you wrote,
but it is still a file read from the repository, and chat mode's promise is that it does not read
the repository. A promise with an exception in it is not one.

### Details that matter when you write one

- A broken file is **reported, not skipped**. A skill silently vanishing makes the assistant ignore
  instructions it never received, with no way to find out why.
- The templates are **valid definitions**, not forms of blanks — a template that does not parse is a
  trap, because the failure looks like your edit.
- An out-of-range `max-steps` is refused rather than clamped: you asked for 500, and being given 50
  without being told is worse than being told 500 is not on offer.
- Two files claiming the same name is reported, because one of them would never run.
- Edits take effect on the next turn. A definition you have to reload the window to try is one
  nobody iterates on.

## 0.6.0 — 2026-08-27

Everything here comes from Florian using the extension for the first time. That is the point of
using it: none of the nine defects below were things the 206 tests were looking for.

### A first screen that does not ask an unanswerable question

Installing this used to lead to `hiveyCode.endpoints.local` and a request for a base URL. Someone
who installed Ollama an hour ago does not know it, has no reason to know it, and guesses wrong — and
the guess fails in a way that looks like the extension being broken.

The setup screen does not ask, it reports. It knocks on the ports local runtimes actually bind —
Ollama, LM Studio, llama.cpp, vLLM, Jan, LocalAI, text-generation-webui — **on loopback only**, and
lists what answered with the models it serves. Pick one and you are done. A runtime that is running
but empty gets the exact `ollama pull` line, ready to copy, because "no model found" is a dead end.

Gateways get one card each — **OpenRouter, Anthropic and any OpenAI-compatible server** — with the
address field for the last of those. Only OpenRouter was offered at first, which told everyone with
an Anthropic account that this extension did not support them, while the code supported them all
along. An affordance that exists in the code and not on the screen does not exist.

### Fixed

- **The terminal client could not start.** It was launched with `node`, which assumes Node.js is
  installed and on the shell's PATH — an unreasonable thing to require of someone installing a VS
  Code extension, and it fails as "command not found", which reads as a broken feature. It now runs
  on the Node that VS Code itself runs on (`process.execPath` with `ELECTRON_RUN_AS_NODE`), so there
  is no prerequisite at all. Paths are quoted, because "Program Files" exists.
- **Deleting the last message of a conversation did not save.** The persistence skipped an empty
  session on the reasoning that there was nothing to write; what it did was leave the *previous*
  version — with the messages just deleted — in storage. Reopening brought them all back. Emptying a
  conversation now removes it. Nine tests cover what "the history works" actually means.
- **The settings had no way to connect an account.** Keys deliberately live in the OS keychain
  rather than in `settings.json`, which syncs and gets committed — but nothing in the settings said
  so or offered a way in. There is now an Accounts entry linking to each command.
- **The ellipsis in the panel header was barely visible.** Not a colour problem: it is
  `currentColor` like its neighbours. It was three zero-length segments at stroke-width 1.3 — a
  quarter of the ink of every other icon. A dot has to be filled to weigh the same as a line.

### Changed

- **The model picker shows price and nothing else.** The curated quality index is gone, and deleted
  rather than hidden: a hundred and fifty lines of hand-tuned numbers that no screen reads are not an
  asset. The colours changed too, and for a reason worth recording — `--vscode-charts-*` are *fill*
  colours, meant to sit behind a legend as a solid block. At eleven pixels of text they are muddy,
  and `charts.orange` is a dark amber that disappears on a dark background. The badges now use the
  tokens the editor uses for text it needs you to read.
- **The conversation's name is editable**: double-click it, press F2, or use the pencil. A title the
  assistant guessed from your first question is a guess, and a guess you cannot correct is what you
  scroll past in the history a week later looking for something else. The local/remote badge beside
  it is gone — it said the same thing for weeks at a time, and the composer already names the model.
- **"Attach all open files" is first in the context menu** and says how many there are and roughly
  what they cost. It used to sit below twelve file names, where the only people who found it were
  the ones who no longer needed it.
- **The panel header reads "Hivey Code"**, not "Hivey Code: Chat".
- **The panel can move to the secondary side bar**, from its own overflow menu.

## 0.5.2 — 2026-08-27

- Removed `copilot` from the manifest's keywords. Using a competitor's trademark as search metadata
  is descriptive rather than misleading, and plenty of extensions do it — but the Marketplace
  forbids metadata that suggests affiliation, and the phrase carries no information this extension
  needs to convey. The comparison stays in the README, where it is an argument rather than a tag.
- The keywords now say what the thing is (`coding assistant`, `inline completion`), where the model
  runs (`ollama`, `local llm`, `offline`), why someone is looking (`privacy`, `gdpr`,
  `confidential`) and who nobody else is serving: `ibm i`, `as400`, `rpgle`, `sqlrpgle`,
  `db2 for i`, `arcad`. That last group is the one that will actually find its audience.

## 0.5.1 — 2026-08-27

- The repository is `FlorianMartins/hivey-vscode`. It was `hivey-code`, one hyphen away from
  `HiveyCode` — the web IDE — which is a distinction nobody should have to make at a glance. The
  extension itself is unchanged: still **Hivey Code**, still `hivey.hivey-code`.
- Removed a menu entry pointing at `hiveyCode.askWith`, a command that is registered in code and
  deliberately not declared in the manifest. Hiding an undeclared command with `when: false` hides
  nothing — a command absent from `contributes.commands` never reaches the palette — and it put
  *"Menu item references a command … which is not defined"* in every user's extension host log.

## 0.5.0 — 2026-08-27

**Renamed to Hivey Code.**

The name was the only thing that changed, and it changed for a reason worth writing down: the
Marketplace already carries six extensions with "Forge" in the name, one of them an AI coding agent
called *Forge Code* with several thousand installs. The identifier `hivey.forge` was in fact free —
uniqueness is per publisher — so nothing forced this. Being findable, and not being mistaken for a
competitor, did.

- Display name **Hivey Code**, identifier `hivey.hivey-code`.
- Settings move from `forge.*` to **`hiveyCode.*`**. Nothing migrates them: nobody had installed
  0.4.0, so the cost of a clean break is zero today and would not have been in a month.
- Commands move from `forge.*` to `hiveyCode.*`, under the category **Hivey Code**.
- The terminal client is `hivey-code`, with **`hivey`** as a short alias — a command typed daily
  should be short, and a command in documentation should be unambiguous.
- The per-project configuration file is `.hiveycode.json`, and repository rules may live in
  `.hiveycode/instructions.md`.
- The repository is now `FlorianMartins/hivey-vscode`. GitHub redirects the old address.

### What the rename found

A blanket search-and-replace is a bad way to rename a product, and the tests are what made it a
tolerable one. Three integration tests failed immediately on
`getConfiguration("hivey-code")` — the settings namespace is `hiveyCode`, so every setting silently
read its default instead of failing. The literal was hard-coded in five places for three *different*
meanings: the settings namespace, the MCP client's name, and a label in the terminal client. They
now refer to the single definition, so the next rename cannot reintroduce this.

The same pass turned `.forge.json` into `.hiveyCode.json` — a dotfile with a capital letter, which
behaves differently on Linux and on macOS. It is `.hiveycode.json`.

## 0.4.0 — 2026-08-27

**Speaks IBM i, plugs into the tools around it, and looks like the editor it lives in.**

### IBM i

- The **dialect is detected from the member, not from its name** — `**FREE` in column 1, or a
  specification letter in column 6. `.rpgle` covers both fully free and fixed-format source, and
  telling a model the wrong one produces code the compiler cannot place.
- Its rules and its **column ruler** go into the prompt: RPG III, ILE RPG fixed and free, SQLRPGLE,
  CL/CLLE, DDS for physical, logical, display and printer files, Db2 for i, ILE COBOL, command
  definitions.
- **Symbols are read by column.** A P specification is the letter P in column 6 with the name in
  7-21; a line-anchored regex finds nothing, so an IBM i repository used to produce an empty
  repository map — the one codebase where a map is worth the most.
- A local check reports the failure the compiler does not: a line past column 80 is truncated and
  compiled, not rejected.
- `/tofree`, `/sql` and `/dds`; `#member:LIB/SRCFILE(MBR)` and `#db2:…`.

### The tools around it

- **Git** through the editor's own extension: status, diff, log, blame, show, branches, stage,
  commit. Never push — publishing a branch stays the user's decision.
- **Code for IBM i**: Db2 for i, CL commands, source members, object lists, library list — on the
  connection it has already negotiated. Hivey Code opens no session of its own.
- **ARCAD Elias**: ten actions through the `arcad.*` commands Elias registers, plus calls to the
  REST server already configured in `arcad.restApiServer.*`. Hivey Code does not invent ARCAD's
  endpoints; it carries requests to paths you supply, with credentials from the OS keychain.
- **MCP**, stdio and HTTP, written by hand. A stdio server is arbitrary code execution configured in
  a file that may have arrived with a repository: it does not start until you have agreed in a
  dialog that names the command, and the consent is tied to the command, not to the name.

### The panel

- The **model picker** in the shape the Hivey sidebar settled on: a read-only trigger opening a
  panel with a metric header, its own search box, grouped rows, a badge whose segments are coloured
  independently, and a collapsible price/provider filter. Colour comes from the theme rather than
  from hex values, and the quality metric follows the **mode** — agent re-ranks by how well a model
  drives a tool loop.
- `#context` and `@participant`, in Copilot's notation, resolved on this machine before anything is
  sent. `#` no longer opens a file dialog — a dialog can only ever offer files, which is why
  `#changes` could not exist before.
- House rules from `.github/copilot-instructions.md`.
- Turns are separated by space rather than by a rule; the composer's two toolbar rows become one
  that wraps; each turn carries a shape rather than a colour, so it survives high contrast.
- Export the conversation as Markdown, including the exchanges you muted — a record of a
  conversation nobody had would be worse than no record.

### Fixed

- The credential scanner flagged thirteen of its own strings: in a codebase about language models,
  `token` means a unit of context far more often than a bearer token. Fixed in the detector — no key
  ever issued opens with `#`, `@`, `/` or `\`, or ends with a colon.
- `hiveyCode.pickModel` was registered twice, which fails activation outright. Only a run inside a real
  editor shows that.
- Screenshots are taken by `scripts/screenshots.mjs` from a real VS Code, driven by a marker file
  rather than by two clocks in two processes — the drift used to produce three photographs of the
  same frame.

193 tests, 9 of them inside a real VS Code.

## 0.3.0 — 2026-08-21

**English interface, and a translation that cannot silently rot.**

- The interface is now English in the source, with French as a translation: one catalogue
  (`src/shared/i18n.fr.ts`) for the panel, the extension and the terminal client, plus
  `package.nls.json` / `package.nls.fr.json` for the manifest. It follows VS Code's display
  language.
- A test reads the source and fails when a string has no entry in the catalogue, and another fails
  on entries for strings the code no longer uses.
- The system prompts no longer assume the user writes French: the assistant answers in whatever
  language the question was asked in.
- `hiveyCode.language` pins the interface language independently of the editor's, which is also what
  makes the translated interface testable without installing a VS Code language pack.
- Command words in the terminal client stay untranslated — `/mute` and `/muet` both work, because a
  command that moves with the interface language is a command nobody can rely on.

## 0.2.0 — 2026-08-21

**Renamed to Hivey Code, and the panel rebuilt around what the assistant may do.**

- Four screens — conversation, history, models, permissions — in the editor's own visual language.
  Not one hex colour: every value is a VS Code theme variable. Icons are inline SVG (Unicode glyphs
  rendered as empty boxes in the editor's UI font).
- **Modes** (chat / plan / agent) decide the tool set *in code*: plan mode has no writing tool to
  reach for.
- **Permissions** apply to the shape of an action, never to one occurrence: trusting `npm test`
  does not trust `npm publish`, and a refusal always wins.
- **Reasoning** is a budget the user sets, translated per provider — an effort word for OpenRouter,
  a token budget for Anthropic.
- **Model picker** with input, output and cache prices side by side, plus what the local endpoint
  actually serves. Opening it sends no request anywhere.
- **Search** inside the open conversation and across the history; history filters by period, mode
  and cost, with four sort orders.
- Context menu: active file, open tabs, disk import, VS Code's own file picker.
- Settings, commands and storage keys moved from `hiveyForge.*` to `hivey-code.*`.

### Fixed

- The egress gate fell back to the **unredacted** messages when the user refused mid-turn — that
  is, it sent the data precisely when the answer was “do not send it”. It now aborts the turn.
- Inline completion sent the raw prefix and suffix; on a remote endpoint that was the one path that
  skipped pseudonymisation.

## 0.1.0 — 2026-08-21

First working version: reversible pseudonymisation, providers (Ollama, LM Studio, vLLM, LiteLLM,
OpenRouter, Anthropic), local-first routing with consented escalation, per-request and daily
budgets, inline fill-in-the-middle completion, sidebar chat with an agent mode, editor commands,
a terminal client, an egress log and a cost report — with no runtime dependency and no telemetry.
