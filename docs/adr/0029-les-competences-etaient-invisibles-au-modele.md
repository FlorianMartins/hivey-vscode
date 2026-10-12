# ADR-0029 — Les compétences étaient invisibles au modèle

- **Statut** : accepté
- **Date** : 2026-10-03
- **Chantier** : 4.2 — les compétences chargées à la demande

## Contexte

⚠️ **Le chantier tel qu'il était rédigé portait sur un problème qui n'existait pas.** Il disait :
« il y a environ 85 compétences ; les décrire toutes dans le prompt coûte des jetons à chaque tour et
dilue l'attention du modèle ». Vérification faite dans le code :

- **Les compétences intégrées n'entrent jamais dans le prompt.** `BUILTIN_SKILLS` sert la liste des
  commandes `/` que **l'utilisateur** tape, et le panneau les filtre pour l'affichage. Le modèle ne
  les voit pas.
- **Les compétences du dépôt utilisaient déjà la divulgation progressive**, avec le raisonnement
  écrit noir sur blanc dans `skillsPrompt` : *« noms et descriptions seulement. Mettre les
  instructions complètes de chaque compétence dans chaque prompt coûterait tout le budget de
  contexte, et le modèle n'a pas besoin des instructions avant d'avoir décidé d'en utiliser une. »*

C'est la **deuxième fois** dans cette phase que j'écris un chantier depuis une hypothèse au lieu du
code (voir l'ADR-0028 pour la première). C'est un défaut de méthode, pas de chance, et il est
consigné comme tel plus bas.

Le vrai manque est l'inverse de celui que j'avais supposé. **Les 85 compétences intégrées étaient
inatteignables par le modèle.** Quarante pour IBM i, huit pour la finance, chacune adossée à une
tâche d'évaluation qui échoue avant qu'on l'applique — et toutes conditionnées au fait que
l'utilisateur **connaisse la commande à taper**. Quelqu'un qui ne sait pas que `/packed` existe n'en
bénéficie jamais. Tout un axe de l'expertise de ce produit dépendait d'un mot magique.

Et, comme en 4.1 : **le client terminal n'avait aucune compétence du tout**, ni celles du dépôt ni
les intégrées. Donc le banc, qui pilote ce client, ne pouvait pas mesurer si une compétence sert.

## Décision

**Les compétences intégrées sont offertes au modèle par le mécanisme qui existait déjà.**

Rien de neuf n'est inventé : une source de plus alimente un chemin existant. Une compétence intégrée
devient un `Skill` — nom, une ligne de description, corps — et passe par `skillsPrompt` et
`use_skill` comme celles du dépôt. Le prompt porte **le nom et une ligne** ; les instructions
n'arrivent que si le modèle les demande.

Trois bornes :

1. **Seulement ce que l'utilisateur a activé.** Les familles viennent de ses réglages, et une
   compétence désactivée n'est pas décrite — sinon le modèle annonce quelque chose que l'utilisateur
   ne peut pas invoquer. C'est aussi ce qui **borne le coût** : le catalogue entier fait 85 entrées,
   une installation typique en active une fraction.
2. **Une compétence qui est une action sur la conversation est exclue** (`/compact`). Il n'y a pas
   d'instructions à lire, et l'offrir laisserait le modèle annoncer ce qu'il ne peut pas faire.
3. **Une compétence du dépôt du même nom gagne.** Une équipe qui a écrit la sienne voulait la sienne.

Le terminal reçoit les mêmes, par le même chemin, avec les familles lues dans `.hiveycode.json` et
`general` par défaut.

## Conséquences

- Un modèle à qui on dit « ce décimal packé déborde » peut découvrir `/packed` au lieu d'attendre que
  l'utilisateur le sache. C'est la différence entre une expertise livrée et une expertise accessible.
- Le banc peut enfin mesurer si une compétence change quelque chose. Les tâches IBM i et finance ont
  chacune une compétence correspondante : c'est exactement le test que la phase demande.
- Le coût reste dans le préfixe stable (ADR-0010), donc payé une fois par conversation chez un
  fournisseur qui met les prompts en cache — et à chaque tour sur un modèle local qui n'en a pas.
  C'est la raison pour laquelle le filtre par famille n'est pas une commodité mais une nécessité.

## Le défaut de méthode, puisqu'il s'est produit deux fois

Les six chantiers de la phase 4 ont été écrits d'affilée, **depuis ce que je croyais savoir du
produit**, et non depuis le code. Deux des deux premiers portaient sur des problèmes déjà résolus :
l'état de plan existait, la divulgation progressive existait. Dans le premier cas j'ai même commencé
par **écraser le fichier** qui contenait la solution.

Ce qui a évité le pire n'est pas de la prudence, c'est que le dépôt force à vérifier : la compilation
a refusé un import inexistant, et un test qui lit le source a refusé une affirmation fausse. Mais la
**rédaction** de la feuille de route n'a pas de contrôle de ce genre, et c'est là que l'erreur est
entrée.

Conséquence pratique : **les chantiers 4.3 à 4.6 sont à re-dériver du code avant d'être engagés**, et
leur rédaction actuelle est à traiter comme une intention, pas comme un constat.

## Ce que ceci ne fait pas

- Il ne mesure pas encore le gain. La mesure de 4.1 occupait la machine ; celle de 4.2 suit.
- Il ne réduit pas le nombre de compétences. Quatre-vingt-cinq entrées dont beaucoup ne servent qu'à
  un métier est une question de produit, pas de prompt, et elle n'est pas tranchée ici.
- Il ne donne pas au modèle les sous-agents du dépôt par le même chemin : ils ont déjà le leur, et
  mélanger les deux serait une troisième chose à vérifier pour rien.
