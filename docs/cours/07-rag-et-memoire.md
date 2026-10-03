# 7. RAG et mémoire

[← Chapitre précédent](06-le-contexte.md) · [Sommaire](README.md) · [Chapitre suivant →](08-mcp.md)

## Ce que RAG veut dire

**RAG** signifie *Retrieval-Augmented Generation* — « génération augmentée par la recherche ». C'est
un sigle intimidant pour une idée simple : **avant de répondre, va chercher les documents utiles et
mets-les dans la question.**

C'est tout. Il n'y a pas de magie, et surtout : **le modèle n'apprend rien**. On ne le modifie pas,
on ne l'entraîne pas. On lui donne juste de la lecture au bon moment. Si vous demandez « quelle est
notre règle de facturation pour la Belgique ? », un système RAG retrouve la page de documentation qui
en parle, la colle dans la question, et le modèle répond en s'appuyant dessus.

L'intérêt est double : la réponse porte sur **vos** informations, et le modèle a moins de raisons
d'inventer ([chapitre 2](02-le-modele.md)) puisqu'il a la source sous les yeux.

## Comment on « trouve les documents utiles »

C'est là que les approches diffèrent, et il faut comprendre les deux pour comprendre le choix du
projet.

**Par les mots** (recherche lexicale). On cherche les documents qui contiennent les mots de la
question. Simple, rapide, explicable — et aveugle aux synonymes : une question sur « facture » ne
trouve pas un document qui dit « note de débit ».

**Par le sens** (recherche vectorielle, ou *embeddings*). On transforme chaque document en une liste
de nombres — un **vecteur** — censée représenter son *sens*. La même transformation est appliquée à
la question, et on cherche les documents dont le vecteur est le plus proche. L'image habituelle est
une carte où les textes qui parlent de la même chose sont voisins, même sans mots communs. La
collection de ces vecteurs s'appelle un **index vectoriel**.

C'est plus puissant. Et ça a un coût qu'on mentionne rarement : **pour fabriquer ces vecteurs, il
faut faire lire chaque document par un modèle**. Si ce modèle est chez un fournisseur, alors
**l'intégralité de votre code et de votre documentation y est envoyée** — non pas une fois par
question, mais en totalité, à l'indexation. C'est exactement ce qu'on cherchait à éviter.

## Ce que fait Hivey Code, et ce qu'il refuse

La base de connaissance est **optionnelle et désactivée par défaut**. Quand vous l'activez, ce sont
des **fichiers Markdown** — du texte — dans l'un de ces endroits :

- `.hiveycode/knowledge/` dans le dépôt : versionné avec le code, donc relu et partagé par l'équipe.
- `~/.hiveycode/knowledge/` : le vôtre, à travers tous vos projets.
- **N'importe quel dossier que vous désignez** : un partage de documentation interne, un wiki
  exporté. **Markdown, texte brut, Word et PDF** sont lus — les extracteurs `.docx` et `.pdf` sont
  écrits à la main dans le projet, comme le reste, pour tenir la promesse « zéro dépendance ».

Ces dossiers-là sont lus **tels quels**, sans en-tête à ajouter, et en **lecture seule** : l'outil
n'écrit jamais dans la documentation de quelqu'un d'autre.

**Il n'y a pas d'index vectoriel, et c'est une décision explicite du projet, pas un retard.** La
recherche se fait sur les mots et sur les **titres**. En échange on garde la propriété qui compte :
aucun code, aucun document n'est envoyé à une API d'embeddings.

Est-ce que ça coûte de la qualité ? Oui, sur les questions formulées avec d'autres mots que les
documents. C'est le genre d'arbitrage que ce projet préfère énoncer plutôt que masquer — et la
version honnête de la suite serait un index calculé **sur votre machine**, qui aurait le gain sans
l'envoi.

## Le détail qui fait que ça tient dans le budget

Envoyer toute la base à chaque question serait ruineux. Donc : **seule la liste des titres voyage**
avec chaque question — une douzaine de jetons par note. Le modèle voit les titres, et **demande** à
lire celle qui semble utile, comme il demande à lire un fichier.

## `/remember`, et la discipline qui l'accompagne

L'agent peut **écrire** dans la base, avec la commande `/remember` : ce qui a été établi sur ce
système, ce métier, ces outils. Deux règles l'encadrent, et elles viennent d'une expérience banale —
une base de connaissance mal tenue devient un tas :

- **Écrire une note dont le sujet existe déjà est refusé**, en vous montrant les notes qui le
  couvrent. On corrige la note existante plutôt que d'en empiler une seconde, légèrement différente,
  qui contredira la première dans six mois.
- **Retirer une note l'archive avec un motif**, au lieu de la supprimer. « Pourquoi ne croit-on plus
  ça ? » est une question qu'on se pose vraiment.

## Dans Hivey Code

Une distinction qui revient souvent et qu'il vaut mieux avoir en tête :

| | Où ça vit | Ce que ça contient |
|---|---|---|
| **Le contexte** | nulle part, reconstruit à chaque tour | ce que le modèle voit maintenant ([chapitre 6](06-le-contexte.md)) |
| **La base de connaissance** | des fichiers Markdown chez vous | ce que l'équipe a établi, durablement |
| **L'historique** | votre espace de travail | les conversations passées, cherchables |

Aucun de ces trois n'est « la mémoire du modèle ». Le modèle, lui, n'a pas de mémoire
([chapitre 2](02-le-modele.md)) : ce sont trois façons de lui redonner, à chaque fois, ce dont il a
besoin.

[← Chapitre précédent](06-le-contexte.md) · [Sommaire](README.md) · [Chapitre suivant →](08-mcp.md)
