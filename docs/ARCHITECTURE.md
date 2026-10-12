# Architecture

Ce document explique **pourquoi** le code est découpé ainsi. Le découpage lui-même se lit dans
l'arborescence ; ce qui ne s'y lit pas, ce sont les contraintes qui l'ont produit.

## La règle qui structure tout : `src/core/` ignore l'éditeur

Aucun fichier de `src/core/` n'importe `vscode`. Ce n'est pas une élégance, c'est ce qui rend trois
choses possibles :

1. **Tester le comportement sans éditeur.** Le budget, l'anonymisation, la boucle d'agent, le cache
   de complétion et la dérivation du prompt sont testés en millisecondes avec `node:test`. Un test
   qui a besoin de lancer VS Code n'est pas écrit, et un comportement non testé finit par dériver.
2. **Faire tourner le même produit dans un terminal.** `hivey-code` (`src/cli/`) réutilise le noyau tel
   quel. C'est aussi la vérification honnête du découpage : si une règle ne marche que dans la barre
   latérale, c'est qu'elle était au mauvais endroit.
3. **Auditer une surface réduite.** Une équipe sécurité qui veut savoir ce qui sort lit
   `core/redaction/` et `extension/egress.ts`, pas 4 000 lignes d'interface.

```
                      ┌───────────────────────┐
   VS Code  ─────────►│  src/extension/       │─┐
                      │  barre latérale,      │ │
                      │  complétion, commandes│ │
                      └───────────────────────┘ │     ┌──────────────────┐
                                                ├────►│    src/core/     │────► HTTP
                      ┌───────────────────────┐ │     │ (aucun `vscode`) │
   Terminal ─────────►│  src/cli/             │─┘     └──────────────────┘
                      └───────────────────────┘
```

## Les idées qui structurent le code

### 1. Le transcript n'est pas le prompt

`core/session/session.ts`. La conversation est un journal que l'utilisateur possède ; ce que le
modèle voit en est **dérivé** à chaque tour. D'où trois actions qui n'existent pas ailleurs :

- **muet** — l'échange reste à l'écran, sort du prompt ;
- **supprimer** — il quitte le journal ;
- **épingler** — il survit à la coupe quand le budget de contexte est atteint.

Conséquence directe : une mauvaise réponse cesse d'empoisonner les dix suivantes *et* d'être
refacturée à chaque tour. Ce qui a été coupé faute de place est **rapporté**, jamais oublié en
silence.

### 2. Un seul endroit où des messages deviennent une requête

`core/agent/loop.ts` appelle `beforeRequest` juste avant chaque appel réseau, et rien d'autre ne
construit de requête. C'est ce qui permet d'affirmer « visible par le modèle ⇒ anonymisé » par
construction plutôt que par vigilance. La boucle, elle, ignore :

- **ce que fait un outil** (les outils sont injectés — l'éditeur en donne sept, le terminal six) ;
- **ce qui est permis** (l'approbation est un rappel : la boucle demande, elle ne décide pas) ;
- **ce qui peut sortir** (l'anonymisation est un rappel).

Un outil refusé ou en échec renvoie un **résultat** au modèle. Un appel sans résultat est une erreur
de protocole chez la plupart des fournisseurs et un blocage silencieux chez les autres.

### 3. Le mode décide de l'outillage, pas le prompt

`core/session/modes.ts`. Trois modes, et la différence entre eux est ce que l'assistant **peut**
faire, pas à quel point il est malin : `chat` n'a aucun outil, `plan` n'a que les outils qui
observent (liste blanche explicite : un outil neuf est sans pouvoir tant qu'il n'y est pas nommé),
`agent` a tout. Un modèle en mode Plan qui déciderait d'écrire un fichier ne trouve aucun outil pour
le faire. Le prompt ne fait que décrire le mode dans lequel il est déjà.

Les permissions (`core/agent/permissions.ts`) sont la deuxième moitié : elles portent sur la
**forme** de l'action, jamais sur une occurrence. Autoriser `npm test` n'autorise pas `npm publish`,
et un refus l'emporte toujours sur une autorisation.

### 4. Local d'abord, escalade sur un échec **constaté**

`core/router/route.ts` décide *avant*, `core/router/outcome.ts` décide *après*, et la seconde moitié
est celle qui manquait.

L'escalade a priori reste : la complétion, les embeddings et les corvées **ne s'escaladent jamais**
— c'est le trafic fréquent, et c'est exactement ce qu'un modèle 7 B fait bien. Une question de
discussion peut s'escalader sur un signal explicite (contexte plus grand que la fenêtre locale) et
selon une politique `never` / `ask` / `auto`.

Mais un pari pris sur la formulation d'une question se trompe dans les deux sens : il paie pour une
question facile qui contient le mot « architecture », et il laisse en local une question difficile
formulée simplement. Surtout, il n'apprend rien — rien ne pouvait constater que la tentative locale
avait échoué, parce que jusqu'à la 0.39.0 l'éditeur ne savait pas lire la sortie d'une commande.

`verifyTurn()` lit ce que le tour a **fait** : quelles commandes ont tourné, ce qu'ont dit les
diagnostics, si le même appel a échoué trois fois de suite. Une seule subtilité, et elle est le
cœur : la règle est « le **dernier** mot de chaque type de vérification ». Un agent qui lance les
tests, les voit échouer, corrige et les relance a un échec dans sa trace et un dépôt qui marche —
escalader là-dessus paierait un modèle distant pour refaire du travail fini, sur la majorité des
tours réussis. Ce qui compte est l'état dans lequel le tour se termine.

Quand l'échec est prouvé, le modèle distant reçoit le **diff de ce que la tentative a laissé sur le
disque** et l'erreur produite. Sans cela il lit la version d'origine dans le transcript, réécrit le
changement qui est déjà là, et annonce que c'est fait.

### 4bis. Ce qui se passe quand personne ne répond

`core/router/fallback.ts`. Un 429 terminait le tour — et le préréglage gratuit route justement vers
des points d'accès gratuits *parce qu'ils* sont limités en débit. La requête descend maintenant une
chaîne : le rôle moins cher du même préréglage, puis la machine. Deux règles l'empêchent d'être une
façon de dépenser par accident : un repli est toujours **moins cher ou égal**, jamais vers un modèle
que l'utilisateur n'a pas choisi, et il ne se déclenche que sur un échec qui veut dire « pas
maintenant » (429, 5xx, socket morte). Un 400 veut dire que la requête est mauvaise, et l'envoyer
ailleurs l'envoie deux fois.

Il ne se déclenche pas non plus une fois qu'un mot est arrivé à l'écran : un tour qui a déjà diffusé
une phrase ou lancé un outil ne peut pas être rejoué ailleurs sans répéter les deux.

### 5. Une carte, pas le territoire

`core/context/repomap.ts`. Les symboles de tête sont extraits par expressions régulières et non par
un parseur. L'objection est juste — un regex n'est pas un parseur — et le compromis est assumé :
tree-sitter coûte un binaire natif par plateforme ou un WASM, pour une carte dont le rôle est de
dire « il existe une fonction `parseInvoice` dans `billing/parse.ts` ». Dans VS Code, quand un
serveur de langage a déjà ouvert le fichier, ses symboles sont préférés.

Le classement met en tête le fichier édité, ses voisins de dossier, ce qu'il importe, ce qui
l'importe, ce que ses imports importent à leur tour, puis les fichiers ouverts et récemment
modifiés — et surtout **ce que la question nomme**, chemins et symboles déclarés, derrière une liste
de mots vides sans laquelle « corrige l'erreur dans ce fichier » promeut tous les fichiers à la fois.

Le signal le plus fort était le seul à ne pas être utilisé : « le total de la facture est faux »
était traité comme n'importe quelle question, et la réponse était classée autour de l'onglet ouvert.

Le graphe d'imports, lui, ne s'était **jamais** déclenché sur ce dépôt : il comparait un
spécificateur `./helper.js` à une racine de chemin `src/helper`, or dans un projet TypeScript ESM
tout import finit en `.js` et tout fichier finit en `.ts`. Découvert en écrivant le test du
classement au second degré, pas en relisant le code.

### 5bis. Le préfixe est gelé, parce que le cache se paie à l'octet près

`core/prompts.ts` (`stablePrompt` / `turnDirectives`) et le gel de la carte dans
`extension/chat.ts`.

Tous les caches de prompt fonctionnent sur un **préfixe** : le cache est touché jusqu'au premier
octet qui diffère, et manqué sur tout ce qui suit. Une seule ligne du prompt système qui suit
l'onglet ouvert ne coûte donc pas cette ligne — elle coûte **tout le préfixe**, à chaque tour, carte
du dépôt comprise, chez les fournisseurs qui facturent le manque. Deux choses s'y trouvaient et
changeaient : la note de dialecte, dérivée des fichiers joints, et la carte elle-même, reclassée
autour de l'onglet de devant.

Le prompt se construit maintenant en deux moitiés par une fonction qui prend les parties stables
comme **champs nommés** : ajouter « juste une ligne sur le fichier ouvert » redevient un changement
qu'un relecteur voit. La carte est gelée pour la durée d'une conversation et reconstruite seulement
aux moments où le préfixe est de toute façon réécrit — nouvelle conversation, compactage, demande
explicite. Une carte en retard d'un changement d'onglet ne coûte rien : ce sont des chemins et des
symboles, le modèle peut lire n'importe quel fichier, et le classement ne décide que de ce qu'il
voit **en premier**.

Rien de tout cela ne se lit dans le code, ce qui est la raison pour laquelle l'invariant est tenu par
un test d'intégration qui compare le premier message de deux requêtes **octet par octet**.

### 6. Zéro dépendance à l'exécution

Le SSE, le glob, le diff, l'estimation de jetons, le rendu Markdown du panneau : écrits à la main.
Un assistant censé protéger une entreprise de la fuite de son code ne peut pas lui demander de faire
confiance à un arbre de dépendances transitives. Les quatre paquets présents (`typescript`,
`esbuild`, `@types/*`) ne sortent jamais du poste de développement, et le `.vsix` publié ne contient
que du code de ce dépôt.

## Le trajet d'une requête distante

```
question  ─►  session.build()      transcript → messages (muets exclus, coupe rapportée)
          ─►  route()              quel modèle, et faut-il demander une escalade
          ─►  gate.prepare()       ① globs interdits  ② anonymisation  ③ refus  ④ consentement
          ─►  budget.check()       estimation avant l'appel
          ─►  runTurn()            appel, outils, ré-anonymisation à chaque étape
          ─►  vault.restore()      les marqueurs redeviennent les vraies valeurs, chez vous
          ─►  budget.record()      coût réel (fourni par OpenRouter, estimé sinon)
          ─►  gate.record()        journal : métadonnées, chaînées, jamais de contenu
          ─►  verifyTurn()         le tour a-t-il échoué ? si oui, et seulement si oui, on escalade
```

Et deux embranchements qui n'existent que quand quelque chose ne va pas :

```
  provider refuse (429, 5xx, socket)  ─►  fallbackChain()  ─►  même préréglage moins cher ─► machine
  le tour finit sur une vérification qui échoue  ─►  handoverNote()  ─►  diff + erreur ─► modèle plus grand
```

## Comment on sait que ça marche

Trois niveaux, et ils ne mesurent pas la même chose.

- **`node:test` sur `src/core/`** — 562 tests, en millisecondes, sans éditeur. Ils tiennent les
  règles : ce qu'un budget refuse, ce qu'une anonymisation attrape, ce qu'un verdict d'échec dit.
- **Les tests d'intégration** — 27, dans un vrai VS Code lancé sans affichage. Ils tiennent le
  câblage, c'est-à-dire l'endroit où vivent les vrais défauts : la sortie d'une commande revient-elle
  vraiment, le préfixe est-il vraiment identique d'un tour à l'autre, l'escalade part-elle vraiment
  vers l'autre modèle. Chacun de ces trois-là a été vérifié en **retirant le correctif** et en
  constatant que le test tombe — un test qui passe dans les deux cas ne prouve rien.
- **`eval/`** — ce que les deux précédents ne peuvent pas dire : est-ce que la **réponse** est bonne.
  Quinze petits dépôts cassés, une commande par tâche qui décide si le résultat marche, et le harnais
  pilote le vrai client terminal — une évaluation qui aurait sa propre boucle mesurerait
  l'évaluation. La règle qui donne un sens aux chiffres tourne à chaque commit : **le contrôle de
  chaque tâche doit échouer sur la version non modifiée**, sans quoi la tâche note tout le monde à
  100 % et personne ne le voit.

## Ce qui est délibérément absent

- **Pas d'index vectoriel.** Il faudrait soit calculer des embeddings sur le poste (lent, faux dès
  qu'on change de branche), soit envoyer le code à une API d'embeddings — exactement ce que
  l'extension existe pour éviter. La carte du dépôt plus une recherche ciblée couvrent le besoin.
- **Pas de participant `chat` natif VS Code.** L'API dépendait de l'extension Copilot ; un panneau
  webview donne le contrôle total sur ce qui est affiché et ce qui est envoyé.
- **Pas de police d'icônes.** Le panneau dessine ses icônes en SVG inline. La première version
  utilisait des glyphes Unicode et la moitié s'affichait en carrés vides dans la police d'interface
  de l'éditeur.
- **Pas de télémétrie.** Aucune, même anonyme, même optionnelle. Le seul compteur est local :
  suggestions demandées / acceptées, dans l'infobulle de la barre d'état.
