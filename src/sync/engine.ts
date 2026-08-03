import { useSyncExternalStore } from 'react';

import { bootstrap, describeError, getSession, isTransient } from '@/api';
import { getSyncState } from '@/db';

import { applyBootstrap, type PullReport } from './pull';
import { pushPending, type PushReport } from './push';

/**
 * Le moteur de synchronisation (KL-27).
 *
 * ## L'ordre n'est pas négociable : push, puis pull
 *
 * Le pull **remplace** la fenêtre de séances datées. Lancé en premier, il
 * écraserait une séance faite le matin et pas encore envoyée — et il n'y a pas de
 * drapeau « modifié localement » à consulter, c'est la file qui porte ce fait
 * (`schema.ts`). Pousser d'abord vide la file de ce qui peut partir ; ce qui reste
 * est précisément ce que le pull doit épargner (`pull.ts`).
 *
 * Un pull sans push n'existe donc pas dans cette app. Même le tout premier, après
 * un appairage, passe par ici : la file est vide, le push ne fait rien, et l'ordre
 * reste vrai sans cas particulier.
 *
 * ## Un seul cycle à la fois
 *
 * Quatre déclencheurs peuvent tomber ensemble — l'app revient au premier plan
 * pendant que le réseau revient, et une séance se clôture. Deux cycles concurrents
 * pousseraient la même mutation deux fois et s'écraseraient l'un l'autre au pull.
 * Une demande qui arrive pendant un cycle **ne le double pas** : elle est
 * mémorisée, et le cycle en cours en enchaîne un second à la fin. C'est ce qui
 * garantit qu'une clôture arrivée à la milliseconde près n'est jamais oubliée.
 *
 * ## Il ne bloque jamais l'interface, et ne lève jamais
 *
 * Aucun écran n'attend `syncNow()` : les vues lisent la base locale, qui republie
 * ses lectures vives (`enableChangeListener`, KL-24) quand le pull écrit. Le
 * moteur rend un rapport et publie un état ; il ne lève pas, parce qu'un
 * déclencheur automatique n'a personne pour attraper son erreur. Ce qui a échoué
 * se lit dans `useSyncStatus()`.
 */

export type SyncTrigger =
  /** Au lancement de l'app, une fois la session restaurée. */
  | 'launch'
  /** Retour au premier plan. */
  | 'foreground'
  /** Le réseau est revenu. */
  | 'network'
  /** Une séance vient d'être clôturée (KL-33) : ce qu'on veut voir partir tout de suite. */
  | 'workout-closed'
  /** Premier pull après un appairage (KL-26). */
  | 'first-sync'
  /** Geste explicite depuis les réglages (KL-35). */
  | 'manual';

export type SyncPhase = 'idle' | 'pushing' | 'pulling';

export interface SyncOutcome {
  ok: boolean;
  /** Absent quand la session est fermée ou qu'un cycle tournait déjà. */
  push: PushReport | null;
  pull: PullReport | null;
  error: string | null;
}

export interface SyncStatus {
  phase: SyncPhase;
  /** Ce qui a déclenché le cycle en cours, ou le dernier. */
  trigger: SyncTrigger | null;
  /** Fin du dernier cycle **réussi**, horloge du téléphone. */
  lastSuccessAt: string | null;
  /** Ce qui a échoué en dernier. Effacé par un cycle réussi. */
  lastError: string | null;
  /**
   * `true` quand le dernier échec vient du réseau ou du serveur. C'est ce que le
   * bandeau hors ligne (KL-38) affiche, et ce n'est **pas** une panne : hors
   * réseau est l'état nominal en salle.
   */
  offline: boolean;
}

const INITIAL: SyncStatus = {
  phase: 'idle',
  trigger: null,
  lastSuccessAt: null,
  lastError: null,
  offline: false,
};

/**
 * Deux cycles automatiques ne se suivent pas de plus près que ça. Le réseau d'un
 * téléphone qui sort du sous-sol clignote — connecté, perdu, reconnecté — et
 * chaque bascule est un déclencheur. Sans ce plancher, retrouver du signal
 * lancerait une rafale de bootstraps.
 *
 * Les gestes **voulus** (clôture d'une séance, bouton des réglages, premier pull)
 * ne sont pas concernés : ils viennent de quelqu'un, pas d'un capteur.
 */
const AUTOMATIC_COOLDOWN_MS = 10_000;
const DELIBERATE: SyncTrigger[] = ['workout-closed', 'manual', 'first-sync'];

let status: SyncStatus = INITIAL;
let inflight: Promise<SyncOutcome> | null = null;
let queuedTrigger: SyncTrigger | null = null;
let lastRunAt = 0;

const listeners = new Set<() => void>();

function publish(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStatus(): SyncStatus {
  return status;
}

/** L'état du moteur, pour un écran. Même magasin de module que la session. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSyncStatus, getSyncStatus);
}

/**
 * Un cycle complet : pousser ce qui attend, puis descendre ce qui a changé.
 *
 * Ne lève jamais. Rend `ok: false` quand quelque chose a échoué, et l'appelant est
 * libre de l'ignorer — la plupart le font.
 */
export function syncNow(trigger: SyncTrigger): Promise<SyncOutcome> {
  if (inflight !== null) {
    // Un cycle tourne. On mémorise la demande plutôt que de la doubler : le
    // cycle en cours a peut-être déjà dépassé le point où elle aurait compté.
    // Une demande voulue l'emporte sur une demande automatique déjà mémorisée.
    if (queuedTrigger === null || (!DELIBERATE.includes(queuedTrigger) && isDeliberate(trigger))) {
      queuedTrigger = trigger;
    }

    return inflight;
  }

  if (!isDeliberate(trigger) && Date.now() - lastRunAt < AUTOMATIC_COOLDOWN_MS) {
    return Promise.resolve(skipped());
  }

  inflight = run(trigger).finally(() => {
    inflight = null;

    const next = queuedTrigger;

    queuedTrigger = null;

    if (next !== null) {
      // Pas d'`await` : le cycle qui vient de finir ne doit pas rester en vol le
      // temps du suivant, sinon `inflight` ne se libérerait jamais et une
      // troisième demande s'accrocherait à la première.
      void syncNow(next);
    }
  });

  return inflight;
}

async function run(trigger: SyncTrigger): Promise<SyncOutcome> {
  // Rien à synchroniser sans session : le transport fermerait la session et
  // lèverait un 401 local pour nous l'apprendre (KL-25). Autant ne pas partir.
  if (getSession().status !== 'signedIn') {
    return skipped();
  }

  lastRunAt = Date.now();
  publish({ phase: 'pushing', trigger });

  let push: PushReport | null = null;

  try {
    push = await pushPending();

    // Le jeton ne vaut plus rien : la session est déjà fermée et le garde de
    // navigation a fait son travail. Descendre quoi que ce soit échouerait de la
    // même façon.
    if (push.interruptedBy === 'unauthorized') {
      return fail(push, push.lastError, false);
    }

    publish({ phase: 'pulling' });

    const state = await getSyncState();
    // `since` est l'horloge du **serveur** au dernier pull réussi, pas
    // `lastPulledAt`, qui est celle du téléphone. Deux pendules qui ne sont pas
    // d'accord suffiraient à sauter un exercice modifié entre les deux — et la
    // seule des deux que le serveur sait relire est la sienne (§6.5).
    const payload = await bootstrap(state?.serverTime ?? null);
    const pull = applyBootstrap(payload);

    publish({
      phase: 'idle',
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      offline: false,
    });

    // Le push a pu s'interrompre sur un réseau qui est revenu entre-temps : le
    // pull a réussi, mais la file n'est pas vide. Le cycle n'est pas un échec, il
    // n'est simplement pas complet — le prochain déclencheur reprendra la file.
    return { ok: true, push, pull, error: null };
  } catch (error) {
    return fail(push, describeError(error), isTransient(error));
  }
}

/**
 * Publie l'échec et rend le rapport. `pull` est toujours nul ici : il s'applique
 * en une transaction, il réussit ou il lève, il n'y a pas de moitié à rapporter.
 *
 * `offline` ne dit pas « ça a raté », il dit **« le monde extérieur n'a pas
 * répondu »** : c'est ce qu'un bandeau peut afficher sans mentir. Un `401` (session
 * fermée, on est déjà retourné à l'écran de connexion) et un `400` sur un `since`
 * illisible sont des échecs bien réels, mais l'app n'est pas hors ligne pour
 * autant.
 */
function fail(push: PushReport | null, error: string | null, offline: boolean): SyncOutcome {
  publish({ phase: 'idle', lastError: error, offline });

  return { ok: false, push, pull: null, error };
}

function skipped(): SyncOutcome {
  return { ok: true, push: null, pull: null, error: null };
}

function isDeliberate(trigger: SyncTrigger): boolean {
  return DELIBERATE.includes(trigger);
}
