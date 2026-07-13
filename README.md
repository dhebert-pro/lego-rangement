# LEGO Rangement

Application locale qui croise l’inventaire d’un set ou d’un MOC Rebrickable avec la part list `108467`, indique la case de chaque pièce et construit un ordre de rangement.

## Démarrage

Sur le PC déjà configuré, double-cliquer sur `Demarrer-LEGO.cmd`. Le lanceur démarre le serveur, ouvre `http://localhost:3000` et affiche aussi l’adresse à utiliser sur le téléphone.

En ligne de commande, il reste possible d’utiliser `npm start` avec Node.js 18 ou plus récent.

La connexion Rebrickable enregistrée dans `config.local.json` est utilisée automatiquement. Ce fichier, les emplacements et les caches locaux sont exclus de Git.

## Emplacements

L’API v3 de Rebrickable ne renvoie pas le champ `Location` affiché sur le site. Le module Chrome dans `extension/` lit donc l’export CSV de la part list, puis l’application conserve ses propres cases dans `locations.local.json`. Rebrickable reste la source de la liste des pièces, mais l’application est la source de vérité pour les déplacements effectués ensuite.

Une pièce sans emplacement peut recevoir une case directement dans le résultat. Une pièce déjà localisée propose aussi **Changer de case**. Chaque modification est sauvegardée et recalcule immédiatement le plan.

Chaque pièce ou étape entière peut être cochée comme rangée. **Tout décocher** remet le modèle à zéro. La progression est pondérée par la quantité réelle et sauvegardée dans `progress.local.json`, afin d’être partagée entre le PC et le téléphone. Les cases terminées quittent le plan actif mais restent accessibles dans **Rangées** pour corriger une erreur.

Le module Chrome 3.6 synchronise automatiquement la part list `108467` dès qu’une page Rebrickable est ouverte. Un lien de set contenant `inventory=N` ou un lien de MOC déclenche l’export exact correspondant lors de son premier chargement et le conserve dans `set-inventories.local.json`. Il n’est pas nécessaire de relancer l’extension entre deux recherches ; son bouton **Actualiser** ne sert qu’après une mise à jour de son code.

## Gestion des cases

La page **Gérer les cases** (`/storage.html`) affiche toutes les références présentes dans une case. Plusieurs références peuvent être cochées puis déplacées ensemble vers une autre case. Les nouveaux emplacements restent prioritaires lors des synchronisations Rebrickable suivantes.

Les déplacements sont enregistrés sur le serveur du PC et sont donc partagés avec le téléphone. Une pièce déplacée plusieurs fois ne conserve qu’un trajet entre sa case d’origine et sa case actuelle. Le bouton **Vider l’historique** restaure toutes ces pièces dans leur case d’origine avant d’effacer le journal.

Le bouton **Actualiser depuis Rebrickable** relit la part list depuis Chrome. Les déplacements encore présents dans l’historique et les attributions manuelles sont ensuite réappliqués automatiquement : cette opération actualise les pièces sans effacer l’organisation faite dans l’application.

Les boutons **Sauvegarder** et **Restaurer** utilisent un fichier JSON propre à LEGO Rangement. Il contient les emplacements courants, les cases d’origine et finales de l’historique ainsi que les attributions manuelles. Il ne contient ni clé API, ni jeton, ni mot de passe. Avant chaque restauration, le serveur conserve aussi automatiquement l’état précédent dans `storage-before-restore.local.json`.

Le bouton **Appliquer les cases sur Rebrickable** compare d’abord un export complet avec les cases de l’application. L’extension parcourt ensuite toute la pagination, associe chaque combinaison pièce/couleur à son identifiant interne et prépare son formulaire individuel avant la première écriture. Elle ne modifie que `Location`. Un second export complet vérifie ensuite que les références, couleurs, quantités, notes, états, autocollants et emplacements non ciblés sont inchangés. Si une opération est interrompue, l’historique reste intact et le bouton reprend uniquement les différences restantes.

Il n’existe plus de parcours d’export puis de réimport vers Rebrickable : l’import Rebrickable peut normaliser certaines variantes de moules et fusionner des références. La mise à jour passe uniquement par les formulaires individuels du site et par une vérification avant/après.

Les cases libres sont calculées dans le référentiel fixe des rangements existants : `1` à `3`, puis `A1` à `A9` jusqu’à `AB1` à `AB9`. Elles sont recalculées après chaque déplacement ou restauration. Les images exactes de chaque couleur sont chargées progressivement puis mises en cache localement.

Depuis le contenu d’une case, deux boutons proposent une division en 2 ou en 3. Chaque groupe reçoit un nom explicite fondé en priorité sur une caractéristique observable : famille d’utilisation, trou ou ouverture, partie d’animal ou de figurine, gabarit, ou palette de couleurs. La facilité de repérage vient ensuite ; l’équilibre du nombre de pièces n’est utilisé qu’en troisième critère. Il ne déplace aucune pièce automatiquement : les cases libres proposées restent des suggestions.

Après un conseil de découpage, la destination de chaque groupe peut être modifiée. Le panneau **Choisir les pièces** permet de sélectionner indépendamment les références à déplacer avec **Déplacer la sélection** ; **Appliquer tout le découpage** enregistre tous les groupes de manière atomique. Dans les deux cas, les déplacements rejoignent le même historique consolidé que les déplacements manuels.

Les listes de pièces, les cases vides, l’historique et le détail de chaque groupe sont repliables et limitent leur propre hauteur afin d’éviter les longues pages, notamment sur téléphone.

Les miniatures des deux pages s’agrandissent au survol sur ordinateur et au toucher sur téléphone.

## Ordre de rangement

Le nom de la pièce n’est jamais utilisé pour estimer sa forme ou sa taille. Le score repose sur :

- les trois dimensions calculées depuis la géométrie 3D officielle LDraw ;
- le volume, l’allongement et la finesse déduits de cette géométrie ;
- la couleur structurée, la quantité, la catégorie et la ressemblance avec les pièces restant réellement à chercher.

Rebrickable fournit la correspondance vers LDraw dans `external_ids.LDraw`. Le fichier embarqué `data/ldraw-dimensions.json` contient les boîtes englobantes calculées depuis les sommets et sous-pièces de la bibliothèque officielle LDraw. Il couvre plus de 24 000 références et évite tout appel réseau au lancement.

Si BrickLink Studio a déjà créé son cache catalogue local, l’application y lit également le poids. Ce cache est facultatif : aucun compte vendeur et aucune clé API ne sont nécessaires.

Les pièces faciles à repérer sont proposées en premier et le plan est recalculé après chaque coche. Une case est classée selon sa pièce la plus difficile. Ses références restent regroupées, sauf lorsqu’un écart important de difficulté compense le coût d’une nouvelle ouverture ; jusqu’à trois passages peuvent alors être affichés explicitement.

Les panneaux de cases sont repliables. Des indicateurs signalent aussi lorsqu’une étape regroupe toutes les couleurs d’une même forme, toutes les formes d’une même couleur, ou les deux. Les pièces imprimées utilisent `print_of` pour retrouver leur forme de base.

`external_ids.BrickLink` sert à faire correspondre le cache Studio local et à afficher un lien vers la fiche publique BrickLink. Lorsqu’un modèle LDraw manque, l’application le signale au lieu d’inventer une taille à partir du nom.

Le catalogue peut être régénéré avec `node scripts/build-ldraw-dimensions.js data/ldraw-complete.zip data/ldraw-dimensions.json`. La bibliothèque LDraw est distribuée sous licence CC BY 4.0.

## Téléphone

1. Lancer l’application sur le PC avec `Demarrer-LEGO.cmd`.
2. Connecter le Xiaomi 12T au même Wi-Fi que le PC.
3. Ouvrir dans Chrome l’adresse affichée par l’application, par exemple `http://192.168.x.x:3000`.

Le téléphone n’installe rien : ni Node.js, ni extension. Le PC doit rester allumé et éveillé. Si l’adresse ne répond pas, exécuter une seule fois `Autoriser-reseau-prive.cmd` et accepter la demande administrateur. Cette règle ouvre uniquement le port 3000 pour le sous-réseau local et le profil Windows **Privé** ; ne pas rediriger ce port sur le routeur.

Les identifiants Rebrickable se configurent uniquement depuis le PC. Le jeton enregistré reste côté serveur et n’est jamais envoyé au téléphone.

## Tests

Lancer `npm test`.
