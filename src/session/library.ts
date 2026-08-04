/**
 * La recherche dans la bibliothèque locale (KL-30, facettes en KL-34).
 *
 * Elle sert à remplacer un exercice, à en ajouter un que le programme ne
 * prévoyait pas, et — depuis la séance vierge — à **garnir une séance qui part
 * de rien**. Tout est **pur** ici : la lecture est une requête vive
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
 *
 * Les zones, elles, seraient de toute façon inatteignables en SQL : elles vivent
 * dans une colonne JSON, et les chercher demanderait `json_each` — donc
 * l'extension json1 sur tous les Android visés, que le projet refuse de supposer
 * (`sync/queue.ts`).
 *
 * ## Facette et frappe ne font pas le même travail (KL-34)
 *
 * Le **nom** se cherche au clavier, l'**activité** et la **zone** se choisissent.
 * C'est la différence entre « je sais ce que je veux » et « je cherche quoi
 * faire », et la séance vierge est le seul écran où la seconde question se pose
 * vraiment : rien n'est prévu, on part de la zone qu'on veut travailler.
 *
 * Les zones n'entrent donc **pas** dans le texte cherché, contrairement au web
 * (`data-filter-text` y recopie les libellés de zone) : là-bas elles sont le seul
 * chemin possible, faute de facette ; ici la facette existe, et deux chemins pour
 * le même fait finissent par se contredire.
 */

import type { ActivityType, TargetArea } from '@/db';

/** Un exercice de la bibliothèque, tel que le sélecteur le montre. */
export interface ExerciseOption {
  id: number;
  name: string;
  /** Exercice de l'app (par opposition à un exercice perso). Marqué à l'écran. */
  global: boolean;
  activity: ActivityType;
  /** Toujours un tableau, jamais `null` — l'API garantit `[]` (`db/schema.ts`). */
  targetAreas: TargetArea[];
}

/**
 * L'ordre dans lequel les facettes se présentent : celui de **déclaration des
 * enums serveur**, jamais l'alphabétique ni la fréquence.
 *
 * Deux raisons. C'est l'ordre du web, et une facette qui se réordonne d'un écran
 * à l'autre se re-cherche à chaque ouverture. Et pour les zones, cet ordre est
 * déjà **anatomique** — haut du corps, tronc, bas du corps, corps entier, le
 * regroupement que `TargetRegion` formalise côté serveur : « Pectoraux » voisine
 * « Dos », pas « Quadriceps ».
 */
const ACTIVITY_ORDER: ActivityType[] = [
  'gym',
  'running',
  'swimming',
  'cycling',
  'mobility',
  'other',
];

const AREA_ORDER: TargetArea[] = [
  'chest',
  'back',
  'lower_back',
  'traps',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'glutes',
  'quadriceps',
  'hamstrings',
  'adductors',
  'calves',
  'shins',
  'full_body',
];

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

/**
 * Restreint la bibliothèque à une activité et à une zone (KL-34).
 *
 * `null` des deux côtés est le cas normal : c'est « toutes », et la liste
 * ressort intacte. Les deux critères se **cumulent** — « Salle de sport » et
 * « Dos » veut dire les deux, pas l'un ou l'autre.
 *
 * Un exercice sans zone déclarée ne répond à aucune facette de zone. Ce n'est
 * pas un oubli : la facette dit « travaille ça », et un exercice qui ne dit rien
 * de ce qu'il travaille ne peut pas le promettre.
 */
export function filterLibrary(
  library: ExerciseOption[],
  activity: ActivityType | null,
  area: TargetArea | null,
): ExerciseOption[] {
  if (activity === null && area === null) {
    return library;
  }

  return library.filter(
    (option) =>
      (activity === null || option.activity === activity) &&
      (area === null || option.targetAreas.includes(area)),
  );
}

/**
 * Les activités que la bibliothèque porte vraiment, dans l'ordre canonique.
 *
 * **Dérivées de son contenu, pas de l'enum** : proposer « Natation » à qui n'a
 * aucun exercice de natation offre un filtre dont la seule issue est une liste
 * vide. La facette décrit ce qu'il y a, elle n'annonce pas ce qui pourrait être.
 */
export function libraryActivities(library: ExerciseOption[]): ActivityType[] {
  const present = new Set(library.map((option) => option.activity));

  return ACTIVITY_ORDER.filter((activity) => present.has(activity));
}

/** Les zones présentes dans la bibliothèque, dans l'ordre anatomique. Même règle. */
export function libraryAreas(library: ExerciseOption[]): TargetArea[] {
  const present = new Set(library.flatMap((option) => option.targetAreas));

  return AREA_ORDER.filter((area) => present.has(area));
}
