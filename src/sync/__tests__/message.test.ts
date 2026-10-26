/**
 * Les messages programmés à travers la synchronisation : le pull qui les
 * descend, la fermeture qui empile son « vu », le push qui l'envoie. Même règle
 * que les réglages de machine — tant que le serveur n'a pas confirmé, le
 * téléphone fait autorité.
 */

import { customMessage, db } from '@/db';
import { markMessageSeen, pendingMessageQuery } from '@/session';
import type { CustomMessagePayload } from '@/api';
import { resetDatabase } from '@/test/database';
import { dayFromNow, seedBootstrap } from '@/test/fixtures';
import { callsTo, networkFailure, stubFetch } from '@/test/http';
import { signIn } from '@/test/session';

import { pushPending } from '../push';
import { listMutations, pendingMessages } from '../queue';

const BIRTHDAY = 7;
const CHRISTMAS = 8;

function message(id: number, overrides: Partial<CustomMessagePayload> = {}): CustomMessagePayload {
  return {
    id,
    body: 'Joyeux anniversaire !',
    mediaUrl: `https://kadens.test/media/message/${id}/${'a'.repeat(32)}.gif?_expiration=1&_hash=x`,
    startsOn: dayFromNow(0),
    endsOn: dayFromNow(0),
    ...overrides,
  };
}

function rows() {
  return db.select().from(customMessage).orderBy(customMessage.id).all();
}

function pendingToday() {
  return pendingMessageQuery(dayFromNow(0)).all()[0] ?? null;
}

beforeEach(async () => {
  resetDatabase();
  await signIn();
});

describe('le pull', () => {
  it('descend les messages et remplace la liste', () => {
    seedBootstrap({ messages: [message(BIRTHDAY), message(CHRISTMAS)] });
    expect(rows().map((row) => row.id)).toEqual([BIRTHDAY, CHRISTMAS]);

    // Vu sur le web entre-temps : le serveur ne l'envoie plus, il part d'ici.
    seedBootstrap({ messages: [message(CHRISTMAS)] });
    expect(rows().map((row) => row.id)).toEqual([CHRISTMAS]);
  });

  it('ne touche à rien quand le serveur n’envoie pas la clé', () => {
    seedBootstrap({ messages: [message(BIRTHDAY)] });
    seedBootstrap();

    expect(rows().map((row) => row.id)).toEqual([BIRTHDAY]);
  });

  it('ne ramène pas un message fermé dont le « vu » attend', () => {
    seedBootstrap({ messages: [message(BIRTHDAY)] });
    markMessageSeen(BIRTHDAY);

    seedBootstrap({ messages: [message(BIRTHDAY)] });

    expect(rows()[0]?.seenAt).not.toBeNull();
    expect(pendingToday()).toBeNull();
  });

  it('le remontre quand le serveur le dit de nouveau non vu', () => {
    seedBootstrap({ messages: [message(BIRTHDAY)] });
    db.update(customMessage).set({ seenAt: '2026-10-25T10:00:00.000Z' }).run();

    // Vues remises à zéro dans le back-office, et rien en file.
    seedBootstrap({ messages: [message(BIRTHDAY)] });

    expect(pendingToday()?.id).toBe(BIRTHDAY);
  });
});

describe('le message du jour', () => {
  it('tient les bornes, incluses', () => {
    seedBootstrap({
      messages: [message(CHRISTMAS, { startsOn: dayFromNow(1), endsOn: dayFromNow(3) })],
    });

    expect(pendingMessageQuery(dayFromNow(0)).all()).toEqual([]);
    expect(pendingMessageQuery(dayFromNow(1)).all()[0]?.id).toBe(CHRISTMAS);
    expect(pendingMessageQuery(dayFromNow(3)).all()[0]?.id).toBe(CHRISTMAS);
    expect(pendingMessageQuery(dayFromNow(4)).all()).toEqual([]);
  });

  it('en montre un à la fois, le plus ancien d’abord', () => {
    seedBootstrap({
      messages: [
        message(CHRISTMAS, { startsOn: dayFromNow(0) }),
        message(BIRTHDAY, { startsOn: dayFromNow(-1) }),
      ],
    });

    expect(pendingToday()?.id).toBe(BIRTHDAY);
    markMessageSeen(BIRTHDAY);
    expect(pendingToday()?.id).toBe(CHRISTMAS);
  });
});

describe('le « vu »', () => {
  it('écrit la ligne et empile sa mutation ensemble, une seule fois', () => {
    seedBootstrap({ messages: [message(BIRTHDAY)] });

    expect(markMessageSeen(BIRTHDAY)).toBe(true);
    expect(markMessageSeen(BIRTHDAY)).toBe(false);

    expect(pendingMessages()).toEqual(new Set([BIRTHDAY]));
    expect(listMutations().map((row) => row.type)).toEqual(['message.seen']);
  });

  it('part au serveur et quitte la file', async () => {
    seedBootstrap({ messages: [message(BIRTHDAY)] });
    markMessageSeen(BIRTHDAY);
    stubFetch({ [`PUT /api/messages/${BIRTHDAY}/seen`]: () => ({ status: 204 }) });

    const report = await pushPending();

    expect(report.pushed).toBe(1);
    expect(callsTo('PUT', `/api/messages/${BIRTHDAY}/seen`)).toHaveLength(1);
    expect(listMutations()).toEqual([]);
  });

  it('attend le réseau sans se perdre', async () => {
    seedBootstrap({ messages: [message(BIRTHDAY)] });
    markMessageSeen(BIRTHDAY);
    stubFetch({ [`PUT /api/messages/${BIRTHDAY}/seen`]: networkFailure });

    await pushPending();

    expect(listMutations().map((row) => [row.payload.messageId, row.attempts])).toEqual([
      [BIRTHDAY, 0],
    ]);
  });
});
