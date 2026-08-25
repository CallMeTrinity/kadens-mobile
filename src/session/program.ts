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
 * Une série de plus qu'annoncé, un exercice hors programme. Le pull peut en
 * descendre, et **KL-30 en crée** : ajouter une série, ajouter un exercice non
 * prévu. Ils sont donc des lignes comme les autres — du réalisé invisible serait
 * la pire des trahisons de « rien n'est jamais perdu ».
 *
 * S'y ajoute une ligne qui n'est **ni prescrite ni réalisée** : la série qu'on
 * annonce avant de la faire (`withDraftSets`, plus bas). Elle ne vit qu'en
 * mémoire, le temps du rendu, et disparaît en devenant du réalisé.
 *
 * Et une **valeur** de la même nature : la correction posée sur une série pas
 * encore faite (`withPlannedOverrides`, plus bas). Même statut, même durée de
 * vie — rien en base tant que la série n'est pas cochée.
 *
 * ## L'ordre du programme, et celui dans lequel on l'a mené (KL-52)
 *
 * Les deux ne sont plus le même depuis `withExecutionOrder` (plus bas). Le
 * premier reste intouchable — c'est `prescribed_snapshot`, remplacé en entier à
 * chaque pull, et `position`, sur laquelle le document poussé se trie. Le second
 * est **local au téléphone**, ne part jamais au serveur, et ne sert qu'à deux
 * choses : l'ordre d'affichage et ce que la barre basse propose. Une séance ne
 * se passe pas comme prévu, l'alternance d'un superset n'aide que si on est dans
 * l'ordre qu'elle suppose.
 *
 * ## Un seul type d'exercice, prescrit ou non (KL-30)
 *
 * `SessionExercise.prescribed` est **nullable** depuis que l'app sait ajouter un
 * exercice hors programme. C'est ce qui évite le piège où KL-29 était tombé
 * volontairement : un second type « exercice réalisé sans ligne en face » aurait
 * demandé un second composant d'affichage, un second chemin d'écriture, une
 * seconde façon de compter — pour décrire la même chose. Les deux moitiés ne sont
 * jamais nulles ensemble : un exercice de séance vient du programme, du réalisé,
 * ou des deux.
 */

import type {
  LoggedExerciseRow,
  LoggedSetRow,
  PrescribedBlock,
  PrescribedExerciseLine,
  PrescribedSetLine,
  SetType,
} from '@/db';

import { EMPTY_NAME_BOOK, referenceLabel, type ExerciseNameBook } from './naming';

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
  /**
   * Les valeurs corrigées **avant** de faire la série, projetées par
   * `withPlannedOverrides`. `null` dans le cas courant : on fait ce qui est
   * écrit. Ni prescrit ni réalisé, donc rien en base — c'est ce que la ligne
   * consignera quand on la cochera, et ce qu'elle affiche en attendant.
   */
  override: SetValues | null;
  logged: LoggedSetRow | null;
  /** Cochable : c'est la prochaine série de sa file (échauffement ou travail). */
  actionable: boolean;
  /** Décochable : c'est la dernière série cochée de sa file. */
  undoable: boolean;
  /**
   * Série **ajoutée en séance et pas encore faite** (§ la série en plus, plus
   * bas). Elle n'existe qu'en mémoire : ni prescrit, ni réalisé, donc rien en
   * base. La cocher la consigne comme n'importe quelle autre.
   */
  draft: boolean;
}

/** Un exercice de la séance : prescrit, réalisé, ou les deux. */
export interface SessionExercise {
  /** Clé de rendu, stable d'un re-rendu à l'autre. */
  key: string;
  /** `null` pour un exercice **hors programme** — ajouté en séance, ou descendu par le pull. */
  prescribed: PrescribedExerciseLine | null;
  /**
   * Rang de l'exercice dans la séance entière, blocs confondus. C'est la
   * `position` que prend son `logged_exercise` : le document poussé se trie
   * dessus, donc le serveur renumérote dans l'ordre du programme même si les
   * exercices ont été cochés dans le désordre.
   */
  position: number;
  logged: LoggedExerciseRow | null;
  /** Le nom à afficher : celui du réalisé quand il diverge (remplacement), du prescrit sinon. */
  name: string;
  /**
   * Le réalisé porte un **autre** exercice que celui prescrit : il a été remplacé
   * en séance (KL-30). Le prescrit reste affiché à côté, sinon l'écart disparaît.
   */
  substituted: boolean;
  /**
   * Le rang dans son enchaînement — « A1 », « A2 » — ou `null` s'il est mené seul.
   *
   * Il vient du serveur par défaut (`prescribed.groupLabel`), et c'est le seul
   * cas où l'exercice et sa ligne du programme disent la même chose. Dès qu'un
   * **ordre d'exécution local** est posé (KL-52, `withExecutionOrder`), il est
   * recalculé : les enchaînements sont alors ceux qu'on a menés, pas ceux qui
   * étaient prévus, et lire `prescribed.groupLabel` afficherait l'ancien.
   */
  groupLabel: string | null;
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
 * sur chaque exercice, dans `groupLabel`.
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

/** Le déroulé complet d'une séance. */
export interface SessionProgram {
  blocks: SessionBlock[];
  /** Le réalisé qu'aucune ligne du programme ne réclame. Éditable comme le reste (KL-30). */
  extras: SessionExercise[];
  /**
   * Combien de lignes le programme compte, tous blocs confondus.
   *
   * C'est le plancher de position d'un exercice ajouté hors programme : sans lui,
   * un exercice ajouté avant qu'aucun prescrit ne soit coché prendrait la position
   * 0 et passerait devant tout le programme dans le document poussé.
   */
  prescribedCount: number;
  /**
   * Un **ordre d'exécution local** est appliqué (KL-52). Les rangs
   * d'enchaînement affichés sont alors calculés ici, pas descendus du serveur.
   */
  reordered: boolean;
  done: number;
  total: number;
}

/**
 * Croise le programme et le réalisé.
 *
 * `loggedSets` arrive **trié par position** (`loggedSetsOfWorkoutQuery`) : c'est
 * l'ordre dans lequel les séries ont été faites, et c'est celui qui alimente les
 * deux files d'appariement.
 *
 * `names` est l'annuaire des libellés de la bibliothèque locale, dans la langue
 * du compte (`naming.ts`). Son défaut — l'annuaire **vide** — n'est pas un mode
 * dégradé qu'on subit : c'est exactement l'état d'une séance dont les exercices
 * ont quitté la bibliothèque, et il retombe alors sur les noms transportés, ce
 * que faisait tout le fichier avant qu'il y ait deux langues.
 */
export function buildProgram(
  blocks: PrescribedBlock[],
  loggedExercises: LoggedExerciseRow[],
  loggedSets: LoggedSetRow[],
  names: ExerciseNameBook = EMPTY_NAME_BOOK,
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
        names,
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

  // Le réalisé qu'aucune ligne du programme ne réclame. Même type que les autres
  // (§ un seul type d'exercice) : il s'affiche, se complète et se retire pareil.
  const extras: SessionExercise[] = loggedExercises
    .filter((logged) => !matched.has(logged.id))
    .map((logged) =>
      buildExercise(null, logged.position, logged, setsByExercise.get(logged.id) ?? [], names),
    );

  return {
    blocks: sessionBlocks,
    extras,
    prescribedCount: position,
    reordered: false,
    done,
    total,
  };
}

function buildExercise(
  prescribed: PrescribedExerciseLine | null,
  position: number,
  logged: LoggedExerciseRow | null,
  sets: LoggedSetRow[],
  names: ExerciseNameBook,
): SessionExercise {
  const skipped = logged?.skipped ?? false;
  // Le réalisé porte-t-il un autre exercice que le prescrit ? On compare les
  // **références**, pas les noms : un exercice renommé en bibliothèque n'est pas
  // un remplacement. Les deux références absentes valent égalité (`-1`), c'est le
  // cas d'un exercice sorti de la bibliothèque des deux côtés.
  const substituted =
    prescribed !== null &&
    logged !== null &&
    (logged.exerciseId ?? -1) !== (prescribed.exerciseId ?? -1);
  // Les lignes se construisent même pour un exercice sauté : ses séries
  // abandonnées existent peut-être, et le prescrit reste à lire. Un exercice hors
  // programme n'a aucune ligne prescrite, donc une liste vide — et **pas** `null`,
  // qui est la marque du cardio.
  const lines = buildLines(prescribed === null ? [] : prescribed.sets, sets);
  const base = {
    key: prescribed ? `e${prescribed.prescribedId}` : `x${logged?.id ?? position}`,
    prescribed,
    position,
    logged,
    name: exerciseName(prescribed, logged, substituted, names),
    substituted,
    groupLabel: prescribed?.groupLabel ?? null,
    lines,
    skipped,
  };

  if (skipped) {
    // Un exercice sauté est **réglé**, pas en attente : le laisser dans le
    // dénominateur ferait une progression qui ne peut plus atteindre son terme.
    return { ...base, done: 0, total: 0 };
  }

  if (prescribed === null) {
    // Hors programme : il ne **réclame** rien, donc il n'entre ni au numérateur ni
    // au dénominateur. La progression dit ce qu'il reste à faire du programme ;
    // trois séries ajoutées ne rapprochent pas de sa fin, elles s'ajoutent à côté.
    return { ...base, done: 0, total: 0 };
  }

  if (lines === null) {
    // Cardio : une seule chose à dire, fait ou pas fait.
    return { ...base, done: logged ? 1 : 0, total: 1 };
  }

  const plannedCount = lines.filter((line) => line.planned !== null).length;
  const loggedCount = lines.filter((line) => line.logged !== null).length;

  return {
    ...base,
    done: loggedCount,
    // Le maximum des deux : une série faite en plus (KL-30) ne doit pas produire
    // un « 5 sur 4 », qui se lirait comme une erreur de compte.
    total: Math.max(plannedCount, loggedCount),
  };
}

/**
 * Le nom affiché.
 *
 * Deux questions, dans cet ordre. **Laquelle des deux moitiés parle** : le
 * prescrit prime tant qu'il n'a pas été remplacé ; dès qu'il y a remplacement —
 * ou qu'il n'y a pas de prescrit — c'est le réalisé qui dit ce qui a été fait.
 * Puis **sous quel libellé** : la bibliothèque locale d'abord, dans la langue du
 * compte (`naming.ts`), et le nom transporté seulement si l'exercice n'y est
 * plus. Les deux noms qui voyagent — `prescribed.name` et `logged.exerciseName`
 * — sont français par construction : le premier est le nom vivant à l'heure du
 * pull, le second un snapshot pris à la séance.
 */
function exerciseName(
  prescribed: PrescribedExerciseLine | null,
  logged: LoggedExerciseRow | null,
  substituted: boolean,
  names: ExerciseNameBook,
): string {
  if (substituted || prescribed === null) {
    return referenceLabel(names, logged?.exerciseId, logged?.exerciseName ?? null) ?? 'Exercice';
  }

  return (
    referenceLabel(names, prescribed.exerciseId, prescribed.name) ??
    logged?.exerciseName ??
    'Exercice retiré de la bibliothèque'
  );
}

/**
 * Aligne les séries réalisées sur les lignes prescrites, file par file.
 *
 * Rend `null` quand l'exercice n'a pas de séries à saisir : c'est la marque du
 * cardio, et elle vient du serveur (`sets: null` pour un type de prescription qui
 * ne compte pas de séries). On ne la déduit pas du type de prescription — un seul
 * fait, une seule source.
 *
 * Une liste prescrite **vide** n'est pas la même chose : c'est un exercice hors
 * programme, dont toutes les séries sont surnuméraires par construction.
 */
function buildLines(
  prescribedSets: PrescribedSetLine[] | null,
  sets: LoggedSetRow[],
): SessionSetLine[] | null {
  if (prescribedSets === null) {
    return null;
  }

  const queues = {
    warmup: sets.filter((set) => set.type === 'warmup'),
    work: sets.filter((set) => set.type !== 'warmup'),
  };
  const ranks = { warmup: 0, work: 0 };

  const lines: SessionSetLine[] = prescribedSets.map((line) => {
    const file = line.type === 'warmup' ? 'warmup' : 'work';
    const queue = queues[file];
    const rank = ranks[file];
    ranks[file] += 1;

    const logged = queue[rank] ?? null;

    return {
      // Une clé React n'a besoin d'être unique qu'entre frères : les lignes d'un
      // exercice ne côtoient jamais celles d'un autre.
      key: `p${line.index}`,
      index: line.index,
      // Le type de ce qui a été fait prime, comme dans le tableau du web : une
      // série passée à l'échec reste une série à l'échec.
      type: logged?.type ?? line.type,
      planned: {
        reps: line.reps,
        weightKg: line.weightKg,
        durationSeconds: line.durationSeconds,
      },
      override: null,
      logged,
      actionable: logged === null && rank === queue.length,
      undoable: logged !== null && rank === queue.length - 1,
      draft: false,
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
        override: null,
        logged: set,
        actionable: false,
        undoable: set.uuid === queues[file][queues[file].length - 1].uuid,
        draft: false,
      });
    }
  }

  return lines;
}

/**
 * La clé d'une série dans la séance entière : celle de son exercice, puis la
 * sienne.
 *
 * Une clé de ligne n'est unique **qu'entre frères** (`p1`, `l{uuid}`, `d{clé}`)
 * — c'est tout ce qu'une clé React demande, et le déroulé n'a jamais eu besoin
 * de plus. Corriger une série avant de la faire, si : l'écran retient ces
 * corrections dans une table, et deux exercices y auraient tous les deux une
 * « série 1 ». La composée est stable dans les trois cas : le rang prescrit ne
 * bouge pas, l'uuid d'une série faite non plus, et un brouillon en porte un seul
 * par exercice.
 */
export function lineKey(exercise: SessionExercise, line: SessionSetLine): string {
  return `${exercise.key}/${line.key}`;
}

/**
 * Retrouve une série par sa clé composée. C'est ce que les feuilles de l'écran
 * retiennent — jamais l'objet, qui décrirait la séance d'avant la dernière
 * écriture.
 */
export function findLine(
  program: SessionProgram,
  key: string,
): { exercise: SessionExercise; line: SessionSetLine } | null {
  for (const exercise of allExercises(program)) {
    const line = exercise.lines?.find((candidate) => lineKey(exercise, candidate) === key);

    if (line) {
      return { exercise, line };
    }
  }

  return null;
}

/**
 * Les valeurs qu'une ligne **affiche et consignera** : le fait s'il existe, la
 * correction posée d'avance sinon, le prescrit en dernier.
 *
 * Un seul endroit décide de cet ordre, et c'est ce qui fait que la ligne, la
 * barre basse et l'écriture disent tous la même chose. Le prescrit ne disparaît
 * pas pour autant — il reste lisible à côté (`setDeviates`), parce que c'est
 * l'écart, et que c'est la seule chose que la ligne ne peut pas taire.
 */
export function lineValues(line: SessionSetLine): SetValues | null {
  return line.logged ?? line.override ?? line.planned;
}

/**
 * Corriger une série **avant** de la faire (« tous les poids d'un coup »).
 *
 * ## Pourquoi ça n'est pas une déviation, et pourquoi rien n'est en base
 *
 * « On ne dévie que sur ce qui a été fait » (`deviations.ts`) reste vrai mot pour
 * mot : le prescrit ne bouge pas — `prescribed_snapshot` est remplacé en entier
 * au pull suivant, il n'a aucun endroit où accueillir « la série 3 se fera à
 * 82,5 kg » — et le réalisé n'existe pas avant d'être coché. Ce qui manquait
 * n'était pas une colonne, c'était un endroit **hors base** : la barre est
 * chargée à 82,5 kg pour les quatre séries, on le sait avant de commencer, et
 * cocher-puis-corriger quatre fois est quatre allers-retours pour un seul fait.
 *
 * Ces valeurs vivent donc exactement où vit la série en brouillon
 * (`withDraftSets`) : dans l'écran, projetées sur le déroulé le temps du rendu.
 * Conséquence assumée et identique : l'app tuée avec des corrections en attente
 * les perd — elles ne portaient aucune information, seulement une intention.
 * Elles s'écrivent au moment où la série est cochée, par la voie normale
 * (`checkSet`), et disparaissent en devenant du réalisé.
 *
 * ## Ce qu'elle ne touche pas
 *
 * Une série **faite** : elle a sa feuille d'ajustement, qui écrit en base
 * (`updateSet`). Une correction posée d'avance sur une ligne déjà cochée serait
 * une seconde vérité sur le même fait.
 */
export function withPlannedOverrides(
  program: SessionProgram,
  overrides: ReadonlyMap<string, SetValues>,
): SessionProgram {
  if (overrides.size === 0) {
    return program;
  }

  const corrected = (exercise: SessionExercise): SessionExercise => {
    const lines = exercise.lines;

    if (lines === null) {
      return exercise;
    }

    let touched = false;
    const next = lines.map((line) => {
      const override =
        line.logged === null ? (overrides.get(lineKey(exercise, line)) ?? null) : null;

      if (override === null) {
        return line;
      }

      touched = true;

      return { ...line, override };
    });

    return touched ? { ...exercise, lines: next } : exercise;
  };

  return {
    ...program,
    blocks: program.blocks.map((block) => ({
      ...block,
      groups: block.groups.map((group) => ({
        ...group,
        exercises: group.exercises.map(corrected),
      })),
    })),
    extras: program.extras.map(corrected),
  };
}

/**
 * La série en plus : ajoutée d'abord, cochée ensuite (KL-39 bis).
 *
 * « + Série » ne consigne plus rien (c'était le défaut d'ergonomie : la série
 * naissait **faite**, avant d'avoir été faite, et le repos partait avec). Elle
 * pose maintenant une ligne cochable de plus, pré-remplie par la précédente, qui
 * se valide comme les autres — à la ligne, ou à la barre basse.
 *
 * ## Elle ne va pas en base, et c'est le point
 *
 * Une série non faite n'est **ni du prescrit ni du réalisé** : le prescrit ne
 * bouge jamais (`deviations.ts`, § en-tête) et le réalisé décrit ce qui a eu
 * lieu. Il n'existe donc aucune colonne où l'écrire, et en inventer une ferait
 * partir au serveur une série qu'on n'a pas faite. Le brouillon vit dans l'écran,
 * qui en tient les clés, et cette fonction le **projette** sur le déroulé le
 * temps du rendu. Conséquence assumée : l'app tuée avec un brouillon en attente
 * le perd — il ne portait aucune information, seulement une intention.
 *
 * ## Ce qu'il ne change pas
 *
 * Les compteurs. `done`/`total` disent ce que le **programme** réclame et ce qui
 * y répond ; une série qu'on décide d'ajouter n'ajoute rien à ce que le programme
 * demande. Elle entre dans les compteurs au moment où elle est cochée, par la
 * voie normale (`Math.max(plannedCount, loggedCount)`, plus haut).
 */
export function withDraftSets(program: SessionProgram, keys: ReadonlySet<string>): SessionProgram {
  if (keys.size === 0) {
    return program;
  }

  const draft = (exercise: SessionExercise): SessionExercise => {
    const line = keys.has(exercise.key) ? draftLineFor(exercise) : null;

    return line === null ? exercise : { ...exercise, lines: [...(exercise.lines ?? []), line] };
  };

  return {
    ...program,
    blocks: program.blocks.map((block) => ({
      ...block,
      groups: block.groups.map((group) => ({ ...group, exercises: group.exercises.map(draft) })),
    })),
    extras: program.extras.map(draft),
  };
}

/**
 * La ligne en brouillon de cet exercice, ou `null` s'il n'y a pas lieu.
 *
 * Trois refus, tous repris du geste d'origine (`addSet`) : un cardio ne se
 * saisit pas, un exercice sauté est réglé, et une ligne du programme qui attend
 * encore **est** la prochaine série — en ajouter une par-dessus donnerait deux
 * cibles pour un seul fait.
 */
function draftLineFor(exercise: SessionExercise): SessionSetLine | null {
  const lines = exercise.lines;

  if (lines === null || exercise.skipped || lines.some((line) => line.actionable)) {
    return null;
  }

  return {
    // Une seule ligne en brouillon par exercice : la clé n'a pas à être numérotée.
    key: `d${exercise.key}`,
    index: (lines[lines.length - 1]?.index ?? 0) + 1,
    // Toujours de travail. Le type décide de la file d'appariement : un
    // échauffement ajouté après coup décalerait la lecture de toute la séance.
    type: 'normal',
    planned: draftSetValues(exercise),
    override: null,
    logged: null,
    actionable: true,
    undoable: false,
    draft: true,
  };
}

/**
 * Les valeurs d'une série ajoutée : la dernière faite, sinon la dernière prescrite.
 *
 * L'échauffement est écarté des deux côtés — une série ajoutée est une série de
 * travail, la pré-remplir avec la barre à vide serait le pire des défauts.
 */
export function draftSetValues(exercise: SessionExercise): SetValues {
  const empty: SetValues = { reps: null, weightKg: null, durationSeconds: null };
  const lines = exercise.lines ?? [];
  const work = lines.filter((line) => line.type !== 'warmup' && !line.draft);
  const lastLogged = [...work].reverse().find((line) => line.logged !== null)?.logged;

  if (lastLogged) {
    return {
      reps: lastLogged.reps,
      weightKg: lastLogged.weightKg,
      durationSeconds: lastLogged.durationSeconds,
    };
  }

  return [...work].reverse().find((line) => line.planned !== null)?.planned ?? empty;
}

/**
 * L'ordre d'exécution local, tel que la base le retient : rang et enchaînement,
 * par clé d'exercice (KL-52).
 */
export interface ExecutionSlot {
  position: number;
  /** L'enchaînement local. Deux **voisins** qui le partagent forment un superset. */
  chain: number | null;
  /**
   * La file où l'exercice est mené : la clé d'un bloc, ou `EXTRAS_LANE`.
   *
   * `null` = celle du programme. C'est le cas d'un exercice qu'on n'a jamais
   * sorti de son bloc, et celui de tout ordre écrit avant que les files se
   * traversent : les deux se lisent pareil, sans migration.
   */
  lane: string | null;
}

/** L'ordre d'exécution d'une séance entière. Vide = celui du programme. */
export type ExecutionOrder = ReadonlyMap<string, ExecutionSlot>;

/**
 * Réordonne le déroulé selon l'ordre d'exécution local (KL-52).
 *
 * ## Ce que ça change, et ce que ça ne change pas
 *
 * Une séance ne se passe pas comme prévu : la machine de A2 est prise, le
 * finisseur passe avant, le superset se mène autrement. Sans cette projection,
 * la barre basse continue de proposer ce que le programme annonçait —
 * l'alternance d'un superset (`nextTarget`) n'aide que si on est dans l'ordre
 * qu'elle suppose, et travaille contre soi sinon. C'est le seul défaut qu'elle
 * corrige, et c'est pour ça qu'elle est ici, dans le déroulé, plutôt que dans un
 * réglage de la barre.
 *
 * **Le prescrit ne bouge pas pour autant.** Rien n'est réécrit dans
 * `prescribed_snapshot`, rien ne part au serveur : `position` — celle que
 * `logged_exercise` prend et sur laquelle le document poussé se trie — est
 * conservée telle quelle, donc le web continue de lire la séance dans l'ordre du
 * programme. « On dévie, on ne recompose pas » (`deviations.ts`) tient : ceci
 * n'est pas une recomposition du programme, c'est l'ordre dans lequel il a été
 * mené, et il ne vit que sur ce téléphone.
 *
 * ## Trois règles, et elles se déduisent toutes de la contiguïté
 *
 * 1. **Une file est une destination, pas une frontière**. Un exercice se range
 *    dans le bloc où il est mené, et ce bloc n'est pas forcément le sien : le
 *    gainage d'échauffement qu'on fait après le squat s'affiche sous
 *    « Entraînement », parce que c'est là qu'il a lieu. `slot.lane` porte cette
 *    destination ; sans elle, l'exercice reste dans sa file de programme.
 * 2. **Un enchaînement est fait de voisins**, exactement comme les `groupLabel`
 *    du serveur. C'est ce qui permet à un exercice qu'on déplace hors de son
 *    groupe de s'en détacher tout seul, sans qu'aucune écriture ait à le prévoir.
 * 3. **Les rangs affichés sont recalculés**, pour toute la séance et pas
 *    seulement pour ce qu'on a touché. Garder « A1 » sur un exercice que son
 *    voisin a quitté afficherait un enchaînement qui n'existe plus ; mélanger
 *    des lettres du serveur et des lettres locales serait pire encore.
 *
 * Une clé absente de l'ordre — un exercice que le coach vient d'ajouter, un
 * hors-programme posé après coup — retombe sur son rang de programme
 * (`exercise.position`), donc à sa place naturelle parmi ceux qui n'ont pas
 * bougé. Rien à réparer, rien à migrer.
 *
 * ## Ce que changer de bloc ne change pas
 *
 * Le rôle du bloc ne **classe** rien : il titre une section, et c'est tout ce
 * qu'il fait ici comme ailleurs (`labels.ts`). Le volume se compte sur le type
 * de chaque série (`summary.ts`, `areas.ts`), jamais sur la section qui la
 * porte, donc un exercice posé sous « Échauffement » ne devient pas de
 * l'échauffement — il est mené là, il compte pareil. Les compteurs du bloc, eux,
 * suivent ce qu'il contient vraiment : ils sont recalculés ici.
 *
 * Une file que plus rien ne désigne — le coach a retiré le bloc entre deux
 * pulls — rend ses exercices à leur file de programme plutôt que de les faire
 * disparaître de l'écran : du réalisé invisible serait pire qu'un rangement
 * perdu.
 */
export function withExecutionOrder(program: SessionProgram, order: ExecutionOrder): SessionProgram {
  if (order.size === 0) {
    return program;
  }

  const laneContents = byLane(program, order);

  const sorted = (exercises: SessionExercise[]): SessionExercise[] =>
    [...exercises].sort(
      (a, b) =>
        (order.get(a.key)?.position ?? a.position) - (order.get(b.key)?.position ?? b.position),
    );

  // Les lettres se distribuent sur la séance entière, pas bloc par bloc : c'est
  // ce que fait le serveur (`PlanFlattener`), et deux blocs qui rouvriraient
  // chacun sur « A » se liraient comme un seul enchaînement coupé en deux.
  const letters = new Letters();
  const relabel = (exercises: SessionExercise[]): SessionExercise[] =>
    chains(exercises, order).flatMap((run) => {
      const label = run.length > 1 ? letters.next() : null;

      return run.map((exercise, rank) => ({
        ...exercise,
        groupLabel: label === null ? null : `${label}${rank + 1}`,
      }));
    });

  const contentsOf = (lane: string): SessionExercise[] =>
    relabel(sorted(laneContents.get(lane) ?? []));

  return {
    ...program,
    reordered: true,
    blocks: program.blocks.map((block) => {
      const exercises = contentsOf(block.key);

      return {
        ...block,
        groups: groupExercises(exercises),
        // Recalculés, et pas repris du programme : le bloc compte ce qu'il
        // contient maintenant, et il ne contient plus forcément les mêmes
        // exercices (règle 1).
        done: exercises.reduce((sum, exercise) => sum + exercise.done, 0),
        total: exercises.reduce((sum, exercise) => sum + exercise.total, 0),
      };
    }),
    extras: contentsOf(EXTRAS_LANE),
  };
}

/** La file des hors-programme. Un bloc a sa clé, eux n'en ont pas — celle-ci en tient lieu. */
export const EXTRAS_LANE = 'extras';

/**
 * Les exercices de la séance, rangés sous la file où ils sont **menés**.
 *
 * Le repli tient en une ligne et il compte : une file que l'ordre désigne mais
 * qui n'existe plus rend ses exercices à leur file de programme. Sans lui, un
 * bloc retiré par un pull emporterait avec lui du réalisé encore affichable.
 */
function byLane(program: SessionProgram, order: ExecutionOrder): Map<string, SessionExercise[]> {
  const known = new Set<string>([...program.blocks.map((block) => block.key), EXTRAS_LANE]);
  const contents = new Map<string, SessionExercise[]>();

  const place = (exercise: SessionExercise, home: string): void => {
    const wanted = order.get(exercise.key)?.lane ?? home;
    const lane = known.has(wanted) ? wanted : home;
    const list = contents.get(lane);

    if (list === undefined) {
      contents.set(lane, [exercise]);
    } else {
      list.push(exercise);
    }
  };

  for (const block of program.blocks) {
    for (const group of block.groups) {
      for (const exercise of group.exercises) {
        place(exercise, block.key);
      }
    }
  }

  for (const exercise of program.extras) {
    place(exercise, EXTRAS_LANE);
  }

  return contents;
}

/** Les suites de voisins qui partagent un enchaînement. Un exercice seul fait une suite d'un. */
function chains(exercises: SessionExercise[], order: ExecutionOrder): SessionExercise[][] {
  const runs: SessionExercise[][] = [];
  let current: number | null = null;

  for (const exercise of exercises) {
    const chain = order.get(exercise.key)?.chain ?? null;
    const last = runs[runs.length - 1];

    if (chain !== null && chain === current && last) {
      last.push(exercise);
    } else {
      runs.push([exercise]);
    }

    current = chain;
  }

  return runs;
}

/**
 * Les lettres d'enchaînement, dans l'ordre : A, B, … Z, puis AA, AB.
 *
 * Le débordement au-delà de vingt-six n'arrivera pas dans une séance, et c'est
 * précisément pour ça qu'il ne mérite pas mieux qu'une règle qui ne se casse
 * pas : deux enchaînements ne doivent jamais porter la même lettre, sinon la
 * contiguïté seule les distingue et le rail de gauche ment.
 */
class Letters {
  private rank = 0;

  next(): string {
    const rank = this.rank++;
    const letter = String.fromCharCode(65 + (rank % 26));

    return rank < 26 ? letter : `${String.fromCharCode(64 + Math.floor(rank / 26))}${letter}`;
  }
}

/**
 * Ce que la séance attend **maintenant** : une série à cocher, ou un cardio à
 * marquer fait.
 *
 * `line` vaut `null` pour un cardio — il n'a pas de série, il se coche entier.
 */
export interface SessionTarget {
  exercise: SessionExercise;
  line: SessionSetLine | null;
}

/**
 * La cible courante du déroulé (KL-39).
 *
 * C'est ce que la barre d'action basse propose, et c'est **la** raison d'être de
 * cette fonction : en salle, la cible principale doit tomber sous le pouce, pas
 * quelque part dans un déroulé de douze exercices. Rendre `null` veut dire qu'il
 * n'y a plus rien à cocher — la barre bascule alors sur la clôture.
 *
 * ## L'ordre de lecture, sauf dans un superset
 *
 * La règle de base est la plus simple possible : la **première** ligne cochable
 * en descendant l'écran. Elle suit l'appariement par rang (`buildLines`), donc un
 * échauffement passe avant les séries de travail du même exercice.
 *
 * Un groupe lié fait exception, et c'est le sens même du superset : ses membres
 * s'**alternent**. À l'intérieur d'un groupe, la cible est donc le membre qui a
 * le moins de séries faites — A1, puis A2, puis A1 de nouveau — et les égalités
 * repartent du premier membre. Sans ça, la barre proposerait la deuxième série
 * de A1 pendant qu'on est sur A2, c'est-à-dire l'inverse de ce qui se passe.
 *
 * Un exercice **sauté** n'est jamais une cible : il est réglé, pas en attente.
 * Un exercice hors programme est son propre groupe — il ne s'alterne avec rien.
 */
export function nextTarget(program: SessionProgram): SessionTarget | null {
  const pools: SessionExercise[][] = [
    ...program.blocks.flatMap((block) => block.groups.map((group) => group.exercises)),
    // Les hors-programme se regroupent comme les autres : une séance libre
    // (KL-34) n'a **que** ça, et un superset improvisé s'y alterne pareil.
    ...groupExercises(program.extras).map((group) => group.exercises),
  ];

  for (const pool of pools) {
    const candidates = pool
      .map(pendingOf)
      .filter((candidate): candidate is SessionTarget => candidate !== null);

    if (candidates.length === 0) {
      continue;
    }

    // Comparaison stricte : à nombre de séries égal, le premier membre du groupe
    // garde la main, ce qui donne A1 avant A2 au premier tour.
    return candidates.reduce((best, candidate) =>
      candidate.exercise.done < best.exercise.done ? candidate : best,
    );
  }

  return null;
}

/** Ce que cet exercice-ci attend, ou `null` s'il n'attend plus rien. */
function pendingOf(exercise: SessionExercise): SessionTarget | null {
  if (exercise.skipped) {
    return null;
  }

  if (exercise.lines === null) {
    return exercise.logged === null ? { exercise, line: null } : null;
  }

  const line = exercise.lines.find((candidate) => candidate.actionable) ?? null;

  return line === null ? null : { exercise, line };
}

/** Tous les exercices d'un déroulé, blocs puis hors programme, dans l'ordre affiché. */
export function allExercises(program: SessionProgram): SessionExercise[] {
  return [
    ...program.blocks.flatMap((block) => block.groups.flatMap((group) => group.exercises)),
    ...program.extras,
  ];
}

/**
 * L'exercice de **bibliothèque** que cette ligne travaille vraiment, ou `null`
 * quand plus rien ne le désigne (exercice sorti de la bibliothèque des deux
 * côtés, exercice ajouté sans référence).
 *
 * Le réalisé prime sur le prescrit, exactement comme le nom affiché : un exercice
 * remplacé en séance (KL-30) se lit contre l'historique de **ce qu'on fait**, pas
 * de ce qui était prévu. C'est ce qui décide quelle dernière performance et quel
 * record s'affichent sous l'exercice (KL-32).
 */
export function exerciseIdOf(exercise: SessionExercise): number | null {
  return exercise.logged?.exerciseId ?? exercise.prescribed?.exerciseId ?? null;
}

/**
 * Les exercices de bibliothèque travaillés dans ce déroulé, dédupliqués.
 *
 * **Triés**, et c'est le point : cette liste sert de clé de dépendance à la
 * lecture d'historique (`useSessionHistory`). Rendue dans l'ordre d'apparition,
 * elle changerait à chaque exercice ajouté ou retiré alors que l'ensemble
 * interrogé est le même, et la requête se remonterait pour rien. Dédupliquée
 * parce que deux lignes du programme peuvent travailler le même exercice — un
 * bloc en deux temps — et qu'elles lisent alors le même point.
 */
export function exerciseIdsOf(program: SessionProgram): number[] {
  const ids = new Set<number>();

  for (const exercise of allExercises(program)) {
    const id = exerciseIdOf(exercise);

    if (id !== null) {
      ids.add(id);
    }
  }

  return [...ids].sort((a, b) => a - b);
}

/**
 * Les exercices de bibliothèque que la séance référence, **avant** que le
 * déroulé soit construit.
 *
 * Elle existe parce que le déroulé a besoin des libellés pour se construire, et
 * qu'`exerciseIdsOf` les lit sur un déroulé déjà bâti : le construire une
 * première fois sans les noms pour connaître ses identifiants serait tourner en
 * rond. Elle lit donc les deux sources brutes — le programme descendu et le
 * réalisé écrit — et rend la même chose, triée et dédupliquée pour la même
 * raison (c'est une clé de dépendance).
 */
export function referencedExerciseIds(
  blocks: PrescribedBlock[],
  loggedExercises: LoggedExerciseRow[],
): number[] {
  const ids = new Set<number>();

  for (const block of blocks) {
    for (const prescribed of block.exercises) {
      if (prescribed.exerciseId !== null) {
        ids.add(prescribed.exerciseId);
      }
    }
  }

  for (const logged of loggedExercises) {
    if (logged.exerciseId !== null) {
      ids.add(logged.exerciseId);
    }
  }

  return [...ids].sort((a, b) => a - b);
}

/**
 * Retrouve un exercice du déroulé par sa clé (KL-30).
 *
 * Même raison que `findSetLine` : une feuille ouverte retient une **clé**, jamais
 * l'objet, qui décrirait l'exercice tel qu'il était avant la dernière écriture.
 */
export function findExercise(program: SessionProgram, key: string): SessionExercise | null {
  return allExercises(program).find((exercise) => exercise.key === key) ?? null;
}

/**
 * Retrouve une série consignée dans le déroulé, par son uuid (KL-30).
 *
 * L'écran ouvre sa feuille d'ajustement sur un **uuid**, jamais sur l'objet
 * `SessionSetLine` : chaque écriture republie le déroulé, et un objet retenu dans
 * un état de composant décrirait la série telle qu'elle était avant. L'uuid, lui,
 * ne bouge pas — il est posé à la création et c'est le pivot de l'idempotence.
 */
export function findSetLine(
  program: SessionProgram,
  setUuid: string,
): { exercise: SessionExercise; line: SessionSetLine } | null {
  for (const exercise of allExercises(program)) {
    const line = exercise.lines?.find((candidate) => candidate.logged?.uuid === setUuid);

    if (line) {
      return { exercise, line };
    }
  }

  return null;
}

/**
 * Une série dévie-t-elle de ce qui était prescrit ?
 *
 * Sur l'axe demandé seulement : une charge ne se compare pas à une absence de
 * charge (même règle que `LogComparator` côté serveur — un axe muet d'un côté ne
 * tranche jamais). C'est ce qui décide d'afficher, ou non, la valeur prévue à
 * côté de la valeur saisie.
 *
 * Une série **corrigée d'avance** dévie déjà, avant d'avoir été faite : elle
 * annonce 82,5 kg là où le programme en demandait 80, et cacher l'écart jusqu'à
 * la coche reviendrait à laisser croire qu'on fait ce qui est écrit. C'est le
 * même écart, lu au même endroit, simplement plus tôt.
 */
export function setDeviates(line: SessionSetLine, axis: keyof SetValues): boolean {
  const values = line.logged ?? line.override;

  if (line.planned === null || values === null) {
    return false;
  }

  const planned = line.planned[axis];
  const actual = values[axis];

  return planned !== null && actual !== null && planned !== actual;
}

/**
 * Regroupe les exercices liés d'un bloc — ou les exercices hors programme, qui
 * forment leur propre file (§ un enchaînement se lit là où il se déroule).
 *
 * Un groupe, ce sont des **voisins contigus** dont le libellé partage le même
 * préfixe. La contiguïté est la moitié de la règle : le compositeur web tient
 * l'invariant « membres contigus en position » (`SupersetGrouper`), et deux
 * groupes du même bloc peuvent porter des lettres différentes (A1/A2 puis
 * B1/B2/B3). Une lecture par lettre seule recollerait des groupes séparés.
 */
export function groupExercises(exercises: SessionExercise[]): SessionGroup[] {
  const groups: SessionGroup[] = [];

  for (const exercise of exercises) {
    const prefix = groupPrefix(exercise.groupLabel);
    const current = groups[groups.length - 1];

    if (prefix !== null && current && current.label === prefix) {
      current.exercises.push(exercise);

      continue;
    }

    groups.push({ key: `g${exercise.key}`, label: prefix, exercises: [exercise] });
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
