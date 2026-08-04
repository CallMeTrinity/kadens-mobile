import * as Network from 'expo-network';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { syncNow } from './engine';

/**
 * Quand la synchronisation part (KL-27).
 *
 * Quatre déclencheurs, et chacun répond à un moment précis où l'app peut avoir
 * quelque chose à échanger :
 *
 * 1. **Au lancement**, une fois la session restaurée. C'est le rafraîchissement
 *    qu'une session restaurée ne fait plus au démarrage depuis KL-26 : elle saute
 *    l'écran de bootstrap parce que sa base locale porte déjà le dernier pull,
 *    et c'est ici que la mise à jour se rattrape — en tâche de fond, sans retenir
 *    personne devant un écran de chargement.
 * 2. **Au retour au premier plan.** Une app rouverte le lendemain a une fenêtre
 *    d'un jour de retard.
 * 3. **Au retour du réseau.** Le cas nominal : la séance s'est faite au sous-sol,
 *    le réalisé part en remontant l'escalier, sans que personne ait à y penser.
 * 4. **À la clôture d'une séance** — pas ici, mais par un appel direct à
 *    `syncOnWorkoutClosed()`, que `closeWorkout()` (`@/session`, KL-33) fait
 *    après avoir validé sa transaction. Dans le domaine plutôt que dans l'écran :
 *    tout chemin de clôture doit le déclencher, et un appelant qui l'oublierait
 *    laisserait la séance attendre le prochain retour au premier plan.
 *
 * Le moteur se charge de ne pas les laisser se doubler : un cycle à la fois, et
 * un plancher de dix secondes entre deux cycles automatiques (`engine.ts`).
 */

/**
 * Branche les trois déclencheurs automatiques. À monter **une fois**, dans le
 * layout racine — deux montages donneraient deux abonnements, donc deux demandes
 * par événement (que le moteur coalescerait, mais autant ne pas les émettre).
 *
 * `enabled` retient tout tant que la session n'est pas ouverte : un cycle lancé
 * sans jeton ne ferait que fermer une session déjà fermée.
 */
export function useSyncTriggers(enabled: boolean): void {
  // Le lancement ne doit partir qu'une fois par ouverture d'app, pas à chaque
  // fois que `enabled` rebascule (une déconnexion suivie d'une reconnexion, par
  // exemple : c'est un `first-sync`, pas un lancement).
  const launched = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!launched.current) {
      launched.current = true;
      void syncNow('launch');
    }

    const appState = AppState.addEventListener('change', (next: AppStateStatus) => {
      // Android passe par `inactive` sur certaines transitions ; seul le retour
      // effectif au premier plan nous intéresse, et le moteur ignorera de toute
      // façon une seconde demande dans les dix secondes.
      if (next === 'active') {
        void syncNow('foreground');
      }
    });

    // `isConnected` seul, jamais `isInternetReachable` : le second demande une
    // sonde sortante et reste `undefined` un moment après la bascule. Attendre sa
    // réponse retarderait le push de plusieurs secondes au moment précis où l'on
    // retrouve du réseau — et un cycle lancé pour rien coûte un `fetch` qui
    // échoue, ce que l'app sait déjà faire sans rien casser.
    let connected: boolean | null = null;

    const network = Network.addNetworkStateListener((state) => {
      const now = state.isConnected === true;
      const returned = connected === false && now;

      connected = now;

      if (returned) {
        void syncNow('network');
      }
    });

    // L'état de départ, sinon la première notification ne peut pas être lue comme
    // un *retour* du réseau : `connected` serait encore inconnu et la transition
    // passerait inaperçue.
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (connected === null) {
          connected = state.isConnected === true;
        }
      })
      .catch(() => {
        // Un état de réseau illisible ne doit pas empêcher les deux autres
        // déclencheurs : on repart de « inconnu », et la première bascule
        // observée fera foi.
      });

    return () => {
      appState.remove();
      network.remove();
    };
  }, [enabled]);
}

/**
 * Le quatrième déclencheur : une séance vient d'être clôturée (KL-33).
 *
 * Appelé par `closeWorkout()`, sans `await` : la clôture doit rendre la main tout
 * de suite, la séance est déjà écrite en base et sa mutation déjà en file. Ce qui
 * part ici n'est qu'une tentative d'envoi immédiate — si elle échoue, rien n'est
 * perdu, et l'écran de clôture le dit (« À synchroniser »).
 */
export function syncOnWorkoutClosed(): void {
  void syncNow('workout-closed');
}
