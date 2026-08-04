/**
 * Écrire le réalisé (KL-29).
 *
 * Trois gestes, et pas un de plus : cocher une série, la décocher, marquer un
 * exercice cardio fait ou pas fait. Modifier les valeurs d'une série, en ajouter
 * une hors programme, sauter un exercice, en remplacer un : c'est **KL-30**, et
 * rien n'en est esquissé ici.
 *
 * ## La règle qui tient tout le fichier
 *
 * **Écrire du réalisé, c'est empiler sa mutation dans la MÊME transaction.**
 * `enqueueSchedulePut(uuid, tx)` prend l'exécuteur de l'appelant : l'app tuée
 * entre l'écriture et l'enfilement laisserait un réalisé que rien ne signale
 * comme non poussé, et le pull suivant — qui remplace la fenêtre — l'effacerait
 * sans un mot. C'est aussi pour ça que tout ici est **synchrone** : le pilote
 * Drizzle d'`expo-sqlite` valide une transaction dès que son rappel retourne, un
 * rappel `async` la validerait avant la première écriture.
 *
 * Une seule mutation par séance, quel qu'en soit le nombre de séries :
 * `enqueueSchedulePut` est coalescé par uuid et la file ne porte que l'uuid, le
 * document se relisant au moment du push (`sync/document.ts`). Le ticket le
 * demande mot pour mot — « inutile d'en empiler une par série » — et c'est déjà
 * ce que KL-27 avait posé.
 *
 * ## Ce qu'on n'écrit pas
 *
 * Ni la date, ni le titre, ni le statut : le serveur fait autorité sur la
 * programmation. Cocher une série ne clôture pas une séance (KL-33), et
 * `started_at` a déjà été posé à l'ouverture (`start.ts`).
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  db,
  // Sous alias : le paramètre `exercise` de ce fichier est une ligne du
  // programme (`SessionExercise`), pas une entrée de bibliothèque.
  exercise as exerciseTable,
  loggedExercise,
  loggedSet,
  nowIso,
  scheduledWorkout,
  uuidv7,
  type Writer,
} from '@/db';
import { enqueueSchedulePut } from '@/sync';

import type { SessionExercise, SessionSetLine } from './program';

/**
 * Coche une série : elle vient d'être faite, aux valeurs prescrites.
 *
 * Rend `false` si la ligne n'était pas la prochaine de sa file — l'écran ne
 * propose que celle-là, mais deux appuis rapprochés sur deux lignes différentes
 * arriveraient tous les deux avec la vue d'avant l'écriture.
 *
 * Les valeurs sont **pré-remplies par le prescrit** et non demandées : c'est le
 * cas nominal en salle (on fait ce qui est écrit), et les corriger est le sujet
 * de KL-30. Une ligne sans prescrit ne se coche pas — elle n'existe que parce
 * qu'une série faite en trop est déjà là.
 */
export function checkSet(
  scheduledUuid: string,
  exercise: SessionExercise,
  line: SessionSetLine,
): boolean {
  if (!line.actionable || line.planned === null) {
    return false;
  }

  const planned = line.planned;

  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    const loggedExerciseId = ensureLoggedExercise(tx, scheduledUuid, exercise);

    tx.insert(loggedSet)
      .values({
        // L'identifiant est posé **ici**, hors réseau, avant que le serveur sache
        // que la série existe : c'est le pivot de l'idempotence du `PUT`.
        uuid: uuidv7(),
        loggedExerciseId,
        // À la suite de ce qui est déjà consigné : la position locale est l'ordre
        // dans lequel les séries ont été faites, et c'est la vérité de la séance.
        // Le serveur la renumérote de toute façon, l'ordre de la liste faisant foi.
        position: nextSetPosition(tx, loggedExerciseId),
        type: line.type,
        reps: planned.reps,
        weightKg: planned.weightKg,
        durationSeconds: planned.durationSeconds,
        // Le RPE se ressent, il ne se prescrit pas par série : rien à recopier.
        rpe: null,
        completedAt: nowIso(),
      })
      .run();

    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/**
 * Décoche une série : elle n'a finalement pas été faite.
 *
 * Seule la dernière de sa file se décoche (§ l'appariement par rang, dans
 * `program.ts`). L'exercice réalisé s'en va avec sa dernière série s'il n'a plus
 * rien à dire : un `logged_exercise` sans série, sans note et non sauté
 * signifierait « fait, zéro série » une fois poussé, ce qui est faux.
 */
export function uncheckSet(
  scheduledUuid: string,
  exercise: SessionExercise,
  line: SessionSetLine,
): boolean {
  const logged = line.logged;

  if (!line.undoable || logged === null) {
    return false;
  }

  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    tx.delete(loggedSet).where(eq(loggedSet.uuid, logged.uuid)).run();
    dropEmptyLoggedExercise(tx, logged.loggedExerciseId);

    // La mutation part même quand il ne reste rien : le réalisé effacé doit
    // l'être **aussi** côté serveur, et `log: []` est ce qui l'y efface
    // (`sync/document.ts`). Ne rien empiler laisserait le pull suivant remettre
    // la série qu'on vient de retirer.
    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/**
 * Marque un exercice **cardio** fait ou pas fait.
 *
 * C'est tout ce que le mobile en dit : pas de saisie de distance, d'allure ni de
 * durée (règle verrouillée, Strava couvre le cardio). « Fait » s'écrit donc
 * comme un exercice réalisé **sans aucune série** — le modèle le prévoit, et le
 * serveur le lit comme « rien à signaler » (`LogComparator` : un prescrit sans
 * séries à apparier n'a pas d'écart mesurable).
 *
 * Rend `false` si l'exercice n'est pas un cardio, ou s'il est déjà dans l'état
 * demandé.
 */
export function setCardioDone(
  scheduledUuid: string,
  exercise: SessionExercise,
  done: boolean,
): boolean {
  if (exercise.lines !== null || done === (exercise.logged !== null)) {
    return false;
  }

  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    if (done) {
      ensureLoggedExercise(tx, scheduledUuid, exercise);
    } else if (exercise.logged) {
      dropEmptyLoggedExercise(tx, exercise.logged.id);
    }

    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/**
 * La séance est-elle ouverte — commencée, pas terminée ?
 *
 * C'est la garde que **toutes** les écritures franchissent, et elle est ici plutôt
 * que dans l'écran pour la même raison que `beginWorkout` refuse une séance close :
 * « on ne consigne que dans une séance ouverte » est une règle du domaine, et une
 * règle qui ne vit que dans un composant est invisible au composant suivant.
 *
 * Les deux moitiés comptent. **Terminée** : pas de reprise après clôture (§2.3
 * point 5) — une série qui arriverait après coup rouvrirait un fait déjà envoyé.
 * **Pas commencée** : un réalisé sans borne de départ décrirait une séance qu'on
 * n'a pas faite, et le pull ne protégerait même pas la séance, faute de
 * `started_at`.
 */
function isOpen(tx: Writer, scheduledUuid: string): boolean {
  const row = tx
    .select({ startedAt: scheduledWorkout.startedAt, endedAt: scheduledWorkout.endedAt })
    .from(scheduledWorkout)
    .where(eq(scheduledWorkout.uuid, scheduledUuid))
    .get();

  return row !== undefined && row.startedAt !== null && row.endedAt === null;
}

/**
 * Retrouve l'exercice réalisé qui correspond à cette ligne du programme, ou le
 * crée. Rend son identifiant local.
 *
 * L'appariement se fait sur `sourcePrescribedId`, et sur lui seul : c'est ce que
 * le contrat désigne comme le lien entre prévu et fait, et c'est ce que le
 * serveur revalide (une ligne du programme **de cette séance**, sinon 422).
 */
function ensureLoggedExercise(
  tx: Writer,
  scheduledUuid: string,
  exercise: SessionExercise,
): number {
  const existing = tx
    .select({ id: loggedExercise.id })
    .from(loggedExercise)
    .where(
      and(
        eq(loggedExercise.scheduledUuid, scheduledUuid),
        eq(loggedExercise.sourcePrescribedId, exercise.prescribed.prescribedId),
      ),
    )
    .get();

  if (existing) {
    return existing.id;
  }

  return tx
    .insert(loggedExercise)
    .values({
      scheduledUuid,
      exerciseId: referenceableExerciseId(tx, exercise.prescribed.exerciseId),
      // Le snapshot du nom, pris au moment du log. Il part **toujours** au
      // serveur, qui refuserait une ligne sans référence ni nom : c'est lui qui
      // garde le réalisé lisible quand l'exercice quitte la bibliothèque.
      exerciseName: exercise.prescribed.name ?? 'Exercice',
      sourcePrescribedId: exercise.prescribed.prescribedId,
      position: exercise.position,
      skipped: false,
      notes: null,
    })
    .returning({ id: loggedExercise.id })
    .get().id;
}

/**
 * L'identifiant d'exercice, s'il désigne bien une ligne de la bibliothèque
 * locale. `null` sinon.
 *
 * `logged_exercise.exercise_id` porte une clé étrangère et les clés étrangères
 * sont actives (`foreign_keys = ON`) : un identifiant absent ferait **échouer
 * l'insertion**, donc perdre la série au moment précis où on la coche. Le cas est
 * rare — la bibliothèque locale contient normalement tout ce que le programme
 * référence — mais il existe, et KL-27 l'a déjà rencontré dans l'autre sens
 * (l'historique saute les exercices inconnus, pour la même raison).
 *
 * Le repli coûte le rattachement de cette ligne à l'historique et aux records ;
 * l'alternative coûterait la série elle-même. Le nom, lui, est conservé, donc le
 * réalisé reste lisible partout. La sortie propre reste celle que KL-27 a
 * identifiée : retirer cette clé étrangère, une FK vers un cache partiel étant
 * une erreur de catégorie.
 */
function referenceableExerciseId(tx: Writer, exerciseId: number | null): number | null {
  if (exerciseId === null) {
    return null;
  }

  const known = tx
    .select({ id: exerciseTable.id })
    .from(exerciseTable)
    .where(eq(exerciseTable.id, exerciseId))
    .get();

  return known ? exerciseId : null;
}

/** La prochaine position libre dans un exercice réalisé. */
function nextSetPosition(tx: Writer, loggedExerciseId: number): number {
  const row = tx
    .select({ next: sql<number>`coalesce(max(${loggedSet.position}), -1) + 1` })
    .from(loggedSet)
    .where(eq(loggedSet.loggedExerciseId, loggedExerciseId))
    .get();

  return row?.next ?? 0;
}

/**
 * Retire un exercice réalisé devenu vide.
 *
 * « Vide » veut dire : plus aucune série, aucune note, et non sauté. Les deux
 * dernières conditions sont des **déclarations** de l'athlète (KL-30) : les
 * effacer parce qu'il n'y a pas de série effacerait ce qu'il a dit.
 *
 * Le filtre tient dans la clause `WHERE`, pas dans une lecture suivie d'un
 * `DELETE` : une seule requête, et la condition reste juste si cet appel sortait
 * un jour de sa transaction.
 */
function dropEmptyLoggedExercise(tx: Writer, loggedExerciseId: number): void {
  tx.delete(loggedExercise)
    .where(
      and(
        eq(loggedExercise.id, loggedExerciseId),
        eq(loggedExercise.skipped, false),
        isNull(loggedExercise.notes),
        sql`not exists (select 1 from logged_set where logged_set.logged_exercise_id = ${loggedExerciseId})`,
      ),
    )
    .run();
}
