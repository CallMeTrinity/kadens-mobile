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

import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';

import {
  db,
  loggedExercise,
  loggedSet,
  mutationQueue,
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

/** Une séance datée telle que l'écran la peint, ses dérivés compris. */
export interface DayWorkout extends ScheduledWorkoutRow {
  /** Commencée et pas terminée. L'état qui rend le bouton « Reprendre ». */
  running: boolean;
  /** Terminée : plus rien à y faire (§2.3 point 5, pas de reprise après clôture). */
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
    running: row.startedAt !== null && row.endedAt === null,
    closed: row.endedAt !== null,
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
