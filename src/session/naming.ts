/**
 * Le **seul** endroit qui décide sous quel libellé un exercice s'affiche.
 *
 * Pendant mobile de `App\Service\ExerciseNaming` (serveur), et il tient les
 * mêmes règles pour la même raison : une langue au choix ajoute trois replis, et
 * autant d'occasions d'en oublier un — l'écran de séance, la feuille de
 * remplacement, la liste des facettes, le résumé de clôture. Ils vivent ici.
 * **Un composant qui écrit `row.name` court-circuite la préférence.**
 *
 * ## Pourquoi le libellé se résout ici et pas sur le serveur
 *
 * Parce que les deux noms descendent toujours et qu'aucun n'est élu à la
 * descente (`docs/api-mobile.md §6.5`). Le contraire aurait été plus simple à
 * écrire et faux à l'usage : `?since` n'allège que la bibliothèque, donc un
 * `name` traduit au pull resterait figé dans l'ancienne langue sur toutes les
 * lignes qu'un delta ne remonte pas — c'est-à-dire, en régime établi, sur la
 * quasi-totalité de la bibliothèque. Résolu ici, le basculement est immédiat,
 * complet, et il marche **hors réseau**.
 *
 * ## Les trois replis
 *
 * 1. **Pas de langue connue → français.** Tant qu'aucun bootstrap n'a abouti, on
 *    lit la langue d'origine de la bibliothèque, comme un lecteur sans compte
 *    côté serveur.
 * 2. **Anglais sans `nameEn` → français.** Jamais de trou : le champ est
 *    facultatif par construction (« Dips », « Fartlek » — le français EST déjà
 *    l'anglais).
 * 3. **Exercice absent de la bibliothèque locale → le nom transporté.** C'est ce
 *    que `referenceLabel` sert : le prescrit porte le nom de l'exercice vivant,
 *    le réalisé un snapshot pris au moment de la séance.
 *
 * ## Le nom vivant prime sur la copie figée
 *
 * `logged_exercise.exercise_name` est un snapshot, et l'historique affiche
 * pourtant le nom **vivant** tant que l'exercice existe. Sans ça, une séance
 * faite avant la bascule resterait écrite en français au milieu d'un écran
 * anglais — et un snapshot ne peut pas porter deux langues sans une seconde
 * colonne. Le snapshot ne reprend la main que si l'exercice a disparu : c'est sa
 * raison d'être, survivre à une suppression, pas figer un affichage.
 *
 * Même règle que le web (`exercise_name(entry.exercise, entry.name)`), et même
 * conséquence assumée : renommer un exercice change son libellé dans
 * l'historique.
 */

import type { ExerciseLanguage } from '@/db';

/** Les deux libellés d'un exercice. La forme minimale que ce module demande. */
export interface ExerciseNames {
  name: string;
  /** `null` quand le français EST déjà l'anglais. */
  nameEn: string | null;
}

/** Le libellé d'un exercice **de la bibliothèque**, dans la langue demandée. */
export function exerciseLabel(names: ExerciseNames, language: ExerciseLanguage): string {
  if (language !== 'en') {
    return names.name;
  }

  return names.nameEn !== null && names.nameEn !== '' ? names.nameEn : names.name;
}

/**
 * Le second libellé, celui que la langue courante n'affiche pas — `null` quand
 * il n'y en a pas d'autre à montrer.
 *
 * N'entre dans **aucune** vue de consultation : il sert à la recherche, où les
 * deux langues doivent trouver la même ligne. Deux noms côte à côte dans une
 * liste qu'on parcourt au pouce doubleraient la hauteur pour la moitié des
 * entrées et n'aideraient personne — on cherche un nom, on en lit un.
 */
export function alternateName(names: ExerciseNames, language: ExerciseLanguage): string | null {
  if (names.nameEn === null || names.nameEn === '' || names.nameEn === names.name) {
    return null;
  }

  return language === 'en' ? names.name : names.nameEn;
}

/**
 * Le texte sur lequel la recherche mord : les deux noms, quelle que soit la
 * langue affichée.
 *
 * C'est ce qui fait qu'« incline bench » trouve « Développé incliné » sur un
 * téléphone réglé en français, et l'inverse. Volontairement **pas replié** ici :
 * `library.ts` replie les deux côtés de la comparaison avec sa propre table, et
 * le faire deux fois ferait diverger les deux écritures au premier caractère
 * exotique.
 */
export function exerciseSearchText(names: ExerciseNames): string {
  const alternate = names.nameEn;

  return alternate === null || alternate === '' || alternate === names.name
    ? names.name
    : `${names.name} ${alternate}`;
}

/**
 * La bibliothèque locale vue comme un annuaire de libellés : « cet identifiant,
 * comment ça s'appelle chez moi, aujourd'hui, dans ma langue ».
 *
 * C'est ce que le déroulé de séance consomme (`program.ts`), et il ne connaît
 * donc ni les deux noms ni la préférence — un seul point de résolution, une
 * seule règle à changer le jour où une troisième langue arrive.
 */
export interface ExerciseNameBook {
  /** Le libellé vivant, ou `null` si l'exercice n'est plus dans la bibliothèque locale. */
  labelOf(exerciseId: number | null | undefined): string | null;
}

/** L'annuaire vide : tout retombe sur le nom transporté. C'est le cas d'un exercice supprimé. */
export const EMPTY_NAME_BOOK: ExerciseNameBook = { labelOf: () => null };

export function exerciseNameBook(
  rows: (ExerciseNames & { id: number })[],
  language: ExerciseLanguage,
): ExerciseNameBook {
  const labels = new Map<number, string>();

  for (const row of rows) {
    labels.set(row.id, exerciseLabel(row, language));
  }

  return {
    labelOf: (exerciseId) =>
      exerciseId === null || exerciseId === undefined ? null : (labels.get(exerciseId) ?? null),
  };
}

/**
 * Le libellé d'une **référence** : l'exercice vivant s'il est encore là, le nom
 * transporté sinon, et `null` quand il n'y a plus rien à afficher — à l'appelant
 * de dire ce qu'il écrit alors, la phrase n'est pas la même sur un prescrit
 * (« Exercice retiré de la bibliothèque ») et sur un réalisé.
 */
export function referenceLabel(
  book: ExerciseNameBook,
  exerciseId: number | null | undefined,
  transported: string | null,
): string | null {
  return (
    book.labelOf(exerciseId) ?? (transported !== null && transported !== '' ? transported : null)
  );
}
