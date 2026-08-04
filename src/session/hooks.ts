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

import { localDate, type ScheduledWorkoutRow } from '@/db';

import { dayWindow, type DayCell } from './days';
import { searchExercises, type ExerciseOption } from './library';
import { buildProgram, type SessionProgram } from './program';
import {
  dayCountsQuery,
  exerciseLibraryQuery,
  loggedExercisesQuery,
  loggedSetCountsQuery,
  loggedSetsOfWorkoutQuery,
  pendingMutationsQuery,
  prescribedSnapshotQuery,
  runningWorkoutQuery,
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
 * Le déroulé d'une séance : son programme et son réalisé, croisés (KL-29).
 *
 * **Trois lectures vives et non une**, parce que `useLiveQuery` n'écoute que la
 * table du `from` : le programme change quand un pull le corrige, les exercices
 * réalisés quand on coche la première série de l'un d'eux, les séries à chaque
 * coche. Une requête jointe unique n'aurait été republiée que par sa table de
 * tête, et le déroulé serait resté figé sur les deux autres.
 *
 * Le croisement est mémoïsé : il est pur (`buildProgram`), et le refaire à chaque
 * rendu de l'écran ferait retomber tout le déroulé sur des objets neufs.
 */
export function useSessionProgram(uuid: string): SessionProgram {
  const { data: snapshot } = useLiveQuery(prescribedSnapshotQuery(uuid), [uuid]);
  const { data: exercises } = useLiveQuery(loggedExercisesQuery(uuid), [uuid]);
  const { data: sets } = useLiveQuery(loggedSetsOfWorkoutQuery(uuid), [uuid]);

  return useMemo(
    () => buildProgram(snapshot[0]?.blocks ?? [], exercises, sets),
    [snapshot, exercises, sets],
  );
}

/**
 * La bibliothèque locale filtrée par ce qui est tapé (KL-30).
 *
 * Le hook n'est monté que quand le sélecteur d'exercice est ouvert : la requête
 * remonte toute la table, ce qui est bon marché mais inutile le reste du temps.
 * Le filtrage est pur et mémoïsé (`library.ts`) — il se rejoue à la frappe, pas à
 * chaque rendu de l'écran de séance.
 */
export function useExerciseLibrary(term: string): ExerciseOption[] {
  const { data } = useLiveQuery(exerciseLibraryQuery());

  return useMemo(() => searchExercises(data, term), [data, term]);
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

/** Les séances qu'une mutation attend de pousser, en lecture vive. */
function usePendingUuids(): Set<string> {
  const { data } = useLiveQuery(pendingMutationsQuery());

  return useMemo(() => new Set(data.map((row) => row.payload.uuid)), [data]);
}
