/**
 * Le sens descendant (KL-27), vérifié sur ce qu'il protège (KL-36).
 *
 * Le pull **remplace** la fenêtre de séances datées. Tout ce qui suit tourne
 * autour de la seule exception à cette règle : une séance que le téléphone n'a
 * pas encore réussi à pousser garde son réalisé, et ne reçoit du serveur que la
 * programmation. C'est l'exigence « aucune fenêtre où une séance en cours peut
 * être perdue », et c'est ce qui rend l'ordre push-avant-pull non négociable.
 */

import {
  db,
  exercise,
  exerciseHistory,
  getSyncState,
  loggedExercise,
  loggedSet,
  prescribedSnapshot,
  scheduledWorkout,
} from '@/db';
import {
  bootstrapPayload,
  dayFromNow,
  exercisePayload,
  loggedExercise as loggedExercisePayload,
  prescribedBlock,
  prescribedExercise,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { resetDatabase } from '@/test/database';

import { applyBootstrap } from '../pull';
import { enqueueSchedulePut } from '../queue';

const UUID = '01890000-0000-7000-8000-0000000000a1';
const OTHER = '01890000-0000-7000-8000-0000000000a2';

beforeEach(() => {
  resetDatabase();
});

describe('la bibliothèque', () => {
  it('applique un delta sans toucher à ce qui ne bouge pas', () => {
    seedBootstrap({ exercises: [exercisePayload(101), exercisePayload(102)] });

    applyBootstrap(
      bootstrapPayload({
        since: '2026-08-04T09:00:00Z',
        exercises: [exercisePayload(102, { name: 'Rowing renommé' })],
      }),
    );

    const rows = db.select().from(exercise).orderBy(exercise.id).all();

    expect(rows.map((row) => [row.id, row.name])).toEqual([
      [101, 'Exercice 101'],
      [102, 'Rowing renommé'],
    ]);
  });

  it('garde les deux libellés, et la langue sous laquelle les lire', async () => {
    applyBootstrap(
      bootstrapPayload({
        exerciseLanguage: 'en',
        exercises: [
          exercisePayload(101, { name: 'Traction en supination', nameEn: 'Chin-up' }),
          exercisePayload(102, { name: 'Dips', nameEn: null }),
        ],
      }),
    );

    // Les deux noms sont stockés, jamais le seul libellé courant : la préférence
    // peut changer entre deux pulls alors que `?since` n'allège que ce qui a
    // bougé — les autres lignes resteraient figées dans l'ancienne langue.
    expect(
      db
        .select()
        .from(exercise)
        .orderBy(exercise.id)
        .all()
        .map((row) => [row.name, row.nameEn]),
    ).toEqual([
      ['Traction en supination', 'Chin-up'],
      ['Dips', null],
    ]);

    expect((await getSyncState())?.exerciseLanguage).toBe('en');
  });

  it('oublie les exercices que le serveur déclare disparus', () => {
    seedBootstrap({ exercises: [exercisePayload(101), exercisePayload(102)] });

    applyBootstrap(
      bootstrapPayload({
        exercises: [],
        deleted: { exercises: [101], schedule: [] },
      }),
    );

    expect(
      db
        .select()
        .from(exercise)
        .all()
        .map((row) => row.id),
    ).toEqual([102]);
  });

  it("garde un exercice disparu tant qu'un réalisé non poussé le référence", () => {
    seedBootstrap({
      exercises: [exercisePayload(101)],
      schedule: [
        scheduledWorkoutPayload(UUID, {
          log: [loggedExercisePayload({ exerciseId: 101 })],
        }),
      ],
    });

    enqueueSchedulePut(UUID);

    applyBootstrap(
      bootstrapPayload({
        exercises: [],
        schedule: [scheduledWorkoutPayload(UUID)],
        deleted: { exercises: [101], schedule: [] },
      }),
    );

    // `logged_exercise.exercise_id` est en `SET NULL` : supprimer l'exercice
    // ferait partir un réalisé sans référence, donc hors historique et records.
    expect(
      db
        .select()
        .from(exercise)
        .all()
        .map((row) => row.id),
    ).toEqual([101]);
  });
});

describe("l'historique", () => {
  it("saute une entrée dont l'exercice n'est pas dans la base locale", () => {
    // Le cas réel : `?since` allège la bibliothèque, jamais l'historique. Sans
    // ce filtre, la clé étrangère ferait tomber la transaction entière — donc
    // le `since` n'avancerait plus jamais.
    applyBootstrap(
      bootstrapPayload({
        exercises: [exercisePayload(101)],
        history: [
          { exerciseId: 101, last: null, best: null },
          { exerciseId: 999, last: null, best: null },
        ],
      }),
    );

    expect(
      db
        .select()
        .from(exerciseHistory)
        .all()
        .map((row) => row.exerciseId),
    ).toEqual([101]);
  });
});

describe('la fenêtre de séances datées', () => {
  it('supprime une séance locale absente du jeu reçu', () => {
    seedBootstrap({
      schedule: [scheduledWorkoutPayload(UUID), scheduledWorkoutPayload(OTHER)],
    });

    applyBootstrap(bootstrapPayload({ schedule: [scheduledWorkoutPayload(OTHER)] }));

    expect(
      db
        .select()
        .from(scheduledWorkout)
        .all()
        .map((row) => row.uuid),
    ).toEqual([OTHER]);
  });

  it('écarte une séance sans date plutôt que de lui en inventer une', () => {
    applyBootstrap(bootstrapPayload({ schedule: [scheduledWorkoutPayload(UUID, { date: null })] }));

    expect(db.select().from(scheduledWorkout).all()).toHaveLength(0);
  });

  it('remplace le programme en entier, et le retire quand il devient vide', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    expect(db.select().from(prescribedSnapshot).all()).toHaveLength(1);

    applyBootstrap(bootstrapPayload({ schedule: [scheduledWorkoutPayload(UUID, { blocks: [] })] }));

    expect(db.select().from(prescribedSnapshot).all()).toHaveLength(0);
  });

  it("avance l'état de synchronisation dans la même transaction", async () => {
    applyBootstrap(
      bootstrapPayload({
        serverTime: '2026-08-04T11:22:33Z',
        window: { from: '2026-07-05', to: '2026-08-18' },
      }),
    );

    const state = await getSyncState();

    expect(state?.serverTime).toBe('2026-08-04T11:22:33Z');
    expect(state?.windowFrom).toBe('2026-07-05');
    expect(state?.windowTo).toBe('2026-08-18');
    expect(state?.lastPulledAt).not.toBeNull();
  });
});

describe('une séance que le serveur a confirmée', () => {
  it('remplace le réalisé local par celui du serveur', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID, {
          log: [
            loggedExercisePayload({
              sets: [
                {
                  uuid: '01890000-0000-7000-8000-0000000000f1',
                  position: 0,
                  type: 'normal',
                  reps: 8,
                  weightKg: 80,
                  durationSeconds: null,
                  rpe: null,
                  completedAt: '2026-08-04T08:00:00Z',
                },
              ],
            }),
          ],
        }),
      ],
    });

    applyBootstrap(
      bootstrapPayload({
        schedule: [scheduledWorkoutPayload(UUID, { log: [] })],
      }),
    );

    expect(db.select().from(loggedExercise).all()).toHaveLength(0);
    // Les séries partent en cascade : sans `foreign_keys = ON` elles resteraient
    // orphelines et invisibles.
    expect(db.select().from(loggedSet).all()).toHaveLength(0);
  });
});

describe('une séance que le serveur ne connaît pas encore', () => {
  it('reçoit la programmation, garde son réalisé et son statut', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID, {
          startedAt: '2026-08-04T07:00:00Z',
          endedAt: '2026-08-04T08:00:00Z',
          status: 'done',
          completionNotes: 'Belle séance',
          log: [loggedExercisePayload()],
        }),
      ],
    });

    enqueueSchedulePut(UUID);

    applyBootstrap(
      bootstrapPayload({
        schedule: [
          scheduledWorkoutPayload(UUID, {
            date: dayFromNow(1),
            title: 'Déplacée par le coach',
            status: 'planned',
            startedAt: null,
            endedAt: null,
            completionNotes: null,
            log: [],
            blocks: [prescribedBlock(1, [prescribedExercise(1), prescribedExercise(2)])],
          }),
        ],
      }),
    );

    const [row] = db.select().from(scheduledWorkout).all();

    // La programmation descend…
    expect(row.date).toBe(dayFromNow(1));
    expect(row.title).toBe('Déplacée par le coach');
    // …le reste appartient au téléphone tant que le serveur n'a rien confirmé.
    // Écraser `status` serait le pire des trois : le document relu au push
    // suivant repartirait en `planned`, et la clôture serait perdue au moment
    // même où on essaie de l'envoyer.
    expect(row.status).toBe('done');
    expect(row.endedAt).toBe('2026-08-04T08:00:00Z');
    expect(row.completionNotes).toBe('Belle séance');
    expect(db.select().from(loggedExercise).all()).toHaveLength(1);

    // Le programme, lui, descend même sur une séance protégée : une correction
    // du coach doit être lisible barre en main.
    const [snapshot] = db.select().from(prescribedSnapshot).all();

    expect(snapshot.blocks[0].exercises).toHaveLength(2);
  });

  it("n'est pas purgée quand elle sort de la fenêtre", () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    enqueueSchedulePut(UUID);

    applyBootstrap(bootstrapPayload({ schedule: [] }));

    expect(
      db
        .select()
        .from(scheduledWorkout)
        .all()
        .map((row) => row.uuid),
    ).toEqual([UUID]);
  });
});

describe('une séance en cours', () => {
  it('est protégée même sans mutation en file', () => {
    // Le second critère de protection : une séance ouverte dont rien n'a encore
    // été coché n'a pas de mutation, et quelqu'un la regarde.
    seedBootstrap({
      schedule: [scheduledWorkoutPayload(UUID, { startedAt: '2026-08-04T07:00:00Z' })],
    });

    const report = applyBootstrap(
      bootstrapPayload({
        schedule: [scheduledWorkoutPayload(UUID, { startedAt: null, title: 'Renommée' })],
      }),
    );

    const [row] = db.select().from(scheduledWorkout).all();

    expect(report.protectedSchedule).toBe(1);
    expect(row.startedAt).toBe('2026-08-04T07:00:00Z');
    expect(row.title).toBe('Renommée');
  });
});
