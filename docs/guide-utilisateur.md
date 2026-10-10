# Guide utilisateur — Appli Courses

## 1. À quoi sert l'application ?

**Appli Courses** est une application web pensée pour préparer et suivre les courses en comparant les produits entre **Leclerc** et **Intermarché**.

L'application est conçue comme une **PWA** : elle peut être utilisée depuis un navigateur mobile et installée sur l'écran d'accueil d'un téléphone compatible.

> **État actuel :** le socle technique de l'application est en place, mais les fonctions métier principales (relevé de prix, liste de courses, types de produits et bilan des économies) ne sont pas encore disponibles dans la version actuelle.

## 2. Navigation

L'application comporte quatre rubriques principales accessibles depuis la barre de navigation située en bas de l'écran.

### Magasin

Cette rubrique est destinée au relevé des prix et au verdict de comparaison entre les magasins.

**État actuel :** l'écran est présent, mais la fonction de relevé et de comparaison n'est pas encore implémentée.

### Liste

Cette rubrique est destinée à préparer la liste de courses.

**État actuel :** l'écran est présent, mais la gestion de la liste n'est pas encore implémentée.

### Types

Cette rubrique doit permettre de gérer les types de produits utilisés pour les comparaisons.

**État actuel :** l'écran est présent, mais la gestion des types n'est pas encore implémentée.

### Bilan

Cette rubrique est destinée au suivi des économies réalisées.

**État actuel :** l'écran est présent, mais le calcul et l'affichage du bilan ne sont pas encore implémentés.

## 3. Réglages et diagnostic

Le bouton **Réglages** est accessible en haut à droite.

La page affiche actuellement des informations de diagnostic :

- version de l'application ;
- état de la base de données ;
- état du stockage persistant ;
- nombre de lancements enregistrés ;
- nombre d'éléments présents dans les différents types de données.

Les réglages métier, notamment le seuil de comparaison, sont prévus mais ne disposent pas encore d'une interface utilisateur complète.

## 4. Utilisation hors ligne

L'application est conçue pour fonctionner sans connexion Internet.

Lorsque l'appareil est hors ligne, une pastille **« Hors ligne »** apparaît en haut de l'écran.

Les ressources nécessaires au fonctionnement de l'application sont mises en cache par le service worker. Les données utilisateur sont stockées localement dans le navigateur.

### Important

Le fonctionnement hors ligne concerne l'application et ses données locales. Il ne signifie pas que les éventuelles données ou informations externes seront automatiquement mises à jour sans connexion.

## 5. Données enregistrées

Les données sont conservées localement dans le navigateur, dans une base de données IndexedDB.

L'application prévoit notamment de gérer :

- les types de produits ;
- les articles identifiés par code-barres ;
- les observations de prix ;
- les achats ;
- les réglages de l'application.

Les prix sont enregistrés en centimes afin d'éviter les erreurs liées aux nombres décimaux.

Les données de l'application sont séparées du cache utilisé pour le fonctionnement hors ligne : une mise à jour de l'application ne doit donc pas effacer les données enregistrées.

> **Conseil :** tant que les fonctions de sauvegarde/export ne sont pas disponibles dans l'interface, il est prudent de considérer les données du navigateur comme locales à l'appareil et au navigateur utilisé.

## 6. Installation sur téléphone

L'application est prévue pour être installable comme une application web.

Lorsque le navigateur propose l'installation ou l'ajout à l'écran d'accueil :

1. choisir l'option d'installation ;
2. accepter l'ajout de l'application ;
3. lancer ensuite **Courses** depuis l'écran d'accueil.

L'application est configurée pour fonctionner en mode autonome et en orientation portrait.

## 7. Lecture des codes-barres

Le dépôt contient également une page de test dédiée au lecteur de codes-barres :

**scan-test.html**

Cette page permet de vérifier :

- l'accès à la caméra ;
- la présence de l'API native BarcodeDetector ;
- les formats de codes-barres pris en charge par le navigateur ;
- la lecture de codes EAN-13, EAN-8, UPC-A, UPC-E et Code 128 lorsque l'API native est disponible.

Cette page est actuellement un outil de test technique et ne fait pas encore partie du parcours utilisateur principal.

## 8. Ce qui est disponible aujourd'hui

| Fonction | État |
|---|---|
| Navigation entre les écrans | Disponible |
| Écran Magasin | Écran de base disponible |
| Écran Liste | Écran de base disponible |
| Écran Types | Écran de base disponible |
| Écran Bilan | Écran de base disponible |
| Réglages / diagnostic | Disponible |
| Base de données locale | Disponible |
| Stockage persistant | Géré lorsque le navigateur le permet |
| Fonctionnement hors ligne | Socle disponible |
| Installation PWA | Configurée |
| Test du lecteur de codes-barres | Disponible dans scan-test.html |
| Relevé de prix | À venir |
| Comparaison des prix | À venir |
| Gestion de la liste de courses | À venir |
| Gestion des types de produits | À venir |
| Bilan des économies | À venir |
| Sauvegarde / restauration utilisateur | À venir |

## 9. À retenir

La version actuelle constitue principalement le **socle de l'application** : navigation, interface, stockage local, fonctionnement hors ligne et installation PWA.

Les écrans métier sont déjà accessibles afin de préparer les futures fonctionnalités, mais ils ne doivent pas encore être considérés comme opérationnels pour réaliser réellement les courses ou comparer les prix.
