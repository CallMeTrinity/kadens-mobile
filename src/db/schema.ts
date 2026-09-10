import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import type {
  ActivityType,
  BodySilhouette,
  ExerciseLanguage,
  MutationPayload,
  MutationType,
  PerformanceBest,
  PerformanceSession,
  PlanRef,
  PrescribedBlock,
  ScheduledStatus,
  SetType,
  TargetArea,
  ThemePreference,
} from './types';

/**
 * Le schéma de la base locale (KL-24).
 *
 * C'est le miroir de `docs/feature-live-tracking.md §2.2` et de la charge utile
 * de `GET /api/bootstrap` : ce que l'app fait hors réseau, elle le fait sur ce
 * qu'elle a descendu ici.
 *
 * ## Les trois partis pris qui expliquent la forme
 *
 * **1. Le prescrit est stocké en un document, le réalisé est normalisé.**
 * Le prescrit ne se recompose pas sur le téléphone — c'est une règle verrouillée
 * (« en séance on dévie, on ne recompose pas ») — et il est **remplacé en entier**
 * à chaque pull, parce que sa fraîcheur n'est portée par aucune colonne côté
 * serveur : `?since` n'allège que la bibliothèque, la fenêtre de séances datées
 * part toujours entière. L'éclater en `block` / `prescribed_exercise` /
 * `prescribed_set` donnerait trois tables qu'on ne lirait qu'en bloc, qu'on
 * n'écrirait qu'en bloc, et qu'il faudrait rejoindre à chaque ouverture de
 * séance. `prescribed_snapshot` porte donc `blocks` en JSON : une ligne, un
 * document, un remplacement atomique. Le réalisé, lui, s'écrit série par série
 * pendant une séance — il est normalisé, indexé, et c'est la seule partie de la
 * base que le téléphone modifie.
 *
 * **2. Les identifiants ne se réinventent pas.** `exercise.id` est
 * l'identifiant **serveur** (séquentiel), `scheduled_workout.uuid` et
 * `logged_set.uuid` sont des UUIDv7 posés par le **client** (`uuid.ts`). Un
 * identifiant local en plus, sur ces trois tables, obligerait à tenir une table
 * de correspondance et ferait perdre l'idempotence de `PUT /api/schedule/{uuid}`.
 * Seuls `logged_exercise` et `mutation_queue`, que le serveur n'adresse jamais
 * par identifiant, ont une clé locale auto-incrémentée.
 *
 * **3. Les horodatages sont du texte ISO 8601 en UTC**, jamais un entier epoch.
 * C'est ce que l'API rend, c'est ce qu'elle accepte, et le stocker verbatim
 * supprime deux conversions et le fuseau qui se perd entre les deux. Rappel de
 * la limite serveur (§KL-19) : un décalage non nul est relu comme si l'heure
 * murale était de l'UTC. **Tout part en `…Z`** (`time.ts`).
 *
 * ## Ce qui n'est pas ici, et pourquoi
 *
 * Pas de drapeau « modifié localement » sur `scheduled_workout`. Ce fait est
 * déjà porté par `mutation_queue` — une séance en attente de push y a sa ligne —
 * et deux sources pour un seul fait finissent par se contredire. C'est ce qui
 * rend l'ordre « push avant pull » (§4.5 de `docs/api-mobile.md`) non
 * négociable : le pull **remplace** la fenêtre, une modification locale non
 * poussée y serait effacée.
 */

// --- La bibliothèque ---------------------------------------------------------

/**
 * La bibliothèque visible : la sienne, la globale, celle de ses coachs et de ses
 * athlètes acceptés. C'est la seule table que `?since` allège.
 *
 * `id` est l'identifiant **serveur** : la table n'est jamais alimentée
 * localement, le téléphone ne crée pas d'exercice.
 */
export const exercise = sqliteTable('exercise', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  /**
   * Le nom anglais. **Nul quand le français EST déjà l'anglais** (« Dips »,
   * « Fartlek ») : c'est une donnée métier, pas une traduction, et un doublon à
   * l'identique serait du bruit dans la recherche.
   *
   * Les deux noms sont stockés, jamais un seul : la langue est une préférence
   * de compte qui peut changer entre deux pulls, alors que `?since` n'allège
   * la bibliothèque que de ce qui a bougé. Ne garder que le libellé courant
   * laisserait toutes les autres lignes figées dans l'ancienne langue.
   */
  nameEn: text('name_en'),
  description: text('description'),
  activity: text('activity').$type<ActivityType>().notNull(),
  /** Liste de `TargetArea`. Toujours un tableau, jamais `null` — l'API garantit `[]`. */
  targetAreas: text('target_areas', { mode: 'json' })
    .$type<TargetArea[]>()
    .notNull()
    .default(sql`'[]'`),
  mediaUrl: text('media_url'),
  /** `true` = exercice de l'app. Le téléphone ne modifie rien, il distingue à l'affichage. */
  global: integer('is_global', { mode: 'boolean' }).notNull().default(false),
  /** La valeur même sur laquelle porte le delta : ce qu'on relit est ce que le serveur a comparé. */
  updatedAt: text('updated_at'),
});

/**
 * Dernière performance et record, par exercice.
 *
 * **Cette table n'est pas dans la liste du ticket, et elle est nécessaire.** Le
 * bootstrap descend `history` précisément pour que le dernier point et le record
 * s'affichent **en séance, hors ligne** ; sans table, la réponse serait lue puis
 * jetée, et l'écran de KL-32 supposerait du réseau — ce que le cadrage réserve
 * explicitement au seul `GET /api/exercises/{id}/history`.
 *
 * Une ligne par exercice, `last` et `best` en JSON : ce sont des documents
 * agrégés, recalculés en entier par le serveur à chaque pull, jamais interrogés
 * champ par champ.
 */
export const exerciseHistory = sqliteTable('exercise_history', {
  exerciseId: integer('exercise_id')
    .primaryKey()
    .references(() => exercise.id, { onDelete: 'cascade' }),
  last: text('last', { mode: 'json' }).$type<PerformanceSession>(),
  best: text('best', { mode: 'json' }).$type<PerformanceBest>(),
});

// --- La séance datée : le prévu et le réalisé --------------------------------

/**
 * La séance datée. Comme côté serveur, elle porte **le prévu et le réalisé** :
 * il n'y a pas d'entité conteneur de log, elle avait déjà l'owner, la date, le
 * statut et la note de clôture.
 *
 * Partage d'autorité (§4.1) : `date`, `title`, `status` et `plan_*` viennent du
 * serveur et ne se modifient pas ici ; `started_at`, `ended_at` et le réalisé
 * appartiennent au téléphone.
 */
export const scheduledWorkout = sqliteTable(
  'scheduled_workout',
  {
    /** UUIDv7, posé par le client à la création. Pivot de l'idempotence du `PUT`. */
    uuid: text('uuid').primaryKey(),
    /** `AAAA-MM-JJ`. Une date de calendrier, pas un instant : jamais d'horodatage ici. */
    date: text('date').notNull(),
    status: text('status').$type<ScheduledStatus>().notNull().default('planned'),
    /** Titre vivant, snapshot, ou « Séance libre » : toujours rempli par l'API. */
    title: text('title'),
    /** `true` = séance sans programme. `prescribed_snapshot` est alors absent, ce n'est pas une anomalie. */
    freeform: integer('freeform', { mode: 'boolean' }).notNull().default(false),
    startedAt: text('started_at'),
    endedAt: text('ended_at'),
    completionNotes: text('completion_notes'),
    /** `{id, title}` ou absent. Un document, parce qu'on ne synchronise pas les plans. */
    plan: text('plan', { mode: 'json' }).$type<PlanRef>(),
  },
  (t) => [
    // L'écran « Aujourd'hui » (KL-28) et ses jours voisins lisent par date.
    index('idx_scheduled_workout_date').on(t.date),
  ],
);

/**
 * Le programme d'une séance datée, stocké **tel qu'il descend** : une ligne par
 * séance, la liste des blocs en JSON.
 *
 * Table séparée de `scheduled_workout` et non colonne de plus, pour une raison
 * de poids : la liste des séances du jour, du calendrier, des jours voisins se
 * lit sans jamais toucher au programme, qui est de loin le plus gros document de
 * la base. Une colonne l'aurait fait remonter à chaque `SELECT`.
 */
export const prescribedSnapshot = sqliteTable('prescribed_snapshot', {
  scheduledUuid: text('scheduled_uuid')
    .primaryKey()
    .references(() => scheduledWorkout.uuid, { onDelete: 'cascade' }),
  blocks: text('blocks', { mode: 'json' }).$type<PrescribedBlock[]>().notNull(),
});

/**
 * Un exercice réalisé. Il pend de la **séance datée**, jamais du prescrit.
 *
 * `exerciseId` est en `SET NULL` et `exerciseName` est un snapshot : nettoyer la
 * bibliothèque ne rend jamais illisible une séance faite. Même règle que le
 * serveur.
 *
 * `skipped` est une **déclaration** de l'athlète, pas un trou : un exercice sauté
 * a sa ligne.
 */
export const loggedExercise = sqliteTable(
  'logged_exercise',
  {
    /** Clé locale : le serveur n'adresse jamais un exercice réalisé par identifiant. */
    id: integer('id').primaryKey({ autoIncrement: true }),
    scheduledUuid: text('scheduled_uuid')
      .notNull()
      .references(() => scheduledWorkout.uuid, { onDelete: 'cascade' }),
    exerciseId: integer('exercise_id').references(() => exercise.id, { onDelete: 'set null' }),
    exerciseName: text('exercise_name').notNull(),
    /** La ligne du programme **de cette séance** dont le réalisé découle. Ce qui apparie prévu et fait. */
    sourcePrescribedId: integer('source_prescribed_id'),
    position: integer('position').notNull(),
    skipped: integer('skipped', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes'),
  },
  (t) => [index('idx_logged_exercise_scheduled').on(t.scheduledUuid, t.position)],
);

/**
 * Une série réalisée.
 *
 * L'`uuid` est posé par le client avant que le serveur sache que quoi que ce
 * soit existe : c'est la clé sur laquelle une écriture rejouée retombe. Il est
 * la clé primaire ici pour la même raison — deux clés pour une série laisseraient
 * un doublon possible.
 */
export const loggedSet = sqliteTable(
  'logged_set',
  {
    uuid: text('uuid').primaryKey(),
    loggedExerciseId: integer('logged_exercise_id')
      .notNull()
      .references(() => loggedExercise.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').$type<SetType>().notNull().default('normal'),
    reps: integer('reps'),
    /** En kg, comme partout dans Kadens. `real` : les charges se comptent en demi-kilos. */
    weightKg: real('weight_kg'),
    durationSeconds: integer('duration_seconds'),
    rpe: integer('rpe'),
    completedAt: text('completed_at'),
  },
  (t) => [index('idx_logged_set_exercise').on(t.loggedExerciseId, t.position)],
);

/**
 * L'**ordre d'exécution local** d'une séance : le rang où chaque exercice est
 * réellement mené, et l'enchaînement auquel il appartient (KL-52).
 *
 * ## Pourquoi une table, alors que « on dévie, on ne recompose pas »
 *
 * La règle tient toujours, et cette table la respecte : **rien de ce qu'elle
 * contient ne part au serveur**. Le prescrit reste ce que le coach a écrit, dans
 * l'ordre où il l'a écrit ; `prescribed_snapshot` n'est pas touché, le document
 * poussé continue de se trier sur `logged_exercise.position`, donc sur l'ordre
 * du programme. Ce qui se range ici est autre chose : l'ordre dans lequel la
 * séance **se déroule** ce jour-là, parce que la machine était prise ou qu'on a
 * mené le superset autrement. C'est de l'exécution, pas de la programmation.
 *
 * C'est aussi pour ça qu'elle ne peut pas vivre dans `prescribed_snapshot` : ce
 * document est **remplacé en entier à chaque pull**, un ordre écrit dedans
 * s'effacerait au premier cycle de synchronisation.
 *
 * ## Ce que la clé désigne, et sa limite
 *
 * `exercise_key` est la clé de déroulé de `session/program.ts` : `e{prescribedId}`
 * pour une ligne du programme, `x{loggedExerciseId}` pour un exercice hors
 * programme. La première est **stable** — elle vient du serveur. La seconde ne
 * l'est que tant que le pull ne réécrit pas le réalisé de cette séance, ce qu'il
 * ne fait jamais tant qu'une mutation l'attend (`sync/pull.ts`) — donc jamais
 * pendant qu'on la fait. Conséquence assumée : un exercice hors programme peut
 * retrouver son rang de programme après un aller-retour serveur complet, une
 * fois la séance close. À ce moment-là l'ordre d'exécution n'a plus d'usage.
 *
 * `chain` est l'identifiant d'un enchaînement **local**. Deux exercices voisins
 * qui le partagent forment un superset, exactement comme deux `groupLabel` de
 * même préfixe côté serveur : la contiguïté fait partie de la règle, et c'est ce
 * qui permet à un exercice sorti du groupe de s'en détacher sans réécriture.
 * `null` = mené seul.
 *
 * ## `lane` : la file où l'exercice est mené, qui n'est plus forcément la sienne
 *
 * Le rangement traverse les blocs : on mène un gainage d'échauffement après le
 * squat, on remonte le finisseur avant le dernier exercice principal.
 * `lane` retient **où** l'exercice a été posé — la clé du bloc (`b{id}`) ou
 * `extras` pour les hors-programme — et le déroulé l'affiche là, sous cet
 * en-tête, avec le compteur du bloc qui suit.
 *
 * `null` veut dire « la file du programme », et c'est ce que valent toutes les
 * lignes écrites avant cette colonne : un ordre déjà rangé bloc par bloc reste
 * lu exactement comme il l'était, sans migration de données. C'est aussi ce que
 * vaut un exercice que le rangement n'a jamais déplacé de file.
 *
 * Ce que `lane` ne change pas, c'est tout le reste : le prescrit ignore ce
 * déplacement, `logged_exercise.position` aussi, et le rôle du bloc
 * (échauffement, principal) ne sert qu'à titrer une section — le volume, lui,
 * se compte sur le **type de série** (`labels.ts`, `summary.ts`). Un exercice
 * passé sous « Échauffement » ne devient donc pas de l'échauffement : il est
 * juste mené là.
 */
export const sessionLayout = sqliteTable(
  'session_layout',
  {
    scheduledUuid: text('scheduled_uuid')
      .notNull()
      .references(() => scheduledWorkout.uuid, { onDelete: 'cascade' }),
    /** `e{prescribedId}` ou `x{loggedExerciseId}` — la clé de `SessionExercise`. */
    exerciseKey: text('exercise_key').notNull(),
    /** Rang d'exécution dans la séance entière, files comprises. */
    position: integer('position').notNull(),
    /** L'enchaînement local, ou `null` si l'exercice est mené seul. */
    chain: integer('chain'),
    /** `b{id}` ou `extras` — la file où il est mené. `null` = celle du programme. */
    lane: text('lane'),
  },
  (t) => [primaryKey({ columns: [t.scheduledUuid, t.exerciseKey] })],
);

// --- La synchronisation ------------------------------------------------------

/**
 * L'état de la synchronisation. **Une seule ligne**, garantie par une contrainte
 * de la base et non par une intention du code : `id` vaut 1 ou l'insertion
 * échoue. Une deuxième ligne d'état donnerait deux vérités sur ce qui a été
 * descendu.
 *
 * `serverTime` est l'horloge du **serveur** au dernier bootstrap réussi, et
 * c'est elle qu'on renvoie en `?since`. Se fier à la pendule du téléphone ferait
 * dépendre la synchro d'une horloge qu'on ne contrôle pas.
 *
 * `apiUrl` vit ici et non dans la configuration de build : `EXPO_PUBLIC_API_URL`
 * n'est qu'un défaut de développement, l'URL réelle arrive par le QR
 * d'appairage (KL-48) et doit survivre au redémarrage. Le **jeton**, lui, ne
 * passera jamais par la base : `expo-secure-store` (KL-25).
 */
export const syncState = sqliteTable(
  'sync_state',
  {
    id: integer('id').primaryKey(),
    apiUrl: text('api_url'),
    serverTime: text('server_time'),
    /** La fenêtre annoncée par le dernier bootstrap. Elle **fait autorité** : ce qu'elle contient remplace le local en entier. */
    windowFrom: text('window_from'),
    windowTo: text('window_to'),
    lastPulledAt: text('last_pulled_at'),
    lastPushedAt: text('last_pushed_at'),

    /**
     * La langue d'affichage des noms d'exercices, telle que le **compte** la
     * règle sur le web. Elle est ici et non dans `preference` justement parce
     * qu'elle n'appartient pas à l'appareil : c'est une valeur descendue, au
     * même titre que la fenêtre ou le plancher de version, et la ranger avec les
     * réglages locaux laisserait croire qu'on peut la changer d'ici.
     *
     * Nulle tant qu'aucun bootstrap n'a abouti — le libellé retombe alors sur le
     * français, comme un lecteur sans compte côté serveur.
     */
    exerciseLanguage: text('exercise_language').$type<ExerciseLanguage>(),

    // --- Ce que le serveur attend comme version d'app (KL-43) ---------------
    //
    // Quatre valeurs recopiées telles quelles du dernier `GET /api/app-version`
    // réussi. Elles sont **persistées** et pas gardées en mémoire pour une seule
    // raison, mais elle suffit : le plancher doit survivre à un lancement sans
    // réseau. Un garde-fou qui disparaît dès qu'on ouvre l'app en mode avion ne
    // garde rien — et c'est exactement le mode dans lequel cette app s'ouvre le
    // plus souvent.
    //
    // Nulles tant qu'aucun appel n'a abouti : « on ne sait pas » n'est pas « tout
    // va bien », et rien ne se bloque sur une réponse jamais reçue.

    /** La dernière version publiée. Plus haute que la sienne : mise à jour proposée. */
    latestVersionCode: integer('latest_version_code'),
    /** Son numéro lisible, pour l'écrire dans le bandeau plutôt qu'un `versionCode` nu. */
    latestVersionName: text('latest_version_name'),
    /** Le plancher. En dessous, l'app s'arrête d'elle-même. */
    minVersionCode: integer('min_version_code'),
    /** La page d'installation du site, gardée pour que l'écran de blocage ait où envoyer. */
    installUrl: text('install_url'),
  },
  (t) => [check('sync_state_singleton', sql`${t.id} = 1`)],
);

/** L'identifiant de l'unique ligne de `sync_state`. */
export const SYNC_STATE_ID = 1;

// --- Les réglages de l'app ---------------------------------------------------

/**
 * Les réglages du téléphone (KL-31). **Une seule ligne**, même patron que
 * `sync_state` et pour la même raison : deux lignes donneraient deux vérités.
 *
 * ## Pourquoi une table, et pas un magasin clé/valeur
 *
 * Parce que ces valeurs se lisent **pendant** une séance et se règlent depuis un
 * autre écran (KL-35) : montées sur `useLiveQuery`, elles se republient d'
 * elles-mêmes là où elles s'appliquent, sans qu'aucun code n'ait à prévenir
 * personne. Un `AsyncStorage` aurait demandé une dépendance de plus, un cache en
 * mémoire et un moyen de le notifier.
 *
 * ## Ce qui n'est pas ici
 *
 * Rien de ce qui appartient au serveur. Ces réglages sont **locaux à l'appareil**
 * et ne partent jamais : la durée de repos de mon téléphone ne regarde pas le
 * calendrier, et le contrat de `PUT /api/schedule/{uuid}` n'a nulle part où les
 * mettre. Ils ne se synchronisent donc pas, et une réinstallation les repose à
 * leurs valeurs par défaut.
 */
export const preference = sqliteTable(
  'preference',
  {
    id: integer('id').primaryKey(),
    /**
     * La durée de repos par défaut, en secondes. Elle ne sert que **faute de
     * mieux** : une ligne prescrite qui porte son propre `restSeconds` l'emporte
     * toujours (`session/rest.ts`), le programme sachant mieux que le réglage ce
     * que cet exercice demande.
     */
    restSeconds: integer('rest_seconds').notNull().default(90),
    /** La vibration de fin de repos. Désactivable, comme le ticket le demande. */
    vibrate: integer('vibrate', { mode: 'boolean' }).notNull().default(true),
    /**
     * Le repos part-il tout seul quand une série est cochée ?
     *
     * Vrai par défaut : c'est le cas nominal en muscu, et c'est ce que KL-31 a
     * posé. Le réglage existe parce que le contraire est un vrai mode de séance —
     * circuit mené à la montre, séance chronométrée de bout en bout, échauffement
     * enchaîné — où un décompte qui repart à chaque coche est du bruit sous le
     * pouce. Il se bascule **en séance**, depuis la barre basse, là où on s'en
     * aperçoit ; les réglages le portent aussi, pour qu'il soit trouvable.
     *
     * Il ne débranche que le **démarrage automatique** : un repos lancé à la main
     * (« Tester un repos », KL-35) part quand même, et un repos qui court garde
     * ses ajustements.
     */
    autoRest: integer('auto_rest', { mode: 'boolean' }).notNull().default(true),
    /**
     * La silhouette de la carte musculaire, à la clôture d'une séance.
     *
     * **Un réglage d'affichage, et rien d'autre.** Le serveur porte bien un
     * `User.sex`, mais il n'est pas dans le contrat mobile, il accepte `other` —
     * qui ne désigne aucun dessin — et il sert au score de force normalisé
     * (DOTS). Le brancher ici ferait qu'un choix de rendu toucherait une donnée
     * de calcul : deux questions différentes, deux endroits différents.
     */
    silhouette: text('silhouette').$type<BodySilhouette>().notNull().default('male'),
    /**
     * Clair, sombre, ou ce que dit le téléphone.
     *
     * Local comme `silhouette`, et pour la même raison : c'est un réglage
     * d'**affichage**, pas une donnée de compte. Le contrat mobile n'a nulle
     * part où le mettre, le serveur n'en a aucun usage, et le site n'active
     * jamais son propre jeu sombre — il l'exporte pour ici.
     *
     * `system` par défaut : le téléphone porte déjà la réponse, et forcer est
     * l'exception — un vestiaire au néon, une préférence personnelle.
     */
    theme: text('theme').$type<ThemePreference>().notNull().default('system'),
  },
  (t) => [check('preference_singleton', sql`${t.id} = 1`)],
);

/** L'identifiant de l'unique ligne de `preference`. */
export const PREFERENCE_ID = 1;

/**
 * La file de mutations montantes, dépilée en FIFO par le moteur de
 * synchronisation (KL-27).
 *
 * `id` est **auto-incrémenté au sens SQLite strict** (`AUTOINCREMENT`, donc
 * `sqlite_sequence`) : sans lui, SQLite réattribue le plus grand rowid libéré, et
 * une mutation créée après une purge se retrouverait devant une mutation plus
 * ancienne. L'ordre de la file est le seul ordre qui existe, il ne doit pas
 * dépendre de ce qui a été supprimé.
 *
 * Une mutation en échec est **rejouée, jamais perdue** : `attempts` et
 * `lastError` sont ce qui permet de la remonter dans les réglages (KL-35) au
 * lieu de l'abandonner en silence.
 */
export const mutationQueue = sqliteTable('mutation_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').$type<MutationType>().notNull(),
  payload: text('payload', { mode: 'json' }).$type<MutationPayload>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
});

// --- Types dérivés du schéma -------------------------------------------------

export type ExerciseRow = typeof exercise.$inferSelect;
export type ExerciseInsert = typeof exercise.$inferInsert;
export type ExerciseHistoryRow = typeof exerciseHistory.$inferSelect;
export type ScheduledWorkoutRow = typeof scheduledWorkout.$inferSelect;
export type ScheduledWorkoutInsert = typeof scheduledWorkout.$inferInsert;
export type PrescribedSnapshotRow = typeof prescribedSnapshot.$inferSelect;
export type SessionLayoutRow = typeof sessionLayout.$inferSelect;
export type LoggedExerciseRow = typeof loggedExercise.$inferSelect;
export type LoggedExerciseInsert = typeof loggedExercise.$inferInsert;
export type LoggedSetRow = typeof loggedSet.$inferSelect;
export type LoggedSetInsert = typeof loggedSet.$inferInsert;
export type PreferenceRow = typeof preference.$inferSelect;
export type SyncStateRow = typeof syncState.$inferSelect;
export type MutationRow = typeof mutationQueue.$inferSelect;
