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

  // Le réalisé qu'aucune ligne du programme ne réclame. Même type que les autres
  // (§ un seul type d'exercice) : il s'affiche, se complète et se retire pareil.
  const extras: SessionExercise[] = loggedExercises
    .filter((logged) => !matched.has(logged.id))
    .map((logged) =>
      buildExercise(null, logged.position, logged, setsByExercise.get(logged.id) ?? []),
    );

  return { blocks: sessionBlocks, extras, prescribedCount: position, done, total };
}

function buildExercise(
  prescribed: PrescribedExerciseLine | null,
  position: number,
  logged: LoggedExerciseRow | null,
  sets: LoggedSetRow[],
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
    name: exerciseName(prescribed, logged, substituted),
    substituted,
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
 * Le prescrit prime tant qu'il n'a pas été remplacé : c'est un nom **vivant**, que
 * le pull rafraîchit, là où `exerciseName` est un snapshot pris au moment du log.
 * Dès qu'il y a remplacement — ou qu'il n'y a pas de prescrit — c'est le réalisé
 * qui dit ce qui a été fait.
 */
function exerciseName(
  prescribed: PrescribedExerciseLine | null,
  logged: LoggedExerciseRow | null,
  substituted: boolean,
): string {
  if (substituted || prescribed === null) {
    return logged?.exerciseName ?? 'Exercice';
  }

  return prescribed.name ?? logged?.exerciseName ?? 'Exercice retiré de la bibliothèque';
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
    ...program.extras.map((exercise) => [exercise]),
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
 * Une série réalisée dévie-t-elle de ce qui était prescrit ?
 *
 * Sur l'axe demandé seulement : une charge ne se compare pas à une absence de
 * charge (même règle que `LogComparator` côté serveur — un axe muet d'un côté ne
 * tranche jamais). C'est ce qui décide d'afficher, ou non, la valeur prévue à
 * côté de la valeur saisie.
 */
export function setDeviates(line: SessionSetLine, axis: keyof SetValues): boolean {
  if (line.planned === null || line.logged === null) {
    return false;
  }

  const planned = line.planned[axis];
  const logged = line.logged[axis];

  return planned !== null && logged !== null && planned !== logged;
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
    const prefix = groupPrefix(exercise.prescribed?.groupLabel ?? null);
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
