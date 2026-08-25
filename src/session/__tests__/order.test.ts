/**
 * L'ordre d'exécution local (KL-52), vérifié là où il compte.
 *
 * Trois choses ne se lisent nulle part ailleurs que dans le comportement.
 *
 * **Ce qu'il change est ce que la barre basse propose.** C'est la raison d'être
 * du ticket : `nextTarget` alterne les membres d'un superset, ce qui n'aide que
 * si on les mène dans l'ordre annoncé. Un déplacement doit donc se voir dans la
 * cible, pas seulement dans un tableau.
 *
 * **Ce qu'il ne change pas est ce qui part au serveur.** `logged_exercise.position`
 * et le document poussé restent dans l'ordre du programme : le web lit la séance
 * comme elle a été prescrite, quoi qu'on ait fait ici.
 *
 * **Un enchaînement est fait de voisins.** C'est la seule règle, et elle suffit :
 * sortir un exercice de son groupe l'en détache sans qu'aucune écriture ait à le
 * prévoir, et l'y ramener l'y remet.
 *
 * **Les files se traversent**. Un exercice se pose dans le bloc où il est
 * mené, et l'y voir suffit rarement : ce qui compte est que le bloc le compte,
 * que la barre basse le propose là, et que le serveur n'en sache toujours rien.
 */

import {
  addExercise,
  allExercises,
  beginWorkout,
  chainExercise,
  checkSet,
  closeWorkout,
  moveExercise,
  moveExerciseTo,
  nextTarget,
  resetExecutionOrder,
  unchainExercise,
  withExecutionOrder,
} from '@/session';
import { readScheduleDocument } from '@/sync/document';
import { resetDatabase } from '@/test/database';
import {
  exercisePayload,
  prescribedBlock,
  prescribedExercise,
  scheduledWorkout as scheduledWorkoutPayload,
  seedBootstrap,
} from '@/test/fixtures';
import { exerciseAt, nextLine, programOf } from '@/test/program';

const UUID = '01890000-0000-7000-8000-0000000000e1';

/** La clé de file d'un bloc, telle que `buildProgram` la compose : `b{id}`. */
const lane = (blockId: number): string => `b${blockId}`;

/** Un bloc de trois exercices, dont les deux premiers forment le superset A. */
function openSupersetWorkout(): void {
  seedBootstrap({
    exercises: [101, 102, 103].map((id) => exercisePayload(id)),
    schedule: [
      scheduledWorkoutPayload(UUID, {
        blocks: [
          prescribedBlock(1, [
            prescribedExercise(1, { groupLabel: 'A1' }),
            prescribedExercise(2, { groupLabel: 'A2' }),
            prescribedExercise(3),
          ]),
        ],
      }),
    ],
  });
  beginWorkout(UUID);
}

/**
 * Deux blocs : un échauffement de deux exercices, un entraînement de deux, dont
 * les deux membres du superset A.
 */
function openTwoBlockWorkout(): void {
  seedBootstrap({
    exercises: [101, 102, 103, 104].map((id) => exercisePayload(id)),
    schedule: [
      scheduledWorkoutPayload(UUID, {
        blocks: [
          prescribedBlock(1, [prescribedExercise(1), prescribedExercise(2)], {
            role: 'warmup',
          }),
          prescribedBlock(2, [
            prescribedExercise(3, { groupLabel: 'A1' }),
            prescribedExercise(4, { groupLabel: 'A2' }),
          ]),
        ],
      }),
    ],
  });
  beginWorkout(UUID);
}

/** Ce que chaque bloc contient, dans l'ordre : c'est ce que l'écran dessine. */
function lanes(): string[][] {
  const program = programOf(UUID);

  return [
    ...program.blocks.map((block) =>
      block.groups.flatMap((group) => group.exercises.map((exercise) => exercise.name)),
    ),
    program.extras.map((exercise) => exercise.name),
  ];
}

/** Les noms du déroulé, dans l'ordre affiché. */
function order(): string[] {
  return allExercises(programOf(UUID)).map((exercise) => exercise.name);
}

/** Les rangs d'enchaînement, dans l'ordre affiché. `—` pour un exercice mené seul. */
function ranks(): string[] {
  return allExercises(programOf(UUID)).map((exercise) => exercise.groupLabel ?? '—');
}

beforeEach(() => {
  resetDatabase();
});

describe('sans rien ranger', () => {
  it('laisse le déroulé et les rangs du programme', () => {
    openSupersetWorkout();

    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
    expect(ranks()).toEqual(['A1', 'A2', '—']);
    expect(programOf(UUID).reordered).toBe(false);
  });
});

describe('moveExercise', () => {
  it('déplace l’exercice dans son bloc, et la barre basse suit', () => {
    openSupersetWorkout();

    // Avant : la cible est A1, premier membre du superset.
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 101');

    expect(moveExercise(UUID, programOf(UUID), 'e3', -1)).toBe(true);
    expect(moveExercise(UUID, programOf(UUID), 'e3', -1)).toBe(true);

    expect(order()).toEqual(['Exercice 103', 'Exercice 101', 'Exercice 102']);
    // Le troisième exercice, remonté en tête, est ce que la barre propose : c'est
    // le seul point du ticket, tout le reste en découle.
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 103');
  });

  it('garde l’enchaînement quand on échange ses deux membres', () => {
    openSupersetWorkout();

    expect(moveExercise(UUID, programOf(UUID), 'e2', -1)).toBe(true);

    expect(order()).toEqual(['Exercice 102', 'Exercice 101', 'Exercice 103']);
    // Toujours un superset : la contiguïté n'a pas été rompue, seuls les rangs
    // ont changé de porteur.
    expect(ranks()).toEqual(['A1', 'A2', '—']);
  });

  it('détache l’exercice qu’on sort de son enchaînement, sans rien écrire de plus', () => {
    openSupersetWorkout();

    // A2 descend d'un cran : il n'est plus voisin de A1, donc plus lié à lui.
    expect(moveExercise(UUID, programOf(UUID), 'e2', 1)).toBe(true);

    expect(order()).toEqual(['Exercice 101', 'Exercice 103', 'Exercice 102']);
    expect(ranks()).toEqual(['—', '—', '—']);
  });

  it('refuse de sortir un exercice de la séance : il n’y a pas d’au-delà', () => {
    openSupersetWorkout();

    // Un seul bloc, donc aucune file voisine : les deux bords sont ceux de la
    // séance entière. Avec un second bloc, ces deux appels traverseraient
    // (« d'un bloc à l'autre » plus bas).
    expect(moveExercise(UUID, programOf(UUID), 'e1', -1)).toBe(false);
    expect(moveExercise(UUID, programOf(UUID), 'e3', 1)).toBe(false);
    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
  });

  it('ne bouge plus rien une fois la séance close', () => {
    openSupersetWorkout();
    const program = programOf(UUID);

    closeWorkout(UUID);

    // Le déroulé est celui d'avant la clôture : c'est ce que l'écran a en main
    // quand il rejoue un appui parti trop tard.
    expect(moveExercise(UUID, program, 'e3', -1)).toBe(false);
    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
  });
});

describe('moveExerciseTo', () => {
  it('pose l’exercice à la place demandée, d’un seul geste', () => {
    openSupersetWorkout();

    // Ce que rend le relâchement d'un glisser-déposer : « celui-ci, en tête ».
    expect(moveExerciseTo(UUID, programOf(UUID), 'e3', lane(1), 0)).toBe(true);

    expect(order()).toEqual(['Exercice 103', 'Exercice 101', 'Exercice 102']);
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 103');
  });

  it('coupe l’enchaînement qu’il traverse : on s’intercale au milieu', () => {
    openSupersetWorkout();

    expect(moveExerciseTo(UUID, programOf(UUID), 'e3', lane(1), 1)).toBe(true);

    expect(order()).toEqual(['Exercice 101', 'Exercice 103', 'Exercice 102']);
    // Les deux membres du superset ne sont plus voisins : la contiguïté est la
    // seule règle, et elle vient d'être rompue par ce qui s'est glissé entre.
    expect(ranks()).toEqual(['—', '—', '—']);
  });

  it('rend false quand la ligne est relâchée là où elle était', () => {
    openSupersetWorkout();

    expect(moveExerciseTo(UUID, programOf(UUID), 'e2', lane(1), 1)).toBe(false);
    // Pas d'ordre écrit du tout : un geste sans effet ne fige pas le programme
    // dans la table.
    expect(programOf(UUID).reordered).toBe(false);
  });

  it('serre un rang hors bornes dans la file plutôt que de refuser', () => {
    openSupersetWorkout();

    expect(moveExerciseTo(UUID, programOf(UUID), 'e1', lane(1), 99)).toBe(true);
    expect(order()).toEqual(['Exercice 102', 'Exercice 103', 'Exercice 101']);
  });

  it('ne bouge plus rien une fois la séance close', () => {
    openSupersetWorkout();
    const program = programOf(UUID);

    closeWorkout(UUID);

    expect(moveExerciseTo(UUID, program, 'e3', lane(1), 0)).toBe(false);
    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
  });
});

describe('chainExercise / unchainExercise', () => {
  it('enchaîne un exercice avec celui qui le précède', () => {
    openSupersetWorkout();

    expect(chainExercise(UUID, programOf(UUID), 'e3')).toBe(true);

    // Les trois n'en font plus qu'un : le troisième a rejoint l'enchaînement de
    // son voisin plutôt que d'en ouvrir un second.
    expect(ranks()).toEqual(['A1', 'A2', 'A3']);
  });

  it('ouvre un enchaînement à deux là où il n’y en avait pas', () => {
    openSupersetWorkout();

    // Le superset du programme est d'abord défait, pour partir de trois exercices
    // menés seuls.
    expect(unchainExercise(UUID, programOf(UUID), 'e2')).toBe(true);
    expect(ranks()).toEqual(['—', '—', '—']);

    expect(chainExercise(UUID, programOf(UUID), 'e3')).toBe(true);
    expect(ranks()).toEqual(['—', 'A1', 'A2']);
  });

  it('refuse d’enchaîner en tête de file : rien ne précède', () => {
    openSupersetWorkout();

    expect(chainExercise(UUID, programOf(UUID), 'e1')).toBe(false);
  });

  it('rend la cible séquentielle une fois le superset défait', () => {
    openSupersetWorkout();
    const first = exerciseAt(UUID, 0);

    checkSet(UUID, first, nextLine(first));

    // Lié, le superset alterne : la deuxième série revient à A2 (`program.ts`).
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 102');

    expect(unchainExercise(UUID, programOf(UUID), 'e2')).toBe(true);

    // Détaché, on finit l'exercice avant de passer au suivant.
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 101');
  });
});

describe('resetExecutionOrder', () => {
  it('rend au déroulé l’ordre et les rangs du programme', () => {
    openSupersetWorkout();

    moveExercise(UUID, programOf(UUID), 'e3', -1);
    chainExercise(UUID, programOf(UUID), 'e1');
    expect(programOf(UUID).reordered).toBe(true);

    expect(resetExecutionOrder(UUID)).toBe(true);

    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103']);
    expect(ranks()).toEqual(['A1', 'A2', '—']);
    expect(programOf(UUID).reordered).toBe(false);
  });
});

describe('d’un bloc à l’autre', () => {
  it('pose l’exercice dans la file où on l’a lâché, et le bloc le compte', () => {
    openTwoBlockWorkout();

    // Le second échauffement est mené dans l'entraînement, en tête.
    expect(moveExerciseTo(UUID, programOf(UUID), 'e2', lane(2), 0)).toBe(true);

    expect(lanes()).toEqual([
      ['Exercice 101'],
      ['Exercice 102', 'Exercice 103', 'Exercice 104'],
      [],
    ]);

    // Les compteurs suivent ce que le bloc contient maintenant, sinon l'en-tête
    // annoncerait un total que personne ne peut plus atteindre.
    const [warmup, main] = programOf(UUID).blocks;

    expect(warmup.total).toBe(4);
    expect(main.total).toBe(12);
  });

  it('détache l’exercice qui change de file : le superset ne traverse pas', () => {
    openTwoBlockWorkout();

    // A1 remonte dans l'échauffement : A2 reste seul là-bas, donc n'est plus un
    // rang du tout — un enchaînement est fait de voisins.
    expect(moveExerciseTo(UUID, programOf(UUID), 'e3', lane(1), 2)).toBe(true);

    expect(order()).toEqual(['Exercice 101', 'Exercice 102', 'Exercice 103', 'Exercice 104']);
    expect(ranks()).toEqual(['—', '—', '—', '—']);
  });

  it('fait suivre la barre basse : elle propose ce qu’on mène en premier', () => {
    openTwoBlockWorkout();

    // Avant : l'échauffement d'abord, dans l'ordre du programme.
    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 101');

    // Le finisseur du bloc 2 passe devant tout le monde.
    expect(moveExerciseTo(UUID, programOf(UUID), 'e4', lane(1), 0)).toBe(true);

    expect(nextTarget(programOf(UUID))?.exercise.name).toBe('Exercice 104');
  });

  it('traverse aussi d’un cran, le seul chemin qu’ait TalkBack', () => {
    openTwoBlockWorkout();

    // Depuis la dernière ligne de l'échauffement, « Descendre » entre en tête du
    // bloc suivant plutôt que de ne rien faire.
    expect(moveExercise(UUID, programOf(UUID), 'e2', 1)).toBe(true);
    expect(lanes()).toEqual([
      ['Exercice 101'],
      ['Exercice 102', 'Exercice 103', 'Exercice 104'],
      [],
    ]);

    // Et « Monter » depuis la première ligne d'un bloc revient en queue du
    // précédent : le geste est réversible.
    expect(moveExercise(UUID, programOf(UUID), 'e2', -1)).toBe(true);
    expect(lanes()).toEqual([
      ['Exercice 101', 'Exercice 102'],
      ['Exercice 103', 'Exercice 104'],
      [],
    ]);
  });

  it('refuse une file que le déroulé ne connaît pas', () => {
    openTwoBlockWorkout();

    expect(moveExerciseTo(UUID, programOf(UUID), 'e1', 'b404', 0)).toBe(false);
    expect(programOf(UUID).reordered).toBe(false);
  });

  it('rend l’exercice à son bloc quand la file où il était mené n’existe plus', () => {
    openTwoBlockWorkout();

    // Un pull a retiré le bloc où il était mené : sa file ne désigne plus rien.
    // Il retombe dans la sienne plutôt que de disparaître de l'écran — du
    // réalisé invisible serait pire qu'un rangement perdu.
    const stranded = withExecutionOrder(
      programOf(UUID),
      new Map([['e2', { position: 9, chain: null, lane: 'b404' }]]),
    );

    expect(
      stranded.blocks.map((block) =>
        block.groups.flatMap((group) => group.exercises.map((exercise) => exercise.name)),
      ),
    ).toEqual([
      ['Exercice 101', 'Exercice 102'],
      ['Exercice 103', 'Exercice 104'],
    ]);
  });
});

describe('ce qui part au serveur', () => {
  it('reste dans l’ordre du programme, quoi qu’on ait rangé', () => {
    openSupersetWorkout();

    // Une série sur chacun des trois, pour qu'ils aient tous une ligne réalisée.
    for (const index of [0, 1, 2]) {
      const exercise = exerciseAt(UUID, index);

      checkSet(UUID, exercise, nextLine(exercise));
    }

    moveExercise(UUID, programOf(UUID), 'e3', -1);
    moveExercise(UUID, programOf(UUID), 'e3', -1);

    // Le déroulé a bien changé de tête…
    expect(order()[0]).toBe('Exercice 103');

    // …et le document poussé, non : `position` n'a pas bougé, le serveur
    // renumérote sur l'ordre de la liste, et `/schedule/{id}` lit la séance comme
    // elle a été prescrite.
    const document = readScheduleDocument(UUID);

    expect(document?.log?.map((entry) => entry.name)).toEqual([
      'Exercice 101',
      'Exercice 102',
      'Exercice 103',
    ]);
  });

  it('ignore le bloc où l’exercice a fini par être mené', () => {
    openTwoBlockWorkout();

    for (const index of [0, 1, 2, 3]) {
      const exercise = exerciseAt(UUID, index);

      checkSet(UUID, exercise, nextLine(exercise));
    }

    // Le second échauffement est mené dans l'entraînement…
    moveExerciseTo(UUID, programOf(UUID), 'e2', lane(2), 2);

    expect(order()[3]).toBe('Exercice 102');

    // …et le document poussé n'en dit rien : ni l'ordre, ni le bloc. Le web lit
    // la séance comme elle a été prescrite.
    const document = readScheduleDocument(UUID);

    expect(document?.log?.map((entry) => entry.name)).toEqual([
      'Exercice 101',
      'Exercice 102',
      'Exercice 103',
      'Exercice 104',
    ]);
  });
});

describe('les exercices hors programme', () => {
  it('forment leur propre file, rangeable et enchaînable', () => {
    seedBootstrap({
      exercises: [201, 202].map((id) => exercisePayload(id)),
      schedule: [scheduledWorkoutPayload(UUID, { freeform: true, blocks: [] })],
    });
    beginWorkout(UUID);

    addExercise(UUID, { id: 201, name: 'Exercice 201' }, 0);
    addExercise(UUID, { id: 202, name: 'Exercice 202' }, 0);

    const second = exerciseAt(UUID, 1);

    expect(moveExercise(UUID, programOf(UUID), second.key, -1)).toBe(true);
    expect(order()).toEqual(['Exercice 202', 'Exercice 201']);

    // Une séance libre n'a que du hors-programme : un superset improvisé doit y
    // tenir, sinon l'alternance n'existe nulle part dans ce mode.
    expect(chainExercise(UUID, programOf(UUID), exerciseAt(UUID, 1).key)).toBe(true);
    expect(ranks()).toEqual(['A1', 'A2']);
  });
});
