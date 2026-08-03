@AGENTS.md

# CLAUDE.md — Kadens Mobile

Guide de travail pour ce dépôt. À maintenir à jour à chaque décision
structurante, comme dans le dépôt `kadens`.

Les références qui priment sur ce fichier vivent dans le dépôt serveur
(`../kadens`) et ne sont pas à recopier ici :

- `docs/feature-live-tracking.md` — cadrage, décisions et tickets KL-xx. **La
  référence.**
- `docs/api-mobile.md` — le contrat de l'API, endpoint par endpoint.
- `docs/design-system.md` + `CLAUDE.md §5` — l'identité « Presse » et ses règles.

---

## 1. Le projet en une phrase

App Android (Expo / React Native) qui déroule une séance de muscu programmée,
en logue le **réalisé série par série**, entièrement **hors réseau**, et
synchronise en différé avec Kadens.

## 2. Stack

- **Expo SDK 57** (React Native 0.86, React 19), TypeScript, **`expo-router`**
- **`expo-sqlite` + Drizzle** pour la base locale (KL-24)
- **File de mutations maison** pour la synchronisation (KL-27), pas de moteur
  de sync tiers
- Token d'API dans **`expo-secure-store`**, jamais dans `AsyncStorage` (KL-25)
- Build par **`expo prebuild` + Gradle** dans GitHub Actions (pas d'EAS Build)
- Distribution par **dépôt F-Droid auto-hébergé** (APK signé, pas d'AAB)

## 3. Règles verrouillées (ne pas rediscuter en cours de route)

- **Le mobile est la seule source d'écriture du réalisé ; le serveur fait
  autorité sur la programmation.** Le `PUT` écrase `log`, `startedAt`,
  `endedAt` ; `date` et `title` ne servent qu'à la création, `status` ne peut
  que clôturer. Détail dans `docs/api-mobile.md`.
- **Les UUID sont générés par le client**, à la création : c'est ce qui rend
  `PUT /api/schedule/{uuid}` idempotent.
- **Aucune recomposition de séance depuis le mobile.** On dévie d'une séance,
  on ne la réécrit pas.
- **Pas de saisie cardio.** Les exercices `DISTANCE_PACE`, `DISTANCE_TIME`,
  `DURATION` et `FREE` s'affichent en lecture et se cochent fait / pas fait,
  rien de plus. Strava couvre le cardio.
- **Pas de thème sombre.** L'identité Presse est papier et encre ; un thème
  sombre serait une deuxième identité à maintenir.
- **Tout horodatage part en UTC** (`…Z`). Limite serveur connue : un décalage
  non nul est relu comme si l'heure murale était de l'UTC, donc faux de deux
  heures en été (§KL-19).
- **`android/` n'est pas versionné.** Toute configuration native passe par un
  plugin déclaré dans `app.json`.
- **`src/theme/tokens.ts` est généré** depuis `design-tokens.json` publié par le
  serveur (KL-22) : versionné, jamais édité à la main.
- **Aucune couleur ni police en dur dans un composant**, toujours un token
  sémantique (règle 1 du design system). Le condensé capitales ne touche jamais
  au contenu saisi : nom d'exercice et de séance en Barlow, casse normale
  (règle 4).

## 4. Conventions de rangement

- Route → `src/app/` (`expo-router`, une route = un fichier)
- Composant de base → `src/components/`
- Thème et tokens → `src/theme/`
- Base locale, schéma et migrations → `src/db/`
- Client API → `src/api/`
- Alias d'import : `@/` pointe `src/`

## 5. État d'avancement

**KL-21 livré (03/08/2026)** : socle du dépôt. Projet Expo TypeScript avec
`expo-router`, ESLint + Prettier, `app.json` à l'identité Kadens
(`fr.antoninpamart.kadens`, portrait, `light`), `android/` non versionné,
`.env.example` et README (dont le rappel de l'IP LAN).

Prochain ticket : **KL-22** (socle de design natif).
