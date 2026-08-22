/**
 * Annuler une séance commencée : elle n'a pas eu lieu.
 *
 * Le geste manquait, et son absence coûtait cher. « Démarrer » est le bouton le
 * plus proche du pouce sur l'écran « Aujourd'hui » (KL-39), donc le plus facile à
 * toucher par erreur — et une fois `started_at` posé, plus rien ne le retirait :
 * la séance restait « en cours » au calendrier web, la carte du jour proposait
 * « Reprendre », et le seul chemin de sortie était de la clôturer, c'est-à-dire
 * de déclarer faite une séance qu'on n'avait pas faite.
 *
 * ## Annuler n'est pas clôturer, et c'est l'inverse exact
 *
 * `close.ts` écrit un **fait accompli** : `ended_at`, `status = done`, et la
 * séance devient terminale. Ici on écrit le contraire — il ne s'est rien passé —
 * et la séance redevient exactement ce qu'elle était avant qu'on la touche. Rien
 * n'est archivé au passage : une séance annulée ne laisse pas de trace, sinon
 * l'historique compterait des séances qu'on n'a pas faites.
 *
 * ## Deux séances, deux annulations
 *
 * - Une séance **programmée** appartient au serveur (§4.1 du contrat : la
 *   programmation ne se supprime pas depuis le téléphone, `DELETE` répond 409).
 *   On la remet donc à zéro : `started_at` repart à `null`, et tout le réalisé
 *   local s'en va avec.
 * - Une séance **libre** n'existe que parce qu'on l'a créée (`createFreeWorkout`).
 *   L'annuler, c'est la supprimer : la remettre à `started_at = null` laisserait
 *   une séance vide, sans programme et sans réalisé, au calendrier de tout le
 *   monde. C'est le premier appelant d'`enqueueScheduleDelete`, en place depuis
 *   KL-27 et jamais utilisé jusqu'ici.
 *
 * ## Ce qui part au serveur, et quand
 *
 * **Effacer du réalisé est du réalisé.** La mutation s'empile donc dans la même
 * transaction que l'effacement, exactement comme une série décochée (`log.ts`) et
 * pour la même raison : le pull remplace la fenêtre, et un effacement que rien ne
 * signale comme non poussé serait remis en place au cycle suivant.
 *
 * Mais **seulement s'il y avait quelque chose à dire**. Une séance ouverte par
 * erreur et refermée dans la minute n'a rien poussé et n'a rien à pousser :
 * `beginWorkout` n'empile aucune mutation (`start.ts`), l'annulation n'en empile
 * pas davantage. La condition est donc « du réalisé existait, ou une mutation
 * attendait déjà » — dans les deux cas le serveur a pu voir, ou verra, quelque
 * chose qu'il faut lui reprendre.
 */

import { eq } from 'drizzle-orm';

import { db, loggedExercise, scheduledWorkout, type Writer } from '@/db';
import {
  enqueueScheduleDelete,
  enqueueSchedulePut,
  pendingUuids,
  syncOnWorkoutCancelled,
} from '@/sync';

import { isClosed } from './queries';
import { stopRest } from './rest';

/**
 * Ce qu'une annulation a fait de la séance. L'écran s'en sert pour savoir s'il
 * lui reste quelque chose à afficher.
 */
export type CancelOutcome =
  /** Séance programmée : elle est redevenue « à faire », elle est toujours là. */
  | 'reset'
  /** Séance libre : elle n'existe plus, ici comme au serveur. */
  | 'deleted';

/**
 * Annule une séance commencée. Rend `null` si elle ne l'était pas — introuvable,
 * jamais démarrée, ou close.
 *
 * **Close, on refuse**, et c'est la même porte que partout ailleurs (§2.3 point
 * 5) : une séance clôturée raconte ce qui a eu lieu, l'annuler reviendrait à
 * réécrire un fait déjà envoyé. Le geste existe avant la clôture, et seulement
 * avant.
 *
 * L'ordre local (`session_layout`, KL-52) **survit à l'annulation d'une séance
 * programmée**, et c'est voulu : il n'est pas du réalisé, il se règle avant même
 * d'avoir démarré, et l'effacer punirait quelqu'un qui a rangé son déroulé puis
 * s'est trompé de bouton. Une séance libre l'emporte avec elle, par cascade.
 *
 * Le repos s'arrête au passage, pour la raison exacte de `closeWorkout` : il
 * n'appartient à aucun écran (`rest.ts`), donc rien d'autre ne le couperait, et
 * un décompte qui survivrait à la séance ferait vibrer le téléphone sans séance
 * derrière.
 */
export function cancelWorkout(uuid: string): CancelOutcome | null {
  const outcome = db.transaction((tx): CancelOutcome | null => {
    const row = tx
      .select({
        startedAt: scheduledWorkout.startedAt,
        endedAt: scheduledWorkout.endedAt,
        status: scheduledWorkout.status,
        freeform: scheduledWorkout.freeform,
      })
      .from(scheduledWorkout)
      .where(eq(scheduledWorkout.uuid, uuid))
      .get();

    if (!row || row.startedAt === null || isClosed(row)) {
      return null;
    }

    if (row.freeform) {
      // `session_layout` et le réalisé partent par cascade (`foreign_keys = ON`,
      // posé à chaque ouverture — voir `@/db`).
      tx.delete(scheduledWorkout).where(eq(scheduledWorkout.uuid, uuid)).run();
      // Empilée même si la séance n'a jamais été poussée : le contrat traite le
      // 404 comme un succès (`deleteSchedule`), et deviner ce que le serveur
      // connaît demanderait de tenir un second registre de ce qui est parti.
      enqueueScheduleDelete(uuid, tx);

      return 'deleted';
    }

    const spoke = hasLoggedData(tx, uuid) || pendingUuids(tx).has(uuid);

    tx.delete(loggedExercise).where(eq(loggedExercise.scheduledUuid, uuid)).run();
    tx.update(scheduledWorkout)
      .set({ startedAt: null })
      .where(eq(scheduledWorkout.uuid, uuid))
      .run();

    if (spoke) {
      enqueueSchedulePut(uuid, tx);
    }

    return 'reset';
  });

  if (outcome !== null) {
    stopRest();
    syncOnWorkoutCancelled();
  }

  return outcome;
}

/**
 * La séance porte-t-elle du réalisé ?
 *
 * Un `logged_exercise` suffit à répondre oui, séries ou pas : un exercice sauté,
 * un cardio coché fait et un exercice ajouté hors programme n'ont aucune série et
 * sont pourtant du réalisé — c'est même exactement ce que `dropEmptyLoggedExercise`
 * refuse d'effacer tout seul (`writes.ts`).
 */
function hasLoggedData(tx: Writer, uuid: string): boolean {
  return (
    tx
      .select({ id: loggedExercise.id })
      .from(loggedExercise)
      .where(eq(loggedExercise.scheduledUuid, uuid))
      .get() !== undefined
  );
}
