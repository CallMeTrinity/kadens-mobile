/**
 * Le résumé de clôture (KL-33), et sa règle la plus facile à casser : ce qui
 * entre dans le VOLUME.
 *
 * `buildSessionSummary` est pur, donc vérifiable sans base ni rendu — c'est la
 * raison pour laquelle il a été écrit ainsi. Ce que ces tests protègent, c'est
 * l'accord avec le serveur : le compte de séries annoncé ici doit être celui
 * que `/schedule/{id}` affichera après la synchro. Une divergence ne se verrait
 * pas en développement, seulement en salle, une fois la séance poussée.
 *
 * La frontière est testée avec la règle : `exerciseOutcome()` compte les séries
 * cochées, y compris non chiffrées, exactement comme `LogComparator` — sans quoi
 * une séance tenue se lirait « allégée ».
 */

import type { LoggedExerciseRow, LoggedSetRow } from '@/db';
import { buildProgram, buildSessionSummary, exerciseOutcome, isMeasured } from '@/session';
import { prescribedBlock, prescribedExercise } from '@/test/fixtures';

const BOUNDS = { startedAt: '2026-08-04T08:00:00Z', endedAt: '2026-08-04T09:00:00Z' };

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

/** Une séance d'un exercice de quatre séries prescrites, garnie du réalisé donné. */
function summaryOf(sets: LoggedSetRow[]) {
  return buildSessionSummary(
    buildProgram([prescribedBlock(1, [prescribedExercise(1)])], [loggedRow()], sets),
    BOUNDS,
  );
}

beforeEach(() => {
  nextSetId = 0;
});

describe('isMeasured', () => {
  it('demande une répétition ou une seconde, et rien d’autre', () => {
    expect(isMeasured({ reps: 8, durationSeconds: null })).toBe(true);
    expect(isMeasured({ reps: null, durationSeconds: 60 })).toBe(true);
    expect(isMeasured({ reps: null, durationSeconds: null })).toBe(false);
    expect(isMeasured({ reps: 0, durationSeconds: 0 })).toBe(false);
  });
});

describe('le volume du résumé', () => {
  it('laisse dehors une série cochée sans valeur, et le dit', () => {
    // Deux séries faites, une cochée sans rien saisir, la barre pourtant à 140 :
    // la charge seule ne fait pas du volume, et le serveur l'écartera aussi.
    const summary = summaryOf([
      setRow(),
      setRow(),
      setRow({ reps: null, weightKg: 140 }),
      setRow({ reps: 0, weightKg: 140 }),
    ]);

    expect(summary.workingSets).toBe(2);
    expect(summary.unmeasuredSets).toBe(2);
    // 8 × 80 × 2 : les deux séries vides n'ajoutent rien.
    expect(summary.tonnageKg).toBe(1280);
  });

  it('garde une série en durée, qui n’a pas de répétitions', () => {
    const summary = summaryOf([
      setRow({ reps: null, weightKg: null, durationSeconds: 60 }),
      setRow({ reps: null, weightKg: null, durationSeconds: 45 }),
    ]);

    expect(summary.workingSets).toBe(2);
    expect(summary.unmeasuredSets).toBe(0);
    expect(summary.tonnageKg).toBe(0);
  });

  it('compte l’échauffement à part, comme avant', () => {
    const summary = summaryOf([setRow({ type: 'warmup', reps: 10, weightKg: 40 }), setRow()]);

    expect(summary.warmupSets).toBe(1);
    expect(summary.workingSets).toBe(1);
    expect(summary.unmeasuredSets).toBe(0);
  });
});

describe('la frontière : le verdict d’un exercice', () => {
  it('compte la série cochée sans valeur, pour ne pas dire « allégé » d’une séance tenue', () => {
    // Un exercice dont AUCUN axe ne parle des deux côtés : ni charge, ni
    // répétitions, ni durée. Le nombre de séries est alors le seul juge — c'est
    // le cas qui isole la règle. Trois prescrites, trois cochées : tenu. Si le
    // verdict appliquait la règle du volume, il n'en verrait aucune et lirait
    // « allégé » une séance pourtant faite en entier.
    const blank = { reps: null, weightKg: null, durationSeconds: null };
    const line = prescribedExercise(1, {
      sets: [1, 2, 3].map((index) => ({ index, type: 'normal' as const, ...blank })),
    });
    const program = buildProgram(
      [prescribedBlock(1, [line])],
      [loggedRow()],
      [setRow(blank), setRow(blank), setRow(blank)],
    );
    const exercise = program.blocks[0].groups[0].exercises[0];

    expect(buildSessionSummary(program, BOUNDS).workingSets).toBe(0);
    expect(buildSessionSummary(program, BOUNDS).unmeasuredSets).toBe(3);
    expect(exerciseOutcome(exercise).state).toBe('held');
  });
});
