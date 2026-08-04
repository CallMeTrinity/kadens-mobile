/**
 * Le sens montant (KL-27), vérifié sur sa décision centrale (KL-36).
 *
 * Ce que le push compte comme un échec décide de ce qu'on montre à
 * l'utilisateur, et la distinction est la raison d'être du fichier testé : un
 * **réseau absent n'incrémente rien** (le sous-sol d'une salle est le cas
 * nominal du chantier, y épuiser une mutation valide afficherait une panne là où
 * il n'y a qu'un mur de béton), là où un **refus définitif** avance le compteur
 * et passe à la suivante — bloquer la file sur un document que le serveur ne
 * voudra jamais retiendrait les séances des autres jours.
 *
 * Les tests parlent au vrai `src/api`, `fetch` seul étant bouchonné : le
 * `201` contre `200`, le `404` d'un `DELETE` traité comme un succès et la
 * taxonomie d'erreurs sont exercés pour de bon.
 */

import { db, loggedExercise, loggedSet, getSyncState } from '@/db';
import { resetDatabase } from '@/test/database';
import {
  loggedExercise as loggedExercisePayload,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
  today,
} from '@/test/fixtures';
import { callsTo, networkFailure, recordedCalls, stubFetch } from '@/test/http';
import { signIn } from '@/test/session';

import { pushPending } from '../push';
import { enqueueScheduleDelete, enqueueSchedulePut, listMutations, MAX_ATTEMPTS } from '../queue';

const UUID = '01890000-0000-7000-8000-0000000000b1';
const OTHER = '01890000-0000-7000-8000-0000000000b2';
const SET_UUID = '01890000-0000-7000-8000-0000000000c1';

/** Ce que le serveur rend sur un `PUT` accepté : la séance, telle qu'il la voit. */
function upserted(uuid: string, status: number) {
  return { status, body: scheduledWorkoutPayload(uuid) };
}

beforeEach(async () => {
  resetDatabase();
  await signIn();
});

describe('le chemin nominal', () => {
  it('dépile dans l’ordre et retire ce qui est passé', async () => {
    seedBootstrap({
      schedule: [scheduledWorkoutPayload(UUID), scheduledWorkoutPayload(OTHER)],
    });

    enqueueSchedulePut(UUID);
    enqueueSchedulePut(OTHER);

    stubFetch({
      [`PUT /api/schedule/${UUID}`]: () => upserted(UUID, 200),
      [`PUT /api/schedule/${OTHER}`]: () => upserted(OTHER, 201),
    });

    const report = await pushPending();

    expect(recordedCalls().map((call) => call.path)).toEqual([
      `/api/schedule/${UUID}`,
      `/api/schedule/${OTHER}`,
    ]);
    expect(report.pushed).toBe(2);
    // `created` distingue le `201` du `200` : c'est ce qui dit quelles entrées
    // étaient déjà passées avant une coupure.
    expect(report.created).toBe(1);
    expect(listMutations()).toHaveLength(0);
  });

  it('envoie le document relu au moment du push, pas celui de l’enfilement', async () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    enqueueSchedulePut(UUID);

    // La séance continue pendant que la mutation attend : c'est tout l'intérêt
    // d'une file qui ne porte que l'uuid.
    const inserted = db
      .insert(loggedExercise)
      .values({
        scheduledUuid: UUID,
        exerciseId: 101,
        exerciseName: 'Exercice 101',
        sourcePrescribedId: 1,
        position: 0,
        skipped: false,
        notes: null,
      })
      .returning({ id: loggedExercise.id })
      .get();

    db.insert(loggedSet)
      .values({
        uuid: SET_UUID,
        loggedExerciseId: inserted.id,
        position: 0,
        type: 'normal',
        reps: 8,
        weightKg: 82.5,
        durationSeconds: null,
        rpe: null,
        completedAt: '2026-08-04T08:12:00Z',
      })
      .run();

    stubFetch({ [`PUT /api/schedule/${UUID}`]: () => upserted(UUID, 200) });

    await pushPending();

    const [call] = callsTo('PUT', `/api/schedule/${UUID}`);

    expect(call.body).toMatchObject({
      uuid: UUID,
      date: today(),
      log: [
        {
          exerciseId: 101,
          name: 'Exercice 101',
          sourcePrescribedId: 1,
          sets: [{ uuid: SET_UUID, reps: 8, weightKg: 82.5 }],
        },
      ],
    });
    // `status` ne part que s'il vaut `done` : les autres valeurs passeraient la
    // validation sans rien faire, et donneraient à lire un document qui prétend
    // programmer.
    expect(call.body).not.toHaveProperty('status');
  });

  it('retire sans rien envoyer une mutation dont la séance a disparu', async () => {
    enqueueSchedulePut(UUID);

    stubFetch({});

    const report = await pushPending();

    expect(recordedCalls()).toHaveLength(0);
    expect(report.pushed).toBe(1);
    expect(listMutations()).toHaveLength(0);
  });

  it('traite le 404 d’une suppression comme un succès', async () => {
    enqueueScheduleDelete(UUID);

    stubFetch({
      [`DELETE /api/schedule/${UUID}`]: () => ({ status: 404, body: { title: 'Not Found' } }),
    });

    const report = await pushPending();

    // Une réponse perdue laisserait sinon la mutation bloquée en tête de file
    // pour toujours.
    expect(report.pushed).toBe(1);
    expect(listMutations()).toHaveLength(0);
  });

  it('n’avance `lastPushedAt` que si quelque chose est parti', async () => {
    stubFetch({});

    await pushPending();

    expect((await getSyncState())?.lastPushedAt ?? null).toBeNull();
  });
});

describe('un refus définitif', () => {
  it('fait avancer le compteur et passe à la séance suivante', async () => {
    seedBootstrap({
      schedule: [scheduledWorkoutPayload(UUID), scheduledWorkoutPayload(OTHER)],
    });

    enqueueSchedulePut(UUID);
    enqueueSchedulePut(OTHER);

    stubFetch({
      [`PUT /api/schedule/${UUID}`]: () => ({
        status: 422,
        body: {
          title: 'Unprocessable Entity',
          detail: 'Document refusé.',
          violations: [{ field: 'log[0].sets[0].reps', message: 'Hors bornes.' }],
        },
      }),
      [`PUT /api/schedule/${OTHER}`]: () => upserted(OTHER, 200),
    });

    const report = await pushPending();

    expect(report.rejected).toBe(1);
    expect(report.pushed).toBe(1);
    // Le problème est dans ce document-là : laisser la mutation en tête de file
    // bloquerait pour toujours les séances des autres jours.
    expect(listMutations().map((row) => [row.payload.uuid, row.attempts])).toEqual([[UUID, 1]]);
  });

  it('marque la mutation au cinquième refus, et le lot suivant l’ignore', async () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    enqueueSchedulePut(UUID);

    stubFetch({
      [`PUT /api/schedule/${UUID}`]: () => ({ status: 422, body: { title: 'Unprocessable' } }),
    });

    for (let cycle = 1; cycle <= MAX_ATTEMPTS; cycle += 1) {
      await pushPending();
    }

    expect(listMutations()[0].attempts).toBe(MAX_ATTEMPTS);
    expect(callsTo('PUT', `/api/schedule/${UUID}`)).toHaveLength(MAX_ATTEMPTS);

    const report = await pushPending();

    // Marquée, elle attend un geste humain (« Réessayer », KL-35) : elle n'est
    // jamais supprimée en silence.
    expect(report.exhausted).toBe(1);
    expect(callsTo('PUT', `/api/schedule/${UUID}`)).toHaveLength(MAX_ATTEMPTS);
  });
});

describe('un échec passager', () => {
  it('arrête le cycle sans rien reprocher au document', async () => {
    seedBootstrap({
      schedule: [scheduledWorkoutPayload(UUID), scheduledWorkoutPayload(OTHER)],
    });

    enqueueSchedulePut(UUID);
    enqueueSchedulePut(OTHER);

    stubFetch({ [`PUT /api/schedule/${UUID}`]: () => networkFailure() });

    const report = await pushPending();

    expect(report.interruptedBy).toBe('network');
    expect(report.pushed).toBe(0);
    expect(report.remaining).toBe(2);
    // Les suivantes échoueraient pour la même raison : on ne les tente pas, et
    // aucun compteur ne bouge.
    expect(listMutations().map((row) => row.attempts)).toEqual([0, 0]);
    expect(listMutations()[0].lastError).toBe(
      'Serveur injoignable. Vérifie le réseau, ou l’URL de ce serveur.',
    );
  });

  it('repart au cycle suivant, et la séance passe', async () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    enqueueSchedulePut(UUID);

    let online = false;

    stubFetch({
      [`PUT /api/schedule/${UUID}`]: () => (online ? upserted(UUID, 201) : networkFailure()),
    });

    expect((await pushPending()).interruptedBy).toBe('network');

    online = true;

    const report = await pushPending();

    expect(report.pushed).toBe(1);
    expect(report.created).toBe(1);
    expect(listMutations()).toHaveLength(0);
  });
});

describe('un jeton qui ne vaut plus rien', () => {
  it('arrête le cycle sans compter le refus', async () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    enqueueSchedulePut(UUID);

    stubFetch({
      [`PUT /api/schedule/${UUID}`]: () => ({ status: 401, body: { title: 'Unauthorized' } }),
    });

    const report = await pushPending();

    expect(report.interruptedBy).toBe('unauthorized');
    // Ce n'est pas le document qu'on refuse : le transport a déjà purgé la
    // session et le garde de navigation a fait le reste.
    expect(listMutations()[0].attempts).toBe(0);
  });
});

describe('une séance clôturée', () => {
  it('emporte son statut, ses bornes et sa note', async () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID, {
          status: 'done',
          startedAt: '2026-08-04T07:00:00Z',
          endedAt: '2026-08-04T08:05:00Z',
          completionNotes: 'Dos en vrac',
          log: [loggedExercisePayload({ skipped: true, notes: 'machine occupée' })],
        }),
      ],
    });

    enqueueSchedulePut(UUID);

    stubFetch({ [`PUT /api/schedule/${UUID}`]: () => upserted(UUID, 200) });

    await pushPending();

    expect(callsTo('PUT', `/api/schedule/${UUID}`)[0].body).toMatchObject({
      status: 'done',
      startedAt: '2026-08-04T07:00:00Z',
      endedAt: '2026-08-04T08:05:00Z',
      completionNotes: 'Dos en vrac',
      log: [{ skipped: true, notes: 'machine occupée' }],
    });
  });
});
