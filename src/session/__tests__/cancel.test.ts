/**
 * Annuler une séance commencée, vérifié sur une vraie base (KL-36).
 *
 * Trois choses se jouent ici, et aucune n'est visible dans les types.
 *
 * **L'annulation est l'inverse de la clôture.** Elle ne pose pas de borne, elle
 * en retire une, et elle efface le réalisé au lieu de le figer. La séance
 * programmée redevient donc strictement ce qu'elle était avant qu'on la touche.
 *
 * **Effacer du réalisé est du réalisé.** La mutation part dans la même
 * transaction, sans quoi le pull suivant remettrait en place ce qu'on vient
 * d'effacer. Mais elle ne part que s'il y avait quelque chose à reprendre : une
 * séance ouverte puis annulée sans rien cocher n'a rien poussé, et `beginWorkout`
 * n'empile déjà rien (`start.ts`).
 *
 * **Une séance libre disparaît, une séance programmée non.** Le contrat refuse
 * qu'un téléphone supprime de la programmation (409) ; la séance libre, elle,
 * n'existait que parce qu'on l'avait créée.
 */

import { eq } from 'drizzle-orm';

import { db, loggedExercise, scheduledWorkout, sessionLayout } from '@/db';
import {
  beginWorkout,
  cancelWorkout,
  checkSet,
  closeWorkout,
  createFreeWorkout,
  moveExercise,
} from '@/session';
import { listMutations } from '@/sync';
import { resetDatabase } from '@/test/database';
import {
  prescribedBlock,
  prescribedExercise,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { exerciseAt, nextLine, programOf } from '@/test/program';

const UUID = '01890000-0000-7000-8000-0000000000c1';

function workoutRow(uuid: string = UUID) {
  return db.select().from(scheduledWorkout).where(eq(scheduledWorkout.uuid, uuid)).get();
}

function loggedRows(uuid: string = UUID) {
  return db.select().from(loggedExercise).where(eq(loggedExercise.scheduledUuid, uuid)).all();
}

/** Une séance programmée ouverte, un exercice, quatre séries de huit à 80 kg. */
function openPlannedWorkout(): void {
  seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
  beginWorkout(UUID);
}

beforeEach(() => {
  resetDatabase();
});

describe('cancelWorkout, séance programmée', () => {
  it('retire la borne de départ et efface le réalisé', () => {
    openPlannedWorkout();

    const exercise = exerciseAt(UUID);

    checkSet(UUID, exercise, nextLine(exercise));
    expect(loggedRows()).toHaveLength(1);

    expect(cancelWorkout(UUID)).toBe('reset');

    const row = workoutRow();

    // Redevenue exactement ce qu'elle était : ni commencée, ni close, et le
    // statut n'a pas bougé — la programmation appartient au serveur.
    expect(row?.startedAt).toBeNull();
    expect(row?.endedAt).toBeNull();
    expect(row?.status).toBe('planned');
    expect(loggedRows()).toHaveLength(0);
    // Le déroulé se relit vide : plus une série cochée nulle part.
    expect(exerciseAt(UUID).done).toBe(0);
  });

  it('empile la mutation qui reprend le réalisé au serveur', () => {
    openPlannedWorkout();

    const exercise = exerciseAt(UUID);

    checkSet(UUID, exercise, nextLine(exercise));
    cancelWorkout(UUID);

    // Une seule entrée, coalescée par uuid : celle de la série cochée a été
    // réarmée, pas doublée. Poussée, elle enverra `log: []`.
    expect(listMutations().map((mutation) => mutation.payload.uuid)).toEqual([UUID]);
  });

  it('n’empile rien quand rien n’avait été coché', () => {
    openPlannedWorkout();

    expect(cancelWorkout(UUID)).toBe('reset');
    // Ouvrir n'empile aucune mutation (`start.ts`) : annuler tout de suite n'a
    // rien à reprendre au serveur, qui n'a jamais rien vu.
    expect(listMutations()).toHaveLength(0);
  });

  it('efface aussi un exercice sauté ou ajouté, qui n’a pourtant aucune série', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID, {
          blocks: [
            prescribedBlock(1, [
              prescribedExercise(1, { type: 'distance_pace', summary: '5 km', sets: null }),
            ]),
          ],
        }),
      ],
    });
    beginWorkout(UUID);

    // Un cardio coché fait : un `logged_exercise` sans la moindre série, et
    // c'est bien du réalisé.
    const exercise = exerciseAt(UUID);

    expect(exercise.lines).toBeNull();

    db.insert(loggedExercise)
      .values({
        scheduledUuid: UUID,
        exerciseId: 101,
        exerciseName: 'Exercice 101',
        sourcePrescribedId: 1,
        position: 0,
        skipped: false,
        notes: null,
      })
      .run();

    expect(cancelWorkout(UUID)).toBe('reset');
    expect(loggedRows()).toHaveLength(0);
    expect(listMutations()).toHaveLength(1);
  });

  it('garde l’ordre local : ranger son déroulé n’est pas du réalisé', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID, {
          blocks: [prescribedBlock(1, [prescribedExercise(1), prescribedExercise(2)])],
        }),
      ],
    });
    beginWorkout(UUID);

    moveExercise(UUID, programOf(UUID), exerciseAt(UUID).key, 1);

    const arranged = db
      .select()
      .from(sessionLayout)
      .where(eq(sessionLayout.scheduledUuid, UUID))
      .all();

    expect(arranged.length).toBeGreaterThan(0);

    cancelWorkout(UUID);

    // Il se règle avant même d'avoir démarré (KL-52) : l'effacer punirait
    // quelqu'un qui a rangé sa séance puis s'est trompé de bouton.
    expect(
      db.select().from(sessionLayout).where(eq(sessionLayout.scheduledUuid, UUID)).all(),
    ).toHaveLength(arranged.length);
  });
});

describe('cancelWorkout, séance libre', () => {
  it('supprime la séance et empile sa suppression', () => {
    const uuid = createFreeWorkout('Improvisée');

    expect(cancelWorkout(uuid)).toBe('deleted');
    expect(workoutRow(uuid)).toBeUndefined();

    const mutations = listMutations();

    expect(mutations).toHaveLength(1);
    // Un `DELETE`, pas un `PUT` : pousser le document d'une séance qu'on vient
    // de supprimer la recréerait côté serveur (`queue.ts`).
    expect(mutations[0].type).toBe('schedule.delete');
    expect(mutations[0].payload.uuid).toBe(uuid);
  });

  it('remplace l’envoi qui attendait encore', () => {
    const uuid = createFreeWorkout();

    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    beginWorkout(UUID);

    const exercise = exerciseAt(UUID);

    checkSet(UUID, exercise, nextLine(exercise));

    cancelWorkout(uuid);

    // La séance libre n'a plus qu'une suppression ; celle d'à côté garde son
    // envoi, une annulation n'en concerne qu'une.
    expect(listMutations().map((mutation) => [mutation.type, mutation.payload.uuid])).toEqual([
      ['schedule.put', UUID],
      ['schedule.delete', uuid],
    ]);
  });
});

describe('cancelWorkout, ce qu’elle refuse', () => {
  it('refuse une séance jamais commencée', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    expect(cancelWorkout(UUID)).toBeNull();
    expect(listMutations()).toHaveLength(0);
  });

  it('refuse une séance close : elle raconte ce qui a eu lieu', () => {
    openPlannedWorkout();

    const exercise = exerciseAt(UUID);

    checkSet(UUID, exercise, nextLine(exercise));
    closeWorkout(UUID);

    expect(cancelWorkout(UUID)).toBeNull();
    expect(workoutRow()?.status).toBe('done');
    expect(loggedRows()).toHaveLength(1);
  });

  it('refuse une séance introuvable', () => {
    expect(cancelWorkout('01890000-0000-7000-8000-0000000000ff')).toBeNull();
  });
});
