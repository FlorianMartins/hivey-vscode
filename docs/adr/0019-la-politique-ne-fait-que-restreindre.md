# ADR-0019 — La politique ne fait que restreindre, et son échec n'est pas une absence

**Date** : 2026-10-03 · **Statut** : accepté

## Contexte

L'argumentaire entreprise de GitHub Copilot commence par les réglages gérés centralement, et la
raison n'est pas que les administrateurs aiment les réglages : c'est qu'une revue de sécurité
demande « qu'est-ce qui empêche un développeur de désactiver l'anonymisation ? », et que « on lui a
demandé de ne pas le faire » n'est pas une réponse.

Il faut donc une réponse. Et il faut qu'elle soit déployable par script, sur des postes qu'on ne
visite pas, par une DSI qui ne relira pas ce dépôt.

## Décision

**Un fichier de politique JSON signé en Ed25519, déposé à un emplacement machine, avec la clé
publique épinglée à côté.** Trois propriétés, chacune porteuse.

### 1. La politique ne fait que RESTREINDRE

Une politique peut interdire un fournisseur, relever le niveau minimal d'anonymisation, abaisser un
plafond de budget, ajouter un glob interdit. Elle ne peut **rien accorder** : il n'existe aucune
politique qui désactive l'anonymisation, autorise une adresse que l'utilisateur n'a pas configurée,
ou élargit les bibliothèques inscriptibles.

Cette asymétrie est ce qui rend le fichier sûr à déployer : **le pire qu'une politique erronée puisse
faire est de rendre l'extension moins capable, jamais moins prudente.** C'est aussi ce qui permet de
l'appliquer sans demander : il n'y a pas de consentement à recueillir pour une restriction.

Corollaire explicite : **un développeur plus strict que sa politique est laissé tranquille.**
Quelqu'un qui veut plus d'anonymisation que son organisation n'en exige n'est pas un problème à
résoudre.

Et un piège qui méritait un test : **une liste vide est parfois l'état le plus permissif.**
`ibmi.writableLibraries` vide signifie « la garde est inactive » — le lire comme « l'utilisateur est
d'accord avec la politique » aurait été un passage en force sans aucun réglage à montrer du doigt.
La liste de la politique s'applique alors telle quelle.

### 2. Un échec n'est pas une absence

Un fichier illisible, une signature invalide, une version que ce build ne connaît pas, **une clé
épinglée sans politique à côté** : chacun de ces cas met l'extension dans son mode **le plus sûr** —
local uniquement, anonymisation maximale, aucune escalade, rien d'auto-approuvé — et le dit
bruyamment.

Le repli silencieux sur les réglages de l'utilisateur serait l'inverse exact de ce qu'on veut :
**supprimer un fichier deviendrait la façon d'échapper à la politique.** Le cas « clé épinglée,
politique supprimée » est traité comme une altération et non comme une machine non gérée, et c'est
précisément l'attaque que cela ferme.

Une version inconnue est refusée plutôt qu'appliquée à moitié : une politique future peut restreindre
quelque chose que ce build n'implémente pas, et appliquer la moitié comprise serait **annoncer une
conformité qu'on n'a pas**.

Ce qui n'est **pas** désactivé dans ce mode : les fonctionnalités. Un refus ne doit pas ressembler à
une installation cassée — l'éditeur fonctionne encore, contre un modèle sur la machine de
l'utilisateur, ce qui est la posture par défaut de ce produit de toute façon.

### 3. La signature couvre les octets qui sont analysés

La politique voyage **encodée en base64** dans son enveloppe, et la signature porte sur les octets
décodés.

Ce n'est pas une coquetterie. Signer un **objet** JSON exige de s'accorder sur une sérialisation
canonique, et chaque schéma qui s'y est essayé a eu un défaut où deux documents différents se
canonicalisent identiquement — ordre des clés, format des nombres, échappements unicode. Ici il n'y a
rien sur quoi s'accorder : **les octets sont les octets.**

### 4. L'emplacement est le modèle de confiance

⚠️ **La politique n'est JAMAIS lue depuis l'espace de travail.** Ni `.hiveycode/`, ni `.vscode/`, ni
aucun endroit qu'un `git clone` peut remplir. Une politique arrivée avec le dépôt serait une politique
écrite par celui qui a envoyé le dépôt, et « votre organisation exige ceci » voudrait dire « la
branche d'un inconnu exige ceci ». Un test lit le code du chargeur et refuse tout signe d'un accès à
l'espace de travail.

Les emplacements sont `/etc/hivey-code`, `/Library/Application Support/HiveyCode` et
`%ProgramData%\HiveyCode` — et la variable `HIVEY_CODE_POLICY_DIR` pour le cas qu'un chemin fixe ne
peut pas servir : une image de conteneur, un poste virtuel managé.

**Ce que cela ne défend pas, dit franchement** : qui peut écrire dans ce répertoire possède la
politique, puisque la clé publique y est épinglée aussi. C'est voulu — c'est un répertoire que seul
un administrateur peut écrire — et un développeur qui veut retirer la politique de sa propre machine
peut aussi désinstaller l'extension. Ce contre quoi une politique protège n'est pas l'administrateur
déterminé de son propre portable ; c'est le cas ordinaire d'un réglage que personne n'a voulu changer
et que personne ne peut auditer.

### 5. Un seul point d'étranglement

La restriction est appliquée **dans `readSettings()`**, la fonction par laquelle chaque
fonctionnalité de cette extension lit sa configuration. Rendre les réglages bruts et vérifier la
politique au point d'usage est la version de ceci qui a un trou dès que quelqu'un ajoute une
fonctionnalité.

## Conséquences

- Nouvelle commande « Recharger la politique de l'organisation ». Le rechargement est un **acte
  délibéré et non un observateur de fichier** : une politique écrite un demi-fichier à la fois serait
  sinon lue en cours d'écriture et refusée, mettant le poste en mode sûr parce qu'un administrateur
  était au milieu d'un déploiement.
- L'interface peut dire **qui** gère chaque réglage (`managedSettings()`), parce qu'« géré » sans nom
  se lit comme un produit cassé plutôt que comme une politique en vigueur.
- ⚠️ **Défaut trouvé par le test d'intégration et par lui seul** : la restriction était appliquée
  **deux fois** (le lecteur « brut » restreignait déjà). Idempotent sur les valeurs, donc invisible
  partout — sauf que `managedSettings()` ne voyait plus rien à signaler, et l'interface aurait
  affirmé qu'aucun réglage n'était géré sur un poste entièrement géré.
- Le vocabulaire de l'escalade est celui du dépôt (`never | ask | auto`), pas un second inventé pour
  l'occasion. Attrapé par le compilateur.

## Rejeté

- **Une politique dans l'espace de travail**, versionnée avec le projet. C'est la forme la plus
  commode et la seule qui n'offre aucune garantie.
- **Signer l'objet JSON** plutôt que ses octets. Voir §3.
- **Un repli sur les réglages utilisateur en cas de signature invalide.** C'est la politique rendue
  optionnelle par la suppression d'un fichier.
- **Permettre à une politique d'accorder quelque chose** — par exemple d'autoriser une adresse que
  l'utilisateur n'a pas configurée. Le jour où une politique peut accorder, le fichier devient une
  cible qui vaut la peine d'être falsifiée.
- **Un observateur de fichier** sur le répertoire de politique. Voir plus haut.
