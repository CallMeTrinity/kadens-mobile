/**
 * Les lectures de l'écran « Aujourd'hui » (KL-28).
 *
 * Elles sont **toutes locales**. C'est la condition posée par le ticket (« les
 * séances programmées du jour, lues en local ») et la raison d'être de la base :
 * l'app s'ouvre et affiche la séance du jour dans un sous-sol, sans réseau, sans
 * écran de chargement. Aucune de ces fonctions n'appelle `@/api`.
 *
 * ## Ce qu'elles ne lisent jamais
 *
 * `prescribed_snapshot`. C'est l'invariant posé par `db/schema.ts` : le programme
 * est le plus gros document de la base, et lister les séances d'un jour ne doit
 * pas le remonter. Conséquence assumée : la carte d'une séance ne peut pas
 * annoncer « 5 exercices » avant de l'ouvrir. Le compter demanderait soit de
 * charger le document, soit `json_array_length` — donc l'extension json1 sur tous
 * les Android visés, que le projet a déjà refusé de supposer (`sync/queue.ts`).
 * Ce que la carte montre vient donc des seules colonnes de `scheduled_workout` et
 * du réalisé, qui est normalisé et indexé.
 *
 * ## Pourquoi des constructeurs de requêtes et pas des résultats
 *
 * `useLiveQuery` (`hooks.ts`) prend la requête, pas ses lignes : c'est lui qui la
 * rejoue quand la table change. Ces fonctions rendent donc un constructeur
 * Drizzle. Piège à connaître, il vient de l'implémentation : **`useLiveQuery`
 * n'écoute que la table du `from`**, pas celles jointes. Le `from` de chaque
 * requête est choisi en conséquence, c'est écrit au cas par cas ci-dessous.
 */

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';

import {
  db,
  exercise,
  exerciseHistory,
  loggedExercise,
  loggedSet,
  mutationQueue,
  PREFERENCE_ID,
  preference,
  prescribedSnapshot,
  scheduledWorkout,
  type ScheduledWorkoutRow,
} from '@/db';

/**
 * Les séances datées d'un jour.
 *
 * La ligne entière : elle est légère par construction, le programme vit dans une
 * autre table (voir l'en-tête). L'ordre se fait sur l'`uuid` faute de mieux —
 * rien dans le modèle ne dit qu'une séance passe avant une autre dans la journée,
 * et un UUIDv7 est au moins **stable** et grossièrement chronologique, donc la
 * liste ne se réordonne pas d'un rendu à l'autre.
 *
 * Écoute `scheduled_workout` : démarrer une séance y écrit `started_at`, la liste
 * se republie.
 */
export function workoutsOfDayQuery(date: string) {
  return db
    .select()
    .from(scheduledWorkout)
    .where(eq(scheduledWorkout.date, date))
    .orderBy(asc(scheduledWorkout.uuid));
}

/**
 * Une séance datée, par son uuid. Écoute `scheduled_workout`, comme la liste :
 * l'ouvrir depuis « Aujourd'hui » y écrit `started_at`, l'écran de séance le voit.
 */
export function workoutQuery(uuid: string) {
  return db.select().from(scheduledWorkout).where(eq(scheduledWorkout.uuid, uuid)).limit(1);
}

/**
 * La séance en cours : commencée, pas terminée.
 *
 * C'est le pivot de « reprise d'une séance en cours si l'app a été fermée ».
 * **Sans filtre de date, et c'est le point** : une séance commencée hier soir se
 * reprend ce matin, sinon la reprise ne marcherait que le jour même — exactement
 * le cas où l'app a été fermée entre-temps.
 *
 * La plus récemment commencée l'emporte. Il ne devrait y en avoir qu'une, mais
 * une séance abandonnée sans clôture reste ouverte (c'est ce que KL-33 prévoit) :
 * autant que ce soit la dernière qui remonte, et non une oubliée d'il y a trois
 * jours.
 *
 * L'uuid départage à égalité de `started_at` — deux séances ouvertes dans la même
 * milliseconde, ça n'arrive qu'à un test, mais sans ce second critère l'ordre
 * serait celui que SQLite veut bien rendre, et la reprise désignerait une séance
 * différente d'un lancement à l'autre. L'UUIDv7 est monotone (`db/uuid.ts`), donc
 * le plus grand est bien le plus récent.
 */
export function runningWorkoutQuery() {
  return db
    .select()
    .from(scheduledWorkout)
    .where(and(isNotNull(scheduledWorkout.startedAt), isNull(scheduledWorkout.endedAt)))
    .orderBy(desc(scheduledWorkout.startedAt), desc(scheduledWorkout.uuid))
    .limit(1);
}

/**
 * Les séances derrière soi (KL-37) — l'écran « Historique ».
 *
 * La condition n'est pas « la date est passée » mais **« il s'est passé quelque
 * chose »** : la séance a été clôturée ici (`ended_at`), ou le serveur l'a
 * tranchée (`done`, `missed`). Une séance d'avant-hier jamais ouverte et restée
 * `planned` n'est pas de l'historique, c'est un trou — la bande de jours de
 * l'écran « Aujourd'hui » remonte déjà jusqu'à J-2 pour ça.
 *
 * **Aucun filtre de date, et c'est volontaire** : la base locale ne contient que
 * la fenêtre du serveur (J-30 → J+14, `docs/api-mobile.md §4.5`), qui fait
 * autorité et remplace ce qu'elle couvre. Ajouter une borne ici, ce serait
 * inventer une seconde fenêtre à tenir d'accord avec celle-là. La portée réelle
 * de l'écran est donc « les trente derniers jours », et il le dit.
 *
 * Écoute `scheduled_workout` : clôturer une séance y pose `ended_at`, elle
 * apparaît ici sans que rien n'ait à prévenir l'écran.
 */
export function pastWorkoutsQuery() {
  return db
    .select()
    .from(scheduledWorkout)
    .where(
      or(isNotNull(scheduledWorkout.endedAt), inArray(scheduledWorkout.status, ['done', 'missed'])),
    )
    .orderBy(desc(scheduledWorkout.date), desc(scheduledWorkout.uuid));
}

/**
 * Combien de séries consignées, par séance, sur toute la base locale.
 *
 * Jumelle de `loggedSetCountsQuery`, sans le filtre de date : l'historique n'est
 * pas une journée. Le `from` reste `logged_set` pour la même raison, et la
 * séance datée n'est plus jointe du tout — elle ne servait qu'à filtrer.
 */
export function loggedSetCountsAllQuery() {
  return db
    .select({ uuid: loggedExercise.scheduledUuid, sets: count() })
    .from(loggedSet)
    .innerJoin(loggedExercise, eq(loggedSet.loggedExerciseId, loggedExercise.id))
    .where(eq(loggedExercise.skipped, false))
    .groupBy(loggedExercise.scheduledUuid);
}

/**
 * Combien de séances par jour, sur l'intervalle de la bande.
 *
 * Bornes incluses, et jamais de liste vide en paramètre : c'est ce qui permet de
 * monter la requête inconditionnellement dans un hook.
 */
export function dayCountsQuery(from: string, to: string) {
  return db
    .select({ date: scheduledWorkout.date, total: count() })
    .from(scheduledWorkout)
    .where(and(gte(scheduledWorkout.date, from), lte(scheduledWorkout.date, to)))
    .groupBy(scheduledWorkout.date);
}

/**
 * Combien de séries consignées, par séance d'un jour donné.
 *
 * Le `from` est `logged_set` **volontairement** : c'est la table qu'une séance en
 * cours fait grossir série après série (KL-29), donc celle dont le changement doit
 * republier la liste. La séance datée n'est jointe que pour filtrer sur la date,
 * ce qui évite de passer une liste d'uuids — et une liste vide, `inArray` la rend
 * mal.
 */
export function loggedSetCountsQuery(date: string) {
  return db
    .select({ uuid: loggedExercise.scheduledUuid, sets: count() })
    .from(loggedSet)
    .innerJoin(loggedExercise, eq(loggedSet.loggedExerciseId, loggedExercise.id))
    .innerJoin(scheduledWorkout, eq(scheduledWorkout.uuid, loggedExercise.scheduledUuid))
    .where(and(eq(scheduledWorkout.date, date), eq(loggedExercise.skipped, false)))
    .groupBy(loggedExercise.scheduledUuid);
}

/**
 * Les séances qu'une mutation attend de pousser.
 *
 * Même information que `pendingUuids()` (`@/sync`), en version **vive** : l'écran
 * doit voir la marque « en attente de synchronisation » disparaître quand le push
 * aboutit, sans qu'on ait à lui redemander.
 *
 * L'uuid vit dans une colonne JSON, on lit donc la file entière et on filtre en
 * mémoire — exactement pour la raison écrite dans `sync/queue.ts` : la chercher en
 * SQL demanderait `json_extract`, et la file est courte par construction.
 */
export function pendingMutationsQuery() {
  return db.select({ payload: mutationQueue.payload }).from(mutationQueue);
}

/**
 * Le programme d'une séance (KL-29).
 *
 * C'est **la seule** requête de tout le module qui touche `prescribed_snapshot`,
 * et c'est voulu : le document est le plus gros de la base, il ne se lit qu'à
 * l'ouverture d'une séance, jamais pour en lister. L'invariant de `db/schema.ts`
 * tient donc toujours — il interdit de le remonter pour *lister*, pas pour
 * *dérouler*.
 *
 * Écoute `prescribed_snapshot` : un pull qui apporte une correction du coach
 * pendant la séance se voit sans rien à prévenir.
 */
export function prescribedSnapshotQuery(uuid: string) {
  return db
    .select({ blocks: prescribedSnapshot.blocks })
    .from(prescribedSnapshot)
    .where(eq(prescribedSnapshot.scheduledUuid, uuid))
    .limit(1);
}

/**
 * Les exercices réalisés d'une séance, dans l'ordre du programme.
 *
 * Écoute `logged_exercise` : cocher la première série d'un exercice y crée sa
 * ligne, le déroulé la voit.
 */
export function loggedExercisesQuery(uuid: string) {
  return db
    .select()
    .from(loggedExercise)
    .where(eq(loggedExercise.scheduledUuid, uuid))
    .orderBy(asc(loggedExercise.position), asc(loggedExercise.id));
}

/**
 * Les séries réalisées d'une séance, dans l'ordre où elles ont été faites.
 *
 * Le `from` est `logged_set` **volontairement** — même raison que
 * `loggedSetCountsQuery` : c'est la table qu'une série cochée fait grossir, donc
 * celle dont le changement doit republier le déroulé. La séance datée n'est
 * jointe que pour filtrer.
 *
 * L'ordre `(exercice, position)` est celui dont l'appariement par rang dépend
 * (`program.ts`) : sans lui, deux séries de la même file remonteraient dans
 * l'ordre que SQLite veut bien rendre, et la coche sauterait d'une ligne à
 * l'autre d'un rendu au suivant.
 */
export function loggedSetsOfWorkoutQuery(uuid: string) {
  return db
    .select({
      uuid: loggedSet.uuid,
      loggedExerciseId: loggedSet.loggedExerciseId,
      position: loggedSet.position,
      type: loggedSet.type,
      reps: loggedSet.reps,
      weightKg: loggedSet.weightKg,
      durationSeconds: loggedSet.durationSeconds,
      rpe: loggedSet.rpe,
      completedAt: loggedSet.completedAt,
    })
    .from(loggedSet)
    .innerJoin(loggedExercise, eq(loggedSet.loggedExerciseId, loggedExercise.id))
    .where(eq(loggedExercise.scheduledUuid, uuid))
    .orderBy(asc(loggedSet.loggedExerciseId), asc(loggedSet.position));
}

/**
 * Un identifiant qu'aucun exercice ne porte.
 *
 * Les identifiants d'exercice viennent du serveur et sont des entiers positifs
 * (`db/schema.ts`), donc `-1` ne désigne rien et ne le fera jamais.
 */
const NO_EXERCISE = -1;

/**
 * La dernière performance et le record des exercices d'une séance (KL-32).
 *
 * **Lues en local, comme tout le reste.** Ces deux points viennent du bootstrap
 * et sont réécrits dans `exercise_history` à chaque pull (`sync/pull.ts`), très
 * exactement pour être lisibles en séance sans réseau ; le réseau ne sert qu'à la
 * trajectoire complète (`GET /api/exercises/{id}/history`), qu'aucun écran de
 * l'app n'ouvre. Conséquence à connaître : ce qui s'affiche est ce que le
 * **serveur** avait confirmé au dernier pull. La séance en cours n'y est pas tant
 * qu'elle n'est pas poussée puis redescendue — et c'est ce qu'on veut, « la
 * dernière fois » n'est pas « à l'instant ». L'écran affiche la date en clair,
 * qui lève l'ambiguïté quand elle se pose.
 *
 * La liste ne peut pas partir vide : `inArray` rend mal un `IN ()`. Une séance
 * dont aucun exercice n'est rattaché à la bibliothèque interroge donc un
 * identifiant impossible plutôt que de faire monter la condition dans l'appelant.
 *
 * Écoute `exercise_history` : un pull qui arrive pendant la séance rafraîchit ce
 * qui s'affiche sans que rien n'ait à prévenir l'écran.
 */
export function exerciseHistoryQuery(exerciseIds: number[]) {
  return db
    .select()
    .from(exerciseHistory)
    .where(
      inArray(exerciseHistory.exerciseId, exerciseIds.length > 0 ? exerciseIds : [NO_EXERCISE]),
    );
}

/**
 * La bibliothèque locale, pour remplacer ou ajouter un exercice (KL-30, facettes
 * en KL-34).
 *
 * Elle part **entière**, triée par nom, et se filtre en mémoire (`library.ts`) :
 * `LIKE` ne replierait pas les accents, et la table tient en quelques centaines de
 * lignes.
 *
 * `activity` et `target_areas` sont montées depuis KL-34, qui en fait des
 * facettes : elles ne servent pas à *lire* une ligne de la liste mais à la
 * **retenir ou l'écarter**, et un filtre calculé sur une colonne qu'on n'a pas
 * remontée n'existe pas. La description et le média, eux, restent dehors — on ne
 * les lit ni ne les filtre dans une liste au pouce.
 *
 * Écoute `exercise` : un pull qui apporte un exercice neuf le rend choisissable
 * sans rouvrir la feuille.
 */
export function exerciseLibraryQuery() {
  return db
    .select({
      id: exercise.id,
      name: exercise.name,
      global: exercise.global,
      activity: exercise.activity,
      targetAreas: exercise.targetAreas,
    })
    .from(exercise)
    .orderBy(asc(exercise.name));
}

/**
 * Les réglages de l'appareil (KL-31).
 *
 * En lecture **vive**, alors que `getPreferences()` les lit très bien en
 * synchrone : ce n'est pas la même question. Démarrer un repos lit une valeur à
 * un instant donné ; un écran qui affiche le réglage doit se repeindre quand on
 * le change, et c'est ce que `useLiveQuery` fait sans qu'aucun code n'ait à
 * prévenir personne.
 *
 * Écoute `preference`, table d'une ligne au plus — d'où la liste, parfois vide,
 * que le hook complète par les valeurs par défaut.
 */
export function preferencesQuery() {
  return db.select().from(preference).where(eq(preference.id, PREFERENCE_ID)).limit(1);
}

/**
 * Ce qu'il faut d'une séance datée pour dire où elle en est. Un `Pick` et non la
 * ligne entière : `beginWorkout` (`start.ts`) tranche la même question sur une
 * lecture à trois colonnes, dans sa transaction — et deux définitions de « close »
 * finiraient par diverger.
 */
type WorkoutBounds = Pick<ScheduledWorkoutRow, 'startedAt' | 'endedAt' | 'status'>;

/**
 * La séance court-elle **ici** ? Commencée sur ce téléphone, pas terminée.
 *
 * Prime sur le statut du serveur, comme la marque de lecture : le téléphone fait
 * autorité sur ses propres bornes (`docs/api-mobile.md §4.1`). Une séance ouverte
 * ici et cochée « faite » sur le web pendant ce temps se reprend, elle ne se
 * ferme pas sous les doigts.
 */
export function isRunning(row: WorkoutBounds): boolean {
  return row.startedAt !== null && row.endedAt === null;
}

/**
 * La séance est-elle fermée — plus rien à y écrire ?
 *
 * **Deux façons de l'être, et la seconde manquait.** `ended_at` dit « clôturée
 * ici » (§2.3 point 5, pas de reprise après clôture). Mais une séance cochée
 * « faite » **depuis le web** n'a pas d'`ended_at` — seul le téléphone en écrit
 * un — et elle se présentait donc comme une séance à démarrer, jusqu'à rafler
 * l'unique action primaire du jour. Or rien ne **déclôture** côté serveur
 * (`docs/api-mobile.md §4.1`) : un `status = done` est aussi terminal qu'une
 * clôture d'ici, et on ne consigne pas rétroactivement une séance déjà déclarée
 * faite.
 *
 * `started_at` non nul l'emporte : voir `isRunning`.
 */
export function isClosed(row: WorkoutBounds): boolean {
  return row.endedAt !== null || (row.status === 'done' && row.startedAt === null);
}

/** Une séance datée telle que l'écran la peint, ses dérivés compris. */
export interface DayWorkout extends ScheduledWorkoutRow {
  /** Commencée et pas terminée. L'état qui rend le bouton « Reprendre ». */
  running: boolean;
  /** Fermée : plus rien à y écrire. Clôturée ici, ou déclarée faite sur le web. */
  closed: boolean;
  /** Séries consignées, échauffement compris, exercices sautés exclus. */
  loggedSets: number;
  /** Une mutation la concerne : le serveur ne l'a pas encore confirmée. */
  pendingSync: boolean;
}

/** Assemble une ligne et ses dérivés. Pur : les hooks et les tests l'appellent pareil. */
export function toDayWorkout(
  row: ScheduledWorkoutRow,
  loggedSets: number,
  pendingSync: boolean,
): DayWorkout {
  return {
    ...row,
    running: isRunning(row),
    closed: isClosed(row),
    loggedSets,
    pendingSync,
  };
}

/**
 * L'état d'une séance, en un mot, pour la marque de lecture.
 *
 * « En cours » prime sur le statut : une séance ouverte est ouverte, quel que soit
 * ce que le serveur a en base — c'est le téléphone qui fait autorité sur ses
 * bornes.
 */
export function workoutStateLabel(workout: DayWorkout): { label: string; done: boolean } {
  if (workout.running) {
    return { label: 'En cours', done: false };
  }

  switch (workout.status) {
    case 'done':
      return { label: 'Fait', done: true };
    case 'missed':
      return { label: 'Manqué', done: false };
    default:
      return { label: 'Prévu', done: false };
  }
}

/** Le nombre de séances d'un jour, tel que `dayCountsQuery` le rend. */
export type DayCount = { date: string; total: number };

/** Le nombre de séries consignées d'une séance, tel que `loggedSetCountsQuery` le rend. */
export type LoggedSetCount = { uuid: string; sets: number };
