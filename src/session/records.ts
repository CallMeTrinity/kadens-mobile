/**
 * Le record battu, pendant la séance.
 *
 * Pur, comme `summary.ts` et `order.ts` : aucune lecture de base, aucun React.
 * Il prend le déroulé déjà croisé et la carte d'historique, et rend la série qui
 * dépasse la marque — de quoi la peindre à l'écran et la compter à la clôture.
 *
 * ## La règle vient du serveur, elle ne s'invente pas ici
 *
 * `PerformanceHistory` décide déjà de ce qu'est un record, et cette copie doit
 * dire la même chose — sinon la couronne s'allume sur une série que le serveur ne
 * compte pas. Il en tient **deux**, sur deux séries disjointes :
 *
 * - **le record de charge** (`best`, `bestByExercise()`) : la série chargée la
 *   plus lourde ;
 * - **le record au poids du corps** (`bestReps`, `bestRepMaxesForIds()`) : la
 *   série sans charge la plus longue en répétitions. C'est celui d'une pompe, et
 *   c'est le même que la case « Pompes » de la fiche athlète (`AthleteRecords`).
 *
 * 1. **Des valeurs brutes. Aucune estimation.** Un 5 × 120 ne devient pas un 1RM
 *    de 140 : le serveur l'écrit noir sur blanc (`AthleteRecords`), et le
 *    téléphone n'a aucune raison d'être plus bavard que lui.
 * 2. **Chaque série a son record, et un seul.** Une série chargée se mesure à la
 *    charge ; une série sans kilos (charge nulle ou absente, que rien ne
 *    distingue) se mesure aux répétitions. 20 dips à 10 kg ne disent rien d'un
 *    maximum à vide, et 30 pompes ne battent pas un développé couché.
 * 3. **L'échauffement est dehors** (`SetType::countsAsWorking`), et un exercice
 *    **sauté** aussi — même s'il porte des séries.
 * 4. **La série doit être chiffrée** : au moins une répétition ou une seconde.
 *    C'est `isMeasured()`, déjà écrit pour le volume, et c'est la même frontière —
 *    140 kg × 0 rep n'est pas un record, c'est une barre qu'on n'a pas soulevée.
 *    Au poids du corps, il faut des répétitions : un gainage chronométré n'en a
 *    pas, et n'a donc rien à battre ici.
 * 5. **Une marque absente n'a rien à battre.** La première charge, ou la première
 *    série à vide, est une première, pas un record : c'est la règle de
 *    `TrainingStats::records()`, et elle évite d'annoncer un exploit à chaque
 *    exercice découvert. 14 pompes la première fois ne couronnent rien ; 15 la
 *    semaine suivante, si.
 * 6. **À charge égale, les répétitions départagent** (`PerformanceHistory::beats`).
 *    Au poids du corps, elles sont tout le critère.
 *
 * ## Une seule couronne par exercice, et pourquoi
 *
 * Trois séries qui dépassent l'ancienne marque, ce n'est pas trois records :
 * c'est un record, celui de la meilleure. On retient donc la meilleure série de
 * la séance au sens de la règle 6, et on ne la marque que si elle dépasse la
 * référence. C'est aussi ce dont on se souvient en sortant — « j'ai fait un
 * record aujourd'hui », pas « j'en ai fait trois ».
 *
 * Une traction lestée puis une série à vide peuvent, en théorie, battre les deux
 * marques le même jour. La charge passe alors devant : c'est elle qui fait le
 * record quand il y en a une, et la séance ne porte toujours qu'une couronne.
 *
 * ## La référence ne bouge pas sous les doigts
 *
 * `exercise_history` (`best` et `best_reps`) est gelé pour la durée de la séance (`sync/pull.ts`,
 * `replaceHistory`). Sans ce gel, la marque s'allumerait puis s'éteindrait au
 * premier retour au premier plan : le serveur aurait renvoyé un record qui est
 * justement la série qu'on vient de faire, et elle ne se battrait plus elle-même.
 */

import type { ExerciseHistoryRow, LoggedSetRow, PerformanceBest, PerformanceRepMax } from '@/db';

import { exerciseIdOf, allExercises, type SessionProgram } from './program';
import { isMeasured } from './summary';

/** Ce qu'il faut d'une série pour la comparer à une marque. */
type Attempt = Pick<LoggedSetRow, 'type' | 'reps' | 'weightKg' | 'durationSeconds'>;

/**
 * Une série de travail qui mesure quelque chose : les règles 3 et 4. Celle qui
 * n'y entre pas ne bat rien et ne se fait battre par rien — elle est simplement
 * muette sur la question.
 */
function counts(set: Attempt): boolean {
  return set.type !== 'warmup' && isMeasured(set);
}

/** Cette série se mesure-t-elle au record de charge ? (règle 2) */
function comparable(set: Attempt): boolean {
  return counts(set) && (set.weightKg ?? 0) > 0;
}

/**
 * Cette série se mesure-t-elle au record au poids du corps ? (règles 2 et 4)
 *
 * `=== 0` après `?? 0`, et non `<= 0` : c'est le `weightKg IS NULL OR weightKg = 0`
 * du serveur (`LoggedSetRepository::unloaded`), au caractère près.
 */
function unloaded(set: Attempt): boolean {
  return counts(set) && (set.weightKg ?? 0) === 0 && (set.reps ?? 0) > 0;
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
 * Cette série sans charge bat-elle le record au poids du corps ?
 *
 * Strictement plus de répétitions : égaler sa marque n'est pas la battre. `false`
 * sans marque (règle 5), et pour toute série chargée (règle 2).
 */
export function beatsRepMax(set: Attempt, best: PerformanceRepMax | null): boolean {
  if (best === null || !unloaded(set)) {
    return false;
  }

  return (set.reps ?? 0) > best.reps;
}

/** Ce que les deux sortes de record ont en commun. */
interface RecordLine {
  /** La ligne de série qui porte le record, celle que la séance couronne. */
  lineKey: string;
  /** Le nom affiché de l'exercice, pour la carte de clôture. */
  name: string;
}

/**
 * Un record battu dans la séance : la série qui le porte, et la marque d'avant.
 *
 * La marque battue voyage avec la série parce que les deux écrans en ont besoin
 * ensemble — l'exercice affiche « Record +2,5 kg », la clôture « 92,5 kg, avant
 * 90 kg » — et qu'elle est **gelée** pour la séance (§ « la référence ne bouge
 * pas »). La relire plus tard dans l'historique donnerait la série du jour,
 * puisqu'elle est devenue le record.
 *
 * `metric` dit lequel des deux records est tombé, et donc quelle grandeur
 * afficher : des kilos, ou un compte de répétitions.
 */
export type SessionRecord =
  | (RecordLine & {
      metric: 'load';
      /** Toujours des kilos : il n'y a pas de record de charge sans charge. */
      weightKg: number;
      reps: number | null;
      durationSeconds: number | null;
      /** La marque d'avant la séance, celle qui vient d'être dépassée. */
      previous: PerformanceBest;
    })
  | (RecordLine & {
      metric: 'reps';
      /** Toujours un compte : une série à vide sans répétitions ne bat rien. */
      reps: number;
      previous: PerformanceRepMax;
    });

/**
 * Ce que le record a gagné, sur l'axe qui l'a fait gagner.
 *
 * La cascade de `outranks` dit d'elle-même lequel : plus lourd, c'est des kilos ;
 * à charge égale, c'est des répétitions. On ne dit jamais les deux — « +2,5 kg,
 * −2 reps » serait juste et illisible, et c'est la charge qui fait le record.
 */
export type RecordGain = { axis: 'weight'; weightKg: number } | { axis: 'reps'; reps: number };

export function recordGain(record: SessionRecord): RecordGain {
  if (record.metric === 'reps') {
    return { axis: 'reps', reps: record.reps - record.previous.reps };
  }

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
    const past = exerciseId === null ? null : (history.get(exerciseId) ?? null);
    const best = past?.best ?? null;
    // `?? null` et non le seul `?.` : une ligne écrite avant la colonne
    // `best_reps` (migration 0012) la relit nulle, et un serveur antérieur ne
    // l'envoie pas — dans les deux cas, rien à battre.
    const bestReps = past?.bestReps ?? null;

    if (best === null && bestReps === null) {
      continue;
    }

    // Les deux meneurs de la séance, chacun sur sa série (règle 2).
    let heaviest: { key: string; set: Attempt } | null = null;
    let longest: { key: string; set: Attempt } | null = null;

    for (const line of exercise.lines) {
      const logged = line.logged;

      if (logged === null) {
        continue;
      }

      if (comparable(logged)) {
        if (
          heaviest === null ||
          outranks(logged, { weightKg: heaviest.set.weightKg ?? 0, reps: heaviest.set.reps })
        ) {
          heaviest = { key: line.key, set: logged };
        }
      } else if (unloaded(logged)) {
        if (longest === null || (logged.reps ?? 0) > (longest.set.reps ?? 0)) {
          longest = { key: line.key, set: logged };
        }
      }
    }

    // La charge d'abord : c'est elle qui fait le record quand il y en a une.
    if (heaviest !== null && best !== null && outranks(heaviest.set, best)) {
      records.set(exercise.key, {
        metric: 'load',
        lineKey: heaviest.key,
        name: exercise.name,
        // `comparable` a déjà écarté une série sans kilos.
        weightKg: heaviest.set.weightKg ?? 0,
        reps: heaviest.set.reps,
        durationSeconds: heaviest.set.durationSeconds,
        previous: best,
      });
    } else if (longest !== null && bestReps !== null && beatsRepMax(longest.set, bestReps)) {
      records.set(exercise.key, {
        metric: 'reps',
        lineKey: longest.key,
        name: exercise.name,
        // `unloaded` a déjà écarté une série sans répétitions.
        reps: longest.set.reps ?? 0,
        previous: bestReps,
      });
    }
  }

  return records;
}
