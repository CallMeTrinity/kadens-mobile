/**
 * L'état d'authentification, en mémoire (KL-25).
 *
 * ## Pourquoi un magasin maison plutôt qu'un contexte React
 *
 * Le jeton est lu par du code qui n'est pas un composant : le client HTTP, et
 * demain le moteur de synchronisation (KL-27) qui tourne pendant qu'aucun écran
 * n'est monté. Un `useContext` ne se lit pas depuis là. Le magasin vit donc au
 * niveau du module, avec un accesseur synchrone pour le transport
 * (`currentToken()`) et un `useSyncExternalStore` pour les écrans.
 *
 * ## Les trois états, et pourquoi `unknown` en est un
 *
 * Le magasin sécurisé se lit de façon **asynchrone** : au premier rendu, l'app
 * ne sait pas encore si elle a un jeton. Sans un état « je ne sais pas encore »,
 * ce moment se confondrait avec « déconnecté » et le garde de navigation
 * renverrait tout le monde vers l'écran de connexion à chaque lancement, avant
 * de se raviser une frame plus tard.
 *
 * ## Le jeton ne sort pas d'ici
 *
 * `useSession()` rend l'utilisateur et le statut, **jamais le jeton** : un écran
 * n'a aucune raison de le tenir, et ce qu'on ne passe pas en props ne finit pas
 * dans un journal de rendu. Seul `currentToken()`, réservé au transport, le
 * donne.
 */

import { useSyncExternalStore } from 'react';

import { clearToken, readToken, writeToken } from './token';
import type { ApiUser } from './types';

/** Pourquoi la session s'est fermée. Ce que l'écran de connexion a besoin de dire. */
export type SignedOutReason =
  /** Jamais connecté, ou déconnexion volontaire. */
  | 'none'
  /** Un `401` a purgé le jeton : révoqué depuis le web, ou périmé. */
  | 'expired';

export type SessionStatus = 'unknown' | 'signedIn' | 'signedOut';

export interface SessionState {
  status: SessionStatus;
  /**
   * Connu après un `login`, un `pair` ou un `GET /api/me`. Une session restaurée
   * au lancement a donc un jeton sans utilisateur : c'est normal, et c'est à
   * l'app de décider si elle veut le compléter (KL-26).
   */
  user: ApiUser | null;
  reason: SignedOutReason;
}

const INITIAL: SessionState = { status: 'unknown', user: null, reason: 'none' };

let state: SessionState = INITIAL;
let token: string | null = null;

const listeners = new Set<() => void>();

function publish(next: SessionState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** L'instantané de la session. La référence ne change que si l'état change. */
export function getSession(): SessionState {
  return state;
}

/**
 * Le jeton courant, pour le transport et lui seul.
 *
 * Synchrone à dessein : une requête ne doit pas attendre une lecture de
 * trousseau, et `restoreSession()` a déjà eu lieu au démarrage.
 */
export function currentToken(): string | null {
  return token;
}

/**
 * Relit le magasin sécurisé et fixe l'état de départ. À appeler **une fois**, au
 * démarrage, avant tout appel authentifié.
 *
 * Elle ne valide pas le jeton auprès du serveur : ça demanderait du réseau au
 * lancement, alors que l'app est faite pour démarrer hors ligne. Un jeton qui ne
 * vaut plus rien se découvre au premier appel, par un `401` qui purge.
 */
export async function restoreSession(): Promise<SessionState> {
  const stored = await readToken();

  token = stored;
  publish(
    stored === null
      ? { status: 'signedOut', user: null, reason: 'none' }
      : { status: 'signedIn', user: null, reason: 'none' },
  );

  return state;
}

/** Ouvre la session : le jeton part au trousseau, l'état passe à « connecté ». */
export async function openSession(nextToken: string, user: ApiUser): Promise<void> {
  await writeToken(nextToken);

  token = nextToken;
  publish({ status: 'signedIn', user, reason: 'none' });
}

/** Complète la session avec l'utilisateur, sans toucher au jeton (`GET /api/me`). */
export function attachUser(user: ApiUser): void {
  if (state.status === 'signedIn') {
    publish({ ...state, user });
  }
}

/**
 * Ferme la session et efface le jeton.
 *
 * **Idempotente et sans échec possible** : c'est le geste d'un `401`, et un
 * trousseau qui refuse de répondre ne doit pas laisser l'app à moitié
 * déconnectée, avec un jeton mort en mémoire.
 */
export async function closeSession(reason: SignedOutReason = 'none'): Promise<void> {
  token = null;
  publish({ status: 'signedOut', user: null, reason });

  await clearToken();
}

/**
 * L'état de session pour un écran. Ne rend jamais le jeton.
 *
 * `getSession` sert aussi d'instantané côté serveur de rendu : le bundle web ne
 * fait qu'exercer le bundler, mais `useSyncExternalStore` exige le troisième
 * argument dès que `react-dom` est dans la boucle.
 */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSession, getSession);
}
