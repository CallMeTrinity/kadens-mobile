/**
 * Les trois façons dont un appel d'API peut échouer (KL-25).
 *
 * Trois classes plutôt qu'un code d'erreur, parce que l'appelant n'a jamais
 * qu'une question à trancher : **est-ce que ça vaut le coup de réessayer ?** Le
 * moteur de synchronisation (KL-27) la pose à chaque échec de sa file. Un réseau
 * absent se réessaie, un `422` ne passera jamais avec le même document, un `500`
 * se rejoue tel quel (le contrat garantit que rien n'est écrit à moitié, §4.4).
 *
 * Y répondre en lisant un message serait se rendre dépendant d'un texte que le
 * serveur change sans préavis : `docs/api-mobile.md` dit explicitement de ne
 * jamais analyser `detail`, c'est `status` qui décide du comportement.
 *
 * `Object.setPrototypeOf` dans chaque constructeur n'est pas décoratif : selon la
 * façon dont Babel transpile les classes pour Hermes, une classe qui étend un
 * natif (`Error`) peut perdre sa chaîne de prototypes, et `instanceof` rendrait
 * `false` sur l'erreur qu'on vient de lever. Toute la taxonomie ci-dessous en
 * dépend.
 */

import type { Violation } from './types';

/**
 * Le serveur a répondu, et il a refusé. La réponse suit la RFC 9457
 * (`application/problem+json`) — voir `docs/api-mobile.md §1`.
 */
export class ApiError extends Error {
  readonly status: number;
  /** Libellé HTTP anglais, dérivé du statut côté serveur. */
  readonly title: string;
  /** Message français destiné à être lu. **Ne jamais l'analyser.** */
  readonly detail: string | null;
  /** Champs refusés, sur un `422` seulement. */
  readonly violations: Violation[];
  /** `Retry-After` d'un `429`, en secondes. À respecter (§1). */
  readonly retryAfterSeconds: number | null;
  /** De quoi retrouver l'appel dans un journal, sans le rejouer. */
  readonly method: string;
  readonly path: string;

  constructor(init: {
    status: number;
    title: string;
    detail: string | null;
    violations?: Violation[];
    retryAfterSeconds?: number | null;
    method: string;
    path: string;
  }) {
    super(`${init.method} ${init.path} → ${init.status} ${init.title}`);
    Object.setPrototypeOf(this, ApiError.prototype);

    this.name = 'ApiError';
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.violations = init.violations ?? [];
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.method = init.method;
    this.path = init.path;
  }

  /** Le texte à montrer : celui du serveur s'il y en a un, sinon le statut. */
  get userMessage(): string {
    return this.detail ?? `Le serveur a répondu ${this.status}.`;
  }
}

/**
 * La requête n'est jamais arrivée, ou sa réponse n'est pas revenue : réseau
 * absent, DNS muet, certificat refusé, serveur injoignable.
 *
 * C'est l'état **normal** de l'app en salle, pas une panne : le sous-sol d'une
 * salle de sport est le cas d'usage nominal du chantier. Rien à dire à
 * l'utilisateur au moment où ça arrive, tout est déjà écrit en local.
 */
export class NetworkError extends Error {
  readonly method: string;
  readonly path: string;
  readonly cause: unknown;

  constructor(method: string, path: string, cause: unknown) {
    super(`${method} ${path} → réseau injoignable`);
    Object.setPrototypeOf(this, NetworkError.prototype);

    this.name = 'NetworkError';
    this.method = method;
    this.path = path;
    this.cause = cause;
  }
}

/**
 * Le serveur n'a pas répondu dans le temps imparti.
 *
 * Distinct de `NetworkError` parce que la cause probable n'est pas la même — un
 * portail captif d'hôtel accepte la connexion et ne répond jamais — mais surtout
 * parce qu'il **ne dit rien de ce qui a été écrit côté serveur** : une requête
 * expirée a pu aboutir. C'est ce qui rend le rejeu réservé aux méthodes
 * idempotentes (voir `client.ts`).
 */
export class TimeoutError extends Error {
  readonly method: string;
  readonly path: string;
  readonly timeoutMs: number;

  constructor(method: string, path: string, timeoutMs: number) {
    super(`${method} ${path} → pas de réponse en ${timeoutMs} ms`);
    Object.setPrototypeOf(this, TimeoutError.prototype);

    this.name = 'TimeoutError';
    this.method = method;
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

/** L'appel a été annulé par l'appelant (écran quitté, geste abandonné). */
export class AbortError extends Error {
  constructor(method: string, path: string) {
    super(`${method} ${path} → annulé`);
    Object.setPrototypeOf(this, AbortError.prototype);

    this.name = 'AbortError';
  }
}

/**
 * L'échec est-il passager ? Autrement dit : le **même** appel, rejoué plus tard,
 * a-t-il une chance d'aboutir sans que rien ne change par ailleurs ?
 *
 * C'est la seule question que la file de mutations (KL-27) a besoin de poser
 * pour décider entre « je réessaie » et « je remonte l'échec à l'écran de
 * réglages ». Un `409` ou un `422` sont définitifs : le document est en conflit
 * ou malformé, le rejouer à l'identique redonnera la même réponse.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    return true;
  }

  if (error instanceof ApiError) {
    return error.status === 429 || error.status >= 500;
  }

  return false;
}

/** Le jeton ne vaut plus rien. La session a déjà été purgée par le client. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Le texte à afficher pour un échec, quel qu'il soit.
 *
 * Une seule définition, parce qu'un écran qui rédigerait la sienne finirait par
 * dire « une erreur est survenue » là où le serveur avait quelque chose de
 * précis à dire. Les deux cas locaux (réseau, délai) sont écrits ici : le
 * serveur, par construction, n'a pas pu en parler.
 */
export function describeError(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'Serveur injoignable. Vérifie le réseau, ou l’URL de ce serveur.';
  }

  if (error instanceof TimeoutError) {
    return 'Le serveur n’a pas répondu à temps.';
  }

  if (error instanceof ApiError) {
    return error.userMessage;
  }

  return error instanceof Error ? error.message : 'Échec inattendu.';
}
