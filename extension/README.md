# Extension Chrome de synchronisation

1. Ouvrir `chrome://extensions`.
2. Activer **Mode développeur**.
3. Cliquer **Charger l’extension non empaquetée**.
4. Sélectionner le dossier `extension` de ce projet.
5. Actualiser l’extension après chaque mise à jour de l’application.
6. Ouvrir n’importe quelle page Rebrickable : la part list `108467` est synchronisée automatiquement dans un onglet inactif.

Le module ouvre **Export Parts**, sélectionne **Rebrickable CSV**, reproduit la soumission du formulaire (GET ou POST avec ses champs), puis transmet le CSV à l’application locale sans parcourir les tuiles ni la pagination. Il sait aussi exporter l’inventaire d’une révision précise de set ou d’un MOC.

Depuis **Gérer les cases**, la version 3.4.0 peut également vérifier une liste nouvellement importée. Elle ouvre temporairement la liste de référence `108467` et la liste dont l’ID est saisi, exporte les deux CSV en lecture seule et referme les onglets. Cette opération ne resynchronise pas les emplacements et ne modifie aucune liste Rebrickable.

L’extension transmet uniquement le contenu de l’export CSV à `http://localhost:3000`. Elle ne lit ni ne stocke les identifiants Rebrickable.
