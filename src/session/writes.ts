/**
 * Les briques d'écriture du réalisé, partagées par `log.ts` (cocher, KL-29) et
 * `deviations.ts` (dévier, KL-30).
 *
 * Elles vivent à part parce qu'elles sont les **gardes** du domaine, et qu'une
 * garde recopiée dans deux fichiers finit par n'y être plus tout à fait la même.
 * Toutes prennent un `Writer` — la transaction de l'appelant — et aucune n'ouvre
 * la sienne : c'est ce qui permet à une déviation d'écrire deux tables et
 * d'empiler sa mutation d'un seul bloc.
 *
 * Rappel de la règle qui les tient toutes : **écrire du réalisé, c'est empiler sa
 * mutation dans la MÊME transaction**. L'app tuée entre les deux laisserait un
 * réalisé que rien ne signale comme non poussé, et le pull suivant l'effacerait
 * sans un mot.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  // Sous alias : le paramètre `exercise` de ces fonctions est une ligne de
  // séance (`SessionExercise`), pas une entrée de bibliothèque.
  exercise as exerciseTable,
  loggedExercise,
  loggedSet,
  scheduledWorkout,
  type Writer,
} from '@/db';

import type { SessionExercise } from './program';

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
export function isOpen(tx: Writer, scheduledUuid: string): boolean {
  const row = tx
    .select({ startedAt: scheduledWorkout.startedAt, endedAt: scheduledWorkout.endedAt })
    .from(scheduledWorkout)
    .where(eq(scheduledWorkout.uuid, scheduledUuid))
    .get();

  return row !== undefined && row.startedAt !== null && row.endedAt === null;
}

/**
 * Retrouve l'exercice réalisé qui correspond à cette ligne de séance, ou le crée.
 * Rend son identifiant local, `null` s'il n'y a rien à créer.
 *
 * Deux chemins, parce qu'il y a deux sortes de lignes depuis KL-30 :
 *
 * - **Une ligne du programme** s'apparie sur `sourcePrescribedId`, et sur lui
 *   seul : c'est ce que le contrat désigne comme le lien entre prévu et fait, et
 *   c'est ce que le serveur revalide (une ligne du programme **de cette séance**,
 *   sinon 422). L'appariement se relit en base plutôt que de se fier à
 *   `exercise.logged`, qui date du dernier rendu.
 * - **Un exercice hors programme** n'a pas de ligne en face : il *est* son réalisé,
 *   il existe donc déjà. On ne le crée jamais ici — c'est `addExercise` qui le
 *   fait, avec le nom et la référence choisis.
 */
export function ensureLoggedExercise(
  tx: Writer,
  scheduledUuid: string,
  exercise: SessionExercise,
): number | null {
  const prescribed = exercise.prescribed;

  if (prescribed === null) {
    return exercise.logged?.id ?? null;
  }

  const existing = tx
    .select({ id: loggedExercise.id })
    .from(loggedExercise)
    .where(
      and(
        eq(loggedExercise.scheduledUuid, scheduledUuid),
        eq(loggedExercise.sourcePrescribedId, prescribed.prescribedId),
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
      exerciseId: referenceableExerciseId(tx, prescribed.exerciseId),
      // Le snapshot du nom, pris au moment du log. Il part **toujours** au
      // serveur, qui refuserait une ligne sans référence ni nom : c'est lui qui
      // garde le réalisé lisible quand l'exercice quitte la bibliothèque.
      //
      // C'est le nom **transporté par le programme**, donc le français, et non le
      // libellé affiché : un snapshot ne porte qu'une langue, et l'écrire dans
      // celle du téléphone laisserait de l'anglais figé dans le réalisé de
      // quelqu'un qui lit en français. Tant que l'exercice existe, le libellé
      // vivant prime de toute façon à l'affichage (`naming.ts`).
      exerciseName: prescribed.name ?? 'Exercice',
      sourcePrescribedId: prescribed.prescribedId,
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
export function referenceableExerciseId(tx: Writer, exerciseId: number | null): number | null {
  return libraryReference(tx, exerciseId).id;
}

/**
 * La référence **et** le nom canonique d'un exercice de la bibliothèque locale.
 *
 * Le nom rendu est `exercise.name`, jamais le libellé affiché : c'est celui qui
 * se fige dans un snapshot de réalisé, et un snapshot ne porte qu'une langue. Le
 * figer dans celle du téléphone laisserait de l'anglais dans le réalisé d'un
 * compte qui bascule ensuite en français — alors que la bibliothèque, elle, est
 * francophone d'origine. L'affichage n'y perd rien : tant que l'exercice existe,
 * c'est le libellé vivant qui prime (`naming.ts`).
 */
export function libraryReference(
  tx: Writer,
  exerciseId: number | null,
): { id: number | null; name: string | null } {
  if (exerciseId === null) {
    return { id: null, name: null };
  }

  const known = tx
    .select({ id: exerciseTable.id, name: exerciseTable.name })
    .from(exerciseTable)
    .where(eq(exerciseTable.id, exerciseId))
    .get();

  return known ? { id: known.id, name: known.name } : { id: null, name: null };
}

/** La prochaine position libre dans un exercice réalisé. */
export function nextSetPosition(tx: Writer, loggedExerciseId: number): number {
  const row = tx
    .select({ next: sql<number>`coalesce(max(${loggedSet.position}), -1) + 1` })
    .from(loggedSet)
    .where(eq(loggedSet.loggedExerciseId, loggedExerciseId))
    .get();

  return row?.next ?? 0;
}

/**
 * La position d'un exercice ajouté hors programme (KL-30).
 *
 * `floor` est le nombre de lignes du programme : un exercice ajouté doit passer
 * **après** tout le prescrit, même si aucune ligne prescrite n'a encore été
 * cochée. Sans ce plancher, le premier ajout prendrait la position 0 et le
 * document poussé annoncerait au serveur un réalisé qui commence par ce qui
 * n'était pas prévu.
 */
export function nextExercisePosition(tx: Writer, scheduledUuid: string, floor: number): number {
  const row = tx
    .select({ next: sql<number>`coalesce(max(${loggedExercise.position}), -1) + 1` })
    .from(loggedExercise)
    .where(eq(loggedExercise.scheduledUuid, scheduledUuid))
    .get();

  return Math.max(row?.next ?? 0, floor);
}

/**
 * Retire un exercice réalisé devenu vide.
 *
 * « Vide » veut dire : plus aucune série, aucune note, non sauté, et **non
 * remplacé**. Les trois dernières conditions sont des **déclarations** de
 * l'athlète : les effacer parce qu'il n'y a pas de série effacerait ce qu'il a
 * dit. Le remplacement est la plus fragile des trois — la base ne peut pas le
 * voir seule (le prescrit vit dans un document JSON, pas dans une colonne), donc
 * l'appelant le passe. Sans ça, décocher la dernière série d'un exercice
 * remplacé effacerait le remplacement en silence, et la séance repartirait au
 * serveur comme si l'exercice prévu n'avait jamais été substitué.
 *
 * Un exercice **hors programme** échappe aussi à ce nettoyage : il n'a pas de
 * ligne prescrite pour le faire réapparaître, le retirer parce qu'il n'a pas
 * encore de série effacerait le geste « je fais aussi ça aujourd'hui ». Il se
 * retire à la main (`removeExercise`).
 *
 * Le filtre tient dans la clause `WHERE`, pas dans une lecture suivie d'un
 * `DELETE` : une seule requête, et la condition reste juste si cet appel sortait
 * un jour de sa transaction.
 */
export function dropEmptyLoggedExercise(
  tx: Writer,
  loggedExerciseId: number,
  substituted = false,
): void {
  if (substituted) {
    return;
  }

  tx.delete(loggedExercise)
    .where(
      and(
        eq(loggedExercise.id, loggedExerciseId),
        eq(loggedExercise.skipped, false),
        isNull(loggedExercise.notes),
        sql`${loggedExercise.sourcePrescribedId} is not null`,
        sql`not exists (select 1 from logged_set where logged_set.logged_exercise_id = ${loggedExerciseId})`,
      ),
    )
    .run();
}
