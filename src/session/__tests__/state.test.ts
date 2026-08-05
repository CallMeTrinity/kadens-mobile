/**
 * Où en est une séance : `isRunning` / `isClosed`, et ce qu'elles décident.
 *
 * Le cas que ces tests tiennent est celui qui manquait : une séance **cochée
 * « faite » sur le web**. Elle n'a pas d'`ended_at` — seul le téléphone en écrit
 * un — et se présentait donc comme une séance à démarrer, jusqu'à rafler
 * l'unique action primaire du jour à celle qui restait à faire. Or rien ne
 * déclôture côté serveur (`docs/api-mobile.md §4.1`), et on ne consigne pas
 * rétroactivement une séance déjà déclarée faite.
 *
 * L'autre bord compte autant : le téléphone garde autorité sur ses propres
 * bornes. Une séance ouverte ici et déclarée faite ailleurs pendant ce temps se
 * **reprend**, elle ne se ferme pas sous les doigts.
 */

import { eq } from 'drizzle-orm';

import { db, scheduledWorkout } from '@/db';
import { beginWorkout, isClosed, isRunning, toDayWorkout } from '@/session';
import { resetDatabase } from '@/test/database';
import { scheduledWorkout as scheduledWorkoutPayload, seedBootstrap } from '@/test/fixtures';

const UUID = '01890000-0000-7000-8000-000000000201';

function row(uuid: string = UUID) {
  return db.select().from(scheduledWorkout).where(eq(scheduledWorkout.uuid, uuid)).get()!;
}

beforeEach(() => {
  resetDatabase();
});

describe('isClosed', () => {
  it('tient une séance déclarée faite sur le web pour fermée', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID, { status: 'done' })] });

    const workout = row();

    expect(workout.endedAt).toBeNull();
    expect(isClosed(workout)).toBe(true);
    expect(isRunning(workout)).toBe(false);
  });

  it('laisse ouverte une séance prévue, et une séance manquée', () => {
    seedBootstrap({
      schedule: [
        scheduledWorkoutPayload(UUID),
        scheduledWorkoutPayload('01890000-0000-7000-8000-000000000202', { status: 'missed' }),
      ],
    });

    expect(isClosed(row())).toBe(false);
    expect(isClosed(row('01890000-0000-7000-8000-000000000202'))).toBe(false);
  });

  it('laisse la reprise à une séance ouverte ici et déclarée faite ailleurs', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    beginWorkout(UUID);

    // Ce que ferait un pull sur une séance sans mutation en attente.
    db.update(scheduledWorkout)
      .set({ status: 'done' })
      .where(eq(scheduledWorkout.uuid, UUID))
      .run();

    const workout = row();

    expect(isRunning(workout)).toBe(true);
    expect(isClosed(workout)).toBe(false);
  });
});

describe('toDayWorkout', () => {
  it('rend une séance faite sur le web non actionnable', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID, { status: 'done' })] });

    const card = toDayWorkout(row(), 0, false);

    // C'est ce couple qui décide « Voir la séance » plutôt que « Démarrer », et
    // qui l'écarte du choix de l'unique action primaire du jour.
    expect(card.closed).toBe(true);
    expect(card.running).toBe(false);
  });
});

describe('beginWorkout', () => {
  it('refuse d’ouvrir une séance déclarée faite sur le web', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID, { status: 'done' })] });

    expect(beginWorkout(UUID)).toBe(false);
    // Rien n'est écrit : la séance reste telle que le serveur la donne.
    expect(row().startedAt).toBeNull();
  });

  it('ouvre encore une séance manquée — rattraper la veille reste possible', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID, { status: 'missed' })] });

    expect(beginWorkout(UUID)).toBe(true);
    expect(row().startedAt).not.toBeNull();
  });
});
