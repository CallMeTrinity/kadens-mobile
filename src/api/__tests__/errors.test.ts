/**
 * Ce que l'app dit d'un échec (KL-38).
 *
 * La règle du ticket est courte — « les erreurs d'API se lisent en français,
 * sans code technique » — et elle est vérifiable, ce qui n'est pas le cas de la
 * plupart des règles de rédaction. Deux choses se testent ici, et rien d'autre :
 *
 * - **aucun message ne porte de code HTTP**, ni de méthode, ni de chemin. C'est
 *   la seule façon de garantir que le repli d'un statut inattendu n'ira pas
 *   afficher « 502 » un jour où le mutualisé tousse ;
 * - **le `detail` du serveur passe devant**, parce qu'il en sait plus que nous
 *   (le contrat le veut français et lisible, `docs/api-mobile.md §1`).
 *
 * Le message brut d'une erreur inconnue, lui, ne doit **plus** sortir : c'est
 * exactement ce qui laissait passer de l'anglais de bibliothèque.
 */

import {
  AbortError,
  ApiError,
  ConfigurationError,
  describeError,
  NetworkError,
  TimeoutError,
} from '@/api';

/** Fabrique une erreur d'API telle que le transport la lève. */
function apiError(status: number, detail: string | null, extra: Partial<ApiError> = {}): ApiError {
  return new ApiError({
    status,
    title: 'Whatever',
    detail,
    method: 'PUT',
    path: '/api/schedule/019fc47d-16e1-7bb4-988f-6d06ce848399',
    violations: extra.violations,
    retryAfterSeconds: extra.retryAfterSeconds,
  });
}

describe('describeError', () => {
  it('préfère le message du serveur, qui en sait plus que nous', () => {
    const message = describeError(apiError(400, 'Code d’appairage invalide ou expiré.'));

    expect(message).toBe('Code d’appairage invalide ou expiré.');
  });

  it('nomme le champ refusé sur un 422, plutôt que le refus générique', () => {
    const message = describeError(
      apiError(422, 'Les données envoyées sont invalides.', {
        violations: [
          {
            field: 'log[0].sets[0].reps',
            message: 'Le nombre de répétitions doit être compris entre 0 et 200.',
          },
        ],
      }),
    );

    expect(message).toBe('Le nombre de répétitions doit être compris entre 0 et 200.');
  });

  it('écrit une phrase française quand le serveur n’a rien dit', () => {
    expect(describeError(apiError(500, null))).toMatch(/^Le serveur a un problème de son côté\./);
    expect(describeError(apiError(401, null))).toMatch(/Reconnecte-toi\.$/);
    expect(describeError(apiError(404, null))).toMatch(/^Introuvable sur le serveur\./);
  });

  it('reprend le délai d’attente d’un 429, en clair', () => {
    expect(describeError(apiError(429, null, { retryAfterSeconds: 45 }))).toContain('dans 45 s');
    expect(describeError(apiError(429, null, { retryAfterSeconds: 90 }))).toContain('dans 2 min');
    expect(describeError(apiError(429, null))).toContain('dans un instant');
  });

  it('ne laisse jamais sortir de code HTTP, de méthode ni de chemin', () => {
    const statuses = [400, 401, 403, 404, 405, 409, 418, 422, 429, 500, 502, 503];

    for (const status of statuses) {
      const message = describeError(apiError(status, null));

      expect(message).not.toMatch(String(status));
      expect(message).not.toMatch('/api/');
      expect(message).not.toMatch('PUT');
    }
  });

  it('dit les deux échecs locaux sans parler de réseau à qui n’a pas de serveur', () => {
    expect(describeError(new NetworkError('GET', '/api/bootstrap', null))).toBe(
      'Serveur injoignable. Vérifie le réseau, ou l’URL de ce serveur.',
    );
    expect(describeError(new TimeoutError('GET', '/api/bootstrap', 15000))).toBe(
      'Le serveur n’a pas répondu à temps.',
    );
    expect(describeError(new ConfigurationError('Aucun serveur appairé.'))).toBe(
      'Aucun serveur appairé.',
    );
    expect(describeError(new AbortError('GET', '/api/bootstrap'))).toBe('Demande interrompue.');
  });

  it('ne rend pas le message brut d’une erreur inconnue', () => {
    const message = describeError(new Error('Network request failed at line 42'));

    expect(message).not.toContain('Network request failed');
    expect(message).toBe('Échec inattendu. Ce qui est consigné sur cet appareil est intact.');
  });
});
