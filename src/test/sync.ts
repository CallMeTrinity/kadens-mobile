/**
 * Attendre le moteur (KL-36).
 *
 * `closeWorkout()` déclenche sa synchronisation **sans l'attendre** (KL-33 : la
 * clôture doit rendre la main tout de suite, la séance est déjà en sécurité en
 * base). Un test qui s'arrêterait là laisserait un cycle en vol, et Jest le
 * signalerait — à raison : sur un réseau mort, ce cycle dure le temps des trois
 * tentatives du transport.
 *
 * Il n'y a rien à exposer côté app pour ça, et c'est voulu : personne n'attend
 * `syncNow()`. On observe donc ce que le moteur publie déjà.
 *
 * **Ne pas remplacer par un `await syncNow(...)`** : une demande qui arrive
 * pendant un cycle en enchaîne un second à la fin (`engine.ts`), et le test
 * relancerait indéfiniment ce qu'il essaie d'attendre.
 */

import { getSyncStatus } from '@/sync';

const POLL_MS = 25;

/**
 * Rend la main quand plus aucun cycle ne tourne.
 *
 * L'échéance se compte en tours de boucle et non en `Date.now()` : les suites
 * qui vérifient le plancher anti-rafale figent l'horloge, et une attente qui s'y
 * fierait ne finirait jamais.
 */
export async function waitForIdle(timeoutMs = 20_000): Promise<void> {
  const attempts = Math.ceil(timeoutMs / POLL_MS);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (getSyncStatus().phase === 'idle') {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  throw new Error("Le moteur de synchronisation n'est pas revenu au repos.");
}
