/**
 * Le vocabulaire du domaine, tel que l'API le rend (KL-24).
 *
 * Deux familles de types vivent ici, et elles n'ont pas le même statut :
 *
 * - **Les énumérations** (`ActivityType`, `SetType`…) sont la transcription des
 *   tableaux de valeurs de `docs/api-mobile.md §6.7`. Elles sont écrites en
 *   unions de littéraux et non en `enum` TypeScript : ce qui circule sur le
 *   réseau et ce qui se stocke en base est la **chaîne**, un `enum` ajouterait
 *   un objet à l'exécution pour la même information.
 * - **Les formes JSON** (`PrescribedBlock`, `PerformanceSession`…) décrivent ce
 *   qu'une colonne `mode: 'json'` contient. Elles sont la copie conforme du
 *   producteur serveur (`ScheduledWorkoutPayload`, `PerformanceHistoryPayload`),
 *   parce que c'est le document reçu qui est stocké tel quel — voir `schema.ts`
 *   pour la raison.
 *
 * Ce fichier ne dépend de rien : ni de Drizzle, ni de React Native. C'est ce qui
 * permettra au client API (KL-25) de le partager sans tirer la base derrière lui.
 */

// --- Énumérations -----------------------------------------------------------

/** Statut d'une séance datée. Rien ne **déclôture** côté serveur (§4.1). */
export type ScheduledStatus = 'planned' | 'done' | 'missed';

/** Rôle d'un bloc : le bloc est une **section** de la séance, pas un superset. */
export type BlockRole = 'warmup' | 'main' | 'cooldown';

/**
 * Type de prescription. Seuls `sets_reps` et `sets_time` se saisissent sur le
 * téléphone : le reste est du cardio, il s'affiche et se coche (règle verrouillée
 * du dépôt, `CLAUDE.md §3`).
 */
export type PrescriptionType =
  'sets_reps' | 'sets_time' | 'amrap' | 'for_time' | 'distance_pace' | 'duration';

/** Type d'une série, prescrite comme réalisée. L'échauffement ne compte jamais. */
export type SetType = 'warmup' | 'normal' | 'degressive' | 'to_failure' | 'drop_set';

export type ActivityType = 'gym' | 'running' | 'swimming' | 'cycling' | 'mobility' | 'other';

/**
 * La langue sous laquelle les **noms d'exercices** s'affichent.
 *
 * Ce n'est pas de l'i18n : l'app reste française en dur, seuls les noms
 * d'exercices basculent — un mouvement de salle se pense souvent en anglais.
 * La valeur appartient au **compte** et descend du bootstrap ; elle ne se règle
 * pas ici, l'API n'ayant aucun moyen de la changer.
 */
export type ExerciseLanguage = 'fr' | 'en';

export type TargetArea =
  | 'chest'
  | 'back'
  | 'lower_back'
  | 'traps'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'obliques'
  | 'glutes'
  | 'quadriceps'
  | 'hamstrings'
  | 'adductors'
  | 'calves'
  | 'shins'
  | 'full_body';

// --- Le prescrit, stocké tel qu'il descend ----------------------------------

/** Une série prescrite. `index` est le **rang réel**, pas la position dans la liste. */
export interface PrescribedSetLine {
  index: number;
  type: SetType;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
}

/**
 * Une ligne du programme.
 *
 * `prescribedId` est ce que le réalisé renvoie en `sourcePrescribedId` : c'est
 * lui, et lui seul, qui apparie prévu et fait.
 *
 * `summary` est la **seule** valeur pré-formatée de l'API (« 4 × 8 @ 80 kg ·
 * RPE 8 »). On la peint, on ne la relit pas.
 *
 * `groupLabel` (« A1 », « A2 ») est dérivé de l'ordre côté serveur, jamais
 * stocké : on se fie à l'égalité de préfixe, on ne l'analyse pas.
 */
export interface PrescribedExerciseLine {
  prescribedId: number;
  exerciseId: number | null;
  name: string | null;
  type: PrescriptionType | null;
  summary: string;
  groupLabel: string | null;
  restSeconds: number | null;
  rpe: number | null;
  notes: string | null;
  /** `null` pour un type de prescription qui ne compte pas de séries. */
  sets: PrescribedSetLine[] | null;
}

/** Une section de la séance. `rounds` = tours du bloc entier (circuit). */
export interface PrescribedBlock {
  id: number;
  label: string | null;
  role: BlockRole | null;
  rounds: number | null;
  exercises: PrescribedExerciseLine[];
}

/** Le plan d'où vient une séance datée, quand elle en vient d'un. */
export interface PlanRef {
  id: number;
  title: string | null;
}

// --- L'historique de performance --------------------------------------------

/** Séries consécutives identiques fusionnées, rang réel conservé. */
export interface PerformanceSetGroup {
  type: SetType;
  count: number;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  firstIndex: number;
  lastIndex: number;
}

/** Une séance résumée : la forme d'un point de la trajectoire d'un exercice. */
export interface PerformanceSession {
  date: string;
  workingSets: number;
  tonnageKg: number;
  topWeightKg: number | null;
  sets: PerformanceSetGroup[];
}

/** Le record. Pas de record sans kilos : au poids du corps il n'y en a pas. */
export interface PerformanceBest {
  date: string;
  type: SetType;
  reps: number | null;
  weightKg: number;
  durationSeconds: number | null;
}

// --- La file de mutations ----------------------------------------------------

/**
 * Ce qu'une mutation en attente demande au serveur. Il n'y a que deux sens
 * montants dans toute l'API — le téléphone écrit du réalisé, il ne programme
 * rien — donc deux valeurs, et pas une clé libre.
 *
 * `schedule.put` ne porte **que** l'uuid : le document complet se relit dans la
 * base locale au moment du push (KL-27). Le figer ici en ferait une seconde
 * version du réalisé, qui périmerait dès la série suivante.
 */
export type MutationType = 'schedule.put' | 'schedule.delete';

export interface MutationPayload {
  uuid: string;
}
