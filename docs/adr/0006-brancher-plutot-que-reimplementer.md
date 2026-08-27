# ADR-0006 — Se brancher sur les outils existants plutôt que les réimplémenter

**Date** : 2026-08-27 · **Statut** : accepté

## Contexte

L'agent doit pouvoir lire un dépôt Git, interroger une base Db2 for i, sortir un membre source de la
gestion de configuration ARCAD. Chacune de ces choses peut se faire de deux façons : réimplémenter
le protocole, ou passer par l'outil que l'utilisateur a déjà installé et déjà configuré.

La réimplémentation est plus courte à écrire et pire sur tous les plans qui comptent ici.

## Décision

Quatre passerelles, toutes vers l'API publique de l'outil concerné, aucune connexion propre.

### Git — par l'extension intégrée, jamais par un shell

`vscode.git` sait déjà à quel dépôt appartient le fichier ouvert, ce qui n'est pas toujours la
racine de l'espace de travail ; il détient déjà l'assistant d'identifiants, donc un `fetch` ne reste
pas bloqué sur une invite de mot de passe que personne ne voit ; et il rend l'état de la copie de
travail comme une structure plutôt que comme du texte à ré-analyser. Surtout : une commande shell
est une commande shell arbitraire. `git_log` implémenté par `run_command` serait à une erreur de
guillemets d'exécuter autre chose.

`git push` est **absent**. Publier une branche reste une décision que l'utilisateur prend lui-même ;
l'agent peut la proposer par `run_command`, qui demande déjà.

### IBM i — sur la connexion de Code for IBM i

Ouvrir notre propre session SSH voudrait dire redemander un mot de passe déjà donné, tourner sous
une liste de bibliothèques différente de celle que l'éditeur affiche, et se tromper subtilement de
conversion EBCDIC — de façon à corrompre les caractères nationaux et rien d'autre. Code for IBM i a
déjà négocié le bon hôte, le bon profil, la bonne liste de bibliothèques, le bon CCSID et un job SQL
chaud. On s'y branche ou on ne fait rien.

La permission suit la **forme de l'action**, pas l'outil : un `SELECT` lit et part sans demander, un
`UPDATE` touche le fichier client et se fait demander. Le contrôle porte donc sur l'instruction. Il
est délibérément grossier et conservateur — tout ce qui n'est pas manifestement une lecture est
traité comme une écriture. Le risque contre lequel il protège n'est pas un modèle qui vide une table
exprès : c'est un modèle qui écrit `UPDATE` en pensant `SELECT`, contre une liste de bibliothèques
qui pointe sur la production.

### ARCAD — ses commandes, et pas ses points d'accès

Le catalogue REST d'ARCAD est un produit commercial dont les chemins ne sont pas publiés. Les
inventer produirait une intégration qui échoue chez le client d'une manière que personne ne peut
déboguer. La passerelle appelle donc les commandes `arcad.*` qu'Elias enregistre lui-même — une
surface déclarée, versionnée, visible dans la palette — et transporte des requêtes vers les chemins
que **l'utilisateur** fournit, avec les identifiants pris dans le trousseau du système.

Les commandes exposées sont triées : Elias en enregistre plus de cent cinquante, dont la plupart
ouvrent un sélecteur et attendent un humain. Les donner toutes à un modèle produit un tour qui reste
bloqué sur une fenêtre que personne ne regarde.

### MCP — la porte pour tout le reste

Pour une intégration plus profonde que cela, la bonne forme n'est pas une passerelle de plus : c'est
un serveur MCP. Le protocole existe exactement pour qu'un éditeur et un service interne s'ignorent
mutuellement tout en travaillant ensemble.

Le client est écrit à la main, conformément à l'ADR-0004 : le format de fil est du JSON-RPC sur un
flux et la poignée de main tient en trois messages.

**Un serveur stdio est une exécution de code arbitraire**, configurée dans un fichier qui a pu
arriver avec un dépôt cloné. Il ne démarre pas tant que l'utilisateur n'a pas accepté dans une
fenêtre modale qui **nomme la commande**, et l'accord est attaché à la commande plutôt qu'au nom —
le nom étant ce qu'un attaquant contrôle le plus facilement. Un serveur HTTP n'exécute rien
localement ; ce qu'il reçoit passe par la porte de sortie comme n'importe quelle requête sortante.

## Conséquences

Un outil n'est proposé au modèle que si ce qu'il y a derrière existe. Un modèle à qui l'on donne
`ibmi_sql` sur une machine sans partition n'en conclut pas « il n'y a pas d'IBM i ici » : il appelle
l'outil, lit l'erreur, rappelle l'outil. L'absence est la façon la plus claire de dire qu'un système
n'est pas là.

Deux outils — `ibmi_sql` et `arcad_rest` — sont en lecture ou en écriture **selon leurs arguments**.
Les exclure du mode plan le rendrait incapable d'interroger une base ; les y laisser entiers
transformerait « le mode plan ne change rien » en « ne change rien sauf si vous validez une
fenêtre ». Ils déclarent donc une variante restreinte qui **refuse** au lieu de demander.

Le typage est déclaré localement et au minimum. Il n'existe pas de paquet `@types` pour l'API de
l'extension Git, et ajouter une dépendance à l'exécution pour décrire une interface dont on emploie
huit méthodes casserait la seule promesse d'architecture que ce projet fait.
