/**
 * Le transport : une requête, un timeout, un rejeu, un `401` (KL-25).
 *
 * Tout appel d'API passe par `request()`. Ce qui s'y décide une fois pour
 * toutes, et qu'aucun endpoint n'a donc à refaire :
 *
 * ## Le timeout, parce qu'une requête sans échéance ne revient jamais
 *
 * `fetch` n'en a pas. Sur un réseau de salle de sport — capté à moitié, portail
 * captif qui accepte la connexion et ne répond rien — une promesse en attente
 * fige un écran de chargement pour toujours. Chaque appel a donc une échéance,
 * et un `AbortController` derrière.
 *
 * ## Le rejeu, et la raison pour laquelle il ne s'applique pas à tout
 *
 * Un rejeu ne se décide pas sur le résultat, il se décide sur la **méthode**.
 * `GET`, `PUT` et `DELETE` sont idempotents par construction dans cette API
 * (§4.2 du contrat) : les rejouer ne peut rien créer en double. `POST` ne l'est
 * pas — un `POST /api/auth/login` dont la réponse s'est perdue a peut-être
 * abouti, et le rejouer émettrait un **second jeton** que personne ne détient,
 * visible comme un appareil fantôme dans `/profile/settings`. Les `POST` ne sont
 * donc jamais rejoués automatiquement.
 *
 * Le délai croît en puissances de deux, avec une gigue : deux téléphones qui
 * reprennent le réseau en même temps ne doivent pas retomber sur le serveur
 * exactement ensemble.
 *
 * **Un `429` n'est pas rejoué**, alors qu'il est passager. Le serveur dit
 * combien de temps attendre (`Retry-After`, jusqu'à ~60 s sur la connexion) :
 * dormir une minute à l'intérieur d'un appel, c'est une interface figée sans
 * rien à montrer, et c'est aussi ce qui fait tourner le compteur du limiteur.
 * L'échéance remonte à l'appelant, qui sait, lui, s'il peut revenir plus tard.
 *
 * ## Le `401`
 *
 * Il purge le jeton et ferme la session, ce qui suffit à faire basculer la
 * navigation vers l'écran de connexion (le garde de `src/app/_layout.tsx`
 * observe la session). Seuls les appels **authentifiés** déclenchent ça : un
 * mot de passe faux sur `POST /api/auth/login` rend lui aussi un `401`, et il
 * n'y a pas de session à fermer — le contrat interdit d'ailleurs d'envoyer un
 * en-tête `Authorization` sur cette route.
 */

import { buildUrl, getApiBaseUrl } from './baseUrl';
import { AbortError, ApiError, NetworkError, TimeoutError } from './errors';
import { closeSession, currentToken } from './session';
import type { ProblemDetails } from './types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** Chemin absolu commençant par `/`, sans l'URL de base. */
  path: string;
  query?: Record<string, string | number | null | undefined>;
  /** Sérialisé en JSON. `undefined` = pas de corps. */
  body?: unknown;
  /** Envoyer le jeton. `false` sur `login` et `pair`, où le contrat l'interdit. */
  auth?: boolean;
  timeoutMs?: number;
  /** Nombre total de tentatives. Défaut : 3 sur une méthode idempotente, 1 sinon. */
  attempts?: number;
  /** Annulation par l'appelant (écran quitté). Distincte du timeout. */
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

/**
 * Quinze secondes. Assez pour un réseau mobile poussif, assez court pour qu'un
 * écran bloqué finisse par dire quelque chose. Le bootstrap, seul appel dont la
 * réponse se compte en dizaines de kilo-octets, prend le sien.
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 8_000;
const IDEMPOTENT: HttpMethod[] = ['GET', 'PUT', 'DELETE'];

/** Le délai avant la n-ième reprise : 500, 1000, 2000 ms… ±25 %. */
function backoffMs(attempt: number): number {
  const growth = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
  const jitter = 0.75 + Math.random() * 0.5;

  return Math.round(growth * jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `Retry-After` en secondes. L'en-tête accepte aussi une date HTTP : on la
 * convertit, sans jamais rendre de valeur négative — une horloge de téléphone en
 * retard produirait sinon une attente nulle et un second `429` immédiat.
 */
function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get('Retry-After');

  if (raw === null) {
    return null;
  }

  const seconds = Number(raw);

  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds));
  }

  const date = Date.parse(raw);

  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - Date.now()) / 1000));
}

/** Un corps illisible ne doit pas masquer le statut, qui est l'information utile. */
function parseJson(text: string): unknown {
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toApiError(
  method: HttpMethod,
  path: string,
  status: number,
  body: unknown,
  after: number | null,
): ApiError {
  const problem = (body ?? {}) as ProblemDetails;

  return new ApiError({
    status,
    title: problem.title ?? 'Error',
    detail: problem.detail ?? null,
    violations: problem.violations,
    retryAfterSeconds: after,
    method,
    path,
  });
}

/** Une tentative, sans rejeu : l'aller-retour réseau et la lecture du corps. */
async function attemptOnce<T>(
  method: HttpMethod,
  path: string,
  url: string,
  body: unknown,
  token: string | null,
  timeoutMs: number,
  external: AbortSignal | undefined,
): Promise<ApiResponse<T>> {
  if (external?.aborted) {
    throw new AbortError(method, path);
  }

  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const relay = () => controller.abort();
  external?.addEventListener('abort', relay);

  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  let text: string;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    // Le corps se lit dans le même `try` : une connexion coupée en cours de
    // lecture est un incident réseau, pas une réponse.
    text = response.status === 204 ? '' : await response.text();
  } catch (cause) {
    if (timedOut) {
      throw new TimeoutError(method, path, timeoutMs);
    }

    if (external?.aborted) {
      throw new AbortError(method, path);
    }

    throw new NetworkError(method, path, cause);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', relay);
  }

  const parsed = parseJson(text);

  if (!response.ok) {
    throw toApiError(method, path, response.status, parsed, retryAfterSeconds(response));
  }

  // Un `204` (logout, delete) n'a pas de corps : `null` est la bonne valeur, et
  // les endpoints concernés sont typés `void`.
  return { status: response.status, data: parsed as T };
}

/**
 * Un appel d'API, du choix de l'URL à la purge du jeton sur un `401`.
 *
 * Rend le **statut** en plus du corps : `PUT /api/schedule/{uuid}` distingue la
 * création (`201`) de la mise à jour (`200`), et cette différence dit à la file
 * de mutations ce qui était déjà passé.
 */
export async function request<T>(options: RequestOptions): Promise<ApiResponse<T>> {
  const method = options.method ?? 'GET';
  const { path, body, query, signal } = options;
  const authenticated = options.auth !== false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = options.attempts ?? (IDEMPOTENT.includes(method) ? 3 : 1);

  if (getApiBaseUrl() === null) {
    throw new Error(
      "Aucune URL de serveur : appaire l'app par le QR, ou pose EXPO_PUBLIC_API_URL en développement.",
    );
  }

  const token = authenticated ? currentToken() : null;

  // Un appel authentifié sans jeton n'a aucune chance : plutôt que de le laisser
  // partir nu et revenir en 401, on ferme la session tout de suite. Le garde de
  // navigation fait le reste.
  if (authenticated && token === null) {
    await closeSession('expired');

    throw new ApiError({
      status: 401,
      title: 'Unauthorized',
      detail: 'Aucun jeton : cet appareil doit être appairé.',
      method,
      path,
    });
  }

  const url = buildUrl(path, query);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await attemptOnce<T>(method, path, url, body, token, timeoutMs, signal);
    } catch (error) {
      lastError = error;

      // Le jeton ne vaut plus rien : révoqué depuis `/profile/settings`, ou
      // périmé après 90 jours sans usage. On purge, et l'app repart de l'écran
      // de connexion. Rejouer n'aurait aucun sens.
      if (authenticated && error instanceof ApiError && error.status === 401) {
        await closeSession('expired');

        throw error;
      }

      const worthRetrying =
        error instanceof NetworkError ||
        error instanceof TimeoutError ||
        (error instanceof ApiError && error.status >= 500);

      if (!worthRetrying || attempt === attempts) {
        throw error;
      }

      await sleep(backoffMs(attempt));
    }
  }

  // Inatteignable : la boucle rend ou lève à chaque tour. La branche existe pour
  // que le type de retour tienne sans `!` ni assertion.
  throw lastError;
}
