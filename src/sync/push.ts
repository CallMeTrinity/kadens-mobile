import { eq } from 'drizzle-orm';

import {
  deleteSchedule,
  describeError,
  isTransient,
  isUnauthorized,
  putExerciseSetup,
  putSchedule,
  type ScheduleUpsertInput,
} from '@/api';
import { db, exerciseSetup, nowIso, patchSyncState, type MutationRow } from '@/db';

import { readScheduleDocument } from './document';
import {
  dropMutation,
  isExhausted,
  listMutations,
  recordFailure,
  recordTransientFailure,
} from './queue';

/**
 * Le sens montant : dépiler `mutation_queue` (KL-27).
 *
 * ## Une mutation à la fois, dans l'ordre
 *
 * Pas de parallélisme, pas de lot. Deux `PUT` concurrents sur la même séance
 * gagneraient une course dont personne ne connaît le vainqueur, et la file est
 * courte par construction (une entrée par séance modifiée). L'ordre est celui des
 * `id`, et c'est le seul ordre qui existe.
 *
 * ## Ce qui compte comme un échec, et ce qui n'en est pas un
 *
 * C'est la décision la plus importante de ce fichier, parce qu'elle décide de ce
 * qu'on montre à l'utilisateur.
 *
 * - **Réseau absent, délai dépassé, `429`, `5xx`** : le cycle **s'arrête**, sans
 *   rien reprocher à la mutation. Rien n'est imputable au document — le réseau
 *   est mort ou le serveur est en vrac, et les mutations suivantes échoueraient
 *   pour la même raison. Le compteur ne bouge pas : le sous-sol d'une salle de
 *   sport est le cas d'usage nominal du chantier, y épuiser en cinq lancements
 *   une mutation parfaitement valide afficherait une panne là où il n'y a qu'un
 *   mur de béton.
 * - **`409`, `422`, `403`, et tout autre refus définitif** : le compteur avance,
 *   et on **passe à la suivante**. Le problème est dans ce document-là ; laisser
 *   la mutation en tête de file bloquerait pour toujours les séances des autres
 *   jours. Au cinquième refus elle est marquée, et remontée dans les réglages
 *   (KL-35) — jamais supprimée en silence.
 * - **`401`** : le cycle s'arrête sans rien compter. Le transport a déjà purgé la
 *   session et le garde de navigation a déjà renvoyé sur l'écran de connexion ;
 *   il n'y a plus de jeton, ce n'est pas le document qu'on refuse.
 *
 * ## Ce que le push ne fait jamais
 *
 * Supprimer une mutation qu'il n'a pas vu réussir. C'est l'exigence « rejouée,
 * jamais perdue », et c'est aussi ce qui protège la séance côté pull : tant
 * qu'une entrée est en file, la fenêtre descendante ne peut pas l'écraser
 * (`pull.ts`).
 */

export interface PushReport {
  /** Mutations passées et retirées de la file. */
  pushed: number;
  /** Séances créées côté serveur (un `201`) — le reste était déjà connu. */
  created: number;
  /** Refus définitifs rencontrés pendant ce cycle. */
  rejected: number;
  /** Marquées en file à l'issue du cycle : elles attendent un geste humain. */
  exhausted: number;
  /** Entrées restées en file, pour la raison qu'on vient de rencontrer. */
  remaining: number;
  /** Ce qui a interrompu le cycle, s'il l'a été. */
  interruptedBy: 'network' | 'unauthorized' | null;
  lastError: string | null;
}

/** Dépile la file jusqu'à l'épuiser, ou jusqu'au premier obstacle général. */
export async function pushPending(): Promise<PushReport> {
  const report: PushReport = {
    pushed: 0,
    created: 0,
    rejected: 0,
    exhausted: 0,
    remaining: 0,
    interruptedBy: null,
    lastError: null,
  };

  // L'instantané de départ suffit : une mutation empilée pendant le cycle (une
  // série cochée barre en main) partira au cycle suivant, que le moteur relance
  // de lui-même. Relire la file à chaque tour ferait tourner le push tant que
  // quelqu'un s'entraîne.
  const batch = listMutations().filter((row) => !isExhausted(row));

  for (const mutation of batch) {
    try {
      const outcome = await send(mutation);

      dropMutation(mutation.id);
      report.pushed += 1;

      if (outcome === 'created') {
        report.created += 1;
      }
    } catch (error) {
      const message = describeError(error);

      report.lastError = message;

      if (isUnauthorized(error)) {
        // Rien à compter : la session est fermée, pas le document refusé.
        recordTransientFailure(mutation.id, message);
        report.interruptedBy = 'unauthorized';

        break;
      }

      if (isTransient(error)) {
        recordTransientFailure(mutation.id, message);
        report.interruptedBy = 'network';

        break;
      }

      recordFailure(mutation.id, message);
      report.rejected += 1;
    }
  }

  const left = listMutations();

  report.remaining = left.length;
  report.exhausted = left.filter(isExhausted).length;

  if (report.pushed > 0) {
    await patchSyncState({ lastPushedAt: nowIso() });
  }

  return report;
}

/**
 * Exécute une mutation. Rend ce qui s'est passé, lève ce qui a échoué.
 *
 * Le `DELETE` traite déjà le `404` comme un succès côté client (`@/api`) : une
 * réponse perdue laisserait sinon la mutation bloquée en tête de file pour
 * toujours.
 */
async function send(mutation: MutationRow): Promise<'created' | 'updated' | 'deleted' | 'moot'> {
  const { uuid, exerciseId } = mutation.payload;

  if (exerciseId !== undefined) {
    await sendSetup(exerciseId);

    return 'updated';
  }

  if (uuid === undefined) {
    // Une ligne sans clé ne vient d'aucun chemin d'écriture de l'app. On la
    // retire plutôt que de la laisser bloquer la file pour toujours.
    return 'moot';
  }

  if (mutation.type === 'schedule.delete') {
    await deleteSchedule(uuid);

    return 'deleted';
  }

  const document = readScheduleDocument(uuid, db);

  // La séance n'existe plus localement : la mutation n'a plus d'objet. Ça arrive
  // quand une séance libre est créée puis supprimée hors réseau — la suppression
  // a retiré le `put` de la file (`queue.ts`), mais un cycle déjà commencé peut
  // encore tenir l'ancien instantané. On la retire sans rien envoyer plutôt que
  // d'inventer un document.
  if (document === null) {
    return 'moot';
  }

  return (await putSchedule(uuid, document satisfies ScheduleUpsertInput)).created
    ? 'created'
    : 'updated';
}

/**
 * Pousse le réglage de machine de cet exercice, **tel qu'il est maintenant** en
 * base : le texte est relu au moment du push, comme le document d'une séance.
 * Pas de ligne, c'est un effacement — le `PUT` part avec `null`, et le serveur
 * le rend rejouable.
 *
 * ## Une retouche pendant l'aller-retour
 *
 * Elle réarme la mutation en file, mais c'est **la même ligne** — et le push la
 * retire dès que cet envoi aboutit. Sans rien de plus, la retouche ne partirait
 * jamais : contrairement à une séance, que la clôture réempile, un réglage n'a
 * pas de geste suivant pour le rattraper. D'où la relecture après la réponse, et
 * un nouvel envoi tant que le texte a bougé (borné : on ne tape pas trois fois
 * pendant un `PUT`).
 *
 * L'horodatage rendu par le serveur n'est recopié que sur le texte qu'il décrit.
 */
async function sendSetup(exerciseId: number): Promise<void> {
  const read = () =>
    db
      .select({ text: exerciseSetup.text })
      .from(exerciseSetup)
      .where(eq(exerciseSetup.exerciseId, exerciseId))
      .get()?.text ?? null;

  let sent = read();
  let saved = await putExerciseSetup(exerciseId, sent);

  for (let retries = 0; retries < 2 && read() !== sent; retries += 1) {
    sent = read();
    saved = await putExerciseSetup(exerciseId, sent);
  }

  if (sent !== null && saved.text === sent && read() === sent) {
    db.update(exerciseSetup)
      .set({ updatedAt: saved.updatedAt })
      .where(eq(exerciseSetup.exerciseId, exerciseId))
      .run();
  }
}
