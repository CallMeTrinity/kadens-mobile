/**
 * L'exercice bouclé, et celui qui vient de l'être.
 *
 * Le second compte plus qu'il n'y paraît : c'est lui qui écrit « Ensuite » à
 * l'écran, et il doit suivre la série **faite à l'instant**, pas la dernière
 * dans l'ordre du programme — une séance se mène dans le désordre.
 */

import type { LoggedExerciseRow, LoggedSetRow } from '@/db';
import { buildProgram, isWrapped, lastWrapped, type SessionProgram } from '@/session';
import { prescribedBlock, prescribedExercise } from '@/test/fixtures';

const twoSets = (prescribedId: number) =>
  prescribedExercise(prescribedId, {
    sets: [1, 2].map((index) => ({
      index,
      type: 'normal' as const,
      reps: 5,
      weightKg: 90,
      durationSeconds: null,
    })),
  });

function logged(id: number, overrides: Partial<LoggedExerciseRow> = {}): LoggedExerciseRow {
  return {
    id,
    scheduledUuid: 'uuid',
    exerciseId: 100 + id,
    exerciseName: `Exercice ${100 + id}`,
    sourcePrescribedId: id,
    position: id - 1,
    skipped: false,
    notes: null,
    ...overrides,
  };
}

let position = 0;

function done(loggedExerciseId: number, completedAt: string): LoggedSetRow {
  position += 1;

  return {
    uuid: `set-${position}`,
    loggedExerciseId,
    position,
    type: 'normal',
    reps: 5,
    weightKg: 90,
    durationSeconds: null,
    rpe: null,
    completedAt,
  };
}

/** Deux exercices de deux séries, A (`e1`) puis B (`e2`). */
function session(sets: LoggedSetRow[], exercises = [logged(1), logged(2)]): SessionProgram {
  return buildProgram([prescribedBlock(1, [twoSets(1), twoSets(2)])], exercises, sets);
}

function exercise(program: SessionProgram, key: string) {
  const found = program.blocks[0]?.groups
    .flatMap((group) => group.exercises)
    .find((e) => e.key === key);

  if (!found) {
    throw new Error(`exercice ${key} absent`);
  }

  return found;
}

beforeEach(() => {
  position = 0;
});

describe('isWrapped', () => {
  it('attend la dernière série prévue', () => {
    const half = session([done(1, '2026-11-12T10:00:00Z')]);
    const full = session([done(1, '2026-11-12T10:00:00Z'), done(1, '2026-11-12T10:03:00Z')]);

    expect(isWrapped(exercise(half, 'e1'))).toBe(false);
    expect(isWrapped(exercise(full, 'e1'))).toBe(true);
  });

  it("ne boucle pas un exercice sauté, même s'il porte des séries", () => {
    const program = session(
      [done(1, '2026-11-12T10:00:00Z'), done(1, '2026-11-12T10:03:00Z')],
      [logged(1, { skipped: true }), logged(2)],
    );

    expect(isWrapped(exercise(program, 'e1'))).toBe(false);
  });
});

describe('lastWrapped', () => {
  it("désigne l'exercice que la dernière série vient de boucler", () => {
    const program = session([done(1, '2026-11-12T10:00:00Z'), done(1, '2026-11-12T10:03:00Z')]);

    expect(lastWrapped(program)).toBe('e1');
  });

  it("se tait au milieu d'un exercice", () => {
    const program = session([
      done(1, '2026-11-12T10:00:00Z'),
      done(1, '2026-11-12T10:03:00Z'),
      done(2, '2026-11-12T10:06:00Z'),
    ]);

    // A est bouclé, mais la série d'à l'instant est la première de B.
    expect(isWrapped(exercise(program, 'e1'))).toBe(true);
    expect(lastWrapped(program)).toBeNull();
  });

  it("suit l'heure de la série, pas l'ordre du programme", () => {
    // B mené en premier et bouclé, puis A bouclé ensuite : c'est A qui parle.
    const program = session([
      done(2, '2026-11-12T10:00:00Z'),
      done(2, '2026-11-12T10:03:00Z'),
      done(1, '2026-11-12T10:06:00Z'),
      done(1, '2026-11-12T10:09:00Z'),
    ]);

    expect(lastWrapped(program)).toBe('e1');
  });

  it("ne dit rien tant qu'aucune série n'est faite", () => {
    expect(lastWrapped(session([]))).toBeNull();
  });
});
