/**
 * Le record battu en séance, et surtout ce qui n'en est pas un.
 *
 * `sessionRecords` est pur, donc vérifiable sans base ni rendu. Ce que ces tests
 * protègent est l'accord avec le serveur : la couronne doit se poser exactement
 * sur ce que `PerformanceHistory` appellerait un record après la synchro. Une
 * divergence ne se verrait pas ici mais en salle, sur une ligne fêtée à tort.
 *
 * Les cas négatifs pèsent plus lourd que les positifs, et c'est voulu : annoncer
 * un record qui n'en est pas est bien pire que de n'en annoncer aucun.
 */

import type { ExerciseHistoryRow, LoggedExerciseRow, LoggedSetRow, PerformanceBest } from '@/db';
import { beatsBest, buildProgram, recordGain, sessionRecords } from '@/session';
import { prescribedBlock, prescribedExercise } from '@/test/fixtures';

/** L'identifiant de bibliothèque que `prescribedExercise(1)` travaille. */
const EXERCISE = 101;

let nextSetId = 0;

function loggedRow(overrides: Partial<LoggedExerciseRow> = {}): LoggedExerciseRow {
  return {
    id: 1,
    scheduledUuid: 'uuid',
    exerciseId: EXERCISE,
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

/** La marque à battre : huit répétitions à 80 kg, il y a une semaine. */
function best(overrides: Partial<PerformanceBest> = {}): PerformanceBest {
  return {
    date: '2026-07-28',
    type: 'normal',
    reps: 8,
    weightKg: 80,
    durationSeconds: null,
    ...overrides,
  };
}

function historyOf(entry: PerformanceBest | null): Map<number, ExerciseHistoryRow> {
  return new Map([[EXERCISE, { exerciseId: EXERCISE, last: null, best: entry }]]);
}

/**
 * Une séance d'un exercice, garnie du réalisé donné, lue contre l'historique
 * donné. Rend les séries marquées écrites « charge × répétitions ».
 *
 * Ni la clé de ligne ni son rang : une ligne appariée porte la clé du prescrit,
 * pas l'uuid du réalisé, et le rang se compte par file (l'échauffement a la
 * sienne). Un test qui écrirait l'une ou l'autre vérifierait l'appariement
 * plutôt que le record.
 */
function recordsOf(
  sets: LoggedSetRow[],
  history: Map<number, ExerciseHistoryRow>,
  logged: LoggedExerciseRow = loggedRow(),
): string[] {
  const program = buildProgram([prescribedBlock(1, [prescribedExercise(1)])], [logged], sets);
  const marked = new Set([...sessionRecords(program, history).values()].map((r) => r.lineKey));
  const lines = program.blocks[0]?.groups[0]?.exercises[0]?.lines ?? [];

  return lines
    .filter((line) => marked.has(line.key))
    .map((line) => `${line.logged?.weightKg} × ${line.logged?.reps}`);
}

beforeEach(() => {
  nextSetId = 0;
});

describe('beatsBest', () => {
  it('demande de faire mieux, pas aussi bien', () => {
    expect(beatsBest(setRow({ weightKg: 85 }), best())).toBe(true);
    expect(beatsBest(setRow({ weightKg: 80, reps: 9 }), best())).toBe(true);
    expect(beatsBest(setRow({ weightKg: 80, reps: 8 }), best())).toBe(false);
    expect(beatsBest(setRow({ weightKg: 75, reps: 20 }), best())).toBe(false);
  });

  it("ne voit rien à battre là où il n'y a pas de marque", () => {
    // Une première charge est une première, pas un record — la règle de
    // `TrainingStats::records()`. Sans elle, chaque exercice découvert
    // s'annoncerait comme un exploit.
    expect(beatsBest(setRow({ weightKg: 200 }), null)).toBe(false);
  });

  it("écarte l'échauffement, si lourd soit-il", () => {
    expect(beatsBest(setRow({ type: 'warmup', weightKg: 200 }), best())).toBe(false);
  });

  it('écarte une série cochée sans valeur', () => {
    // 200 kg × 0 rep, c'est une barre qu'on n'a pas soulevée. La charge seule ne
    // sauve pas la série, exactement comme pour le volume (`isMeasured`).
    expect(beatsBest(setRow({ weightKg: 200, reps: 0 }), best())).toBe(false);
    expect(beatsBest(setRow({ weightKg: 200, reps: null }), best())).toBe(false);
  });

  it('écarte une série sans kilos', () => {
    // Au poids du corps il n'y a pas de record côté serveur : `best` y est nul,
    // et une charge nulle ne se distingue pas d'une charge absente.
    expect(beatsBest(setRow({ weightKg: null, reps: 30 }), best())).toBe(false);
    expect(beatsBest(setRow({ weightKg: 0, reps: 30 }), best())).toBe(false);
  });

  it('accepte les autres types de série', () => {
    // Le serveur n'exclut que l'échauffement : une dégressive, un drop set ou
    // une série menée à l'échec comptent comme n'importe quelle série de travail.
    expect(beatsBest(setRow({ type: 'to_failure', weightKg: 85 }), best())).toBe(true);
    expect(beatsBest(setRow({ type: 'drop_set', weightKg: 85 }), best())).toBe(true);
  });
});

describe('sessionRecords', () => {
  it('marque la série qui dépasse la marque', () => {
    expect(recordsOf([setRow(), setRow({ weightKg: 85 })], historyOf(best()))).toEqual(['85 × 8']);
  });

  it("n'en marque qu'une quand plusieurs dépassent", () => {
    // Trois séries au-dessus de l'ancienne marque, ce n'est pas trois records :
    // c'est un record, celui de la meilleure.
    const sets = [setRow({ weightKg: 85 }), setRow({ weightKg: 90 }), setRow({ weightKg: 87.5 })];

    expect(recordsOf(sets, historyOf(best()))).toEqual(['90 × 8']);
  });

  it('départage deux séries de même charge par les répétitions', () => {
    const sets = [setRow({ weightKg: 85, reps: 6 }), setRow({ weightKg: 85, reps: 10 })];

    expect(recordsOf(sets, historyOf(best()))).toEqual(['85 × 10']);
  });

  it('ne marque rien quand la séance reste sous la marque', () => {
    expect(recordsOf([setRow(), setRow()], historyOf(best()))).toEqual([]);
  });

  it("ne marque rien sur un exercice dont on n'a pas de record", () => {
    expect(recordsOf([setRow({ weightKg: 200 })], historyOf(null))).toEqual([]);
    expect(recordsOf([setRow({ weightKg: 200 })], new Map())).toEqual([]);
  });

  it('ne marque rien sur un exercice sauté', () => {
    // Sauté, c'est réglé : ses séries abandonnées ne portent aucun volume, elles
    // ne portent pas non plus de record.
    const sets = [setRow({ weightKg: 200 })];

    expect(recordsOf(sets, historyOf(best()), loggedRow({ skipped: true }))).toEqual([]);
  });

  it('laisse un échauffement lourd hors du décompte, sans masquer la série qui suit', () => {
    const sets = [setRow({ type: 'warmup', weightKg: 200 }), setRow({ weightKg: 85 })];

    expect(recordsOf(sets, historyOf(best()))).toEqual(['85 × 8']);
  });
});

describe('le record retenu', () => {
  function onlyRecord(sets: LoggedSetRow[], mark: PerformanceBest) {
    const program = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1)])],
      [loggedRow()],
      sets,
    );
    const records = [...sessionRecords(program, historyOf(mark)).values()];

    expect(records).toHaveLength(1);

    return records[0];
  }

  it('garde la marque battue, pas celle que la série vient de poser', () => {
    const record = onlyRecord([setRow({ weightKg: 85, reps: 5 })], best());

    expect(record.weightKg).toBe(85);
    expect(record.reps).toBe(5);
    expect(record.previous.weightKg).toBe(80);
  });

  it('dit le gain en kilos quand la charge monte', () => {
    expect(recordGain(onlyRecord([setRow({ weightKg: 82.5 })], best()))).toEqual({
      axis: 'weight',
      weightKg: 2.5,
    });
  });

  it('arrondit le gain au centième, sans traîner de bruit binaire', () => {
    expect(recordGain(onlyRecord([setRow({ weightKg: 60.3 })], best({ weightKg: 60 })))).toEqual({
      axis: 'weight',
      weightKg: 0.3,
    });
  });

  it('dit le gain en répétitions à charge égale', () => {
    expect(recordGain(onlyRecord([setRow({ weightKg: 80, reps: 10 })], best()))).toEqual({
      axis: 'reps',
      reps: 2,
    });
  });
});
