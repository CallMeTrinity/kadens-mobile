/**
 * La carte musculaire de clôture, et les deux règles qu'elle hérite du serveur.
 *
 * `buildBodyLoad` est pur, comme le résumé qu'il complète : ce qui se vérifie ici
 * est le **comptage**, pas le dessin. Et le comptage doit être celui de
 * `RegionBreakdown` (Symfony) — une série pour chaque zone de l'exercice, une
 * part calculée sur le total attribué. Une divergence produirait une carte et une
 * barre empilée web qui racontent deux séances différentes.
 *
 * Le périmètre est celui de `summary.ts` : échauffement dehors, exercice sauté
 * dehors, série cochée sans valeur dehors.
 */

import type { LoggedExerciseRow, LoggedSetRow, TargetArea } from '@/db';
import { buildBodyLoad, buildProgram, type ExerciseAreaBook } from '@/session';
import { prescribedBlock, prescribedExercise } from '@/test/fixtures';

let nextSetId = 0;

function loggedRow(overrides: Partial<LoggedExerciseRow> = {}): LoggedExerciseRow {
  return {
    id: 1,
    scheduledUuid: 'uuid',
    exerciseId: 101,
    exerciseName: 'Exercice 101',
    sourcePrescribedId: 1,
    position: 0,
    skipped: false,
    notes: null,
    ...overrides,
  };
}

function setRow(overrides: Partial<LoggedSetRow> = {}): LoggedSetRow {
  nextSetId += 1;

  return {
    uuid: `set-${nextSetId}`,
    loggedExerciseId: 1,
    position: nextSetId,
    type: 'normal',
    reps: 8,
    weightKg: 80,
    durationSeconds: null,
    rpe: null,
    completedAt: '2026-08-04T08:00:00Z',
    ...overrides,
  };
}

function book(entries: Record<number, TargetArea[]>): ExerciseAreaBook {
  return new Map(Object.entries(entries).map(([id, areas]) => [Number(id), areas]));
}

/** Une séance d'un exercice (101) de quatre séries prescrites, garnie du réalisé donné. */
function loadOf(sets: LoggedSetRow[], areas: ExerciseAreaBook) {
  return buildBodyLoad(
    buildProgram([prescribedBlock(1, [prescribedExercise(1)])], [loggedRow()], sets),
    areas,
  );
}

beforeEach(() => {
  nextSetId = 0;
});

describe('la ventilation par zone', () => {
  it('attribue chaque série à CHAQUE zone de l’exercice', () => {
    const load = loadOf([setRow(), setRow()], book({ 101: ['chest', 'triceps', 'shoulders'] }));

    expect(load.areas.map((area) => [area.area, area.sets])).toEqual([
      ['chest', 2],
      ['triceps', 2],
      ['shoulders', 2],
    ]);
    // Six attributions pour deux séries faites : c'est la règle, pas un bug.
    expect(load.attributed).toBe(6);
  });

  it('calcule la part sur le total attribué, jamais sur les séries faites', () => {
    const load = loadOf([setRow(), setRow()], book({ 101: ['chest', 'triceps'] }));

    // Sur les séries faites, chaque zone pèserait 100 % et le total 200.
    expect(load.areas.map((area) => area.percent)).toEqual([50, 50]);
  });

  it('trie du plus chargé au moins chargé', () => {
    const program = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1), prescribedExercise(2)])],
      [loggedRow(), loggedRow({ id: 2, exerciseId: 102, sourcePrescribedId: 2, position: 1 })],
      [setRow(), setRow(), setRow({ loggedExerciseId: 2 })],
    );

    const load = buildBodyLoad(program, book({ 101: ['chest'], 102: ['quadriceps'] }));

    expect(load.areas.map((area) => area.area)).toEqual(['chest', 'quadriceps']);
  });
});

describe('le périmètre, hérité du résumé', () => {
  it('ne compte ni l’échauffement ni une série cochée sans valeur', () => {
    const load = loadOf(
      [setRow({ type: 'warmup' }), setRow({ reps: null, weightKg: 140 }), setRow()],
      book({ 101: ['chest'] }),
    );

    expect(load.areas).toEqual([{ area: 'chest', sets: 1, percent: 100, level: 3 }]);
  });

  it('ne compte rien d’un exercice sauté, même s’il porte des séries', () => {
    const program = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1)])],
      [loggedRow({ skipped: true })],
      [setRow()],
    );

    expect(buildBodyLoad(program, book({ 101: ['chest' as const] })).areas).toEqual([]);
  });

  it('ne compte rien d’un cardio, qui n’a pas de séries à saisir', () => {
    const program = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1, { type: 'distance_pace', sets: [] })])],
      [loggedRow()],
      [],
    );

    expect(buildBodyLoad(program, book({ 101: ['quadriceps' as const] })).areas).toEqual([]);
  });
});

describe('ce qui ne se peint pas', () => {
  it('compte « corps entier » à part, sans allumer aucune zone', () => {
    const load = loadOf([setRow(), setRow()], book({ 101: ['full_body'] }));

    expect(load.areas).toEqual([]);
    expect(load.fullBody).toBe(2);
    expect(load.attributed).toBe(0);
  });

  it('peint les autres zones d’un exercice qui porte aussi « corps entier »', () => {
    const load = loadOf([setRow()], book({ 101: ['full_body', 'abs'] }));

    expect(load.areas.map((area) => area.area)).toEqual(['abs']);
    expect(load.fullBody).toBe(1);
  });

  it('met à part les séries d’un exercice qu’aucune zone ne décrit', () => {
    // Exercice sorti de la bibliothèque locale : la carte reste vide, mais le
    // travail fait ne disparaît pas du décompte.
    const load = loadOf([setRow(), setRow()], book({}));

    expect(load.areas).toEqual([]);
    expect(load.unmapped).toBe(2);
  });
});

describe('les paliers de teinte', () => {
  it('sont relatifs à la zone la plus chargée de la séance', () => {
    const program = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1), prescribedExercise(2), prescribedExercise(3)])],
      [
        loggedRow(),
        loggedRow({ id: 2, exerciseId: 102, sourcePrescribedId: 2, position: 1 }),
        loggedRow({ id: 3, exerciseId: 103, sourcePrescribedId: 3, position: 2 }),
      ],
      [
        // 6 séries sur les pectoraux, 3 sur les quadriceps, 1 sur les mollets.
        ...Array.from({ length: 6 }, () => setRow()),
        ...Array.from({ length: 3 }, () => setRow({ loggedExerciseId: 2 })),
        setRow({ loggedExerciseId: 3 }),
      ],
    );

    const load = buildBodyLoad(
      program,
      book({ 101: ['chest'], 102: ['quadriceps'], 103: ['calves'] }),
    );

    expect(load.areas.map((area) => area.level)).toEqual([3, 2, 1]);
  });

  it('met tout au maximum quand tout est à égalité', () => {
    // Une série partout, c'est une séance également répartie : rien ne justifie
    // qu'une zone se dessine plus pâle qu'une autre.
    const load = loadOf([setRow()], book({ 101: ['chest', 'triceps'] }));

    expect(load.areas.map((area) => area.level)).toEqual([3, 3]);
  });
});
