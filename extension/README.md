# Extension Chrome de synchronisation

1. Ouvrir `chrome://extensions`.
2. Activer **Mode développeur**.
3. Cliquer **Charger l’extension non empaquetée**.
4. Sélectionner le dossier `extension` de ce projet.
5. Actualiser l’extension après chaque mise à jour de l’application.
6. Ouvrir n’importe quelle page Rebrickable : la part list `108467` est synchronisée automatiquement dans un onglet inactif.

Le module ouvre **Export Parts**, sélectionne **Rebrickable CSV**, reproduit la soumission du formulaire (GET ou POST avec ses champs), puis transmet le CSV à l’application locale sans parcourir les tuiles ni la pagination. Il sait aussi lire l’inventaire d’une révision précise de set ou d’un MOC.

L’extension transmet uniquement le contenu des exports CSV à `http://localhost:3000`. Elle ne lit ni ne stocke les identifiants Rebrickable et ne modifie aucune liste sur Rebrickable. Les changements de case restent dans LEGO Rangement.
