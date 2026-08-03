import { eq } from 'drizzle-orm';

import { db, type Writer } from './client';
import { SYNC_STATE_ID, syncState, type SyncStateRow } from './schema';

/**
 * L'accès à la ligne unique de `sync_state`.
 *
 * Ces deux fonctions existent parce que le « une seule ligne » est un invariant,
 * pas une convention : la contrainte `CHECK (id = 1)` le fait respecter par la
 * base, encore faut-il que personne n'écrive de `INSERT` concurrent ailleurs.
 * Tout passe donc par ici, et l'`onConflictDoUpdate` rend l'écriture indifférente
 * à l'existence préalable de la ligne — il n'y a jamais d'étape « initialiser la
 * base » à ne pas oublier.
 *
 * Le moteur de synchronisation (KL-27) est le seul écrivain de `serverTime`, de
 * la fenêtre et des deux dates ; l'appairage (KL-48) est le seul écrivain
 * d'`apiUrl`.
 */

/** La ligne d'état, ou `null` tant qu'aucune synchronisation n'a eu lieu. */
export async function getSyncState(): Promise<SyncStateRow | null> {
  const rows = await db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ID)).limit(1);

  return rows[0] ?? null;
}

/**
 * Écrit tout ou partie de l'état. Les champs absents de `patch` **ne sont pas
 * touchés** : un push qui met à jour `lastPushedAt` n'a pas à connaître la
 * fenêtre du dernier pull.
 */
export async function patchSyncState(patch: Partial<Omit<SyncStateRow, 'id'>>): Promise<void> {
  patchSyncStateIn(db, patch);
}

/**
 * La même écriture, **dans la transaction de l'appelant**.
 *
 * Le pull en a besoin : « appliquer le bootstrap et avancer `lastPulledAt` » doit
 * être un seul geste. Un état avancé sur une base à moitié écrite ferait repartir
 * la synchronisation suivante d'un `since` qui promet des données jamais arrivées.
 */
export function patchSyncStateIn(writer: Writer, patch: Partial<Omit<SyncStateRow, 'id'>>): void {
  // Un patch vide produirait un `ON CONFLICT DO UPDATE SET` sans affectation,
  // que SQLite refuse. Rien à écrire, rien à faire.
  if (Object.keys(patch).length === 0) {
    return;
  }

  writer
    .insert(syncState)
    .values({ id: SYNC_STATE_ID, ...patch })
    .onConflictDoUpdate({ target: syncState.id, set: patch })
    .run();
}
