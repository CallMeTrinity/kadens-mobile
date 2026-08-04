/**
 * Cocher le réalisé (KL-29).
 *
 * Trois gestes : cocher une série, la décocher, marquer un exercice cardio fait
 * ou pas fait. Les **déviations** — corriger une valeur, ajouter ou retirer une
 * série, sauter, remplacer, ajouter un exercice — vivent à côté, dans
 * `deviations.ts` (KL-30) ; les gardes et les briques d'écriture que les deux
 * partagent sont dans `writes.ts`.
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

import { eq } from 'drizzle-orm';

import { db, loggedSet, nowIso, uuidv7 } from '@/db';
import { enqueueSchedulePut } from '@/sync';

import type { SessionExercise, SessionSetLine } from './program';
import { dropEmptyLoggedExercise, ensureLoggedExercise, isOpen, nextSetPosition } from './writes';

/**
 * Coche une série : elle vient d'être faite, aux valeurs prescrites.
 *
 * Rend `false` si la ligne n'était pas la prochaine de sa file — l'écran ne
 * propose que celle-là, mais deux appuis rapprochés sur deux lignes différentes
 * arriveraient tous les deux avec la vue d'avant l'écriture.
 *
 * Les valeurs sont **pré-remplies par le prescrit** et non demandées : c'est le
 * cas nominal en salle (on fait ce qui est écrit). Les corriger après coup, ou
 * ajouter une série que le programme ne réclame pas, est le sujet de KL-30 —
 * d'où le fait qu'une ligne sans prescrit ne se coche pas ici : elle n'existe que
 * parce qu'une série a déjà été consignée en face.
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

    if (loggedExerciseId === null) {
      return false;
    }

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
        // Il se saisit après coup, dans la feuille d'ajustement (KL-30).
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
    dropEmptyLoggedExercise(tx, logged.loggedExerciseId, exercise.substituted);

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
      dropEmptyLoggedExercise(tx, exercise.logged.id, exercise.substituted);
    }

    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}
