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
- **La base locale s'importe par `@/db`**, jamais par un fichier précis, et le
  pilote Drizzle d'`expo-sqlite` est **synchrone** : `db.transaction()` valide
  dès que son rappel **retourne**. Un rappel `async` validerait la transaction
  avant la première écriture, sans rien signaler. Dans une transaction : rappel
  non-`async`, et `.run()` / `.get()` / `.all()` explicites.
- **`src/db/migrations/` est généré** par `npm run db:generate` (drizzle-kit),
  versionné, jamais édité à la main — même statut que `src/theme/tokens.ts`. Une
  migration retouchée après coup a déjà été appliquée sur un téléphone et ne sera
  pas rejouée : toute correction passe par une **nouvelle** migration.
- **Le prescrit se stocke en un document, le réalisé se normalise.** Le premier
  est remplacé en entier à chaque pull et ne se recompose pas ici ; le second est
  la seule chose que le téléphone écrit. Détail et raisons dans
  `src/db/schema.ts`.
- **Le push passe toujours avant le pull**, et il n'existe pas de « pull seul ».
  Le pull remplace la fenêtre de séances datées : lancé en premier, il écraserait
  ce qui n'est pas encore parti. Ce qui reste en file après le push est
  exactement ce que le pull doit épargner.
- **Écrire du réalisé, c'est empiler sa mutation dans la MÊME transaction.**
  `enqueueSchedulePut(uuid, tx)` prend l'exécuteur de l'appelant (type `Writer`,
  `@/db`). L'app tuée entre les deux laisserait un réalisé que rien ne signale
  comme non poussé — et le pull suivant l'effacerait sans un mot.
- **Une séance non confirmée par le serveur est intouchable.** « Non confirmée » =
  une mutation en file (épuisée comprise), ou commencée et pas terminée. Le pull
  lui applique la **programmation** et rien d'autre : ni le réalisé, ni
  `startedAt`/`endedAt`, ni `status`, ni la note de clôture.
- **`?since` prend `sync_state.serverTime`, jamais `lastPulledAt`.** Le premier
  est l'horloge du serveur, le second celle du téléphone ; s'en remettre au
  second ferait dépendre la synchro d'un désaccord de pendules.
- **Ouvrir une séance n'empile pas de mutation.** La règle précédente vaut pour
  le **réalisé** — une série cochée, une clôture. Poser `started_at` n'en est
  pas : rien n'a été fait, et le pull protège déjà par son second critère
  (« commencée et pas terminée »). Le contraire enverrait au calendrier web des
  séances ouvertes puis refermées à vide.
- **La programmation ne se modifie jamais depuis le téléphone.** Rattraper la
  veille consiste à **ouvrir** la séance d'hier, pas à la redater : `date`,
  `title` et `status` appartiennent au serveur, les bornes et le réalisé au
  téléphone.
- **Une série réalisée s'apparie à sa ligne prescrite par le RANG, dans deux
  files séparées** (échauffement, travail). Ce n'est pas un choix d'écran : le
  contrat ne transporte aucune référence de la série vers la ligne
  (`sourcePrescribedId` est sur l'exercice, `position` n'est pas envoyée), et
  c'est la règle que `LogComparator` tient déjà côté serveur — il ne peut pas y
  en avoir deux, sinon le téléphone et `/schedule/{id}` racontent deux histoires.
  **Corollaire : cocher est séquentiel** (première ligne non cochée de sa file,
  dernière cochée pour décocher). Détail dans `src/session/program.ts`.
- **On dévie, on ne recompose pas — et on ne dévie que sur ce qui a été FAIT.**
  Corriger une série, en ajouter, en supprimer, sauter, remplacer, ajouter un
  exercice : oui (`src/session/deviations.ts`). Réordonner un bloc, créer un
  superset, changer un tour : non, c'est le compositeur web. Et comme le prescrit
  ne bouge jamais, il n'existe **aucun endroit** où écrire une valeur revue avant
  la série : on coche aux valeurs prescrites, puis on corrige. Deux conséquences
  à ne pas défaire — le **type** d'une série ne s'édite pas (il décide de la file
  d'appariement, le changer déplacerait le rang de toutes les suivantes), et
  **supprimer** une série est plus permissif que la décocher (supprimer resserre
  la file, ça ne fait pas de trou).
- **Sauter, annoter et remplacer sont des DÉCLARATIONS**, pas des états dérivés :
  un exercice réalisé qui n'en porte aucune et n'a plus de série est nettoyé
  (« fait, zéro série » serait faux une fois poussé), un qui en porte une survit.
  Le remplacement est le cas piégeux — la base ne peut pas le voir seule, le
  prescrit vivant dans un document JSON — donc l'appelant le passe à
  `dropEmptyLoggedExercise`. Sans ça, décocher effacerait le remplacement en
  silence.
- **Les bornes du contrat se tiennent à l'écriture, jamais au push.** `reps`
  0-200, charge 0-1000, durée 0-86 400, RPE 1-10 (`boundSetValues`). Une valeur
  hors bornes ne serait refusée qu'au push, en `422`, sur un réalisé déjà
  consigné — et la file la marquerait au bout de cinq essais.

## 4. Conventions de rangement

- Racine du dépôt : `babel.config.js`, `metro.config.js` et `drizzle.config.ts`
  existent depuis KL-24 et n'ont qu'une raison d'être chacun (embarquer les `.sql`
  des migrations, les résoudre, les générer). Les créer implique de redéclarer ce
  qu'Expo appliquait par défaut : ne pas les vider.
- Route → `src/app/` (`expo-router`, une route = un fichier)
- Composant de base → `src/components/`. Un composant **propre à un écran**
  (bande de jours, carte de séance) reste dans le fichier de sa route : il
  n'entre dans `src/components/` que le jour où un deuxième écran l'emploie.
- Métier de séance → `src/session/` (démarrer, reprendre, et demain cocher,
  dévier, clôturer). Le module où `@/db` et `@/sync` se rencontrent pour le
  domaine, comme `src/sync/` est celui où `@/api` et `@/db` se rencontrent pour
  le transport.
- Thème et tokens → `src/theme/`
- Base locale, schéma et migrations → `src/db/`
- Client API → `src/api/`
- Moteur de synchronisation → `src/sync/` (le seul module où `@/api` et `@/db`
  se rencontrent durablement)
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

**KL-24 livré (03/08/2026)** : la base locale, dans `src/db/`, importée par
`@/db`. Huit tables (`exercise`, `exercise_history`, `scheduled_workout`,
`prescribed_snapshot`, `logged_exercise`, `logged_set`, `sync_state`,
`mutation_queue`), migrations générées par drizzle-kit et appliquées au
démarrage, UUIDv7 posés localement, jeu de démonstration injectable. Ce qu'il
pose et qu'il ne faut pas casser :

- **Le prescrit est un document, le réalisé est normalisé, et ce n'est pas une
  incohérence.** Le prescrit ne se recompose pas ici (règle verrouillée) et il est
  **remplacé en entier** à chaque pull, parce que sa fraîcheur n'est portée par
  aucune colonne côté serveur — `?since` n'allège que la bibliothèque. L'éclater
  en trois tables donnerait trois tables qu'on ne lirait qu'en bloc et qu'il
  faudrait rejoindre à chaque ouverture de séance. Le réalisé, lui, s'écrit série
  par série : il est normalisé et indexé. `prescribed_snapshot` est une table
  séparée et non une colonne de `scheduled_workout` : lister les séances du jour
  ne doit pas remonter le plus gros document de la base.
- **`exercise_history` n'est pas dans la liste du ticket, et elle est
  nécessaire.** Le bootstrap descend `history` précisément pour que la dernière
  perf et le record s'affichent **en séance, hors ligne** ; sans table, la réponse
  serait lue puis jetée et KL-32 supposerait du réseau — ce que le cadrage réserve
  au seul `GET /api/exercises/{id}/history`.
- **Pas de drapeau « modifié localement ».** Le fait est déjà porté par
  `mutation_queue`, et deux sources pour un seul fait finissent par se
  contredire. C'est ce qui rend l'ordre **push avant pull** non négociable : le
  pull remplace la fenêtre, une modification locale non poussée y serait effacée.
- **Trois `PRAGMA` et une option, posés à l'ouverture, et aucun n'est
  décoratif.** `foreign_keys = ON` — SQLite les désactive **par défaut**, sans lui
  les `ON DELETE CASCADE` du schéma ne feraient rien et supprimer une séance hors
  fenêtre laisserait son réalisé orphelin et jamais poussé. `journal_mode = WAL` —
  un push ne bloque plus les lectures, et « la synchronisation ne bloque jamais
  l'interface » est une exigence de KL-27. `enableChangeListener: true` —
  `openDatabaseSync` met ses connexions en cache par nom de fichier, l'activer
  plus tard demanderait une seconde connexion sur le même fichier.
- **`mutation_queue.id` est en `AUTOINCREMENT` au sens strict.** Sans lui SQLite
  réattribue le plus grand rowid libéré : après une purge, une mutation neuve
  passerait devant une plus ancienne. L'ordre de la file est le seul ordre qui
  existe.
- **Un `DELETE` qui vide une table entière doit porter une clause `WHERE`**
  (`wipe()` le fait, `sql`1 = 1``). Sans elle, SQLite applique son optimisation
  « truncate » — la table est vidée d'un bloc, sans visiter les lignes, et
  `sqlite3_update_hook` **n'est jamais appelé** : une vue montée sur
  `useLiveQuery` reste figée sur l'ancien contenu, sans erreur. Le piège ne
  touche que `mutation_queue` et `sync_state`, les deux seules tables sans
  aucune clé étrangère — donc précisément la file que l'écran de réglages
  (KL-35) voudra observer en direct. **Observé sur l'appareil** : après un
  vidage, la base était à zéro et le compteur affichait encore 1.
- **`sync_state` est un singleton garanti par la base** (`CHECK (id = 1)`), pas
  par une intention du code, et tout y passe par `getSyncState` /
  `patchSyncState`. Elle porte aussi `apiUrl` : l'URL du serveur vient du QR
  (KL-48) et doit survivre au redémarrage — le **jeton**, lui, n'entre jamais en
  base (`expo-secure-store`, KL-25).
- **L'UUIDv7 a un compteur monotone dans la milliseconde**, pas seulement un
  préfixe temporel : une clôture qui écrit tout un exercice d'un coup produirait
  sinon des identifiants dont l'ordre est décidé par l'aléa. Vérifié sur 10 000
  tirages — tous uniques, ordre de génération = ordre lexicographique.
- **`nowIso()` pour un instant, `localDate()` pour une date de calendrier.**
  `toISOString().slice(0, 10)` est le piège que `localDate` existe pour fermer :
  une séance de 23 h à Lyon appartient au jour affiché par le téléphone, pas à
  celui de Greenwich.
- **`seedDemo()` est gardée par `__DEV__` et lève en production** : de fausses
  séances injectées dans le réalisé partiraient au serveur au push suivant. Son
  jeu est daté **relativement à aujourd'hui** — figé, il sortirait de la fenêtre
  J-30 → J+14 en un mois et « Aujourd'hui » se viderait sans qu'on comprenne
  pourquoi. Elle **ne pose ni `serverTime` ni `lastPulledAt`** : ce sont les
  marques d'un bootstrap réussi, et les écrire ferait demander un _delta_ au
  premier vrai pull sur une base qui ne contient que huit exercices fabriqués —
  le serveur n'allège que la bibliothèque, l'historique et la fenêtre de séances
  partent en entier, donc la transaction du pull échouait sur une contrainte de
  clé étrangère sans pouvoir se rattraper. **Observé sur l'appareil**
  (03/08/2026), corrigé. Elle **préserve `apiUrl`** au passage : `wipe()` emporte
  `sync_state`, et perdre l'URL de l'appairage pour avoir injecté des séances de
  test déconnecterait l'app au lancement suivant.
- **`metro.config.js` pousse `wasm` dans `assetExts`** uniquement pour que
  `expo export -p web` continue de passer : le portage web d'`expo-sqlite`
  importe un `.wasm`. L'app ne cible toujours pas le web — la base s'y charge, elle
  ne s'y lance pas.
- **Vérification** : `npm run typecheck`, `npm run lint`, `npx prettier --check .`,
  `npx expo export` pour Android **et** web, le schéma généré passé dans un vrai
  `sqlite3` (cascade, `CHECK` du singleton, refus d'une FK orpheline,
  `AUTOINCREMENT` après purge), le générateur d'UUID exécuté hors React Native
  (10 000 tirages), et surtout **l'app lancée sur le téléphone** : migrations
  appliquées, WAL actif, cycle vider → injecter → vider vérifié à l'écran **et**
  dans le fichier extrait par `adb`. C'est ce dernier contrôle qui a fait sortir
  le piège du `DELETE` sans `WHERE` — aucun des autres ne pouvait le voir.
  Rappel d'environnement : le build Gradle demande la **JDK 21** de
  `.java-version` ; un `JAVA_HOME` pointant une JDK plus récente échoue sur
  `react-native-worklets` avec « a restricted method in java.lang.System has been
  called », ce qui ne ressemble en rien à un problème de version.

**KL-25 livré (03/08/2026)** : le client API, dans `src/api/`, importé par
`@/api`. Un `request()` unique (timeout, rejeu, `401`), le jeton dans
`expo-secure-store`, la session en magasin de module, dix endpoints typés, et le
garde de navigation du layout racine. Ce qu'il pose et qu'il ne faut pas casser :

- **Le rejeu se décide sur la méthode, jamais sur le résultat.** `GET`, `PUT` et
  `DELETE` sont idempotents par construction dans cette API et se rejouent trois
  fois, avec un délai qui double et une gigue de ±25 %. Un `POST` ne se rejoue
  **pas** : un `login` dont la réponse s'est perdue a peut-être abouti, et le
  rejouer émettrait un second jeton que personne ne détient — un appareil
  fantôme dans `/profile/settings`, vivant 90 jours.
- **Un `429` n'est pas rejoué automatiquement**, bien qu'il soit passager. Le
  `Retry-After` va jusqu'à ~60 s sur la connexion : dormir une minute dans un
  appel fige l'interface sans rien à montrer et recharge le compteur du
  limiteur. L'échéance remonte à l'appelant en `retryAfterSeconds`.
- **Un échec se lit par sa classe, jamais par son message.** `NetworkError`,
  `TimeoutError`, `ApiError` — et `isTransient()`, qui répond à la seule question
  que se pose la file de mutations. Le contrat interdit explicitement d'analyser
  `detail`, qui change sans préavis.
- **Un appel authentifié sans jeton ne part pas** : il ferme la session sur place
  et lève un `401` local. Le laisser partir nu le ferait échouer en
  `NetworkError` hors réseau, donc en « réessaie plus tard », et la session
  resterait ouverte sans jeton indéfiniment.
- **Le `401` purge, le garde redirige.** `Stack.Protected` **retire** l'écran de
  la pile au lieu de rendre une redirection : le routeur retombe seul sur
  `login`. Aucun écran n'a donc à intercepter d'erreur d'authentification, et il
  n'existe pas de chemin où l'on reste sur une séance avec un jeton mort.
- **La session est un magasin de module, pas un contexte React** : le transport
  et, demain, le moteur de synchronisation la lisent quand aucun écran n'est
  monté. Trois états et non deux — sans `unknown` le temps que le trousseau
  réponde, le premier rendu se confondrait avec « déconnecté » et l'écran de
  connexion clignoterait à chaque lancement. C'est pour ça que l'écran de
  démarrage reste levé jusqu'à `restoreSession()`.
- **`useSession()` ne rend jamais le jeton** ; seul `currentToken()`, réservé au
  transport, le donne. Ce qu'on ne passe pas en props ne finit pas dans un
  journal de rendu.
- **`requireAuthentication` du magasin sécurisé est refusé.** Le jeton est lu par
  **chaque** requête, y compris par un push qui tourne barre en main : une
  empreinte à ce moment-là rendrait la synchronisation impossible. Ce qui protège
  ici, c'est le chiffrement au repos par l'Android Keystore.
- **L'URL du serveur est injectée, pas lue en base.** Elle vit dans
  `sync_state.apiUrl`, mais un client HTTP n'a pas à ouvrir SQLite pour savoir où
  appeler : le layout racine la pose au démarrage, seul endroit où `@/api` et
  `@/db` se rencontrent. Corollaire : `setApiBaseUrl()` ne persiste rien, qui la
  change écrit aussi `sync_state`.
- **`signOut` efface le jeton local même si la révocation échoue** : se
  déconnecter hors réseau doit déconnecter. Un `DELETE` qui rend `404` est un
  **succès** (le contrat le dit), sinon une mutation dont la réponse s'est perdue
  bloquerait la file pour toujours.
- **`src/app/login.tsx` est une coquille assumée**, née de « un 401 renvoie vers
  l'écran de connexion » : il fallait une destination. Elle ne porte que le repli
  mot de passe et n'anticipe rien de **KL-26**, qui la remplace (QR en primaire,
  code en secondaire, mot de passe en dernier).
- **Vérification** : `npm run typecheck`, `npm run lint`, `npx prettier --check .`,
  `npx expo export` pour Android **et** web, puis deux bancs d'essai hors React
  Native — `src/api` bundlé pour Node, `expo-secure-store` et `expo-device`
  bouchonnés. Le premier (21 contrôles) exerce le transport contre un serveur
  HTTP local : tentatives par méthode, croissance du délai, timeout, annulation,
  `Retry-After`, corps illisible, `204`, purge sur `401` et **absence** de purge
  sur un `401` non authentifié. Le second (15 contrôles) fait tourner le vrai
  client contre le vrai Symfony : bootstrap complet et delta, upsert `201` puis
  rejeu `200` sans duplication, `422` avec le chemin du champ, et un jeton
  révoqué de l'extérieur qui purge le trousseau.

**KL-26 livré (03/08/2026)** : l'écran de connexion. Trois routes dans
`src/app/` (`login.tsx`, `pairing.tsx`, `login-password.tsx`), toutes trois
dans le groupe `Stack.Protected guard={!signedIn}` du layout racine. Ce qu'il
pose et qu'il ne faut pas casser :

- **`login.tsx` est un écran de choix, plus un formulaire.** Trois actions
  hiérarchisées : « Scanner le QR » (primaire), « Saisir le code »
  (secondaire), « Email et mot de passe » (dernier repli, sans lien
  d'inscription). Les deux premières poussent vers `pairing.tsx` : sans
  `expo-camera` (réservé à KL-48), rien ne les distingue encore, et cet écran
  n'implémente que la saisie manuelle du code de 8 caractères
  (`signInWithPairingCode`, déjà posé par KL-25). KL-48 **complète**
  `pairing.tsx` d'une caméra, il ne le remplace pas — le champ manuel y reste
  le repli.
- **`SessionState` gagne un quatrième champ, `awaitingFirstSync`, pas un
  quatrième statut.** `openSession` (un `login`/`pair` frais) le pose à `true` ;
  `restoreSession` le pose à `false` dans ses deux branches. C'est ce deuxième
  point qui compte : une session **restaurée** au lancement ne repasse pas par
  l'écran de bootstrap, parce que sa base locale porte déjà le dernier pull —
  l'y forcer à chaque ouverture contredirait le hors-ligne. Rafraîchir une
  session restaurée reste le travail du déclenchement « au lancement » que
  KL-27 posera sur le moteur de synchronisation, pas de cet écran. Le layout
  racine lit ce champ pour ajouter une troisième branche au garde
  (`Stack.Protected guard={signedIn && session.awaitingFirstSync}` →
  `bootstrapping.tsx`), entre `signedIn` et `!signedIn`.
- **`bootstrapping.tsx` ne persiste pas la réponse du bootstrap.** Il appelle
  `GET /api/bootstrap` (sans `since`) pour deux raisons seulement — valider que
  le serveur répond, tenir « état de chargement honnête » — puis referme le
  garde avec `completeFirstSync()` sans toucher à `@/db`. Écrire le document
  en base, en transaction, en tenant `sync_state` (fenêtre, `lastPulledAt`) est
  le rôle déclaré de **KL-27**, qui en sera le seul écrivain : le dupliquer ici
  referait ce travail hors de ses garanties transactionnelles. Un échec
  n'enferme pas l'utilisateur : « Réessayer » relance le même appel,
  « Continuer sans mes séances » referme le garde quand même — la base locale
  reste vide jusqu'au prochain pull, mais l'app reste utilisable.
- **Vérification** : `npm run typecheck`, `npm run lint`,
  `npx prettier --check .`, `npx expo export` pour Android et pour web (quatre
  routes statiques rendues : `/login`, `/pairing`, `/login-password`,
  `/bootstrapping`). Pas de contrôle sur un vrai téléphone à ce stade : rien
  ici n'exerce `expo-secure-store` au-delà de ce que KL-25 avait déjà vérifié,
  et il n'y a pas de caméra à tester avant KL-48.

**KL-48 livré (03/08/2026)** : `pairing.tsx` complète l'écran d'un lecteur de QR
(`expo-camera`), sans le remplacer. Ce qu'il pose et qu'il ne faut pas casser :

- **La permission se demande après explication, jamais au montage.**
  `useCameraPermissions` sert de garde d'affichage : tant que
  `permission.granted` est faux, l'écran montre pourquoi la caméra sert et un
  bouton `requestPermission()`. `permission.canAskAgain === false` (refus
  définitif) bascule sur un renvoi vers les réglages Android
  (`Linking.openSettings()`) — c'est la seule issue, Android ne redemande
  jamais après un second refus.
- **`signInWithPairingQr` (nouveau, `src/api/auth.ts`) pose l'URL de base
  _avant_ l'échange, et la remet à sa valeur précédente si l'appel échoue par
  réseau ou délai** (`NetworkError` / `TimeoutError`) — un QR qui pointe vers un
  serveur injoignable ne doit pas stranger la saisie manuelle de repli sur une
  URL morte pour le reste de la session. Un refus **du serveur** (code expiré
  ou déjà consommé) ne revert pas l'URL : le serveur a répondu, elle est donc
  bonne.
- **`src/api` ne connaît toujours pas `@/db`.** `signInWithPairingQr` retourne
  l'`apiUrl` scannée sans l'écrire ; c'est l'écran d'appairage, seul point qui
  connaît les deux couches (même statut que `_layout.tsx` pour la restauration
  du jeton), qui appelle `patchSyncState({ apiUrl })` **après** un succès —
  `sync_state.apiUrl` a désormais son seul écrivain, comme prévu par
  `src/db/syncState.ts`.
- **Le corps du QR se valide en pur, sans réseau ni état** :
  `parsePairingQrPayload` (`src/api/pairingQr.ts`) vérifie juste la forme
  (`{url, code, exp}`, trois chaînes) et lève `InvalidPairingQrError` sinon —
  jamais un `JSON.parse` qui remonte tel quel. `exp` n'est **pas** revérifiée
  côté client : la comparer à l'horloge du téléphone ferait dépendre le
  verdict d'un désaccord d'horloge, alors que le serveur est déjà seul maître
  de l'échéance à l'échange, et « inconnu / expiré / déjà consommé » rendent le
  même message par construction (`docs/api-mobile.md §3.1`) — dupliquer la
  vérification ici aurait donné deux verdicts possibles pour un même code.
- **Une erreur, un seul emplacement.** Scan et saisie manuelle partagent le
  même état d'erreur, affiché une fois en tête de l'écran plutôt que dupliqué
  sous chaque chemin : le serveur ne distingue pas leur origine, l'écran non
  plus.
- **Aucune trace du code ou du jeton.** `signInWithPairingCode` (KL-25/26) fait
  déjà tout le travail sensible ; ce ticket ne fait qu'y amener le code lu par
  la caméra, sans jamais le journaliser ni le poser ailleurs qu'en mémoire le
  temps de l'appel.
- **Vérification** : `npm run typecheck`, `npm run lint`,
  `npx prettier --check .`, `npx expo export` pour Android et pour web.
  **Build natif sur appareil non concluant** : `expo run:android` sur un
  Pixel réel échoue à la compilation Kotlin de `expo-dev-menu` et
  `expo-log-box` (`Unresolved reference 'ReactActivityLifecycleListener'`, et
  consorts) — **confirmé préexistant et sans rapport avec ce ticket** en
  rejouant le même build sur l'état d'avant KL-48 (sans `expo-camera`) :
  échec identique. C'est un problème de toolchain (Kotlin/AGP/RN) à
  diagnostiquer séparément, pas un défaut de l'écran de scan.

**KL-27 livré (03/08/2026) — le lot 3 est clos.** Le moteur de synchronisation,
dans `src/sync/`, importé par `@/sync`. Un cycle **push puis pull**, un seul à la
fois, qui ne lève jamais et ne retient aucun écran. Ce qu'il pose et qu'il ne
faut pas casser :

- **L'ordre push → pull est la moitié du ticket.** Le pull remplace la fenêtre de
  séances datées (§4.5 du contrat) : lancé en premier, il écraserait la séance du
  matin pas encore envoyée, et il n'y a rien à consulter pour savoir laquelle —
  c'est `mutation_queue` qui porte le fait « modifié localement ». Il n'existe
  donc pas de fonction « pull seul » exportée.
- **Une séance non confirmée par le serveur est intouchable, et ça fait deux
  cas** : une mutation en file (**épuisée comprise**), ou une séance commencée et
  pas terminée. Le second est de la ceinture par-dessus les bretelles — KL-29
  empilera une mutation dès la première série cochée, mais une séance ouverte
  dont rien n'a été coché n'en a pas. Sur une séance protégée, le pull applique
  la **programmation** (date, titre, plan, blocs : le coach a pu corriger) et
  **rien d'autre**. Écraser `status` serait le pire des trois : le document relu
  au push suivant repartirait en `planned`, et la clôture serait perdue au moment
  même où on l'envoie.
- **Le compteur d'échecs ne compte que les refus du serveur.** Réseau absent,
  délai, `429`, `5xx` : le cycle s'arrête, `lastError` s'affiche, `attempts` ne
  bouge pas — le sous-sol d'une salle est le cas nominal, y épuiser une mutation
  valide afficherait une panne là où il n'y a qu'un mur de béton. Un refus
  définitif (`409`, `422`, `403`) compte **et** laisse passer la suivante : le
  problème est dans ce document-là. Une mutation marquée n'est jamais supprimée —
  elle sort du dépilage, attend un geste humain (KL-35), et continue de protéger
  sa séance.
- **`?since` envoie `serverTime`, pas `lastPulledAt`** (le ticket disait le
  second, le contrat le premier, §6.5). L'un est l'horloge du serveur, l'autre
  celle du téléphone : trente secondes de désaccord suffiraient à sauter un
  exercice modifié entre deux appels.
- **`deleted.schedule` n'est pas appliqué, `deleted.exercises` si.** `?since`
  n'allège **que** la bibliothèque : son jeu est partiel, d'où la liste des
  disparus. La fenêtre de séances datées part toujours entière — « absente du jeu
  reçu » suffit, et cette purge est ce qui borne la base (sans elle, chaque jour
  qui passe y laisserait une séance de plus).
- **Un exercice supprimé côté serveur survit localement s'il est référencé par un
  réalisé non confirmé.** `exercise_id` est en `SET NULL` : le supprimer viderait
  la référence, et le document poussé ensuite sortirait de l'historique et des
  records sans rien signaler.
- **L'historique saute les exercices que la base locale ne connaît pas.** C'est
  la seule asymétrie de la réponse qui puisse blesser : `?since` allège la
  bibliothèque et **n'allège pas** l'historique, qui porte sur la bibliothèque
  entière. Un delta reçu sur une base dont `exercise` n'est pas un sur-ensemble
  de ce que le serveur voit ferait échouer l'insertion sur la clé étrangère —
  donc tomber **tout** le pull, à chaque tentative, sans que le `since` avance
  jamais. Sauter est gratuit ici, et c'est ce qui le distingue du réalisé : la
  table est un cache d'affichage rebâti en entier au pull suivant, et l'entrée
  écartée l'est pour un exercice qu'aucun écran ne peut afficher. **Limite
  connue, non traitée** : `logged_exercise.exercise_id` a le même problème (un
  exercice perso de coach, loggé, puis relation terminée — le serveur envoie
  l'id, la bibliothèque visible ne le contient plus) et la même tolérance n'y
  serait **pas** gratuite, un `exercise_id` nul remontant au push ferait perdre
  au serveur sa propre référence (`document.ts`). La sortie propre est de retirer
  cette clé étrangère par une nouvelle migration : une FK vers un cache partiel
  est une erreur de catégorie. À traiter avec KL-35.
- **Le document se relit en base au moment du push**, jamais figé dans la file :
  c'est ce qui permet à dix modifications de ne produire qu'un envoi, et à une
  série ajoutée après l'enfilement de partir quand même.
- **`bootstrapping.tsx` (KL-26) persiste enfin ce qu'il descend** : il passe par
  `syncNow('first-sync')` au lieu d'un `bootstrap()` sans suite. Le moteur reste
  le seul écrivain de `sync_state`.
- **Vérification** : `npm run typecheck`, `npm run lint`,
  `npx prettier --check .`, `npx expo export` pour Android et web, plus un banc
  d'essai de **55 contrôles contre le vrai Symfony** — `src/sync` bundlé pour
  Node, `expo-sqlite` posé sur `node:sqlite`. Il exerce la protection, la
  coalescence, l'ordre, le rejeu sans doublon, le réseau coupé, le `422` qui
  compte, les cinq refus et le réarmement. **Pas de contrôle sur appareil** : le
  build natif reste bloqué par le problème de toolchain Kotlin/AGP de KL-48
  (préexistant). Le moteur n'a donc pas encore vu de vraies bascules d'`AppState`
  ni d'`expo-network` ; la carte « Synchro » de `src/app/index.tsx` est là pour
  ça.

**KL-28 livré (04/08/2026) — le lot 4 est ouvert.** L'écran « Aujourd'hui »
(`src/app/index.tsx`) et le module `src/session/`, importé par `@/session`. Ce
qu'ils posent et qu'il ne faut pas casser :

- **`src/session/` existe parce que le domaine n'est ni du stockage ni du
  transport.** « Démarrer une séance » veut dire : poser `started_at`, pas le
  statut ; refuser une séance close (§2.3 point 5) ; faire naître une séance libre
  à la date du jour avec un uuid posé localement. Ni `@/db` ni `@/sync` ne
  connaissent ces règles, et un écran qui les porterait les rendrait invisibles au
  suivant. Cinq fichiers, et c'est là que KL-29, KL-30 et KL-33 poseront cocher,
  dévier et clôturer.
- **Ouvrir n'empile pas de mutation** (cf. §3). Vérifié dans les deux sens contre
  la vraie fonction de pull : un bootstrap qui ignore la séance libre locale ne
  l'emporte pas, un bootstrap qui renvoie la séance programmée avec
  `startedAt: null` ne l'écrase pas.
- **Reprendre est idempotent.** `beginWorkout` ne réécrit pas `started_at` s'il
  est déjà posé — sinon la durée de la séance repartirait de zéro à chaque retour
  sur l'écran, et c'est elle que KL-33 affichera au résumé.
- **La sélection du jour est un écart, pas une date.** L'état de l'écran est
  `offset ∈ [-2, +2]` ; le jour s'en déduit. Une app laissée en arrière-plan
  rouvre le lendemain : avec une date absolue, « Aujourd'hui » afficherait hier.
  `useToday()` relit la date locale au retour au premier plan, et c'est le seul
  état à tenir.
- **Les dates de `days.ts` se parsent à midi**, jamais à minuit : un changement
  d'heure appliqué à minuit peut faire basculer la date d'un jour. Les libellés
  français sont écrits à la main, sans `Intl` — la présence d'ICU dépend de la
  variante d'Hermes embarquée, et un repli silencieux donnerait « Tuesday ».
- **Aucune lecture d'écran ne touche `prescribed_snapshot`.** C'est l'invariant de
  KL-24 : lister un jour ne remonte pas le plus gros document de la base.
  Conséquence assumée — une carte ne peut pas annoncer « 5 exercices » avant
  l'ouverture, et le compter demanderait `json_extract` / `json_array_length`,
  donc l'extension json1 sur tous les Android visés.
- **`useLiveQuery` n'écoute que la table du `from`**, pas les tables jointes
  (vérifié dans son implémentation). Le `from` de chaque requête de
  `session/queries.ts` est choisi pour ça : le compte de séries part de
  `logged_set`, pas de `scheduled_workout`.
- **Un seul bouton primaire par écran**, et c'est le plus urgent : reprendre s'il
  y a une séance ouverte, sinon démarrer la première séance actionnable du jour.
  La bande de jours n'est pas un `Chip` (qui ne se tape pas, KL-23) mais un
  contrôle avec son plancher tactile.
- **`src/app/session/[uuid].tsx` est une coquille assumée**, née de « Démarrer a
  besoin d'une destination » — même statut que `login.tsx` en KL-25. Elle montre
  que la séance est ouverte et rien de plus : KL-29 la remplit, une
  demi-implémentation du déroulé serait à défaire.
- **`src/app/diagnostics.tsx` est l'ancien écran d'accueil**, déplacé pour que
  « Aujourd'hui » prenne la route `index`. Il n'est pas supprimé parce qu'il porte
  encore la **seule déconnexion de l'app** et les seuls contrôles qui ne
  s'observent que sur un appareil. KL-35 le remplace.
- **Vérification** : `npm run typecheck`, `npm run lint`,
  `npx prettier --check .`, `npx expo export` pour Android et web (neuf routes
  statiques), plus un banc d'essai de **44 contrôles hors React Native** —
  `src/session` bundlé pour Node, `expo-sqlite` posé sur `node:sqlite`, la vraie
  migration appliquée. **Pas de contrôle sur appareil** : le build natif reste
  bloqué par le problème de toolchain Kotlin/AGP de KL-48 (préexistant). Le rendu,
  les cibles tactiles de la bande de jours et la bascule de minuit n'ont donc pas
  été vus sur un vrai téléphone.

**KL-29 livré (04/08/2026)** : l'écran « Séance en cours »
(`src/app/session/[uuid].tsx`), et trois fichiers de plus dans `src/session/` —
`program.ts` (le croisement prescrit × réalisé, **pur**), `log.ts` (les trois
écritures), `labels.ts` (le vocabulaire français des enums). Ce qu'ils posent et
qu'il ne faut pas casser :

- **L'appariement par rang en deux files est la décision du ticket** (cf. §3). Le
  cochage séquentiel en découle, il ne le précède pas. Vérifié dans les deux sens :
  un réalisé revenu du serveur avec ses positions renumérotées à partir de 0 se
  relit exactement aux mêmes lignes.
- **`prescribed_snapshot` se lit ici et nulle part ailleurs.** L'invariant de
  KL-24 interdit de remonter le plus gros document de la base pour _lister_ un
  jour ; il n'a jamais interdit de le lire pour _dérouler_ une séance, ce qui est
  la seule raison pour laquelle la table est séparée.
- **Trois lectures vives, pas une jointure.** `useLiveQuery` n'écoute que la table
  du `from` : programme, exercices réalisés et séries sont trois requêtes sur
  trois tables. Une jointure unique n'aurait été republiée que par sa table de
  tête, et le déroulé serait resté figé sur les deux autres — sans erreur.
- **Cocher écrit la série ET empile la mutation dans la même transaction**
  (`log.ts`), et une seule par séance : la file est coalescée par uuid, dix séries
  cochées ne font qu'un envoi.
- **Décocher supprime aussi l'exercice réalisé devenu vide** (plus de série,
  aucune note, non sauté — les deux dernières sont des _déclarations_, on ne les
  efface pas), **et empile quand même la mutation** : `log: []` est ce qui efface
  le réalisé côté serveur.
- **Un réalisé sans rattachement vaut mieux qu'une série perdue.**
  `logged_exercise.exercise_id` porte une FK active : un exercice absent de la
  bibliothèque locale ferait échouer l'insertion. Le repli met `exerciseId` à
  `null` et garde le nom. Même problème que celui rencontré par KL-27 dans l'autre
  sens, même sortie propre (retirer la FK, avec KL-35).
- **« On ne consigne que dans une séance ouverte » est une garde du domaine**, pas
  de l'écran : les trois écritures la franchissent dans leur transaction. Close,
  on n'écrit plus (pas de reprise après clôture) ; pas commencée, non plus — le
  pull ne protégerait même pas la séance, faute de `started_at`.
- **La progression compte des gestes, pas du volume** : l'échauffement entre dans
  le total — contrairement au tonnage et aux records, où il est exclu partout — un
  cardio compte pour une unité, un exercice sauté sort du dénominateur.
- **Le réalisé que le programme ne réclame pas est affiché, pas ignoré** (séries
  surnuméraires à la suite, exercices en « Hors programme »). KL-29 n'en crée
  aucun ; le pull, lui, peut en descendre.
- **`src/components/units.ts`** est le pendant natif d'`UnitFormatter` : une
  charge et une durée se lisent à l'identique ici et sur `/schedule/{id}`. Il est
  dans `components/` et non dans `session/` parce que décider de ce qui est fait
  est du domaine, et écrire « 82,5 kg » est du rendu — et parce que le rendu
  français des nombres y vivait déjà (`formatNumber`).
- **Toujours pas d'icônes** : la case à cocher est un carré au filet qui se
  remplit à l'encre. La ligne entière est la cible tactile, la case n'est qu'un
  repère.
- **Vérification** : `npm run typecheck`, `npm run lint`,
  `npx prettier --check .`, `npx expo export` pour Android et web, plus un banc
  d'essai de **97 contrôles hors React Native** (appariement, groupes de superset
  et leur contiguïté, coalescence, refus d'une ligne hors tour, cardio, repli sur
  bibliothèque incomplète, document poussé, protection du pull, aller-retour
  serveur).
- **Le build natif repasse.** `npm run android` a produit `app-debug.apk` et
  installé `fr.antoninpamart.kadens` sur un appareil réel : l'échec de compilation
  Kotlin d'`expo-dev-menu` / `expo-log-box`, constaté en KL-48 et rejoué en KL-27
  et KL-28, **ne s'est pas reproduit**. Cette limite est donc levée pour les
  tickets suivants. **Le rendu, lui, n'a pas été observé** : le téléphone était en
  cours d'utilisation. Les cibles tactiles, la densité des lignes de série et la
  lisibilité à bout de bras restent à valider à l'œil.

**KL-30 livré (04/08/2026)** : les déviations en séance. Trois fichiers de plus
dans `src/session/` — `deviations.ts` (les sept écritures du ticket), `writes.ts`
(les gardes et briques que `log.ts` et `deviations.ts` partagent), `library.ts`
(la recherche dans la bibliothèque locale, pure) — et les trois feuilles de
l'écran de séance. Ce qu'ils posent et qu'il ne faut pas casser :

- **On ne dévie que sur ce qui a été fait** (cf. §3). L'écran en tire sa forme :
  une ligne **non cochée** coche d'un appui n'importe où (la grande cible de
  KL-29) ; une ligne **cochée** offre deux cibles, chacune au plancher tactile —
  la zone de valeurs ouvre la feuille d'ajustement, la case décoche. L'appui long
  a été écarté : un geste qui ne se voit nulle part se découvre par accident, et
  l'app n'aura jamais de tutoriel.
- **Le remplacement conserve `sourcePrescribedId`**, et c'est ce qui le distingue
  d'un ajout : `/schedule/{id}` lit « prévu X, fait Y » au lieu d'un trou d'un
  côté et d'un intrus de l'autre. Il est **refusé dès qu'une série est
  consignée** — elle a été faite sur l'exercice d'origine, la rattacher à un
  autre la ferait entrer dans l'historique et les records de la mauvaise machine.
  Le chemin pour ce cas-là : sauter avec sa raison, puis ajouter hors programme.
- **Un seul type d'exercice, prescrit ou non.** `SessionExtra` a disparu,
  `SessionExercise.prescribed` est nullable (jamais nul en même temps que
  `logged`). Un second type aurait voulu dire un second composant d'affichage, un
  second chemin d'écriture et une seconde façon de compter, pour la même chose.
  Un exercice **hors programme n'entre pas dans la progression** : elle dit ce
  qu'il reste à faire du programme.
- **La raison d'un saut et la note d'exercice sont le même champ** (`notes`) : le
  modèle n'en a qu'un, en inventer un second donnerait un texte que le serveur ne
  saurait pas où mettre. Ne plus sauter ne l'efface donc pas.
- **`session/library.ts` replie les accents à la main**, sans `String.normalize`
  ni `localeCompare` : le `LIKE` de SQLite n'ignore la casse qu'en ASCII
  (« developpe » ne trouverait pas « Développé couché »), et ICU dépend de la
  variante d'Hermes embarquée — même arbitrage que les noms de jours de `days.ts`.
  Chaque mot doit se retrouver dans le nom, dans n'importe quel ordre. **KL-34 la
  réutilisera** telle quelle, et c'est le jour où le sélecteur d'exercice montera
  dans `@/components`.
- **Les feuilles retiennent une clé, jamais l'objet** (`openSet` = l'uuid de la
  série, `openExercise` = la clé de l'exercice) : chaque écriture republie le
  déroulé, un objet figé dans un état de composant décrirait la séance telle
  qu'elle était avant le dernier appui. D'où `findSetLine` / `findExercise`.
- **Tout tient dans `src/app/session/[uuid].tsx`** parce qu'`expo-router` charge
  **tout** fichier de `src/app/` comme une route (son `require.context` n'exclut
  que `+html`, `+api` et `+middleware`) : un voisin `_parts.tsx` deviendrait une
  route fantôme, rendue par `expo export`.
- **Vérification** : `npm run typecheck`, `npm run lint`,
  `npx prettier --check .`, `npx expo export` pour Android et web (neuf routes,
  aucune fantôme), plus **123 contrôles hors React Native** (`src/session` bundlé
  pour Node, `expo-sqlite` posé sur `node:sqlite`, vraie migration) et **23
  contrôles contre le vrai Symfony**. Ce sont les premiers qui ont trouvé le
  défaut du remplacement effacé par un décochage ; ce sont les seconds qui
  confirment que le serveur accepte un remplacement, un exercice sans lien, une
  série surnuméraire et un saut sans série. **Rendu non observé sur appareil** :
  les deux cibles d'une ligne cochée, le prévu affiché à côté du saisi et la
  feuille d'ajustement restent à valider à l'œil.

Prochain ticket : **KL-31** (timer de repos, veille écran, notification).
