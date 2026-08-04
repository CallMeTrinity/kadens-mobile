/**
 * Ouvrir une séance (KL-28).
 *
 * C'est le seul endroit de l'app qui pose `started_at`, et les deux gestes de
 * l'écran « Aujourd'hui » y aboutissent : démarrer une séance programmée,
 * démarrer une séance libre. Ce qui se passe *dans* la séance est le sujet de
 * KL-29 et suivants.
 *
 * ## Démarrer n'empile aucune mutation, et c'est voulu
 *
 * La règle du dépôt dit : « écrire du réalisé, c'est empiler sa mutation dans la
 * même transaction ». Elle vaut pour le réalisé — une série, une clôture. Ouvrir
 * une séance n'en est pas : rien n'a encore été fait, et le pull sait déjà
 * l'épargner par son **second** critère de protection, « commencée et pas
 * terminée » (`sync/pull.ts`). KL-27 l'écrit noir sur blanc en anticipant ce
 * ticket : « une séance ouverte dont rien n'a été coché n'a pas de mutation ».
 *
 * Le gain n'est pas théorique. Une séance ouverte puis refermée sans rien cocher
 * ne partirait au serveur que pour y afficher un `startedAt` orphelin ; une
 * séance libre créée puis abandonnée apparaîtrait au calendrier web comme une
 * séance vide. Elles partiront à la première série, ou à la clôture (KL-33).
 *
 * ## Ce que démarrer ne change pas
 *
 * Ni la **date** ni le **statut**. Le serveur fait autorité sur la programmation
 * (§4.1 du contrat) : rattraper la veille consiste à ouvrir la séance d'hier, pas
 * à la déplacer à aujourd'hui. Elle restera datée d'hier partout, y compris au
 * calendrier web, ce qui est la vérité de ce qui s'est passé. Le statut, lui, ne
 * bougera qu'à la clôture.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { db, localDate, nowIso, scheduledWorkout, uuidv7 } from '@/db';

import { shortDate } from './days';

/**
 * Ouvre une séance datée, ou reprend celle qui l'était déjà.
 *
 * Rend `false` si elle est introuvable ou **close** : une séance terminée est
 * terminée (§2.3 point 5, « pas de reprise après clôture »). Refaire la même
 * séance dans la journée crée une séance libre, ce n'est pas une reprise.
 *
 * Idempotent : reprendre ne réécrit pas `started_at`, sinon la durée de la séance
 * repartirait de zéro à chaque retour sur l'écran — et la durée est ce que KL-33
 * affichera au résumé.
 */
export function beginWorkout(uuid: string): boolean {
  return db.transaction((tx) => {
    const row = tx
      .select({ startedAt: scheduledWorkout.startedAt, endedAt: scheduledWorkout.endedAt })
      .from(scheduledWorkout)
      .where(eq(scheduledWorkout.uuid, uuid))
      .get();

    if (!row || row.endedAt !== null) {
      return false;
    }

    if (row.startedAt !== null) {
      return true;
    }

    tx.update(scheduledWorkout)
      .set({ startedAt: nowIso() })
      // `started_at is null` dans la clause, en plus de la lecture ci-dessus :
      // la transaction suffirait, mais la condition rend l'écriture juste même
      // si un jour cet appel sortait de sa transaction.
      .where(and(eq(scheduledWorkout.uuid, uuid), isNull(scheduledWorkout.startedAt)))
      .run();

    return true;
  });
}

/**
 * Crée une séance libre et l'ouvre. Rend son uuid.
 *
 * **À la date du jour, toujours** — même si l'écran regarde un jour voisin. C'est
 * ce que dit KL-34 (« démarrage sans prescrit, à la date du jour ») et c'est le
 * seul choix honnête : l'app ne sait rien de ce qui s'est passé hier, elle sait
 * qu'on commence maintenant. Rattraper la veille se fait sur une séance
 * **programmée**, qui existe déjà et porte sa date.
 *
 * L'uuid est posé ici, hors réseau : c'est lui qui rendra le `PUT` idempotent le
 * jour où la séance partira.
 *
 * Ce que ce ticket ne fait pas : la **garnir**. Choisir des exercices dans la
 * bibliothèque locale et les ajouter au fil de la séance est le sujet de KL-34.
 */
export function createFreeWorkout(title?: string): string {
  const uuid = uuidv7();
  const date = localDate();
  const chosen = title?.trim();

  db.insert(scheduledWorkout)
    .values({
      uuid,
      date,
      status: 'planned',
      title: chosen && chosen.length > 0 ? chosen : defaultFreeTitle(date),
      freeform: true,
      startedAt: nowIso(),
      endedAt: null,
      completionNotes: null,
      plan: null,
    })
    .run();

  return uuid;
}

/**
 * Le titre d'une séance libre qu'on n'a pas nommée.
 *
 * Daté, comme KL-34 le prévoit : « Séance libre » tout court est ce que le
 * serveur affiche déjà en dernier recours, et trois séances libres du même mois
 * porteraient le même nom dans la bibliothèque comme au calendrier.
 */
export function defaultFreeTitle(date: string = localDate()): string {
  return `Séance libre du ${shortDate(date)}`;
}
