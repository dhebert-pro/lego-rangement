# Extension Chrome de synchronisation

1. Ouvrir `chrome://extensions`.
2. Activer **Mode développeur**.
3. Cliquer **Charger l’extension non empaquetée**.
4. Sélectionner le dossier `extension` de ce projet.
5. Recharger la page de la part list Rebrickable.
6. Cliquer sur le bouton jaune **Exporter vers LEGO Rangement** en bas à droite.

Le module ouvre **Export Parts**, sélectionne **Rebrickable CSV**, reproduit la soumission du formulaire (GET ou POST avec ses champs), puis transmet le CSV à l’application locale sans parcourir les tuiles ni la pagination.

L’extension transmet uniquement le contenu de l’export CSV à `http://localhost:3000`. Elle ne lit ni ne stocke les identifiants Rebrickable.
