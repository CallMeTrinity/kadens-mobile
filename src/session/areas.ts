/**
 * Ce que la séance a chargé, zone par zone — la carte musculaire de la clôture.
 *
 * Tout ici est **pur** : aucune lecture de base, aucun React. Les zones d'un
 * exercice ne vivent pas dans le déroulé (le prescrit ne transporte pas les
 * `targetAreas`, il référence un exercice), elles arrivent donc en annuaire,
 * exactement comme les libellés dans `buildProgram` — c'est ce qui permet de
 * vérifier le comptage sans monter SQLite.
 *
 * ## Le comptage est celui du serveur, et il ne peut pas être autre chose
 *
 * `RegionBreakdown` (Symfony) ventile déjà un volume par zone, et pose deux
 * règles qu'on reprend telles quelles :
 *
 * 1. **Une série compte pour CHAQUE zone de l'exercice.** Un développé couché
 *    charge les pectoraux, les triceps et les épaules ; le total attribué dépasse
 *    donc le nombre de séries réelles, et c'est voulu.
 * 2. **Le pourcentage se calcule sur ce total attribué**, jamais sur le nombre de
 *    séries. Sans ça les parts dépasseraient 100 dès le premier exercice
 *    polyarticulaire.
 *
 * ## Des séries, pas du tonnage
 *
 * Le tonnage ne se ventile pas : réparti sur trois zones il faudrait une
 * pondération que personne n'a mesurée, et une planche ou un gainage n'en a
 * aucun à donner. La série, elle, se répartit sans arbitrage. C'est aussi ce que
 * la barre empilée du web compte, donc la carte et `/schedule/{id}` disent la
 * même chose de la même séance.
 *
 * Le périmètre est celui du reste du résumé (`summary.ts`) : échauffement
 * dehors, exercice sauté dehors, série cochée sans valeur dehors — travailler se
 * mesure, et 140 kg × 0 rep ne charge aucun muscle.
 *
 * ## Pourquoi `full_body` ne peint rien
 *
 * Trois burpees allumeraient la silhouette entière, et une carte qui s'allume
 * partout ne dit plus rien de la séance. La zone est donc comptée **à part** et
 * se dit en légende, comme l'échauffement et les séries non chiffrées à la
 * clôture : hors du dessin, jamais escamotée.
 */

import type { TargetArea } from '@/db';

import { allExercises, exerciseIdOf, type SessionExercise, type SessionProgram } from './program';
import { isMeasured } from './summary';

/**
 * Les zones de chaque exercice de la bibliothèque locale.
 *
 * Un annuaire et non une lecture : `@/session` reste pur, et l'écran monte la
 * requête (`useExerciseAreas`). Un exercice absent de l'annuaire — sorti de la
 * bibliothèque, jamais descendu — ne charge simplement rien.
 */
export type ExerciseAreaBook = ReadonlyMap<number, readonly TargetArea[]>;

/** Une zone travaillée, et ce qu'elle pèse dans la séance. */
export interface AreaLoad {
  area: TargetArea;
  /** Séries de travail mesurées attribuées à cette zone. */
  sets: number;
  /** Part du volume **attribué**, en pourcents. Cf. règle 2 en tête de fichier. */
  percent: number;
  /**
   * Le palier de teinte, de 1 (peu) à 3 (le plus chargé de la séance).
   *
   * Relatif à la séance et non à un barème absolu : la carte répond à « qu'est-ce
   * que je viens de charger », pas à « est-ce beaucoup ». Un seuil fixe dirait la
   * même chose d'une séance de dix séries et d'une de quarante.
   */
  level: 1 | 2 | 3;
}

/** La charge d'une séance, telle que la silhouette la peint. */
export interface BodyLoad {
  /** Les zones touchées, de la plus chargée à la moins chargée. Jamais de zéro. */
  areas: AreaLoad[];
  /** Le total **attribué** : la somme des séries de `areas`, pas les séries faites. */
  attributed: number;
  /** Séries d'un exercice « corps entier ». Comptées à part, hors du dessin. */
  fullBody: number;
  /**
   * Séries de travail mesurées qu'aucune zone n'a reçues : exercice sans zone
   * déclarée, ou sorti de la bibliothèque locale. Dites en légende plutôt que
   * perdues — sinon une carte vide sur une séance pleine resterait inexpliquée.
   */
  unmapped: number;
}

/** Une carte vide. Le cas d'une séance de cardio pur, pas un état dégradé. */
export const EMPTY_BODY_LOAD: BodyLoad = { areas: [], attributed: 0, fullBody: 0, unmapped: 0 };

/**
 * La charge par zone d'un déroulé.
 *
 * L'exercice **réalisé** prime sur le prescrit (`exerciseIdOf`) : un exercice
 * remplacé en séance charge les muscles de ce qu'on a fait, pas de ce qui était
 * prévu.
 */
export function buildBodyLoad(program: SessionProgram, areas: ExerciseAreaBook): BodyLoad {
  // Une Map plutôt qu'un objet : elle garde l'ordre d'insertion, qui départage
  // deux zones à égalité par leur ordre d'apparition dans la séance.
  const byArea = new Map<TargetArea, number>();
  let attributed = 0;
  let fullBody = 0;
  let unmapped = 0;

  for (const exercise of allExercises(program)) {
    if (exercise.skipped) {
      continue;
    }

    const id = exerciseIdOf(exercise);
    const targets = id === null ? undefined : areas.get(id);
    const sets = workingSets(exercise.lines);

    if (sets === 0) {
      continue;
    }

    if (targets === undefined || targets.length === 0) {
      unmapped += sets;

      continue;
    }

    for (const area of targets) {
      // Un exercice « corps entier » qui ne porte QUE cette zone ne peint rien :
      // il doit se lire quelque part, et `fullBody` est cet endroit. Portée à
      // côté d'autres zones, elle compte des deux façons — comme le serveur
      // compte toute zone supplémentaire.
      if (area === 'full_body') {
        fullBody += sets;

        continue;
      }

      byArea.set(area, (byArea.get(area) ?? 0) + sets);
      attributed += sets;
    }
  }

  const peak = Math.max(0, ...byArea.values());

  const loads = [...byArea.entries()].map(([area, sets]) => ({
    area,
    sets,
    percent: Math.round((sets / attributed) * 1_000) / 10,
    level: levelOf(sets, peak),
  }));

  // `sort` est stable : à égalité de séries, l'ordre d'apparition tient.
  loads.sort((left, right) => right.sets - left.sets);

  return { areas: loads, attributed, fullBody, unmapped };
}

/**
 * Les séries de travail **mesurées** d'un exercice.
 *
 * `null` pour le cardio, qui n'a pas de séries à saisir : il se coche fait ou pas
 * fait, et ne charge aucune zone du dessin.
 */
function workingSets(lines: SessionExercise['lines']): number {
  if (lines === null) {
    return 0;
  }

  let count = 0;

  for (const line of lines) {
    const logged = line.logged;

    if (logged !== null && logged.type !== 'warmup' && isMeasured(logged)) {
      count += 1;
    }
  }

  return count;
}

/**
 * Le palier d'une zone, en tiers du maximum de la séance.
 *
 * Trois paliers et pas plus : ce sont trois teintes distinguables d'un coup
 * d'œil sur un écran de téléphone, et la carte répond à « où j'ai chargé », pas à
 * « combien exactement » — le chiffre, lui, est dans la légende.
 */
function levelOf(sets: number, peak: number): 1 | 2 | 3 {
  if (peak === 0) {
    return 1;
  }

  const share = sets / peak;

  if (share > 2 / 3) {
    return 3;
  }

  return share > 1 / 3 ? 2 : 1;
}
