import { eq } from 'drizzle-orm';

import { customMessage, db, nowIso } from '@/db';
import { enqueueMessageSeen } from '@/sync';

/**
 * Les messages programmés : un mot et un GIF, montrés une fois, à une date.
 *
 * ## Fermer, c'est empiler
 *
 * Le « vu » appartient au compte : le web ne doit pas remontrer un message fermé
 * ici. Il suit donc le chemin d'un réglage de machine (`setup.ts`) — la ligne et
 * sa mutation dans **une** transaction, sans quoi un pull pourrait ramener le
 * message avant que le serveur sache qu'il a été lu.
 */

/** Marque ce message comme vu. Rend `false` s'il l'était déjà, ou s'il n'existe plus. */
export function markMessageSeen(messageId: number): boolean {
  return db.transaction((tx) => {
    const row = tx
      .select({ seenAt: customMessage.seenAt })
      .from(customMessage)
      .where(eq(customMessage.id, messageId))
      .get();

    if (!row || row.seenAt !== null) {
      return false;
    }

    tx.update(customMessage).set({ seenAt: nowIso() }).where(eq(customMessage.id, messageId)).run();
    enqueueMessageSeen(messageId, tx);

    return true;
  });
}
