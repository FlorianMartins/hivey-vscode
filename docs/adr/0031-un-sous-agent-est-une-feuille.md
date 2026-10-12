# ADR-0031 — Un sous-agent est une feuille

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : 4.3 — la délégation est transitive, et le terminal n'en a pas

## Contexte

Le chantier avait été rédigé en affirmant que le parallélisme des sous-agents et la synthèse de leurs
retours manquaient. **Re-dérivé du code à la demande de Florian, les deux existent** :

- `loop.ts` fusionne les appels **voisins** que l'outil déclare sûrs et les lance en `Promise.all`.
  Les approbations sont résolues **avant**, une par une, parce que deux dialogues simultanés ne sont
  pas une interface. Et ne fusionner que des voisins préserve l'ordre que le modèle a demandé.
- L'outil de dispatch ne se déclare parallélisable que pour un agent **en lecture seule** : deux
  agents qui écrivent en même temps sont une course que personne ne reconstitue depuis une trace.
- La synthèse **est** le mécanisme : la conclusion revient comme résultat d'outil et le modèle
  principal continue avec elle. Il n'y a pas d'étape à ajouter.
- Les outils d'un sous-agent sont une **intersection, jamais une union** : un fichier de définition
  arrivé avec un dépôt cloné ne peut pas s'accorder un outil que le mode n'offre pas.

Trois lacunes réelles restaient.

## Décision 1 — un sous-agent est une feuille

⚠️⚠️ `toolsForAgent` rendait **tous** les outils disponibles quand une définition n'a pas de ligne
`tools:`. C'est le bon défaut pour lire et écrire, et c'était le mauvais pour **le seul outil qui
récurse** : `run_agent` en faisait partie. Un sous-agent défini sans restriction pouvait donc
dispatcher des sous-agents, qui pouvaient en dispatcher à leur tour. La largeur de chaque niveau est
bornée par son plafond d'étapes ; **la profondeur ne l'était par rien**, et aucune garde ni aucun
test n'existait nulle part dans le projet.

La règle posée est celle que la description de l'outil **promettait déjà** — *« il travaille seul et
ne rend que sa conclusion »* — énoncée là où elle peut être tenue : `NEVER_DELEGATES`, soustrait des
**deux** branches de `toolsForAgent`. Demander explicitement n'est pas une autorisation, pour la
raison même qui fait exister l'intersection.

**Pas un réglage**, parce que c'est une garantie, et une garantie vit dans le code. Et ça ne coûte
rien aujourd'hui : aucun des quatre agents intégrés ne demande à déléguer.

## Décision 2 — le terminal a des sous-agents

Quatrième moitié oubliée de cette phase, après l'outil de plan, les plafonds de dépense et les
compétences. Et comme à chaque fois, la conséquence n'était pas seulement la fonctionnalité absente :
le banc d'évaluation **pilote ce client**, donc rien de la délégation n'était mesurable.

Il lit maintenant les définitions du dépôt et du dossier personnel avec l'analyseur du cœur — les
mêmes fichiers que le panneau, pour qu'une équipe qui écrit un agent l'ait dans les deux moitiés —
puis les fusionne avec les intégrés, les siens d'abord. Un fichier mal formé est signalé et ignoré :
il doit coûter un agent, pas la fonctionnalité.

Un sous-agent du terminal est **anonymisé par le même coffre** que le tour principal : sa requête
sort par la même porte, et une seconde notion de ce qu'il est sûr d'envoyer serait une seconde
réponse à la question que ce produit existe pour répondre.

## Décision 3 — une trace nomme l'agent qu'elle a dispatché

`callSignature` déclarait `run_agent: ["agent", "task"]` alors que le paramètre du schéma s'appelle
`name`. L'argument `agent` n'existait donc jamais, le repli prenait `task`, et la ligne d'étape
montrait la tâche **sans jamais dire quel agent l'avait reçue**. C'est exactement le défaut que ce
fichier existe pour empêcher : *« quelqu'un qui relit ce qu'un agent a fait à son dépôt a besoin de
l'appel »*.

## Conséquences

- Vérifié de bout en bout contre un vrai modèle : le terminal dispatche `explorer`, l'agent travaille
  et rend sa conclusion, et la ligne de trace le nomme.
- Les trois correctifs sont prouvés en les retirant, séparément.

## Une leçon de méthode, sur moi

Quatre fois dans cette phase j'ai écrit un chantier depuis ce que je croyais du produit. Trois fois
la prémisse était fausse, et une fois j'ai commencé par **écraser le fichier qui contenait la
solution**. Celui-ci n'est devenu juste qu'après avoir été re-dérivé du code sur demande.

Et une erreur plus bête, le même jour : j'ai masqué la sortie de la construction du paquet de tests
(`2>&1 >/dev/null`), la compilation a échoué, et j'ai lu un **compte de tests périmé** comme un
succès. Un contrôle dont on ne regarde pas la sortie n'est pas un contrôle.

## Ce que ceci ne fait pas

- Il ne borne pas le **nombre** de sous-agents qu'un tour peut dispatcher : chaque dispatch est une
  étape, et le plafond d'étapes du tour principal les borne déjà à douze.
- Il ne donne pas aux sous-agents les compétences du chantier 4.2. Un sous-agent a son propre corps
  d'instructions, et l'empiler avec un catalogue de compétences est une question ouverte plutôt
  qu'une évidence.
- Il ne mesure pas encore le gain en jetons du contexte principal : c'est dans la mesure du lot.
