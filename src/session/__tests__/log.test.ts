/**
 * Cocher le réalisé (KL-29), vérifié hors réseau (KL-36).
 *
 * Deux règles tiennent ce fichier et aucune n'est visible dans les types.
 *
 * **Écrire du réalisé, c'est empiler sa mutation dans la même transaction.**
 * Sans elle, l'app tuée entre les deux laisserait un réalisé que rien ne signale
 * comme non poussé, et le pull suivant l'effacerait sans un mot. Chaque test
 * d'écriture regarde donc la file autant que la base.
 *
 * **Cocher est séquentiel dans sa file.** Le contrat ne transporte aucune
 * référence de la série vers la ligne prescrite : l'appariement se fait par rang,
 * dans deux files séparées (échauffement, travail). Une coche au milieu du vide
 * ne survivrait pas à un aller-retour serveur — elle repartirait comme « une
 * série faite » et reviendrait appariée à la première ligne.
 *
 * Rien ici ne touche au réseau, et le socle des tests le vérifie : un `fetch`
 * appelé depuis une écriture locale ferait échouer la suite.
 */

import { beginWorkout, checkSet, closeWorkout, setCardioDone, uncheckSet } from '@/session';
import { listMutations } from '@/sync';
import { resetDatabase } from '@/test/database';
import {
  prescribedBlock,
  prescribedExercise,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { exerciseAt, nextLine, programOf } from '@/test/program';

const UUID = '01890000-0000-7000-8000-0000000000e1';

/** Une séance de force ouverte, un exercice, quatre séries de huit à 80 kg. */
function openStrengthWorkout(): void {
  seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
  beginWorkout(UUID);
}

beforeEach(() => {
  resetDatabase();
});

describe('checkSet', () => {
  it('consigne la série aux valeurs prescrites et empile sa mutation', () => {
    openStrengthWorkout();

    const exercise = exerciseAt(UUID);

    expect(checkSet(UUID, exercise, nextLine(exercise))).toBe(true);

    const line = programOf(UUID).blocks[0].groups[0].exercises[0].lines?.[0];

    expect(line?.logged).toMatchObject({ reps: 8, weightKg: 80, type: 'normal' });
    // Le RPE se ressent, il ne se prescrit pas : rien à recopier.
    expect(line?.logged?.rpe).toBeNull();
    expect(line?.logged?.completedAt).not.toBeNull();
    expect(listMutations()).toHaveLength(1);
  });

  it('n’empile qu’une mutation pour toute la séance', () => {
    openStrengthWorkout();

    for (let index = 0; index < 4; index += 1) {
      const exercise = exerciseAt(UUID);

      checkSet(UUID, exercise, nextLine(exercise));
    }

    expect(exerciseAt(UUID).done).toBe(4);
    // Le ticket le demande mot pour mot : inutile d'en empiler une par série.
    expect(listMutations()).toHaveLength(1);
  });

  it('refuse une ligne qui n’est pas la prochaine de sa file', () => {
    openStrengthWorkout();

    const exercise = exerciseAt(UUID);
    const third = exercise.lines?.[2];

    expect(third?.actionable).toBe(false);
    expect(checkSet(UUID, exercise, third!)).toBe(false);
    expect(listMutations()).toHaveLength(0);
  });

  it('tient l’échauffement dans sa propre file', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID, {
          blocks: [
            prescribedBlock(1, [
              prescribedExercise(1, {
                sets: [
                  { index: 1, type: 'warmup', reps: 10, weightKg: 20, durationSeconds: null },
                  { index: 2, type: 'normal', reps: 8, weightKg: 80, durationSeconds: null },
                  { index: 3, type: 'normal', reps: 8, weightKg: 80, durationSeconds: null },
                ],
              }),
            ]),
          ],
        }),
      ],
    });
    beginWorkout(UUID);

    const lines = exerciseAt(UUID).lines ?? [];

    // Un échauffement prescrit mais non fait décalerait sinon toutes les séries
    // de travail d'un cran, et une séance tenue se lirait « allégée ».
    expect(lines.map((line) => line.actionable)).toEqual([true, true, false]);

    const exercise = exerciseAt(UUID);

    checkSet(UUID, exercise, exercise.lines![1]);

    expect(exerciseAt(UUID).lines?.map((line) => line.actionable)).toEqual([true, false, true]);
  });

  it('n’écrit pas dans une séance qui n’a pas commencé', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    const exercise = exerciseAt(UUID);

    expect(checkSet(UUID, exercise, nextLine(exercise))).toBe(false);
    expect(listMutations()).toHaveLength(0);
  });

  it('n’écrit plus dans une séance close', () => {
    openStrengthWorkout();

    const exercise = exerciseAt(UUID);

    closeWorkout(UUID);

    // Pas de reprise après clôture : une série qui arriverait après coup
    // rouvrirait un fait déjà envoyé.
    expect(checkSet(UUID, exercise, nextLine(exercise))).toBe(false);
    expect(exerciseAt(UUID).done).toBe(0);
  });
});

describe('uncheckSet', () => {
  it('retire la dernière série de sa file et l’exercice devenu muet', () => {
    openStrengthWorkout();

    const exercise = exerciseAt(UUID);

    checkSet(UUID, exercise, nextLine(exercise));

    const after = exerciseAt(UUID);
    const line = after.lines!.find((candidate) => candidate.undoable)!;

    expect(uncheckSet(UUID, after, line)).toBe(true);

    // Un `logged_exercise` sans série, sans note et non sauté signifierait
    // « fait, zéro série » une fois poussé, ce qui est faux.
    expect(exerciseAt(UUID).logged).toBeNull();
  });

  it('empile une mutation même quand il ne reste rien', () => {
    openStrengthWorkout();

    const exercise = exerciseAt(UUID);

    checkSet(UUID, exercise, nextLine(exercise));

    const after = exerciseAt(UUID);

    uncheckSet(
      UUID,
      after,
      after.lines!.find((line) => line.undoable)!,
    );

    // `log: []` est ce qui efface le réalisé côté serveur : ne rien empiler
    // laisserait le pull suivant remettre la série qu'on vient de retirer.
    expect(listMutations()).toHaveLength(1);
  });

  it('ne décoche que la dernière de sa file', () => {
    openStrengthWorkout();

    for (let index = 0; index < 2; index += 1) {
      const exercise = exerciseAt(UUID);

      checkSet(UUID, exercise, nextLine(exercise));
    }

    const exercise = exerciseAt(UUID);

    expect(exercise.lines?.map((line) => line.undoable)).toEqual([false, true, false, false]);
    expect(uncheckSet(UUID, exercise, exercise.lines![0])).toBe(false);
  });
});

describe('setCardioDone', () => {
  it('écrit un exercice réalisé sans aucune série', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID, {
          blocks: [
            prescribedBlock(1, [
              prescribedExercise(1, { type: 'distance_pace', sets: null, summary: '10 km' }),
            ]),
          ],
        }),
      ],
    });
    beginWorkout(UUID);

    const exercise = exerciseAt(UUID);

    expect(exercise.lines).toBeNull();
    expect(setCardioDone(UUID, exercise, true)).toBe(true);

    const after = exerciseAt(UUID);

    // Le serveur le lit comme « rien à signaler » : un prescrit sans séries à
    // apparier n'a pas d'écart mesurable.
    expect(after.logged).not.toBeNull();
    expect(after.done).toBe(1);
    expect(listMutations()).toHaveLength(1);
  });

  it('refuse un exercice qui a des séries à saisir', () => {
    openStrengthWorkout();

    expect(setCardioDone(UUID, exerciseAt(UUID), true)).toBe(false);
  });
});
