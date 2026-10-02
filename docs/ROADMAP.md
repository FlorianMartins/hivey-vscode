# État et suite

Honnête plutôt que flatteur : ce qui marche, ce qui manque, ce qui n'est pas vérifié.

Ce document décrit l'état à la version **0.74.0**. Les chiffres qu'il annonce — version, tests, tâches d'évaluation — sont
vérifiés par `npm run check:numbers`, que la CI exécute : ils ne peuvent plus vieillir en silence.
Il était resté figé à `0.3.0` pendant trente-cinq
versions, ce qui est sa propre leçon : une feuille de route périmée dit « projet abandonné » à
quelqu'un qui l'ouvre, et elle le dit avant que la moindre ligne de code soit lue.


## Feuille de route pilotée (docs/PROMPT-ROADMAP.md)

Les chantiers de `docs/PROMPT-ROADMAP.md`, avec leur état. Chaque point est classé **testé**,
**vérifié à la main** ou **non vérifié** ; ce qui exige une partition IBM i, un GPU ou un service
externe non exécuté ici est « non vérifié ».

### Phase 0 — Fondations

| Chantier | État | Vérification |
|---|---|---|
| 0.1 Marqueurs dans les arguments d'outils | fait | **testé** (unitaire, retombe sans le correctif) ; intégration impossible ici — la porte de sortie est sautée en loopback, donc aucun coffre peuplé ; invariant gardé par un test qui lit le source |
| 0.2 Marqueur coupé entre deux fragments | fait | **testé** (toutes les positions de coupure, fin de flux, arrêt ; retombe sans le correctif) ; câblage gardé par un test qui lit le source |
| 0.3 Fermer `QSH` dans la garde IBM i | fait | **testé** (les quatre cas du prompt, plus le shell enveloppé et le faux positif `QSHELLDOC`) ; retombe sans le correctif. Non vérifié sur une vraie partition |
| 0.4 Suite de tests sous Node 22 | fait | **non vérifié ici** — seul Node 18 est installé sur cette machine ; la matrice de CI (18, 20, 22 + Windows) l'établira. Invariants gardés par deux tests |
| 0.5 Des chiffres qui ne peuvent plus vieillir | fait | **testé** — le contrôleur refuse un chiffre faux et le répare (prouvé dans les deux sens) ; son câblage en CI est gardé par un test |
| 0.6 Mesurer la qualité sur de vrais modèles | fait (harnais) | **testé** — rapport JSON+Markdown prouvé de bout en bout contre un faux serveur de modèle ; les règles « n'invente aucun chiffre » tenues par 9 tests dans `core` ; banc porté à 40 tâches, 40/40 échouent sur la fixture intacte **et** passent sur leur solution (deux portes de CI). ⚠️ **non mesuré** : aucun modèle réel joignable d'ici — les chiffres de qualité restent à produire |

### Phase 1 — Dépasser IBM Bob sur IBM i

| Chantier | État | Vérification |
|---|---|---|
| 1.1 Boucle compiler, lire, corriger | fait | **testé** — 37 tests : table des commandes, analyseur sur RPG III / ILE fixe / ILE libre / SQLRPGLE / CL / DDS, piège du sommaire (retombe sans la règle), noms refusés plutôt qu'échappés, les trois sources et leurs chemins d'échec, le journal lu pour le bon travail, verdict dans `verifyTurn` (retombe sans le câblage). ⚠️ **non vérifié** : fixtures **construites** d'après les dispositions documentées, pas enregistrées sur une partition ; aucune exécution réelle possible ici |
| 1.2 Tests unitaires RPG exécutés | fait | **testé** — 17 tests : présence demandée au catalogue, RPGUnit absent → l'outil le dit et ne simule rien, catalogue illisible traité comme un **troisième cas**, nom de procédure ≠ nom d'objet, analyseur sur fixtures (sortie non reconnue comptée comme non lue, jamais convertie en succès), verdict dans `verifyTurn` séparé de celui de la compilation (retombe sans le câblage), `/rpgtest` finit sur l'exécution. ⚠️ **non vérifié** : le texte imprimé par `RUCALLTST` n'est pas connu de première main — la conception est faite pour que l'ignorer soit sans danger ; aucune exécution réelle possible ici |
| 1.3 Analyse d'impact | fait | **testé** — 23 tests : sortie dans QTEMP acceptée par la garde production verrouillée, QTEMP ne blanchit pas les autres bibliothèques de la commande, membre de sortie remplacé et non complété, lecture bornée, lignes DSPPGMREF lues sous plusieurs orthographes, référence sans bibliothèque conservée, méthode en première ligne, zéro jamais rendu par « rien ne l'utilise », présence en liste blanche du mode Plan, l'outil fait passer sa propre commande par la garde (tout retombe sans les correctifs). ⚠️ **non vérifié** : aucune exécution réelle ; **et les références croisées ARCAD ne sont pas appelées** — catalogue REST non publié, la réponse nomme la porte au lieu d'inventer un chemin |
| 1.4 Performance Db2 for i | fait | **testé** — 16 tests : requêtes et échappement des quotes, lecture des lignes sous plusieurs orthographes, index temporaire reconnu comme le signal le plus fort, **un chiffre absent reste absent** (trouvé par un test), taille avant conseil, « aucun conseil » jamais rendu par « les index sont bons », les 5 mises en garde présentes dans chaque réponse, `CREATE INDEX` soumis à la garde, `/sql` n'ose plus proposer un index sans l'outil. ⚠️ **non vérifié** : aucune exécution réelle |
| 1.5 Messages et documentation de la maison | fait | **testé** — 16 tests : fichier de messages par préfixe, préfixe inconnu cherché partout, second niveau conservé, identifiants cités extraits des notes, note citante rendue avec la ligne suivante, **les deux autorités étiquetées et dans l'ordre**, silence de la doc dit explicitement, lacune ≠ absence. ⚠️ **non vérifié** : aucune exécution réelle |
| 1.6 Au moins 40 compétences IBM i | fait | **testé** — 40 compétences (14 RPG, 7 DDS, 11 Db2 for i, 8 CL), chacune **déclarant** la tâche qui l'éprouve ; 5 tests : le compte et sa répartition, la tâche existe sur le disque, c'est bien une tâche IBM i, les lacunes sont ≤ 4 et disent ce qui manque (retombe en retirant un adossement). Banc 40 → **51 tâches**, 51/51 honnêtes dans les deux sens. ⚠️ **non vérifié** : aucune compétence exécutée contre un modèle réel ; 2 compétences (`/impact`, `/whouses`) ont une **lacune déclarée** — elles exigent une partition vivante |
| 1.7 Livraison par ARCAD | fait | **testé** — 10 tests : compiler puis tester comme préconditions, « c'est le dernier qui compte », l'ordre réintégration → construction, et **la garantie** : un test lit la liste blanche d'actions `arcad.*` dans le source et refuse toute promotion (prouvé en ajoutant `arcad.promoteToProduction` : le test rougit). ⚠️ **non vérifié** : aucune installation ARCAD ici |


## Comment lire les affirmations ci-dessous

Trois niveaux, jamais mélangés :

- **testé** — un test automatisé échoue si ça casse, et il a été vérifié en retirant le correctif ;
- **vérifié à la main** — observé fonctionner ici, sans test de non-régression ;
- **non vérifié** — écrit, cohérent, jamais exécuté dans les conditions réelles. Il y en a, ils sont
  nommés.

## Fait

### Remettre à ARCAD, sans jamais promouvoir (0.74.0)

- **`/deliver` prépare la remise dans l'ordre qui a une raison** (testé) : compiler, tester,
  réintégrer, demander la construction — une construction demandée avant la réintégration construit
  la version précédente et annonce une réussite.
- ⚠️⚠️ **La promotion vers la production n'est pas un outil de l'agent** (testé, retombe si on ajoute
  une commande de promotion) : la garantie tient à la liste blanche lue **dans le source** par un
  test, pas à une consigne. Et le refus dit qui le fait à la place.


### Quarante compétences IBM i, et la tâche derrière chacune (0.73.0)

- **40 compétences IBM i** (testé : le compte, la répartition par famille, l'existence de la tâche,
  sa famille). Une compétence est quelques lignes de texte — donc chacune **déclare** la tâche
  d'évaluation qui l'éprouve, et un test le lit, pour que la quarante-et-unième ne soit pas adossée
  à rien en silence.
- **51 tâches d'évaluation**, dont 21 IBM i, toutes honnêtes dans les deux sens.
- **Deux lacunes déclarées** et non cachées : `/impact` et `/whouses` exigent une partition vivante.
- ⚠️ **Non vérifié** : aucune compétence exécutée contre un modèle réel.


### Ce que la base sait déjà, et ce que ça ne veut pas dire (0.72.0)

- **`ibmi_index_advice` lit la liste de souhaits de l'optimiseur** (testé ; **non vérifié** sur une
  partition) et ne recommande rien : chaque réponse porte ce que le conseiller ne veut pas dire.
  `/sql` ne propose plus d'index sans l'avoir consulté.
- **`ibmi_message` joint le texte IBM et la note maison, étiquetés** (testé) — parce qu'une
  procédure interne de 2011 ne doit pas être présentée avec l'autorité d'un manuel.
- **Un chiffre absent reste absent** (testé) : une colonne que le catalogue n'a pas renvoyée ne
  devient pas zéro.


### Qui utilise ceci (0.71.0)

- **`ibmi_impact` répond au niveau objet et au niveau champ** (testé ; **non vérifié** sur une
  partition), et les deux réponses ne valent pas la même chose : l'une est un fait enregistré par le
  compilateur, l'autre une recherche dans les sources lisibles. La méthode est en première ligne et
  les limites sont écrites, parce que ce résultat finit dans une demande de modification.
- **`QTEMP` est la seule bibliothèque qu'un outil en lecture peut écrire, et la garde le sait**
  (testé, retombe sans la règle) — et l'outil fait passer sa propre commande par la garde.
- **Trouver zéro n'est jamais « rien ne l'utilise »** (testé).
- **`/impact`** pose la question avant de proposer un changement.


### Les tests de la maison, exécutés (0.70.0)

- **`ibmi_test` lance RPGUnit et son échec est un verdict** (testé ; **non vérifié** sur une
  partition). Un programme qui compile et rate ses tests n'est pas fini, et les deux verdicts sont
  séparés : la compilation réussie ne couvre pas l'échec des tests.
- **L'outil refuse d'être rassurant** (testé) : RPGUnit absent → il le dit et n'exécute rien ;
  catalogue illisible → un troisième cas, pas « pas installé » ; sortie non reconnue → comptée comme
  non lue et jamais rendue par « aucun test n'a échoué ».
- **`/rpgtest`** écrit les cas, les compile et les **exécute** — et `/compile` n'invente plus sa
  commande.


### Compiler est un verdict (0.69.0)

- **`ibmi_compile` compile sur la partition et rend les erreurs du compilateur** (testé sur
  fixtures ; **non vérifié** sur une vraie partition). La commande vient du type du membre ; un type
  inconnu est refusé plutôt que compilé avec le compilateur le plus proche.
- **Une compilation est une vérification du tour** (testé, retombe sans le câblage) : la dernière
  compte, donc corriger puis recompiler n'est pas un échec, et une compilation encore rouge à la fin
  achète l'escalade avec la liste d'erreurs.
- **Trois sources, et une lacune nommée plutôt qu'un silence** (testé, y compris chaque chemin
  d'échec) : la sortie de la commande, la liste spoulée — la seule qui porte des numéros de ligne —
  et le journal du travail, lu pour **le travail que le spoule désigne** et non pour le travail
  courant.
- **Les noms sont refusés, pas échappés** (testé) : ils viennent du modèle et finissent dans une
  commande CL et dans du SQL.


### Mesurer la qualité, sans pouvoir se mentir (0.68.0)

- **Un rapport d'évaluation par tâche et par modèle** (testé) : durée, étapes, jetons, coût, et
  comment le tour s'est arrêté. Les chiffres viennent du tour lui-même, pas d'une estimation —
  le client terminal les écrit, dans un fichier placé hors de la copie de travail pour que la mesure
  ne fasse pas partie de ce qui est mesuré.
- **Le rapport ne peut pas inventer un chiffre** (testé) : un modèle local est *non tarifé* et
  jamais gratuit, un total incomplet est marqué comme un plancher, et une campagne sans modèle dit
  « not measured » sans aucun tableau. Un test exige qu'un rapport vide ne contienne pas `0 %`.
- **40 tâches, honnêtes dans les deux sens** (testé) : chacune échoue sur la fixture intacte et
  passe sur sa solution de référence. La seconde porte a trouvé quatre contrôles que *rien* ne
  pouvait satisfaire, dont un vieux de plusieurs semaines.
- **Un contrôle structurel regarde le code et pas la prose** (testé) : `eval/bin/codeonly`, sur le
  PATH des contrôles et dans le dépôt plutôt que dans la fixture — un outil que l'agent peut
  modifier n'est pas un contrôle.
- ⚠️ **Non mesuré** : aucun modèle n'a été évalué. Il faut une machine qui en héberge un, ou une
  clé ; le harnais et les portes sont prêts et éprouvés contre un faux serveur.


### Les modifications atteignent le fichier (0.67.0)

- **Un chemin absolu n'est plus pris pour un chemin dehors** (testé dans un vrai éditeur ; retombe
  sans le correctif). Le résolveur refusait tout chemin absolu avec « leaves the workspace » —
  l'écriture même que l'extension donne au modèle pour un fichier qui n'est dans aucun dossier
  ouvert (`relative()` renvoie alors `uri.fsPath`), et celle des diagnostics, de la sortie du
  terminal et des piles d'appel. L'extension dictait un chemin, puis refusait le sien : le mode
  agent décrivait les modifications au lieu de les faire, et d'autant plus sûrement que le travail
  portait sur des membres IBM i ou des fichiers distants. L'appartenance est maintenant décidée en
  résolvant puis en vérifiant où le chemin a atterri ; les bords (barre oblique finale, lettre de
  lecteur, dossier voisin au nom préfixe) sont tenus par neuf tests unitaires dans `core`, hors de
  `vscode`. Voir [ADR-0014](adr/0014-un-chemin-absolu-n-est-pas-un-chemin-dehors.md).
- **Un tour d'agent qui affirme sur le contenu d'un fichier** (testé). C'était le trou par lequel le
  défaut ci-dessus est passé : les quarante tests d'intégration affirmaient tous sur ce qui avait
  été *envoyé* ou sur ce que le panneau *dit*. Le quarante et unième noue les deux moitiés de la
  contradiction — il vérifie d'abord le nom que l'extension donne au fichier, puis fait rendre ce
  même nom par le modèle.


### La boucle de rétroaction (0.39.0)

- **La sortie des commandes est lue** (testé, dans un vrai éditeur). `run_command` renvoyait « demandez
  à l'utilisateur ce que ça a affiché » ; l'intégration shell de VS Code rend le flux et le code de
  retour. Sur un shell sans intégration, le résultat **dit** que la sortie n'a pas pu être lue —
  jamais un code de retour inventé. Les deux branches sont testées.
- **L'escalade se décide sur un échec constaté** (testé, bout en bout). Avant : une expression
  régulière lisait la question et pariait. Maintenant : le modèle local essaie, les tests ou les
  diagnostics tranchent, et seul un échec **prouvé** achète un appel distant — avec le diff de ce que
  la tentative a laissé sur le disque et l'erreur qu'elle a produite.
- **Les appels d'outils des petits modèles sont réparés** (testé) : clôture markdown, virgule
  finale, `True`/`False`, retours à la ligne réels dans une chaîne. Ce qui n'a pas de lecture unique
  est refusé avec une phrase qui dit quel champ ne va pas.
- **L'estimation de jetons se calibre** (testé) sur `usage.prompt_tokens` réel, par modèle, bornée,
  décroissante vers les mesures récentes.
- **Repli entre fournisseurs** (testé, bout en bout) sur 429 / panne réseau : rôle moins cher du même
  préréglage, puis la machine. Jamais vers plus cher, jamais après qu'un mot soit arrivé à l'écran.

### Le coût (0.39.0)

- **Le cache de prompt est protégé** (testé, dans un vrai éditeur : le préfixe est comparé octet par
  octet entre deux tours). La carte du dépôt est gelée pour la durée d'une conversation, la note de
  dialecte a quitté le préfixe. Le taux de cache est affiché.
- **La carte est classée par la question** (testé) : chemins et symboles déclarés, derrière une liste
  de mots vides. Le graphe d'imports fonctionne enfin — il comparait un spécificateur `./x.js` à une
  racine `src/x`, donc il ne s'est **jamais** déclenché sur un projet TypeScript ESM.
- **Prédiction de la prochaine édition** (testé, dans un vrai éditeur) : après une modification, la
  modification qui en découle ailleurs dans le fichier, sur le modèle de complétion. Gratuite sur un
  point d'accès local ; désactivée sur un point d'accès payant sauf demande explicite.

### La sécurité (0.39.0)

- **Journal des sorties chaîné** (testé) : chaque entrée porte le hachage de la précédente, export
  JSONL ou syslog RFC 5424, vérification à la demande. Modifier une ligne oblige à réécrire toute la
  suite ; supprimer une ligne du milieu est attrapé par la numérotation, pas par les liens.
- **Définitions d'outils MCP épinglées** (testé) : l'approbation porte sur les descriptions et les
  schémas, pas seulement sur la commande. Un changement redemande en **nommant** ce qui a changé.
  Les descriptions qui atteignent le modèle sont encadrées, aplaties et plafonnées.
- **Build vérifiable** (vérifié sur la release 0.39.0) : empreinte SHA-256 publiée et attestation de
  provenance Sigstore par le workflow, acceptée par `gh attestation verify` et liée au commit.

### Avant 0.39.0

- Noyau indépendant de l'éditeur : anonymisation, fournisseurs, routeur, budget, complétion, session,
  carte du dépôt, boucle d'agent. **865 tests unitaires** plus **41 tests d'intégration dans un vrai
  VS Code**.
- Barre latérale : conversation, historique, modèles, permissions, configuration ; modes
  discussion / plan / agent ; budget de raisonnement ; contexte explicite.
- **Onze fournisseurs** : cette machine, OpenRouter, Anthropic, OpenAI, Google Gemini, DeepSeek,
  Qwen, Mistral, xAI, Groq, Perplexity, plus toute passerelle compatible OpenAI.
- **Préréglages Hivey** (Free / Smart / Pro) : un budget plutôt qu'un modèle, le routage par rôle
  généré chaque jour depuis le catalogue OpenRouter. Aucune version de modèle écrite à la main.
- Permissions par forme d'action, un refus l'emporte toujours.
- Complétion inline FIM, anti-rebond, cache, préchauffage.
- Porte de sortie : globs interdits, anonymisation, refus sur secret, consentement, journal, budget.
- IBM i : dialecte Db2 for i, membres sources, ARCAD Elias, compétences RPG/CL/DDS.
- MCP (stdio et HTTP), compétences et sous-agents définis par le dépôt.
- Client terminal `hivey-code`, avec sortie capturée et diff avant écriture.
- Localisation anglais / français, deux tests qui empêchent la table de pourrir.

## Pas encore fait

- **Publication sur le Marketplace VS Code et Open VSX.** Préparée (`docs/PUBLISHING.md`), en attente
  des jetons d'éditeur — que seul Florian peut créer. En attendant, l'installation se fait par le
  `.vsix` de la release `build`, dont l'empreinte et l'attestation sont publiées.
- **Qualité de génération mesurée sur un vrai modèle.** Le banc existe (`eval/`, 15 tâches, 
  `npm run eval`), la CI vérifie que **chaque tâche échoue avant que le modèle y touche**, et le
  harnais a été prouvé de bout en bout avec un modèle factice. Il n'a jamais tourné contre un vrai
  modèle : la machine de développement n'a pas de GPU. Les chiffres viendront d'un poste qui en a un,
  ou du workflow nocturne une fois `HIVEY_EVAL_URL` configuré.
- **Reproductibilité octet pour octet du `.vsix`.** Non promise, et c'est délibéré : un `.vsix` est
  un zip, un zip porte les dates de modification, deux builds du même commit ne donnent donc pas les
  mêmes octets. Ce qui est offert à la place est l'empreinte du fichier réellement publié et une
  attestation Sigstore qui le lie au commit et au workflow.
- **Autres langues** : la mécanique accepte n'importe quelle langue ; il n'y a que l'anglais et le
  français.
- **Symboles via le serveur de langage.** La carte du dépôt utilise des expressions régulières ;
  `DocumentSymbolProvider` ferait mieux pour les fichiers déjà ouverts.
- **Politique d'entreprise centralisée** (un fichier de règles signé que l'extension refuse de
  contredire), au-delà des réglages d'espace de travail.
- **Historique partagé par équipe** et mode « revue de code » sur une branche.

## Ce qui n'est pas vérifié ici

Nommé plutôt que passé sous silence — chacun de ces points est du code écrit et jamais exécuté dans
ses conditions réelles :

- **Le schéma `streamfile:`** de l'IFS IBM i. Le reste de l'intégration IBM i a été écrit contre la
  documentation de Code for IBM i sans partition sous la main.
- **La correspondance version ↔ bibliothèque d'ARCAD**, qu'aucune API Elias ne semble exposer.
- ~~L'attestation de provenance~~ — **vérifiée le 2026-09-10** : le workflow l'a produite et
  `gh attestation verify` accepte le `.vsix` publié, en le liant au commit `871e4d5` et à
  `ci.yml`. Elle reste hors de portée d'un test local, par construction.
- **La prédiction de la prochaine édition contre un vrai modèle local.** Le circuit est testé dans un
  vrai éditeur contre un serveur factice ; ce que produit réellement `qwen2.5-coder:7b` sur cette
  invite n'a pas été mesuré. C'est précisément ce que le banc d'évaluation existe pour dire.

## Points à surveiller

- `qwen2.5-coder:7b` sur CPU : la première requête charge 5 Go ; le préchauffage et `keep_alive`
  atténuent, ils ne suppriment pas. Sur un poste sans GPU, viser un modèle 1,5 B pour la complétion
  et garder le 7 B pour la discussion.
- Le `fetch` de Node abandonne une réponse dont les en-têtes tardent : la couche HTTP le traduit en
  « le modèle est probablement en train de charger », mais un poste très lent verra des complétions
  vides tant que le modèle n'est pas résident.
- **L'intégration shell dépend du shell.** Elle est active pour bash, zsh, fish et PowerShell quand
  VS Code peut injecter son script ; un shell exotique, un conteneur sans l'injection, ou un
  utilisateur qui l'a désactivée retombent sur « la sortie n'a pas pu être lue ». La différence est
  visible dans le résultat, jamais devinée.
- **La prédiction de la prochaine édition envoie le fichier entier** au point d'accès de complétion.
  Sur une machine locale cela ne sort de nulle part ; c'est la raison pour laquelle elle est
  désactivée par défaut sur un point d'accès payant ou distant.
