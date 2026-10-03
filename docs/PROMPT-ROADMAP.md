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

### 4.1 Un état de plan que le modèle tient

Ce qui distingue le plus un agent qui aboutit d'un agent qui tourne en rond n'est pas la taille du
modèle, c'est qu'il garde une **liste de ce qui reste à faire** et qu'il la met à jour. Aujourd'hui la
boucle est sans mémoire de son propre plan : douze étapes, chacune décidée depuis la trace.

À livrer : un état de tâches explicite, écrit et relu par le modèle à chaque étape, visible dans le
panneau. Mesurer : le taux de réussite, et surtout le nombre de tours qui finissent **sans avoir
vérifié**.

### 4.2 Les compétences chargées à la demande

Il y a environ 85 compétences. Les décrire toutes dans le prompt coûte des jetons à chaque tour et
dilue l'attention du modèle. Ce que fait un agent moderne : n'envoyer que les **noms** et charger le
contenu quand la compétence est choisie — exactement la discipline déjà appliquée à la base de
connaissance (chapitre 7 du cours : seuls les titres voyagent).

À livrer : une compétence est un nom plus une description d'une ligne dans le prompt ; son contenu
arrive par un appel d'outil. Mesurer : les jetons du préfixe, et le taux de réussite (il doit **ne pas**
baisser).

### 4.3 Des sous-agents qui travaillent vraiment en parallèle

`.hiveycode/agents/` existe : un prompt, une liste d'outils intersectée, un modèle, un contexte
vierge. Ce qui manque est ce qui les rend utiles : **plusieurs à la fois**, et une synthèse de leurs
retours par l'agent principal. Une recherche qui lirait trente fichiers coûte trente lectures dans le
contexte principal ; déléguée, elle coûte une réponse.

À livrer : lancer plusieurs sous-agents, attendre, synthétiser. Mesurer : les jetons du contexte
principal sur les tâches qui demandent de l'exploration, et le temps.

### 4.4 La vérification pendant, pas seulement après

`verifyTurn()` juge un tour **terminé**. Un raisonnement fort vérifie **en cours de route** : il
écrit le test avant le correctif, il relit ce qu'il vient d'écrire, il refuse de conclure sans preuve.

À livrer : une étape de vérification que l'agent s'impose avant de rendre sa réponse, et une réponse
qui **dit ce qu'elle n'a pas vérifié**. Mesurer : l'écart entre « le modèle dit que c'est fini » et
« le contrôle passe » — c'est le chiffre qui compte vraiment pour un utilisateur.

### 4.5 Le raisonnement suit les derniers modèles

Les budgets de réflexion sont traduits par fournisseur (`reasoning.effort`, budget de jetons). Ce qui
manque : que le **niveau** de raisonnement soit choisi d'après ce que le modèle sélectionné sait
faire, et que cette table se régénère comme le catalogue — même règle qu'en phase 3, aucune version
en dur, et le défaut de l'ADR-0027 pour mémoire (un critère revendiqué et jamais appliqué).

### 4.6 DeepSeek v4.1 — à mesurer, pas à supposer

Florian demande « l'optimisation de DeepSeek v4.1 si c'est faisable sans perte de qualité, sinon
oublie DeepSeek ». La formulation est la bonne et elle est tenable telle quelle : **c'est une
hypothèse à mesurer**. `deepseek/deepseek-v4.1-flash` coûte une fraction des modèles que les
préréglages payants emploient ; s'il obtient le même score sur les 56 tâches, il remplace le modèle
du rôle concerné ; s'il perd des points, il est abandonné. Le banc tranche, pas la préférence — et le
résultat est publié dans `eval/QUALITY.md` dans les deux cas.

⚠️ **Ce qui est explicitement hors de cette phase** : copier un prompt système d'un autre produit, et
ajuster un prompt jusqu'à ce que le banc remonte. Le second est la façon la plus sûre de fabriquer un
chiffre qui ne veut rien dire.

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
