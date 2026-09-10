# État et suite

Honnête plutôt que flatteur : ce qui marche, ce qui manque, ce qui n'est pas vérifié.

Ce document décrit l'état à la version **0.39.0**. Il était resté figé à `0.3.0` pendant trente-cinq
versions, ce qui est sa propre leçon : une feuille de route périmée dit « projet abandonné » à
quelqu'un qui l'ouvre, et elle le dit avant que la moindre ligne de code soit lue.

## Comment lire les affirmations ci-dessous

Trois niveaux, jamais mélangés :

- **testé** — un test automatisé échoue si ça casse, et il a été vérifié en retirant le correctif ;
- **vérifié à la main** — observé fonctionner ici, sans test de non-régression ;
- **non vérifié** — écrit, cohérent, jamais exécuté dans les conditions réelles. Il y en a, ils sont
  nommés.

## Fait

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
  carte du dépôt, boucle d'agent. **562 tests unitaires** plus **27 tests d'intégration dans un vrai
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
