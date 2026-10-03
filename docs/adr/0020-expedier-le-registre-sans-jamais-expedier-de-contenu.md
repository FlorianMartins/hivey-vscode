# ADR-0020 — Expédier le registre sans jamais expédier de contenu

**Date** : 2026-10-03 · **Statut** : accepté

## Contexte

Le registre des sorties répond déjà à « qu'est-ce qui a quitté cette machine, quand, vers qui, et
peut-on savoir si quelqu'un a modifié le journal » ([ADR-0011](0011-hacher-le-journal-jamais-les-donnees.md)).

Ce qu'il ne peut pas faire, c'est atteindre l'équipe dont c'est le métier de regarder. Un tableau
JSON chaîné dans l'état d'espace de travail d'un développeur est une preuve que personne ne
surveille — et « nous avons un journal local » ne passe pas une revue de conformité, parce que
l'auditeur demande qui le relit.

## Décision

**Les mêmes lignes partent, inchangées, vers là où l'organisation collecte déjà ses journaux.**
Désactivé par défaut, avec deux transports écrits à la main.

### 1. Une liste blanche de champs, jamais une liste noire

⚠️⚠️ **La règle unique : jamais de contenu.** Ni la question, ni la réponse, ni les valeurs
anonymisées, ni les noms de fichiers. Un journal de ce qu'on cherchait à garder privé n'est pas une
fonction de confidentialité, et un SIEM est l'endroit où cette erreur est la plus difficile à
défaire : la donnée est désormais dans un système avec sa propre rétention, ses propres exploitants
et son propre export.

Donc la ligne exportée est **construite** depuis une liste blanche (`EXPORTED_FIELDS`) et non
obtenue en retirant les champs jugés sensibles. La différence n'est pas stylistique : une liste
noire laisse passer **par défaut** le champ ajouté au registre le mois prochain, et le champ ajouté
le mois prochain est exactement celui où quelqu'un aura mis un chemin de fichier. Un test tient la
liste, et un second vérifie qu'aucun formateur ne peut émettre de contenu quoi que porte la ligne.

### 2. Deux transports, écrits à la main

Les organisations ont l'une de deux choses et jamais les deux : un collecteur syslog en place depuis
quinze ans, ou un pipeline OpenTelemetry construit l'an dernier. Les deux sont écrits contre leurs
spécifications (RFC 5424, RFC 5425, l'encodage JSON d'OTLP/HTTP) avec `node:tls` et le client HTTP
du projet, pour la raison d'[ADR-0004](0004-zero-dependance-a-l-execution.md) — et parce qu'un
expéditeur de journaux est précisément le genre de bibliothèque qui s'avère tamponner en mémoire et
perdre la file à la sortie.

Deux pièges méritaient un test chacun :

- **le cadrage compte des OCTETS.** Un nom de modèle avec un caractère non-ASCII fait divergher
  `string.length` et la longueur en octets, et le collecteur lit alors le début du message suivant
  comme la fin de celui-ci — tout ce qui suit est illisible ;
- **les trois caractères que la RFC 5424 réserve** (`"`, `\`, `]`) doivent être échappés dans une
  valeur de paramètre. S'y tromper ne produit pas un message rejeté mais un message que le
  collecteur analyse **dans les mauvais champs**, ce qui est pire parce que ça a l'air correct.

### 3. Une file sur disque, et une ligne non envoyée reste visible

L'intérêt d'expédier le registre est que quelqu'un surveille. Un expéditeur qui perd des lignes
quand le collecteur est en panne est **pire que pas d'expéditeur** : le SIEM montre un après-midi
calme et personne ne sait s'il était calme ou si le tuyau était cassé.

Donc la file est sur disque, et les deux opérations sont séparées : une ligne n'est retirée que
lorsque le collecteur l'a prise. Un plantage entre l'envoi et l'acquittement renvoie la ligne — un
doublon dans un SIEM est une nuisance, un trou est un trou dans un audit — et chaque ligne porte son
`seq` et son `hash`, donc un doublon est reconnaissable et un trou ne se devine pas.

L'acquittement retire **les lignes qui ont été envoyées, pas les n premières** : une ligne peut
avoir été mise en file pendant que le lot était en vol, et retirer « les n premières » perdrait
alors une ligne jamais envoyée.

Et la borne de la file **compte** ce qu'elle perd, sans jamais le taire ; seul un opérateur qui en
prend acte remet le compteur à zéro.

### 4. L'identité est choisie, jamais découverte

`siem.userId` est **vide par défaut et rien ne le remplit**. Un identifiant que l'opérateur a choisi
est un pseudonyme que l'organisation peut résoudre et qu'un auditeur ne peut pas ; une adresse
e-mail prise dans une configuration git serait une donnée personnelle que personne n'a consenti à
envoyer. Vide veut dire que le champ est **absent** et non vide. Un test lit le source de
l'expéditeur et refuse toute tentative de découvrir une identité.

## Conséquences

- ⚠️ **Limite assumée, et écrite dans `docs/PRIVACY.md`** : syslog n'a **aucun accusé de réception
  applicatif**. « Envoyé » ne peut signifier que « la connexion TLS s'est terminée sans erreur » ; un
  collecteur qui accepte les octets et les jette est indiscernable d'un qui les stocke. Un test
  **enregistre cette limite** au lieu de la cacher — et il dit quoi faire si quelqu'un rend un jour
  le client capable de faire la différence. OTLP rend un code HTTP, et c'est la seule des deux voies
  où un refus du collecteur est connu.
- ⚠️ **Défaut trouvé par ce même test** : la première version acquittait les lignes sur le rappel de
  `write()`, c'est-à-dire sur une écriture dans le tampon du noyau. Un collecteur qui terminait la
  poignée de main puis raccrochait obtenait un succès pour des lignes qui n'étaient arrivées nulle
  part. L'acquittement est désormais la **fermeture propre** du socket après l'écriture complète.
- Une connexion par vidage, pas un socket maintenu ouvert : un socket TLS de longue durée vers un
  collecteur est une chose qui meurt à moitié en silence — le noyau l'a, le collecteur l'a oublié —
  et le mode de défaillance est des lignes qui s'écrivent avec succès dans le vide.
- La vérification du certificat est **activée par défaut** et peut être désactivée délibérément,
  parce que l'alternative est un opérateur avec un collecteur auto-signé et une échéance qui
  désactive la fonction entière. Le réglage porte le nom de ce qu'il fait, et la preuve de
  souveraineté (chantier 2.3) dira quand il est désactivé.
- Un expéditeur de journaux **ne peut pas faire échouer la requête qu'il journalise** : l'appel est
  enveloppé, et une file illisible coûte la durabilité de cette session, pas l'extension.

## Rejeté

- **Une bibliothèque d'expédition de journaux.** Voir §2.
- **Envoyer le contenu « au cas où l'audit en aurait besoin ».** C'est l'inverse du produit.
- **Tamponner en mémoire.** La fenêtre se ferme et l'après-midi devient calme.
- **Un socket maintenu ouvert.** Voir plus haut.
- **Remplir l'identité depuis `git config user.email`.** C'est la chose la plus commode et une
  donnée personnelle expédiée sans consentement.
