/**
 * La recherche dans la bibliothèque locale (KL-30).
 *
 * Elle sert à remplacer un exercice, ou à en ajouter un que le programme ne
 * prévoyait pas. Tout est **pur** ici : la lecture est une requête vive
 * (`exerciseLibraryQuery`), le filtrage se fait en mémoire.
 *
 * ## Pourquoi en mémoire et pas en SQL
 *
 * Deux raisons, et la seconde est la vraie.
 *
 * 1. La bibliothèque tient en quelques centaines de lignes — la globale plus la
 *    sienne — et elle est déjà entièrement en base : la charger pour la filtrer
 *    coûte moins qu'une requête par frappe.
 * 2. **`LIKE` de SQLite ignore la casse en ASCII seulement.** « developpe » ne
 *    trouverait pas « Développé couché », dans une app dont toute la bibliothèque
 *    est en français. Il faut donc replier les accents, et le replier des deux
 *    côtés de la comparaison n'est possible qu'en mémoire (SQLite n'a pas de
 *    collation Unicode sans extension `ICU`).
 *
 * Le repli d'accents est une **table écrite à la main**, pas un
 * `String.normalize('NFD')` : la présence d'ICU dépend de la variante d'Hermes
 * embarquée, exactement comme pour les noms de jours de `days.ts` — et un repli
 * silencieux donnerait une recherche qui marche en développement et pas sur le
 * téléphone.
 */

/** Un exercice de la bibliothèque, tel que le sélecteur le montre. */
export interface ExerciseOption {
  id: number;
  name: string;
  /** Exercice de l'app (par opposition à un exercice perso). Marqué à l'écran. */
  global: boolean;
}

/** Au-delà, la liste ne se parcourt plus au pouce : c'est le champ qu'il faut préciser. */
export const SEARCH_LIMIT = 40;

const FOLDED: Record<string, string> = {
  à: 'a',
  â: 'a',
  ä: 'a',
  ç: 'c',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  î: 'i',
  ï: 'i',
  ô: 'o',
  ö: 'o',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ÿ: 'y',
  œ: 'oe',
  æ: 'ae',
};

/** « Développé » → « developpe ». Minuscules, sans accent, sans ponctuation d'espacement. */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[À-ÿŒœ]/g, (char) => FOLDED[char] ?? char)
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filtre la bibliothèque sur ce qui est tapé.
 *
 * Chaque **mot** du terme doit se retrouver dans le nom, dans n'importe quel
 * ordre : « couché barre » trouve « Développé couché à la barre ». Une recherche
 * par sous-chaîne entière ne le ferait pas, et c'est précisément la façon dont on
 * se souvient d'un nom d'exercice — par deux morceaux, rarement dans l'ordre.
 *
 * À égalité, ce qui **commence** par le terme passe devant : « dips » doit sortir
 * « Dips » avant « Dips lestés à la ceinture ».
 */
export function searchExercises(
  library: ExerciseOption[],
  term: string,
  limit: number = SEARCH_LIMIT,
): ExerciseOption[] {
  const needle = fold(term);
  const words = needle.split(' ').filter((word) => word.length > 0);

  if (words.length === 0) {
    return library.slice(0, limit);
  }

  return library
    .map((option) => ({ option, folded: fold(option.name) }))
    .filter(({ folded }) => words.every((word) => folded.includes(word)))
    .sort((a, b) => {
      const starts = Number(b.folded.startsWith(needle)) - Number(a.folded.startsWith(needle));

      if (starts !== 0) {
        return starts;
      }

      // Comparaison brute et non `localeCompare` : les deux chaînes sont déjà
      // repliées en ASCII, et `localeCompare` retomberait lui aussi sur ICU.
      return a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : 0;
    })
    .slice(0, limit)
    .map(({ option }) => option);
}
