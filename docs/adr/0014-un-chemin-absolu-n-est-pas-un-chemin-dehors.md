# ADR-0014 — Un chemin absolu n'est pas un chemin dehors

**Date** : 2026-10-02 · **Statut** : accepté

## Contexte

Le mode agent a cessé de modifier des fichiers. Rapporté ainsi : « le mode agent ne fais plus de
modifications ».

Le résolveur de chemins de `src/extension/tools.ts` commençait par une ligne qui se lisait comme de
la prudence :

```ts
if (clean.startsWith("/") || clean.includes("..")) {
  throw new Error(`Refused: “${path}” leaves the workspace.`);
}
```

Elle confond deux faits différents. Un `..` peut effectivement sortir de l'espace de travail. Un
chemin **absolu**, non : `/home/moi/projet/src/a.ts` et `src/a.ts` désignent le même fichier quand
le dossier ouvert est `/home/moi/projet`.

Et surtout — c'est là que la règle se retourne contre elle-même — le chemin absolu est l'écriture
que **l'extension elle-même** donne au modèle. `relative()`, dans `src/extension/workspace.ts` :

```ts
export function relative(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return uri.fsPath;      // ← tout fichier hors dossier ouvert
  …
}
```

Un fichier qui n'appartient à aucun dossier ouvert n'a pas de nom relatif à donner : le contexte le
nomme donc par son chemin complet. Le modèle le rend tel quel dans l'appel d'outil, et le résolveur
le refuse. **L'extension dictait un chemin au modèle, puis refusait le sien.** La même écriture
arrive par les diagnostics de l'éditeur, la sortie du terminal et les piles d'appel, qui sont tous
absolus.

Cela explique pourquoi la panne paraissait intermittente plutôt que totale : modifier un fichier
situé *dans* le dossier ouvert passait par un chemin relatif et fonctionnait ; modifier un membre
source IBM i, un fichier distant, un fichier glissé dans l'éditeur ou un fichier d'un second dossier
ne passait jamais. Dès que le travail porte sur des membres, plus rien n'est modifiable.

Le défaut existe depuis la première version. Aucun test ne l'a vu : les quarante tests
d'intégration pilotent des tours, approuvent des commandes, escaladent, routent et photographient —
et **tous** affirment sur ce qui a été *envoyé* ou sur ce que le panneau *dit*. Aucun n'affirmait
sur le contenu d'un fichier.

## Décision

**Décider de l'appartenance en résolvant le chemin, puis en regardant où il a atterri** — la seule
forme de la question qui ait une réponse vraie.

- Un chemin **absolu** est accepté s'il tombe dans l'un des dossiers ouverts ; il est rendu relatif
  à ce dossier et poursuit le même trajet qu'un chemin relatif, politique de confidentialité
  comprise. S'il ne tombe dans aucun, il est accepté s'il **est** exactement l'un des fichiers
  ouverts — un onglet est un endroit que l'utilisateur a choisi — et refusé sinon, avec une phrase
  qui dit lequel des deux cas s'applique.
- Un chemin **relatif** ne change pas : un `..` est refusé, jamais interprété. Résoudre serait
  également correct, puisque l'appartenance est vérifiée ensuite dans les deux cas ; cela
  n'achèterait que `src/sous/../a.ts` et ferait qu'une garantie écrite en prose ne correspondrait
  plus littéralement au code.

L'arithmétique est dans `src/core/fs/within.ts`, donc sans `vscode`, parce qu'une règle
d'appartenance se trompe aux bords — une barre oblique finale, une lettre de lecteur, un dossier
voisin dont le nom commence par celui de la racine — et que les bords sont ce qu'un test unitaire
atteint et qu'un éditeur en marche n'atteint pas.

## Conséquences

- La garantie ne bouge pas : rien hors des dossiers ouverts n'est écrit. Ce qui change est la
  **méthode** — résoudre puis vérifier, au lieu de refuser à vue.
- La politique de confidentialité est maintenant appliquée à la partie **sous la racine** et non à
  ce que le modèle a tapé. Les globs interdits sont écrits relativement (`**/.env*`), et un chemin
  absolu les aurait tous manqués. Avant ce correctif la question ne se posait pas, puisqu'un chemin
  absolu n'arrivait jamais jusque-là ; c'est une conséquence du changement et elle est traitée, pas
  constatée après coup.
- **Résidu assumé** : l'appartenance est décidée sur les chaînes, donc un lien symbolique placé dans
  le projet et pointant dehors reste un chemin « dedans ». C'était déjà vrai des chemins relatifs ;
  le correctif n'aggrave rien et ne corrige pas cela. Suivre les liens exigerait de toucher le
  disque pour un fichier qui n'existe pas encore.
- Le test d'intégration noue les deux moitiés de la contradiction : il affirme d'abord que
  `relative()` donne bien ce chemin-là pour ce fichier, puis fait rendre **ce même chemin** par le
  modèle. Aucun des deux côtés ne peut plus dériver de l'autre sans casser le test.
- Les quarante et un tests d'intégration comptent enfin un tour qui affirme sur le **contenu d'un
  fichier**. C'était le trou par lequel ce défaut est passé.

## Rejeté

- **Rendre `relative()` toujours relatif.** Il n'y a à quoi être relatif : le fichier n'est dans
  aucun dossier ouvert. Renvoyer un nom relatif inventé déplacerait le mensonge d'un cran.
- **Faire dire au prompt « nomme les fichiers relativement ».** Une consigne, donc une requête, et
  un modèle qui la lit mal est le cas ordinaire. C'est exactement le raisonnement déjà écrit pour le
  mode Plan et pour le garde-fou IBM i : une garantie vit dans le code.
- **Accepter n'importe quel chemin absolu.** Cela supprimerait la parade, pas le défaut.
