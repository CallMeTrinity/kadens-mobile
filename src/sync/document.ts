import { asc, eq, inArray } from 'drizzle-orm';

import type { LoggedExerciseInput, LoggedSetInput, ScheduleUpsertInput } from '@/api';
import { db, loggedExercise, loggedSet, scheduledWorkout, type Writer } from '@/db';

/**
 * Le document d'une séance datée, relu dans la base locale au moment du push
 * (KL-27).
 *
 * ## Pourquoi il se relit au lieu d'être figé dans la file
 *
 * Parce que le réalisé bouge jusqu'à la clôture. Une mutation empilée à la
 * première série et poussée dix minutes plus tard doit envoyer la séance telle
 * qu'elle est **au moment de l'envoi**, pas telle qu'elle était à la première
 * série. C'est ce qui permet à `mutation_queue` de ne porter qu'un uuid, donc à
 * dix modifications de ne produire qu'un envoi.
 *
 * ## Ce qu'on envoie, et ce qu'on tait
 *
 * Le contrat (§4.1) partage l'autorité **champ par champ** : `date` et `title` ne
 * servent qu'à la création, `status` ne peut que clôturer, `position` et les
 * champs dérivés appartiennent au serveur. On envoie donc le document complet du
 * réalisé, et de la programmation seulement ce qui sert à créer une séance libre.
 *
 * Deux choix méritent d'être écrits :
 *
 * - **`log` part toujours, même vide.** Il *remplace* le réalisé côté serveur :
 *   omettre un tableau vide rendrait impossible d'effacer le dernier exercice
 *   d'une séance. Le mobile étant la seule source d'écriture du réalisé, un vide
 *   local est un vide voulu.
 * - **`status` ne part que s'il vaut `done`.** Les autres valeurs passent la
 *   validation sans rien faire ; les envoyer quand même donnerait à lire un
 *   document qui prétend programmer, alors qu'il ne le peut pas.
 */
export function readScheduleDocument(
  uuid: string,
  writer: Writer = db,
): ScheduleUpsertInput | null {
  const workout = writer
    .select()
    .from(scheduledWorkout)
    .where(eq(scheduledWorkout.uuid, uuid))
    .get();

  if (!workout) {
    return null;
  }

  return {
    uuid,
    date: workout.date,
    title: workout.title,
    // Rien ne déclôture côté serveur : seul `done` a un effet, le reste est un
    // bruit que le contrat tolère mais qu'on n'a aucune raison d'émettre.
    ...(workout.status === 'done' ? { status: 'done' as const } : {}),
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    completionNotes: workout.completionNotes,
    log: readLog(uuid, writer),
  };
}

function readLog(uuid: string, writer: Writer): LoggedExerciseInput[] {
  const exercises = writer
    .select()
    .from(loggedExercise)
    .where(eq(loggedExercise.scheduledUuid, uuid))
    .orderBy(asc(loggedExercise.position))
    .all();

  if (exercises.length === 0) {
    return [];
  }

  // Toutes les séries en une requête : un `SELECT` par exercice ferait dix
  // requêtes pour une séance ordinaire, à chaque tentative de push, y compris
  // celles qui échouent.
  const sets = writer
    .select()
    .from(loggedSet)
    .where(
      inArray(
        loggedSet.loggedExerciseId,
        exercises.map((row) => row.id),
      ),
    )
    .orderBy(asc(loggedSet.position))
    .all();

  const byExercise = new Map<number, LoggedSetInput[]>();

  for (const set of sets) {
    const list = byExercise.get(set.loggedExerciseId) ?? [];

    list.push({
      uuid: set.uuid,
      type: set.type,
      reps: set.reps,
      weightKg: set.weightKg,
      durationSeconds: set.durationSeconds,
      rpe: set.rpe,
      completedAt: set.completedAt,
    });
    byExercise.set(set.loggedExerciseId, list);
  }

  return exercises.map((row) => ({
    exerciseId: row.exerciseId,
    // Le nom part **toujours**, pas seulement quand la référence manque. C'est le
    // snapshot pris au moment du log : un exercice supprimé de la bibliothèque
    // entre-temps laisse `exerciseId` à null (SET NULL), et sans le nom le
    // serveur refuserait la ligne en 422 — le réalisé serait bloqué en file pour
    // une raison qu'il ne peut plus corriger.
    name: row.exerciseName,
    sourcePrescribedId: row.sourcePrescribedId,
    skipped: row.skipped,
    notes: row.notes,
    sets: byExercise.get(row.id) ?? [],
  }));
}
