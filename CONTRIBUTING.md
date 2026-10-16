# Contribuer

## Démarrer

```bash
npm ci
npm test            # construit les bundles puis lance la suite
npm run watch       # reconstruction continue, puis F5 dans VS Code
```

`F5` ouvre une fenêtre d'extension de développement. Le canal de sortie « Hivey Code » raconte ce
qui se passe.

## Ce qui est attendu d'un changement

1. **Un test qui échoue avant.** La suite unitaire ne demande ni éditeur ni modèle ; il n'y a pas
   d'excuse.
2. **Rien de nouveau dans `dependencies`.** Voir `docs/adr/0004`. Une exception se discute dans une
   issue avant le code.
3. **`src/core/` n'importe jamais `vscode`.** Si votre règle a besoin de l'éditeur, elle appartient
   à `src/extension/` ; si elle a besoin des deux, elle appartient au noyau avec un rappel injecté.
4. **Tout nouveau chemin réseau passe par `EgressGate.prepare()`**, et tout nouvel outil déclare son
   `approval()`.
5. **`npm run scan:secrets` passe.** Il scanne ce dépôt avec les détecteurs de l'extension : s'il
   crie sur du code ordinaire, c'est la règle qu'il faut corriger, avec un test de non-régression.
6. **La documentation suit le code.** `npm run check:numbers` vérifie les chiffres annoncés (version,
   nombre de tests, de tâches du banc, de décisions) ; `npm run check:course` refuse la construction
   tant que les deux éditions du cours (`docs/cours/` et `docs/course/`) n'ont pas été relues pour la
   version en cours ; `npm run eval:verify` exige que chaque tâche du banc échoue sur son état de
   départ.

## Style

- Commentaires en anglais. Les chaînes de l'interface sont écrites en anglais dans le source et
  traduites par `src/shared/i18n.fr.ts` (et `package.nls.fr.json` pour le manifeste) ; un test échoue
  si une chaîne n'a pas de traduction. Les décisions (`docs/adr/`) sont en français, le cours existe
  en français et en anglais.
- Un commentaire explique **pourquoi**, jamais **quoi**. Le quoi se lit dans le code.
- Messages de commit à l'impératif, préfixe *conventional commits*, corps qui dit pourquoi.
