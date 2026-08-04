/**
 * Le résumé d'une séance et ses écarts au prescrit (KL-33).
 *
 * Tout ici est **pur** : aucune lecture de base, aucune écriture, aucun React.
 * Le résumé se calcule à partir du déroulé déjà croisé (`SessionProgram`), qui
 * porte le prescrit **et** le réalisé appariés ligne à ligne. C'est ce qui permet
 * de vérifier la cascade de comparaison — la partie délicate de ce ticket — sans
 * monter ni SQLite ni React Native.
 *
 * ## Pourquoi le téléphone recalcule ce que le serveur sait déjà faire
 *
 * `LogMetrics` et `LogComparator` produisent exactement ça côté Symfony, et
 * `/schedule/{id}` l'affiche. Mais l'écran de clôture s'ouvre **dans le
 * sous-sol**, avant le moindre envoi : demander le résumé au serveur, ce serait
 * un écran vide au moment précis où la séance se termine. Le calcul est donc
 * refait ici, et la règle qui compte est qu'il donne le **même verdict** — même
 * périmètre (échauffement exclu, exercice sauté hors volume), même cascade
 * d'axes, même vocabulaire d'états. Un mobile qui dirait « allégé » là où le web
 * dit « tenu » vaudrait moins que pas de résumé du tout.
 *
 * ## Les deux règles héritées du serveur, à ne pas casser
 *
 * 1. **L'échauffement n'est pas du volume** (`SetType::countsAsWorking`), et un
 *    exercice **sauté** n'apporte rien — même s'il porte des séries abandonnées.
 *    Il est compté à part, comme `LogMetrics` le fait.
 * 2. **Un axe muet d'un côté ne tranche jamais** (KL-05, décision 4). Comparer
 *    une charge à une absence de charge dirait « allégé » d'une série au poids du
 *    corps. D'où des totaux à `null` — « personne n'a rien dit de cet axe » — et
 *    non à zéro.
 *
 * ## Ce qui diverge volontairement du serveur : la durée
 *
 * `LogMetrics::durationSeconds()` rend `null` tant qu'une borne manque, parce
 * qu'une durée « jusqu'à maintenant » bougerait à chaque rafraîchissement d'une
 * page web. Ici c'est l'inverse qu'on veut : l'écran de clôture est ouvert
 * pendant que la séance dure encore, et « depuis combien de temps j'y suis » est
 * une des quatre choses qu'il doit dire. La durée court donc jusqu'à l'instant
 * présent tant que `endedAt` est nul, et se fige à la clôture — c'est-à-dire au
 * moment exact où la valeur part au serveur.
 */

import type { SessionExercise, SessionProgram } from './program';
import { allExercises } from './program';

/**
 * L'état d'un exercice au regard de ce qui était prévu.
 *
 * Les six mêmes que `App\Enum\LogDeviation` côté serveur, valeurs comprises :
 * ce qui s'affiche à la clôture doit être ce qu'on relira sur `/schedule/{id}`.
 * `held` est aussi la valeur « rien à signaler » quand l'écart n'est pas
 * mesurable (cardio, exercice sans séries à apparier) — on ne prétend jamais
 * mesurer ce qu'on ne sait pas comparer.
 */
export type DeviationState =
  'held' | 'exceeded' | 'lightened' | 'skipped' | 'not_logged' | 'unplanned';

/** L'axe sur lequel l'écart s'est lu. L'ordre du tableau est la cascade elle-même. */
export type DeviationAxis = 'tonnage' | 'weight' | 'reps' | 'duration' | 'sets';

/**
 * La cascade de KL-05, décision 4, dans l'ordre.
 *
 * Le tonnage passe en premier parce que c'est la grandeur du projet : 6 × 82,5 kg
 * là où 8 × 80 kg étaient prévus, c'est plus lourd mais moins de travail, donc
 * allégé. Le nombre de séries ferme la marche — il tranche quand rien d'autre ne
 * parle, typiquement une série de gainage ajoutée ou manquée.
 */
const AXES: readonly DeviationAxis[] = ['tonnage', 'weight', 'reps', 'duration', 'sets'];

/** Ce qu'un exercice de la séance a donné, et sur quoi ça se lit. */
export interface ExerciseOutcome {
  /** La clé du déroulé, stable d'un rendu à l'autre. */
  key: string;
  name: string;
  state: DeviationState;
  /** L'axe qui a tranché, `null` quand il n'y a pas d'écart mesuré. */
  axis: DeviationAxis | null;
  /** Les deux valeurs de cet axe, brutes. La mise en forme appartient à l'écran. */
  planned: number | null;
  logged: number | null;
}

/** Le résumé d'une séance, tel que l'écran de clôture le peint. */
export interface SessionSummary {
  /** Durée réelle, en secondes. `null` si la séance n'a pas de début. */
  durationSeconds: number | null;
  /** Tonnage effectif : Σ répétitions × charge, échauffement et sautés exclus. */
  tonnageKg: number;
  /** Séries de travail consignées. C'est le compte que le serveur affichera. */
  workingSets: number;
  /** Séries d'échauffement consignées, comptées à part et jamais mêlées au volume. */
  warmupSets: number;
  /** Séries de travail que le programme réclamait, exercices sautés exclus. */
  plannedWorkingSets: number;
  /** Exercices portant du réalisé, sautés exclus — comme `LogMetrics`. */
  exerciseCount: number;
  /** Exercices déclarés sautés. Une déclaration, pas un trou. */
  skipped: number;
  /** Chaque exercice de la séance, dans l'ordre du déroulé. */
  outcomes: ExerciseOutcome[];
  /** Combien d'exercices par état, pour la ligne de tête. */
  counts: Record<DeviationState, number>;
}

/** Les bornes d'une séance, telles que `scheduled_workout` les porte. */
export interface SessionBounds {
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * Le résumé complet d'une séance.
 *
 * `now` est passé plutôt que lu : c'est ce qui rend la durée vérifiable, et ce
 * qui permet à l'écran de la faire courir sans que le reste du résumé se
 * recalcule à chaque seconde.
 */
export function buildSessionSummary(
  program: SessionProgram,
  bounds: SessionBounds,
  now: number = Date.now(),
): SessionSummary {
  const outcomes: ExerciseOutcome[] = [];
  const counts: Record<DeviationState, number> = {
    held: 0,
    exceeded: 0,
    lightened: 0,
    skipped: 0,
    not_logged: 0,
    unplanned: 0,
  };

  let tonnageKg = 0;
  let workingSets = 0;
  let warmupSets = 0;
  let plannedWorkingSets = 0;
  let exerciseCount = 0;
  let skipped = 0;

  for (const exercise of allExercises(program)) {
    const outcome = exerciseOutcome(exercise);

    outcomes.push(outcome);
    counts[outcome.state] += 1;

    if (exercise.skipped) {
      // Sauté : une information, pas du volume. Ses séries abandonnées ne
      // comptent nulle part — même règle que `LogMetrics`, qui les met à part.
      skipped += 1;

      continue;
    }

    if (exercise.logged !== null) {
      exerciseCount += 1;
    }

    for (const line of exercise.lines ?? []) {
      if (line.planned !== null && line.type !== 'warmup') {
        plannedWorkingSets += 1;
      }

      const logged = line.logged;

      if (logged === null) {
        continue;
      }

      if (logged.type === 'warmup') {
        warmupSets += 1;

        continue;
      }

      workingSets += 1;

      if (logged.reps !== null && logged.weightKg !== null) {
        tonnageKg += logged.reps * logged.weightKg;
      }
    }
  }

  return {
    durationSeconds: elapsedSeconds(bounds.startedAt, bounds.endedAt, now),
    tonnageKg,
    workingSets,
    warmupSets,
    plannedWorkingSets,
    exerciseCount,
    skipped,
    outcomes,
    counts,
  };
}

/**
 * Depuis combien de temps la séance dure — ou combien de temps elle a duré.
 *
 * `null` sans borne de départ : une séance qu'on n'a pas commencée n'a pas de
 * durée, et zéro en serait une. Une fin **antérieure** au début (l'horloge du
 * téléphone rattrapée entre les deux écritures) est ramenée à 0 plutôt que
 * rendue négative, exactement comme le serveur le fait.
 */
export function elapsedSeconds(
  startedAt: string | null,
  endedAt: string | null,
  now: number = Date.now(),
): number | null {
  if (startedAt === null) {
    return null;
  }

  const start = Date.parse(startedAt);

  if (Number.isNaN(start)) {
    return null;
  }

  const end = endedAt === null ? now : Date.parse(endedAt);

  if (Number.isNaN(end)) {
    return null;
  }

  return Math.max(0, Math.floor((end - start) / 1_000));
}

/**
 * L'écart d'un seul exercice, prescrit contre fait.
 *
 * Les quatre cas qui ne se mesurent pas se règlent d'abord, et dans cet ordre :
 * **sauté** est une déclaration et prime sur tout le reste (un exercice sauté
 * peut porter des séries abandonnées, elles ne racontent rien) ; **hors
 * programme** n'a rien en face de lui ; **non réalisé** est le trou, distinct du
 * saut ; le **cardio** n'a qu'une chose à dire, fait ou pas fait, et le déclarer
 * fait suffit à ce qu'il n'y ait rien à signaler.
 */
export function exerciseOutcome(exercise: SessionExercise): ExerciseOutcome {
  const base = { key: exercise.key, name: exercise.name };

  if (exercise.skipped) {
    return { ...base, state: 'skipped', axis: null, planned: null, logged: null };
  }

  if (exercise.prescribed === null) {
    return { ...base, state: 'unplanned', axis: null, planned: null, logged: null };
  }

  if (exercise.logged === null) {
    return { ...base, state: 'not_logged', axis: null, planned: null, logged: null };
  }

  if (exercise.lines === null) {
    // Cardio coché fait : rien à comparer, donc rien à signaler.
    return { ...base, state: 'held', axis: null, planned: null, logged: null };
  }

  const work = exercise.lines.filter((line) => line.type !== 'warmup');
  const planned = totals(work.map((line) => line.planned));
  const logged = totals(work.map((line) => line.logged));

  for (const axis of AXES) {
    const left = planned[axis];
    const right = logged[axis];

    // Un axe muet d'un côté ne tranche jamais, et deux valeurs égales non plus :
    // on descend à l'axe suivant, pas au verdict.
    if (left === null || right === null || left === right) {
      continue;
    }

    return {
      ...base,
      state: right > left ? 'exceeded' : 'lightened',
      axis,
      planned: left,
      logged: right,
    };
  }

  return { ...base, state: 'held', axis: null, planned: null, logged: null };
}

/** Les totaux d'un côté de la comparaison, indexés par axe. */
type Totals = Record<DeviationAxis, number | null>;

/** Ce que portent les deux côtés d'une ligne : le prescrit et le réalisé s'y lisent pareil. */
type SetLike = { reps: number | null; weightKg: number | null; durationSeconds: number | null };

/**
 * Les totaux d'un côté, sur les seules lignes de travail.
 *
 * **Une seule fonction pour les deux côtés**, et c'est ce qui garantit qu'ils se
 * comptent pareil : un prescrit sommé d'une façon et un réalisé d'une autre
 * produiraient un écart qui n'existe pas. Le prescrit et le réalisé portent les
 * trois mêmes valeurs brutes, seule leur origine diffère.
 *
 * `sets` est le seul total qui n'est jamais muet : zéro série faite est une
 * information, pas une absence.
 */
function totals(sets: (SetLike | null)[]): Totals {
  return {
    tonnage: tonnage(sets),
    weight: top(sets.map((set) => set?.weightKg ?? null)),
    reps: sum(sets.map((set) => set?.reps ?? null)),
    duration: sum(sets.map((set) => set?.durationSeconds ?? null)),
    sets: sets.filter((set) => set !== null).length,
  };
}

/**
 * Σ répétitions × charge. `null` quand aucune série ne porte les deux.
 *
 * Zéro dirait « aucun tonnage », ce qui est vrai d'une série au poids du corps —
 * et comparer ce zéro à un tonnage prescrit ferait dire « allégé » d'un exercice
 * qui n'a jamais eu de charge à porter.
 */
function tonnage(sets: (SetLike | null)[]): number | null {
  return sum(
    sets.map((set) =>
      set && set.reps !== null && set.weightKg !== null ? set.reps * set.weightKg : null,
    ),
  );
}

/** La somme des valeurs renseignées, `null` s'il n'y en a aucune. */
function sum(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);

  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}

/** La plus lourde des charges renseignées, `null` s'il n'y en a aucune. */
function top(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);

  return known.length === 0 ? null : Math.max(...known);
}
