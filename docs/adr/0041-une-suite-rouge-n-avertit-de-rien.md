# 0041 — Une suite rouge n'avertit de rien

**Statut** : accepté · **Date** : 2026-10-06

## Contexte

Florian : « et le CI workflow a toujours plein d'erreurs cest normal ? »

Non. L'intégration continue échouait à **chaque poussée**, au moins depuis le 2026-10-03, pendant que
`npm test` passait en local à 1 308 tests sur 1 308. Les autres ateliers — CodeQL, catalogue de
modèles, évaluation — étaient verts.

Les trois causes, une fois séparées par job :

| Job | Tests | Erreur |
|---|---|---|
| `unit (18, ubuntu-latest)` | 5 tests SIEM | `connect ECONNREFUSED ::1:35751` |
| `unit (22, windows-latest)` | bac à sable de fond | `no matching manifest for windows(10.0.26100)/amd64` |
| `unit (22, windows-latest)` | aside tool | une expression régulière qui traverse un `\n` |

**Les trois étaient environnementales.** Aucune ne venait du produit, et c'est exactement ce qui les a
rendues faciles à laisser passer : chaque échec avait une explication rassurante disponible
immédiatement — « c'est le runner », « c'est Windows » — et aucune de ces explications n'était fausse.

## Décision

**Le vrai défaut n'est aucune des trois.** C'est qu'une suite qui échoue à chaque poussée a cessé
d'être un signal. Elle ne distingue plus rien : une régression réelle y serait arrivée dans le même
rouge que les cinq échecs attendus, et personne ne l'aurait vue. Le coût d'un test qui échoue pour une
mauvaise raison n'est pas le test — c'est **tous les autres**, qui perdent leur pouvoir d'alerter.

Donc : aucun échec environnemental n'est toléré en l'état. Chacun est traité à sa cause, et la règle
qui en sort est écrite ici.

**1. Un test se lie là où le nom qu'il utilise pointe réellement.** Le collecteur de test se liait à
`127.0.0.1` pendant que les tests se connectaient à `localhost`, et sur le runner ce nom résout
d'abord en `::1`. Ce n'était pas un détail d'écriture : les tests utilisent `localhost` **parce que**
le certificat porte `DNS:localhost` et que vérifier ce nom est la moitié de ce qu'ils affirment. Le
test résout le nom et écoute à l'adresse obtenue.

Le point le plus instructif est **pourquoi Node 18 seulement** : Node 20 a activé *Happy Eyeballs*
(`autoSelectFamily`) par défaut et réessayait en IPv4 sans rien dire. La version la plus récente
**masquait** le défaut. Une matrice de versions ne sert à rien si l'on explique ses désaccords par
l'âge de la version la plus vieille.

**2. « L'outil répond » et « l'outil peut faire ce qu'on va lui demander » sont deux faits
différents.** Le garde-fou demandait `docker version --format {{.Server.Version}}`, qui répond
parfaitement sur un démon en mode conteneurs Windows — incapable d'exécuter `alpine:latest`. Il
demande désormais `{{.Server.Os}}`.

Le test garde son **échec dur** partout où le démon est Linux : la promesse « une commande de fond ne
peut pas atteindre le réseau » reste la chose que personne ne doit prendre sur parole, et elle est
éprouvée sur tous les jobs Ubuntu et toutes les machines de développement. Là où la machine ne peut
rien en dire, la réponse est la **troisième** — « je ne sais pas » — et elle est **nommée** par un
`skip` qui porte sa raison, plutôt que déguisée en succès. *Un « je ne sais pas » silencieux se lit
comme un oui.*

**3. Les fins de ligne sont du contenu du dépôt, pas une préférence locale.** Plusieurs tests lisent
le source du projet et affirment sur lui ; certaines affirmations traversent un retour à la ligne. Le
`core.autocrlf=true` par défaut de git sur Windows réécrivait chaque LF en CRLF au checkout, donc le
fichier que le test lisait ne contenait plus ce que le test cherchait. **Le test avait raison, le
source avait raison, et le checkout s'était interposé entre les deux.**

`.gitattributes` épingle `* text=auto eol=lf`, ce qui l'emporte sur `core.autocrlf` pour tous les
clones et toutes les plateformes. Et `tests/sourceBytes.test.ts` garde **l'épingle et son effet** :
l'une parce qu'un correctif que rien ne surveille finira par être retiré, l'autre parce que c'est
l'effet, pas la déclaration, qui fait passer les tests.

Ceci ne dit rien des fichiers que l'utilisateur édite : ceux-là arrivent avec les fins de ligne qu'ils
ont, et `src/core/text/findText.ts` est ce qui fait que `edit_file` les retrouve dans les deux cas. Les
deux problèmes se ressemblent et n'ont pas la même réponse : **nos** octets sont normalisés, les
**leurs** sont acceptés tels quels.

## Conséquences

- Les trois correctifs sont des tests et un `.gitattributes` : **aucun code de production n'a changé**,
  ce qui est la preuve que la rougeur ne venait pas de là.
- Deux des trois ne peuvent pas être vérifiés sur cette machine (il n'y a pas de démon Windows, et
  `localhost` n'a pas d'entrée `::1` ici). Le mécanisme IPv6 a donc été reproduit avec un nom qui, lui,
  résout en `::1` : l'ancienne liaison rend `connect ECONNREFUSED ::1:35515` — le texte exact de CI —
  et la nouvelle se connecte. **La vérification finale est CI lui-même**, et c'est le seul cas où cette
  phrase est acceptable.
- `gh run list` après chaque poussée, et non à la question suivante de Florian. Un atelier rouge se
  traite au moment où il rougit, parce que c'est le seul moment où l'on sait ce qui l'a fait rougir.
