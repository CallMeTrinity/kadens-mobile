import { asc, eq } from 'drizzle-orm';

import { db, mutationQueue, nowIso, type MutationRow, type Writer } from '@/db';

/**
 * La file de mutations montantes (KL-27).
 *
 * ## Ce qu'une mutation dit, et ce qu'elle ne dit pas
 *
 * Une entrée ne porte **que** l'uuid de la séance concernée : le document se relit
 * en base au moment du push (`document.ts`). Y figer le corps de la requête en
 * ferait une seconde version du réalisé, qui périmerait à la série suivante — et
 * deux versions d'un même fait finissent toujours par diverger. Corollaire utile :
 * une séance modifiée dix fois n'a qu'une entrée dans la file, et c'est la
 * coalescence que KL-29 attend (« inutile d'en empiler une par série »).
 *
 * ## Pourquoi ces fonctions sont synchrones
 *
 * Elles prennent un `Writer` — la base, ou une transaction en cours. Écrire une
 * série et empiler sa mutation doivent tenir dans **la même** transaction :
 * l'app tuée entre les deux laisserait un réalisé que rien ne signale comme non
 * poussé, et le pull suivant, qui remplace la fenêtre, l'effacerait sans un mot.
 * C'est la file, et elle seule, qui porte le fait « modifié localement »
 * (`schema.ts`).
 *
 * ## L'ordre
 *
 * FIFO strict, par `id`, qui est en `AUTOINCREMENT` au sens SQLite : sans lui,
 * une mutation créée après une purge reprendrait un rowid libéré et passerait
 * devant une plus ancienne. Réarmer une entrée existante **ne change pas son
 * rang** : elle décrit toujours la même séance, avancer sa place ferait doubler
 * une séance modifiée en boucle sur celles qui attendent.
 */

/**
 * Cinq échecs **du serveur** et la mutation est marquée, puis remontée dans les
 * réglages (KL-35) au lieu d'être abandonnée en silence.
 *
 * Ce que le compteur ne compte pas est aussi important que ce qu'il compte : un
 * réseau absent, un délai dépassé, un `429` ou un `500` **n'incrémentent rien**
 * (voir `push.ts`). Le sous-sol d'une salle de sport est le cas d'usage nominal
 * du chantier ; y épuiser en cinq lancements une mutation parfaitement valide
 * afficherait une panne là où il n'y a qu'un mur de béton.
 */
export const MAX_ATTEMPTS = 5;

/** Une mutation qu'on ne réessaiera plus seul : elle attend un geste humain. */
export function isExhausted(row: MutationRow): boolean {
  return row.attempts >= MAX_ATTEMPTS;
}

/** Les entrées de la file, de la plus ancienne à la plus récente. */
export function listMutations(writer: Writer = db): MutationRow[] {
  return writer.select().from(mutationQueue).orderBy(asc(mutationQueue.id)).all();
}

/**
 * Les uuids de séances qu'une mutation attend de pousser, épuisées comprises.
 *
 * C'est la liste que le pull consulte avant d'écraser quoi que ce soit : tant
 * que le serveur n'a pas confirmé, la base locale fait autorité sur ces
 * séances-là (`pull.ts`).
 */
export function pendingUuids(writer: Writer = db): Set<string> {
  return new Set(listMutations(writer).map((row) => row.payload.uuid));
}

/**
 * Empile un envoi du document complet de cette séance.
 *
 * **Coalescé par uuid** : une entrée existante est réarmée (compteur et dernière
 * erreur remis à zéro) plutôt que doublée. Le réarmement est voulu — une séance
 * qu'on vient de modifier mérite une nouvelle chance, même si la version
 * précédente s'était fait refuser cinq fois.
 */
export function enqueueSchedulePut(uuid: string, writer: Writer = db): void {
  // Une suppression en attente rend l'envoi caduc : la séance n'existe plus
  // localement, il n'y a pas de document à relire. Ce cas ne devrait pas se
  // produire (on ne modifie pas ce qu'on a supprimé), on ne l'écrase donc pas —
  // le `delete` reste, et le `put` n'est pas empilé.
  const existing = ofUuid(writer, uuid);

  if (existing.some((row) => row.type === 'schedule.delete')) {
    return;
  }

  const put = existing.find((row) => row.type === 'schedule.put');

  if (put) {
    rearm(writer, put.id);

    return;
  }

  insert(writer, 'schedule.put', uuid);
}

/**
 * Empile la suppression d'une séance libre.
 *
 * Elle **remplace** les envois en attente sur la même séance : pousser le
 * document d'une séance qu'on vient de supprimer localement la recréerait côté
 * serveur, et le `DELETE` qui suit dans la file la reperdrait. Deux allers-retours
 * pour revenir au même endroit, avec une fenêtre où le web la montre.
 */
export function enqueueScheduleDelete(uuid: string, writer: Writer = db): void {
  const existing = ofUuid(writer, uuid);

  for (const row of existing) {
    if (row.type === 'schedule.put') {
      writer.delete(mutationQueue).where(eq(mutationQueue.id, row.id)).run();
    }
  }

  const remove = existing.find((row) => row.type === 'schedule.delete');

  if (remove) {
    rearm(writer, remove.id);

    return;
  }

  insert(writer, 'schedule.delete', uuid);
}

/** Retire une entrée : elle est passée, ou elle n'a plus d'objet. */
export function dropMutation(id: number, writer: Writer = db): void {
  writer.delete(mutationQueue).where(eq(mutationQueue.id, id)).run();
}

/** Note un refus du serveur sur cette entrée. Au cinquième, elle est marquée. */
export function recordFailure(id: number, message: string, writer: Writer = db): void {
  const row = writer.select().from(mutationQueue).where(eq(mutationQueue.id, id)).get();

  if (!row) {
    return;
  }

  writer
    .update(mutationQueue)
    .set({ attempts: row.attempts + 1, lastError: message })
    .where(eq(mutationQueue.id, id))
    .run();
}

/**
 * Note un échec qui n'est **pas** imputable au document : réseau, délai, serveur
 * en vrac. La dernière erreur s'affiche, le compteur ne bouge pas.
 */
export function recordTransientFailure(id: number, message: string, writer: Writer = db): void {
  writer.update(mutationQueue).set({ lastError: message }).where(eq(mutationQueue.id, id)).run();
}

/**
 * Réarme toutes les entrées marquées. C'est le geste « Réessayer » des réglages
 * (KL-35) : la seule façon de sortir une mutation de sa cinquième tentative sans
 * la perdre.
 */
export function rearmExhausted(writer: Writer = db): number {
  const rows = listMutations(writer).filter(isExhausted);

  for (const row of rows) {
    rearm(writer, row.id);
  }

  return rows.length;
}

function ofUuid(writer: Writer, uuid: string): MutationRow[] {
  // Le filtre se fait en mémoire : l'uuid vit dans une colonne JSON, et le
  // chercher en SQL demanderait `json_extract`, donc l'extension json1 sur tous
  // les Android qu'on vise. La file est courte par construction (une entrée par
  // séance modifiée), la lire entière ne coûte rien.
  return listMutations(writer).filter((row) => row.payload.uuid === uuid);
}

function insert(writer: Writer, type: MutationRow['type'], uuid: string): void {
  writer
    .insert(mutationQueue)
    .values({ type, payload: { uuid }, attempts: 0, lastError: null, createdAt: nowIso() })
    .run();
}

function rearm(writer: Writer, id: number): void {
  writer
    .update(mutationQueue)
    .set({ attempts: 0, lastError: null })
    .where(eq(mutationQueue.id, id))
    .run();
}
