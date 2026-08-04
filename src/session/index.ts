/**
 * Point d'entrée du métier de séance (KL-28).
 *
 * Un écran importe **d'ici** (`@/session`), jamais d'un fichier précis : même
 * règle que `@/db`, `@/api`, `@/sync`, `@/theme` et `@/components`.
 *
 * ## Pourquoi ce module existe
 *
 * `@/db` sait écrire des lignes, `@/sync` sait échanger avec le serveur. Ni l'un
 * ni l'autre ne sait ce que « démarrer une séance » veut dire — qu'on pose
 * `started_at` mais pas le statut, qu'une séance close ne se reprend pas, qu'une
 * séance libre naît à la date du jour avec un uuid posé localement. Ces règles ne
 * sont ni du stockage ni du transport : elles sont le domaine, et les laisser
 * dans un écran les rendrait invisibles au suivant. C'est ici que KL-29, KL-30 et
 * KL-33 viendront poser cocher une série, dévier et clôturer.
 *
 * ## Ce qu'il faut savoir avant d'appeler quoi que ce soit
 *
 * 1. **Tout est local et synchrone.** Aucune fonction d'ici n'appelle le réseau :
 *    l'app doit ouvrir une séance dans un sous-sol. Le pilote Drizzle
 *    d'`expo-sqlite` étant synchrone, une transaction ne prend jamais de rappel
 *    `async` (voir `@/db`).
 * 2. **Ouvrir une séance n'empile pas de mutation.** Le pull la protège déjà par
 *    « commencée et pas terminée ». Écrire du **réalisé**, en revanche, empile la
 *    sienne dans la même transaction — c'est ce que `log.ts` tient, série par
 *    série, depuis KL-29.
 * 3. **La programmation ne se modifie pas ici.** Ni date, ni titre, ni statut : le
 *    serveur en est l'autorité. Le téléphone possède les bornes et le réalisé.
 * 4. **Une série réalisée s'apparie à sa ligne prescrite par le RANG**, dans deux
 *    files séparées (échauffement, travail). Ce n'est pas un choix d'écran : le
 *    contrat ne transporte aucune référence de la série vers la ligne, et c'est la
 *    règle que `LogComparator` tient déjà côté serveur. Voir `program.ts`.
 */

export { DAY_REACH, dayOffset, dayTitle, dayWindow, longDate, shiftDate, shortDate } from './days';
export type { DayCell } from './days';

export {
  useDayStrip,
  useDayWorkouts,
  useRunningWorkout,
  useSessionProgram,
  useToday,
  useWorkout,
  useWorkoutPendingSync,
} from './hooks';

export { blockRoleLabel, countsAsWorking, setTypeLabel, setTypeLetter } from './labels';

export { checkSet, setCardioDone, uncheckSet } from './log';

export { buildProgram } from './program';
export type {
  SessionBlock,
  SessionExercise,
  SessionExtra,
  SessionGroup,
  SessionProgram,
  SessionSetLine,
  SetValues,
} from './program';

export {
  dayCountsQuery,
  loggedExercisesQuery,
  loggedSetCountsQuery,
  loggedSetsOfWorkoutQuery,
  pendingMutationsQuery,
  prescribedSnapshotQuery,
  runningWorkoutQuery,
  toDayWorkout,
  workoutQuery,
  workoutsOfDayQuery,
  workoutStateLabel,
} from './queries';
export type { DayCount, DayWorkout, LoggedSetCount } from './queries';

export { beginWorkout, createFreeWorkout, defaultFreeTitle } from './start';
