# Glossaire

[← Sommaire](README.md)

Par ordre alphabétique. Le chapitre indiqué est celui où le terme est expliqué en détail.

**Agent (mode)** — Mode où l'assistant peut lire, modifier des fichiers et proposer des commandes,
chaque action approuvée. → [5](05-les-trois-modes-et-les-outils.md)

**API** — La façon dont deux programmes se parlent : une adresse, un formulaire précis, une réponse
prévue. → [4](04-comment-on-lui-parle.md)

**Appel d'outil** (*tool calling*) — Le mécanisme par lequel un modèle demande qu'on exécute une
action pour lui. Il arrive normalement dans une case réservée de la réponse, séparée du texte.
→ [4](04-comment-on-lui-parle.md)

**Branche** — Une ligne de travail parallèle dans un dépôt. → [1](01-le-decor.md)

**Carte du dépôt** — La liste des fichiers et des symboles qu'ils déclarent, sans leur contenu : une
table des matières du projet pour le modèle. → [6](06-le-contexte.md)

**Clé d'API** — Un mot de passe long qui dit qui paye. C'est un secret.
→ [4](04-comment-on-lui-parle.md)

**CL** — Le langage de commandes d'IBM i. → [11](11-ibm-i.md)

**Commit** — Un instantané du projet, avec un message qui dit pourquoi. → [1](01-le-decor.md)

**Compactage** — Remplacer une conversation trop longue par un résumé que le modèle écrit, sans rien
effacer à l'écran. → [6](06-le-contexte.md)

**Complétion** — Les propositions pendant la frappe. L'usage le plus fréquent, donc celui qui décide
de la facture. → [10](10-le-cout.md)

**Contexte (fenêtre de)** — La quantité de texte qu'un modèle peut avoir sous les yeux en une fois.
→ [2](02-le-modele.md)

**DDS** — Le langage qui décrit les fichiers, écrans et états imprimés d'IBM i. → [11](11-ibm-i.md)

**Db2 for i** — La base de données intégrée à IBM i. → [11](11-ibm-i.md)

**Dépôt** (*repository*, *repo*) — Le dossier d'un projet, plus tout son historique.
→ [1](01-le-decor.md)

**Diff** — La liste des différences entre deux versions d'un fichier : lignes ajoutées, lignes
retirées. Ce que l'extension vous montre **avant** d'écrire. → [1](01-le-decor.md)

**Embeddings** — La transformation d'un texte en une liste de nombres censée représenter son sens.
Fabriquer des embeddings suppose de faire **lire** le texte par un modèle, ce qui est le problème.
→ [7](07-rag-et-memoire.md)

**Empreinte** (*hash*) — Une signature numérique courte d'un texte, toujours la même pour le même
texte, et dont on ne peut pas remonter au texte. → [9](09-la-confidentialite.md)

**Escalade** — Passer à un modèle plus puissant **après** un échec constaté, pas d'après la
formulation de la question. → [10](10-le-cout.md)

**Extension** — Un module qui apprend quelque chose de nouveau à l'éditeur. → [1](01-le-decor.md)

**Git** — L'outil qui suit l'historique d'un projet. → [1](01-le-decor.md)

**Glob** — Un motif de chemin avec des jokers : `**/.env` désigne tous les fichiers `.env`.
→ [9](09-la-confidentialite.md)

**GPU** — Carte graphique. Fait tourner un modèle dix à cinquante fois plus vite qu'un processeur.
→ [3](03-ou-tourne-le-modele.md)

**Hallucination** — Une réponse fausse énoncée avec le même aplomb qu'une réponse juste. Ce n'est pas
un bug qu'on corrigera : c'est le mécanisme. → [2](02-le-modele.md)

**Hook** — Votre propre commande, exécutée avant ou après un appel d'outil.
→ [5](05-les-trois-modes-et-les-outils.md)

**HTTP** — Le protocole du web, utilisé aussi par les API. → [4](04-comment-on-lui-parle.md)

**IBM i** — Le système d'IBM (ex-AS/400) qui fait tourner des applications de gestion depuis les
années 1980. → [11](11-ibm-i.md)

**Index vectoriel** — Une collection d'embeddings qui permet de chercher par le sens. **Ce projet n'en
a pas**, délibérément. → [7](07-rag-et-memoire.md)

**Jeton** (*token*) — L'unité que lit et produit un modèle ; environ 100 jetons pour 75 mots. C'est
l'unité de facturation et l'unité de limite. → [2](02-le-modele.md)

**JSON** — Un format de texte structuré, lisible par un humain qui s'y force.
→ [4](04-comment-on-lui-parle.md)

**LLM** (*Large Language Model*) — Un modèle de langage : un programme qui devine le mot suivant.
→ [2](02-le-modele.md)

**Local** — Qui tourne sur votre machine ou votre réseau. ⚠️ Une **passerelle** sur votre réseau n'est
pas locale si elle réexpédie ailleurs. → [3](03-ou-tourne-le-modele.md)

**MCP** (*Model Context Protocol*) — La convention qui permet de brancher un service externe sur
n'importe quel assistant, sans que les deux côtés se connaissent. → [8](08-mcp.md)

**Ollama** — Le programme le plus simple pour faire tourner un modèle chez soi.
→ [3](03-ou-tourne-le-modele.md)

**Open source** — Dont le code source est public et réutilisable sous conditions. Ce qui rend une
promesse de confidentialité **vérifiable** au lieu de croyable. → [1](01-le-decor.md)

**OpenRouter** — Une passerelle : un compte, une clé, des centaines de modèles.
→ [3](03-ou-tourne-le-modele.md)

**Paramètres** (d'un modèle) — Les nombres réglés pendant l'entraînement. `7b` = 7 milliards.
→ [2](02-le-modele.md)

**Passerelle** (*gateway*) — Un intermédiaire entre vous et les fournisseurs.
→ [3](03-ou-tourne-le-modele.md)

**Plan (mode)** — Mode où l'assistant lit et ne modifie rien. Garanti **parce que l'outil d'écriture
n'existe pas**, pas parce qu'on le lui a demandé. → [5](05-les-trois-modes-et-les-outils.md)

**Préréglage Hivey** — Une **intention** plutôt qu'un modèle : un routage qui attribue un modèle à
chaque rôle. → [10](10-le-cout.md)

**Prompt** — Le texte envoyé au modèle, consignes invisibles incluses (le *prompt système*).
→ [2](02-le-modele.md)

**Pseudonymisation** — Remplacer les éléments reconnaissables par des marqueurs **réversibles**, le
coffre de correspondance restant sur votre machine. → [9](09-la-confidentialite.md)

**Quantisation** — Raccourcir les nombres d'un modèle pour qu'il tienne en mémoire : 28 Go → 5 Go,
pour une faible perte. → [2](02-le-modele.md)

**RAG** (*Retrieval-Augmented Generation*) — Chercher les documents utiles et les mettre dans la
question. Le modèle **n'apprend rien**. → [7](07-rag-et-memoire.md)

**Récence** — L'ancienneté d'un modèle, utilisée pour choisir le plus récent. ⚠️ Elle était
revendiquée dans ce projet et **n'existait pas**, par une erreur d'arrondi. → [10](10-le-cout.md)

**RPG** — Le langage historique d'IBM i, en plusieurs formes dont certaines où **la colonne change le
sens**. → [11](11-ibm-i.md)

**SIEM** — Le système où une entreprise centralise ses journaux de sécurité.
→ [9](09-la-confidentialite.md)

**Signature** — Une preuve mathématique qu'un texte vient du détenteur d'une clé et n'a pas été
modifié. → [9](09-la-confidentialite.md)

**SSE** (*Server-Sent Events*) — La technique qui fait apparaître une réponse mot à mot, et qui
permet de l'arrêter avant de l'avoir payée en entier. → [4](04-comment-on-lui-parle.md)

**Souverain** — Vous décidez où va votre code, et vous pouvez le vérifier. Ni « gratuit », ni
« hors ligne ». → [3](03-ou-tourne-le-modele.md)

**Symbole** — Un nom déclaré par du code : une fonction, une classe, un type. → [6](06-le-contexte.md)

**Température** — Le réglage du hasard dans les réponses. → [2](02-le-modele.md)

**Terminal** — La zone où l'on tape des commandes, une par ligne. → [1](01-le-decor.md)

**Tool poisoning** (empoisonnement d'outils) — Un serveur MCP qui écrit des instructions cachées dans
la description de ses outils, que le modèle lit comme des ordres. → [8](08-mcp.md)

**VS Code** — L'éditeur de code le plus utilisé, pour lequel cette extension est écrite.
→ [1](01-le-decor.md)

**`.vsix`** — Le fichier d'une extension VS Code : une archive qu'on installe.
→ [1](01-le-decor.md), [13](13-installer-et-sen-servir.md)

**Worktree** — Une copie de travail séparée d'un dépôt git, où une tâche de fond travaille sans
toucher à la vôtre. → [5](05-les-trois-modes-et-les-outils.md)

[← Sommaire](README.md)
