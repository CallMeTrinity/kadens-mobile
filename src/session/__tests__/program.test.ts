/**
 * Le déroulé d'une séance (KL-29), vérifié sans base ni React (KL-36).
 *
 * `buildProgram` est pur, et c'est délibéré : l'appariement du prévu et du fait
 * est la partie la plus subtile du chantier, et elle doit pouvoir se vérifier
 * seule. Il n'y a donc ici ni SQLite ni rendu — seulement des tableaux entrants
 * et le déroulé qui en sort.
 *
 * La règle d'appariement ne peut pas être autre chose que le **rang** : le
 * contrat ne transporte aucune référence de la série réalisée vers la ligne
 * prescrite (`sourcePrescribedId` vit sur l'exercice, et `position` n'est même
 * pas envoyée). C'est celle que `LogComparator` tient déjà côté serveur, et les
 * deux files — échauffement, travail — existent parce qu'un échauffement
 * prescrit mais non fait décalerait sinon toute la séance d'un cran.
 */

import type { LoggedExerciseRow, LoggedSetRow } from '@/db';
import { buildProgram, setDeviates } from '@/session';
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

beforeEach(() => {
  nextSetId = 0;
});

describe("l'appariement par rang", () => {
  it('coche les lignes de travail dans l’ordre, sans toucher à l’échauffement', () => {
    const line = prescribedExercise(1, {
      sets: [
        { index: 1, type: 'warmup', reps: 10, weightKg: 20, durationSeconds: null },
        { index: 2, type: 'normal', reps: 8, weightKg: 80, durationSeconds: null },
        { index: 3, type: 'normal', reps: 8, weightKg: 80, durationSeconds: null },
      ],
    });

    const program = buildProgram(
      [prescribedBlock(1, [line])],
      [loggedRow()],
      [setRow({ reps: 8, weightKg: 82.5 })],
    );

    const lines = program.blocks[0].groups[0].exercises[0].lines!;

    // La série de travail se pose sur la **première ligne de travail**, pas sur
    // la première ligne tout court.
    expect(lines[0].logged).toBeNull();
    expect(lines[1].logged?.weightKg).toBe(82.5);
    expect(lines.map((candidate) => candidate.actionable)).toEqual([true, false, true]);
    expect(program.done).toBe(1);
    expect(program.total).toBe(3);
  });

  it('range une série faite en plus à la suite, sans produire un « 5 sur 4 »', () => {
    const program = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1)])],
      [loggedRow()],
      [setRow(), setRow(), setRow(), setRow(), setRow({ reps: 5, weightKg: 90 })],
    );

    const exercise = program.blocks[0].groups[0].exercises[0];

    expect(exercise.lines).toHaveLength(5);
    expect(exercise.lines![4].planned).toBeNull();
    expect(exercise.lines![4].logged?.weightKg).toBe(90);
    expect([exercise.done, exercise.total]).toEqual([5, 5]);
  });

  it('range hors programme un réalisé qu’aucune ligne ne réclame', () => {
    const program = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1)])],
      [loggedRow(), loggedRow({ id: 2, sourcePrescribedId: null, position: 1, exerciseId: 303 })],
      [],
    );

    expect(program.extras).toHaveLength(1);
    // Il ne réclame rien : il n'entre ni au numérateur ni au dénominateur, la
    // progression disant ce qu'il reste à faire **du programme**.
    expect(program.extras[0].total).toBe(0);
    expect(program.prescribedCount).toBe(1);
  });
});

describe('un exercice sauté', () => {
  it('sort du décompte au lieu de le bloquer', () => {
    const program = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1), prescribedExercise(2)])],
      [loggedRow({ skipped: true, notes: 'machine occupée' })],
      [],
    );

    // Le laisser au dénominateur ferait une progression qui ne peut plus
    // atteindre son terme.
    expect(program.total).toBe(4);
    expect(program.blocks[0].groups[0].exercises[0].skipped).toBe(true);
  });
});

describe('le remplacement', () => {
  it('se lit sur les références, pas sur les noms', () => {
    const renamed = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1, { name: 'Développé couché' })])],
      [loggedRow({ exerciseId: 101, exerciseName: 'Nom d’avant' })],
      [],
    );

    // Un exercice renommé en bibliothèque n'est pas un remplacement : le nom
    // prescrit est vivant, `exerciseName` n'est qu'un instantané.
    expect(renamed.blocks[0].groups[0].exercises[0].substituted).toBe(false);
    expect(renamed.blocks[0].groups[0].exercises[0].name).toBe('Développé couché');

    const replaced = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1, { name: 'Développé couché' })])],
      [loggedRow({ exerciseId: 202, exerciseName: 'Développé guidé' })],
      [],
    );

    expect(replaced.blocks[0].groups[0].exercises[0].substituted).toBe(true);
    expect(replaced.blocks[0].groups[0].exercises[0].name).toBe('Développé guidé');
  });
});

describe('les supersets', () => {
  it('regroupe des voisins contigus, et sépare deux groupes du même bloc', () => {
    const program = buildProgram(
      [
        prescribedBlock(1, [
          prescribedExercise(1, { groupLabel: 'A1' }),
          prescribedExercise(2, { groupLabel: 'A2' }),
          prescribedExercise(3, { groupLabel: 'B1' }),
          prescribedExercise(4, { groupLabel: 'B2' }),
          prescribedExercise(5, { groupLabel: null }),
        ]),
      ],
      [],
      [],
    );

    // Une lecture par lettre seule recollerait des groupes séparés : c'est la
    // contiguïté qui fait le groupe, comme dans le compositeur web.
    expect(program.blocks[0].groups.map((group) => [group.label, group.exercises.length])).toEqual([
      ['A', 2],
      ['B', 2],
      [null, 1],
    ]);
  });
});

describe('setDeviates', () => {
  it('ne tranche que sur un axe renseigné des deux côtés', () => {
    const [line] = buildProgram(
      [prescribedBlock(1, [prescribedExercise(1)])],
      [loggedRow()],
      [setRow({ reps: 6, weightKg: 80, durationSeconds: null })],
    ).blocks[0].groups[0].exercises[0].lines!;

    expect(setDeviates(line, 'reps')).toBe(true);
    expect(setDeviates(line, 'weightKg')).toBe(false);
    // Une durée absente des deux côtés ne dit rien : un axe muet ne tranche
    // jamais, exactement comme `LogComparator` côté serveur.
    expect(setDeviates(line, 'durationSeconds')).toBe(false);
  });
});
