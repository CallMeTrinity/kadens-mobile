/**
 * Clôturer une séance (KL-33), vérifié sur ce qui la rend terminale (KL-36).
 *
 * Clôturer est du réalisé, contrairement à ouvrir : c'est le fait accompli, et
 * il empile donc sa mutation dans la **même transaction**. L'app tuée entre les
 * deux laisserait une séance close que rien ne signale comme non poussée, et le
 * pull suivant la rouvrirait sans un mot.
 *
 * C'est aussi ce qui fait partir une séance qui n'avait rien à dire jusque-là :
 * une sortie cardio cochée, une séance libre restée vide n'existaient que sur le
 * téléphone.
 */

import { eq } from 'drizzle-orm';

import { db, scheduledWorkout } from '@/db';
import { beginWorkout, closeWorkout, createFreeWorkout } from '@/session';
import { listMutations } from '@/sync';
import { resetDatabase } from '@/test/database';
import { scheduledWorkout as scheduledWorkoutPayload, seedBootstrap } from '@/test/fixtures';

const UUID = '01890000-0000-7000-8000-000000000101';

function workoutRow(uuid: string = UUID) {
  return db.select().from(scheduledWorkout).where(eq(scheduledWorkout.uuid, uuid)).get();
}

beforeEach(() => {
  resetDatabase();
});

describe('closeWorkout', () => {
  it('pose la borne de fin, le statut, et empile la mutation', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    beginWorkout(UUID);

    expect(closeWorkout(UUID, 'Bonne séance')).toBe(true);

    const row = workoutRow();

    expect(row?.endedAt).not.toBeNull();
    // Le statut n'est écrit qu'ici : c'est la seule valeur de programmation que
    // le contrat laisse au téléphone.
    expect(row?.status).toBe('done');
    expect(row?.completionNotes).toBe('Bonne séance');
    expect(listMutations().map((mutation) => mutation.payload.uuid)).toEqual([UUID]);
  });

  it('n’efface pas une note déjà saisie sur le web', () => {
    seedBootstrap({
      schedule: [scheduledWorkoutPayload(UUID, { completionNotes: 'Écrite sur le web' })],
    });
    beginWorkout(UUID);

    closeWorkout(UUID, '   ');

    // Écrire `null` localement sur un champ vide ferait diverger les deux bases
    // au premier aller-retour, le serveur gardant ce que le téléphone perd.
    expect(workoutRow()?.completionNotes).toBe('Écrite sur le web');
  });

  it('refuse une séance qui n’a pas commencé', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    expect(closeWorkout(UUID)).toBe(false);
    expect(listMutations()).toHaveLength(0);
  });

  it('ne se reprend pas : une séance close est close', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    beginWorkout(UUID);
    closeWorkout(UUID, 'Première');

    const endedAt = workoutRow()?.endedAt;

    expect(closeWorkout(UUID, 'Seconde')).toBe(false);
    expect(workoutRow()?.endedAt).toBe(endedAt);
    expect(workoutRow()?.completionNotes).toBe('Première');
  });

  it('ne rouvre pas une séance close par `beginWorkout`', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    beginWorkout(UUID);
    closeWorkout(UUID);

    // Refaire la même séance dans la journée crée une séance libre, ce n'est pas
    // une reprise.
    expect(beginWorkout(UUID)).toBe(false);
  });

  it('envoie une séance libre restée vide, qui n’existait que sur le téléphone', () => {
    const uuid = createFreeWorkout('Impro du soir');

    // Ouvrir n'empile rien : le pull épargne déjà la séance par « commencée et
    // pas terminée ».
    expect(listMutations()).toHaveLength(0);

    expect(closeWorkout(uuid)).toBe(true);
    expect(listMutations().map((mutation) => mutation.payload.uuid)).toEqual([uuid]);
  });
});

describe('beginWorkout', () => {
  it('est idempotent : reprendre ne réécrit pas la borne de départ', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });

    expect(beginWorkout(UUID)).toBe(true);

    const startedAt = workoutRow()?.startedAt;

    expect(beginWorkout(UUID)).toBe(true);
    // Sinon la durée de la séance repartirait de zéro à chaque retour sur
    // l'écran, et c'est elle que le résumé de clôture affiche.
    expect(workoutRow()?.startedAt).toBe(startedAt);
  });

  it('n’empile aucune mutation : rien n’a encore été fait', () => {
    seedBootstrap({ schedule: [scheduledWorkoutPayload(UUID)] });
    beginWorkout(UUID);

    expect(listMutations()).toHaveLength(0);
  });
});
