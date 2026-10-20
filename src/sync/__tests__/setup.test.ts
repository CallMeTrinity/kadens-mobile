/**
 * Les réglages de machine (#8) à travers la synchronisation : la file, le push
 * et le pull, sur la même règle que le réalisé — tant que le serveur n'a pas
 * confirmé, le téléphone fait autorité.
 */

import { eq } from 'drizzle-orm';

import { db, exerciseSetup } from '@/db';
import { saveExerciseSetup } from '@/session';
import { resetDatabase } from '@/test/database';
import {
  exercisePayload,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { callsTo, networkFailure, stubFetch } from '@/test/http';
import { signIn } from '@/test/session';

import { pushPending } from '../push';
import {
  enqueueSchedulePut,
  enqueueSetupPut,
  listMutations,
  pendingSetups,
  pendingUuids,
} from '../queue';

const EXERCISE = 101;
const OTHER = 102;
const UUID = '01890000-0000-7000-8000-0000000000d1';
const SAVED_AT = '2026-10-20T18:02:11+00:00';

function setups() {
  return db.select().from(exerciseSetup).orderBy(exerciseSetup.exerciseId).all();
}

/** Ce que le serveur rend sur un `PUT …/setup` : le texte reçu, sans ses espaces de bord. */
function saved(exerciseId: number) {
  return ({ body }: { body: unknown }) => {
    const text = (body as { text: string | null }).text;

    return {
      status: 200,
      body: { exerciseId, text, updatedAt: text === null ? null : SAVED_AT },
    };
  };
}

beforeEach(async () => {
  resetDatabase();
  await signIn();
  seedBootstrap({ exercises: [exercisePayload(EXERCISE), exercisePayload(OTHER)] });
});

describe('la file', () => {
  it('sépare les réglages des séances', () => {
    seedBootstrap({
      exercises: [exercisePayload(EXERCISE)],
      schedule: [scheduledWorkoutPayload(UUID)],
    });
    enqueueSchedulePut(UUID);
    enqueueSetupPut(EXERCISE);

    expect(pendingUuids()).toEqual(new Set([UUID]));
    expect(pendingSetups()).toEqual(new Set([EXERCISE]));
  });
});

describe('le push', () => {
  it('envoie le texte relu au moment du push, et recopie l’horodatage du serveur', async () => {
    saveExerciseSetup(EXERCISE, 'dossier : 5');
    stubFetch({ [`PUT /api/exercises/${EXERCISE}/setup`]: saved(EXERCISE) });

    const report = await pushPending();

    expect(report.pushed).toBe(1);
    expect(callsTo('PUT', `/api/exercises/${EXERCISE}/setup`).map((call) => call.body)).toEqual([
      { text: 'dossier : 5' },
    ]);
    expect(setups()).toEqual([{ exerciseId: EXERCISE, text: 'dossier : 5', updatedAt: SAVED_AT }]);
    expect(listMutations()).toHaveLength(0);
  });

  it('pousse un effacement comme un texte nul', async () => {
    saveExerciseSetup(EXERCISE, 'dossier : 5');
    saveExerciseSetup(EXERCISE, '');
    stubFetch({ [`PUT /api/exercises/${EXERCISE}/setup`]: saved(EXERCISE) });

    await pushPending();

    expect(callsTo('PUT', `/api/exercises/${EXERCISE}/setup`).map((call) => call.body)).toEqual([
      { text: null },
    ]);
    expect(listMutations()).toHaveLength(0);
  });

  it('renvoie une retouche faite pendant l’aller-retour au lieu de la perdre', async () => {
    saveExerciseSetup(EXERCISE, 'dossier : 5');

    let first = true;

    stubFetch({
      [`PUT /api/exercises/${EXERCISE}/setup`]: (call) => {
        // La retouche arrive pendant que le premier envoi est en vol : elle
        // réarme la même ligne de file, que le push va retirer.
        if (first) {
          first = false;
          saveExerciseSetup(EXERCISE, 'dossier : 6');
        }

        return saved(EXERCISE)(call);
      },
    });

    await pushPending();

    expect(callsTo('PUT', `/api/exercises/${EXERCISE}/setup`).map((call) => call.body)).toEqual([
      { text: 'dossier : 5' },
      { text: 'dossier : 6' },
    ]);
    expect(setups()).toEqual([{ exerciseId: EXERCISE, text: 'dossier : 6', updatedAt: SAVED_AT }]);
  });

  it('garde la mutation quand le réseau manque', async () => {
    saveExerciseSetup(EXERCISE, 'dossier : 5');
    stubFetch({ [`PUT /api/exercises/${EXERCISE}/setup`]: networkFailure });

    const report = await pushPending();

    expect(report.interruptedBy).toBe('network');
    expect(listMutations().map((row) => [row.payload.exerciseId, row.attempts])).toEqual([
      [EXERCISE, 0],
    ]);
  });
});

describe('le pull', () => {
  it('remplace les réglages locaux par la liste du serveur', () => {
    seedBootstrap({
      exercises: [],
      setups: [{ exerciseId: EXERCISE, text: 'dossier : 5', updatedAt: SAVED_AT }],
    });
    seedBootstrap({
      exercises: [],
      setups: [{ exerciseId: OTHER, text: 'cran 12', updatedAt: SAVED_AT }],
    });

    // Absent de la seconde liste : effacé ailleurs.
    expect(setups()).toEqual([{ exerciseId: OTHER, text: 'cran 12', updatedAt: SAVED_AT }]);
  });

  it('ne touche pas à un réglage qui attend d’être poussé', () => {
    saveExerciseSetup(EXERCISE, 'dossier : 6');

    seedBootstrap({
      exercises: [],
      setups: [{ exerciseId: EXERCISE, text: 'dossier : 5', updatedAt: SAVED_AT }],
    });
    expect(setups()).toEqual([{ exerciseId: EXERCISE, text: 'dossier : 6', updatedAt: null }]);

    // Ni écrasé, ni supprimé faute d'être dans la liste.
    seedBootstrap({ exercises: [], setups: [] });
    expect(setups().map((row) => row.text)).toEqual(['dossier : 6']);
  });

  it('saute un réglage sur un exercice que la base ne connaît pas', () => {
    const report = seedBootstrap({
      exercises: [],
      setups: [{ exerciseId: 999, text: 'dossier : 5', updatedAt: SAVED_AT }],
    });

    // Le pull entier aurait sinon échoué sur la clé étrangère.
    expect(report.window).toBeDefined();
    expect(setups()).toEqual([]);
  });

  it('ne lit pas l’absence de la clé comme un effacement', () => {
    seedBootstrap({
      exercises: [],
      setups: [{ exerciseId: EXERCISE, text: 'dossier : 5', updatedAt: SAVED_AT }],
    });

    // Un serveur pas encore à jour n'envoie pas `setups`.
    seedBootstrap({ exercises: [] });

    expect(setups().map((row) => row.text)).toEqual(['dossier : 5']);
  });

  it('emporte le réglage d’un exercice retiré de la bibliothèque', () => {
    seedBootstrap({
      exercises: [],
      setups: [{ exerciseId: EXERCISE, text: 'dossier : 5', updatedAt: SAVED_AT }],
    });

    seedBootstrap({
      exercises: [],
      since: '2026-08-04T09:00:00Z',
      deleted: { exercises: [EXERCISE], schedule: [] },
    });

    expect(
      db.select().from(exerciseSetup).where(eq(exerciseSetup.exerciseId, EXERCISE)).get(),
    ).toBe(undefined);
  });
});
