/**
 * Les jeux de données des tests (KL-36).
 *
 * ## Des charges utiles, pas des lignes
 *
 * Tout part de ce que le serveur produit — `BootstrapPayload` et ses parties —
 * et la base se remplit en **appliquant un vrai pull** (`seedBootstrap`). Un
 * test qui insérerait ses lignes à la main décrirait un état que le serveur ne
 * sait pas produire, et le jour où le contrat bouge il continuerait de passer.
 *
 * Le corollaire vaut d'être dit : dans une suite de séance, le pull qui remplit
 * la base est déjà un morceau du parcours testé. Rien n'est mis en place par un
 * chemin que l'app n'emprunte pas.
 *
 * ## Les valeurs par défaut décrivent le cas simple
 *
 * Un exercice de force, quatre séries de huit à 80 kg, une séance datée
 * d'aujourd'hui, non commencée. Chaque test surcharge ce qui l'intéresse et
 * laisse le reste tranquille — ce qui rend lisible, dans une suite, ce qui est
 * la variable de l'essai.
 */

import type {
  BootstrapPayload,
  ExercisePayload,
  LoggedExercisePayload,
  ScheduledWorkoutPayload,
} from '@/api';
import { localDate, type PrescribedBlock, type PrescribedExerciseLine } from '@/db';
// Le seul import « profond » des tests : `applyBootstrap` n'est pas exposé par
// `@/sync` (le moteur est la seule porte d'entrée du pull côté app), et c'est
// pourtant lui qui pose une base dans l'état où le serveur l'a mise.
import { applyBootstrap } from '@/sync/pull';

/** Aujourd'hui, à l'heure locale : la même date que celle que l'app calcule. */
export function today(): string {
  return localDate();
}

/** Un jour d'ici, en date de calendrier. */
export function dayFromNow(days: number): string {
  const date = new Date();

  date.setDate(date.getDate() + days);

  return localDate(date);
}

export function exercisePayload(
  id: number,
  overrides: Partial<ExercisePayload> = {},
): ExercisePayload {
  return {
    id,
    name: `Exercice ${id}`,
    description: null,
    activity: 'gym',
    targetAreas: ['chest'],
    mediaUrl: null,
    global: true,
    updatedAt: '2026-07-01T10:00:00Z',
    ...overrides,
  };
}

/** Une ligne du programme : quatre séries de huit à 80 kg. */
export function prescribedExercise(
  prescribedId: number,
  overrides: Partial<PrescribedExerciseLine> = {},
): PrescribedExerciseLine {
  return {
    prescribedId,
    exerciseId: 100 + prescribedId,
    name: `Exercice ${100 + prescribedId}`,
    type: 'sets_reps',
    summary: '4 × 8 @ 80 kg',
    groupLabel: null,
    restSeconds: 90,
    rpe: null,
    notes: null,
    sets: [1, 2, 3, 4].map((index) => ({
      index,
      type: 'normal' as const,
      reps: 8,
      weightKg: 80,
      durationSeconds: null,
    })),
    ...overrides,
  };
}

export function prescribedBlock(
  id: number,
  exercises: PrescribedExerciseLine[],
  overrides: Partial<PrescribedBlock> = {},
): PrescribedBlock {
  return { id, label: null, role: 'main', rounds: null, exercises, ...overrides };
}

/** Une séance datée programmée, non commencée, avec un bloc d'un exercice. */
export function scheduledWorkout(
  uuid: string,
  overrides: Partial<ScheduledWorkoutPayload> = {},
): ScheduledWorkoutPayload {
  return {
    uuid,
    date: today(),
    status: 'planned',
    title: 'Haut du corps',
    freeform: false,
    startedAt: null,
    endedAt: null,
    completionNotes: null,
    plan: null,
    blocks: [prescribedBlock(1, [prescribedExercise(1)])],
    log: null,
    ...overrides,
  };
}

/** Un exercice réalisé, tel que le serveur le redescend. */
export function loggedExercise(
  overrides: Partial<LoggedExercisePayload> = {},
): LoggedExercisePayload {
  return {
    exerciseId: 101,
    name: 'Exercice 101',
    sourcePrescribedId: 1,
    position: 0,
    skipped: false,
    notes: null,
    sets: [],
    ...overrides,
  };
}

export function bootstrapPayload(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    serverTime: '2026-08-04T09:00:00Z',
    since: null,
    window: { from: dayFromNow(-30), to: dayFromNow(14) },
    exercises: [exercisePayload(101)],
    schedule: [],
    history: [],
    deleted: { exercises: [], schedule: [] },
    ...overrides,
  };
}

/** Remplit la base comme le ferait un pull réussi. Rend le rapport du pull. */
export function seedBootstrap(overrides: Partial<BootstrapPayload> = {}) {
  return applyBootstrap(bootstrapPayload(overrides));
}
