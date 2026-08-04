/**
 * Le déroulé d'une séance : le prescrit tel qu'il est descendu, croisé avec le
 * réalisé tel que le téléphone l'écrit (KL-29).
 *
 * Tout ici est **pur**. Aucune lecture de base, aucune écriture : les requêtes
 * vivent dans `queries.ts`, les hooks dans `hooks.ts`, les écritures dans
 * `log.ts`. C'est ce qui permet de vérifier l'appariement — la partie la plus
 * subtile du ticket — sans monter ni React ni SQLite.
 *
 * ## Les rangs de superset sont dérivés, jamais stockés
 *
 * Le serveur envoie `groupLabel` (« A1 », « A2 »), lui-même dérivé de l'ordre par
 * `PlanFlattener` et jamais persisté. Le mobile ne l'analyse pas pour en déduire
 * une structure : il **regroupe les voisins contigus dont le préfixe est égal**,
 * ce que le contrat autorise explicitement (`docs/api-mobile.md §6.7`). Le groupe
 * se dessine ensuite à un rail de gauche, comme le compositeur web — pas par un
 * conteneur qui prétendrait exister dans le modèle.
 *
 * ## L'appariement d'une série réalisée à une ligne prescrite se fait par RANG
 *
 * Et il ne peut pas se faire autrement. Le contrat ne transporte **aucune**
 * référence de la série réalisée vers la ligne prescrite : `sourcePrescribedId`
 * vit sur l'exercice, pas sur la série, et `position` n'est même pas envoyée au
 * serveur (« l'ordre de la liste fait foi, le serveur renumérote », §6.8). La
 * seule règle possible est donc celle que `LogComparator` tient déjà côté serveur
 * (KL-05, décision 3) : **le n-ième réalisé de travail coche la n-ième ligne de
 * travail, l'échauffement comptant dans sa propre file**. Deux files, parce qu'un
 * échauffement prescrit mais non fait — le cas courant — décalerait sinon toutes
 * les séries de travail d'un cran, et une séance tenue se lirait « allégée » de
 * bout en bout.
 *
 * Conséquence assumée, et c'est **la** décision d'ergonomie du ticket : cocher
 * est **séquentiel dans sa file**. Seule la première ligne non cochée est
 * actionnable, seule la dernière cochée se décoche. On ne peut pas cocher la
 * troisième série en laissant les deux premières vides — pas par rigidité, mais
 * parce que cet état ne survivrait pas à un aller-retour serveur : il repartirait
 * du téléphone comme « une série faite », et reviendrait apparié à la première
 * ligne. Mieux vaut une ligne inerte qu'une coche qui se déplace toute seule.
 *
 * ## Ce que le réalisé peut porter et que le prescrit ne prévoit pas
 *
 * Une série de plus qu'annoncé, un exercice hors programme. KL-29 n'en crée
 * aucun — c'est KL-30 qui ouvrira les déviations — mais le pull, lui, peut en
 * descendre. Ils sont donc **affichés** (en lecture) plutôt qu'ignorés : du
 * réalisé invisible serait la pire des trahisons de « rien n'est jamais perdu ».
 */

import type {
  LoggedExerciseRow,
  LoggedSetRow,
  PrescribedBlock,
  PrescribedExerciseLine,
  SetType,
} from '@/db';

/** Les valeurs d'une série, prescrites ou réalisées. Brutes : kg, secondes. */
export interface SetValues {
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
}

/**
 * Une ligne de série, telle que l'écran la peint et la coche.
 *
 * `planned` est `null` pour une série réalisée qu'aucune ligne prescrite ne
 * réclame (une série faite en plus) ; `logged` est `null` tant qu'elle n'est pas
 * cochée. Les deux ne sont jamais nuls en même temps.
 */
export interface SessionSetLine {
  /** Clé de rendu, stable d'un re-rendu à l'autre. */
  key: string;
  /** Rang affiché. Celui du prescrit quand il y en a un, à la suite sinon. */
  index: number;
  /** Le type qui qualifie la ligne : celui du fait quand il existe, du prévu sinon. */
  type: SetType;
  planned: SetValues | null;
  logged: LoggedSetRow | null;
  /** Cochable : c'est la prochaine série de sa file (échauffement ou travail). */
  actionable: boolean;
  /** Décochable : c'est la dernière série cochée de sa file. */
  undoable: boolean;
}

/** Un exercice du programme, avec son réalisé et son avancement. */
export interface SessionExercise {
  prescribed: PrescribedExerciseLine;
  /**
   * Rang de l'exercice dans la séance entière, blocs confondus. C'est la
   * `position` que prend son `logged_exercise` : le document poussé se trie
   * dessus, donc le serveur renumérote dans l'ordre du programme même si les
   * exercices ont été cochés dans le désordre.
   */
  position: number;
  logged: LoggedExerciseRow | null;
  /**
   * Les lignes de série, ou `null` pour un exercice **sans séries à saisir** —
   * course, vélo, AMRAP, for time. Le cardio ne se saisit pas sur le téléphone
   * (règle verrouillée) : il se coche fait / pas fait, et c'est tout.
   */
  lines: SessionSetLine[] | null;
  /** Déclaré sauté (KL-30). Un exercice sauté sort du décompte, il est réglé. */
  skipped: boolean;
  done: number;
  total: number;
}

/**
 * Un exercice isolé, ou un groupe lié dans un bloc.
 *
 * `label` porte le préfixe commun (« A »), jamais le rang complet : celui-là vit
 * sur chaque exercice, dans `prescribed.groupLabel`.
 */
export interface SessionGroup {
  key: string;
  label: string | null;
  exercises: SessionExercise[];
}

/** Une section de la séance. Le bloc est une section, jamais un superset. */
export interface SessionBlock {
  key: string;
  block: PrescribedBlock;
  /** Rang du bloc dans la séance, 1-based. Affiché en « 01 », « 02 ». */
  number: number;
  groups: SessionGroup[];
  done: number;
  total: number;
}

/** Un exercice réalisé qu'aucune ligne du programme ne réclame. Lecture seule. */
export interface SessionExtra {
  logged: LoggedExerciseRow;
  sets: LoggedSetRow[];
}

/** Le déroulé complet d'une séance. */
export interface SessionProgram {
  blocks: SessionBlock[];
  extras: SessionExtra[];
  done: number;
  total: number;
}

/**
 * Croise le programme et le réalisé.
 *
 * `loggedSets` arrive **trié par position** (`loggedSetsOfWorkoutQuery`) : c'est
 * l'ordre dans lequel les séries ont été faites, et c'est celui qui alimente les
 * deux files d'appariement.
 */
export function buildProgram(
  blocks: PrescribedBlock[],
  loggedExercises: LoggedExerciseRow[],
  loggedSets: LoggedSetRow[],
): SessionProgram {
  const setsByExercise = new Map<number, LoggedSetRow[]>();

  for (const set of loggedSets) {
    const list = setsByExercise.get(set.loggedExerciseId) ?? [];
    list.push(set);
    setsByExercise.set(set.loggedExerciseId, list);
  }

  const bySource = new Map<number, LoggedExerciseRow>();

  for (const logged of loggedExercises) {
    if (logged.sourcePrescribedId !== null && !bySource.has(logged.sourcePrescribedId)) {
      bySource.set(logged.sourcePrescribedId, logged);
    }
  }

  const matched = new Set<number>();
  const sessionBlocks: SessionBlock[] = [];
  let position = 0;
  let done = 0;
  let total = 0;

  blocks.forEach((block, blockIndex) => {
    const exercises: SessionExercise[] = block.exercises.map((prescribed) => {
      const logged = bySource.get(prescribed.prescribedId) ?? null;

      if (logged) {
        matched.add(logged.id);
      }

      const exercise = buildExercise(
        prescribed,
        position,
        logged,
        logged ? (setsByExercise.get(logged.id) ?? []) : [],
      );

      position += 1;

      return exercise;
    });

    const blockDone = exercises.reduce((sum, exercise) => sum + exercise.done, 0);
    const blockTotal = exercises.reduce((sum, exercise) => sum + exercise.total, 0);

    done += blockDone;
    total += blockTotal;

    sessionBlocks.push({
      // L'identifiant de bloc peut manquer côté API (`id` y est nullable) : le
      // rang, lui, existe toujours et ne change pas d'un rendu à l'autre.
      key: `b${block.id ?? blockIndex}`,
      block,
      number: blockIndex + 1,
      groups: groupExercises(exercises),
      done: blockDone,
      total: blockTotal,
    });
  });

  const extras: SessionExtra[] = loggedExercises
    .filter((logged) => !matched.has(logged.id))
    .map((logged) => ({ logged, sets: setsByExercise.get(logged.id) ?? [] }));

  return { blocks: sessionBlocks, extras, done, total };
}

function buildExercise(
  prescribed: PrescribedExerciseLine,
  position: number,
  logged: LoggedExerciseRow | null,
  sets: LoggedSetRow[],
): SessionExercise {
  const skipped = logged?.skipped ?? false;
  // Les lignes se construisent même pour un exercice sauté : ses séries
  // abandonnées existent peut-être, et le prescrit reste à lire.
  const lines = buildLines(prescribed, sets);

  if (skipped) {
    // Un exercice sauté est **réglé**, pas en attente : le laisser dans le
    // dénominateur ferait une progression qui ne peut plus atteindre son terme.
    return { prescribed, position, logged, lines, skipped, done: 0, total: 0 };
  }

  if (lines === null) {
    // Cardio : une seule chose à dire, fait ou pas fait.
    return { prescribed, position, logged, lines, skipped, done: logged ? 1 : 0, total: 1 };
  }

  const plannedCount = lines.filter((line) => line.planned !== null).length;
  const loggedCount = lines.filter((line) => line.logged !== null).length;

  return {
    prescribed,
    position,
    logged,
    lines,
    skipped,
    done: loggedCount,
    // Le maximum des deux : une série faite en plus (KL-30) ne doit pas produire
    // un « 5 sur 4 », qui se lirait comme une erreur de compte.
    total: Math.max(plannedCount, loggedCount),
  };
}

/**
 * Aligne les séries réalisées sur les lignes prescrites, file par file.
 *
 * Rend `null` quand l'exercice n'a pas de séries à saisir : c'est la marque du
 * cardio, et elle vient du serveur (`sets: null` pour un type de prescription qui
 * ne compte pas de séries). On ne la déduit pas du type de prescription — un seul
 * fait, une seule source.
 */
function buildLines(
  prescribed: PrescribedExerciseLine,
  sets: LoggedSetRow[],
): SessionSetLine[] | null {
  if (prescribed.sets === null) {
    return null;
  }

  const queues = {
    warmup: sets.filter((set) => set.type === 'warmup'),
    work: sets.filter((set) => set.type !== 'warmup'),
  };
  const ranks = { warmup: 0, work: 0 };

  const lines: SessionSetLine[] = prescribed.sets.map((line) => {
    const file = line.type === 'warmup' ? 'warmup' : 'work';
    const queue = queues[file];
    const rank = ranks[file];
    ranks[file] += 1;

    const logged = queue[rank] ?? null;

    return {
      key: `p${prescribed.prescribedId}-${line.index}`,
      index: line.index,
      // Le type de ce qui a été fait prime, comme dans le tableau du web : une
      // série passée à l'échec reste une série à l'échec.
      type: logged?.type ?? line.type,
      planned: {
        reps: line.reps,
        weightKg: line.weightKg,
        durationSeconds: line.durationSeconds,
      },
      logged,
      actionable: logged === null && rank === queue.length,
      undoable: logged !== null && rank === queue.length - 1,
    };
  });

  // Ce que le prescrit ne réclame pas : les séries faites en trop, à la suite.
  let index = lines.length > 0 ? lines[lines.length - 1].index : 0;

  for (const file of ['warmup', 'work'] as const) {
    for (const set of queues[file].slice(ranks[file])) {
      index += 1;

      lines.push({
        key: `l${set.uuid}`,
        index,
        type: set.type,
        planned: null,
        logged: set,
        actionable: false,
        undoable: set.uuid === queues[file][queues[file].length - 1].uuid,
      });
    }
  }

  return lines;
}

/**
 * Regroupe les exercices liés d'un bloc.
 *
 * Un groupe, ce sont des **voisins contigus** dont le libellé partage le même
 * préfixe. La contiguïté est la moitié de la règle : le compositeur web tient
 * l'invariant « membres contigus en position » (`SupersetGrouper`), et deux
 * groupes du même bloc peuvent porter des lettres différentes (A1/A2 puis
 * B1/B2/B3). Une lecture par lettre seule recollerait des groupes séparés.
 */
function groupExercises(exercises: SessionExercise[]): SessionGroup[] {
  const groups: SessionGroup[] = [];

  for (const exercise of exercises) {
    const prefix = groupPrefix(exercise.prescribed.groupLabel);
    const current = groups[groups.length - 1];

    if (prefix !== null && current && current.label === prefix) {
      current.exercises.push(exercise);

      continue;
    }

    groups.push({
      key: `g${exercise.prescribed.prescribedId}`,
      label: prefix,
      exercises: [exercise],
    });
  }

  return groups;
}

/**
 * « A1 » → « A ». Le rang chiffré se retire, le reste est le groupe.
 *
 * C'est de l'**égalité de préfixe**, pas de l'analyse : on ne déduit rien de la
 * lettre elle-même (ni un ordre, ni une profondeur), on se contente de savoir que
 * deux voisins appartiennent au même enchaînement. Le contrat ne promet rien de
 * plus.
 */
function groupPrefix(label: string | null): string | null {
  if (label === null) {
    return null;
  }

  const prefix = label.replace(/\d+$/, '');

  return prefix.length > 0 ? prefix : null;
}
