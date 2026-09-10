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
dans le code renvoyé.

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
