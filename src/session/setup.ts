import { eq } from 'drizzle-orm';

import { db, exerciseSetup } from '@/db';
import { enqueueSetupPut } from '@/sync';

/**
 * Les réglages de machine d'un exercice : « dossier : 5, jambe : 1 ».
 *
 * Un texte libre, attaché à l'**exercice** et non à la séance : on le note une
 * fois, il se relit à chaque séance qui passe par cette machine. C'est ce qui le
 * sépare de la note d'un exercice réalisé (`setExerciseState`), qui raconte une
 * séance et part avec elle.
 *
 * ## Pas de garde « séance ouverte »
 *
 * Toutes les écritures du réalisé exigent une séance commencée et pas close
 * (`writes.ts`) — un réalisé sans borne décrirait une séance qu'on n'a pas faite.
 * Un réglage ne décrit aucune séance : on le corrige en lisant le programme la
 * veille, ou en rangeant ses affaires après la clôture. Il n'a donc pas besoin
 * de cette garde, et l'écran l'ouvre quel que soit l'état de la séance.
 *
 * ## Écrire, c'est empiler
 *
 * Comme le réalisé : la ligne et sa mutation tiennent dans **une** transaction,
 * sans quoi un pull pourrait remplacer un réglage jamais parti. Un texte qui
 * n'a pas bougé n'empile rien — valider une feuille sans y toucher ne doit pas
 * faire attendre un envoi.
 */

/**
 * Écrit le réglage de cet exercice. Les espaces de bord sont retirés, comme côté
 * serveur — sans quoi le texte relu après le push ne serait plus celui envoyé ;
 * un texte vide efface la ligne. Rend `true` si quelque chose a changé.
 */
export function saveExerciseSetup(exerciseId: number, text: string): boolean {
  const next = text.trim();

  return db.transaction((tx) => {
    const current =
      tx
        .select({ text: exerciseSetup.text })
        .from(exerciseSetup)
        .where(eq(exerciseSetup.exerciseId, exerciseId))
        .get()?.text ?? '';

    if (next === current) {
      return false;
    }

    if (next === '') {
      tx.delete(exerciseSetup).where(eq(exerciseSetup.exerciseId, exerciseId)).run();
    } else {
      // `updatedAt` repasse à null : c'est l'horodatage du serveur, et il ne
      // décrit plus ce texte-ci tant que le push ne l'a pas confirmé.
      tx.insert(exerciseSetup)
        .values({ exerciseId, text: next, updatedAt: null })
        .onConflictDoUpdate({
          target: exerciseSetup.exerciseId,
          set: { text: next, updatedAt: null },
        })
        .run();
    }

    enqueueSetupPut(exerciseId, tx);

    return true;
  });
}
