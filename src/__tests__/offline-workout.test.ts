/**
 * Le parcours entier : une séance programmée, faite **hors réseau**, puis
 * synchronisée (KL-36).
 *
 * C'est le test que le ticket demande en dernier, et il est le seul à traverser
 * les quatre couches d'un bout à l'autre : `@/api` (bouchonné au seul `fetch`),
 * `@/db` (un vrai SQLite), `@/session` (les gestes de la séance) et `@/sync` (le
 * moteur). Ce qu'il vérifie n'est vérifiable nulle part ailleurs : qu'**aucune
 * donnée n'est perdue** entre le moment où le réseau tombe et celui où il
 * revient.
 *
 * ## Le serveur du test se souvient
 *
 * Il ne rend pas une réponse figée : il **garde le document reçu** et le
 * redescend au bootstrap suivant, comme le vrai. C'est ce qui permet de vérifier
 * la dernière étape du voyage — le pull qui suit un push réussi n'est plus
 * retenu par rien (la file est vide, la séance n'est plus protégée), et ce qu'il
 * écrase doit être exactement ce que le téléphone venait d'envoyer.
 */

import type { ScheduleUpsertInput, ScheduledWorkoutPayload } from '@/api';
import { db, scheduledWorkout } from '@/db';
import {
  addExercise,
  addSet,
  beginWorkout,
  checkSet,
  closeWorkout,
  setExerciseState,
  updateSet,
} from '@/session';
import { getSyncStatus, listMutations, syncNow } from '@/sync';
import { resetDatabase } from '@/test/database';
import {
  bootstrapPayload,
  exercisePayload,
  prescribedBlock,
  prescribedExercise,
  scheduledWorkout as scheduledWorkoutPayload,
  today,
} from '@/test/fixtures';
import { networkFailure, stubFetch } from '@/test/http';
import { exerciseAt, nextLine, programOf } from '@/test/program';
import { signIn } from '@/test/session';
import { waitForIdle } from '@/test/sync';

const UUID = '01890000-0000-7000-8000-000000000201';

/** La séance programmée : deux exercices de force, quatre séries chacun. */
function programmed(): ScheduledWorkoutPayload {
  return scheduledWorkoutPayload(UUID, {
    title: 'Haut du corps',
    blocks: [prescribedBlock(1, [prescribedExercise(1), prescribedExercise(2)])],
  });
}

/** Le serveur du test : ce qu'il a reçu, et ce qu'il en redescend. */
let stored: ScheduleUpsertInput | null = null;

function serverView(): ScheduledWorkoutPayload {
  const base = programmed();

  if (stored === null) {
    return base;
  }

  return {
    ...base,
    date: stored.date,
    title: stored.title ?? base.title,
    status: stored.status ?? 'planned',
    startedAt: stored.startedAt ?? null,
    endedAt: stored.endedAt ?? null,
    completionNotes: stored.completionNotes ?? null,
    log: (stored.log ?? []).map((entry, index) => ({
      exerciseId: entry.exerciseId ?? null,
      name: entry.name ?? null,
      sourcePrescribedId: entry.sourcePrescribedId ?? null,
      // Le serveur renumérote : l'ordre de la liste fait foi (§6.8).
      position: index,
      skipped: entry.skipped ?? false,
      notes: entry.notes ?? null,
      sets: (entry.sets ?? []).map((set, setIndex) => ({
        uuid: set.uuid,
        position: setIndex,
        type: set.type ?? 'normal',
        reps: set.reps ?? null,
        weightKg: set.weightKg ?? null,
        durationSeconds: set.durationSeconds ?? null,
        rpe: set.rpe ?? null,
        completedAt: set.completedAt ?? null,
      })),
    })),
  };
}

function online(): void {
  stubFetch({
    [`PUT /api/schedule/${UUID}`]: (call) => {
      stored = call.body as ScheduleUpsertInput;

      return { status: stored.status === 'done' ? 200 : 201, body: serverView() };
    },
    'GET /api/bootstrap': () => ({
      status: 200,
      body: bootstrapPayload({
        exercises: [exercisePayload(101), exercisePayload(102), exercisePayload(303)],
        schedule: [serverView()],
      }),
    }),
  });
}

function offline(): void {
  stubFetch({
    [`PUT /api/schedule/${UUID}`]: () => networkFailure(),
    'GET /api/bootstrap': () => networkFailure(),
  });
}

/**
 * L'horloge est tenue par le test : le moteur retient les déclencheurs
 * **automatiques** qui se suivent de moins de dix secondes, et « le réseau
 * revient » en est un. Sans ça, la dernière étape du parcours serait sautée par
 * un plancher anti-rafale parfaitement légitime.
 */
let clock = Date.now();

beforeEach(async () => {
  resetDatabase();
  stored = null;
  clock += 60_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  await signIn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('fait la séance hors réseau et ne perd rien en la synchronisant', async () => {
  // --- 1. Le dernier pull avant de descendre au sous-sol ---------------------
  online();

  expect((await syncNow('first-sync')).ok).toBe(true);
  expect(programOf(UUID).blocks[0].groups.flatMap((group) => group.exercises)).toHaveLength(2);

  // --- 2. Le réseau tombe ----------------------------------------------------
  offline();

  expect(beginWorkout(UUID)).toBe(true);

  // Quatre séries sur le premier exercice, la troisième corrigée à 82,5 kg.
  for (let index = 0; index < 4; index += 1) {
    const exercise = exerciseAt(UUID, 0);

    expect(checkSet(UUID, exercise, nextLine(exercise))).toBe(true);
  }

  updateSet(UUID, exerciseAt(UUID, 0).lines![2], {
    reps: 6,
    weightKg: 82.5,
    durationSeconds: null,
    rpe: 9,
  });

  // Le second est sauté, avec sa raison.
  setExerciseState(UUID, exerciseAt(UUID, 1), { skipped: true, notes: 'machine occupée' });

  // Et un exercice qui n'était pas prévu prend sa place.
  addExercise(UUID, { id: 303, name: 'Tirage poulie' }, programOf(UUID).prescribedCount);
  addSet(UUID, programOf(UUID).extras[0]);

  // Tout ça n'a produit qu'une entrée en file : elle ne porte que l'uuid, le
  // document se relit au moment du push.
  expect(listMutations()).toHaveLength(1);

  // Une tentative hors réseau échoue sans rien abîmer : le pull qui suit le
  // push raté ne peut pas écraser une séance que la file protège.
  const attempt = await syncNow('manual');

  expect(attempt.ok).toBe(false);
  expect(listMutations()).toHaveLength(1);
  expect(exerciseAt(UUID, 0).done).toBe(4);

  // --- 3. La clôture, toujours hors réseau -----------------------------------
  expect(closeWorkout(UUID, 'Épaule droite sensible')).toBe(true);

  // `closeWorkout` lance sa propre synchronisation sans l'attendre : elle échoue
  // aussi, et le dit hors ligne — ce que le bandeau (KL-38) lira.
  await waitForIdle();

  expect(getSyncStatus().offline).toBe(true);
  expect(db.select().from(scheduledWorkout).get()?.status).toBe('done');
  expect(listMutations()).toHaveLength(1);

  // --- 4. Le réseau revient --------------------------------------------------
  online();
  clock += 60_000;

  const outcome = await syncNow('network');

  expect(outcome.ok).toBe(true);
  expect(outcome.push?.pushed).toBe(1);
  expect(listMutations()).toHaveLength(0);

  // Ce que le serveur a reçu est ce qui s'est passé, y compris ce qui n'était
  // pas prévu.
  expect(stored).toMatchObject({
    uuid: UUID,
    date: today(),
    status: 'done',
    completionNotes: 'Épaule droite sensible',
  });
  expect(stored?.startedAt).not.toBeNull();
  expect(stored?.endedAt).not.toBeNull();

  const log = stored?.log ?? [];

  expect(log).toHaveLength(3);
  expect(log[0].sourcePrescribedId).toBe(1);
  expect(log[0].sets).toHaveLength(4);
  expect(log[0].sets?.[2]).toMatchObject({ reps: 6, weightKg: 82.5, rpe: 9 });
  expect(log[1]).toMatchObject({ sourcePrescribedId: 2, skipped: true, notes: 'machine occupée' });
  // L'exercice hors programme passe après tout le prescrit.
  expect(log[2]).toMatchObject({ exerciseId: 303, sourcePrescribedId: null });

  // --- 5. Et le pull qui suit ne défait rien ---------------------------------
  const program = programOf(UUID);

  expect(program.blocks[0].groups.flatMap((group) => group.exercises)[0].done).toBe(4);
  expect(program.blocks[0].groups.flatMap((group) => group.exercises)[1].skipped).toBe(true);
  expect(program.extras).toHaveLength(1);
  expect(db.select().from(scheduledWorkout).get()).toMatchObject({
    status: 'done',
    completionNotes: 'Épaule droite sensible',
  });
  // Le transport rejoue trois fois chaque appel idempotent, avec un délai qui
  // croît : deux cycles hors réseau coûtent quelques secondes de vrai temps, et
  // c'est justement ce comportement-là qu'on veut voir tourner.
}, 30_000);
