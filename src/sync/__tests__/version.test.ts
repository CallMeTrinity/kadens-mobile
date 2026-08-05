/**
 * Le contrôle de version (KL-43), vérifié sur ce qu'il promet (KL-36).
 *
 * Deux choses s'y jouent, et une seule est visible dans les types. La **règle**
 * — quel verdict pour quels nombres — s'éprouve sans base ni réseau. Ce qui
 * demande les deux, c'est la promesse qui donne son sens au plancher : il doit
 * **survivre à un lancement sans réseau**, sinon il ne garde rien. D'où des tests
 * qui coupent le serveur après une réponse, et regardent ce que l'app sait
 * encore.
 */

import { setApiBaseUrl } from '@/api';
import { getSyncState, patchSyncState } from '@/db';
import { resetDatabase } from '@/test/database';
import { networkFailure, stubFetch, TEST_API_URL } from '@/test/http';

import {
  checkAppVersion,
  getAppVersionVerdict,
  resetAppVersionCheck,
  verdictFor,
} from '../version';

const PAYLOAD = {
  versionCode: 42,
  versionName: '1.2.0',
  minimumVersionCode: 40,
  apkUrl:
    'https://github.com/CallMeTrinity/kadens-mobile/releases/download/v1.2.0/kadens-1.2.0-42.apk',
  storeUrl: 'https://store.antoninpamart.fr',
  installUrl: 'https://kadens.antoninpamart.fr/app',
};

beforeEach(() => {
  resetDatabase();
  resetAppVersionCheck();
  setApiBaseUrl(TEST_API_URL);
});

describe('la règle', () => {
  const state = {
    latestVersionCode: 42,
    latestVersionName: '1.2.0',
    minVersionCode: 40,
    installUrl: 'https://kadens.antoninpamart.fr/app',
  };

  it('ne dit rien quand la version installée est la dernière', () => {
    expect(verdictFor(state, 42).status).toBe('ok');
  });

  it('propose une mise à jour au-dessus du plancher', () => {
    expect(verdictFor(state, 41).status).toBe('update');
  });

  it('bloque sous le plancher, et le plancher passe avant la proposition', () => {
    // 39 est à la fois sous le plancher et en retard d'une version : annoncer
    // « mise à jour disponible » laisserait continuer une app qui ne peut plus
    // synchroniser.
    expect(verdictFor(state, 39).status).toBe('blocked');
  });

  it('ne bloque jamais faute de savoir', () => {
    // Aucun appel n'a encore abouti : les colonnes sont nulles.
    expect(verdictFor(null, 1).status).toBe('ok');
    expect(verdictFor({ ...state, minVersionCode: null, latestVersionCode: null }, 1).status).toBe(
      'ok',
    );
  });

  it('ne compare rien en développement', () => {
    // `installedVersionCode()` rend `null` hors APK : le manifeste de Metro porte
    // le `versionCode` d'`app.json`, qui ne décrit aucune version distribuée.
    expect(verdictFor(state, null).status).toBe('ok');
  });

  it('ne bloque ni ne propose tant que rien n’est publié', () => {
    // Zéro est l'élément neutre des deux comparaisons, et c'est l'état du serveur
    // tant qu'aucune release n'existe.
    const nothing = { ...state, latestVersionCode: 0, minVersionCode: 0 };

    expect(verdictFor(nothing, 1).status).toBe('ok');
  });

  it('porte de quoi écrire le bandeau, quel que soit le verdict', () => {
    expect(verdictFor(state, 41)).toEqual({
      status: 'update',
      installed: 41,
      latestVersionName: '1.2.0',
      installUrl: 'https://kadens.antoninpamart.fr/app',
    });
  });
});

describe('le contrôle', () => {
  it('écrit ce que le serveur déclare et publie son verdict', async () => {
    stubFetch({ 'GET /api/app-version': () => ({ status: 200, body: PAYLOAD }) });

    await checkAppVersion(41);

    expect(await getSyncState()).toMatchObject({
      latestVersionCode: 42,
      latestVersionName: '1.2.0',
      minVersionCode: 40,
      installUrl: 'https://kadens.antoninpamart.fr/app',
    });
    expect(getAppVersionVerdict().status).toBe('update');
  });

  it('aboutit sans session ouverte', async () => {
    // Aucune session n'est ouverte ici, et rien n'échoue : `request` refuse
    // d'emblée un appel authentifié sans jeton (`client.ts`), donc cet appel-là
    // ne l'est pas. C'est la preuve indirecte du `auth: false` — l'endpoint est
    // anonyme côté serveur, et l'authenticator se déclenchant sur la seule
    // présence d'un `Bearer`, un jeton périmé le ferait échouer avant le
    // contrôleur, précisément quand l'app a besoin de savoir qu'elle est trop
    // vieille pour se connecter.
    stubFetch({ 'GET /api/app-version': () => ({ status: 200, body: PAYLOAD }) });

    await checkAppVersion(42);

    expect(getAppVersionVerdict().status).toBe('ok');
    expect(await getSyncState()).toMatchObject({ minVersionCode: 40 });
  });

  it('garde le verdict du dernier appel réussi quand le serveur est injoignable', async () => {
    await patchSyncState({
      latestVersionCode: 42,
      latestVersionName: '1.2.0',
      minVersionCode: 40,
      installUrl: 'https://kadens.antoninpamart.fr/app',
    });

    stubFetch({ 'GET /api/app-version': networkFailure });

    await checkAppVersion(39);

    // Le lancement en mode avion d'une app trop vieille : elle sait encore
    // qu'elle l'est.
    expect(getAppVersionVerdict().status).toBe('blocked');
    expect(getAppVersionVerdict().installUrl).toBe('https://kadens.antoninpamart.fr/app');
    expect(await getSyncState()).toMatchObject({ minVersionCode: 40 });
  });

  it('relâche le blocage si le serveur redescend son plancher', async () => {
    await patchSyncState({ minVersionCode: 40, latestVersionCode: 42 });

    stubFetch({
      'GET /api/app-version': () => ({
        status: 200,
        body: { ...PAYLOAD, minimumVersionCode: 30 },
      }),
    });

    await checkAppVersion(39);

    // Un plancher posé par erreur se relâche à la publication suivante : rien à
    // désinstaller, rien à corriger sur le téléphone.
    expect(getAppVersionVerdict().status).toBe('update');
    expect(await getSyncState()).toMatchObject({ minVersionCode: 30 });
  });

  it("n'écrase rien quand le serveur répond une erreur", async () => {
    await patchSyncState({ minVersionCode: 40, latestVersionCode: 42, latestVersionName: '1.2.0' });

    stubFetch({ 'GET /api/app-version': () => ({ status: 500, body: { status: 500 } }) });

    await checkAppVersion(41);

    expect(await getSyncState()).toMatchObject({ minVersionCode: 40, latestVersionCode: 42 });
    expect(getAppVersionVerdict().status).toBe('update');
  });
});
