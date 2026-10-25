import { eq } from 'drizzle-orm';

import { db, scheduledWorkout } from '@/db';
import { enqueueSchedulePut, syncOnWorkoutClosed } from '@/sync';

/**
 * Le ressenti d'une séance : la **forme** (1-5, de très faible à très en forme) et
 * la **difficulté** (1-10), aux échelles de Garmin. Le jumeau de `Feeling` et de
 * `SessionRating` côté serveur : les libellés sont écrits ici et nulle part
 * ailleurs dans l'app.
 *
 * La difficulté n'est pas le `rpe` des séries : c'est un jugement global porté à
 * la fin, pas une moyenne. D'où son nom, `sessionRpe`, et son libellé à l'écran,
 * « Difficulté », jamais « RPE » tout court.
 *
 * ## Noter après la clôture, pas pendant
 *
 * Toutes les écritures du réalisé exigent une séance ouverte (`writes.ts`). Le
 * ressenti est l'inverse : il n'a de sens qu'une fois la séance **close**, et il
 * reste modifiable ensuite (on se rend compte le soir que c'était plus dur qu'on
 * ne l'a dit). Sa garde est donc « close sur ce téléphone » (`endedAt` posé) :
 * une séance déclarée faite sur le web n'a pas de réalisé ici à renvoyer, et son
 * ressenti se saisit là-bas.
 *
 * ## Écrire sans jamais effacer
 *
 * Même règle que la note de clôture et que le contrat (§4.1) : une valeur
 * absente ne retire rien. Le téléphone peut changer une note, pas la retirer —
 * c'est un geste du web. Sans ça, un téléphone qui renvoie un vieux document
 * effacerait la correction faite entre-temps sur le site.
 */

export interface WorkoutRating {
  feeling: number | null;
  sessionRpe: number | null;
}

export const FEELING_MAX = 5;
export const SESSION_RPE_MAX = 10;

const FEELING_LABELS: Record<number, string> = {
  1: 'Très faible',
  2: 'Faible',
  3: 'Normal',
  4: 'En forme',
  5: 'Très en forme',
};

/** Le libellé d'une forme, ou `null` hors échelle. */
export function feelingLabel(value: number | null | undefined): string | null {
  return value == null ? null : (FEELING_LABELS[Math.round(value)] ?? null);
}

/** Les paliers de l'échelle RPE de Garmin. */
export function effortLabel(value: number | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const rounded = Math.round(value);
  if (rounded < 1 || rounded > SESSION_RPE_MAX) {
    return null;
  }

  if (rounded === 1) return 'Très léger';
  if (rounded <= 3) return 'Léger';
  if (rounded <= 6) return 'Modéré';
  if (rounded <= 8) return 'Difficile';
  if (rounded === 9) return 'Très difficile';

  return 'Maximal';
}

function inScale(value: number | null, max: number): number | null {
  return value != null && Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

/**
 * Note une séance close sur ce téléphone. Seuls les axes renseignés s'écrivent ;
 * rend `true` si quelque chose a changé — valider sans toucher n'empile rien.
 *
 * La synchronisation part tout de suite, comme à la clôture : c'est le même
 * geste, prolongé d'un écran. Si elle chevauche celle de la clôture, le moteur
 * enchaîne un second cycle au lieu de perdre la note.
 */
export function rateWorkout(uuid: string, rating: WorkoutRating): boolean {
  const feeling = inScale(rating.feeling, FEELING_MAX);
  const sessionRpe = inScale(rating.sessionRpe, SESSION_RPE_MAX);

  const changed = db.transaction((tx) => {
    const row = tx
      .select({
        endedAt: scheduledWorkout.endedAt,
        feeling: scheduledWorkout.feeling,
        sessionRpe: scheduledWorkout.sessionRpe,
      })
      .from(scheduledWorkout)
      .where(eq(scheduledWorkout.uuid, uuid))
      .get();

    if (!row || row.endedAt === null) {
      return false;
    }

    const next = {
      ...(feeling !== null && feeling !== row.feeling ? { feeling } : {}),
      ...(sessionRpe !== null && sessionRpe !== row.sessionRpe ? { sessionRpe } : {}),
    };

    if (Object.keys(next).length === 0) {
      return false;
    }

    tx.update(scheduledWorkout).set(next).where(eq(scheduledWorkout.uuid, uuid)).run();
    enqueueSchedulePut(uuid, tx);

    return true;
  });

  if (changed) {
    syncOnWorkoutClosed();
  }

  return changed;
}
