# Comprendre Hivey Code — le cours

**À jour pour la version 1.4.1.**

Ce cours explique ce qu'est Hivey Code, à quoi servent toutes les technologies qu'il emploie, et
comment elles s'articulent — **sans supposer que vous savez programmer**. Si vous ne savez pas ce
qu'est un « jeton », une « API » ou un « dépôt », vous êtes exactement la personne pour qui il est
écrit.

Il existe pour une raison précise. Ce projet a une documentation technique abondante : un
[README](https://github.com/FlorianMartins/hivey-vscode/blob/main/README.md), une [architecture](../ARCHITECTURE.md), un
[modèle de menace](../THREAT-MODEL.md), 41 décisions motivées. Tout cela est écrit pour
quelqu'un qui code. Or les questions qu'on pose vraiment sur cet outil — *est-ce que mon code part
quelque part ? qu'est-ce que ça sait faire que Copilot ne sait pas ? comment ça marche, en vrai ?* —
sont des questions auxquelles on devrait pouvoir répondre sans savoir coder, et qu'on devrait pouvoir
**réexpliquer à quelqu'un d'autre**. C'est l'objectif : à la fin, vous devez pouvoir en parler.

## Comment lire

Les chapitres se suivent, et chacun ne suppose que les précédents. Vous pouvez aussi piocher : chaque
mot technique est **en gras à sa première apparition** et repris dans le
[glossaire](99-glossaire.md).

Chaque chapitre finit par une section **« Dans Hivey Code »**, qui dit ce que le projet a choisi de
faire et *pourquoi* — parce que la plupart de ces choix sont des arbitrages, pas des évidences.

| | Chapitre | Ce que vous saurez expliquer |
|---|---|---|
| 1 | [Le décor](01-le-decor.md) | Un éditeur de code, une extension, un dépôt, un commit |
| 2 | [Le modèle](02-le-modele.md) | Ce qu'est un modèle de langage, un jeton, une fenêtre de contexte |
| 3 | [Où tourne le modèle](03-ou-tourne-le-modele.md) | Local, distant, passerelle — et ce que « souverain » veut dire |
| 4 | [Comment on lui parle](04-comment-on-lui-parle.md) | Une API, une clé, le streaming, et les deux « langues » des modèles |
| 5 | [Les trois modes et les outils](05-les-trois-modes-et-les-outils.md) | Discussion, Plan, Agent — et comment une IA « fait » quelque chose |
| 6 | [Le contexte](06-le-contexte.md) | Ce que le modèle voit de votre projet, et ce que ça coûte |
| 7 | [RAG et mémoire](07-rag-et-memoire.md) | Ce que RAG veut dire, et pourquoi ici il n'y a pas d'index vectoriel |
| 8 | [MCP](08-mcp.md) | Brancher un service externe, et le risque que ça crée |
| 9 | [La confidentialité](09-la-confidentialite.md) | Pseudonymisation, journal infalsifiable, politique signée |
| 10 | [Le coût](10-le-cout.md) | Pourquoi c'est payant ailleurs, et comment ça tend vers zéro ici |
| 11 | [IBM i](11-ibm-i.md) | Ces ordinateurs que personne ne montre et dont tout dépend |
| 12 | [La qualité mesurée](12-la-qualite-mesuree.md) | Comment on prouve qu'un assistant est bon — ou mauvais |
| 13 | [Installer et s'en servir](13-installer-et-sen-servir.md) | Le faire marcher chez vous, pas à pas |
| — | [Glossaire](99-glossaire.md) | Tous les termes, par ordre alphabétique |

## Pourquoi ce cours remplace l'ancien README français

Il y avait un `README.fr.md` : la traduction du README anglais. Il avait deux défauts. Il **doublait
le travail** sans rien ajouter — deux documents à maintenir, donc un des deux toujours en retard (il
a annoncé 284 tests alors qu'il y en avait 700, et la version `0.11.1` alors que le projet était à
`0.61.0`). Et il s'adressait **aux mêmes personnes** que l'anglais : des gens qui codent.

Ce cours ne traduit rien. Il explique. Et il est tenu à jour par un contrôle qui **refuse la
construction** quand la version qu'il annonce en haut de cette page n'est plus celle du projet — voir
le [chapitre 12](12-la-qualite-mesuree.md). Un document qu'on promet de maintenir n'est pas
maintenu ; un document dont l'obsolescence casse le build l'est.
