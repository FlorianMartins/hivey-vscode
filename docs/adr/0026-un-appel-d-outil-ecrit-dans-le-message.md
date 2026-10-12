# ADR-0026 — Un appel d'outil écrit dans le message

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : passe de qualité mesurée (point 2) — et le défaut qu'elle a révélé

## Contexte

Le mode agent sur un modèle local est la promesse centrale de ce produit. Il ne faisait **rien**.

Le défaut a été trouvé en lançant la première vraie mesure, et il est exactement ce qu'une mesure
sert à trouver. Sur la tâche « ajoute un drapeau `--json` à ce petit CLI », `qwen2.5-coder:7b` a
produit un appel `edit_file` **parfaitement correct** : le bon chemin, le bon texte à remplacer, le
bon texte de remplacement. Et l'endpoint compatible OpenAI d'Ollama l'a renvoyé **en texte, dans
`content`**, avec `tool_calls: null` et `finish_reason: "stop"`.

Le client a donc vu un message ordinaire sans appel d'outil, a imprimé le JSON comme si c'était une
réponse, et n'a modifié aucun fichier. `steps: 0`, `tools: {}`.

Ce n'est pas une configuration exotique. C'est **la configuration par défaut** : le modèle que le
README de ce projet nomme, sur le runtime que ce même README dit d'installer. Toutes les tâches
d'agent du banc obtenaient zéro — et ce zéro était sur le point d'être publié comme « la qualité du
modèle local ».

## Décision

**Un appel d'outil écrit dans le message est reconnu comme un appel d'outil.**

Le risque est évident et il est le seul qui compte : la prose d'un modèle ne doit jamais devenir une
action exécutée. Il est borné par trois règles, dans `src/core/providers/textToolCall.ts` :

1. **Seulement si le protocole n'a rien rendu.** Un appel natif gagne toujours ; ceci n'entre jamais
   en concurrence avec lui.
2. **L'appel doit être la dernière chose du message, et il doit être délimité** — un bloc de code
   clôturé, ou le `<tool_call>` du gabarit Qwen. Un objet nu n'est accepté que s'il constitue le
   message entier.
3. **Le nom doit être celui d'un outil réellement offert pour cette requête.** Un nom que personne
   n'a offert n'est pas un appel, c'est un modèle qui invente une API.

La règle 2 a été **assouplie une fois, délibérément, après une mesure**. La première version exigeait
que le message ne contienne *rien d'autre* que l'appel. Elle a tenu une exécution : ces modèles
**narrent avant d'agir** (« Avant de faire quoi que ce soit, je vais vérifier que `count.js`
existe… »), donc le mode agent local restait inopérant — le modèle s'expliquait et le client
imprimait l'explication. Ce qui a été gardé est la frontière qui porte la garantie : **rien ne doit
suivre l'appel**. « Voici le JSON que tu enverrais, ça supprimerait tout » reste une phrase, pas une
action.

## Ce que cela coûte, dit clairement

Ceci **réunit deux canaux que le protocole tient séparés**. Avec des appels natifs, un modèle qui
*parle* d'une action ne peut pas en *faire* une, parce que parler se passe dans `content` et appeler
se passe dans `tool_calls`. Cette séparation est réellement perdue ici.

Elle n'est pas rattrapée par de l'astuce. Elle est rattrapée en le **disant** : un appel lu dans le
texte porte `source: "text"`, et la carte d'approbation l'affiche — « (lu dans le message du modèle,
pas dans un appel d'outil) ». La personne qui approuve est informée du canal par lequel l'action est
arrivée, parce que c'est la seule chose qu'elle ne pouvait pas voir autrement.

L'action elle-même est contrôlée **exactement** comme un appel natif : la même approbation, les mêmes
permissions, le même aperçu du diff. Rien n'est accordé ; un appel qui était perdu ne l'est plus.

## Conséquences

- Sur la tâche témoin, l'agent est passé de `steps: 0` à `steps: 2` (`read_file` puis `edit_file`
  réellement exécutés), et son échec est devenu **imputable au modèle** : le 7B a écrit du JavaScript
  cassé. C'est un résultat de qualité, ce qui est précisément ce qu'on voulait pouvoir mesurer.
- ⚠️ **Mais la mesure complète dit autre chose que cet échantillon**, et c'est la raison pour laquelle
  un seul essai ne vaut pas une mesure. Sur le jeu entier, `qwen2.5-coder:7b` **ne tente rien** la
  plupart du temps : il écrit la modification dans un bloc de code et demande « souhaitez-vous que je
  procède ? ». Le relevé est dans `eval/QUALITY.md`, colonne *never acted*. La correction reste
  nécessaire — sans elle l'agent local ne pouvait **jamais** agir — mais elle ne suffit pas, et
  prétendre le contraire sur la foi du tour qui a marché serait exactement l'erreur que ce banc existe
  pour empêcher.
- Le banc d'évaluation mesurait, jusqu'ici, le client plutôt que le modèle. Tout chiffre publié avant
  cette correction aurait été faux dans la direction la plus flatteuse pour les concurrents.
- Les résultats sont désormais écrits **après chaque tâche** et non à la fin : un modèle local sur un
  processeur prend une à deux minutes par tâche, donc un jeu complet est long, et un run qui n'écrit
  qu'en terminant perd tout à la première interruption.

## Ce que ceci ne fait pas

- Il ne corrige pas les autres fournisseurs : Anthropic rend ses appels nativement, et la voie
  native reste la voie normale partout.
- Il ne devine aucune forme. `{"name", "arguments"}` est ce que la spécification OpenAI emploie et ce
  que ces gabarits copient ; `parameters` est accepté à côté parce que c'est le mot du **schéma**, que
  le modèle lit. Toute autre forme reste du texte, ce qui est la direction sans danger.
- Il ne prétend pas que la séparation perdue est sans importance. C'est un résidu, il est nommé
  ci-dessus, et il est visible à l'endroit où une personne décide.
