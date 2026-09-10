# Changelog

Toutes les évolutions notables de Kadens Live sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et le
projet suit [SemVer](https://semver.org/lang/fr/).

Ce fichier n'est pas décoratif : le workflow `build.yml` extrait la section de
la version taguée et s'en sert comme description de la GitHub Release. Un tag
`vX.Y.Z` sans section `## [X.Y.Z]` fait échouer le build avant la compilation.

## [Non publié]

## [1.2.0] - 2026-09-10

### Ajouté

- **Thème sombre**, avec un réglage à trois états dans « Affichage » : Système,
  Clair, Sombre. Par défaut l'app suit le téléphone ; le forcer ne change que cet
  appareil, les séances et le compte n'en savent rien. Les deux papiers sortent de
  la **même** source que le clair — la feuille de tokens du serveur, qui publie
  désormais un second jeu que le site, lui, n'active pas. Rien n'est recopié, et
  un token de couleur qui manquerait à l'un des deux fait échouer la publication
  plutôt que d'arriver en salle avec la mauvaise valeur. Tous les couples
  encre/fond de l'app sont vérifiés à AA dans les deux jeux.
- **Le record se voit sur la série qui vient de le battre** : un losange rouge en
  fin de ligne, dans une gouttière réservée pour que rien ne bouge au moment où
  l'on coche. La règle est celle du serveur, sans rien y ajouter — charge maximale
  brute, aucune estimation, échauffement et exercice sauté exclus, série chiffrée
  obligatoire, et pas de record au poids du corps. Un exercice qu'on n'a jamais
  chargé n'a rien à battre : sa première charge est une première. Un seul losange
  par exercice, porté par la meilleure série, et le mot s'écrit à la clôture.

### Corrigé

- **« Dernière fois » ne parle plus de la séance en cours.** Elle se lit avant de
  charger la barre : elle doit dire ce qui précède, jamais ce qu'on est en train
  de faire. Un simple verrouillage d'écran entre deux séries suffisait pourtant à
  déclencher une synchronisation, et l'historique redescendait alors en incluant
  les séries qu'on venait de cocher — juste au-dessus d'elles. Ce repère est
  maintenant gelé pour la durée de la séance ; il se remet à jour dès qu'elle est
  terminée.

### Modifié

- **Moins de batterie, écran allumé.** Le minuteur de repos re-dessinait l'écran
  de séance entier une fois par seconde, soit la moitié d'une séance d'une heure ;
  il ne redessine plus que sa propre barre. Les onglets restaient vivants sous la
  séance et recalculaient à chaque série cochée : ils sont maintenant suspendus
  tant qu'elle est ouverte. Enfin, une rafale de « + 15 s » ne replanifie plus
  quatre alarmes système, et la permission de notifier n'est plus relue à chaque
  repos. Rien ne change à l'usage.

## [1.1.1] - 2026-08-26

### Ajouté

- Le dépôt se travaille aussi sous Windows : les fins de ligne sont normalisées
  en LF (`.gitattributes`) et les scripts npm passent par `cross-env`. Sans quoi
  `npm run lint` remontait un « Delete ␍ » par ligne pendant que la CI passait,
  et `npm run android` échouait hors shell POSIX. Rien ne bouge dans
  l'application.

### Modifié

- La réorganisation d'une séance n'est plus enfermée dans un bloc : un exercice
  se tire **d'un bloc à l'autre**, échauffement compris, et se pose là où il est
  réellement mené. Le bloc d'arrivée le compte dans son total, la barre du bas
  suit, et un bloc vidé reste visible en mode réorganisation pour qu'on puisse y
  revenir. Comme avant, l'ordre est **local au téléphone** : il ne modifie pas le
  programme et ne part pas au serveur. Un exercice qui change de bloc quitte son
  superset — il se ré-enchaîne au besoin.
- Le titre de l'écran de séance est le **nom de la séance** plutôt que le mot
  « Séance » : le vrai nom se lisait un étage plus bas, plus petit, dans la
  bande de tête, qui n'en garde plus que ce qui n'y est pas déjà — le plan et la
  progression — et disparaît quand il ne lui reste rien. L'en-tête est resserré
  et les pastilles (« En cours », « Terminée », « À synchroniser ») remontent
  sur la ligne du retour : en séance, la hauteur prise en tête est prise à la
  série en cours. Les cibles, elles, ne rétrécissent pas.

### Corrigé

- Une série corrigée ne déborde plus, à aucune largeur d'écran. Une ligne dont
  la charge **et** les répétitions ont été corrigées écrivait quatre valeurs
  avec leurs unités deux fois chacune ; sur un écran étroit elles passaient sous
  la case à cocher, puis hors du filet, et Android coupait les mots au passage.
  Le prévu s'écrit désormais **sous** le saisi, barré et sans son unité, et
  l'unité s'écrit un pas plus petite que son nombre : une série corrigée demande
  exactement la même largeur qu'une série qui va comme prévu. Vérifié de 420 à
  260 dp.

## [1.1.0] - 2026-08-23

### Ajouté

- Correction d'une série **avant** de la faire : la zone de valeurs d'une ligne
  ouvre sa feuille qu'elle soit cochée ou non. Les valeurs saisies s'affichent sur
  la ligne et dans la barre du bas, et c'est ce qui se consigne quand on coche.
  Rien n'est écrit tant que la série n'est pas cochée, et le programme reste
  affiché à côté. De quoi corriger la charge de quatre séries d'un coup au lieu
  de les déclarer faites une à une pour pouvoir les corriger.
- Annulation d'une séance commencée, tant qu'elle n'est pas terminée. Une séance
  **prévue** redevient à faire : la borne de départ est retirée et tout ce qui y
  avait été coché est effacé, ici comme sur le web. Une séance **libre**, qui
  n'existait que parce qu'on l'avait créée, disparaît. Le geste est confirmé et
  sans retour, et il n'a rien à voir avec terminer une séance : rien n'entre dans
  l'historique.
- Réorganisation de la séance en cours : un mode « Réorganiser les exercices »
  permet de déplacer un exercice dans son bloc **en le tirant par sa poignée**,
  de l'enchaîner à son voisin en superset ou de l'en détacher. L'ordre est
  **local au téléphone**, il ne modifie pas le programme et ne part pas au
  serveur ; il décide de l'ordre d'affichage et de ce que la barre du bas propose
  de valider.
- Choix de l'axe de saisie d'une série hors programme, répétitions ou durée. Il
  n'était jusqu'ici déductible que des valeurs, donc figé en répétitions pour un
  exercice ajouté en séance ; les séries suivantes en héritent.

### Corrigé

- Une valeur tapée au clavier numérique est prise en compte sans avoir à valider
  le clavier d'abord. Taper « 12 » puis appuyer directement sur « Valider »
  enregistrait jusqu'ici la valeur d'avant : sur Android, appuyer sur un bouton
  ne referme pas forcément le champ, et la saisie restait en suspens.

## [1.0.1] - 2026-08-07

### Corrigé

- Le numéro de build annoncé par l'application correspond de nouveau à celui de
  l'APK installé. La 1.0.0 s'annonçait en build 1 et s'affichait donc comme trop
  ancienne pour le serveur, jusqu'à l'écran de mise à jour obligatoire.

## [1.0.0] - 2026-08-05

### Ajouté

- Noms d'exercices bilingues, avec la préférence de langue du compte.
- Préférence de silhouette.
- Comptage des séries validées sans valeur dans le résumé de séance.

### Modifié

- L'application s'appelle désormais « Kadens Live ».

## [0.0.3] - 2026-08-04

### Modifié

- Navigation et interactions revues dans la séance en direct : actions des
  boutons et guidage.

## [0.0.2] - 2026-08-03

### Modifié

- Distinction explicite entre une séance en cours et une séance clôturée : une
  séance clôturée ne se reprend plus.

## [0.0.1] - 2026-08-03

Première version publiée.

### Ajouté

- Connexion et appairage par QR code, avec configuration de l'URL du serveur.
- Base SQLite locale et moteur de synchronisation hors ligne : pull, push et
  file d'attente des modifications.
- Séance en direct : programme, log série par série, écarts sur les exercices,
  minuteur de repos et clôture de séance.
- Bibliothèque d'exercices avec recherche, filtres et facettes.
- Navigation par onglets : Historique, Aujourd'hui, Réglages.
- Réglages : préférences, repos automatique et état de la synchronisation.
- Gestion des erreurs et des états hors ligne.
- Identité visuelle, typographie et composants de base.
- Accessibilité et contrastes conformes.
- Bandeau de mise à jour signalant une version plus récente.
- Chaîne de build : APK de release signé, publié en GitHub Release sur tag.

[Non publié]: https://github.com/CallMeTrinity/kadens-mobile/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/CallMeTrinity/kadens-mobile/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/CallMeTrinity/kadens-mobile/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/CallMeTrinity/kadens-mobile/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/CallMeTrinity/kadens-mobile/compare/v0.0.3...v1.0.0
[0.0.3]: https://github.com/CallMeTrinity/kadens-mobile/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/CallMeTrinity/kadens-mobile/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/CallMeTrinity/kadens-mobile/releases/tag/v0.0.1
