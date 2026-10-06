# État et suite

Honnête plutôt que flatteur : ce qui marche, ce qui manque, ce qui n'est pas vérifié.

Ce document décrit l'état à la version **1.4.1**. Les chiffres qu'il annonce — version, tests, tâches d'évaluation — sont
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

### Phase 3 — Ce que ni Copilot ni Bob ne peuvent offrir

| Chantier | État | Vérification |
|---|---|---|
| 3.1 Corpus d'apprentissage des escalades | fait | **testé** — 19 tests : globs interdits appliqués et omissions comptées, épisode entièrement bloqué **jeté**, rétention et plafond, fixture = état **avant** (retombe si on y applique le diff), aucun `solution/` écrit, mauvaise réponse jamais un tour d'assistant, épisode gardé seulement si le tour distant est vert, **aucune requête réseau** dans les deux modules, désactivé par défaut |
| 3.2 Routage appris par dépôt | fait | **testé** — 20 tests : jamais hors des candidats autorisés, une réussite n'est pas un taux (retombe sans la règle du minimum), le moins cher **assez bon** et non le moins cher, un modèle essayé et insuffisant ne gagne pas et la phrase le dit, un historique d'un autre dépôt ou d'un autre genre ne compte pas, exploration bornée et déterministe sous un tirage injecté, jamais de remesure, tour non vérifié non enregistré, escalade jamais réroutée. ⚠️ **désactivé par défaut** (arbitrage assumé, ADR-0023) |
| 3.3 Relecture par un second modèle | fait | **testé** — 18 tests : un réglage gardé déclenche toujours (retombe sans la règle), un fichier de configuration et un diff trop gros aussi, un petit changement ordinaire non, la question est **narrow** et non « revois ce code », réponse illisible **jamais** « aucune objection » (retombe sans la règle), local uniquement, blocage seulement si l'organisation le demande ET qu'il y a quelque chose à résoudre |
| 3.4 Famille de compétences `finance` | fait | **testé** — 8 compétences, chacune **déclarant** sa tâche (retombe si on en retire une), aucune lacune admise dans cette famille, et un test exige que les tâches couvrent ≥ 3 langages. Banc 51 → **56 tâches** : ISIN/LEI/BIC, règlement avec jours fériés fournis, heures de marché à travers un changement d'heure, FIX (longueur + somme de contrôle), packed/zoned avec débordement — 56/56 honnêtes dans les deux sens |
| 3.5 Tableau de qualité publié | fait | **testé** — générateur livré (`--table eval/QUALITY.md`), 4 tests : non-mesuré ≠ 0 %, aucun concurrent en ligne de tableau, escalade jamais fondue dans la ligne du modèle nu (prouvé en retirant la séparation), prix inconnu jamais rendu « gratuit ». ⚠️ **aucun chiffre mesuré** : aucun modèle joignable ici, le fichier le dit et donne la commande |
| Prêt pour la soumission | fait | **testé** — 11 tests sur les règles de pré-publication ; le contrôle lit le `.vsix` réel et a trouvé **8 liens cassés dont 2 déjà publiés** (images du readme français, et `README.md` contre `readme.md` sur Linux) + 1 lien mort d'ADR dans le dépôt ; câblé dans la CI. ⚠️ **non vérifié** : aucune soumission tentée — compte éditeur, jeton Marketplace et jeton Open VSX sont les 4 gestes que seul le mainteneur peut faire (`docs/PUBLISHING.md`) |
| Passe de qualité mesurée | fait | **mesuré** — `local only` = **0/56**, dont **51/56 sans une seule étape d'outil**, en 33 min (`qwen2.5-coder:7b` sur Ollama, 12 cœurs, sans GPU) ; relevé dans `eval/QUALITY.md`. A révélé que **le mode agent local ne faisait rien** (Ollama rend les appels d'outils en texte, `tool_calls: null`) → corrigé, ADR-0026, 7 tests. ⚠️ **non mesuré** : `local + escalation` et les 3 préréglages (aucune clé de fournisseur ici) ; et aucune colonne Copilot/Bob, par principe |
| 4.1 Le plan devient une preuve | fait | **testé** — 8 tests : pas de plan ≠ échec, étapes restantes nommées, `skipped` réglé, verdict classé **en dernier** derrière un contrôle qui échoue (retombe si on retire la lecture du plan), outil offert au terminal, `planLeft` absent sans plan. A révélé **deux défauts plus graves que le chantier** : le terminal refusait ce que le panneau autorisait (plafonds codés en dur, défaut déjà corrigé une fois dans l'autre moitié) et **un refus de budget était indiscernable d'un échec du modèle** dans le relevé (42 refus lus comme 42 échecs). ADR-0028 |
| 4.3 Délégation, et le terminal | fait | **testé** — 6 tests : un agent sans liste n'hérite pas de `run_agent`, le demander explicitement ne l'autorise pas, la règle est **une** liste (`NEVER_DELEGATES`), aucun agent intégré ne voulait déléguer, la trace nomme l'agent, le terminal offre le dispatch par la même intersection. Les trois correctifs prouvés en les retirant **séparément**. Vérifié de bout en bout contre un vrai modèle (`explorer` dispatché depuis le terminal, 0,0157 $). ⚠️ Le parallélisme et la synthèse existaient déjà — rédaction fausse une 3e fois |
| 4.4 Vérifier pendant le tour | fait | **testé** — 11 tests : un changement non vérifié déclenche un rappel **en forme de preuve**, un tour qui n'a rien changé n'en déclenche pas, un contrôle **lancé** (même échoué) suffit à se taire, une modification refusée n'est pas un changement, liste de fichiers bornée et dédupliquée ; et côté boucle : **un seul rappel** (prouvé en retirant le garde), il coûte une étape, la réponse prématurée est jetée, et sans `selfCheck` le tour finit exactement comme avant. + `edit_file`/`write_file` rapportent les **erreurs** de l'éditeur (jamais les avertissements, **rien** quand il n'y en a pas, attente bornée). ADR-0032. ⚠️ Effet sur `claimedDone` **pas encore mesuré** |
| 4.5 Capacité de raisonner | fait | **testé** — 4 tests, les 3 premiers retombent si on rétablit l'ancienne expression : le catalogue reconnaît une génération le jour de sa sortie, **chaque modèle `deep` d'un préréglage payant doit pouvoir raisonner**, le repli **ne contient aucun chiffre** (lu dans son source), et la capacité est générée depuis `supported_parameters`. ⚠️ Défaut réel : la regex nommait `gpt-5`, le marché est à `gpt-6` → le contrôle de réflexion était **caché sur le modèle le plus fort du produit**. ADR-0033. Le reste du chantier (choisir le niveau) n'existait pas : traduction déjà juste, capacité binaire |
| 4.6 DeepSeek v4.1 | **mesuré — abandonné** | **44/56** contre une plage de **47–50** pour le préréglage, et **11 échecs annoncés comme réussites** contre 5–7. Sous toute la plage observée, donc la direction tient malgré le bruit. Décision écrite **avant** la mesure. ⚠️ **33× moins cher** (0,0024 $/tâche contre 0,0766 $) — écrit aussi, parce que ça ne va pas dans le sens de la décision. ADR-0034 |
| 4.4 — éprouvé | **mesuré — justifié** | 6 tâches « sans vérification » ajoutées (banc 56 → **62**). Sur `qwen3.7-flash` : **0/6 sans le rappel, 4/6 avec**, déclenché exactement 4 fois, chaîne causale visible tâche par tâche. Sur `gpt-6.1-sol-pro` : **jamais déclenché** — il vérifie de lui-même. ⇒ filet pour les **modèles bon marché**, pas pour le banc. ADR-0035 |
| Qualité mesurée | **4 lignes** | `remote only` (`qwen3.7-flash`) **45/62 pour 0,043 $** · `hivey/free` **32/62 pour 0 $** — les deux sur le jeu complet avec les consignes corrigées, **sans aucun refus**, donc les seules comparables entre elles. `hivey` 50/56 et `deepseek` 44/56 datent d'avant la réparation des consignes et le tableau le dit. ADR-0036 |
| 4.4 — confirmé à l'échelle | **mesuré** | Rappel déclenché **23/62** (`qwen3.7-flash`), **15/62** (gratuit), **0/56** (`gpt-6.1-sol-pro`). Entre un quart et un tiers des tours d'un modèle bon marché finissent sur un changement non vérifié, aucun chez un modèle fort ⇒ filet pour les modèles bon marché, confirmé hors des 6 tâches construites exprès |
| **Phase 5 — écrite** | à faire | Dérivée des chiffres, pas d'impressions (`docs/PROMPT-ROADMAP.md`). **5.1 rendre le banc capable de trancher** (48/47/50 sur 3 séries identiques ⇒ un effet de 2 tâches n'est pas jugeable — passe devant tout le reste) · **5.2 une réponse ne peut pas contredire son verdict** (10 des 17 échecs annoncés comme réussites arrivent **après** un rappel, 5 avec un échec visible dans la trace) · **5.3 vérifier la bonne chose** (les 5 autres n'ont rien vu échouer ; 7/10 sont des tâches IBM i à contrôle **structurel**, donc autant le banc que le modèle) · **5.4 `use_skill` = 0 sur 180 tours** → forcer, mesurer, réparer la sélection ou retirer l'offre · **5.5 `run_agent` = 1 sur 180** → même protocole · **5.6 `local only` inutilisable** (0/56, 51 sans aucune étape d'outil) alors que c'est la configuration qui porte l'argument du produit |
| ⚠️ 402 n'est plus une impasse | **corrigé, éprouvé en vrai** | Deux défauts, l'un cachant l'autre : la porte d'`adaptRequest` ne lisait que `400`, donc **le seul refus portant son remède n'atteignait jamais les remèdes** ; et quand il y arrivait, la règle générique **supprimait** `max_tokens` (le message du 402 contient ces mots) — demander l'illimité quand le serveur demande moins. Le plafond est désormais **abaissé** au montant finançable, jamais supprimé ; sous 256 jetons le refus tient (un fragment en silence est pire que l'erreur) ; et la réponse dit qu'elle a été raccourcie. ⚠️ « il y a du crédit » = marge sous le **plafond de la clé**, pas le **solde du compte**. ADR-0037 |
| ⚠️ Consignes corrompues | **corrigé** | Les consignes passaient par `sh -c` : les accents graves étaient **exécutés**. `` `any` `` disparaissait, `` `open` `` était remplacé par l'aide de `xdg-open`. **3 tâches des 56 d'origine** touchées, donc tous les chiffres publiés les incluaient. Passage en **argv** |
| ⚠️ Refus du fournisseur | **corrigé** | Un `402` d'OpenRouter (crédit retenu par les requêtes en vol) a frappé **54 tâches sur 62** et le harnais a compté **8/62** — il aurait publié **13 %** comme une qualité. Enregistré comme refus ; un jeu qui en contient n'énonce aucun taux. + concurrence **adaptative** et réserves (`--note`) portées par le tableau |
| 4.4 — verdict | **non éprouvé** | Le rappel s'est déclenché **0 fois sur 56**, et c'est expliqué par la mesure : **51 tâches ont changé quelque chose, et dans les 51 un contrôle a tourné** → 0 occasion sur 51. Les tâches du banc demandent un résultat vérifiable, donc le modèle contrôle de lui-même ; la population visée (« change ça » sans demander de preuve) n'y est pas. Mécanisme **gardé**, état écrit |
| Bruit du banc | **mesuré** | ⚠️⚠️ **48, 47 et 50** sur trois séries du **même** préréglage, mêmes tâches, même build → **une différence de moins de 3 tâches n'est pas un résultat**. Le tableau le publie lui-même quand on lui donne plusieurs séries. Rapporté, jamais moyenné |
| Banc en parallèle | fait | 56 tâches de ~90 min à **~7 min** (6 à la fois). Le seul obstacle était `process.env["HIVEY_CODE_MODEL"]`, un global ; chaque tâche a aussi son propre `HOME`, donc une mesure qui ne lit plus la configuration personnelle de son opérateur |

### Phase 2 — Égaler Copilot sur ce que l'entreprise compare

| Chantier | État | Vérification |
|---|---|---|
| 2.1 Politique d'entreprise signée | fait | **testé** — 24 unitaires (signature altérée, signée par un autre, politique supprimée alors que la clé reste, version inconnue, réglage permissif ignoré champ par champ, fusion des listes, utilisateur plus strict laissé tranquille, liste vide = état permissif, adresse comparée sur l'origine et non en préfixe) + **1 test d'intégration dans un vrai éditeur** qui prouve que `readSettings()` revient restreint (retombe sans le point d'étranglement) |
| 2.2 Envoi du registre vers le SIEM | fait | **testé** — 31 tests, dont 10 **contre un vrai serveur TLS local** (envoi et cadrage RFC 5425, collecteur absent, raccrochage pendant la poignée de main, certificat non épinglé refusé, reprise de la file) ; liste blanche de champs prouvée en la transformant en liste noire ; file durable, acquittement par identité, borne comptée ; identité jamais découverte. ⚠️ le test de certificat exige `openssl` et **échoue** s'il manque. ⚠️ limite assumée et testée : syslog n'a pas d'accusé de réception |
| 2.3 Preuve de souveraineté | fait | **testé** — 21 tests : comptes et destinations, catégories sommées, fenêtre qui borne les comptes mais **pas** la chaîne, ligne modifiée → rupture au bon rang, ligne supprimée → lacune que le rechaînage ne cache pas, troncature tolérée, signature qui détecte toute édition, limites présentes dans le document, et le DER de la requête **relu par openssl**. ⚠️ **non vérifié** : aucune vraie autorité RFC 3161 interrogée d'ici — l'extension ne prétend pas vérifier le jeton, par conception |
| 2.4 Hooks avant et après outil | fait | **testé** — 18 tests : lecture et défauts, hook non exécutable signalé par son rang, délai plafonné, correspondance sur when/tool/chemin, **un hook filtré par chemin ne se déclenche pas sans chemin**, consentement qui nomme les commandes et empreinte qui ignore un renommage mais pas un changement de commande, `before` qui refuse, `after` qui ne peut pas, délai dépassé ≠ refus, et un hook en échec qui **compte pour `verifyTurn`** (retombe sans le câblage) |
| 2.5 Agent en arrière-plan isolé | fait | **testé** — 15 tests, dont un **contre un vrai conteneur** (pas d'interface réseau, pas de DNS, chemin hors worktree illisible) ; refus sans moteur et sans image prouvés en les retirant ; commande passée en un seul argument (`; --privileged` ne devient pas une option) ; **aucun outil git et aucun `push`** vérifiés sur le source ; verdict du tour depuis `verifyTurn`. ⚠️ **non vérifié** : aucune tâche de fond complète exécutée contre un vrai modèle |
| 2.6 Revue de branche | fait | **testé** — 20 tests : constats lus d'un bloc entouré de prose, ligne en chaîne de caractères, tableau vide = réponse légitime (**défaut trouvé et corrigé**), réponse illisible **jamais** une revue vide, constat sans fichier ou sans message signalé, diff en **trois** points, base demandée à git, diagnostics remplacés à chaque revue, aucun accès réseau depuis le module, aucune porte vers une forge |
| 2.7 Symboles et graphe d'appels | fait | **testé** — 3 unitaires (liste blanche du mode Plan, les trois branches « serveur muet », position annoncée) + **1 test d'intégration dans un vrai éditeur** qui appelle les outils contre le service TypeScript de VS Code |

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

### Une famille `finance` adossée à des tâches (0.84.0)

- **8 compétences** : arrondis, décimal sans flottant, packed/zoned, règlement T+n, heures de marché,
  ISIN/LEI/BIC, FIX, échéanciers. Chacune **déclare** la tâche qui l'éprouve, et **aucune lacune n'est
  admise** dans cette famille : une partition IBM i est une excuse, l'arithmétique décimale non.
- **56 tâches d'évaluation**, honnêtes dans les deux sens.
- ⚠️ Les jours fériés et les calendriers sont **des paramètres**, jamais codés en dur.


### Un second lecteur avant les diffs dangereux (0.83.0)

- **Un réglage gardé, un fichier de configuration ou un diff trop gros** déclenchent une relecture
  (testé) : les changements où approuver sans lire coûte le plus sont les petits.
- ⚠️ **Local uniquement** : un second lecteur facturé n'est pas appelé, et la carte le dit.
- ⚠️ **Consultatif par défaut** ; bloquant seulement si l'organisation l'exige — et une réponse
  illisible n'est jamais rendue par « aucune objection ».


### Le routage apprend, par dépôt (0.82.0)

- **Le modèle le moins cher dont le taux observé dépasse le seuil** (testé), avec la phrase qui porte
  les vrais chiffres — « 9 sur 10 dans ce dépôt ».
- **Trois limites testées** : jamais hors des modèles autorisés, jamais de confiance avant un
  échantillon, et aucune mesure sur un tour que rien n'a vérifié.
- ⚠️ **Désactivé par défaut** : un routeur qui apprend change quel modèle répond.


### Ce que cette machine a appris reste sur cette machine (0.81.0)

- **Les escalades réussies sont conservées localement** (testé) : la demande, les fichiers tels qu'ils
  étaient, les deux diffs, la commande qui a tranché. **Désactivé par défaut** — un épisode contient du
  code source hors du dépôt — et **rien ne sort** (aucune requête réseau dans le code, vérifié par un
  test).
- **Deux exports** : des tâches dont la fixture est l'état *avant*, et un jeu de conversations où la
  mauvaise réponse est du contexte et non la réponse.
- **Trois commandes** : ce qu'il contient, l'exporter, le supprimer.


### Revoir une branche, et demander au serveur de langage (0.80.0)

- **Revue de branche en constats navigables** (testé) : fichier, ligne, gravité, catégorie, correctif
  — dans le panneau Problèmes. Diff en trois points, base demandée à git.
- ⚠️ **Une réponse illisible n'est jamais une revue vide** — et un tableau vide est une réponse
  légitime (défaut trouvé par son propre test).
- ⚠️ **Pas de publication en commentaires de pull request** : ce serait écrire au nom de quelqu'un sur
  un serveur. La porte est un serveur MCP que l'utilisateur configure.
- **`find_references`, `call_hierarchy`, `workspace_symbols`** (testé dans un vrai éditeur), en mode
  Plan — et un serveur muet n'est jamais rendu par une réponse vide.


### Une tâche de fond que personne ne regarde, donc mieux bornée (0.79.0)

- **Son propre worktree, sa propre branche** (testé), et plusieurs en parallèle sans se voir.
- ⚠️ **Sans moteur de conteneur, aucune commande** — refusée, pas exécutée sur l'hôte (testé, retombe
  si on autorise le repli). Avec un moteur : aucun réseau, seul le worktree monté, quotas — **vérifié
  contre un vrai conteneur**.
- ⚠️ **Aucun outil git, aucun `push`** (testé sur le source) : la branche reste locale.
- **Le verdict vient de `verifyTurn`** : « terminé » n'est pas « réussi ».


### Les commandes de l'équipe autour d'un appel d'outil (0.78.0)

- **Hooks avant et après** (testé) : `before` refuse l'appel, `after` est signalé au modèle et
  compte pour le verdict du tour — au même titre qu'un test en échec.
- ⚠️ **Un hook du dépôt est une exécution de code** : la question nomme chaque commande et
  l'approbation est épinglée par empreinte, comme un serveur MCP en stdio. Un renommage ne redemande
  pas ; un changement de commande, si.
- **Tous les outils sont enveloppés d'un coup** (testé) : un outil qui devait y penser l'oublierait.


### Une preuve qui dit ce qu'elle ne prouve pas (0.77.0) — résidu n°9 fermé

- **Preuve de souveraineté signée** (testé) : requêtes, destinations et volumes, catégories
  anonymisées, verdict de la chaîne en haut du document, et **ses propres limites dedans**.
- **L'horodatage RFC 3161 porte sur la tête de la chaîne** : une seule empreinte sort, et c'est ce
  qui relie enfin la chaîne à une horloge extérieure à la machine.
- ⚠️ **L'extension ne prétend pas vérifier le jeton** : elle l'obtient et le conserve ; le dossier
  livré contient la commande `openssl ts -verify` pour celui qui audite, avec sa propre racine.
- Le DER écrit à la main est **relu par openssl** dans un test qui échoue si openssl manque.


### Le registre part vers le SIEM, sans jamais emporter de contenu (0.76.0)

- **Deux transports écrits à la main** (testé contre un vrai serveur TLS local) : syslog RFC
  5424/5425 et OTLP/HTTP. Désactivé par défaut.
- **Liste blanche de champs, jamais une liste noire** (testé, retombe si on l'inverse) : un champ
  ajouté au registre demain n'atteint pas le collecteur tant que personne ne l'y ajoute.
- **Une file sur disque, et une ligne non envoyée reste visible** (testé) : l'acquittement retire les
  lignes envoyées et non les n premières, et la borne compte ce qu'elle perd.
- ⚠️ **Défaut trouvé par son propre test** : les lignes étaient acquittées sur une écriture dans le
  tampon du noyau, donc un collecteur qui raccrochait obtenait un succès.


### Une politique que l'utilisateur ne peut pas desserrer (0.75.0)

- **Politique signée en Ed25519 à un emplacement machine** (testé, y compris dans un vrai éditeur) :
  elle ne fait que restreindre, donc le pire qu'elle puisse faire est de rendre l'extension moins
  capable, jamais moins prudente.
- **Un échec n'est pas une absence** (testé) : signature invalide, version inconnue ou politique
  supprimée alors que la clé reste épinglée → mode le plus sûr, bruyamment.
- **Jamais lue depuis l'espace de travail** (testé sur le code du chargeur).
- ⚠️ La restriction était appliquée **deux fois** — trouvé par le test d'intégration seul.


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
  carte du dépôt, boucle d'agent. **1327 tests unitaires** plus **43 tests d'intégration dans un vrai
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
