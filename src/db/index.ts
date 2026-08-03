/**
 * Point d'entrée de la base locale (KL-24).
 *
 * Un écran ou un service importe **d'ici** (`@/db`), jamais d'un fichier précis :
 * même règle que `@/theme` et `@/components`.
 *
 * Trois choses à savoir avant d'écrire une requête, et qui ne se devinent pas :
 *
 * 1. **Le pilote est synchrone.** `await db.select()…` marche (la promesse est
 *    déjà résolue), mais `db.transaction()` valide dès que son rappel
 *    **retourne** : un rappel `async` validerait la transaction avant la première
 *    écriture. Dans une transaction, rappel non-`async` et `.run()` / `.get()` /
 *    `.all()` explicites.
 * 2. **Les identifiants viennent d'ici, pas du serveur.** Une séance datée et une
 *    série réalisée se créent avec `uuidv7()`, hors réseau — c'est ce qui rend le
 *    `PUT` idempotent.
 * 3. **Un instant s'écrit avec `nowIso()`**, jamais avec une chaîne construite à
 *    la main : le serveur jette les décalages non nuls (§KL-19).
 * 4. **Un `DELETE` qui vide une table entière doit porter une clause `WHERE`.**
 *    Sans elle, SQLite applique son optimisation « truncate » et n'appelle pas
 *    `sqlite3_update_hook` : les vues montées sur `useLiveQuery` restent figées
 *    sur l'ancien contenu, sans erreur. Voir `wipe()` dans `seed.ts`.
 */

export {
  DATABASE_NAME,
  db,
  nativeDb,
  type Database,
  type Transaction,
  type Writer,
} from './client';
export { useDatabaseMigrations } from './migrate';
export { clearDatabase, seedDemo } from './seed';
export { getSyncState, patchSyncState, patchSyncStateIn } from './syncState';
export { localDate, nowIso } from './time';
export { isUuidv7, uuidv7 } from './uuid';

export {
  exercise,
  exerciseHistory,
  loggedExercise,
  loggedSet,
  mutationQueue,
  prescribedSnapshot,
  scheduledWorkout,
  SYNC_STATE_ID,
  syncState,
} from './schema';

export type {
  ExerciseHistoryRow,
  ExerciseInsert,
  ExerciseRow,
  LoggedExerciseInsert,
  LoggedExerciseRow,
  LoggedSetInsert,
  LoggedSetRow,
  MutationRow,
  PrescribedSnapshotRow,
  ScheduledWorkoutInsert,
  ScheduledWorkoutRow,
  SyncStateRow,
} from './schema';

export type {
  ActivityType,
  BlockRole,
  MutationPayload,
  MutationType,
  PerformanceBest,
  PerformanceSession,
  PerformanceSetGroup,
  PlanRef,
  PrescribedBlock,
  PrescribedExerciseLine,
  PrescribedSetLine,
  PrescriptionType,
  ScheduledStatus,
  SetType,
  TargetArea,
} from './types';
