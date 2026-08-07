/**
 * Dévier d'une séance (KL-30).
 *
 * Cinq gestes, ceux du ticket : corriger les valeurs d'une série, en ajouter une,
 * en supprimer une, sauter un exercice (avec une raison), le remplacer par un
 * autre de la bibliothèque locale, ajouter un exercice non prévu.
 *
 * **Ajouter une série n'écrit plus rien ici.** Le geste posait autrefois une
 * série déjà faite (`addSet`) : elle naissait cochée, avant d'avoir été faite, et
 * le repos partait avec. Il pose maintenant une ligne cochable de plus, projetée
 * sur le déroulé le temps du rendu (`withDraftSets`, `program.ts`) ; la cocher
 * passe par `checkSet` comme n'importe quelle autre série. Il n'y a donc plus
 * qu'un seul chemin d'écriture pour « une série a été faite ».
 *
 * ## Ce que ce fichier ne fera jamais
 *
 * **On dévie, on ne recompose pas** (§0.3 point 3, règle verrouillée). Pas de
 * réordonnancement de blocs, pas de superset créé, pas de tour modifié : ces
 * gestes appartiennent au compositeur web, qui a coûté plusieurs lots en Twig et
 * dont la moitié de la difficulté (`SupersetGrouper`, les invariants de
 * contiguïté) n'existe que côté serveur. Le risque était identifié au cadrage
 * sous la forme « tant qu'à faire, autant pouvoir réordonner » — la réponse est
 * non, et si le besoin remonte c'est un ticket web.
 *
 * Corollaire moins évident : **le prescrit ne bouge jamais**, donc on ne peut
 * dévier que sur ce qui **a été fait**. Il n'existe aucun endroit où écrire « la
 * série 3 se fera à 82,5 kg » : `prescribed_snapshot` est remplacé en entier à
 * chaque pull, et le réalisé n'existe pas avant d'être coché. Une série se coche
 * donc aux valeurs prescrites, puis se corrige — jamais l'inverse.
 *
 * ## Deux gardes du domaine, écrites ici et pas dans l'écran
 *
 * 1. **On ne consigne que dans une séance ouverte** (`isOpen`, `writes.ts`) :
 *    close, on n'écrit plus ; pas commencée, on n'écrit pas encore.
 * 2. **On ne réattribue pas des séries déjà faites à un autre exercice**
 *    (`canReplaceExercise`). Remplacer après deux séries consignées ferait
 *    raconter à la base qu'elles ont été faites sur la nouvelle machine. Le
 *    chemin honnête existe déjà et le modèle le prévoit : sauter l'exercice avec
 *    sa raison, puis ajouter l'autre hors programme.
 *
 * ## Le type de série ne s'édite pas
 *
 * Il décide de la **file d'appariement** (échauffement ou travail, `program.ts`) :
 * le changer déplacerait le rang de la série et de toutes les suivantes, donc la
 * lecture prévu/réalisé de la séance entière, ici comme sur `/schedule/{id}`. Pour
 * un gain faible — le type vient du programme et il est juste dans le cas normal.
 */

import { eq } from 'drizzle-orm';

import { db, loggedExercise, loggedSet, type Writer } from '@/db';
import { enqueueSchedulePut } from '@/sync';

import type { SessionExercise, SessionSetLine, SetValues } from './program';
import {
  dropEmptyLoggedExercise,
  ensureLoggedExercise,
  isOpen,
  libraryReference,
  nextExercisePosition,
} from './writes';

/** Ce qu'une série réalisée porte de saisissable. Brut : kg, secondes. */
export interface LoggedSetValues extends SetValues {
  /** Ressenti de la série, 1 à 10. `null` = non renseigné, et c'est le cas courant. */
  rpe: number | null;
}

/** Un exercice de la bibliothèque locale, tel que le sélecteur le rend. */
export interface ExerciseRef {
  id: number;
  /**
   * Le libellé qu'on avait sous les yeux en choisissant — donc dans la langue du
   * compte. Il ne sert que de **repli** : le snapshot écrit en base prend le nom
   * canonique de la bibliothèque (`referenceValues`, plus bas).
   */
  name: string;
}

/**
 * Les bornes du contrat (`docs/api-mobile.md §6.8`), tenues **à l'écriture**.
 *
 * Un document hors bornes ne serait pas refusé ici mais au push, en `422` — donc
 * après coup, sur un réalisé déjà consigné, et le compteur d'échecs de la file le
 * marquerait au bout de cinq essais. Une valeur impossible à saisir vaut mieux
 * qu'une séance bloquée en file.
 */
const BOUNDS = {
  reps: { min: 0, max: 200, integer: true },
  weightKg: { min: 0, max: 1000, integer: false },
  durationSeconds: { min: 0, max: 86_400, integer: true },
  rpe: { min: 1, max: 10, integer: true },
} as const;

function bound(value: number | null, key: keyof typeof BOUNDS): number | null {
  if (value === null) {
    return null;
  }

  const { min, max, integer } = BOUNDS[key];
  const clamped = Math.min(Math.max(value, min), max);

  return integer ? Math.round(clamped) : clamped;
}

/** Ramène des valeurs saisies dans ce que le serveur accepte. */
export function boundSetValues(values: LoggedSetValues): LoggedSetValues {
  return {
    reps: bound(values.reps, 'reps'),
    weightKg: bound(values.weightKg, 'weightKg'),
    durationSeconds: bound(values.durationSeconds, 'durationSeconds'),
    rpe: bound(values.rpe, 'rpe'),
  };
}

/**
 * Corrige les valeurs d'une série **déjà consignée**.
 *
 * C'est la déviation la plus courante — 82,5 kg là où 80 étaient écrits — et la
 * seule qui ne change rien à la structure de la séance : même rang, même file,
 * même appariement. Le prescrit reste à côté, intact, ce qui est tout l'intérêt
 * (dernière case du ticket).
 *
 * Rend `false` si la ligne n'a pas de réalisé : il n'y a alors rien à corriger, et
 * pré-remplir une ligne future n'aurait nulle part où s'écrire (§ en-tête).
 */
export function updateSet(
  scheduledUuid: string,
  line: SessionSetLine,
  values: LoggedSetValues,
): boolean {
  const logged = line.logged;

  if (logged === null) {
    return false;
  }

  const safe = boundSetValues(values);

  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    tx.update(loggedSet)
      .set({
        reps: safe.reps,
        weightKg: safe.weightKg,
        durationSeconds: safe.durationSeconds,
        rpe: safe.rpe,
      })
      // `completedAt` n'est pas retouché : c'est l'heure où la série a été faite,
      // pas celle où on a corrigé sa charge.
      .where(eq(loggedSet.uuid, logged.uuid))
      .run();

    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/**
 * Supprime une série consignée, quelle que soit sa place dans sa file.
 *
 * **Et c'est volontairement plus permissif que le décochage**, qui ne porte que
 * sur la dernière. La contrainte de KL-29 existe pour empêcher un *trou* : cocher
 * la troisième en laissant les deux premières vides produirait un réalisé qui
 * repartirait au serveur comme « une série faite » et reviendrait apparié à la
 * première ligne. Supprimer au milieu ne fait pas de trou — la file se resserre,
 * les rangs suivants remontent d'un cran, et c'est exactement ce que décrit une
 * série qu'on n'a finalement pas faite.
 *
 * L'exercice réalisé s'en va avec sa dernière série s'il n'a plus rien à dire.
 */
export function deleteSet(
  scheduledUuid: string,
  exercise: SessionExercise,
  line: SessionSetLine,
): boolean {
  const logged = line.logged;

  if (logged === null) {
    return false;
  }

  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    tx.delete(loggedSet).where(eq(loggedSet.uuid, logged.uuid)).run();
    // `substituted` épargne l'exercice remplacé : le remplacement est une
    // déclaration, il ne s'efface pas avec la dernière série (`writes.ts`).
    dropEmptyLoggedExercise(tx, logged.loggedExerciseId, exercise.substituted);
    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/** Ce qu'un exercice de séance porte de déclaratif : sauté, et pourquoi. */
export interface ExerciseState {
  skipped: boolean;
  /** Raison du saut, ou note de séance. Chaîne vide = pas de note. */
  notes: string;
}

/**
 * Déclare un exercice sauté (ou ne l'est plus), avec sa raison.
 *
 * **Sauter est une déclaration, pas un trou** : le modèle distingue les deux
 * depuis KL-05 (`LogDeviation::SKIPPED` contre `NOT_LOGGED`), et c'est ce qui
 * permet à `/schedule/{id}` de dire « sauté : machine occupée » au lieu de laisser
 * une ligne muette. D'où l'écriture d'un `logged_exercise` là où il n'y en avait
 * pas encore : déclarer, c'est écrire.
 *
 * La raison et la note libre sont **le même champ** (`notes`), parce que le modèle
 * n'en a qu'un et qu'en inventer un second côté mobile donnerait un texte que le
 * serveur ne saurait pas où mettre. Ne plus sauter ne l'efface donc pas : ce que
 * l'athlète a écrit lui appartient, et un exercice qui n'a plus que sa note
 * survit au nettoyage pour cette raison.
 */
export function setExerciseState(
  scheduledUuid: string,
  exercise: SessionExercise,
  state: ExerciseState,
): boolean {
  const notes = state.notes.trim();

  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    const loggedExerciseId = ensureLoggedExercise(tx, scheduledUuid, exercise);

    if (loggedExerciseId === null) {
      return false;
    }

    tx.update(loggedExercise)
      .set({ skipped: state.skipped, notes: notes.length > 0 ? notes : null })
      .where(eq(loggedExercise.id, loggedExerciseId))
      .run();

    // Un exercice qui n'est plus sauté, sans série ni note, n'a plus rien à dire :
    // le garder ferait envoyer « fait, zéro série » au serveur. Sauf s'il porte un
    // remplacement, qui est une déclaration au même titre (`writes.ts`).
    if (!state.skipped) {
      dropEmptyLoggedExercise(tx, loggedExerciseId, exercise.substituted);
    }

    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/**
 * Le remplacement est-il encore possible sur cet exercice ?
 *
 * Non dès qu'une série y est consignée : elle a été faite sur l'exercice
 * d'origine, la rattacher à un autre serait un mensonge sur ce qui s'est passé —
 * et il finirait dans l'historique et les records de la mauvaise machine. Le
 * chemin pour ce cas-là est « sauter, puis ajouter hors programme ».
 *
 * Non plus sur un exercice **hors programme** : il n'a rien en face de lui, le
 * remplacer c'est le retirer et en ajouter un autre.
 */
export function canReplaceExercise(exercise: SessionExercise): boolean {
  if (exercise.prescribed === null) {
    return false;
  }

  return !(exercise.lines ?? []).some((line) => line.logged !== null);
}

/**
 * Remplace l'exercice fait par un autre de la bibliothèque locale.
 *
 * Le lien au programme est **conservé** (`sourcePrescribedId`) : c'est ce qui
 * fait dire à `/schedule/{id}` « prévu développé couché, fait au guidé » plutôt
 * que de laisser un trou d'un côté et un intrus de l'autre. Le contrat l'autorise
 * explicitement — il vérifie que la ligne du programme appartient à cette séance,
 * pas qu'elle porte le même exercice.
 */
export function replaceExercise(
  scheduledUuid: string,
  exercise: SessionExercise,
  replacement: ExerciseRef,
): boolean {
  if (!canReplaceExercise(exercise)) {
    return false;
  }

  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    const loggedExerciseId = ensureLoggedExercise(tx, scheduledUuid, exercise);

    if (loggedExerciseId === null) {
      return false;
    }

    tx.update(loggedExercise)
      .set(referenceValues(tx, replacement))
      .where(eq(loggedExercise.id, loggedExerciseId))
      .run();

    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/**
 * Ajoute un exercice que le programme ne prévoyait pas.
 *
 * Il naît **sans série** : ajouter l'exercice et consigner ce qu'on y a fait sont
 * deux gestes, et le premier a du sens seul — « je fais aussi ça aujourd'hui »
 * s'écrit avant la première série. C'est aussi pourquoi le nettoyage d'un exercice
 * vide l'épargne (`dropEmptyLoggedExercise`) : sans ligne prescrite pour le faire
 * revenir, le retirer parce qu'il n'a pas encore de série effacerait le geste.
 *
 * `prescribedCount` est le nombre de lignes du programme : il sert de plancher de
 * position, pour qu'un exercice ajouté passe après le prescrit dans le document
 * poussé même si rien n'a encore été coché.
 */
export function addExercise(
  scheduledUuid: string,
  reference: ExerciseRef,
  prescribedCount: number,
): boolean {
  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    tx.insert(loggedExercise)
      .values({
        scheduledUuid,
        ...referenceValues(tx, reference),
        // Aucune ligne du programme en face : c'est ce qui le range en « hors
        // programme » ici comme dans le tableau de `/schedule/{id}`.
        sourcePrescribedId: null,
        position: nextExercisePosition(tx, scheduledUuid, prescribedCount),
        skipped: false,
        notes: null,
      })
      .run();

    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/**
 * Retire un exercice **hors programme**, avec ses séries.
 *
 * Un exercice du programme ne se retire pas : il se saute, ce qui le déclare au
 * lieu de le faire disparaître. C'est la même distinction qu'entre `SKIPPED` et
 * `NOT_LOGGED` côté serveur, et elle ne vaut que parce que la ligne prescrite,
 * elle, reste de toute façon affichée.
 */
export function removeExercise(scheduledUuid: string, exercise: SessionExercise): boolean {
  const logged = exercise.logged;

  if (exercise.prescribed !== null || logged === null) {
    return false;
  }

  return db.transaction((tx) => {
    if (!isOpen(tx, scheduledUuid)) {
      return false;
    }

    // Les séries suivent : `logged_set.logged_exercise_id` est en `ON DELETE
    // CASCADE` et les clés étrangères sont actives (`foreign_keys = ON`).
    tx.delete(loggedExercise).where(eq(loggedExercise.id, logged.id)).run();
    enqueueSchedulePut(scheduledUuid, tx);

    return true;
  });
}

/**
 * La référence et le nom qu'un exercice réalisé porte.
 *
 * Le nom est un **snapshot** : il part toujours au serveur, qui refuserait une
 * ligne sans référence ni nom. La référence, elle, passe par la vérification de
 * `libraryReference` — même si le choix vient de la bibliothèque locale, c'est la
 * garde qui empêche une clé étrangère de faire échouer l'insertion.
 *
 * Le nom vient de la **bibliothèque**, pas du libellé qu'on avait sous les yeux
 * en choisissant : le sélecteur affiche l'anglais quand le compte le demande, et
 * un snapshot ne porte qu'une langue (voir `libraryReference`). Le libellé reçu
 * ne sert que lorsque l'exercice n'est plus référençable — c'est alors le seul
 * nom qu'on ait.
 */
function referenceValues(tx: Writer, reference: ExerciseRef) {
  const known = libraryReference(tx, reference.id);

  return {
    exerciseId: known.id,
    exerciseName: known.name ?? reference.name,
  };
}
