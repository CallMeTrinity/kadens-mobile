/**
 * L'ordre d'exécution local (KL-52), vérifié là où il compte.
 *
 * Trois choses ne se lisent nulle part ailleurs que dans le comportement.
 *
 * **Ce qu'il change est ce que la barre basse propose.** C'est la raison d'être
 * du ticket : `nextTarget` alterne les membres d'un superset, ce qui n'aide que
 * si on les mène dans l'ordre annoncé. Un déplacement doit donc se voir dans la
 * cible, pas seulement dans un tableau.
 *
 * **Ce qu'il ne change pas est ce qui part au serveur.** `logged_exercise.position`
 * et le document poussé restent dans l'ordre du programme : le web lit la séance
 * comme elle a été prescrite, quoi qu'on ait fait ici.
 *
 * **Un enchaînement est fait de voisins.** C'est la seule règle, et elle suffit :
 * sortir un exercice de son groupe l'en détache sans qu'aucune écriture ait à le
 * prévoir, et l'y ramener l'y remet.
 */

import {
  addExercise,
  allExercises,
  beginWorkout,
  chainExercise,
  checkSet,
  closeWorkout,
  moveExercise,
  nextTarget,
  resetExecutionOrder,
  unchainExercise,
} from '@/session';
import { readScheduleDocument } from '@/sync/document';
import { resetDatabase } from '@/test/database';
import {
  exercisePayload,
  prescribedBlock,
  prescribedExercise,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { exerciseAt, nextLine, programOf } from '@/test/program';

const UUID = '01890000-0000-7000-8000-0000000000e1';

/** Un bloc de trois exercices, dont les deux premiers forment le superset A. */
function openSupersetWorkout(): void {
  seedBootstrap({
    exercises: [101, 102, 103].map((id) => exercisePayload(id)),
    schedule: [
      scheduledWorkoutPayload(UUID, {
        blocks: [
          prescribedBlock(1, [
            prescribedExercise(1, { groupLabel: 'A1' }),
            prescribedExercise(2, { groupLabel: 'A2' }),
            prescribedExercise(3),
          ]),
        ],
      }),
    ],
  });
  beginWorkout(UUID);
}

/** Les noms du déroulé, dans l'ordre affiché. */
function order(): string[] {
  return allExercises(programOf(UUID)).map((exercise) => exercise.name);
}

/** Les rangs d'enchaînement, dans l'ordre affiché. `—` pour un exercice mené seul. */
function ranks(): string[] {
  return allExercises(programOf(UUID)).map((exercise) => exercise.groupLabel ?? '—');
}

beforeEach(() => {
  resetDatabase();
});

describe('sans rien ranger', () => {
  it('laisse le déroulé et les rangs du programme', () => {
    openSupersetWorkout();

    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
    expect(ranks()).toEqual(['A1', 'A2', '—']);
    expect(programOf(UUID).reordered).toBe(false);
  });
});

describe('moveExercise', () => {
  it('déplace l’exercice dans son bloc, et la barre basse suit', () => {
    openSupersetWorkout();

    // Avant : la cible est A1, premier membre du superset.
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 101');

    expect(moveExercise(UUID, programOf(UUID), 'e3', -1)).toBe(true);
    expect(moveExercise(UUID, programOf(UUID), 'e3', -1)).toBe(true);

    expect(order()).toEqual(['Exercice 103', 'Exercice 101', 'Exercice 102']);
    // Le troisième exercice, remonté en tête, est ce que la barre propose : c'est
    // le seul point du ticket, tout le reste en découle.
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 103');
  });

  it('garde l’enchaînement quand on échange ses deux membres', () => {
    openSupersetWorkout();

    expect(moveExercise(UUID, programOf(UUID), 'e2', -1)).toBe(true);

    expect(order()).toEqual(['Exercice 102', 'Exercice 101', 'Exercice 103']);
    // Toujours un superset : la contiguïté n'a pas été rompue, seuls les rangs
    // ont changé de porteur.
    expect(ranks()).toEqual(['A1', 'A2', '—']);
  });

  it('détache l’exercice qu’on sort de son enchaînement, sans rien écrire de plus', () => {
    openSupersetWorkout();

    // A2 descend d'un cran : il n'est plus voisin de A1, donc plus lié à lui.
    expect(moveExercise(UUID, programOf(UUID), 'e2', 1)).toBe(true);

    expect(order()).toEqual(['Exercice 101', 'Exercice 103', 'Exercice 102']);
    expect(ranks()).toEqual(['—', '—', '—']);
  });

  it('refuse de sortir un exercice de sa file', () => {
    openSupersetWorkout();

    expect(moveExercise(UUID, programOf(UUID), 'e1', -1)).toBe(false);
    expect(moveExercise(UUID, programOf(UUID), 'e3', 1)).toBe(false);
    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
  });

  it('ne bouge plus rien une fois la séance close', () => {
    openSupersetWorkout();
    const program = programOf(UUID);

    closeWorkout(UUID);

    // Le déroulé est celui d'avant la clôture : c'est ce que l'écran a en main
    // quand il rejoue un appui parti trop tard.
    expect(moveExercise(UUID, program, 'e3', -1)).toBe(false);
    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
  });
});

describe('chainExercise / unchainExercise', () => {
  it('enchaîne un exercice avec celui qui le précède', () => {
    openSupersetWorkout();

    expect(chainExercise(UUID, programOf(UUID), 'e3')).toBe(true);

    // Les trois n'en font plus qu'un : le troisième a rejoint l'enchaînement de
    // son voisin plutôt que d'en ouvrir un second.
    expect(ranks()).toEqual(['A1', 'A2', 'A3']);
  });

  it('ouvre un enchaînement à deux là où il n’y en avait pas', () => {
    openSupersetWorkout();

    // Le superset du programme est d'abord défait, pour partir de trois exercices
    // menés seuls.
    expect(unchainExercise(UUID, programOf(UUID), 'e2')).toBe(true);
    expect(ranks()).toEqual(['—', '—', '—']);

    expect(chainExercise(UUID, programOf(UUID), 'e3')).toBe(true);
    expect(ranks()).toEqual(['—', 'A1', 'A2']);
  });

  it('refuse d’enchaîner en tête de file : rien ne précède', () => {
    openSupersetWorkout();

    expect(chainExercise(UUID, programOf(UUID), 'e1')).toBe(false);
  });

  it('rend la cible séquentielle une fois le superset défait', () => {
    openSupersetWorkout();
    const first = exerciseAt(UUID, 0);

    checkSet(UUID, first, nextLine(first));

    // Lié, le superset alterne : la deuxième série revient à A2 (`program.ts`).
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 102');

    expect(unchainExercise(UUID, programOf(UUID), 'e2')).toBe(true);

    // Détaché, on finit l'exercice avant de passer au suivant.
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 101');
  });
});

describe('resetExecutionOrder', () => {
  it('rend au déroulé l’ordre et les rangs du programme', () => {
    openSupersetWorkout();

    moveExercise(UUID, programOf(UUID), 'e3', -1);
    chainExercise(UUID, programOf(UUID), 'e1');
    expect(programOf(UUID).reordered).toBe(true);

    expect(resetExecutionOrder(UUID)).toBe(true);

    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
    expect(ranks()).toEqual(['A1', 'A2', '—']);
    expect(programOf(UUID).reordered).toBe(false);
  });
});

describe('ce qui part au serveur', () => {
  it('reste dans l’ordre du programme, quoi qu’on ait rangé', () => {
    openSupersetWorkout();

    // Une série sur chacun des trois, pour qu'ils aient tous une ligne réalisée.
    for (const index of [0, 1, 2]) {
      const exercise = exerciseAt(UUID, index);

      checkSet(UUID, exercise, nextLine(exercise));
    }

    moveExercise(UUID, programOf(UUID), 'e3', -1);
    moveExercise(UUID, programOf(UUID), 'e3', -1);

    // Le déroulé a bien changé de tête…
    expect(order()[0]).toBe('Exercice 103');

    // …et le document poussé, non : `position` n'a pas bougé, le serveur
    // renumérote sur l'ordre de la liste, et `/schedule/{id}` lit la séance comme
    // elle a été prescrite.
    const document = readScheduleDocument(UUID);

    expect(document?.log?.map((entry) => entry.name)).toEqual([
      'Exercice 101',
      'Exercice 102',
      'Exercice 103',
    ]);
  });
});

describe('les exercices hors programme', () => {
  it('forment leur propre file, rangeable et enchaînable', () => {
    seedBootstrap({
      exercises: [201, 202].map((id) => exercisePayload(id)),
      schedule: [scheduledWorkoutPayload(UUID, { freeform: true, blocks: [] })],
    });
    beginWorkout(UUID);

    addExercise(UUID, { id: 201, name: 'Exercice 201' }, 0);
    addExercise(UUID, { id: 202, name: 'Exercice 202' }, 0);

    const second = exerciseAt(UUID, 1);

    expect(moveExercise(UUID, programOf(UUID), second.key, -1)).toBe(true);
    expect(order()).toEqual(['Exercice 202', 'Exercice 201']);

    // Une séance libre n'a que du hors-programme : un superset improvisé doit y
    // tenir, sinon l'alternance n'existe nulle part dans ce mode.
    expect(chainExercise(UUID, programOf(UUID), exerciseAt(UUID, 1).key)).toBe(true);
    expect(ranks()).toEqual(['A1', 'A2']);
  });
});
