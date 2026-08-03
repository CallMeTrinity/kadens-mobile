/**
 * L'URL du serveur, en mémoire (KL-25).
 *
 * ## Pourquoi elle n'est pas lue en base à chaque appel
 *
 * L'URL retenue vit dans `sync_state.apiUrl` : elle arrive par le QR
 * d'appairage (KL-48) et doit survivre au redémarrage. Mais la lire à chaque
 * requête ferait dépendre `src/api` de `@/db`, donc de SQLite — un client HTTP
 * qui ouvre une base de données pour savoir où appeler. Elle est donc **injectée
 * une fois** au démarrage, par la couche qui possède déjà la base, et gardée ici.
 *
 * Conséquence à ne pas oublier : `setApiBaseUrl()` ne persiste rien. Qui la
 * change doit aussi écrire `sync_state` (`patchSyncState({ apiUrl })`), sinon le
 * réglage disparaît à la fermeture de l'app.
 *
 * ## Le défaut de développement
 *
 * Tant que rien n'a été appairé, on retombe sur `EXPO_PUBLIC_API_URL`. Ce n'est
 * qu'un confort de développement, et c'est ce qui permet de travailler contre un
 * Symfony local sans scanner quoi que ce soit. En production l'URL vient
 * toujours du QR.
 */

import { API_URL } from '@/config';

/** Retire le `/` final : tous les chemins d'endpoint commencent par un `/`. */
function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

let baseUrl: string | null = API_URL ? normalize(API_URL) : null;

/**
 * L'URL de base, ou `null` si l'app n'a encore rien appairé et qu'aucun défaut
 * de développement n'est configuré. Un appel dans cet état lève, avec un message
 * qui dit quoi faire — pas une requête vers `undefined/api/ping`.
 */
export function getApiBaseUrl(): string | null {
  return baseUrl;
}

/**
 * Pose l'URL du serveur. `null` la remet au défaut de développement, ce qui est
 * exactement ce qu'on veut au désappairage.
 */
export function setApiBaseUrl(url: string | null): void {
  baseUrl = url === null ? (API_URL ? normalize(API_URL) : null) : normalize(url);
}

/**
 * L'URL absolue d'un chemin d'API, avec sa chaîne de requête.
 *
 * Les paramètres `undefined` et `null` sont **omis**, pas envoyés vides : le
 * bootstrap distingue « pas de `since` » (jeu complet) de « `since` illisible »
 * (400), et un `?since=` vide tomberait dans le second cas.
 */
export function buildUrl(path: string, query?: Record<string, string | number | null | undefined>) {
  if (baseUrl === null) {
    throw new Error(
      "Aucune URL de serveur : appaire l'app par le QR, ou pose EXPO_PUBLIC_API_URL en développement.",
    );
  }

  const entries = Object.entries(query ?? {}).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null,
  );

  if (entries.length === 0) {
    return `${baseUrl}${path}`;
  }

  const search = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  return `${baseUrl}${path}?${search}`;
}
