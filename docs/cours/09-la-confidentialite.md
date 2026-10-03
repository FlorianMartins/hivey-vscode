# 9. La confidentialité

[← Chapitre précédent](08-mcp.md) · [Sommaire](README.md) · [Chapitre suivant →](10-le-cout.md)

C'est la raison d'être du projet. Une entreprise qui évalue un assistant de code pose deux questions :
**qu'est-ce qui sort ?** et **pouvez-vous le prouver ?** La plupart des outils répondent par une
politique de confidentialité. Celui-ci répond par une porte qu'on peut inspecter avant que le premier
octet ne bouge, et par un registre qu'on peut lire après.

## La porte unique

Toute requête vers un modèle distant passe par **un seul endroit** dans le code. Ça paraît
anecdotique et c'est la propriété la plus importante de l'architecture : s'il y avait deux chemins,
il faudrait vérifier les deux, et il suffirait qu'on en oublie un pour que la promesse tombe. Un seul
chemin, c'est un seul endroit à auditer.

Cette porte fait quatre choses, **dans cet ordre**, parce que chacune peut empêcher la suivante.

### 1. Bloquer

Un fichier dont le chemin correspond à un motif interdit (`privacy.blockedGlobs`) **n'est pas
envoyé**, du tout, quoi que soit configuré par ailleurs. Un *glob* est un motif avec des jokers :
`**/.env` désigne tous les fichiers `.env` où qu'ils soient, `secrets/**` tout ce qu'il y a dans ce
dossier.

C'est volontairement la première étape et la plus brutale : elle ne discute pas.

### 2. Pseudonymiser

Tout le reste est **pseudonymisé** — et le mot est choisi. Ce n'est pas de l'anonymisation : c'est
**réversible**, et il faut que ça le soit.

Le mécanisme : avant l'envoi, les éléments reconnaissables sont remplacés par des marqueurs. Une
adresse de courriel devient `⟨EMAIL_1⟩`, un nom de serveur `⟨HOST_1⟩`, un nom de client que vous
avez déclaré (`privacy.customTerms`) devient un marqueur à lui. Le modèle travaille sur le texte
marqué. Quand sa réponse revient, les marqueurs sont **remis à l'endroit** avant que vous la voyiez.

Pourquoi réversible : si `⟨HOST_1⟩` restait dans la réponse, l'outil serait inutilisable. Le coffre
qui fait la correspondance **reste sur votre machine** ; il ne part jamais.

### 3. Refuser

Si quelque chose a la forme d'un **identifiant secret** — une clé d'API, un mot de passe — et a
survécu à l'étape 2, la requête **s'arrête** et on vous le dit. Le raisonnement : la pseudonymisation
sait remplacer ce qu'elle reconnaît, donc arriver ici signifie qu'un secret a été détecté *et* qu'il
n'a pas pu être remplacé sans risque. L'envoyer quand même n'est pas un choix qui vaut la peine d'être
proposé.

### 4. Demander

Vous voyez une **carte** : combien de jetons environ, vers quel hôte, quel modèle, et ce qui a été
pseudonymisé (les **genres** et leur nombre : `EMAIL×3, HOST×1` — jamais les valeurs). Vous répondez
une fois, pour la session, ou toujours.

La carte apparaît **dans la conversation**, pas dans une fenêtre modale par-dessus l'éditeur. Le
consentement lui-même n'est pas négociable, c'est tout l'argument du produit — mais une fenêtre qui
bloque tout pour une question de routine est une fenêtre qu'on expédie sans lire. La question
apparaît là où la réponse apparaîtra.

## Ce qu'une image change, et pourquoi on vous le dit

Une image ne peut pas être pseudonymisée. Une capture d'écran de votre application contient des noms,
des montants, des adresses, et aucun marqueur ne peut s'y substituer.

Donc : quand une image est sur le point de partir, la carte **le dit explicitement**. Et le registre
l'enregistre. Une ligne qui annoncerait « 0 pseudonymisation » sur un tour qui a envoyé une capture
d'écran serait **vraie et trompeuse** — c'est précisément le genre d'honnêteté partielle que ce
projet essaie d'éviter.

## Le registre, et pourquoi il est chaîné

Chaque requête distante laisse une ligne : quand, vers où, quel modèle, combien de jetons, combien ça
a coûté, combien de marqueurs. **Jamais le contenu** — un journal de ce que vous essayiez de garder
privé n'est pas une fonctionnalité de confidentialité.

Chaque ligne porte en plus l'**empreinte** (*hash*) de la précédente.

Un *hash* est une empreinte numérique d'un texte : courte, toujours la même pour le même texte, et
telle qu'on ne peut pas remonter du hash au texte. L'astuce : si la ligne n° 5 contient l'empreinte
de la ligne n° 4, alors **modifier** la ligne 4 change son empreinte, qui ne correspond plus à ce que
la ligne 5 annonce. Et pour masquer ça, il faudrait réécrire toute la suite. **Supprimer** une ligne
laisse un trou que la vérification trouve.

Ça ne rend pas le registre impossible à falsifier — quelqu'un qui contrôle la machine peut tout
réécrire — mais ça rend une falsification **discrète** impossible, et c'est la différence entre
« voilà ce qu'on a journalisé » et « voilà ce qu'on a journalisé, et vous pouvez vérifier que
personne n'y a touché ».

## Pour une entreprise : trois choses de plus

- **Une politique signée.** Un fichier sur le poste, signé avec la clé de l'organisation, qui
  **restreint** : un fournisseur imposé, une liste d'adresses autorisées, un budget maximum. Vérifiée
  avant que quoi que ce soit lise un réglage. Elle ne peut que **resserrer** : une politique qui
  pourrait *accorder* quelque chose serait un moyen de désactiver une garantie, et c'est inexprimable
  par construction. Une politique non signée ou modifiée est **refusée**, pas ignorée.

  *Signer*, ici, veut dire : produire une preuve mathématique qu'un texte vient bien du détenteur
  d'une clé et n'a pas été modifié depuis. C'est le même mécanisme qui protège les mises à jour de
  votre système d'exploitation.

- **Le registre expédié au collecteur de l'organisation.** Le même journal, envoyé en **syslog**
  (le format standard des journaux système, normalisé sous le nom RFC 5424) sur une liaison chiffrée,
  ou en **OTLP** (le format de l'observabilité moderne). Ce qui part traverse une **liste blanche de
  champs** : ce qui arrive au **SIEM** — le système où une entreprise centralise ses journaux de
  sécurité — est donc la métadonnée, et jamais le contenu, et c'est démontrable plutôt que promis.

- **Une preuve de souveraineté.** Un rapport, signé, qui répond à la question d'un auditeur : sur
  cette période, qu'est-ce qui est sorti de ce poste, vers qui, et le registre est-il intact ? Il peut
  porter un **horodatage** d'une autorité indépendante (norme RFC 3161) — une preuve que le document
  existait à telle date, donc qu'il n'a pas été écrit après coup pour arranger l'histoire.

## Les résidus, nommés

Le projet tient un **modèle de menace** qui liste ce que ces mesures **ne** font **pas**. Trois
exemples, parce qu'ils sont plus instructifs que la liste des parades :

- **Qui approuve sans lire approuve quand même.** Aucune carte ne protège de ça.
- **Un poste compromis lit le trousseau de clés.** Rien à ce niveau ne s'y oppose.
- **Un secret sans forme reconnaissable** (`motdepasse = soleil`) n'est pas détecté.

Un document qui ne listerait que les parades serait une brochure. Celui-là liste les deux.

## Dans Hivey Code

Deux règles qui résument tout le chapitre :

1. **Zéro télémétrie.** Le projet ne remonte rien, nulle part, jamais. Pas de « statistiques
   d'usage anonymes ».
2. **Zéro dépendance à l'exécution.** Le programme livré n'embarque aucune bibliothèque tierce : tout
   ce qu'il utilise, il l'écrit lui-même ou c'est fourni par le moteur. C'est inhabituel et c'est
   délibéré — ce que vous auditez est le programme, et rien d'autre. Un outil qui promet que votre
   code ne part pas et qui embarque quarante bibliothèques dont il ne sait rien fait une promesse
   qu'il n'est pas en position de tenir.

[← Chapitre précédent](08-mcp.md) · [Sommaire](README.md) · [Chapitre suivant →](10-le-cout.md)
