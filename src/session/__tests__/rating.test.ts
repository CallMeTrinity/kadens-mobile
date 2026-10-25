/**
 * Le ressenti d'une séance : forme 1-5, difficulté 1-10, notés après la clôture.
 *
 * Ce que ces tests tiennent : c'est la seule écriture d'une séance **close**
 * (garde inverse de tout le réalisé), elle ne retire jamais une note — le web
 * seul le fait — et sa mutation part dans la même transaction, sinon un pull
 * remplacerait une note jamais envoyée.
 */

import { eq } from 'drizzle-orm';

import { db, scheduledWorkout } from '@/db';
import { beginWorkout, closeWorkout, effortLabel, feelingLabel, rateWorkout } from '@/session';
import { listMutations } from '@/sync';
import { resetDatabase } from '@/test/database';
import { scheduledWorkout as scheduledWorkoutPayload, seedBootstrap } from '@/test/fixtures';

const UUID = '01890000-0000-7000-8000-000000000301';

function workoutRow() {
  return db.select().from(scheduledWorkout).where(eq(scheduledWorkout.uuid, UUID)).get();
}

function closedWorkout(overrides: Parameters<typeof scheduledWorkoutPayload>[1] = {}) {
  seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID, overrides)] });
  beginWorkout(UUID);
  closeWorkout(UUID);
}

beforeEach(() => {
  resetDatabase();
});

describe('rateWorkout', () => {
  it('note une séance close et empile sa mutation', () => {
    closedWorkout();

    expect(rateWorkout(UUID, { feeling: 4, sessionRpe: 7 })).toBe(true);

    expect(workoutRow()).toMatchObject({ feeling: 4, sessionRpe: 7 });
    expect(listMutations().map((mutation) => mutation.payload.uuid)).toEqual([UUID]);
  });

  it('refuse une séance encore ouverte : on note ce qui est fini', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    beginWorkout(UUID);

    expect(rateWorkout(UUID, { feeling: 4, sessionRpe: 7 })).toBe(false);
    expect(workoutRow()?.feeling).toBeNull();
  });

  it('refuse une séance déclarée faite ailleurs : elle se note sur le web', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID, { status: 'done' })] });

    expect(rateWorkout(UUID, { feeling: 3, sessionRpe: null })).toBe(false);
    expect(listMutations()).toHaveLength(0);
  });

  it('change une note sans jamais retirer l’autre axe', () => {
    closedWorkout();
    rateWorkout(UUID, { feeling: 4, sessionRpe: 7 });

    expect(rateWorkout(UUID, { feeling: null, sessionRpe: 9 })).toBe(true);

    expect(workoutRow()).toMatchObject({ feeling: 4, sessionRpe: 9 });
  });

  it('n’écrit rien quand rien ne change, ni hors échelle', () => {
    closedWorkout();
    rateWorkout(UUID, { feeling: 4, sessionRpe: 7 });
    const before = listMutations()[0].attempts;

    expect(rateWorkout(UUID, { feeling: 4, sessionRpe: 7 })).toBe(false);
    expect(rateWorkout(UUID, { feeling: 6, sessionRpe: 11 })).toBe(false);
    expect(rateWorkout(UUID, { feeling: 2.5, sessionRpe: 0 })).toBe(false);

    expect(workoutRow()).toMatchObject({ feeling: 4, sessionRpe: 7 });
    expect(listMutations()).toHaveLength(1);
    expect(listMutations()[0].attempts).toBe(before);
  });
});

describe('les libellés', () => {
  it('suivent les échelles de Garmin', () => {
    expect([1, 2, 3, 4, 5].map(feelingLabel)).toEqual([
      'Très faible',
      'Faible',
      'Normal',
      'En forme',
      'Très en forme',
    ]);
    expect([1, 2, 3, 4, 6, 7, 8, 9, 10].map(effortLabel)).toEqual([
      'Très léger',
      'Léger',
      'Léger',
      'Modéré',
      'Modéré',
      'Difficile',
      'Difficile',
      'Très difficile',
      'Maximal',
    ]);
    expect(feelingLabel(null)).toBeNull();
    expect(effortLabel(0)).toBeNull();
  });
});
