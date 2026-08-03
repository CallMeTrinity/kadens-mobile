import { eq, inArray, sql } from 'drizzle-orm';

import type { BootstrapPayload, ScheduledWorkoutPayload } from '@/api';
import {
  db,
  exercise,
  exerciseHistory,
  loggedExercise,
  loggedSet,
  nowIso,
  patchSyncStateIn,
  prescribedSnapshot,
  scheduledWorkout,
  type Transaction,
} from '@/db';

import { pendingUuids } from './queue';

/**
 * Le sens descendant : appliquer un `GET /api/bootstrap` à la base locale
 * (KL-27).
 *
 * ## Une seule transaction, et c'est une exigence
 *
 * Le pull remplace la fenêtre de séances datées **en entier**. Appliqué par
 * morceaux, une app tuée au milieu laisserait une base à moitié neuve et à moitié
 * ancienne, sans rien pour dire laquelle des deux moitiés est laquelle. Tout ce
 * qui suit tient donc dans un `db.transaction()` — synchrone, rappel non-`async`,
 * `.run()` / `.get()` / `.all()` explicites (voir `@/db`).
 *
 * ## Ce que « la fenêtre fait autorité » veut dire ici
 *
 * La réponse annonce son intervalle et ce qu'il contient remplace le local
 * (§4.5 du contrat). Une séance datée locale **absente du jeu reçu** n'a donc
 * plus de raison d'être : supprimée sur le web, ou sortie de la fenêtre à mesure
 * qu'elle glisse. Le geste local est le même, et c'est ce qui borne la base — sans
 * cette purge, chaque jour qui passe y laisserait une séance de plus, à vie.
 *
 * C'est aussi pourquoi `deleted.schedule` n'est **pas** appliqué séparément : la
 * purge le couvre déjà, mot pour mot. `deleted.exercises`, lui, est indispensable,
 * et l'asymétrie a une raison — `?since` n'allège que la bibliothèque, dont le jeu
 * reçu est donc *partiel* ; la fenêtre de séances datées, elle, part toujours
 * entière.
 *
 * ## La seule chose que le serveur ne peut pas écraser
 *
 * Une séance que le téléphone n'a pas encore réussi à pousser. Tant que le serveur
 * n'a pas confirmé, **la base locale fait autorité** sur son réalisé : c'est
 * l'exigence « aucune fenêtre où une séance en cours peut être perdue ». Voir
 * `protectedUuids()`.
 */

export interface PullReport {
  /** Exercices ajoutés ou mis à jour. Zéro sur un delta sans changement. */
  exercises: number;
  removedExercises: number;
  /** Séances datées appliquées, protégées comprises. */
  schedule: number;
  /** Séances dont le réalisé local a été préservé faute de confirmation serveur. */
  protectedSchedule: number;
  removedSchedule: number;
  window: { from: string; to: string };
}

/**
 * Combien de lignes par `INSERT`. SQLite plafonne à 999 paramètres liés par
 * requête ; la table la plus large en compte huit, d'où cent lignes pour rester
 * loin du bord. Insérer 241 exercices un par un dans une transaction serait 241
 * allers-retours dans le pont natif — c'est ce que ce découpage évite.
 */
const BATCH = 100;

/**
 * Applique la réponse du bootstrap. Rend ce qui a bougé, pour l'écran de réglages
 * et pour les traces de développement.
 */
export function applyBootstrap(payload: BootstrapPayload): PullReport {
  return db.transaction((tx) => {
    const guarded = protectedUuids(tx);

    const exercises = upsertExercises(tx, payload);
    const removedExercises = removeExercises(tx, payload, guarded);
    const schedule = applySchedule(tx, payload, guarded);
    const removedSchedule = purgeSchedule(tx, payload, guarded);

    replaceHistory(tx, payload);

    // Dans la **même** transaction que les données : un état avancé sur une base
    // à moitié écrite ferait repartir la synchronisation suivante d'un `since`
    // qui promet des données jamais arrivées.
    patchSyncStateIn(tx, {
      serverTime: payload.serverTime,
      windowFrom: payload.window.from,
      windowTo: payload.window.to,
      lastPulledAt: nowIso(),
    });

    return {
      exercises,
      removedExercises,
      schedule: schedule.applied,
      protectedSchedule: schedule.protectedCount,
      removedSchedule,
      window: payload.window,
    };
  });
}

/**
 * Les séances datées que le pull ne doit pas écraser.
 *
 * Deux sources, et les deux comptent :
 *
 * 1. **Une mutation en file** (épuisée comprise) : le réalisé n'est pas confirmé,
 *    l'écraser le perdrait définitivement. C'est le fait que `mutation_queue`
 *    porte à la place d'un drapeau « modifié localement » (`schema.ts`).
 * 2. **Une séance en cours** — commencée, pas terminée. Elle a normalement déjà sa
 *    mutation (KL-29 en empile une dès la première série cochée), mais l'exigence
 *    du ticket est absolue : « aucune fenêtre où une séance en cours peut être
 *    perdue ». Une séance ouverte dont rien n'a encore été coché n'a pas de
 *    mutation, et l'utilisateur la regarde.
 */
function protectedUuids(tx: Transaction): Set<string> {
  const guarded = pendingUuids(tx);

  const running = tx
    .select({ uuid: scheduledWorkout.uuid })
    .from(scheduledWorkout)
    .where(sql`${scheduledWorkout.startedAt} is not null and ${scheduledWorkout.endedAt} is null`)
    .all();

  for (const row of running) {
    guarded.add(row.uuid);
  }

  return guarded;
}

function upsertExercises(tx: Transaction, payload: BootstrapPayload): number {
  for (let i = 0; i < payload.exercises.length; i += BATCH) {
    tx.insert(exercise)
      .values(
        payload.exercises.slice(i, i + BATCH).map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          activity: row.activity,
          targetAreas: row.targetAreas,
          mediaUrl: row.mediaUrl,
          global: row.global,
          updatedAt: row.updatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: exercise.id,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          activity: sql`excluded.activity`,
          targetAreas: sql`excluded.target_areas`,
          mediaUrl: sql`excluded.media_url`,
          global: sql`excluded.is_global`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .run();
  }

  return payload.exercises.length;
}

/**
 * Oublie les exercices disparus de la bibliothèque visible.
 *
 * **Sauf ceux qu'un réalisé non confirmé référence.** `logged_exercise.exercise_id`
 * est en `SET NULL` : supprimer l'exercice mettrait la référence à null, et le
 * document poussé ensuite arriverait sans `exerciseId`. La séance resterait
 * lisible — le nom est un snapshot — mais elle sortirait de l'historique et des
 * records, silencieusement. On préfère garder une ligne de bibliothèque de trop
 * quelques minutes.
 */
function removeExercises(tx: Transaction, payload: BootstrapPayload, guarded: Set<string>): number {
  if (payload.deleted.exercises.length === 0) {
    return 0;
  }

  const keep = referencedByGuardedLogs(tx, guarded);
  const doomed = payload.deleted.exercises.filter((id) => !keep.has(id));

  for (let i = 0; i < doomed.length; i += BATCH) {
    tx.delete(exercise)
      .where(inArray(exercise.id, doomed.slice(i, i + BATCH)))
      .run();
  }

  return doomed.length;
}

function referencedByGuardedLogs(tx: Transaction, guarded: Set<string>): Set<number> {
  if (guarded.size === 0) {
    return new Set();
  }

  const rows = tx
    .select({ exerciseId: loggedExercise.exerciseId })
    .from(loggedExercise)
    .where(inArray(loggedExercise.scheduledUuid, [...guarded]))
    .all();

  return new Set(rows.flatMap((row) => (row.exerciseId === null ? [] : [row.exerciseId])));
}

function applySchedule(
  tx: Transaction,
  payload: BootstrapPayload,
  guarded: Set<string>,
): { applied: number; protectedCount: number } {
  let applied = 0;
  let protectedCount = 0;

  for (const workout of payload.schedule) {
    // Une séance sans date n'a pas sa place dans une base indexée par date, et
    // l'API n'en produit pas. Le type l'autorise, on l'écarte plutôt que
    // d'inventer une valeur : mieux vaut une séance absente qu'une séance au
    // mauvais jour.
    if (workout.date === null) {
      continue;
    }

    if (guarded.has(workout.uuid)) {
      applyProgrammingOnly(tx, workout);
      protectedCount += 1;
    } else {
      applyWholeWorkout(tx, workout);
    }

    applySnapshot(tx, workout);
    applied += 1;
  }

  return { applied, protectedCount };
}

/**
 * Le cas nominal : le serveur a la version confirmée, elle remplace la locale.
 *
 * Il n'y a pas de fusion à faire et c'est voulu (§4.3) : le partage d'autorité
 * étant net par champ, une séance sans mutation en attente a déjà été poussée —
 * ce qui revient du serveur *est* ce que le téléphone y a mis.
 */
function applyWholeWorkout(tx: Transaction, workout: ScheduledWorkoutPayload): void {
  const values = {
    uuid: workout.uuid,
    date: workout.date as string,
    status: workout.status ?? ('planned' as const),
    title: workout.title,
    freeform: workout.freeform,
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    completionNotes: workout.completionNotes,
    plan: workout.plan,
  };

  tx.insert(scheduledWorkout)
    .values(values)
    .onConflictDoUpdate({ target: scheduledWorkout.uuid, set: values })
    .run();

  replaceLog(tx, workout);
}

/**
 * Le cas protégé : on prend la **programmation** et rien d'autre.
 *
 * C'est le partage d'autorité du §4.1, lu dans le sens descendant. Le coach a pu
 * déplacer la séance, la renommer, corriger son programme : ça descend. Le
 * réalisé, les bornes de la séance, le statut et la note de clôture appartiennent
 * au téléphone tant que le serveur ne les a pas confirmés — écraser `status`
 * serait le pire des trois : le document relu au push suivant repartirait en
 * `planned` et la clôture serait perdue au moment même où on essaie de l'envoyer.
 */
function applyProgrammingOnly(tx: Transaction, workout: ScheduledWorkoutPayload): void {
  tx.update(scheduledWorkout)
    .set({
      date: workout.date as string,
      title: workout.title,
      freeform: workout.freeform,
      plan: workout.plan,
    })
    .where(eq(scheduledWorkout.uuid, workout.uuid))
    .run();
}

/**
 * Le programme, remplacé en entier — un document, une ligne (`schema.ts`).
 *
 * Il descend même pour une séance protégée : c'est de la programmation, et une
 * correction du coach doit être lisible barre en main. Le prescrit ne se recompose
 * pas sur le téléphone, il n'y a donc rien à préserver ici.
 */
function applySnapshot(tx: Transaction, workout: ScheduledWorkoutPayload): void {
  if (workout.blocks.length === 0) {
    tx.delete(prescribedSnapshot).where(eq(prescribedSnapshot.scheduledUuid, workout.uuid)).run();

    return;
  }

  tx.insert(prescribedSnapshot)
    .values({ scheduledUuid: workout.uuid, blocks: workout.blocks })
    .onConflictDoUpdate({
      target: prescribedSnapshot.scheduledUuid,
      set: { blocks: sql`excluded.blocks` },
    })
    .run();
}

function replaceLog(tx: Transaction, workout: ScheduledWorkoutPayload): void {
  const incoming = workout.log ?? [];

  const existing = tx
    .select({ id: loggedExercise.id })
    .from(loggedExercise)
    .where(eq(loggedExercise.scheduledUuid, workout.uuid))
    .all();

  // Le cas de loin le plus fréquent : une séance à venir, sans réalisé ni d'un
  // côté ni de l'autre. Rien à faire, et surtout pas un `DELETE` par séance de la
  // fenêtre à chaque pull.
  if (incoming.length === 0 && existing.length === 0) {
    return;
  }

  if (existing.length > 0) {
    // Les séries partent en cascade (`foreign_keys = ON`, posé à l'ouverture de
    // la base — sans lui elles resteraient orphelines et invisibles).
    tx.delete(loggedExercise).where(eq(loggedExercise.scheduledUuid, workout.uuid)).run();
  }

  incoming.forEach((entry, index) => {
    const inserted = tx
      .insert(loggedExercise)
      .values({
        scheduledUuid: workout.uuid,
        exerciseId: entry.exerciseId,
        // Le nom est toujours rempli par le serveur, qui le dérive de la
        // référence quand le client ne l'envoie pas. La colonne est `NOT NULL` :
        // le repli existe pour que le typage n'ait pas le dernier mot sur une
        // écriture en base.
        exerciseName: entry.name ?? 'Exercice',
        sourcePrescribedId: entry.sourcePrescribedId,
        position: entry.position ?? index,
        skipped: entry.skipped,
        notes: entry.notes,
      })
      .returning({ id: loggedExercise.id })
      .get();

    if (entry.sets.length === 0) {
      return;
    }

    tx.insert(loggedSet)
      .values(
        entry.sets.map((set, setIndex) => ({
          uuid: set.uuid,
          loggedExerciseId: inserted.id,
          position: set.position ?? setIndex,
          type: set.type,
          reps: set.reps,
          weightKg: set.weightKg,
          durationSeconds: set.durationSeconds,
          rpe: set.rpe,
          completedAt: set.completedAt,
        })),
      )
      .run();
  });
}

function purgeSchedule(tx: Transaction, payload: BootstrapPayload, guarded: Set<string>): number {
  const keep = new Set(payload.schedule.map((workout) => workout.uuid));

  const doomed = tx
    .select({ uuid: scheduledWorkout.uuid })
    .from(scheduledWorkout)
    .all()
    .map((row) => row.uuid)
    .filter((uuid) => !keep.has(uuid) && !guarded.has(uuid));

  for (let i = 0; i < doomed.length; i += BATCH) {
    tx.delete(scheduledWorkout)
      .where(inArray(scheduledWorkout.uuid, doomed.slice(i, i + BATCH)))
      .run();
  }

  return doomed.length;
}

/**
 * La dernière performance et le record, par exercice.
 *
 * Recalculés en entier par le serveur à chaque pull et **toujours envoyés en
 * entier** (`?since` n'allège pas `history`) : on remplace, on ne fusionne pas.
 * La table est en cascade sur `exercise`, les entrées d'un exercice disparu sont
 * déjà parties avec lui.
 *
 * ## Une entrée dont l'exercice manque en local est sautée, pas insérée
 *
 * C'est la seule asymétrie de la réponse qui puisse blesser : `?since` allège la
 * bibliothèque et **n'allège pas** l'historique, qui porte sur la bibliothèque
 * *entière* (`ExerciseRepository::libraryIdsForUsers`, côté serveur). Un delta
 * appliqué à une base dont la table `exercise` n'est pas un sur-ensemble de ce
 * que le serveur voit fait donc échouer l'insertion sur la clé étrangère — et
 * comme tout le pull tient dans une transaction, c'est la synchronisation
 * entière qui tombe, à chaque tentative, sans pouvoir se rattraper : le `since`
 * n'avance jamais.
 *
 * Sauter est sans conséquence, et c'est ce qui le distingue du réalisé : cette
 * table est un cache d'affichage pur, rebâti en entier au pull suivant. Une
 * entrée écartée l'est pour un exercice que la base locale n'a pas, donc qu'aucun
 * écran ne peut afficher ; elle revient d'elle-même dès que l'exercice arrive. La
 * même tolérance appliquée à `logged_exercise` ne serait **pas** gratuite —
 * mettre `exercise_id` à null y ferait remonter un null au push suivant, et le
 * serveur perdrait sa propre référence (`document.ts`).
 */
function replaceHistory(tx: Transaction, payload: BootstrapPayload): void {
  if (payload.history.length === 0) {
    return;
  }

  const known = knownExerciseIds(tx);
  const entries = payload.history.filter((entry) => known.has(entry.exerciseId));

  for (let i = 0; i < entries.length; i += BATCH) {
    tx.insert(exerciseHistory)
      .values(
        entries.slice(i, i + BATCH).map((entry) => ({
          exerciseId: entry.exerciseId,
          last: entry.last,
          best: entry.best,
        })),
      )
      .onConflictDoUpdate({
        target: exerciseHistory.exerciseId,
        set: { last: sql`excluded.last`, best: sql`excluded.best` },
      })
      .run();
  }
}

/**
 * Les exercices que la base locale connaît, lus **après** l'upsert et la purge de
 * la bibliothèque — donc l'état contre lequel les clés étrangères vont être
 * vérifiées, pas celui d'avant le pull.
 *
 * Une colonne d'entiers sur la plus longue table de la base : une lecture par
 * pull, en mémoire, contre autant d'allers-retours dans le pont natif qu'il y a
 * d'entrées d'historique si on interrogeait au cas par cas.
 */
function knownExerciseIds(tx: Transaction): Set<number> {
  return new Set(
    tx
      .select({ id: exercise.id })
      .from(exercise)
      .all()
      .map((row) => row.id),
  );
}
