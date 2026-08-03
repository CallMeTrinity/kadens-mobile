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
  serveur (`npm run sync:tokens`) : versionné, jamais édité à la main. Toute
  valeur que React Native ne comprend pas **échoue la génération** au lieu d'être
  approchée — un token muet peindrait du transparent sans rien dire.
- **Aucune couleur ni police en dur dans un composant**, toujours un token
  sémantique (règle 1 du design system). Le condensé capitales ne touche jamais
  au contenu saisi : nom d'exercice et de séance en Barlow, casse normale
  (règle 4). C'est `src/theme/typography.ts` qui tient cette frontière, en
  séparant les rôles de **structure** des rôles de **contenu** ; l'échelle y est
  écrite à la main, parce que le web la porte en `clamp()` et que `tokens.css`
  n'en dit rien.
- **Un composant importe depuis `@/theme`, jamais de `tokens.ts` directement.**
  L'adaptation aux API natives (interlettrage en em, choix d'une graisse) vit
  dans les fichiers voisins du fichier généré.
- **Une graisse = une police enregistrée.** Android ne synthétise pas les
  graisses d'une famille chargée à l'exécution : la police se choisit par
  `fontFamily(stack, weight)`, jamais par `fontWeight`.

## 4. Conventions de rangement

- Route → `src/app/` (`expo-router`, une route = un fichier)
- Composant de base → `src/components/`
- Thème et tokens → `src/theme/`
- Base locale, schéma et migrations → `src/db/`
- Client API → `src/api/`
- Script de synchronisation avec le serveur → `tools/` (Node, `.mjs`)
- Ressources embarquées → `assets/` (`fonts/` récupéré par `npm run sync:fonts`,
  `images/` repris de `public/pwa/`)
- Alias d'import : `@/` pointe `src/`

## 5. État d'avancement

**KL-21 livré (03/08/2026)** : socle du dépôt. Projet Expo TypeScript avec
`expo-router`, ESLint + Prettier, `app.json` à l'identité Kadens
(`fr.antoninpamart.kadens`, portrait, `light`), `android/` non versionné,
`.env.example` et README (dont le rappel de l'IP LAN).

**KL-22 livré (03/08/2026)** : le socle de design natif.

- `tools/sync-tokens.mjs` (`npm run sync:tokens`) traduit `design-tokens.json` en
  `src/theme/tokens.ts` : couleurs et polices sémantiques, espacements, rayons,
  graisses, interlettrage. `tools/sync-fonts.mjs` (`npm run sync:fonts`) rapatrie
  les onze `.ttf` dans `assets/fonts/`. Les deux prennent la même
  `--source=<url|chemin>` (une racine publique), défaut = la prod ; tant qu'elle
  n'est pas déployée, générer depuis le dépôt voisin : `--source=../kadens/public`.
- `src/theme/typography.ts` : l'échelle, en rôles de structure et de contenu.
  Interlettrage converti des em vers les points, interligne planché à 1×.
- `src/theme/fonts.ts` : les onze polices, chargées par `useFonts` derrière
  l'écran de démarrage, et `fontFamily(stack, weight)` typé sur ce qui est
  réellement embarqué.
- `src/app/index.tsx` reste l'écran de vérification, désormais peint aux tokens
  et montrant un échantillon de l'échelle — le moyen le plus court de voir que
  les polices ont bien chargé.

**KL-23 livré (03/08/2026)** : les composants de base, dans `src/components/`,
importés par `@/components` (jamais par leur fichier). `Button` (primaire rouge,
secondaire encre, fantôme), `Card`, `Chip`, `Field`, `NumberStepper`, `Sheet`,
`Header`, `EmptyState`. Ce qu'ils posent et qu'il ne faut pas casser :

- **Le plancher tactile de 44 points est un chiffre nommé une fois**
  (`layout.touchTarget`, `src/theme/layout.ts`), avec deux voisins : l'épaisseur
  de filet — **pas `StyleSheet.hairlineWidth`**, qui vaut moins d'un point sur
  Android et dissoudrait une identité qui tient par ses filets — et la hauteur
  maximale d'une feuille. Ce ne sont pas des tokens et ils ne peuvent pas
  l'être : le web les porte dans `base.css` ou en `vh`, `tokens.css` n'en dit
  rien, donc l'export de KL-20 ne les voit pas.
- **Le `:hover` du web devient l'état pressé**, en transposant le sens et non la
  déclaration : l'aplat rouge s'éclaircit (le foncer refermerait le bouton), le
  contour encre s'inverse, le fantôme se pose sur un fond. Un glyphe posé sur un
  aplat qui s'inverse doit s'inverser avec lui, sinon il disparaît au moment
  précis où l'on veut voir que le geste est parti.
- **`NumberStepper`, trois pièges** : la frappe reste dans un brouillon local
  jusqu'au relâchement du champ (convertir à chaque frappe rend « 82, »
  impossible à taper) ; la répétition à l'appui long lit sa base dans une `ref`,
  pas dans la prop `value`, qui n'a pas encore été re-rendue au tick suivant ;
  et le pas s'applique sur `onPressIn` pour le retour immédiat, avec un drapeau
  qui empêche `onPress` de le doubler — **TalkBack n'émet que `onPress`**, le
  supprimer rendrait le compteur inutilisable au lecteur d'écran. Les timers se
  nettoient au démontage.
- **Un seul rôle typographique ajouté** (`inputValue`, mono 22) : la valeur d'un
  compteur se lit à bout de bras, `numeric` est calibré pour une colonne de
  tableau. Une taille écrite dans un composant sortirait l'échelle de
  `typography.ts`.
- **Pas d'icônes, et c'est une décision** : « Retour » et « Fermer » en toutes
  lettres. Embarquer `lucide-react-native` + `react-native-svg` engage le bundle
  et le rendu web ; ça se tranchera quand un écran en aura besoin, pas pour un
  chevron. L'identité Presse est typographique.
- **Un `Chip` ne se tape pas** (c'est `.kd-badge`, une marque de lecture). Un
  filtre tactile sera un autre composant, avec son plancher — pas une prop
  `onPress` greffée ici. Ses deux façons de porter du sens ne se mélangent pas :
  `tone` pour un statut, `rank` pour un rang catégoriel en filet gauche.
- **`Header` porte lui-même `insets.top`** : un écran l'emploie à la racine,
  **hors** `SafeAreaView`, sinon une bande de fond papier reste au-dessus.
  Son titre est un libellé d'écran (condensé capitales) ; un nom saisi ne passe
  pas par là (règle 4).
- **`Sheet` : `flexShrink`, pas `flex: 1`** — sans lui un contenu long pousse
  l'en-tête hors de l'écran, avec `flex: 1` une feuille courte s'étire jusqu'aux
  78 %. Le voile ferme, le bouton retour d'Android aussi, le dégagement bas suit
  `insets.bottom`.
- **`src/app/index.tsx` montre les huit composants** au lieu de l'échelle : c'est
  l'écran qui sert à vérifier sur un vrai téléphone. Vérification sans
  téléphone : `npm run typecheck`, `npm run lint`, `npx prettier --check .` et un
  `npx expo export` pour Android **et** pour web — le seul qui exerce le bundler.

Prochain ticket : **KL-24** (couche SQLite + Drizzle).
