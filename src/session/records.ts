/**
 * Le record battu, pendant la séance.
 *
 * Pur, comme `summary.ts` et `order.ts` : aucune lecture de base, aucun React.
 * Il prend le déroulé déjà croisé et la carte d'historique, et rend la série qui
 * dépasse la marque — de quoi la peindre à l'écran et la compter à la clôture.
 *
 * ## La règle vient du serveur, elle ne s'invente pas ici
 *
 * `PerformanceHistory::bestByExercise()` et
 * `LoggedSetRepository::findBestWorkingSetsForExercises()` décident déjà de ce
 * qu'est un record, et cette copie doit dire la même chose — sinon la couronne
 * s'allume sur une série que `/profile/stats` ne compte pas.
 *
 * 1. **La charge maximale brute. Aucune estimation.** Un 5 × 120 ne devient pas
 *    un 1RM de 140 : le serveur l'écrit noir sur blanc (`AthleteRecords`), et le
 *    téléphone n'a aucune raison d'être plus bavard que lui.
 * 2. **Pas de record sans kilos.** Au poids du corps, `best` est `null` côté
 *    serveur ; une charge nulle ne se distingue pas d'une charge absente.
 * 3. **L'échauffement est dehors** (`SetType::countsAsWorking`), et un exercice
 *    **sauté** aussi — même s'il porte des séries.
 * 4. **La série doit être chiffrée** : au moins une répétition ou une seconde.
 *    C'est `isMeasured()`, déjà écrit pour le volume, et c'est la même frontière —
 *    140 kg × 0 rep n'est pas un record, c'est une barre qu'on n'a pas soulevée.
 * 5. **Un exercice sans `best` n'a rien à battre.** Sa première charge est une
 *    première, pas un record : c'est la règle de `TrainingStats::records()`, et
 *    elle évite d'annoncer un exploit à chaque exercice découvert.
 * 6. **À charge égale, les répétitions départagent** (`PerformanceHistory::beats`).
 *
 * ## Une seule couronne par exercice, et pourquoi
 *
 * Trois séries qui dépassent l'ancienne marque, ce n'est pas trois records :
 * c'est un record, celui de la meilleure. On retient donc la meilleure série de
 * la séance au sens de la règle 6, et on ne la marque que si elle dépasse la
 * référence. C'est aussi ce dont on se souvient en sortant — « j'ai fait un
 * record aujourd'hui », pas « j'en ai fait trois ».
 *
 * ## La référence ne bouge pas sous les doigts
 *
 * `exercise_history.best` est gelé pour la durée de la séance (`sync/pull.ts`,
 * `replaceHistory`). Sans ce gel, la marque s'allumerait puis s'éteindrait au
 * premier retour au premier plan : le serveur aurait renvoyé un record qui est
 * justement la série qu'on vient de faire, et elle ne se battrait plus elle-même.
 */

import type { ExerciseHistoryRow, LoggedSetRow, PerformanceBest } from '@/db';

import { exerciseIdOf, allExercises, type SessionProgram } from './program';
import { isMeasured } from './summary';

/** Ce qu'il faut d'une série pour la comparer à une marque. */
type Attempt = Pick<LoggedSetRow, 'type' | 'reps' | 'weightKg' | 'durationSeconds'>;

/**
 * Cette série entre-t-elle dans la comparaison ?
 *
 * Les règles 2 à 4 réunies. Une série qui n'y entre pas ne bat rien et ne se
 * fait battre par rien : elle est simplement muette sur cette question.
 */
function comparable(set: Attempt): boolean {
  return set.type !== 'warmup' && isMeasured(set) && (set.weightKg ?? 0) > 0;
}

/**
 * `a` vaut-il mieux que `b` ? La cascade du serveur, dans l'ordre : la charge,
 * puis les répétitions à charge égale.
 *
 * Le serveur ajoute un troisième critère, la date la plus récente. Il n'a pas de
 * sens ici : on compare des séries d'une même séance à une marque plus ancienne,
 * et une égalité parfaite n'est pas un record.
 */
function outranks(a: Attempt, b: { weightKg: number; reps: number | null }): boolean {
  const weight = a.weightKg ?? 0;

  if (weight !== b.weightKg) {
    return weight > b.weightKg;
  }

  return (a.reps ?? 0) > (b.reps ?? 0);
}

/**
 * Cette série bat-elle le record de son exercice ?
 *
 * `false` sans record de référence : une première charge est une première
 * (règle 5). Exporté pour être éprouvé seul — c'est la règle, le reste n'est
 * qu'un parcours.
 */
export function beatsBest(set: Attempt, best: PerformanceBest | null): boolean {
  if (best === null || !comparable(set)) {
    return false;
  }

  return outranks(set, best);
}

/**
 * Un record battu dans la séance : la série qui le porte, et la marque d'avant.
 *
 * La marque battue voyage avec la série parce que les deux écrans en ont besoin
 * ensemble — l'exercice affiche « Record +2,5 kg », la clôture « 92,5 kg, avant
 * 90 kg » — et qu'elle est **gelée** pour la séance (§ « la référence ne bouge
 * pas »). La relire plus tard dans l'historique donnerait la série du jour,
 * puisqu'elle est devenue le record.
 */
export interface SessionRecord {
  /** La ligne de série qui porte le record, celle que la séance couronne. */
  lineKey: string;
  /** Le nom affiché de l'exercice, pour la carte de clôture. */
  name: string;
  /** Toujours des kilos : il n'y a pas de record sans charge (règle 2). */
  weightKg: number;
  reps: number | null;
  durationSeconds: number | null;
  /** La marque d'avant la séance, celle qui vient d'être dépassée. */
  previous: PerformanceBest;
}

/**
 * Ce que le record a gagné, sur l'axe qui l'a fait gagner.
 *
 * La cascade de `outranks` dit d'elle-même lequel : plus lourd, c'est des kilos ;
 * à charge égale, c'est des répétitions. On ne dit jamais les deux — « +2,5 kg,
 * −2 reps » serait juste et illisible, et c'est la charge qui fait le record.
 */
export type RecordGain = { axis: 'weight'; weightKg: number } | { axis: 'reps'; reps: number };

export function recordGain(record: SessionRecord): RecordGain {
  if (record.weightKg !== record.previous.weightKg) {
    // Arrondi au centième : 61,25 − 60 tombe juste en binaire, 60,3 − 60 non,
    // et un gain de 0,29999999999999716 kg n'a rien à faire à l'écran.
    return {
      axis: 'weight',
      weightKg: Math.round((record.weightKg - record.previous.weightKg) * 100) / 100,
    };
  }

  return { axis: 'reps', reps: (record.reps ?? 0) - (record.previous.reps ?? 0) };
}

/**
 * Les records de la séance : la clé de l'exercice vers le record qu'il porte.
 *
 * Une `Map` et non une liste : l'écran de séance cherche (« cette ligne est-elle
 * le record ? » à chaque ligne rendue), il ne parcourt pas. L'ordre d'insertion
 * est celui du déroulé (`allExercises`), et c'est celui dans lequel la clôture
 * les liste.
 */
export function sessionRecords(
  program: SessionProgram,
  history: Map<number, ExerciseHistoryRow>,
): Map<string, SessionRecord> {
  const records = new Map<string, SessionRecord>();

  for (const exercise of allExercises(program)) {
    if (exercise.skipped || exercise.lines === null) {
      continue;
    }

    const exerciseId = exerciseIdOf(exercise);
    const best = exerciseId === null ? null : (history.get(exerciseId)?.best ?? null);

    if (best === null) {
      continue;
    }

    let leader: { key: string; set: Attempt } | null = null;

    for (const line of exercise.lines) {
      const logged = line.logged;

      if (logged === null || !comparable(logged)) {
        continue;
      }

      if (
        leader === null ||
        outranks(logged, { weightKg: leader.set.weightKg ?? 0, reps: leader.set.reps })
      ) {
        leader = { key: line.key, set: logged };
      }
    }

    if (leader !== null && outranks(leader.set, best)) {
      records.set(exercise.key, {
        lineKey: leader.key,
        name: exercise.name,
        // `comparable` a déjà écarté une série sans kilos.
        weightKg: leader.set.weightKg ?? 0,
        reps: leader.set.reps,
        durationSeconds: leader.set.durationSeconds,
        previous: best,
      });
    }
  }

  return records;
}
