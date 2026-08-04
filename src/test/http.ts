/**
 * Le serveur, en test (KL-36).
 *
 * ## On bouchonne `fetch`, pas `@/api`
 *
 * C'est la décision de ce fichier. Remplacer les endpoints par des espions
 * ferait des tests qui vérifient les espions : plus de timeout, plus de rejeu,
 * plus de taxonomie d'erreurs, plus de `201` contre `200` — c'est-à-dire plus
 * rien de ce qui décide du comportement de la file de mutations. En bouchonnant
 * le transport, tout `src/api` reste dans la boucle et un test de push exerce
 * vraiment `putSchedule`, `ApiError`, `isTransient` et le partage d'autorité du
 * document.
 *
 * ## La réponse est un objet minimal, pas un `Response`
 *
 * `src/api/client.ts` ne lit que `ok`, `status`, `headers.get()` et `text()`.
 * Fabriquer un vrai `Response` demanderait que l'environnement de test en
 * expose un, ce qui n'est garanti ni par Jest ni par le préréglage React
 * Native. Quatre champs suffisent, et ils sont ceux que le client utilise.
 */

/** Un appel observé : de quoi vérifier l'ordre et le corps envoyé. */
export interface RecordedCall {
  method: string;
  /** Chemin et chaîne de requête, sans l'URL de base. */
  path: string;
  /** Corps JSON envoyé, `null` sur un `GET`. */
  body: unknown;
}

export interface StubbedResponse {
  status: number;
  /** Sérialisé en JSON. `undefined` = corps vide (un `204`). */
  body?: unknown;
  headers?: Record<string, string>;
}

/** Ce qu'une route rend : une réponse, ou une panne réseau (`throw`). */
export type RouteHandler = (call: RecordedCall) => StubbedResponse | Promise<StubbedResponse>;

/** L'URL de base des tests. Rien ne l'appelle : `fetch` n'atteint jamais le réseau. */
export const TEST_API_URL = 'https://kadens.test';

let calls: RecordedCall[] = [];

function makeResponse({ status, body, headers = {} }: StubbedResponse): Response {
  const lowered = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Remet le `fetch` qui refuse. Appelé avant chaque test (`./setup`) : une suite
 * qui oublierait de bouchonner échoue en le disant, plutôt que de tomber sur la
 * réponse du test précédent.
 */
export function restoreFetch(): void {
  calls = [];

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.reject(
      new Error(
        `Appel réseau non bouchonné : ${init?.method ?? 'GET'} ${String(input)}. ` +
          'Utilise stubFetch() si ce test doit parler au serveur.',
      ),
    )) as typeof fetch;
}

/**
 * Bouchonne le transport avec une table de routes, clés `"MÉTHODE /chemin"`.
 *
 * Le chemin est comparé **sans** la chaîne de requête, qui reste lisible dans
 * `calls()` : un test de bootstrap vérifie le `?since` sans avoir à déclarer une
 * route par valeur possible.
 *
 * Une route absente n'est pas un `404` : c'est une erreur de test, et elle le
 * dit. Un `404` se déclare, comme le reste.
 *
 * **Poser des routes remet le journal d'appels à zéro.** C'est ce qui permet à
 * un test de faire précéder son scénario d'une mise en place qui parle au
 * serveur (`signIn()`) sans que la connexion vienne polluer les appels qu'il
 * observe.
 */
export function stubFetch(routes: Record<string, RouteHandler>): void {
  calls = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const call: RecordedCall = { method, path: `${url.pathname}${url.search}`, body };

    calls.push(call);

    const handler = routes[`${method} ${url.pathname}`];

    if (!handler) {
      throw new Error(`Aucune route bouchonnée pour ${method} ${url.pathname}.`);
    }

    return makeResponse(await handler(call));
  }) as typeof fetch;
}

/** Les appels observés depuis le début du test, dans l'ordre. */
export function recordedCalls(): RecordedCall[] {
  return calls;
}

/** Les appels d'une route, dans l'ordre. Le chemin se compare sans requête. */
export function callsTo(method: string, path: string): RecordedCall[] {
  return calls.filter((call) => call.method === method && call.path.split('?')[0] === path);
}

/** Une panne réseau : ce que `fetch` lève quand le serveur est injoignable. */
export function networkFailure(): never {
  throw new TypeError('Network request failed');
}
