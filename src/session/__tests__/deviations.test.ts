/**
 * Dévier d'une séance (KL-30), vérifié sur ses gardes (KL-36).
 *
 * Trois d'entre elles ne se lisent nulle part ailleurs que dans le comportement.
 *
 * **Les bornes du contrat sont tenues à l'écriture.** Un document hors bornes ne
 * serait pas refusé au moment de la saisie mais au push, en `422`, sur un
 * réalisé déjà consigné — et le compteur d'échecs le marquerait au bout de cinq
 * essais. Une valeur impossible à saisir vaut mieux qu'une séance bloquée.
 *
 * **On ne réattribue pas des séries déjà faites à un autre exercice.** Elles ont
 * été faites sur la machine d'origine, et finiraient dans l'historique et les
 * records de la mauvaise.
 *
 * **Sauter et remplacer sont des déclarations.** Elles survivent au nettoyage de
 * l'exercice devenu vide : les effacer parce qu'il n'y a plus de série
 * effacerait ce que l'athlète a dit.
 */

import {
  addExercise,
  beginWorkout,
  canReplaceExercise,
  checkSet,
  deleteSet,
  removeExercise,
  replaceExercise,
  setExerciseState,
  updateSet,
} from '@/session';
import { listMutations } from '@/sync';
import { resetDatabase } from '@/test/database';
import {
  exercisePayload,
  prescribedBlock,
  prescribedExercise,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { draftedExerciseAt, exerciseAt, nextLine, programOf } from '@/test/program';

const UUID = '01890000-0000-7000-8000-0000000000f1';

function openStrengthWorkout(): void {
  seedBootstrap({
    exercises: [exercisePayload(101), exercisePayload(202, { name: 'Développé guidé' })],
    schedule: [scheduledWorkoutPayload(UUID)],
  });
  beginWorkout(UUID);
}

/** Coche la prochaine série, et rend le déroulé qui en résulte. */
function checkNext(): void {
  const exercise = exerciseAt(UUID);

  checkSet(UUID, exercise, nextLine(exercise));
}

/**
 * Consigne une série de plus sur un exercice : annoncée, puis cochée. C'est le
 * seul chemin depuis que « + Série » n'écrit plus rien de lui-même.
 */
function checkExtraSet(index: number): void {
  const exercise = draftedExerciseAt(UUID, index);

  checkSet(
    UUID,
    exercise,
    exercise.lines!.find((line) => line.draft)!,
  );
}

beforeEach(() => {
  resetDatabase();
});

describe('updateSet', () => {
  it('corrige les valeurs sans toucher à l’heure de la série', () => {
    openStrengthWorkout();
    checkNext();

    const before = exerciseAt(UUID).lines![0];

    expect(
      updateSet(UUID, before, { reps: 6, weightKg: 82.5, durationSeconds: null, rpe: 9 }),
    ).toBe(true);

    const after = exerciseAt(UUID).lines![0];

    expect(after.logged).toMatchObject({ reps: 6, weightKg: 82.5, rpe: 9 });
    // C'est l'heure où la série a été faite, pas celle où on a corrigé sa charge.
    expect(after.logged?.completedAt).toBe(before.logged?.completedAt);
  });

  it('ramène une saisie hors bornes dans ce que le serveur accepte', () => {
    openStrengthWorkout();
    checkNext();

    updateSet(UUID, exerciseAt(UUID).lines![0], {
      reps: 300,
      weightKg: 1200,
      durationSeconds: null,
      rpe: 12,
    });

    expect(exerciseAt(UUID).lines![0].logged).toMatchObject({
      reps: 200,
      weightKg: 1000,
      rpe: 10,
    });
  });

  it('refuse une ligne qui n’a pas encore de réalisé', () => {
    openStrengthWorkout();

    const line = nextLine(exerciseAt(UUID));

    // Le prescrit ne bouge jamais : il n'existe aucun endroit où écrire « la
    // série 3 se fera à 82,5 kg ».
    expect(updateSet(UUID, line, { reps: 5, weightKg: 90, durationSeconds: null, rpe: null })).toBe(
      false,
    );
  });
});

describe('la série annoncée en plus', () => {
  it('n’écrit rien tant qu’elle n’est pas cochée', () => {
    openStrengthWorkout();
    // Les quatre séries prescrites d'abord : tant qu'une ligne du programme
    // attend, cocher la suivante **est** le geste.
    checkNext();
    checkNext();
    checkNext();
    checkNext();

    const drafted = draftedExerciseAt(UUID);
    const line = drafted.lines!.find((candidate) => candidate.draft)!;

    // Elle est bien là, cochable, et la base n'en sait rien : une série non
    // faite n'est ni du prescrit ni du réalisé.
    expect(line.actionable).toBe(true);
    expect(line.logged).toBeNull();
    expect(exerciseAt(UUID).lines!.some((candidate) => candidate.draft)).toBe(false);
    expect(exerciseAt(UUID).done).toBe(4);
  });

  it('reprend les valeurs de la dernière série faite, puis se consigne en la cochant', () => {
    openStrengthWorkout();
    checkNext();
    updateSet(UUID, exerciseAt(UUID).lines![0], {
      reps: 6,
      weightKg: 82.5,
      durationSeconds: null,
      rpe: null,
    });
    checkNext();
    checkNext();
    checkNext();

    const drafted = draftedExerciseAt(UUID);
    const line = drafted.lines!.find((candidate) => candidate.draft)!;

    // La dernière série **faite** est la quatrième, aux valeurs prescrites : la
    // correction portait sur la première.
    expect(line.planned).toMatchObject({ reps: 8, weightKg: 80 });
    expect(checkSet(UUID, drafted, line)).toBe(true);

    const added = exerciseAt(UUID).lines![4];

    expect(added.logged).toMatchObject({ reps: 8, weightKg: 80, type: 'normal' });
    // Elle n'était réclamée par aucune ligne du programme : elle s'ajoute à la
    // suite, sans prescrit en face.
    expect(added.planned).toBeNull();
  });

  it('reprend la dernière ligne prescrite quand rien n’a encore été fait', () => {
    openStrengthWorkout();

    // Aucune série faite : le prescrit attend, donc rien à annoncer par-dessus.
    expect(draftedExerciseAt(UUID).lines!.some((line) => line.draft)).toBe(false);
  });

  it('refuse un cardio et un exercice déclaré sauté', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID, {
          blocks: [
            prescribedBlock(1, [
              prescribedExercise(1, { type: 'distance_pace', sets: null, summary: '10 km' }),
              prescribedExercise(2),
            ]),
          ],
        }),
      ],
    });
    beginWorkout(UUID);

    // Un cardio se coche entier, il n'a pas de série à saisir.
    expect(draftedExerciseAt(UUID, 0).lines).toBeNull();

    setExerciseState(UUID, exerciseAt(UUID, 1), { skipped: true, notes: 'machine occupée' });

    // Un exercice sauté est réglé, pas en cours.
    expect(draftedExerciseAt(UUID, 1).lines!.some((line) => line.draft)).toBe(false);
  });
});

describe('deleteSet', () => {
  it('supprime au milieu de la file, qui se resserre', () => {
    openStrengthWorkout();
    checkNext();
    checkNext();
    checkNext();

    const middle = exerciseAt(UUID).lines![1];

    expect(deleteSet(UUID, exerciseAt(UUID), middle)).toBe(true);

    // Supprimer au milieu ne fait pas de trou : les rangs suivants remontent
    // d'un cran, ce qui décrit exactement une série qu'on n'a pas faite.
    const lines = exerciseAt(UUID).lines!;

    expect(lines.filter((line) => line.logged !== null)).toHaveLength(2);
    expect(lines.map((line) => line.actionable)).toEqual([false, false, true, false]);
  });
});

describe('setExerciseState', () => {
  it('écrit la déclaration là où il n’y avait aucun réalisé', () => {
    openStrengthWorkout();

    expect(
      setExerciseState(UUID, exerciseAt(UUID), { skipped: true, notes: 'machine occupée' }),
    ).toBe(true);

    const after = exerciseAt(UUID);

    expect(after.skipped).toBe(true);
    expect(after.logged?.notes).toBe('machine occupée');
    // Un exercice sauté est réglé, pas en attente : le laisser au dénominateur
    // ferait une progression qui ne peut plus atteindre son terme.
    expect(after.total).toBe(0);
    expect(listMutations()).toHaveLength(1);
  });

  it('garde la note quand l’exercice n’est plus sauté', () => {
    openStrengthWorkout();

    setExerciseState(UUID, exerciseAt(UUID), { skipped: true, notes: 'dos douloureux' });
    setExerciseState(UUID, exerciseAt(UUID), { skipped: false, notes: 'dos douloureux' });

    // La raison et la note libre sont le même champ : ce que l'athlète a écrit
    // lui appartient.
    expect(exerciseAt(UUID).logged?.notes).toBe('dos douloureux');
  });

  it('retire l’exercice qui n’a plus rien à dire', () => {
    openStrengthWorkout();

    setExerciseState(UUID, exerciseAt(UUID), { skipped: true, notes: '' });
    setExerciseState(UUID, exerciseAt(UUID), { skipped: false, notes: '' });

    // Le garder ferait envoyer « fait, zéro série » au serveur.
    expect(exerciseAt(UUID).logged).toBeNull();
  });
});

describe('replaceExercise', () => {
  it('garde le lien au programme et change ce qui a été fait', () => {
    openStrengthWorkout();

    expect(canReplaceExercise(exerciseAt(UUID))).toBe(true);
    expect(replaceExercise(UUID, exerciseAt(UUID), { id: 202, name: 'Développé guidé' })).toBe(
      true,
    );

    const after = exerciseAt(UUID);

    // C'est ce qui fait dire à `/schedule/{id}` « prévu X, fait Y » plutôt que
    // de laisser un trou d'un côté et un intrus de l'autre.
    expect(after.logged?.sourcePrescribedId).toBe(1);
    expect(after.logged?.exerciseId).toBe(202);
    expect(after.substituted).toBe(true);
    expect(after.name).toBe('Développé guidé');
  });

  it('devient impossible dès qu’une série est consignée', () => {
    openStrengthWorkout();
    checkNext();

    expect(canReplaceExercise(exerciseAt(UUID))).toBe(false);
    expect(replaceExercise(UUID, exerciseAt(UUID), { id: 202, name: 'Développé guidé' })).toBe(
      false,
    );
  });

  it('survit à la disparition de sa dernière série', () => {
    openStrengthWorkout();
    replaceExercise(UUID, exerciseAt(UUID), { id: 202, name: 'Développé guidé' });
    checkNext();

    const exercise = exerciseAt(UUID);

    deleteSet(
      UUID,
      exercise,
      exercise.lines!.find((line) => line.logged !== null)!,
    );

    // Sans la garde, la séance repartirait au serveur comme si l'exercice prévu
    // n'avait jamais été substitué.
    expect(exerciseAt(UUID).substituted).toBe(true);
  });
});

describe('addExercise', () => {
  it('passe après tout le prescrit, même si rien n’a été coché', () => {
    openStrengthWorkout();

    const program = programOf(UUID);

    expect(addExercise(UUID, { id: 202, name: 'Développé guidé' }, program.prescribedCount)).toBe(
      true,
    );

    const extras = programOf(UUID).extras;

    expect(extras).toHaveLength(1);
    expect(extras[0].logged?.position).toBe(1);
    // Hors programme : il ne réclame rien, donc il n'entre ni au numérateur ni
    // au dénominateur de la progression.
    expect(extras[0].total).toBe(0);
    expect(extras[0].logged?.sourcePrescribedId).toBeNull();
  });

  it('fige le nom canonique, pas le libellé qu’on avait sous les yeux', () => {
    openStrengthWorkout();

    // Ce que le sélecteur affichait : le compte lit en anglais.
    addExercise(UUID, { id: 202, name: 'Machine chest press' }, programOf(UUID).prescribedCount);

    // Ce qui se fige : le nom de la bibliothèque. Un snapshot ne porte qu'une
    // langue, et il part au serveur — de l'anglais figé là ressortirait dans le
    // réalisé d'un compte qui rebascule en français.
    expect(programOf(UUID).extras[0].logged?.exerciseName).toBe('Développé guidé');
  });

  it('naît sans série, et le nettoyage l’épargne', () => {
    openStrengthWorkout();
    addExercise(UUID, { id: 202, name: 'Développé guidé' }, programOf(UUID).prescribedCount);

    const added = programOf(UUID).extras[0];

    expect(added.lines).toEqual([]);

    checkExtraSet(1);

    const withSet = programOf(UUID).extras[0];

    deleteSet(UUID, withSet, withSet.lines![0]);

    // Sans ligne prescrite pour le faire revenir, le retirer effacerait le geste
    // « je fais aussi ça aujourd'hui ».
    expect(programOf(UUID).extras).toHaveLength(1);
  });
});

describe('removeExercise', () => {
  it('emporte les séries de l’exercice hors programme', () => {
    openStrengthWorkout();
    addExercise(UUID, { id: 202, name: 'Développé guidé' }, programOf(UUID).prescribedCount);
    checkExtraSet(1);

    expect(removeExercise(UUID, programOf(UUID).extras[0])).toBe(true);
    expect(programOf(UUID).extras).toHaveLength(0);
  });

  it('refuse un exercice du programme, qui se saute au lieu de disparaître', () => {
    openStrengthWorkout();
    checkNext();

    expect(removeExercise(UUID, exerciseAt(UUID))).toBe(false);
  });
});
