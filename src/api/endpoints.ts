/**
 * Les dix endpoints de l'API, un par fonction typée (KL-25).
 *
 * C'est la transcription de `docs/api-mobile.md §6` et rien de plus : pas de
 * cache, pas d'écriture en base, aucune décision métier. Ce qui relève de la
 * session (poser le jeton, le purger) vit dans `auth.ts`, ce qui relève de la
 * synchronisation vivra dans le moteur (KL-27). Un endpoint qui se mettrait à
 * écrire en base deviendrait impossible à appeler depuis un écran sans effet de
 * bord.
 *
 * Les particularités ci-dessous ne sont pas des libertés prises avec le
 * contrat : elles sont **écrites dedans**, et les oublier coûterait cher.
 */

import { request, type ApiResponse } from './client';
import { ApiError } from './errors';
import type {
  AuthPayload,
  BootstrapPayload,
  ExerciseHistoryPayload,
  MePayload,
  PingPayload,
  ScheduledWorkoutPayload,
  ScheduleUpsertInput,
  ScheduleUpsertResult,
} from './types';

/**
 * Le bootstrap est le seul appel dont la réponse se compte en dizaines de
 * kilo-octets (74,6 ko mesurés pour 241 exercices, borne serveur à 1 Mo). Quinze
 * secondes suffisent au reste, pas forcément à lui sur un réseau lent.
 */
const BOOTSTRAP_TIMEOUT_MS = 45_000;

/** Sonde authentifiée, muette sur l'identité. Valide une URL de serveur et un jeton. */
export function ping(signal?: AbortSignal): Promise<PingPayload> {
  return request<PingPayload>({ path: '/api/ping', signal }).then((r) => r.data);
}

/** Le compte **et** l'appareil courant. */
export function me(signal?: AbortSignal): Promise<MePayload> {
  return request<MePayload>({ path: '/api/me', signal }).then((r) => r.data);
}

/**
 * Connexion par mot de passe — le **repli**, quand la caméra refuse.
 *
 * `auth: false` n'est pas une optimisation : l'authenticator serveur se déclenche
 * sur la seule présence d'un `Bearer`, quelle que soit la route. Un jeton périmé
 * envoyé ici ferait échouer la requête **avant** le contrôleur, et la reconnexion
 * deviendrait impossible.
 */
export function login(
  credentials: { email: string; password: string; deviceName: string },
  signal?: AbortSignal,
): Promise<AuthPayload> {
  return request<AuthPayload>({
    method: 'POST',
    path: '/api/auth/login',
    body: credentials,
    auth: false,
    signal,
  }).then((r) => r.data);
}

/**
 * Échange d'un code de QR contre un jeton. Même règle d'en-tête que `login`.
 *
 * Le compte vient du **code**, jamais de la requête : le jeton émis est celui de
 * l'utilisateur qui a affiché le QR.
 */
export function pair(
  input: { code: string; deviceName: string },
  signal?: AbortSignal,
): Promise<AuthPayload> {
  return request<AuthPayload>({
    method: 'POST',
    path: '/api/auth/pair',
    body: input,
    auth: false,
    signal,
  }).then((r) => r.data);
}

/**
 * Révoque **le jeton présenté**, et lui seul. Les autres appareils du compte
 * restent connectés — « tout révoquer » est un geste de `/profile/settings`.
 */
export async function logout(signal?: AbortSignal): Promise<void> {
  await request<void>({ method: 'POST', path: '/api/auth/logout', signal });
}

/**
 * Tout ce qu'il faut pour travailler hors réseau, en une requête.
 *
 * `since` **n'allège que la bibliothèque** : la fenêtre de séances datées et
 * l'historique partent toujours en entier, et c'est structurel — la fraîcheur
 * d'une séance datée n'est portée par aucune colonne côté serveur. Passer la
 * valeur de `serverTime` du dernier appel réussi, jamais l'heure du téléphone.
 */
export function bootstrap(since?: string | null, signal?: AbortSignal): Promise<BootstrapPayload> {
  return request<BootstrapPayload>({
    path: '/api/bootstrap',
    query: { since },
    timeoutMs: BOOTSTRAP_TIMEOUT_MS,
    signal,
  }).then((r) => r.data);
}

/**
 * La trajectoire d'un exercice : dix séances au plus, la plus récente d'abord.
 *
 * **Le seul appel de l'app qui suppose du réseau**, et c'est assumé : le
 * bootstrap descend déjà le dernier point et le record de toute la bibliothèque,
 * ce qui couvre ce qui s'affiche en séance.
 */
export function exerciseHistory(
  exerciseId: number,
  signal?: AbortSignal,
): Promise<ExerciseHistoryPayload> {
  return request<ExerciseHistoryPayload>({
    path: `/api/exercises/${exerciseId}/history`,
    signal,
  }).then((r) => r.data);
}

/** Une séance datée seule, dans la même structure que celles du bootstrap. */
export function getSchedule(uuid: string, signal?: AbortSignal): Promise<ScheduledWorkoutPayload> {
  return request<ScheduledWorkoutPayload>({ path: `/api/schedule/${uuid}`, signal }).then(
    (r) => r.data,
  );
}

/**
 * L'upsert du réalisé. **Toujours le document complet**, jamais une série à la
 * fois : après l'appel, le réalisé de la séance *est* ce document.
 *
 * `created` distingue le `201` du `200`. La file de mutations (KL-27) s'en sert
 * pour savoir ce qui était déjà passé avant une coupure.
 */
export async function putSchedule(
  uuid: string,
  document: ScheduleUpsertInput,
  signal?: AbortSignal,
): Promise<ScheduleUpsertResult> {
  const response: ApiResponse<ScheduledWorkoutPayload> = await request({
    method: 'PUT',
    path: `/api/schedule/${uuid}`,
    body: document,
    signal,
  });

  return { created: response.status === 201, workout: response.data };
}

/**
 * Supprime une **séance libre**, et rien d'autre.
 *
 * Le `404` est traité comme un succès, et c'est le contrat qui le dit : « uuid
 * inconnu — ou déjà supprimé, ce qui rend le `DELETE` sûr à rejouer une fois
 * qu'on traite le 404 comme un succès ». Sans ça, une mutation dont la réponse
 * s'est perdue resterait bloquée en tête de file pour toujours.
 *
 * Le `409` (séance venue de la bibliothèque ou d'un plan), lui, remonte : ce
 * n'est pas un droit qui manque, c'est un geste qui ne se fait pas ici.
 */
export async function deleteSchedule(uuid: string, signal?: AbortSignal): Promise<void> {
  try {
    await request<void>({ method: 'DELETE', path: `/api/schedule/${uuid}`, signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return;
    }

    throw error;
  }
}
