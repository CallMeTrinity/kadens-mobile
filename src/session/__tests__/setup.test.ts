/**
 * Les réglages de machine (#8), vérifiés sur ce qui les distingue du réalisé.
 *
 * Écrire un réglage empile sa mutation dans la **même transaction**, comme une
 * série cochée. Mais il ne décrit aucune séance : il n'a pas la garde « séance
 * ouverte », et il s'écrit séance close comme séance pas encore commencée.
 */

import { eq } from 'drizzle-orm';

import { db, exerciseSetup } from '@/db';
import { saveExerciseSetup } from '@/session';
import { listMutations } from '@/sync';
import { resetDatabase } from '@/test/database';
import { seedBootstrap } from '@/test/fixtures';

const EXERCISE = 101;

function setupRow(exerciseId: number = EXERCISE) {
  return db.select().from(exerciseSetup).where(eq(exerciseSetup.exerciseId, exerciseId)).get();
}

beforeEach(() => {
  resetDatabase();
  seedBootstrap();
});

describe('saveExerciseSetup', () => {
  it('écrit le texte sans ses espaces de bord, et empile sa mutation', () => {
    expect(saveExerciseSetup(EXERCISE, '  dossier : 5\njambe : 1  ')).toBe(true);

    expect(setupRow()).toEqual({
      exerciseId: EXERCISE,
      text: 'dossier : 5\njambe : 1',
      updatedAt: null,
    });
    expect(listMutations().map((row) => [row.type, row.payload])).toEqual([
      ['exercise.setup', { exerciseId: EXERCISE }],
    ]);
  });

  it('coalesce les retouches successives en une seule mutation', () => {
    saveExerciseSetup(EXERCISE, 'dossier : 5');
    saveExerciseSetup(EXERCISE, 'dossier : 6');

    expect(setupRow()?.text).toBe('dossier : 6');
    expect(listMutations()).toHaveLength(1);
  });

  it('n’empile rien quand le texte n’a pas bougé', () => {
    saveExerciseSetup(EXERCISE, 'dossier : 5');
    const [queued] = listMutations();

    // Valider la feuille sans y toucher, espaces en plus compris.
    expect(saveExerciseSetup(EXERCISE, 'dossier : 5 ')).toBe(false);
    expect(listMutations()).toEqual([queued]);
  });

  it('n’empile rien pour un champ laissé vide sur un exercice sans réglage', () => {
    expect(saveExerciseSetup(EXERCISE, '   ')).toBe(false);

    expect(listMutations()).toHaveLength(0);
  });

  it('efface la ligne quand le texte est vidé, et empile l’effacement', () => {
    saveExerciseSetup(EXERCISE, 'dossier : 5');

    expect(saveExerciseSetup(EXERCISE, '')).toBe(true);

    expect(setupRow()).toBeUndefined();
    expect(listMutations()).toHaveLength(1);
  });
});
