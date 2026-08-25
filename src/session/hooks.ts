/**
 * Les lectures vives de l'écran « Aujourd'hui » (KL-28).
 *
 * Elles montent les requêtes de `queries.ts` sur `useLiveQuery`, qui rejoue la
 * requête à chaque écriture de sa table. C'est ce qui fait qu'un pull qui arrive
 * en tâche de fond, ou une série cochée dans un autre écran, se voient ici sans
 * qu'aucun code n'ait à prévenir personne.
 *
 * **`useLiveQuery` n'écoute que la table du `from`** (vérifié dans son
 * implémentation), pas les tables jointes, et il ne relance la requête que si le
 * tableau de dépendances change. Les deux contraintes sont tenues dans
 * `queries.ts`, où le `from` de chaque requête est choisi pour ça.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  DEFAULT_LANGUAGE,
  DEFAULT_PREFERENCES,
  localDate,
  type ActivityType,
  type ExerciseHistoryRow,
  type ExerciseLanguage,
  type PreferenceRow,
  type ScheduledWorkoutRow,
  type TargetArea,
} from '@/db';

import { type ExerciseAreaBook } from './areas';
import { dayWindow, type DayCell } from './days';
import {
  filterLibrary,
  libraryActivities,
  libraryAreas,
  searchExercises,
  toOptions,
  type ExerciseOption,
} from './library';
import { exerciseNameBook, type ExerciseNameBook } from './naming';
import {
  buildProgram,
  exerciseIdsOf,
  referencedExerciseIds,
  withExecutionOrder,
  type ExecutionOrder,
  type SessionProgram,
} from './program';
import { elapsedSeconds } from './summary';
import {
  dayCountsQuery,
  exerciseAreasQuery,
  exerciseHistoryQuery,
  exerciseLanguageQuery,
  exerciseLibraryQuery,
  exerciseNamesQuery,
  loggedExercisesQuery,
  loggedSetCountsAllQuery,
  loggedSetCountsQuery,
  loggedSetsOfWorkoutQuery,
  pastWorkoutsQuery,
  pendingMutationsQuery,
  preferencesQuery,
  prescribedSnapshotQuery,
  runningWorkoutQuery,
  sessionLayoutQuery,
  toDayWorkout,
  workoutQuery,
  workoutsOfDayQuery,
  type DayWorkout,
} from './queries';

/**
 * La date du jour, telle que le **téléphone** l'affiche, tenue à jour.
 *
 * Une app React Native ne redémarre pas à minuit : laissée en arrière-plan, elle
 * rouvre le lendemain avec la valeur calculée la veille, et « Aujourd'hui »
 * afficherait hier. Le retour au premier plan est le moment exact où l'écart peut
 * s'être creusé, c'est donc là qu'on relit.
 *
 * `localDate()` et non une date UTC : la journée d'entraînement est celle du
 * fuseau de celui qui s'entraîne (`db/time.ts`).
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDate());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        // `setState` avec la même valeur ne re-rend pas : le cas courant (revenir
        // dans la même journée) ne coûte rien.
        setToday(localDate());
      }
    });

    return () => subscription.remove();
  }, []);

  return today;
}

/** Les séances d'un jour, avec leur réalisé résumé et leur état de synchronisation. */
export function useDayWorkouts(date: string): DayWorkout[] {
  const { data: rows } = useLiveQuery(workoutsOfDayQuery(date), [date]);
  const { data: counts } = useLiveQuery(loggedSetCountsQuery(date), [date]);
  const pending = usePendingUuids();

  return useMemo(() => {
    const sets = new Map(counts.map((row) => [row.uuid, row.sets]));

    return rows.map((row) => toDayWorkout(row, sets.get(row.uuid) ?? 0, pending.has(row.uuid)));
  }, [rows, counts, pending]);
}

/**
 * Les séances derrière soi, la plus récente d'abord (KL-37).
 *
 * Même assemblage que `useDayWorkouts` — c'est le même objet à l'écran, avec le
 * même état de synchronisation — sur une autre question : ce qui a été fait
 * plutôt que ce qui est prévu ce jour-là. Voir `pastWorkoutsQuery` pour ce que
 * « derrière soi » veut dire exactement, et pour la portée réelle de la liste.
 */
export function usePastWorkouts(): DayWorkout[] {
  const { data: rows } = useLiveQuery(pastWorkoutsQuery());
  const { data: counts } = useLiveQuery(loggedSetCountsAllQuery());
  const pending = usePendingUuids();

  return useMemo(() => {
    const sets = new Map(counts.map((row) => [row.uuid, row.sets]));

    return rows.map((row) => toDayWorkout(row, sets.get(row.uuid) ?? 0, pending.has(row.uuid)));
  }, [rows, counts, pending]);
}

/**
 * La séance en cours, s'il y en a une — tous jours confondus.
 *
 * C'est elle qui répond à « reprise d'une séance en cours si l'app a été
 * fermée » : rien n'est stocké côté navigation, l'état vit en base, donc une app
 * tuée puis relancée retrouve exactement la même chose.
 */
export function useRunningWorkout(): ScheduledWorkoutRow | null {
  const { data } = useLiveQuery(runningWorkoutQuery());

  return data[0] ?? null;
}

/**
 * Une séance datée, par son uuid.
 *
 * `undefined` tant que la première lecture n'a pas répondu, `null` si l'uuid ne
 * correspond à rien. Les deux se distinguent : une séance purgée par un pull
 * pendant qu'on la regarde n'est pas la même chose qu'un écran qui charge.
 */
export function useWorkout(uuid: string): ScheduledWorkoutRow | null | undefined {
  const { data, updatedAt } = useLiveQuery(workoutQuery(uuid), [uuid]);

  return updatedAt === undefined ? undefined : (data[0] ?? null);
}

/**
 * La langue d'affichage des noms d'exercices, telle que le compte la règle.
 *
 * `fr` tant qu'aucun bootstrap n'a abouti — la langue d'origine de la
 * bibliothèque, jamais un trou. C'est le seul défaut de tout ce fichier qui ne
 * vient pas d'une table locale : la valeur appartient au serveur, l'app ne la
 * choisit pas.
 */
export function useExerciseLanguage(): ExerciseLanguage {
  const { data } = useLiveQuery(exerciseLanguageQuery());

  return data[0]?.language ?? DEFAULT_LANGUAGE;
}

/**
 * L'annuaire des libellés des exercices donnés, dans la langue du compte
 * (`naming.ts`).
 *
 * Même patron que `useSessionHistory` : la clé de dépendance est la liste
 * d'identifiants **triée**, donc la requête ne se remonte que quand l'ensemble
 * change, pas à chaque série cochée. La langue, elle, y entre aussi : c'est ce
 * qui fait qu'une bascule faite sur le web repeint la séance ouverte au pull
 * suivant, sans la rouvrir.
 */
export function useExerciseNames(exerciseIds: number[]): ExerciseNameBook {
  const key = exerciseIds.join(',');
  const language = useExerciseLanguage();
  const { data } = useLiveQuery(exerciseNamesQuery(exerciseIds), [key]);

  return useMemo(() => exerciseNameBook(data, language), [data, language]);
}

/**
 * Le déroulé d'une séance : son programme et son réalisé, croisés (KL-29).
 *
 * **Trois lectures vives et non une**, parce que `useLiveQuery` n'écoute que la
 * table du `from` : le programme change quand un pull le corrige, les exercices
 * réalisés quand on coche la première série de l'un d'eux, les séries à chaque
 * coche. Une requête jointe unique n'aurait été republiée que par sa table de
 * tête, et le déroulé serait resté figé sur les deux autres.
 *
 * S'y ajoute l'annuaire des libellés, quatrième lecture pour la même raison : les
 * noms vivent dans `exercise`, que le prescrit ne fait que **référencer**. C'est
 * lui qui décide sous quelle langue la séance s'écrit, et il prime sur les noms
 * transportés par le programme, français par construction.
 *
 * Cinquième lecture depuis KL-52 : l'**ordre d'exécution local**, qui n'est ni
 * du prescrit ni du réalisé et vit donc dans sa propre table. Il est appliqué
 * ici, en dernier, plutôt que dans l'écran : le déroulé rendu doit être le même
 * partout — la barre basse le lit pour proposer sa cible, la clôture le lit pour
 * résumer — et un ordre appliqué à l'affichage seul laisserait les deux en
 * désaccord.
 *
 * Le croisement est mémoïsé : il est pur (`buildProgram`), et le refaire à chaque
 * rendu de l'écran ferait retomber tout le déroulé sur des objets neufs.
 */
export function useSessionProgram(uuid: string): SessionProgram {
  const { data: snapshot } = useLiveQuery(prescribedSnapshotQuery(uuid), [uuid]);
  const { data: exercises } = useLiveQuery(loggedExercisesQuery(uuid), [uuid]);
  const { data: sets } = useLiveQuery(loggedSetsOfWorkoutQuery(uuid), [uuid]);
  const order = useExecutionOrder(uuid);

  const blocks = useMemo(() => snapshot[0]?.blocks ?? [], [snapshot]);
  const ids = useMemo(() => referencedExerciseIds(blocks, exercises), [blocks, exercises]);
  const names = useExerciseNames(ids);

  return useMemo(
    () => withExecutionOrder(buildProgram(blocks, exercises, sets, names), order),
    [blocks, exercises, sets, names, order],
  );
}

/**
 * L'ordre d'exécution local d'une séance, indexé par clé d'exercice (KL-52).
 *
 * Vide tant que rien n'a été déplacé, et c'est l'état nominal : `withExecutionOrder`
 * rend alors le déroulé tel quel, sans copier quoi que ce soit.
 */
function useExecutionOrder(uuid: string): ExecutionOrder {
  const { data } = useLiveQuery(sessionLayoutQuery(uuid), [uuid]);

  return useMemo(
    () =>
      new Map(
        data.map((row) => [
          row.exerciseKey,
          { position: row.position, chain: row.chain, lane: row.lane },
        ]),
      ),
    [data],
  );
}

/**
 * La dernière performance et le record des exercices du déroulé (KL-32).
 *
 * Indexés par **identifiant d'exercice**, pas par clé de déroulé : deux lignes du
 * programme peuvent travailler le même exercice, elles lisent alors le même
 * point, et l'index par exercice est aussi celui de la table.
 *
 * La requête ne se remonte que quand l'ensemble des exercices change — pas à
 * chaque série cochée, alors que le déroulé, lui, est reconstruit à chaque
 * écriture. C'est ce que la clé de dépendance garantit : `exerciseIdsOf` rend une
 * liste triée et dédupliquée, donc une chaîne stable tant qu'on travaille les
 * mêmes exercices.
 */
export function useSessionHistory(program: SessionProgram): Map<number, ExerciseHistoryRow> {
  const ids = useMemo(() => exerciseIdsOf(program), [program]);
  const key = ids.join(',');
  const { data } = useLiveQuery(exerciseHistoryQuery(ids), [key]);

  return useMemo(() => new Map(data.map((row) => [row.exerciseId, row])), [data]);
}

/**
 * Les zones travaillées par les exercices du déroulé, pour la carte musculaire de
 * la clôture (`areas.ts`).
 *
 * Même patron que `useSessionHistory` juste au-dessus, et pour la même raison :
 * la clé de dépendance est la liste triée des exercices, donc la lecture ne se
 * remonte pas à chaque série cochée — alors que la carte, elle, se recalcule
 * bien à chaque coche, puisque le déroulé change.
 */
export function useExerciseAreas(program: SessionProgram): ExerciseAreaBook {
  const ids = useMemo(() => exerciseIdsOf(program), [program]);
  const key = ids.join(',');
  const { data } = useLiveQuery(exerciseAreasQuery(ids), [key]);

  return useMemo(() => new Map(data.map((row) => [row.id, row.targetAreas])), [data]);
}

/** Ce que le sélecteur d'exercice affiche : sa liste, et les facettes qui la cadrent. */
export interface ExerciseLibraryView {
  results: ExerciseOption[];
  /** Les activités présentes dans la bibliothèque entière. */
  activities: ActivityType[];
  /** Les zones présentes **dans l'activité retenue** — voir plus bas. */
  areas: TargetArea[];
}

/**
 * La bibliothèque locale, filtrée par ce qui est tapé et par les facettes
 * (KL-30, facettes en KL-34).
 *
 * Le hook n'est monté que quand le sélecteur d'exercice est ouvert : la requête
 * remonte toute la table, ce qui est bon marché mais inutile le reste du temps.
 * Le filtrage est pur et mémoïsé (`library.ts`) — il se rejoue à la frappe, pas à
 * chaque rendu de l'écran de séance.
 *
 * **Les deux facettes ne se cadrent pas sur la même liste, et c'est le point.**
 * Les activités viennent de la bibliothèque entière : elles sont le premier
 * choix, les restreindre n'aurait aucun sens. Les zones viennent de la
 * bibliothèque **réduite à l'activité retenue** — choisir « Course à pied » doit
 * faire disparaître « Pectoraux » — mais **pas** de la zone déjà choisie, sinon
 * sa propre rangée se réduirait à elle-même et il n'y aurait plus de quoi en
 * changer sans tout désélectionner.
 *
 * Deux primitives nullables plutôt qu'un objet de filtres : un objet reconstruit
 * à chaque rendu par l'appelant relancerait les mémos à chaque frappe, et il n'y
 * a aucun moyen de le lui interdire depuis ici.
 */
export function useExerciseLibrary(
  term: string,
  activity: ActivityType | null = null,
  area: TargetArea | null = null,
): ExerciseLibraryView {
  const { data } = useLiveQuery(exerciseLibraryQuery());
  const language = useExerciseLanguage();

  // Les libellés se résolvent **une fois**, à la lecture, jamais à la frappe :
  // `toOptions` fait la langue, le texte cherché et le classement d'un coup, et
  // tout ce qui suit travaille sur des chaînes déjà repliées.
  const library = useMemo(() => toOptions(data, language), [data, language]);

  const activities = useMemo(() => libraryActivities(library), [library]);
  const inActivity = useMemo(() => filterLibrary(library, activity, null), [library, activity]);
  const areas = useMemo(() => libraryAreas(inActivity), [inActivity]);
  const scoped = useMemo(() => filterLibrary(inActivity, null, area), [inActivity, area]);
  const results = useMemo(() => searchExercises(scoped, term), [scoped, term]);

  return useMemo(() => ({ results, activities, areas }), [results, activities, areas]);
}

/**
 * Les réglages de l'appareil, en lecture vive (KL-31).
 *
 * Ils sortent toujours complets : la table n'a pas de ligne tant que rien n'a été
 * réglé, et rendre `null` obligerait chaque appelant à connaître les valeurs par
 * défaut — donc à les recopier, donc à diverger le jour où l'une change.
 */
export function usePreferences(): Omit<PreferenceRow, 'id'> {
  const { data } = useLiveQuery(preferencesQuery());
  const row = data[0];

  return useMemo(
    () =>
      row
        ? {
            restSeconds: row.restSeconds,
            vibrate: row.vibrate,
            autoRest: row.autoRest,
            silhouette: row.silhouette,
          }
        : DEFAULT_PREFERENCES,
    [row],
  );
}

/** La bande de jours, chacun sachant s'il porte des séances. */
export function useDayStrip(today: string): (DayCell & { total: number })[] {
  const cells = useMemo(() => dayWindow(today), [today]);
  const from = cells[0].date;
  const to = cells[cells.length - 1].date;
  const { data: counts } = useLiveQuery(dayCountsQuery(from, to), [from, to]);

  return useMemo(() => {
    const totals = new Map(counts.map((row) => [row.date, row.total]));

    return cells.map((cell) => ({ ...cell, total: totals.get(cell.date) ?? 0 }));
  }, [cells, counts]);
}

/**
 * Cette séance attend-elle d'être poussée ?
 *
 * C'est ce qui rend visible « rien n'est perdu » : la marque apparaît à la
 * première série cochée hors réseau et disparaît d'elle-même quand le push
 * aboutit, sans qu'aucun écran n'ait à le demander.
 */
export function useWorkoutPendingSync(uuid: string): boolean {
  return usePendingUuids().has(uuid);
}

/**
 * Depuis combien de temps la séance dure, en secondes (KL-33).
 *
 * Le décompte ne tourne que tant que la séance est ouverte : une fois `endedAt`
 * posé, la durée est un fait, l'intervalle se coupe et la valeur se fige — c'est
 * l'effet qui s'en charge, sans qu'aucun appelant ait à le savoir.
 *
 * La valeur se **recalcule** depuis les deux bornes à chaque tick plutôt que de
 * s'incrémenter : même raison que le repos (`rest.ts`), Android suspend la boucle
 * JS en arrière-plan et un compteur incrémenté reviendrait faux d'autant.
 *
 * À monter dans un composant qui ne peint **que** la durée : un rendu par seconde
 * de l'écran entier ferait sauter la saisie de la note juste à côté.
 */
export function useElapsedSeconds(startedAt: string | null, endedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null || endedAt !== null) {
      return;
    }

    const ticker = setInterval(() => setNow(Date.now()), 1_000);

    return () => clearInterval(ticker);
  }, [startedAt, endedAt]);

  return elapsedSeconds(startedAt, endedAt, now);
}

/** Les séances qu'une mutation attend de pousser, en lecture vive. */
function usePendingUuids(): Set<string> {
  const { data } = useLiveQuery(pendingMutationsQuery());

  return useMemo(() => new Set(data.map((row) => row.payload.uuid)), [data]);
}
