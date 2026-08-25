/**
 * L'ordre d'exécution d'une séance (KL-52) : déplacer un exercice — d'un cran ou
 * à une place donnée —, l'enchaîner à son voisin, l'en détacher, tout rétablir.
 *
 * ## Pourquoi ce fichier existe, alors que « on dévie, on ne recompose pas »
 *
 * La règle de `deviations.ts` porte sur le **programme** : on ne réécrit pas ce
 * que le coach a composé, et rien ici ne le fait — `prescribed_snapshot` n'est
 * jamais touché, `logged_exercise.position` non plus, donc le document poussé
 * part toujours dans l'ordre du programme et `/schedule/{id}` lit la séance comme
 * elle a été prescrite. Ce qui s'écrit ici est autre chose, et ça n'existe que
 * sur ce téléphone : **l'ordre dans lequel la séance a réellement été menée**.
 *
 * Le besoin ne vient pas d'une envie de composer. Il vient de la barre basse :
 * `nextTarget` (`program.ts`) alterne les membres d'un superset, ce qui est juste
 * — et ne l'est **que** si on les mène dans l'ordre annoncé. Machine prise,
 * finisseur passé devant, superset improvisé avec l'exercice d'à côté : la cible
 * proposée devient alors systématiquement la mauvaise, et l'aide se retourne
 * contre celui qu'elle vise. Réordonner localement remet la barre d'accord avec
 * la salle, sans rien raconter au serveur.
 *
 * ## Tous les gestes écrivent la même chose : l'ordre entier
 *
 * Chaque appel **réécrit toutes les lignes** de `session_layout` pour cette
 * séance, calculées depuis le déroulé qu'on a sous les yeux. C'est plus simple
 * qu'un déplacement incrémental et c'est surtout plus sûr : il n'existe aucun
 * état intermédiaire où la moitié des exercices serait rangée selon l'ancien
 * ordre et l'autre selon le nouveau, et les identifiants d'enchaînement n'ont pas
 * à être stables d'une écriture à l'autre — seule leur **égalité entre voisins**
 * a un sens (`withExecutionOrder`).
 *
 * C'est ce qui rend `moveExerciseTo` — le relâchement d'un glisser-déposer —
 * aussi bon marché que `moveExercise` : les deux ne diffèrent que par la façon de
 * bouger un élément dans un tableau, l'écriture est la même.
 *
 * Corollaire : la première écriture **fige l'ordre du programme** dans la table,
 * enchaînements compris. C'est ce qui fait qu'un superset descendu du serveur
 * survit à un déplacement qui ne le concernait pas.
 *
 * ## Deux gardes, et une seule est celle des autres écritures
 *
 * **Ce n'est pas du réalisé**, donc pas d'`enqueueSchedulePut` : rien ne part au
 * serveur, il n'y a rien à pousser. C'est aussi pour ça que la garde n'est pas
 * `isOpen` : on peut réordonner une séance **avant** de la démarrer — on lit le
 * programme, on sait déjà que le rack sera pris — alors qu'aucun réalisé ne
 * s'écrit tant qu'elle n'a pas commencé. La seule chose qu'on refuse est une
 * séance **close** : elle raconte ce qui a eu lieu, son ordre est un fait.
 *
 * ## Les files se traversent
 *
 * Un exercice se pose dans n'importe quelle file de la séance : un bloc, ou les
 * hors-programme. La version d'origine l'interdisait, au motif qu'un bloc est
 * une **section** et qu'en sortir un exercice le changerait de nature. C'était
 * confondre le titre et le fait : le rôle d'un bloc ne classe rien — il titre
 * une section, le volume se compte sur le type des séries (`summary.ts`) — et ce
 * que ce fichier écrit n'est justement pas la composition de la séance, c'est
 * l'ordre où elle est menée. Or cet ordre-là traverse les blocs tous les jours :
 * le gainage d'échauffement se fait entre deux séries de squat, le finisseur
 * passe avant le dernier exercice principal. Refuser le geste ne l'empêchait
 * pas, ça obligeait juste à mentir à la barre basse — c'est-à-dire exactement le
 * défaut que l'ordre local existe pour corriger.
 *
 * Ce qui suit un exercice qui change de file, et ce qui ne le suit pas :
 *
 * - **Son bloc suit** (`slot.lane`) : il s'affiche sous l'en-tête où on l'a
 *   posé, et les compteurs de ce bloc le comptent (`withExecutionOrder`).
 * - **Son enchaînement, non.** Changer de file, c'est quitter la section : le
 *   superset qu'on y menait ne traverse pas avec. L'exercice arrive détaché, et
 *   se ré-enchaîne au bouton s'il doit l'être.
 * - **Le prescrit, jamais.** Comme le reste de ce fichier : rien ne part au
 *   serveur, `logged_exercise.position` ne bouge pas, le web lit la séance dans
 *   l'ordre du programme.
 */

import { eq } from 'drizzle-orm';

import { db, scheduledWorkout, sessionLayout, type Writer } from '@/db';

import { EXTRAS_LANE, groupExercises, type SessionExercise, type SessionProgram } from './program';

/** Une ligne d'ordre, telle qu'elle s'écrit. */
interface Slot {
  key: string;
  chain: number | null;
}

/** Une file du déroulé : sa clé, et ce qu'elle contient dans l'ordre. */
interface Lane {
  key: string;
  slots: Slot[];
}

/**
 * Les files réordonnables du déroulé, dans l'ordre où elles s'affichent : un bloc
 * par file, puis les hors-programme.
 *
 * **Un bloc vidé reste une file**, sinon un exercice qu'on en a sorti ne
 * pourrait plus y revenir. Les hors-programme, eux, n'en font une que s'il y en
 * a : « hors programme » n'est pas une section qu'on choisit, c'est ce qu'on
 * devient en étant ajouté à la main — on n'y **déplace** donc rien tant que la
 * séance n'en compte aucun. L'écran dessine exactement ces files-là, et c'est
 * cette liste qui doit rester d'accord avec la sienne (`arrangeLanes`).
 *
 * Les rangs restent **globaux** à la séance et ne sont pas remis à zéro par
 * file : ils sont ainsi comparables à `exercise.position` — ce sur quoi retombe
 * une clé que la table ne connaît pas encore, un exercice que le coach vient
 * d'ajouter — qui vit dans le même espace.
 */
function pools(program: SessionProgram): { key: string; exercises: SessionExercise[] }[] {
  const lanes = program.blocks.map((block) => ({
    key: block.key,
    exercises: block.groups.flatMap((group) => group.exercises),
  }));

  if (program.extras.length > 0) {
    lanes.push({ key: EXTRAS_LANE, exercises: program.extras });
  }

  return lanes;
}

/**
 * L'ordre courant, prêt à être modifié : les files de `Slot`, et où se trouve
 * l'exercice visé dedans.
 *
 * Les enchaînements sont **relus sur les groupes déjà construits** plutôt que sur
 * la table : le déroulé passé en paramètre porte déjà l'ordre local s'il y en a
 * un, et il porte les groupes du serveur sinon. Une seule source, et la première
 * écriture fige naturellement ce qui était prescrit.
 *
 * Les identifiants d'enchaînement sont distribués sur la **séance entière** et
 * non par file : deux files peuvent échanger un exercice, et deux groupes qui
 * porteraient le même identifiant de part et d'autre se colleraient l'un à
 * l'autre au premier passage.
 */
function locate(
  program: SessionProgram,
  exerciseKey: string,
): { lanes: Lane[]; laneIndex: number; index: number } | null {
  let chain = 0;
  const lanes = pools(program).map(({ key, exercises }) => ({
    key,
    slots: groupExercises(exercises).flatMap((group) => {
      // Un groupe d'un seul membre n'est pas un enchaînement : lui donner un
      // identifiant le collerait au voisin qui viendrait s'y ranger.
      const id = group.exercises.length > 1 ? ++chain : null;

      return group.exercises.map((exercise) => ({ key: exercise.key, chain: id }));
    }),
  }));

  for (const [laneIndex, lane] of lanes.entries()) {
    const index = lane.slots.findIndex((slot) => slot.key === exerciseKey);

    if (index !== -1) {
      return { lanes, laneIndex, index };
    }
  }

  return null;
}

/** Écrit l'ordre entier, en remplaçant celui qui s'y trouvait. */
function commit(tx: Writer, scheduledUuid: string, lanes: Lane[]): void {
  tx.delete(sessionLayout).where(eq(sessionLayout.scheduledUuid, scheduledUuid)).run();

  let position = 0;
  const rows = lanes.flatMap((lane) =>
    lane.slots.map((slot) => ({
      scheduledUuid,
      exerciseKey: slot.key,
      position: position++,
      chain: slot.chain,
      // Écrite pour **toutes** les lignes, pas seulement pour celle qui vient de
      // changer de file : l'ordre entier se réécrit à chaque geste, et une file
      // laissée à `null` retomberait sur celle du programme au prochain rendu.
      lane: lane.key,
    })),
  );

  if (rows.length > 0) {
    tx.insert(sessionLayout).values(rows).run();
  }
}

/**
 * La séance accepte-t-elle encore qu'on range son déroulé ?
 *
 * Volontairement plus permissif qu'`isOpen` (`writes.ts`) : une séance pas encore
 * commencée se réordonne, puisque rien de ce qu'on écrit ici n'est du réalisé.
 * Une séance close, non — son ordre fait partie de ce qui a eu lieu.
 */
function isArrangeable(tx: Writer, scheduledUuid: string): boolean {
  const row = tx
    .select({ endedAt: scheduledWorkout.endedAt })
    .from(scheduledWorkout)
    .where(eq(scheduledWorkout.uuid, scheduledUuid))
    .get();

  return row !== undefined && row.endedAt === null;
}

/**
 * Applique une modification sur le déroulé, autour de l'exercice visé, puis
 * écrit tout.
 *
 * `change` reçoit **toutes** les files et non plus seulement celle de
 * l'exercice : un geste peut le poser dans une autre.
 */
function arrange(
  scheduledUuid: string,
  program: SessionProgram,
  exerciseKey: string,
  change: (lanes: Lane[], laneIndex: number, index: number) => boolean,
): boolean {
  const found = locate(program, exerciseKey);

  if (found === null) {
    return false;
  }

  return db.transaction((tx) => {
    if (!isArrangeable(tx, scheduledUuid) || !change(found.lanes, found.laneIndex, found.index)) {
      return false;
    }

    commit(tx, scheduledUuid, found.lanes);

    return true;
  });
}

/**
 * Sort un exercice de sa file et le pose dans une autre, à un rang donné.
 *
 * **Il arrive détaché.** Changer de file, c'est quitter la section : le superset
 * qu'on menait là ne traverse pas, et celui qui reste derrière se retrouve seul
 * dans son groupe — donc plus dans aucun (un enchaînement est fait de voisins,
 * `withExecutionOrder`). Rien à nettoyer, la contiguïté s'en charge.
 */
function relocate(lanes: Lane[], from: number, index: number, to: number, rank: number): void {
  const [moved] = lanes[from].slots.splice(index, 1);
  const target = lanes[to].slots;

  moved.chain = null;
  target.splice(Math.min(Math.max(rank, 0), target.length), 0, moved);
}

/**
 * Déplace un exercice d'un cran — et, en bout de file, dans la file voisine.
 *
 * C'est le chemin de TalkBack, qui n'a rien à traîner (`ArrangeRow`), donc c'est
 * **le seul** qu'il ait pour changer de bloc : s'y arrêter au bord de la file
 * rendrait le rangement inter-blocs inaccessible au balayage alors qu'il est à
 * un glissement du doigt pour tout le monde. Descendre depuis la dernière ligne
 * de l'échauffement pose donc l'exercice en tête du bloc suivant, et monter
 * depuis la première le pose en queue du précédent.
 *
 * Dans la file, l'enchaînement **suit l'exercice** : deux membres d'un superset
 * qu'on échange restent un superset, celui qui en sort n'y est plus. C'est la
 * contiguïté qui décide, et personne n'a à l'écrire (`withExecutionOrder`). En
 * changeant de file, il se détache (`relocate`).
 *
 * Rend `false` aux deux bouts de la séance : là, il n'y a pas d'au-delà.
 */
export function moveExercise(
  scheduledUuid: string,
  program: SessionProgram,
  exerciseKey: string,
  delta: -1 | 1,
): boolean {
  return arrange(scheduledUuid, program, exerciseKey, (lanes, laneIndex, index) => {
    const lane = lanes[laneIndex].slots;
    const target = index + delta;

    if (target >= 0 && target < lane.length) {
      [lane[index], lane[target]] = [lane[target], lane[index]];

      return true;
    }

    const neighbour = laneIndex + delta;

    if (neighbour < 0 || neighbour >= lanes.length) {
      return false;
    }

    // On entre par le bord qu'on franchit : en queue de la file d'au-dessus, en
    // tête de celle d'en dessous. C'est ce que « d'un cran » veut dire quand le
    // cran suivant est dans un autre bloc.
    relocate(lanes, laneIndex, index, neighbour, delta === -1 ? lanes[neighbour].slots.length : 0);

    return true;
  });
}

/**
 * Déplace un exercice **dans une file, à une place donnée** : le geste du
 * glisser-déposer, qui ne connaît pas les crans.
 *
 * `lane` est la clé de la file d'arrivée — celle d'un bloc, ou `EXTRAS_LANE` —
 * et `to` un rang **dans cette file-là**, celui que la liste réordonnable annonce
 * au relâchement, c'est-à-dire déjà l'index d'arrivée dans un tableau dont
 * l'élément déplacé a été retiré. On applique exactement ça : `splice` sortant,
 * `splice` entrant. Un rang hors bornes est serré dans la file plutôt que refusé :
 * la bibliothèque ne rend jamais mieux que le dernier rang, et un déplacement qui
 * ne ferait rien après un geste abouti se lirait comme un écran figé. Une file
 * inconnue, elle, est bien un refus — le doigt n'a pas pu la désigner.
 *
 * Dans sa file, l'enchaînement **suit l'exercice** : ce qu'on traîne emporte son
 * rang, et c'est la contiguïté qui décide de ce qui reste un superset
 * (`withExecutionOrder`). Traverser un enchaînement le coupe donc en deux, ce qui
 * est la lecture juste — on vient de s'intercaler au milieu. En **changeant** de
 * file, il se détache (`relocate`).
 *
 * Rend `false` quand rien ne bouge : un exercice relâché là où il était n'a pas
 * d'ordre à réécrire.
 */
export function moveExerciseTo(
  scheduledUuid: string,
  program: SessionProgram,
  exerciseKey: string,
  lane: string,
  to: number,
): boolean {
  return arrange(scheduledUuid, program, exerciseKey, (lanes, laneIndex, index) => {
    const destination = lanes.findIndex((candidate) => candidate.key === lane);

    if (destination === -1) {
      return false;
    }

    if (destination !== laneIndex) {
      relocate(lanes, laneIndex, index, destination, to);

      return true;
    }

    const slots = lanes[laneIndex].slots;
    const target = Math.min(Math.max(to, 0), slots.length - 1);

    if (target === index) {
      return false;
    }

    const [moved] = slots.splice(index, 1);

    slots.splice(target, 0, moved);

    return true;
  });
}

/**
 * Enchaîne un exercice avec **celui qui le précède** : ils se mènent sans repos
 * entre eux, comme un superset du programme.
 *
 * Il rejoint l'enchaînement du précédent quand il y en a un — c'est ce qui permet
 * de faire un trio d'un duo — et en ouvre un à deux sinon.
 *
 * Rend `false` en tête de file : rien ne précède, il n'y a rien à enchaîner.
 */
export function chainExercise(
  scheduledUuid: string,
  program: SessionProgram,
  exerciseKey: string,
): boolean {
  return arrange(scheduledUuid, program, exerciseKey, (lanes, laneIndex, index) => {
    if (index === 0) {
      return false;
    }

    const slots = lanes[laneIndex].slots;
    const previous = slots[index - 1];

    if (previous.chain === null) {
      // Libre dans la **séance entière**, et pas seulement dans cette file : un
      // exercice peut passer d'un bloc à l'autre, et deux groupes qui
      // porteraient le même identifiant de part et d'autre se colleraient au
      // premier passage.
      const fresh =
        Math.max(
          0,
          ...lanes.flatMap((candidate) => candidate.slots.map((slot) => slot.chain ?? 0)),
        ) + 1;

      previous.chain = fresh;
    }

    slots[index].chain = previous.chain;

    return true;
  });
}

/**
 * Détache un exercice de son enchaînement : il se mène seul.
 *
 * Sur un duo, les deux redeviennent seuls — il n'y a pas d'enchaînement à un.
 * Sur un trio dont on détache le **membre du milieu**, la suite est coupée en
 * deux et les trois se mènent seuls : c'est ce que « détacher » veut dire quand
 * l'enchaînement est fait de voisins, et le reconstituer se fait en remontant
 * l'un des deux (`moveExercise`).
 */
export function unchainExercise(
  scheduledUuid: string,
  program: SessionProgram,
  exerciseKey: string,
): boolean {
  return arrange(scheduledUuid, program, exerciseKey, (lanes, laneIndex, index) => {
    const slot = lanes[laneIndex].slots[index];

    if (slot.chain === null) {
      return false;
    }

    slot.chain = null;

    return true;
  });
}

/**
 * Rétablit l'ordre du programme : la table est vidée, le déroulé retombe sur ce
 * que le serveur a descendu.
 *
 * Pas de « défaire » pas à pas — l'ordre local n'est pas un historique de gestes,
 * c'est un état — et rien à sauvegarder au passage : ce qu'on jette est
 * exactement ce que le prescrit sait redonner.
 */
export function resetExecutionOrder(scheduledUuid: string): boolean {
  return db.transaction((tx) => {
    if (!isArrangeable(tx, scheduledUuid)) {
      return false;
    }

    tx.delete(sessionLayout).where(eq(sessionLayout.scheduledUuid, scheduledUuid)).run();

    return true;
  });
}
