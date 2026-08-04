/**
 * La file de mutations (KL-27), vérifiée sur ce qu'elle promet (KL-36).
 *
 * Trois invariants tiennent tout le sens montant, et aucun ne se voit dans les
 * types : la **coalescence par uuid** (dix séries cochées ne font qu'un envoi),
 * la **suppression qui prime sur l'envoi** (pousser une séance qu'on vient de
 * supprimer la recréerait côté serveur), et l'**ordre FIFO strict par `id`**,
 * qu'un `AUTOINCREMENT` SQLite garantit là où un rowid ordinaire réattribuerait
 * un rang libéré.
 */

import { db, mutationQueue } from '@/db';
import { resetDatabase } from '@/test/database';

import {
  dropMutation,
  enqueueScheduleDelete,
  enqueueSchedulePut,
  isExhausted,
  listMutations,
  MAX_ATTEMPTS,
  pendingUuids,
  rearmExhausted,
  recordFailure,
  recordTransientFailure,
} from '../queue';

const A = '01890000-0000-7000-8000-00000000000a';
const B = '01890000-0000-7000-8000-00000000000b';

beforeEach(() => {
  resetDatabase();
});

describe('enqueueSchedulePut', () => {
  it("n'empile qu'une entrée par séance, quel qu'en soit le nombre de séries", () => {
    enqueueSchedulePut(A);
    enqueueSchedulePut(A);
    enqueueSchedulePut(A);

    expect(listMutations()).toHaveLength(1);
  });

  it('réarme une entrée en échec sans la déplacer dans la file', () => {
    enqueueSchedulePut(A);
    enqueueSchedulePut(B);

    const [first] = listMutations();

    recordFailure(first.id, 'document refusé');
    enqueueSchedulePut(A);

    const rows = listMutations();

    expect(rows.map((row) => row.payload.uuid)).toEqual([A, B]);
    expect(rows[0].attempts).toBe(0);
    expect(rows[0].lastError).toBeNull();
  });

  it('ne double pas une suppression en attente : la séance ne se pousse plus', () => {
    enqueueScheduleDelete(A);
    enqueueSchedulePut(A);

    expect(listMutations().map((row) => row.type)).toEqual(['schedule.delete']);
  });
});

describe('enqueueScheduleDelete', () => {
  it("remplace l'envoi en attente de la même séance", () => {
    enqueueSchedulePut(A);
    enqueueSchedulePut(B);
    enqueueScheduleDelete(A);

    const rows = listMutations();

    expect(rows.map((row) => [row.type, row.payload.uuid])).toEqual([
      ['schedule.put', B],
      ['schedule.delete', A],
    ]);
  });
});

describe("l'ordre de la file", () => {
  it("ne réattribue pas le rang d'une mutation retirée", () => {
    enqueueSchedulePut(A);

    const [first] = listMutations();

    dropMutation(first.id);
    enqueueSchedulePut(B);

    const [next] = listMutations();

    // Sans `AUTOINCREMENT`, SQLite reprendrait le rowid libéré et la mutation la
    // plus récente passerait devant celles qui attendent.
    expect(next.id).toBeGreaterThan(first.id);
  });

  it('rend les entrées de la plus ancienne à la plus récente', () => {
    enqueueSchedulePut(B);
    enqueueSchedulePut(A);

    expect(listMutations().map((row) => row.payload.uuid)).toEqual([B, A]);
  });
});

describe('le compteur de tentatives', () => {
  it("marque l'entrée au cinquième refus du serveur", () => {
    enqueueSchedulePut(A);

    const [row] = listMutations();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      recordFailure(row.id, 'document refusé');
    }

    const [after] = listMutations();

    expect(after.attempts).toBe(MAX_ATTEMPTS);
    expect(isExhausted(after)).toBe(true);
  });

  it('ne bouge pas sur un échec passager, mais retient la dernière erreur', () => {
    enqueueSchedulePut(A);

    const [row] = listMutations();

    recordTransientFailure(row.id, 'Serveur injoignable.');

    const [after] = listMutations();

    expect(after.attempts).toBe(0);
    expect(after.lastError).toBe('Serveur injoignable.');
  });

  it('se remet à zéro sur « Réessayer », pour les entrées marquées seulement', () => {
    enqueueSchedulePut(A);
    enqueueSchedulePut(B);

    const [first, second] = listMutations();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      recordFailure(first.id, 'refusé');
    }

    recordFailure(second.id, 'refusé');

    expect(rearmExhausted()).toBe(1);

    const rows = listMutations();

    expect(rows[0].attempts).toBe(0);
    expect(rows[1].attempts).toBe(1);
  });
});

describe('pendingUuids', () => {
  it('compte les entrées marquées : le pull doit les épargner aussi', () => {
    enqueueSchedulePut(A);

    const [row] = listMutations();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      recordFailure(row.id, 'refusé');
    }

    expect(pendingUuids()).toEqual(new Set([A]));
  });
});

describe('la charge utile', () => {
  it("ne porte que l'uuid : le document se relit au moment du push", () => {
    enqueueSchedulePut(A);

    const [row] = db.select().from(mutationQueue).all();

    expect(row.payload).toEqual({ uuid: A });
  });
});
