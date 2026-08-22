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
 * ## On ne réordonne qu'à l'intérieur d'une file
 *
 * Un bloc, ou les exercices hors programme. Le bloc est une **section** de la
 * séance (échauffement, principal, retour au calme) : en sortir un exercice ne
 * le déplacerait pas, ça le changerait de nature. Le chemin honnête pour « je
 * fais ça maintenant, pas à la fin » existe déjà et il est ailleurs — sauter, et
 * ajouter hors programme.
 */

import { eq } from 'drizzle-orm';

import { db, scheduledWorkout, sessionLayout, type Writer } from '@/db';

import { groupExercises, type SessionExercise, type SessionProgram } from './program';

/** Une ligne d'ordre, telle qu'elle s'écrit. */
interface Slot {
  key: string;
  chain: number | null;
}

/**
 * Les files réordonnables du déroulé, dans l'ordre où elles s'affichent : un bloc
 * par file, puis les hors-programme.
 *
 * Les rangs sont **globaux** à la séance et non remis à zéro par file : comme on
 * ne déplace jamais un exercice d'une file à l'autre, ils restent contigus par
 * bloc, et une clé absente de la table (un exercice que le coach vient
 * d'ajouter) se compare alors à `exercise.position`, qui vit dans le même espace.
 */
function pools(program: SessionProgram): SessionExercise[][] {
  return [
    ...program.blocks.map((block) => block.groups.flatMap((group) => group.exercises)),
    program.extras,
  ];
}

/**
 * L'ordre courant, prêt à être modifié : une file de `Slot`, et l'index de
 * l'exercice visé dedans.
 *
 * Les enchaînements sont **relus sur les groupes déjà construits** plutôt que sur
 * la table : le déroulé passé en paramètre porte déjà l'ordre local s'il y en a
 * un, et il porte les groupes du serveur sinon. Une seule source, et la première
 * écriture fige naturellement ce qui était prescrit.
 */
function locate(
  program: SessionProgram,
  exerciseKey: string,
): { lanes: Slot[][]; lane: Slot[]; index: number } | null {
  let chain = 0;
  const lanes = pools(program).map((exercises) =>
    groupExercises(exercises).flatMap((group) => {
      // Un groupe d'un seul membre n'est pas un enchaînement : lui donner un
      // identifiant le collerait au voisin qui viendrait s'y ranger.
      const id = group.exercises.length > 1 ? ++chain : null;

      return group.exercises.map((exercise) => ({ key: exercise.key, chain: id }));
    }),
  );

  for (const lane of lanes) {
    const index = lane.findIndex((slot) => slot.key === exerciseKey);

    if (index !== -1) {
      return { lanes, lane, index };
    }
  }

  return null;
}

/** Écrit l'ordre entier, en remplaçant celui qui s'y trouvait. */
function commit(tx: Writer, scheduledUuid: string, lanes: Slot[][]): void {
  tx.delete(sessionLayout).where(eq(sessionLayout.scheduledUuid, scheduledUuid)).run();

  let position = 0;
  const rows = lanes.flat().map((slot) => ({
    scheduledUuid,
    exerciseKey: slot.key,
    position: position++,
    chain: slot.chain,
  }));

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

/** Applique une modification sur la file de l'exercice visé, puis écrit tout. */
function arrange(
  scheduledUuid: string,
  program: SessionProgram,
  exerciseKey: string,
  change: (lane: Slot[], index: number) => boolean,
): boolean {
  const found = locate(program, exerciseKey);

  if (found === null) {
    return false;
  }

  return db.transaction((tx) => {
    if (!isArrangeable(tx, scheduledUuid) || !change(found.lane, found.index)) {
      return false;
    }

    commit(tx, scheduledUuid, found.lanes);

    return true;
  });
}

/**
 * Déplace un exercice d'un cran dans sa file.
 *
 * L'enchaînement **suit l'exercice** : deux membres d'un superset qu'on échange
 * restent un superset, celui qui en sort n'y est plus. C'est la contiguïté qui
 * décide, et personne n'a à l'écrire (`withExecutionOrder`).
 *
 * Rend `false` en bout de file : il n'y a pas d'au-delà, et un bloc ne se
 * traverse pas (voir l'en-tête).
 */
export function moveExercise(
  scheduledUuid: string,
  program: SessionProgram,
  exerciseKey: string,
  delta: -1 | 1,
): boolean {
  return arrange(scheduledUuid, program, exerciseKey, (lane, index) => {
    const target = index + delta;

    if (target < 0 || target >= lane.length) {
      return false;
    }

    [lane[index], lane[target]] = [lane[target], lane[index]];

    return true;
  });
}

/**
 * Déplace un exercice **à une place donnée** de sa file : le geste du
 * glisser-déposer, qui ne connaît pas les crans.
 *
 * `to` est un rang **dans la file de l'exercice**, celui que la liste réordonnable
 * annonce au relâchement — donc déjà l'index d'arrivée dans un tableau dont
 * l'élément déplacé a été retiré. On applique exactement ça : `splice` sortant,
 * `splice` entrant. Un rang hors bornes est serré dans la file plutôt que refusé :
 * la bibliothèque ne rend jamais mieux que le dernier rang, et un déplacement qui
 * ne ferait rien après un geste abouti se lirait comme un écran figé.
 *
 * L'enchaînement **suit l'exercice**, comme pour un déplacement d'un cran : ce
 * qu'on traîne emporte son rang, et c'est la contiguïté qui décide de ce qui
 * reste un superset (`withExecutionOrder`). Traverser un enchaînement le coupe
 * donc en deux, ce qui est la lecture juste — on vient de s'intercaler au milieu.
 *
 * Rend `false` quand rien ne bouge : un exercice relâché là où il était n'a pas
 * d'ordre à réécrire.
 */
export function moveExerciseTo(
  scheduledUuid: string,
  program: SessionProgram,
  exerciseKey: string,
  to: number,
): boolean {
  return arrange(scheduledUuid, program, exerciseKey, (lane, index) => {
    const target = Math.min(Math.max(to, 0), lane.length - 1);

    if (target === index) {
      return false;
    }

    const [moved] = lane.splice(index, 1);

    lane.splice(target, 0, moved);

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
  return arrange(scheduledUuid, program, exerciseKey, (lane, index) => {
    if (index === 0) {
      return false;
    }

    const previous = lane[index - 1];

    if (previous.chain === null) {
      // Un identifiant libre **dans cette file**, et ça suffit : la contiguïté
      // s'évalue file par file (`withExecutionOrder`), deux files ne peuvent pas
      // se toucher, donc un même rang de part et d'autre ne colle rien.
      const fresh = Math.max(0, ...lane.map((slot) => slot.chain ?? 0)) + 1;

      previous.chain = fresh;
    }

    lane[index].chain = previous.chain;

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
  return arrange(scheduledUuid, program, exerciseKey, (lane, index) => {
    if (lane[index].chain === null) {
      return false;
    }

    lane[index].chain = null;

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
