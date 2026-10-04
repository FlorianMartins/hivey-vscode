# Prompt — Hivey Code au-delà d'IBM Bob et de GitHub Copilot

Oct 1, 2026 · @Florian Martins

Ce prompt pilote un agent de code dans le dépôt `hivey-vscode`, phase par phase. Il transforme la
feuille de route en chantiers testables, chacun avec ses critères d'acceptation.

**Mode d'emploi.** Exporte ce document en Markdown dans le dépôt, par exemple
`docs/PROMPT-ROADMAP.md`. Puis, à la racine du dépôt, donne à Claude Code : « Lis
docs/PROMPT-ROADMAP.md et exécute la phase 0. » Une phase par session, dans l'ordre. Tout ce qui
suit s'adresse à l'agent.

## Contexte et objectif

Tu travailles sur Hivey Code (`FlorianMartins/hivey-vscode`), un assistant de code pour VS Code,
open source sous Apache-2.0, en version 0.61.0. Son principe : le modèle par défaut tourne sur le
poste ou sur un serveur interne. Le modèle distant est une escalade consentie, payée sur un budget,
et tout ce qui sort est pseudonymisé de façon réversible.

L'objectif est d'en faire l'assistant de code le plus solide pour un établissement financier qui
exploite IBM i, en trois temps :

- dépasser IBM Bob sur IBM i ;
- égaler GitHub Copilot sur ce qu'un évaluateur d'entreprise comparera ;
- ajouter ce qu'aucun des deux ne peut offrir sans prendre les données du client.

Le public final est une équipe d'ingénieurs et de sécurité très exigeante. Chaque fonctionnalité
doit donc être vérifiable : une garantie tenue dans le code, un test qui échoue sans le correctif,
une documentation qui dit ce qui n'a pas été vérifié.

Avant de commencer une phase, lis `README.md`, `docs/ARCHITECTURE.md`, `docs/THREAT-MODEL.md`,
`docs/PRIVACY.md`, `docs/ROADMAP.md`, les ADR de `docs/adr/` et les fichiers cités par les chantiers
de la phase. Ce prompt décrit l'état du dépôt au 1er octobre 2026 ; si le code a changé depuis, le
code fait foi, et tu signales l'écart.

## Invariants du projet

Ces règles structurent le dépôt, et aucun chantier ne les affaiblit. Si un chantier semble l'exiger,
arrête-toi et explique pourquoi au lieu de contourner.

1. **`src/core/` n'importe jamais `vscode`.** La logique va dans le noyau, testable avec
   `node:test` ; `src/extension/` ne fait que le câblage. Le client terminal `src/cli/` doit pouvoir
   réutiliser chaque règle du noyau.
2. **Zéro dépendance à l'exécution.** Les modules intégrés de Node (`node:crypto`, `node:zlib`,
   `node:tls`, `node:child_process`) sont permis ; un paquet npm ne l'est pas. Ce qui manque s'écrit
   à la main, comme le SSE, le diff, le client MCP et les extracteurs PDF et DOCX l'ont été.
3. **Zéro télémétrie.** Aucune connexion vers une adresse que l'utilisateur ou son organisation n'a
   pas configurée. Toute nouvelle sortie réseau est désactivée par défaut.
4. **Une seule porte de sortie.** Tout contenu destiné à un point d'accès distant passe par
   `EgressGate.prepare()` (`src/extension/egress.ts`). Seul `core/agent/loop.ts`, via
   `beforeRequest`, transforme des messages en requête. Le caractère local se décide par l'adresse
   (`isLocalEndpoint`), jamais par le nom d'un réglage.
5. **Les garanties vivent dans le code, jamais dans un prompt.** Le jeu d'outils du mode Plan
   (`core/session/modes.ts`) et `ibmi.writableLibraries` (`core/ibmi/guard.ts`) en sont le modèle.
   Un refus l'emporte toujours sur une autorisation, et l'inconnu compte comme une écriture.
6. **Le préfixe du prompt est un actif** (ADR 0010). Rien qui change d'un tour à l'autre n'entre
   dans `stablePrompt` ; le test d'intégration qui compare le préfixe octet par octet reste vert.
7. **Aucune version de modèle ni aucun prix écrits à la main.** Ils viennent des catalogues générés
   par `npm run models`.
8. **Le panneau n'exécute rien.** Jamais d'`innerHTML` sur du texte de modèle ; chaque couleur est
   une variable du thème de l'éditeur ; la CSP reste `default-src 'none'`.
9. **Tout est traduit.** Chaque chaîne d'interface passe par `t()` et a sa traduction dans
   `src/shared/i18n.fr.ts`. Chaque réglage a sa description dans `package.nls.json` et
   `package.nls.fr.json`.
10. **Le registre des sorties ne contient jamais de contenu.** Seules les métadonnées sont hachées
    (ADR 0011).
11. **Langues du dépôt.** Code, commentaires et messages de commit en anglais, dans le style
    existant (`feat: the knowledge base reads Word and PDF`). ADR et CHANGELOG en français.

## Méthode pour chaque chantier

Chaque chantier porte un identifiant (0.1, 1.2…). Traite-les un par un, dans l'ordre de la phase
demandée ; un chantier n'est terminé que lorsque les onze étapes sont faites.

1. **Plan.** Lis le code concerné et les ADR liées, puis écris un plan court : fichiers touchés,
   tests prévus, risques, réglages ajoutés. Si le chantier demande une décision d'architecture que
   ni ce prompt ni une ADR ne tranche, présente les options et attends une réponse.
2. **Test d'abord.** Écris le test qui démontre le manque, et vérifie qu'il échoue.
3. **Implémentation.** Logique dans `src/core/`, câblage dans `src/extension/`, et dans `src/cli/`
   quand la fonction a un sens en terminal.
4. **Preuve du test.** Vérifie que le test passe, puis retire temporairement le correctif et vérifie
   que le test retombe. Un test qui passe dans les deux cas ne prouve rien.
5. **Intégration.** Ajoute un test dans `src/test/suite/` quand le risque est dans le câblage :
   sortie réseau, préfixe, approbation, porte de sortie.
6. **Réglages.** Tout nouveau réglage a un défaut sûr (désactivé s'il envoie quoi que ce soit), se
   lit par espace de travail, est décrit en anglais et en français, et documenté dans `README.md`.
   Si le réglage change ce que l'utilisateur peut comprendre du produit, mets à jour le chapitre
   concerné de `docs/cours/` — et la ligne de version de son index, que `npm run check:course`
   vérifie. (`README.fr.md` a été supprimé : c'était la traduction du README, donc deux documents à
   maintenir pour le même lecteur, et celui qui était en retard était toujours le français.)
7. **Flux de données.** Tout nouveau flux met à jour `docs/PRIVACY.md` (une ligne du tableau) et
   `docs/THREAT-MODEL.md` (vecteur, impact, parade dans le code, résidu assumé).
8. **Décision.** Toute décision structurante a son ADR `docs/adr/NNNN-<titre>.md`, en français, avec
   les options rejetées et pourquoi.
9. **Journal et état.** Mets à jour `CHANGELOG.md` (version mineure suivante, rubriques Ajouté,
   Corrigé, Précisé) et `docs/ROADMAP.md`. Classe chaque point honnêtement : **testé**, **vérifié à
   la main** ou **non vérifié**. Ce qui exige une partition IBM i, un GPU ou un service externe que
   tu n'as pas exécuté est « non vérifié ».
10. **Contrôles.** Avant chaque commit, tout est vert : `npm run typecheck`, `npm test`,
    `npm run eval:verify`, `npm run scan:secrets`, `npm audit --audit-level=high`, et
    `npm run test:integration` quand l'environnement le permet. Si un contrôle ne peut pas tourner
    ici, dis lequel et pourquoi.
11. **Commit.** Un commit par chantier. Ne pousse jamais, ne publie jamais.

## Phase 0 — Fondations

Rien d'autre ne commence avant la fin de cette phase : un évaluateur sécurité trouverait ces points
en une après-midi.

### 0.1 Restaurer les marqueurs dans les arguments d'outils

**Constat.** En mode agent avec un point d'accès distant, `vault.restore()` s'applique au texte
affiché (`afterResponse`, `onDelta`) mais pas aux arguments des appels d'outils
(`core/agent/loop.ts`). Un `write_file` peut donc écrire `⟨HOST_1⟩` sur le disque, et un `edit_file`
dont l'extrait contient un marqueur ne trouve pas sa cible.

**À faire.** Ajoute à la boucle un rappel de restauration des arguments, appliqué récursivement à
toutes les chaînes d'un appel avant la validation, l'approbation et l'exécution. Seuls les marqueurs
connus du coffre sont restaurés. La carte d'approbation et le diff montrent les valeurs réelles.

**Critères.** Un fournisseur factice distant qui émet `edit_file` avec un marqueur produit un
fichier contenant la valeur réelle. Un marqueur inconnu reste tel quel ; un marqueur tapé par
l'utilisateur reste neutralisé. Le client terminal reçoit le même correctif.

### 0.2 Marqueur coupé entre deux fragments

**Constat.** `vault.restore(d.text)` s'applique fragment par fragment : un marqueur coupé en deux
(`⟨EMA`, puis `IL_1⟩`) s'affiche brut pendant le streaming.

**À faire.** Un restaurateur de flux dans `core/redaction/` retient, en fin de fragment, un début de
marqueur incomplet (au plus la longueur maximale d'un marqueur) et le libère au fragment suivant ou
à la fin du flux. Il sert à la réponse comme à la réflexion.

**Critères.** Tests sur toutes les positions de coupure, en fin de flux et lors d'un arrêt par
l'utilisateur.

### 0.3 Fermer `QSH` dans la garde IBM i

**Constat.** `READING_VERBS` (`core/ibmi/guard.ts`) contient `QSH` et `STRSQL`. `QSH CMD('rm …')`
est donc classé comme lecture et échappe à `ibmi.writableLibraries`.

**À faire.** Retire `QSH` et `STRSQL` des lecteurs. Traite `QSH` et `STRQSH` comme des écritures
dont la cible n'est pas analysable, donc refusées dès que la liste est renseignée. Vérifie que les
commandes imbriquées (`SBMJOB CMD(…)`) et les appels SQL à `QSYS2.QCMDEXC` sont contrôlés.

**Critères.** Avec une liste valant `["DEVCFC"]`, aucun de ces cas ne passe :
`QSH CMD('rm -r /QSYS.LIB/PROD.LIB')`, `STRQSH`, `SBMJOB CMD(DLTF FILE(PROD/X))`,
`CALL QSYS2.QCMDEXC('DLTF PROD/X')`.

### 0.4 Suite de tests sous Node 22

**Constat.** `npm test` lance `node --test dist-tests/`, qui échoue sous Node 22. La CI tourne en
Node 20, et `engines` annonce Node 18 ou plus.

**À faire.** Un appel qui fonctionne sous Node 18, 20 et 22, sous Linux, macOS et Windows ; le shell
de npm n'étend pas les motifs sous Windows. Ajoute Node 22 à une matrice de CI.

### 0.5 Des chiffres qui ne peuvent plus vieillir

**Constat.** `README.md` et `docs/ROADMAP.md` décrivent la 0.39.0 et 562 tests ; le dépôt est en
0.61.0 avec 699 tests.

**À faire.** Mets les documents à jour, puis ajoute un contrôle de CI qui échoue si un chiffre
annoncé (tests unitaires, tests d'intégration, tâches d'évaluation, version) diverge de la réalité.

### 0.6 Mesurer la qualité sur de vrais modèles

**Constat.** Le banc `eval/` existe et chaque tâche échoue bien avant intervention, mais il n'a
jamais tourné contre un vrai modèle.

**À faire.**

- `npm run eval -- --report <dossier>` produit un rapport JSON et Markdown : pour chaque tâche,
  réussite, durée, jetons, coût, nombre d'étapes et escalade éventuelle.
- Porte le banc à au moins 40 tâches réalistes : TypeScript, Python, Java et SQL ; RPG fixe et
  libre, CL, DDS, Db2 for i ; finance (arrondi, décimal). Chaque tâche garde une commande de
  contrôle qui échoue sur la version non modifiée.
- Le workflow nocturne publie le rapport quand `HIVEY_EVAL_URL` est configuré.

**Interdit.** N'invente aucun score. Si aucun modèle n'est joignable, livre le harnais et marque les
chiffres « non mesurés ».

## Phase 1 — Dépasser IBM Bob sur IBM i

IBM Bob, avec son Premium Package for i, apporte un mode dédié, une quarantaine de compétences
IBM i, une documentation curatée et la génération de tests RPG. Hivey doit aller plus loin sur un
point que Bob ne revendique pas : **vérifier sur la partition ce qu'il a écrit**, et s'en servir
comme verdict.

Règles propres à cette phase :

- Tout passe par la connexion de Code for IBM i, comme aujourd'hui
  (`extension/integrations/ibmi.ts`). N'ouvre aucune session propre.
- N'invente aucune API. Lis l'API exportée par Code for IBM i avant de l'utiliser, et cite la
  fonction employée dans le plan.
- Rien de cette phase ne peut être exécuté ici sans partition. Écris les tests sur des sorties
  enregistrées (fixtures) et classe le reste « non vérifié ».

### 1.1 Boucle compiler, lire, corriger

**À faire.** Un outil `ibmi_compile` compile un membre dans une bibliothèque cible, avec la commande
adaptée au type du membre : `CRTBNDRPG`, `CRTSQLRPGI`, `CRTRPGMOD`, `CRTBNDCL`, `CRTPF`, `CRTLF`,
`CRTDSPF`, `CRTPRTF`.

- La bibliothèque cible doit figurer dans `ibmi.writableLibraries`. Liste vide : l'outil demande à
  chaque fois et signale que la garde n'est pas configurée.
- Après compilation, il lit les erreurs de la liste de compilation (spool, par exemple via
  `SYSTOOLS.SPOOLED_FILE_DATA`) et de la joblog (`QSYS2.JOBLOG_INFO`).
- Il renvoie au modèle une liste structurée : identifiant (RNF, SQL, CPD…), gravité, membre, ligne,
  texte.
- Le résultat devient un type de vérification dans `core/router/outcome.ts`. Comme pour les tests et
  les diagnostics, c'est le dernier résultat du tour qui compte ; une compilation finale en échec
  déclenche l'escalade, avec la liste d'erreurs.
- En mode Plan, l'outil n'existe pas : il crée des objets.

**Critères.** L'analyseur de liste est testé sur des fixtures RPG III, ILE RPG fixe et libre,
SQLRPGLE, CL et DDS. `verifyTurn()` traite une compilation finale en échec comme un échec, et une
compilation corrigée comme un succès.

### 1.2 Tests unitaires RPG exécutés

**À faire.** Détecte RPGUnit sur la partition (commande `RUCALLTST`) et expose-le comme outil de
test ; ses résultats sont analysés et versés à `verifyTurn()`. Une compétence `/rpgtest` écrit des
tests au format RPGUnit, les compile par 1.1 et les exécute.

**Critères.** Sans RPGUnit installé, l'outil le dit et ne simule rien. Analyseur de résultats testé
sur fixtures.

### 1.3 Analyse d'impact

**À faire.** Un outil en lecture, `ibmi_impact`, répond à « qui utilise ce fichier, ce programme, ce
champ ? ».

- Niveau objet : `DSPPGMREF` vers un fichier de sortie dans `QTEMP`, ou les services QSYS2
  équivalents.
- Niveau champ : références croisées ARCAD quand Elias est présent, sinon recherche dans les sources
  des bibliothèques lisibles.
- Le résultat indique sa méthode et ses limites. L'outil rejoint la liste blanche du mode Plan, et
  une compétence `/impact` l'appelle avant toute modification d'un fichier physique.

**Critères.** `QTEMP` est la seule bibliothèque qu'un outil en lecture peut écrire ; la garde le
sait explicitement, test à l'appui.

### 1.4 Performance Db2 for i

**À faire.** `/sql` et `ibmi_sql` en lecture consultent l'Index Advisor (`QSYS2.SYSIXADV`) et les
statistiques de table (`QSYS2.SYSTABLESTAT`) pour justifier une requête ou un index proposé. La
création d'un index reste une écriture, soumise à la garde.

### 1.5 Messages et documentation de la maison

**À faire.** Un outil `ibmi_message` donne le texte et l'aide d'un identifiant (CPF, MCH, RNF,
SQL…) via `QSYS2.MESSAGE_FILE_DATA`. La base de connaissance indexe les identifiants de message
cités dans la documentation interne (`knowledge.folders`). Une erreur renvoie ainsi à la fois au
texte IBM et à la procédure maison.

### 1.6 Au moins 40 compétences IBM i, chacune mesurée

**À faire.** Complète les familles `rpg`, `dds`, `db2i` et `cl`, par exemple : accès par
enregistrement vers SQL, programme monolithique vers modules et programmes de service ILE, `/COPY`
vers prototypes, indicateurs numérotés vers indicateurs nommés, cycle RPG, `MOVE` et `MOVEL`,
contrôle de validation, journalisation.

**Critères.** Chaque compétence est adossée à au moins une tâche de `eval/tasks`, dont la commande
de contrôle échoue avant intervention.

### 1.7 Livraison par ARCAD

**À faire.** Une modification compilée et testée peut être préparée pour ARCAD Elias : check-in et
demande de version, par les commandes `arcad.*` existantes. La promotion vers la production n'est
jamais un outil de l'agent.

## Phase 2 — Égaler Copilot sur ce que l'entreprise compare

GitHub Copilot met en avant, pour les entreprises : des réglages gérés centralement, un registre MCP
privé, l'export OpenTelemetry, des hooks, un agent cloud, des bacs à sable et la revue de code.
Chaque chantier ci-dessous en donne l'équivalent, sans que le code quitte l'infrastructure du
client.

### 2.1 Politique d'entreprise signée

**À faire.** Un fichier de politique JSON signé en Ed25519 (`node:crypto`), déposé par l'IT à un
emplacement machine. La clé publique est épinglée au même endroit, et l'emplacement est défini par
OS ou par une variable d'environnement.

- **Contenu possible :** fournisseurs et adresses permis, politique d'escalade maximale, niveau
  d'anonymisation minimal, globs et commandes interdits additionnels, `writableLibraries`, plafonds
  de budget, liste blanche MCP (empreinte de la commande et des définitions d'outils), hooks
  autorisés, fonctions désactivées.
- **Sémantique :** la politique ne fait que restreindre. Un réglage utilisateur plus permissif est
  ignoré, et l'interface affiche « géré par votre organisation ».
- **Échec :** signature invalide ou fichier illisible, l'extension passe en mode le plus sûr (local
  uniquement) et alerte. Jamais de retour silencieux aux réglages utilisateur.
- ADR obligatoire.

**Critères.** Tests de signature altérée, de réglage permissif ignoré, de fusion des listes et de
politique absente.

### 2.2 Envoi du registre vers le SIEM

**À faire.** Désactivé par défaut. Deux transports écrits à la main : syslog RFC 5424 sur TLS
(RFC 5425) via `node:tls`, et journaux OTLP/HTTP en JSON vers le collecteur de l'organisation.

- Une file d'attente sur disque assure la reprise sans perte silencieuse ; une entrée non envoyée
  reste visible.
- L'identité de l'utilisateur est un identifiant configurable, jamais une adresse e-mail par défaut.
- Jamais de contenu : les mêmes champs que le registre local, empreintes comprises.

**Critères.** Tests contre un serveur TLS local : envoi, coupure, reprise, certificat refusé.

### 2.3 Preuve de souveraineté

**À faire.** Une commande produit un rapport signé sur une période : nombre de requêtes,
destinations, volume sortant par destination, catégories pseudonymisées, images envoyées, état de la
chaîne. En option, la tête de chaîne est horodatée selon la RFC 3161 auprès d'une autorité
configurée par l'organisation ; seule l'empreinte part. Cela ferme le résidu n°9 du modèle de
menace.

### 2.4 Hooks avant et après outil

**À faire.** Des hooks déclarés dans `.hiveycode/hooks.json` (versionné) ou dans les réglages,
filtrés par outil et par glob de chemin. Exemple : un linter après `write_file` sur `src/**`.

- Après un outil, un code de retour non nul renvoie un échec au modèle et compte pour
  `verifyTurn()`.
- Avant un outil, un code de retour non nul refuse l'appel.
- Un hook venu du dépôt est une exécution de code : consentement qui nomme la commande, épinglé par
  empreinte, comme un serveur MCP stdio.

### 2.5 Agent en arrière-plan isolé

**À faire.** Une commande « Lancer en arrière-plan » crée un `git worktree` sur une nouvelle branche
et y exécute la boucle d'agent, limitée à ce worktree.

- Les commandes tournent dans un conteneur sans réseau (`docker` ou `podman` s'ils sont présents,
  `--network none`, quotas CPU et mémoire).
- Sans moteur de conteneur, `run_command` est refusé dans ce mode plutôt qu'exécuté sur l'hôte.
- En fin de tâche : la branche, un résumé, le diff ouvert dans l'éditeur et le verdict de
  `verifyTurn()`.
- Plusieurs tâches peuvent tourner en parallèle, visibles et annulables dans le panneau. L'agent ne
  pousse jamais.

### 2.6 Revue de branche

**À faire.** `/review` porte sur `git diff <base>...HEAD`, avec une base détectée et modifiable. Il
produit des constats structurés : fichier, ligne, gravité, catégorie, correctif proposé.

- Les constats s'affichent dans le panneau, avec navigation, et comme diagnostics VS Code.
- La revue utilise les compétences `security` et la base de connaissance.
- La publication en commentaires de pull request passe uniquement par un serveur MCP que
  l'utilisateur a configuré.

### 2.7 Symboles et graphe d'appels du serveur de langage

**À faire.** Trois outils en lecture, `find_references`, `call_hierarchy` et `workspace_symbols`,
s'appuient sur `vscode.executeReferenceProvider`, `vscode.prepareCallHierarchy` et
`vscode.executeWorkspaceSymbolProvider`. Ils rejoignent la liste blanche du mode Plan, et la carte
du dépôt préfère ces symboles quand ils existent. Toujours pas d'index vectoriel.

## Phase 3 — Ce que ni Copilot ni Bob ne peuvent offrir

Ces chantiers reposent sur un avantage structurel : les données restent chez le client. Un service
hébergé ne peut pas les reproduire sans les prendre.

### 3.1 Corpus d'apprentissage des escalades

**À faire.** Fonction activée explicitement, désactivée par défaut, que la politique d'entreprise
(2.1) peut autoriser ou interdire. Quand une escalade aboutit (vérification verte après le modèle
distant), l'extension enregistre localement :

- la demande et le contexte nécessaire ;
- le diff et l'erreur de la tentative locale ;
- le diff final et la commande de vérification.

Le stockage se fait hors du dépôt, dans le stockage global de l'extension. Les globs interdits
s'appliquent, la rétention est configurable, et une commande purge tout.

Deux exports :

- des tâches au format `eval/tasks`, dont la commande de contrôle échoue sur l'état initial ;
- un jeu de fine-tuning au format conversation, pour un LoRA du modèle interne.

Rien ne sort. Documente ce flux dans `docs/PRIVACY.md` et `docs/THREAT-MODEL.md`.

### 3.2 Routage appris par dépôt

**À faire.** Mesure, par dépôt, par type de tâche et par modèle, le taux de réussite constaté par
`verifyTurn()`. Le routeur choisit alors le modèle le moins cher dont le taux observé dépasse un
seuil, avec un nombre minimal d'essais et une part d'exploration bornée.

- Jamais au-dessus du plafond de l'utilisateur, jamais vers un modèle qu'il n'a pas autorisé.
- Chaque choix est expliqué dans le panneau, par exemple « choisi : 9 réussites sur 10 dans ce
  dépôt ».
- Les données sont locales et effaçables. ADR obligatoire.

### 3.3 Relecture par un second modèle

**À faire.** Avant d'appliquer un diff qui touche des chemins sensibles (nouveau réglage, liste de
globs) ou qui dépasse une taille donnée, un second modèle relit le diff et la demande ; il est local
par défaut. Ses objections s'affichent dans la carte d'approbation. Elles ne bloquent que si la
politique d'entreprise le demande.

### 3.4 Famille de compétences `finance`

**À faire.** Une nouvelle famille, activable par `skills.groups` :

- arrondis (bancaire, demi-supérieur) et types décimaux sans flottant ;
- décimal packé et zoné ;
- calendriers de règlement (T+1, T+2), avec des jours fériés fournis par l'utilisateur, jamais codés
  en dur ;
- fuseaux horaires et heures d'ouverture des places de marché ;
- validation d'identifiants : ISIN, LEI selon ISO 17442, BIC ;
- messages FIX.

**Critères.** Chaque compétence est adossée à au moins une tâche de `eval/tasks`, en JavaScript,
Python, Java et RPG quand c'est pertinent.

### 3.5 Tableau de qualité publié

**À faire.** À la fin de la phase, `eval/` produit un tableau comparatif mesuré : local seul, local
plus escalade, et chaque préréglage Hivey, avec la qualité et le coût par tâche. Il est versionné
dans le dépôt et repris dans le README. Ne compare à Copilot ou à Bob que des chiffres réellement
mesurés dans les mêmes conditions.


## Phase 4 — Le raisonnement

Demande de Florian, le 2026-10-03 : *« je veux vraiment que l'extension soit aussi bonne que toi dans
son raisonnement, pour un résultat aussi poussé, avec les mêmes types d'agent, skills et sous-agents,
et que cette réflexion s'adapte toujours aux derniers modèles »*.

Ce n'est pas un chantier, c'est une phase. Et elle a une contrainte qui la rend différente des trois
premières : **la qualité du raisonnement est la seule chose de ce projet qu'on ne peut pas prouver par
un test unitaire**. Un test dit qu'une boucle fonctionne ; il ne dit pas qu'elle raisonne mieux. La
seule preuve disponible est le banc d'évaluation, et il est maintenant en état de servir (phase 3 et
`eval/QUALITY.md`). **Chaque chantier de cette phase se mesure avant et après, sur les 56 tâches, et
un chantier qui n'améliore pas le chiffre est annulé plutôt que gardé.**

### 4.1 Le plan devient une preuve, et devient mesurable

⚠️ **Correction de la première rédaction de ce chantier** : elle disait que « la boucle est sans
mémoire de son propre plan ». C'est faux. `src/core/agent/plan.ts` existe, avec `parsePlan`,
`planSummary`, `planComplete`, la règle « une seule étape en cours », et l'affichage dans le panneau.
Je l'avais écrit sans vérifier — et j'ai commencé par écraser ce fichier avant de m'en apercevoir.

Ce qui manque est ailleurs, et le fichier le dit lui-même : *« le plan n'est pas une technique de
prompt et il n'est pas pour le bénéfice du modèle ; c'est un affichage de progression »*. D'où deux
lacunes réelles :

**a) Un plan inachevé n'est pas une preuve.** Un tour qui se termine en laissant des étapes de son
**propre** plan ouvertes est un tour qui s'est déclaré fini contre sa propre liste. C'est exactement
la forme de preuve sur laquelle `router/outcome.ts` escalade (ADR-0009), et c'est la moitié qui
change le résultat plutôt que l'apparence. Prudence symétrique à `verifyTurn` : **l'absence de plan
n'est pas un échec** — beaucoup de bons tours n'en ont pas besoin, et traiter leur absence comme une
faute escalade chaque réponse courte, qui est précisément l'erreur de l'ancien routage par
mots-clés.

**b) Le client terminal n'a pas l'outil de plan**, donc le banc — qui pilote ce client — ne peut rien
mesurer à ce sujet. C'est bloquant pour toute la phase : la règle « on mesure avant et après » est
inapplicable à une fonctionnalité que le harnais ne peut pas exercer.

Mesurer : le taux de réussite, et surtout **l'écart entre « le modèle dit que c'est fini » et « le
contrôle passe »** — le seul chiffre qui compte pour quelqu'un qui s'en sert.

**Reste de ce chantier, trouvé en route et non fait** : le client terminal fixe son budget de contexte
à **8 000 jetons en dur**, alors que le panneau suit la fenêtre du modèle réellement choisi — et le
`CHANGELOG` dit que ce nombre fixe **était** le défaut. Même histoire que les plafonds de dépense,
dans la même moitié oubliée.

### 4.2 Les compétences deviennent atteignables par le modèle

⚠️ **Deuxième rédaction fausse de cette phase.** Elle disait : « il y a environ 85 compétences, les
décrire toutes dans le prompt coûte des jetons et dilue l'attention ». Vérification faite : les
compétences **intégrées n'entrent jamais dans le prompt** (ce sont les commandes `/` que
l'utilisateur tape), et celles du dépôt utilisaient **déjà** la divulgation progressive, avec le
raisonnement écrit dans `skillsPrompt`.

Le vrai manque est l'inverse : **les 85 compétences intégrées étaient inatteignables par le modèle**.
Quarante pour IBM i, huit pour la finance, chacune adossée à une tâche d'évaluation — et toutes
conditionnées au fait que l'utilisateur **connaisse la commande à taper**. Qui ne sait pas que
`/packed` existe n'en bénéficie jamais.

Fait : elles passent par le mécanisme existant (`skillsPrompt` + `use_skill`), filtrées par ce que
l'utilisateur a activé — ce qui borne le coût — en excluant celles qui sont une action sur la
conversation, et en laissant gagner une compétence du dépôt qui porte le même nom. Le terminal les
reçoit aussi, sans quoi le banc ne peut rien mesurer. Voir
[ADR-0029](adr/0029-les-competences-etaient-invisibles-au-modele.md).

⚠️⚠️ **Et un constat de méthode qui vaut pour la suite de cette phase.** Les six chantiers ont été
écrits d'affilée depuis ce que je croyais savoir du produit, pas depuis le code : deux des deux
premiers portaient sur des problèmes déjà résolus. **Les chantiers 4.3 à 4.6 ci-dessous sont à
re-dériver du code avant d'être engagés** — leur rédaction est une intention, pas un constat.

### 4.3 La délégation est transitive, et le terminal n'en a pas

⚠️ **Troisième rédaction fausse de cette phase, re-dérivée du code sur demande.** Elle disait : « ce
qui manque est ce qui les rend utiles : **plusieurs à la fois**, et une synthèse de leurs retours ».
Les deux existent.

Ce qui existe déjà, vérifié :

- **Le parallélisme est implémenté.** `loop.ts` fusionne les appels **voisins** que l'outil déclare
  sûrs et les lance en `Promise.all` ; les approbations sont résolues **avant**, une par une, parce
  que deux dialogues simultanés ne sont pas une interface ; et ne fusionner que des voisins préserve
  l'ordre que le modèle a demandé. L'outil de dispatch se déclare parallélisable **uniquement pour un
  agent en lecture seule** — deux agents qui écrivent en même temps sont une course que personne ne
  reconstitue depuis une trace.
- **La synthèse est le mécanisme même** : la conclusion du sous-agent revient comme résultat d'outil,
  et le modèle principal continue avec elle. Il n'y a pas d'étape à ajouter.
- **Les outils d'un sous-agent sont une intersection, jamais une union** : un fichier de définition
  arrivé avec un dépôt cloné ne peut pas s'accorder un outil que le mode n'offre pas.
- **Quatre sous-agents intégrés** existent déjà : `explorer`, `reviewer`, `tester`, `dba`.

Les trois vraies lacunes :

**a) ⚠️⚠️ La délégation est transitive et non bornée.** `toolsForAgent` rend **tous** les outils
disponibles quand une définition n'a pas de ligne `tools:` — et parmi eux `run_agent`. Donc un
sous-agent défini sans restriction peut dispatcher des sous-agents, qui peuvent en dispatcher à leur
tour. La largeur est bornée par le plafond d'étapes de chaque niveau ; **la profondeur ne l'est par
rien**. Aucune garde n'existe nulle part, et aucun test ne l'interdit. La règle à poser est simple et
sans ambiguïté : **un sous-agent est une feuille**. C'est déjà ce que la description de l'outil
promet — « il travaille seul et ne rend que sa conclusion » — et aucun des quatre agents intégrés ne
veut déléguer.

**b) Le client terminal n'a aucun sous-agent.** `buildDefinitionTools` est côté extension seulement.
Quatrième fois dans cette phase que la moitié terminal est la moitié oubliée (après l'outil de plan,
les plafonds de dépense et les compétences) — et, comme à chaque fois, cela veut dire que le banc ne
peut rien mesurer de la délégation.

**c) Une ligne d'étape ne nomme jamais le sous-agent dispatché.** `callSignature` déclare
`run_agent: ["agent", "task"]` alors que le schéma de l'outil utilise `name`. L'argument `agent`
n'existe donc jamais, on retombe sur `task`, et la trace montre la tâche sans dire **quel** agent l'a
reçue. C'est exactement le défaut que ce fichier existe pour empêcher : *« quelqu'un qui relit ce
qu'un agent a fait à son dépôt a besoin de l'appel »*.

Mesurer : le taux de réussite, les jetons du contexte **principal** sur les tâches qui demandent de
l'exploration, et le temps.

### 4.4 Vérifier pendant le tour — re-dérivé du code

Deux faits, vérifiés avant d'écrire une ligne :

1. **`if (!res.toolCalls.length) return done("answer")`** — un tour se termine à l'instant où le
   modèle arrête d'appeler des outils, et rien ne demande si le travail a été vérifié.
2. **`edit_file` rend `"Edited src/app.ts."`** et rien d'autre : le modèle vient de changer un fichier
   et le seul moyen de savoir s'il compile encore est de **choisir** d'appeler `get_diagnostics`.

Et une moitié du chantier était **déjà faite** : « une réponse qui dit ce qu'elle n'a pas vérifié »
est livrée par la section « À savoir » (ADR-0030).

Le produit avait donc deux réponses à « ça a l'air inachevé », toutes deux chères : le dire à
l'utilisateur, ou escalader vers un modèle facturé. **Le milieu bon marché manquait** — demander au
même modèle de finir. Fait : un seul rappel par tour, en forme de preuve, qui coûte une étape et jette
la réponse prématurée ; et une modification qui rapporte les **erreurs** de l'éditeur, rien quand il
n'y en a pas. Voir [ADR-0032](adr/0032-verifier-pendant-le-tour.md).

Le chiffre que cela doit déplacer est **`claimedDone`**, ajouté par 4.1 précisément pour juger
celui-ci.

### 4.5 La capacité de raisonner vient du catalogue — re-dérivé du code

⚠️⚠️ **Un vrai défaut, et il violait un invariant du projet.** `extension/models.ts` décidait quels
modèles acceptent un budget de réflexion avec une expression régulière **nommant des versions** :
`o[134]|gpt-5|…|grok-[34]|gemini-[23]`. Elle reconnaît `gpt-5` ; le marché est passé à `gpt-6`.

Donc **`openai/gpt-6.1-sol-pro`, le modèle vers lequel les *deux* préréglages payants envoient le
travail approfondi, était déclaré incapable de raisonner** — et comme ce drapeau commande l'affichage
du contrôle lui-même, **l'utilisateur ne pouvait pas activer la réflexion sur le modèle le plus fort
du produit**. Idem pour `poolside/laguna-s-2.1`, leur modèle de complétion. OpenRouter annonce
`reasoning: true` pour les deux.

Fait : `GENERATED_REASONING`, relevé de `supported_parameters` et régénéré par le workflow quotidien
comme les prix (327 modèles sur 454). Le repli subsiste — le catalogue ne peut rien dire d'un modèle
local qu'aucune passerelle ne liste — mais **il ne nomme aucune version**, et un test lit son source
pour refuser qu'il contienne un chiffre. Voir
[ADR-0033](adr/0033-la-capacite-de-raisonner-vient-du-catalogue.md).

**Ce que ce chantier n'avait pas besoin de faire** : sa rédaction demandait aussi que le *niveau* soit
choisi d'après le modèle. Vérifié : la traduction par fournisseur est déjà juste et sans version
(`reasoning.effort`, `reasoning_effort`, budget de jetons), l'interaction délicate est déjà traitée
(Anthropic refuse `max_tokens <= budget_tokens`), et la capacité publiée est **binaire** — il n'y a
rien à adapter au-delà du oui/non. Quatrième prémisse fausse sur cinq chantiers.

### 4.6 DeepSeek v4.1 — mesuré, pas supposé

Re-dérivé du code comme les précédents, et ici la dérivation ne porte pas sur un défaut : **c'est une
mesure.** Ce qu'il fallait vérifier avant de la lancer, c'est qu'elle ait un sens.

Faits, relevés sur le catalogue du jour :

| | outils | raisonnement | $/M entrée | $/M sortie | fenêtre |
|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | oui | oui | **0,30** | **1,20** | 1 048 576 |
| `openai/gpt-6.1-sol-pro` *(rôle `deep` des deux préréglages payants)* | oui | oui | 2,00 | 10,00 | 1 050 000 |

Donc : **6,7 fois moins cher en entrée, 8,3 fois en sortie, à fenêtre égale, avec les outils et le
raisonnement.** L'hypothèse est défendable et la comparaison a un sens — ce qui n'était pas acquis :
un modèle sans appel d'outils ne peut pas faire de travail d'agent, et la mesure aurait comparé deux
choses différentes.

**Protocole.** Les deux séries tournent sur **le même build** (0.93.0), le même jour, sur les 56
mêmes tâches, avec les mêmes contrôles qui tranchent. La référence du préréglage `hivey` est
**remesurée** sur ce build plutôt que reprise de la veille : elle avait été prise sur la 0.92.0, et
comparer deux clients différents aurait mélangé l'effet du modèle avec celui du chantier 4.4.

**Décision annoncée d'avance, pour qu'elle ne soit pas choisie après coup** : si DeepSeek tient le
score, il remplace le modèle du rôle concerné ; s'il perd des points, il est abandonné. Le banc
tranche, pas la préférence — et **le résultat est publié dans les deux cas**.

⚠️ **Ce qui est explicitement hors de cette phase** : copier un prompt système d'un autre produit, et
ajuster un prompt jusqu'à ce que le banc remonte. Le second est la façon la plus sûre de fabriquer un
chiffre qui ne veut rien dire.


## Phase 5 — Ce que la mesure a montré, et rien d'autre

⚠️ **Cette phase est dérivée du code et des chiffres, pas de ce que je crois du produit.** C'est la
règle que la phase 4 a imposée en se trompant quatre fois sur cinq. Chaque chantier ci-dessous part
d'un **nombre relevé** sur les trois séries complètes du 3 et 4 octobre, ou d'une lacune que l'un de
mes propres ADR a déclarée dans sa section « ce que ceci ne fait pas ».

Elle a aussi une contrainte neuve, et c'est la première chose à régler : **le banc ne peut pas
trancher ce qu'on lui demande.** Trois séries de la même configuration ont donné 48, 47 et 50. Un
chantier qui déplace deux tâches n'est donc pas jugeable, et plusieurs des chantiers ci-dessous
déplacent deux tâches. Le 5.1 existe pour ça et passe devant.

### 5.1 Rendre le banc capable de trancher

**Mesuré** : 48, 47, 50 sur trois séries identiques — un écart de **trois tâches** sans que rien ne
change. Le tableau publie déjà cet écart quand on lui donne plusieurs séries, ce qui est honnête et
ne suffit pas : il faut pouvoir **décider**.

À livrer : la répétition devient le défaut, pas une option. Une mesure est **n séries** (3 pour
commencer), et le tableau rend la médiane **avec** son écart ; un chantier dont l'effet est dans
l'écart est déclaré non jugeable au lieu d'être accepté ou rejeté au hasard. Le coût est réel — trois
fois le prix et trois fois le temps — et c'est le prix d'une mesure qui décide. Les séries se lancent
en parallèle quand le compte le permet, ce qui le ramène au temps d'une seule.

⚠️ Et il faudra regarder **d'où vient l'écart** : trois tâches qui basculent au hasard, ou toujours
les trois mêmes ? Le second cas est une propriété de ces tâches et se corrige ; le premier est du
bruit de modèle et ne se corrige pas, il se mesure.

### 5.2 Une réponse ne peut pas contredire son propre verdict

**Mesuré** : sur les 17 échecs que `qwen3.7-flash` a annoncés comme des réussites, **10 sont survenus
après un rappel de vérification** — et dans **5 d'entre eux la trace de l'agent contient visiblement
un échec** qu'il a lu avant de conclure. Le rappel le fait lancer un contrôle ; il ne le fait pas
croire au résultat.

Le produit **connaît** déjà la contradiction : `verifyTurn` rend « le dernier contrôle n'est pas
passé » pendant que la réponse dit « c'est fait ». Elle sert à escalader et à remplir « À savoir »,
et la **réponse elle-même** n'en porte rien.

À livrer : quand le verdict du tour contredit ce que la réponse affirme, la réponse le porte — pas un
avertissement à côté, dans le texte que la personne lit. Mesurer : `claimedDone`, qui existe
précisément pour ça.

⚠️ Ce n'est pas « faire taire le modèle » : une réponse qui dit « j'ai changé ceci, le contrôle
échoue encore, voilà où » est **plus** utile que la même sans la seconde moitié.

### 5.3 Vérifier la bonne chose

**Mesuré** : les **5 autres** échecs annoncés comme des réussites n'ont rien vu échouer — le contrôle
lancé n'était pas celui qui décide. Et **7 des 10 cas sont des tâches IBM i**, dont le contrôle est
*structurel* : il n'existe souvent aucune commande que le modèle puisse lancer qui refléterait le vrai
contrôle. C'est donc **autant une propriété du banc qu'un défaut du modèle**, et il faut le dire avant
de corriger quoi que ce soit.

À dériver avant d'engager : le modèle devine la commande de contrôle d'un dépôt. Il existe déjà
`hiveyCode.ibmi.testCommand` et les règles de la maison ; il n'existe pas d'endroit où un dépôt
**déclare** « voici ce qui dit si mon code marche ». Vérifier dans le code si ce manque est réel avant
d'ajouter un fichier de plus.

Mesurer : la part des échecs où aucun contrôle pertinent n'a tourné.

### 5.4 Les compétences offertes ne servent jamais — décider

**Mesuré** : `use_skill` a été appelé **0 fois sur 180 tours** (56 + 62 + 62), sur trois
configurations. Le chantier 4.2 a rendu 85 compétences atteignables par le modèle ; il ne les a
jamais demandées. **Offrir n'est pas utiliser.**

Décision à annoncer **avant** la mesure, comme pour DeepSeek : on force une compétence sur la famille
qui lui correspond (les tâches IBM i ont chacune la leur) et on compare. Si la compétence forcée fait
gagner des tâches, le défaut est dans la **sélection** et c'est elle qu'on répare. Si elle n'en fait
pas gagner, les 85 descriptions sortent du préfixe : on ne paie pas des jetons à chaque tour pour une
capacité que rien n'emploie. **Le banc tranche, et le résultat est publié dans les deux cas.**

⚠️ Interdit : pousser le modèle vers les compétences par le prompt jusqu'à ce que le chiffre monte.
C'est ajuster contre son propre banc.

### 5.5 La délégation offerte ne sert jamais — décider

**Mesuré** : `run_agent` a été appelé **1 fois sur 180 tours**. Même forme que 5.4 et même protocole :
mesurer avec une délégation forcée sur les tâches d'exploration, puis réparer la sélection ou retirer
l'offre. ⚠️ Et une lacune que l'ADR-0031 a déclarée : un sous-agent ne reçoit **pas** les compétences
du 4.2 — à trancher ici plutôt qu'à supposer.

### 5.6 `local only` est inutilisable, et c'est la configuration qui porte l'argument

**Mesuré** : **0/56**, dont **51 tâches sans une seule étape d'outil**. C'est la configuration dont
tout le discours du produit dépend — « votre code ne part pas » — et elle ne fait rien. La correction
de l'ADR-0026 a rendu l'agent local *possible* ; elle ne l'a pas rendu *capable*.

À livrer : un modèle local qui appelle des outils. `qwen2.5-coder:7b` n'en émet pas par ce runtime ;
d'autres le font. Tirer un modèle à outils, mesurer, et **changer ce que le README recommande** si le
chiffre le justifie — recommander un modèle qui ne peut pas travailler est la pire des deux erreurs
possibles ici.

Mesurer : `never acted`, qui existe pour cette question.

### Ce que la phase 5 s'interdit

- **Ajuster un prompt jusqu'à ce que le banc remonte.** Déjà interdit en phase 4, et deux chantiers
  ci-dessus en offrent la tentation directe.
- **Conclure d'une seule série.** L'écart mesuré est de trois tâches ; c'est le 5.1 qui rend le reste
  jugeable, et rien ne se conclut avant lui.
- **Écrire un chantier depuis une impression.** Chaque entrée ci-dessus porte le nombre dont elle
  vient. Un chantier sans nombre n'entre pas dans cette phase.


## Interdits et compte rendu

### Ce que tu ne fais jamais

- Ajouter une dépendance npm à l'exécution, ou un appel réseau vers une adresse que personne n'a
  configurée.
- Affaiblir une garantie, un test ou un défaut sûr pour faire passer un chantier.
- Inventer une API (Code for IBM i, ARCAD, un fournisseur), une route REST, un score d'évaluation ou
  un résultat de test.
- Écrire une version de modèle ou un prix en dur.
- Ajouter un index vectoriel, ou envoyer du code à une API d'embeddings.
- Pousser, publier, créer une release ou toucher aux secrets du dépôt.
- Annoncer comme fait ce qui n'a pas été exécuté.

### Compte rendu de chaque chantier

À la fin de chaque chantier, réponds exactement dans ce format :

```
Chantier : <identifiant> — <titre>
Fait : <ce qui a changé, en 2 à 4 phrases>
Fichiers : <liste>
Tests : <tests ajoutés> — vérifiés en retirant le correctif : oui / non
Réglages : <nouveaux réglages et leurs défauts>
Documentation : <README, PRIVACY, THREAT-MODEL, ADR, CHANGELOG, ROADMAP mis à jour>
Contrôles : <résultat de chaque commande de l'étape 10>
Non vérifié : <ce qui reste à valider, et ce qu'il faut pour le faire>
```

À la fin d'une phase, résume les chantiers, liste tous les points non vérifiés et propose l'ordre de
la phase suivante. Attends ensuite la consigne avant de la commencer.
