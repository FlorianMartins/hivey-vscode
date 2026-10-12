# Traitement des données

Fiche factuelle, pour une équipe sécurité ou un DPO qui doit valider l'outil. Elle décrit ce que
l'extension fait, pas ce qu'elle promet.

## Ce qui est traité, et où

| Donnée | Traitement | Sort de la machine ? |
|---|---|---|
| Code du fichier en cours (préfixe/suffixe du curseur) | Complétion inline | **Non** avec la configuration par défaut (serveur local). Oui si `completion.provider` est distant — et alors anonymisé. |
| Fichiers ouverts voisins (≤ 2, 1 200 caractères) | Contexte de complétion | Idem. |
| **Fichier entier en cours d'édition** | Prédiction de la prochaine modification (`completion.nextEdit`) | **Non** par défaut : cette fonction est **désactivée** dès que le point d'accès de complétion n'est pas local, et il faut mettre `completion.nextEditRemote` à `true` pour l'autoriser. C'est la seule fonction qui envoie un fichier **complet** sans que vous l'ayez joint, d'où la double barrière. Les globs interdits s'appliquent. |
| **Sortie des commandes lancées par l'agent** | `run_command` renvoie la sortie et le code de retour au modèle | Oui si la discussion est distante, anonymisée comme tout résultat d'outil. Avant la 0.39.0 la sortie n'était pas lue du tout : c'est une donnée **de plus** qui circule, et elle est signalée ici pour cette raison. |
| Chemins + symboles de tête du dépôt | Carte du dépôt jointe à la discussion | Oui si la discussion est distante. **Les corps de fichiers ne sont pas envoyés** — seulement les signatures. |
| Fichier ou sélection que vous joignez | Discussion | Oui si distante, anonymisé, après consentement. |
| **Texte collé ou déposé** (> 1 200 caractères ou > 12 lignes) | Joint à la discussion plutôt qu'inséré dans la zone de saisie | Oui si distante, anonymisé comme n'importe quelle pièce jointe, et clôturé comme contenu non fiable. |
| **Image collée ou déposée** | Jointe à la discussion, réduite à 1 600 px de côté par le panneau | Oui si distante — **et c'est la seule donnée que l'anonymisation ne peut pas toucher** (voir ci-dessous). |
| Fichiers lus par l'agent | Discussion en mode agent | Idem, ré-anonymisés à **chaque** étape. |
| Diff indexé (`git diff --cached`) | Message de commit | Idem. |
| Sélection du terminal | « Expliquer la sortie » | Idem. |
| Clés d'API | Trousseau du système (`SecretStorage`) | Envoyées uniquement au fournisseur concerné, dans l'en-tête d'autorisation. |
| Historique des discussions | `workspaceState` de VS Code, sur le disque local | **Non.** |
| Journal des envois | `globalState` de VS Code, sur le disque local | **Non.** Métadonnées seulement. |
| Statistiques d'usage | Compteur en mémoire, remis à zéro à chaque session | **Aucune télémétrie, nulle part.** |

## Ce qui n'est jamais journalisé

Le journal des envois (`Aperçu des données sortantes`) contient : horodatage, hôte, modèle, nombre
de jetons, part servie par le cache, coût, **catégories** anonymisées (`EMAIL×3, HOST×1`), plus
depuis la 0.39.0 un numéro d'ordre et deux empreintes (la sienne et celle de l'entrée précédente).
Il ne contient ni le prompt, ni la réponse, ni une seule valeur masquée. Le coffre qui relie un
marqueur à sa vraie valeur vit en mémoire, meurt avec la conversation et n'est jamais sérialisé.

Les empreintes portent sur ces **métadonnées** et sur rien d'autre. C'est la distinction qui compte :
hacher ce qui **sort** est le geste qui a l'air d'une protection et n'en est pas — l'empreinte d'une
adresse e-mail *est* une adresse e-mail pour qui possède une liste d'adresses. C'est pourquoi
l'anonymisation ici est réversible-avec-un-coffre-local et non un condensat, et pourquoi le hachage
n'apparaît qu'au seul endroit où il répond à une vraie question : « est-ce que quelqu'un a modifié
ce journal après coup ? »

## Ce qu'une image change, et pourquoi c'est dit deux fois

Toute l'architecture de confidentialité de cette extension travaille sur du **texte** : des noms,
des hôtes, des chemins, des identifiants sont trouvés et remplacés par des marqueurs avant le
départ. Rien de tout cela ne peut s'appliquer à une capture d'écran, qui peut porter un bureau
entier — une fenêtre de messagerie, un gestionnaire de mots de passe ouvert, le nom d'un client.

Donc, quand une image part vers un point d'accès distant :

- la carte de consentement le **dit** — « 1 image, envoyée telle quelle — une image ne peut pas être
  pseudonymisée » — au lieu de la compter comme une pièce jointe ordinaire ;
- le journal des sorties enregistre le **nombre d'images** de la requête, parce qu'une ligne disant
  « 0 anonymisation » sur un tour qui a envoyé une capture d'écran serait vraie et trompeuse ;
- sur un point d'accès **local**, rien de tout cela ne se pose : l'image ne quitte pas la machine.

Les globs interdits s'appliquent à un fichier déposé comme à n'importe quel autre. Ce qu'ils ne
peuvent pas faire, c'est reconnaître un secret **dans** une image.

## Corpus d'apprentissage des escalades

**Désactivé par défaut.** `hiveyCode.corpus.enabled` vaut `false`, et tant qu'il y reste rien n'est
enregistré.

Quand il est activé, chaque fois qu'un modèle local échoue et qu'un modèle distant réussit **avec une
vérification au vert**, l'extension garde **sur cette machine** : la demande, les fichiers touchés
**tels qu'ils étaient avant**, le diff et l'erreur de la tentative locale, le diff final, et la
commande dont le code de retour a tranché.

⚠️ **Un épisode contient donc du code source**, sur le disque, **hors du dépôt** (le stockage global
de l'extension — un corpus dans l'espace de travail est un corpus que le `git add -A` de quelqu'un
finit par committer). C'est pour cela que la fonctionnalité est désactivée par défaut : c'est une
chose raisonnable à conserver et une chose déraisonnable à commencer à conserver sans qu'on le
demande.

**Rien ne sort.** Aucune requête réseau n'existe dans ce code, et un test lit le source pour le
vérifier. C'est le fondement de la fonctionnalité : c'est précisément ce qu'un service hébergé ne
peut pas recueillir sans prendre le code.

Les contrôles, un geste chacun, dans la palette de commandes :

- **la liste des globs interdits s'applique** — un fichier qu'on refuse d'envoyer à un modèle est un
  fichier qu'on ne veut pas dans un corpus ; un épisode dont tous les fichiers étaient bloqués est
  **jeté** et non conservé amputé ;
- la **rétention** est configurable (`corpus.retentionDays`, 90 par défaut ; `0` n'en garde plus
  aucun nouveau sans détruire l'existant) ;
- **« Ce que contient le corpus d'apprentissage »** dit combien d'épisodes et combien de fichiers de
  source sont là ;
- **« Supprimer le corpus d'apprentissage »** détruit tout, après confirmation ;
- **« Exporter le corpus d'apprentissage »** écrit deux choses dans un dossier choisi : des tâches au
  format `eval/tasks` (dont la fixture est l'état **avant**, ce qui est ce qui fait échouer leur
  contrôle) et un jeu de conversations JSONL pour affiner un modèle local. Le dossier contient un
  `READ-THIS-FIRST.txt` qui dit ce qu'il contient : **un corpus est une copie**, à traiter comme le
  dépôt lui-même.

La politique de l'organisation peut **désactiver** la fonctionnalité (`disabled: ["corpus"]`). Elle ne
peut pas l'activer — une politique qui pourrait *accorder* serait un fichier qui vaut la peine d'être
falsifié ([ADR-0019](adr/0019-la-politique-ne-fait-que-restreindre.md)).

## Envoi du registre à un collecteur (SIEM)

**Désactivé par défaut.** `hiveyCode.siem.transport` vaut `off` et rien ne part. Un opérateur peut
l'activer vers un collecteur syslog sur TLS (RFC 5424 / RFC 5425) ou vers un point d'accès
OTLP/HTTP.

Ce qui part alors est **exactement** ce que le registre local contient, ligne par ligne : position
dans la chaîne, empreintes, horodatage, fournisseur, hôte, modèle, nombres de jetons, coût, nombre
d'anonymisations et leur résumé par catégorie, nombre d'images. **Jamais de contenu** — ni la
question, ni la réponse, ni les valeurs anonymisées, ni les noms de fichiers.

Et ce n'est pas une intention : la ligne exportée est construite depuis une **liste blanche de
champs** (`EXPORTED_FIELDS`, `src/core/siem/format.ts`), pas en retirant ceux qu'on juge sensibles.
Un champ ajouté au registre demain **n'atteint pas le collecteur** tant que quelqu'un ne l'ajoute
pas à cette liste, délibérément ; un test le garantit. Une liste noire laisserait passer par défaut
le champ ajouté le mois prochain, et c'est exactement celui où quelqu'un aura mis un chemin.

L'**identité** est un identifiant que l'opérateur choisit (`hiveyCode.siem.userId`), **vide par
défaut et jamais rempli automatiquement**. Un identifiant choisi est un pseudonyme que
l'organisation peut résoudre et qu'un auditeur ne peut pas ; une adresse e-mail prise dans une
configuration git serait une donnée personnelle que personne n'a consenti à envoyer, dans un
système avec sa propre rétention. Vide signifie que le champ est simplement absent.

La file d'attente est **sur disque** : une coupure du collecteur coûte un délai, jamais une ligne,
et une ligne non envoyée reste **visible** (commande « Où en est le flux d'audit »). Quand la file
atteint sa borne, les lignes perdues sont **comptées** et dites, pas silencieuses.

⚠️ **Limite assumée** : syslog n'a aucun accusé de réception applicatif. « Envoyé » signifie « la
connexion TLS s'est terminée sans erreur » — un collecteur qui accepte les octets et les jette est
indiscernable d'un qui les stocke, sur n'importe quel transport syslog. OTLP, lui, rend un code HTTP,
et c'est la seule des deux voies où un refus du collecteur est connu.

## Anonymisation : ce qui est reconnu

- **Identifiants** — formes AWS, GitHub, Slack, Stripe, OpenAI, Anthropic, OpenRouter, Google, npm,
  Hugging Face, JWT, blocs PEM, identifiants dans une URL de connexion, valeurs assignées à un nom
  de secret, plus un filet à entropie pour le reste.
- **Personnes** — adresses e-mail, numéros de téléphone.
- **Machines** — IPv4/IPv6 (hors loopback), adresses MAC, hôtes en `.internal/.corp/.local/.lan/…`.
- **Disposition** — le compte utilisateur dans `/home/…`, `/Users/…`, `C:\Users\…`.
- **Vos termes** — la liste `privacy.customTerms` : clients, projets, marques internes.

Le remplacement est **stable et réversible** : la même valeur donne toujours le même marqueur dans
une conversation (le modèle peut donc encore raisonner : « la même adresse apparaît dans le test et
dans la fixture »), et les marqueurs redeviennent les vraies valeurs sur votre machine, y compris
dans le code renvoyé **et dans les arguments des outils** — ce que l'agent écrit sur le disque, le
chemin qu'il ouvre et l'extrait qu'il cherche portent la vraie valeur, pas le marqueur. La
restauration a lieu avant la vérification des arguments, avant la carte d'autorisation et avant
l'exécution : la phrase que vous approuvez décrit donc ce qui va réellement se passer.

## Configuration recommandée en entreprise

Dans `.vscode/settings.json` d'un dépôt sensible, ou par stratégie de réglages :

```jsonc
{
  "hiveyCode.chat.provider": "local",
  "hiveyCode.completion.provider": "local",
  "hiveyCode.endpoints.local": "https://llm.interne.exemple/v1",
  "hiveyCode.privacy.redaction": "strict",
  "hiveyCode.privacy.egressPolicy": "ask-always",
  "hiveyCode.privacy.customTerms": ["NomDuClient", "ProjetInterne"],
  "hiveyCode.privacy.blockedGlobs": ["**/.env*", "**/*.pem", "**/secrets/**", "**/donnees-clients/**"],
  "hiveyCode.escalation.policy": "never",
  "hiveyCode.budget.dailyUsd": 0
}
```

Avec `escalation.policy: "never"` et deux fournisseurs locaux, **aucun octet ne quitte le réseau**,
et le journal des envois le montre : il reste vide.

## Vérifier plutôt que croire

1. `Hivey Code : Aperçu des données sortantes` — la liste des envois distants.
1bis. `Hivey Code : Vérifier que le journal des sorties n'a pas été modifié` — chaque entrée porte
   l'empreinte de la précédente, donc modifier une ligne oblige à réécrire toute la suite et
   supprimer une ligne du milieu laisse un trou que la numérotation trahit. Cela ne rend pas la
   falsification impossible, cela la rend **visible** — c'est tout ce que prétend un journal
   inviolable en écriture, et c'est beaucoup plus que ne prétend un journal non chaîné.
   `Hivey Code : Exporter le journal des sorties` en sort une copie (JSONL ou syslog RFC 5424) pour
   un collecteur qui n'est pas sur cette machine, avec les empreintes, afin que les deux copies
   puissent être comparées.
2. Le canal de sortie « Hivey Code » — chaque activation journalise le fournisseur, l'URL et le
   niveau d'anonymisation ; chaque complétion journalise sa latence et son volume.
3. Un proxy ou `tcpdump` sur le poste : l'extension n'ouvre aucune autre connexion. Pas de serveur
   de télémétrie, pas de vérification de licence, pas de catalogue distant au démarrage (le
   catalogue de prix est un fichier généré et embarqué).
