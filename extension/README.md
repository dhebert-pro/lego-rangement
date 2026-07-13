# Extension Chrome de synchronisation

1. Ouvrir `chrome://extensions`.
2. Activer **Mode développeur**.
3. Cliquer **Charger l’extension non empaquetée**.
4. Sélectionner le dossier `extension` de ce projet.
5. Actualiser l’extension après chaque mise à jour de l’application.
6. Ouvrir n’importe quelle page Rebrickable : la part list `108467` est synchronisée automatiquement dans un onglet inactif.

Le module ouvre **Export Parts**, sélectionne **Rebrickable CSV**, reproduit la soumission du formulaire (GET ou POST avec ses champs), puis transmet le CSV à l’application locale sans parcourir les tuiles ni la pagination. Il sait aussi lire l’inventaire d’une révision précise de set ou d’un MOC.

L’extension transmet les exports CSV à `http://localhost:3000` et ne lit ni ne stocke les identifiants Rebrickable. Depuis **Gérer les cases**, le bouton **Appliquer les cases sur Rebrickable** peut modifier les formulaires individuels de la liste `108467`. Chaque pièce/couleur et chaque champ `Location` sont contrôlés avant l’écriture, puis un nouvel export complet vérifie le résultat et l’absence de toute autre modification.
