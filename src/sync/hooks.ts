/**
 * Les lectures vives du moteur de synchronisation (KL-35).
 *
 * `useSyncStatus()` (`engine.ts`) dit ce que le moteur est en train de faire ;
 * ces deux hooks-ci disent ce que la **base** en garde. La distinction est ce
 * qui rend l'écran de réglages juste après un redémarrage : l'état du moteur vit
 * en mémoire et repart vide à chaque lancement, alors qu'une synchronisation
 * réussie hier soir est un fait, écrit dans `sync_state`. Un écran qui n'aurait
 * lu que le moteur annoncerait « jamais synchronisé » sur une base fraîche.
 *
 * Ils sont ici, dans `@/sync`, et pas dans `@/session/hooks.ts` : la file de
 * mutations et l'état de synchronisation sont les objets de ce module. Le
 * domaine séance n'en connaît que ce dont il a besoin pour poser une marque
 * (`pendingMutationsQuery`).
 */

import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import {
  db,
  mutationQueue,
  scheduledWorkout,
  SYNC_STATE_ID,
  syncState,
  type MutationType,
  type SyncStateRow,
} from '@/db';

import { isExhausted } from './queue';

/**
 * L'état de synchronisation **persisté**, en lecture vive.
 *
 * `null` tant qu'aucune synchronisation n'a eu lieu — la ligne n'existe alors
 * pas. Écoute `sync_state`, que le pull avance dans sa propre transaction : la
 * date affichée se met à jour d'elle-même quand un cycle aboutit, sans que le
 * moteur ait à prévenir l'écran.
 */
export function useSyncState(): SyncStateRow | null {
  const { data } = useLiveQuery(
    db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ID)).limit(1),
  );

  return data[0] ?? null;
}

/** Une entrée de la file, telle que l'écran de réglages la montre. */
export interface QueuedMutation {
  id: number;
  type: MutationType;
  /** La séance concernée. Une mutation ne porte que ça (voir `queue.ts`). */
  uuid: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  /** Cinq refus du serveur : elle attend un geste humain. */
  exhausted: boolean;
  /**
   * Le titre de la séance, s'il est encore lisible en local. `null` pour une
   * séance supprimée (une `schedule.delete` en attente) : la mutation lui
   * survit, c'est tout son intérêt.
   */
  title: string | null;
  date: string | null;
}

/**
 * La file de mutations, dans son ordre de dépilage, avec de quoi la lire.
 *
 * **Deux lectures vives et un croisement en mémoire**, parce que l'uuid vit dans
 * une colonne JSON : le joindre en SQL demanderait `json_extract`, donc
 * l'extension json1 sur tous les Android visés — ce que le projet a déjà refusé
 * de supposer (`queue.ts`). La file est courte par construction (une entrée par
 * séance modifiée) et la fenêtre de séances datées tient en quelques dizaines de
 * lignes.
 *
 * Le `from` de chaque requête est ce que `useLiveQuery` écoute : `mutation_queue`
 * pour voir une entrée partir au push, `scheduled_workout` pour voir un titre
 * corrigé par un pull. Une entrée dont la séance a disparu garde sa place.
 */
export function useMutationQueue(): QueuedMutation[] {
  const { data: rows } = useLiveQuery(
    db.select().from(mutationQueue).orderBy(asc(mutationQueue.id)),
  );
  const { data: workouts } = useLiveQuery(
    db
      .select({
        uuid: scheduledWorkout.uuid,
        title: scheduledWorkout.title,
        date: scheduledWorkout.date,
      })
      .from(scheduledWorkout),
  );

  return useMemo(() => {
    const known = new Map(workouts.map((workout) => [workout.uuid, workout]));

    return rows.map((row) => {
      const workout = known.get(row.payload.uuid);

      return {
        id: row.id,
        type: row.type,
        uuid: row.payload.uuid,
        attempts: row.attempts,
        lastError: row.lastError,
        createdAt: row.createdAt,
        exhausted: isExhausted(row),
        title: workout?.title ?? null,
        date: workout?.date ?? null,
      };
    });
  }, [rows, workouts]);
}
