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
 * qu'est un record, et cette copie doit dire la même chose — sinon le losange
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
 * ## Un seul losange par exercice, et pourquoi
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
 * Les records de la séance : la clé de l'exercice vers la clé de la série qui
 * les porte.
 *
 * Une `Map` et non une liste : les deux lecteurs cherchent, ils ne parcourent
 * pas. L'écran de séance demande « cette ligne est-elle le record ? » à chaque
 * ligne rendue, l'écran de clôture demande combien il y en a.
 */
export function sessionRecords(
  program: SessionProgram,
  history: Map<number, ExerciseHistoryRow>,
): Map<string, string> {
  const records = new Map<string, string>();

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
      records.set(exercise.key, leader.key);
    }
  }

  return records;
}
