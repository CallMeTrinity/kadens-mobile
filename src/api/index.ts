/**
 * Point d'entrée du client API (KL-25).
 *
 * Un écran ou un service importe **d'ici** (`@/api`), jamais d'un fichier
 * précis : même règle que `@/db`, `@/theme` et `@/components`.
 *
 * Ce qu'il faut savoir avant d'écrire un appel, et qui ne se devine pas :
 *
 * 1. **Le jeton ne se manipule pas.** Il vit dans `expo-secure-store` et le
 *    transport le pose seul. Aucun écran ne le lit, ne le passe en props, ne le
 *    journalise.
 * 2. **Un `401` purge la session** et fait basculer la navigation vers l'écran
 *    de connexion. Il n'y a donc rien à intercepter dans un écran pour ça — le
 *    garde de `src/app/_layout.tsx` observe `useSession()`.
 * 3. **`GET`, `PUT` et `DELETE` sont rejoués, `POST` ne l'est pas.** Un rejeu se
 *    décide sur la méthode, pas sur le résultat : un `login` rejoué émettrait un
 *    second jeton que personne ne détient.
 * 4. **Un échec se lit par sa classe** (`NetworkError`, `TimeoutError`,
 *    `ApiError`), jamais par son message : le contrat interdit d'analyser
 *    `detail`. `isTransient()` répond à la seule question qui compte, « est-ce
 *    que ça vaut le coup de réessayer ? ».
 * 5. **L'URL du serveur est injectée**, pas lue en base : `setApiBaseUrl()` ne
 *    persiste rien, qui la change écrit aussi `sync_state.apiUrl`.
 */

export { buildUrl, getApiBaseUrl, setApiBaseUrl } from './baseUrl';

export { DEFAULT_TIMEOUT_MS, request } from './client';
export type { ApiResponse, HttpMethod, RequestOptions } from './client';

export {
  AbortError,
  ApiError,
  ConfigurationError,
  describeError,
  isTransient,
  isUnauthorized,
  NetworkError,
  TimeoutError,
} from './errors';

export { deviceName } from './device';

export { InvalidPairingQrError, parsePairingQrPayload } from './pairingQr';
export type { PairingQrPayload } from './pairingQr';

export {
  appVersion,
  bootstrap,
  deleteSchedule,
  exerciseHistory,
  getSchedule,
  login,
  logout,
  me,
  pair,
  ping,
  putSchedule,
} from './endpoints';

export {
  refreshMe,
  signInWithPairingCode,
  signInWithPairingQr,
  signInWithPassword,
  signOut,
} from './auth';

export {
  attachUser,
  completeFirstSync,
  currentToken,
  getSession,
  restoreSession,
  useSession,
} from './session';
export type { SessionState, SessionStatus, SignedOutReason } from './session';

export type {
  ApiUser,
  AppVersionPayload,
  AuthPayload,
  BootstrapPayload,
  BootstrapWindow,
  DevicePayload,
  ExerciseHistoryPayload,
  ExercisePayload,
  HistoryEntryPayload,
  LoggedExerciseInput,
  LoggedExercisePayload,
  LoggedSetInput,
  LoggedSetPayload,
  MePayload,
  PingPayload,
  ProblemDetails,
  ScheduledWorkoutPayload,
  ScheduleUpsertInput,
  ScheduleUpsertResult,
  Violation,
} from './types';
