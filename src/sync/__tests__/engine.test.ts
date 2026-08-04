/**
 * Le moteur de synchronisation (KL-27), vérifié sur ses trois promesses (KL-36).
 *
 * **L'ordre n'est pas négociable** : le pull remplace la fenêtre de séances
 * datées, lancé en premier il écraserait une séance faite le matin et pas encore
 * envoyée. **Un seul cycle à la fois** : quatre déclencheurs peuvent tomber
 * ensemble, deux cycles concurrents pousseraient la même mutation deux fois.
 * **Il ne lève jamais** : ses déclencheurs n'ont personne pour attraper une
 * exception.
 *
 * ## L'horloge est tenue par le test
 *
 * Le plancher anti-rafale de dix secondes se mesure sur `Date.now()`, et l'état
 * du moteur vit au niveau du module — donc d'un test à l'autre. Le fixer ici
 * rend les deux vérifiables : le temps n'avance que quand le test le décide, et
 * chaque test part d'assez loin pour qu'aucun plancher hérité ne le fausse.
 */

import { getSyncState } from '@/db';
import { resetDatabase } from '@/test/database';
import {
  bootstrapPayload,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { callsTo, recordedCalls, stubFetch, type StubbedResponse } from '@/test/http';
import { signIn, signOutForTest } from '@/test/session';

import { syncNow } from '../engine';
import { enqueueSchedulePut, listMutations } from '../queue';

const UUID = '01890000-0000-7000-8000-0000000000d1';

let clock = Date.now();

/** Le journal des appels, réduit à « quoi, dans quel ordre ». */
function sequence(): string[] {
  return recordedCalls().map((call) => `${call.method} ${call.path.split('?')[0]}`);
}

function bootstrapRoute(overrides = {}): StubbedResponse {
  return { status: 200, body: bootstrapPayload(overrides) };
}

/** Une promesse qu'on résout à la main, pour tenir un cycle en vol. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

beforeEach(async () => {
  resetDatabase();
  // Assez loin du test précédent pour qu'aucun plancher anti-rafale ne traîne.
  clock += 60_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  await signIn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("l'ordre du cycle", () => {
  it('pousse avant de descendre', async () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    enqueueSchedulePut(UUID);

    stubFetch({
      [`PUT /api/schedule/${UUID}`]: () => ({
        status: 200,
        body: scheduledWorkoutPayload(UUID),
      }),
      'GET /api/bootstrap': () => bootstrapRoute({ schedule: [scheduledWorkoutPayload(UUID)] }),
    });

    const outcome = await syncNow('manual');

    expect(sequence()).toEqual([`PUT /api/schedule/${UUID}`, 'GET /api/bootstrap']);
    expect(outcome.ok).toBe(true);
    expect(listMutations()).toHaveLength(0);
  });

  it('renvoie l’horloge du serveur en `since`, pas celle du téléphone', async () => {
    stubFetch({
      'GET /api/bootstrap': () => bootstrapRoute({ serverTime: '2026-08-04T12:00:00Z' }),
    });

    await syncNow('manual');

    expect(callsTo('GET', '/api/bootstrap')[0].path).toBe('/api/bootstrap');

    await syncNow('manual');

    // Deux pendules qui ne sont pas d'accord suffiraient à sauter un exercice
    // modifié entre les deux, et la seule que le serveur sait relire est la
    // sienne.
    expect(callsTo('GET', '/api/bootstrap')[1].path).toBe(
      `/api/bootstrap?since=${encodeURIComponent('2026-08-04T12:00:00Z')}`,
    );
    expect((await getSyncState())?.serverTime).toBe('2026-08-04T12:00:00Z');
  });

  it('ne descend rien quand le jeton ne vaut plus rien', async () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    enqueueSchedulePut(UUID);

    stubFetch({
      [`PUT /api/schedule/${UUID}`]: () => ({ status: 401, body: { title: 'Unauthorized' } }),
      'GET /api/bootstrap': () => bootstrapRoute(),
    });

    const outcome = await syncNow('manual');

    // La session est déjà fermée et le garde de navigation a fait son travail :
    // descendre quoi que ce soit échouerait de la même façon.
    expect(sequence()).toEqual([`PUT /api/schedule/${UUID}`]);
    expect(outcome.ok).toBe(false);
    expect(outcome.pull).toBeNull();
  });

  it('ne lève pas quand le serveur est injoignable, et le dit hors ligne', async () => {
    stubFetch({
      'GET /api/bootstrap': () => {
        throw new TypeError('Network request failed');
      },
    });

    const outcome = await syncNow('manual');

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('Serveur injoignable. Vérifie le réseau, ou l’URL de ce serveur.');
  });
});

describe('un seul cycle à la fois', () => {
  it('mémorise une demande arrivée en cours de cycle et l’enchaîne', async () => {
    const gate = deferred<StubbedResponse>();
    let bootstraps = 0;

    stubFetch({
      'GET /api/bootstrap': () => {
        bootstraps += 1;

        return bootstraps === 1 ? gate.promise : bootstrapRoute();
      },
    });

    const first = syncNow('manual');

    // Le temps que le premier cycle soit réellement en vol.
    await Promise.resolve();

    const second = syncNow('workout-closed');

    // La demande n'est pas doublée : elle rend le cycle en cours.
    expect(second).toBe(first);

    gate.resolve(bootstrapRoute());
    await first;
    // Le cycle enchaîné part sans `await` : on lui laisse le temps d'aboutir.
    await new Promise((resolve) => setImmediate(resolve));

    expect(bootstraps).toBe(2);
  });
});

describe('le plancher anti-rafale', () => {
  it('saute un déclencheur automatique arrivé trop tôt', async () => {
    stubFetch({ 'GET /api/bootstrap': () => bootstrapRoute() });

    await syncNow('launch');

    clock += 5_000;

    const outcome = await syncNow('foreground');

    // Le réseau d'un téléphone qui sort du sous-sol clignote, et chaque bascule
    // est un déclencheur : sans plancher, retrouver du signal lancerait une
    // rafale de bootstraps.
    expect(callsTo('GET', '/api/bootstrap')).toHaveLength(1);
    // Sauté n'est pas échoué : rien n'a été tenté.
    expect(outcome).toEqual({ ok: true, push: null, pull: null, error: null });

    clock += 6_000;
    await syncNow('foreground');

    expect(callsTo('GET', '/api/bootstrap')).toHaveLength(2);
  });

  it('ne retient jamais un geste voulu', async () => {
    stubFetch({ 'GET /api/bootstrap': () => bootstrapRoute() });

    await syncNow('launch');
    await syncNow('manual');
    await syncNow('workout-closed');

    // Ils viennent de quelqu'un, pas d'un capteur.
    expect(callsTo('GET', '/api/bootstrap')).toHaveLength(3);
  });
});

describe('sans session', () => {
  it('ne part pas sur le réseau', async () => {
    await signOutForTest();

    stubFetch({});

    const outcome = await syncNow('manual');

    expect(recordedCalls()).toHaveLength(0);
    expect(outcome).toEqual({ ok: true, push: null, pull: null, error: null });
  });
});
