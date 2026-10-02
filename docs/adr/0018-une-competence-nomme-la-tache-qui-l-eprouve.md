# ADR-0018 — Une compétence nomme la tâche qui l'éprouve

**Date** : 2026-10-02 · **Statut** : accepté

## Contexte

IBM Bob annonce « une quarantaine de compétences IBM i ». Une compétence est un prompt : c'est
quelques lignes de texte, c'est gratuit à écrire, et c'est la chose la plus facile à compter dans un
comparatif. Quarante compétences dont aucune n'a jamais été éprouvée sur un vrai problème, c'est
quarante lignes dans un tableau de fonctionnalités.

La feuille de route l'a vu et a posé le critère qui coûte : **chaque compétence est adossée à au
moins une tâche de `eval/tasks`, dont la commande de contrôle échoue avant intervention.** Autrement
dit : pour chaque compétence, il existe un dépôt cassé exprès que la compétence est censée réparer,
et une commande qui dit si ça a marché.

Le problème d'un tel critère est qu'il est vrai le jour où on l'écrit. La quarante-et-unième
compétence, ajoutée dans six mois par quelqu'un qui n'a pas lu cette page, ne sera adossée à rien, et
rien ne le dira.

## Décision

**La compétence déclare elle-même la tâche qui l'éprouve**, dans le champ `evalTask` de
`BuiltinSkill`, et un test lit cette déclaration.

Pas une liste à part, pas un tableau dans la documentation : un champ sur l'objet. Une liste
ailleurs est une liste qui pourrit, et celle qui dérive est celle que personne ne regarde.

Trois contrôles en découlent, dans `tests/skills.test.ts` :

1. il y a **au moins quarante** compétences dans les familles `rpg`, `dds`, `db2i`, `cl` — et au
   moins cinq dans chacune, pour que ce ne soit pas quarante variations d'une seule ;
2. chaque compétence IBM i nomme une tâche, **et la tâche existe sur le disque** — ce qui attrape le
   renommage d'un répertoire, que rien d'autre dans le dépôt ne remarquerait ;
3. la tâche nommée est bien une tâche IBM i, ce qui empêche la triche évidente : adosser `/tofree` à
   une tâche JavaScript parce que le contrôle ne vérifie que l'existence d'un répertoire.

Et les deux portes du banc ([ADR-0015](0015-une-evaluation-qui-ne-peut-pas-inventer-un-chiffre.md))
font le reste : la tâche doit échouer sur la fixture intacte **et** réussir sur sa solution de
référence. Une compétence adossée à une tâche qui ne mesure rien n'est pas adossée.

### Une lacune se déclare

Deux compétences ne peuvent pas être éprouvées par le banc : `/impact` et `/whouses` répondent
depuis une **partition vivante** — `DSPPGMREF` sur une vraie bibliothèque — et une fixture qui en
tiendrait lieu deviendrait la chose testée.

Trois réponses possibles, et deux sont mauvaises :

- les adosser à une tâche voisine mais sans rapport : le critère devient décoratif ;
- les laisser silencieusement sans rien : le critère devient faux sans que personne le sache.

La troisième est un champ `evalGap` qui dit **pourquoi** il n'y a pas de tâche. La lacune est alors
dans le source, comptable, et relisible — et un test exige que ces lacunes restent peu nombreuses
(quatre au plus) et qu'elles disent ce qui manque. Un tiroir plein de lacunes est le critère
abandonné en silence.

## Conséquences

- 40 compétences IBM i : **14 RPG, 7 DDS, 11 Db2 for i, 8 CL**. 38 adossées à une tâche, 2 avec une
  lacune déclarée.
- Le banc passe à **51 tâches**, dont 21 IBM i. Les onze ajoutées pour ce chantier couvrent
  précisément ce que la feuille de route nommait : indicateurs numérotés, `MOVE`/`MOVEL`, `/COPY` et
  prototypes, monolithe vers programme de service, fichier logique, DDS vers DDL SQL, `SBMJOB`
  explicite, documentation d'un membre, tests RPGUnit écrits, accès par enregistrement vers SQL,
  fichier imprimante.
- Une tâche peut adosser plusieurs compétences, et c'est honnête quand c'est le même sujet vu de deux
  côtés — `/tofree` et `/cycle` sortent tous deux du programme à cycle. Ce n'est pas une licence pour
  faire pointer cinq compétences sans rapport vers une tâche commode, et la relecture de la table
  d'adossement est le seul garde-fou contre ça : aucun test ne peut juger de la pertinence.
- ⚠️ **Non vérifié** : aucune de ces compétences n'a été exécutée contre un modèle réel, donc on sait
  que les tâches sont honnêtes et pas que les compétences les résolvent. C'est exactement ce que le
  chantier 0.6 a livré le moyen de mesurer, et ce qui attend une machine hébergeant un modèle.

## Rejeté

- **Compter les compétences comme IBM Bob les compte.** Quarante prompts non éprouvés sont une ligne
  de tableau comparatif, pas un produit.
- **Un tableau d'adossement dans `docs/`.** Il serait juste le jour de sa rédaction.
- **Un contrôle qui vérifierait la pertinence de l'adossement.** Aucun test ne sait si une tâche
  éprouve vraiment une compétence ; prétendre le contraire serait inventer une garantie. Le test
  vérifie ce qu'il peut — existence, famille, honnêteté de la tâche — et la pertinence reste une
  affaire de relecture, ce qui est dit ici plutôt que sous-entendu.
