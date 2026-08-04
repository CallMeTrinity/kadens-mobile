import { clearDatabase } from '@/db';

import { syncNow, type SyncOutcome } from './engine';
import { listMutations } from './queue';

/**
 * « Resynchroniser tout » : jeter la base locale et la reconstruire (KL-35).
 *
 * ## Ce que ce bouton répare, et pourquoi il existe
 *
 * Le pull normal est un **delta** : `?since` n'allège que la bibliothèque, mais
 * il suffit qu'une base locale ait divergé (un pull appliqué à moitié sur un
 * ancêtre de l'app, un exercice supprimé pendant qu'on était hors réseau) pour
 * qu'aucun cycle ultérieur ne la recolle — le serveur ne renvoie que ce qui a
 * bougé depuis. Purger remet `serverTime` à null (`clearDatabase`), donc
 * redemande **tout**. C'est la seule sortie de secours de l'app, et elle doit
 * rester la dernière : elle jette un état sain aussi bien qu'un état cassé.
 *
 * ## L'ordre est une garantie, pas une commodité
 *
 * 1. **Un cycle complet d'abord.** Il pousse ce qui attend et prouve que le
 *    serveur répond. Purger avant, ce serait effacer un réalisé jamais envoyé —
 *    exactement ce que le moteur passe son temps à protéger (`pull.ts`).
 * 2. **Rien n'est purgé si ce cycle n'a pas abouti.** Un `ok: false` (réseau,
 *    refus), mais aussi un cycle **sauté** — session fermée, donc `pull` nul :
 *    sans cette seconde condition, un `ok: true` sans aucun échange autoriserait
 *    une purge que rien ne viendrait combler, et l'app se retrouverait vide dans
 *    un sous-sol.
 * 3. **Rien n'est purgé si la file n'est pas vide.** Ce qui reste après un push
 *    réussi, ce sont les mutations que le serveur **refuse** (marquées au
 *    cinquième essai). Les jeter perdrait le réalisé qu'elles portent, en silence
 *    et sans recours ; c'est le seul cas où ce bouton renvoie l'utilisateur vers
 *    un autre geste.
 * 4. **Purge, puis un second cycle** — qui est un bootstrap complet, `serverTime`
 *    ayant été remis à zéro. Aucun chemin de « pull seul » n'est inventé pour
 *    l'occasion : la règle « push avant pull » n'a pas d'exception, même quand la
 *    file qu'on pousse est vide par construction.
 *
 * La fenêtre entre la purge et le second cycle reste réelle : l'app tuée là
 * redémarre sur une base vide, avec son jeton et son URL. Elle se remplit au
 * lancement suivant (`useSyncTriggers`), donc rien n'est perdu — mais quelqu'un
 * qui coupe le réseau à cette seconde-là voit une app vide, et c'est le prix du
 * geste.
 */

/** Pourquoi la purge n'a pas eu lieu. */
export type ResetRefusal =
  /** Le cycle préalable n'a pas abouti : le serveur n'a pas répondu, ou la session est fermée. */
  | 'unreachable'
  /** Des mutations restent en file : elles portent du réalisé que la purge perdrait. */
  | 'pending';

export interface ResetOutcome {
  ok: boolean;
  /** Nul quand la purge a eu lieu — que le bootstrap qui suit ait réussi ou non. */
  refusedBy: ResetRefusal | null;
  /** Combien de mutations bloquent, quand c'est la raison du refus. */
  pending: number;
  error: string | null;
}

/** Vide la base locale et la reconstruit depuis le serveur. Ne lève jamais. */
export async function resyncAll(): Promise<ResetOutcome> {
  const drained = await syncNow('manual');

  if (!drained.ok || drained.pull === null) {
    return {
      ok: false,
      refusedBy: 'unreachable',
      pending: 0,
      error: drained.error ?? reasonOfSkipped(drained),
    };
  }

  const stuck = listMutations().length;

  if (stuck > 0) {
    return { ok: false, refusedBy: 'pending', pending: stuck, error: drained.error };
  }

  clearDatabase();

  const rebuilt = await syncNow('manual');

  return { ok: rebuilt.ok, refusedBy: null, pending: 0, error: rebuilt.error };
}

/**
 * Un cycle sauté ne porte pas d'erreur : il n'a rien tenté. C'est le cas d'une
 * session fermée, où le moteur renonce avant le réseau (`engine.ts`).
 */
function reasonOfSkipped(outcome: SyncOutcome): string {
  return outcome.push === null
    ? "Aucune synchronisation n'a eu lieu : la session est fermée."
    : "Le serveur n'a pas répondu.";
}
