# LEGO Rangement

Application locale qui croise l’inventaire d’un set Rebrickable avec la part list `108467`, indique la case de chaque pièce et construit un ordre de rangement.

## Démarrage

1. Installer Node.js 18 ou plus récent.
2. Lancer `npm start` dans ce dossier.
3. Ouvrir `http://localhost:3000`.

La connexion Rebrickable enregistrée dans `config.local.json` est utilisée automatiquement. Ce fichier, les emplacements et les caches locaux sont exclus de Git.

## Emplacements

L’API v3 de Rebrickable ne renvoie pas le champ `Location` affiché sur le site. L’application importe donc l’export CSV de la part list, manuellement ou avec le module Chrome dans `extension/`. Les correspondances sont enregistrées dans `locations.local.json`.

Une pièce sans emplacement peut recevoir une case directement dans le résultat. Une pièce déjà localisée propose aussi **Changer de case**. Chaque modification est sauvegardée et recalcule immédiatement le plan.

Le module Chrome 2.x synchronise automatiquement la part list `108467`. Un lien de set contenant `inventory=N` déclenche l’export de cette révision exacte et la conserve dans `set-inventories.local.json`.

## Ordre de rangement

Le nom de la pièce n’est jamais utilisé pour estimer sa forme ou sa taille. Le score repose sur :

- le poids et les trois dimensions du catalogue BrickLink ;
- la géométrie déduite de ces mesures (volume, allongement, finesse) ;
- la couleur structurée et la quantité dans le set.

Les mesures BrickLink sont récupérées par l’API officielle puis conservées 90 jours dans `bricklink-cache.local.json`. Configurez les quatre identifiants OAuth depuis la section **Données physiques BrickLink** de l’application.

Les pièces faciles à repérer sont proposées en premier. Les références d’une même case restent regroupées, sauf lorsqu’un écart important de difficulté compense le coût d’une seconde ouverture. Dans ce cas, le plan affiche explicitement deux passages.

Les mesures BrickLink sont communautaires et doivent être considérées comme indicatives. Lorsqu’elles manquent, l’application le signale au lieu d’inventer une taille à partir du nom.

## Tests

Lancer `npm test`.
