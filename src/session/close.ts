/**
 * Clôturer une séance (KL-33).
 *
 * Le pendant de `start.ts` : un seul geste, une seule écriture, et c'est le seul
 * endroit de l'app qui pose `ended_at` et fait passer une séance en `done`.
 *
 * ## Clôturer est du réalisé, contrairement à ouvrir
 *
 * `start.ts` n'empile **aucune** mutation, et l'explique : rien n'a encore été
 * fait, et le pull épargne déjà la séance par « commencée et pas terminée ». La
 * clôture, elle, est l'inverse exact — c'est le fait accompli. Elle écrit donc sa
 * mutation dans la **même transaction**, comme chaque série cochée, et pour la
 * même raison : l'app tuée entre les deux laisserait une séance close que rien ne
 * signale comme non poussée, et le pull suivant — qui remplace la fenêtre — la
 * rouvrirait sans un mot.
 *
 * C'est aussi ce qui fait partir une séance qui n'avait rien à dire jusque-là :
 * une sortie cardio cochée, une séance libre restée vide. Elles n'existaient que
 * sur le téléphone, la clôture les envoie.
 *
 * ## Pas de reprise après clôture (§2.3 point 5)
 *
 * Une séance datée porte **au plus une exécution**. `closeWorkout` refuse donc
 * une séance déjà close ou jamais commencée, `isOpen` ferme la porte à toutes les
 * écritures de réalisé qui arriveraient après, et rien côté serveur ne
 * déclôture (§4.1 du contrat : `status` ne peut que clôturer). Refaire la même
 * séance dans la journée crée une séance libre, ce n'est pas une reprise.
 *
 * ## Ce que la clôture ne fait pas
 *
 * Elle ne touche **ni la date ni le titre** — le serveur reste l'autorité sur la
 * programmation — et elle **n'efface jamais** la note de clôture. Le contrat dit
 * la même chose de son côté (`completionNotes` « n'efface jamais l'existante ») :
 * écrire `null` localement sur un champ vide ferait diverger les deux bases au
 * premier aller-retour, le serveur gardant ce que le téléphone vient de perdre.
 */

import { eq } from 'drizzle-orm';

import { db, nowIso, scheduledWorkout } from '@/db';
import { enqueueSchedulePut, syncOnWorkoutClosed } from '@/sync';

import { stopRest } from './rest';
import { isOpen } from './writes';

/**
 * Clôture une séance ouverte, avec sa note de fin. Rend `false` si elle n'était
 * pas ouverte.
 *
 * La synchronisation part **après** le commit, et sans être attendue : la séance
 * est déjà en sécurité en base et sa mutation déjà en file, l'envoi n'est qu'une
 * tentative immédiate. Elle est déclenchée ici plutôt que par l'écran pour que
 * tout chemin de clôture la déclenche — un second appelant qui l'oublierait
 * laisserait le réalisé attendre le prochain retour au premier plan.
 *
 * Le repos en cours s'arrête au passage : il n'appartient à aucun écran
 * (`rest.ts`), donc rien d'autre ne le couperait, et un décompte qui survivrait
 * à la séance ferait vibrer le téléphone sous la douche.
 */
export function closeWorkout(uuid: string, notes = ''): boolean {
  const note = notes.trim();

  const closed = db.transaction((tx) => {
    if (!isOpen(tx, uuid)) {
      return false;
    }

    tx.update(scheduledWorkout)
      .set({
        endedAt: nowIso(),
        // Le statut n'est écrit qu'ici. C'est la seule valeur que le contrat
        // laisse au téléphone (§4.1), et elle ne se reprend pas.
        status: 'done',
        // Une note vide ne s'écrit pas : on n'efface pas ce qui a pu être saisi
        // sur le web (voir l'en-tête).
        ...(note.length > 0 ? { completionNotes: note } : {}),
      })
      .where(eq(scheduledWorkout.uuid, uuid))
      .run();

    enqueueSchedulePut(uuid, tx);

    return true;
  });

  if (closed) {
    stopRest();
    syncOnWorkoutClosed();
  }

  return closed;
}
