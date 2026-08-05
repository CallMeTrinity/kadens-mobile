/**
 * Le déroulé d'une séance, lu comme l'écran le lit (KL-36).
 *
 * Les fonctions d'écriture de `@/session` prennent un `SessionExercise` et une
 * `SessionSetLine`, pas des identifiants : elles reçoivent ce que l'écran a sous
 * les yeux. Un test doit donc le construire de la même façon — les trois mêmes
 * requêtes, le même `buildProgram` — sinon il exercerait un appariement de son
 * cru, et l'appariement est justement la partie subtile.
 *
 * Le déroulé se **relit après chaque écriture**. C'est la règle de l'écran
 * (`findExercise` / `findSetLine` retiennent une clé, jamais l'objet) et elle
 * vaut ici pour la même raison : un objet gardé d'avant décrit la séance telle
 * qu'elle était.
 */

import {
  allExercises,
  buildProgram,
  loggedExercisesQuery,
  loggedSetsOfWorkoutQuery,
  prescribedSnapshotQuery,
  withDraftSets,
  type SessionExercise,
  type SessionProgram,
  type SessionSetLine,
} from '@/session';

export function programOf(uuid: string): SessionProgram {
  return buildProgram(
    prescribedSnapshotQuery(uuid).all()[0]?.blocks ?? [],
    loggedExercisesQuery(uuid).all(),
    loggedSetsOfWorkoutQuery(uuid).all(),
  );
}

/** Le n-ième exercice du déroulé, blocs puis hors programme. */
export function exerciseAt(uuid: string, index = 0): SessionExercise {
  return at(programOf(uuid), index, uuid);
}

/**
 * Le même exercice, sa série annoncée posée : ce que l'écran a sous les yeux
 * après un appui sur « + Série ».
 *
 * L'écran tient les clés en mémoire et les projette au rendu (`withDraftSets`) :
 * un test qui fabriquerait la ligne à la main exercerait sa propre idée du
 * brouillon, pas celle de l'app.
 */
export function draftedExerciseAt(uuid: string, index = 0): SessionExercise {
  const program = programOf(uuid);
  const exercise = at(program, index, uuid);

  return at(withDraftSets(program, new Set([exercise.key])), index, uuid);
}

function at(program: SessionProgram, index: number, uuid: string): SessionExercise {
  const exercise = allExercises(program)[index];

  if (!exercise) {
    throw new Error(`Aucun exercice au rang ${index} dans la séance ${uuid}.`);
  }

  return exercise;
}

/** La prochaine série cochable d'un exercice, celle que l'écran propose. */
export function nextLine(exercise: SessionExercise): SessionSetLine {
  const line = exercise.lines?.find((candidate) => candidate.actionable);

  if (!line) {
    throw new Error(`Aucune série cochable sur « ${exercise.name} ».`);
  }

  return line;
}
