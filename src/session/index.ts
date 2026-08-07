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
 * 5. **Le repos n'est pas du réalisé.** `rest.ts` (KL-31) tient un décompte, une
 *    notification et une vibration, et **rien de tout ça n'entre en base** : le
 *    contrat n'a nulle part où le mettre, et un repos persisté ressurgirait au
 *    lancement suivant. C'est aussi le seul état de ce module qui vit en mémoire
 *    plutôt qu'en SQLite — il doit survivre au démontage de l'écran, pas au
 *    redémarrage de l'app.
 * 6. **On dévie, on ne recompose pas.** `deviations.ts` (KL-30) corrige une
 *    série, en ajoute, en retire, saute, remplace, ajoute un exercice — et rien
 *    d'autre : pas de bloc réordonné, pas de superset créé, pas de tour modifié.
 *    Corollaire : on ne dévie que sur ce qui a **été fait**, le prescrit n'ayant
 *    aucun endroit où accueillir une valeur revue avant la série. Seule
 *    exception, et elle ne va pas en base : la **série en brouillon**
 *    (`withDraftSets`, `program.ts`), qui est une série de plus qu'on annonce
 *    avant de la faire et qui se coche ensuite par la voie normale.
 * 7. **Clôturer est du réalisé, ouvrir ne l'est pas.** `close.ts` (KL-33) pose
 *    `ended_at`, passe la séance en `done` et empile sa mutation dans la même
 *    transaction, là où `beginWorkout` n'empile rien. Et c'est terminal : une
 *    séance close ne se reprend pas (§2.3 point 5), `isOpen` refusant toute
 *    écriture après coup. Le résumé qui l'accompagne (`summary.ts`) est calculé
 *    **en local**, avec la cascade d'axes de `LogComparator` et le périmètre de
 *    `LogMetrics` : il doit donner le même verdict que `/schedule/{id}`, sinon il
 *    vaudrait moins que rien.
 * 8. **L'historique affiché en séance est celui du serveur, pas du téléphone.**
 *    `useSessionHistory` (KL-32) lit `exercise_history`, que le pull réécrit en
 *    entier ; rien n'est recalculé localement à partir du réalisé en cours. Deux
 *    conséquences : la lecture marche hors réseau, et « la dernière fois » ne
 *    devient jamais « à l'instant » — ce qui est en train d'être fait n'y entre
 *    qu'après avoir été poussé puis redescendu.
 * 9. **Une séance vierge se garnit, elle ne se compose pas** (KL-34). Elle naît
 *    sans prescrit (`createFreeWorkout`) et s'emplit par le seul geste qui
 *    existe déjà, `addExercise` — le même que « ajouter un exercice hors
 *    programme ». Il n'y a donc aucun chemin d'écriture propre à la séance
 *    libre : tout ce qu'elle contient est du **réalisé**, exactement comme ce
 *    qu'on ajoute à une séance programmée. C'est ce qui fait qu'elle ne crée
 *    rien en bibliothèque côté serveur — improviser une séance n'est pas écrire
 *    un programme. La bibliothèque, elle, gagne des **facettes** (`library.ts`) :
 *    activité et zone se choisissent, le nom se tape, et les deux ne répondent
 *    pas à la même question.
 * 10. **Un seul endroit décide sous quel nom un exercice s'affiche** :
 *     `naming.ts`. La bibliothèque porte deux libellés (`name`, `nameEn`) et le
 *     compte dit lequel lire ; le nom **vivant** prime toujours sur celui que le
 *     programme ou le réalisé transportent, qui sont français par construction et
 *     ne reprennent la main que si l'exercice a quitté la bibliothèque. Un
 *     composant qui écrit `row.name` court-circuite la préférence — même règle
 *     qu'`exercise_name()` côté web. Corollaire d'écriture : ce qui se **fige**
 *     (le snapshot d'un réalisé) prend le nom canonique, jamais le libellé
 *     affiché.
 */

export { buildBodyLoad, EMPTY_BODY_LOAD } from './areas';
export type { AreaLoad, BodyLoad, ExerciseAreaBook } from './areas';

export { DAY_REACH, dayOffset, dayTitle, dayWindow, longDate, shiftDate, shortDate } from './days';
export type { DayCell } from './days';

export { closeWorkout } from './close';

export {
  useDayStrip,
  useDayWorkouts,
  useElapsedSeconds,
  useExerciseAreas,
  useExerciseLanguage,
  useExerciseLibrary,
  useExerciseNames,
  usePastWorkouts,
  usePreferences,
  useRunningWorkout,
  useSessionHistory,
  useSessionProgram,
  useToday,
  useWorkout,
  useWorkoutPendingSync,
} from './hooks';
export type { ExerciseLibraryView } from './hooks';

export {
  addExercise,
  boundSetValues,
  canReplaceExercise,
  deleteSet,
  removeExercise,
  replaceExercise,
  setExerciseState,
  updateSet,
} from './deviations';
export type { ExerciseRef, ExerciseState, LoggedSetValues } from './deviations';

export {
  activityLabel,
  blockRoleLabel,
  countsAsWorking,
  setTypeLabel,
  setTypeLetter,
  targetAreaLabel,
} from './labels';

export {
  filterLibrary,
  fold,
  libraryActivities,
  libraryAreas,
  searchExercises,
  SEARCH_LIMIT,
  toOptions,
} from './library';
export type { ExerciseOption, ExerciseRowForOption } from './library';

export {
  alternateName,
  EMPTY_NAME_BOOK,
  exerciseLabel,
  exerciseNameBook,
  exerciseSearchText,
  referenceLabel,
} from './naming';
export type { ExerciseNameBook, ExerciseNames } from './naming';

export { checkSet, setCardioDone, uncheckSet } from './log';

export {
  allExercises,
  buildProgram,
  draftSetValues,
  exerciseIdOf,
  exerciseIdsOf,
  findExercise,
  findSetLine,
  nextTarget,
  referencedExerciseIds,
  setDeviates,
  withDraftSets,
} from './program';
export type {
  SessionBlock,
  SessionExercise,
  SessionGroup,
  SessionProgram,
  SessionSetLine,
  SessionTarget,
  SetValues,
} from './program';

export {
  adjustRest,
  getRest,
  initRestNotifications,
  REST_STEP,
  startRest,
  startRestAfterSet,
  stopRest,
  useRestTimer,
} from './rest';
export type { RestState } from './rest';

export { buildSessionSummary, elapsedSeconds, exerciseOutcome, isMeasured } from './summary';
export type {
  DeviationAxis,
  DeviationState,
  ExerciseOutcome,
  SessionBounds,
  SessionSummary,
} from './summary';

export { useKeepScreenAwake } from './wake';

export {
  dayCountsQuery,
  exerciseAreasQuery,
  exerciseHistoryQuery,
  exerciseLanguageQuery,
  exerciseLibraryQuery,
  exerciseNamesQuery,
  isClosed,
  isRunning,
  loggedExercisesQuery,
  loggedSetCountsAllQuery,
  loggedSetCountsQuery,
  loggedSetsOfWorkoutQuery,
  pastWorkoutsQuery,
  pendingMutationsQuery,
  preferencesQuery,
  prescribedSnapshotQuery,
  runningWorkoutQuery,
  toDayWorkout,
  workoutQuery,
  workoutsOfDayQuery,
  workoutStateLabel,
} from './queries';
export type { DayCount, DayWorkout, LoggedSetCount } from './queries';

export { beginWorkout, createFreeWorkout, defaultFreeTitle } from './start';
