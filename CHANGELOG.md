# Changelog

Toutes les évolutions notables de Kadens Live sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et le
projet suit [SemVer](https://semver.org/lang/fr/).

Ce fichier n'est pas décoratif : le workflow `build.yml` extrait la section de
la version taguée et s'en sert comme description de la GitHub Release. Un tag
`vX.Y.Z` sans section `## [X.Y.Z]` fait échouer le build avant la compilation.

## [Non publié]

### Ajouté

- Annulation d'une séance commencée, tant qu'elle n'est pas terminée. Une séance
  **prévue** redevient à faire : la borne de départ est retirée et tout ce qui y
  avait été coché est effacé, ici comme sur le web. Une séance **libre**, qui
  n'existait que parce qu'on l'avait créée, disparaît. Le geste est confirmé et
  sans retour, et il n'a rien à voir avec terminer une séance : rien n'entre dans
  l'historique.
- Réorganisation de la séance en cours : un mode « Réorganiser les exercices »
  permet de déplacer un exercice dans son bloc, de l'enchaîner à son voisin en
  superset ou de l'en détacher. L'ordre est **local au téléphone**, il ne modifie
  pas le programme et ne part pas au serveur ; il décide de l'ordre d'affichage
  et de ce que la barre du bas propose de valider.
- Choix de l'axe de saisie d'une série hors programme, répétitions ou durée. Il
  n'était jusqu'ici déductible que des valeurs, donc figé en répétitions pour un
  exercice ajouté en séance ; les séries suivantes en héritent.

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

[Non publié]: https://github.com/CallMeTrinity/kadens-mobile/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/CallMeTrinity/kadens-mobile/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/CallMeTrinity/kadens-mobile/compare/v0.0.3...v1.0.0
[0.0.3]: https://github.com/CallMeTrinity/kadens-mobile/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/CallMeTrinity/kadens-mobile/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/CallMeTrinity/kadens-mobile/releases/tag/v0.0.1
