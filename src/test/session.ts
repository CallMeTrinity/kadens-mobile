/**
 * La session, en test (KL-36).
 *
 * Ouvrir une session passe par `signInWithPassword`, comme dans l'app : c'est
 * le chemin qui pose le jeton dans le magasin sécurisé, publie l'état et rend
 * `getSession().status` égal à `signedIn` — ce que le moteur de synchronisation
 * vérifie avant tout cycle (`sync/engine.ts`). Poser l'état à la main sauterait
 * précisément la partie qu'on veut voir marcher.
 *
 * **Ordre d'appel** : `signIn()` bouchonne `fetch` le temps de la connexion. Un
 * test qui a ses propres routes appelle donc `stubFetch()` **après**.
 */

import { setApiBaseUrl, signInWithPassword, signOut } from '@/api';

import { stubFetch, TEST_API_URL } from './http';

export const TEST_USER = {
  id: 1,
  email: 'athlete@kadens.test',
  roles: ['ROLE_USER'],
  coach: false,
};

/** Ouvre une session sur `TEST_API_URL`. Le jeton est celui que le bouchon rend. */
export async function signIn(): Promise<void> {
  setApiBaseUrl(TEST_API_URL);

  stubFetch({
    'POST /api/auth/login': () => ({
      status: 200,
      body: { token: 'test-token', user: TEST_USER },
    }),
  });

  await signInWithPassword({ email: TEST_USER.email, password: 'motdepasse' });
}

/**
 * Ferme la session. `signOut()` avale l'échec de la révocation, donc marche sans
 * bouchon — c'est le comportement voulu (« se déconnecter hors réseau
 * déconnecte quand même »), et il rend ce raccourci sûr.
 */
export async function signOutForTest(): Promise<void> {
  await signOut();
}
