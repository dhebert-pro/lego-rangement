# LEGO Rangement

Première version de l’application qui croise l’inventaire d’un set Rebrickable avec la part list `108467`. La correspondance utilise le numéro de pièce **et** la couleur. Le contenu du champ `note` de la part list devient le numéro de case affiché.

## Démarrage

1. Installer Node.js 18 ou plus récent.
2. Dans ce dossier, lancer `npm start`.
3. Ouvrir `http://localhost:3000`.
4. La connexion enregistrée dans `config.local.json` est utilisée automatiquement.

La clé API se crée dans les paramètres Rebrickable, section API. Au premier démarrage, l’application échange le mot de passe contre un jeton utilisateur via `/api/v3/users/_token/`, enregistre ce jeton dans `config.local.json`, puis supprime le mot de passe du fichier. Ce fichier est exclu de Git.

## Emplacements

L’API v3 de Rebrickable ne renvoie pas le champ `Location` affiché dans l’infobulle du site. Deux méthodes sont disponibles : importer manuellement le CSV Rebrickable, ou utiliser le module Chrome `extension/` qui déclenche **Export Parts → Rebrickable CSV** et transmet directement le fichier à l’application. Les correspondances sont sauvegardées dans `locations.local.json`, exclu de Git.

Avec le module Chrome 2.x, l’application synchronise automatiquement la part list `108467` dans un onglet inactif. Un lien de set contenant `inventory=N` déclenche également l’export de cette révision exacte et la conserve dans `set-inventories.local.json`. L’API Rebrickable ignorant ce paramètre, l’application refuse de remplacer une révision demandée par l’inventaire courant.

## Limite connue

La forme exacte du champ de note doit être confirmée avec une réponse authentifiée de votre compte. L’application reconnaît déjà `note`, `remarks` et `location` afin de tolérer plusieurs variantes de l’API.
