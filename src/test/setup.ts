/**
 * Le socle commun des suites (KL-36).
 *
 * Une seule règle, et c'est un garde-fou plutôt qu'un confort : **aucun test ne
 * part sur le réseau sans l'avoir demandé**. `fetch` est remplacé par une
 * fonction qui échoue en nommant l'appel, et `stubFetch()` (`./http`) est le
 * seul moyen de la remplacer.
 *
 * Ce que ça attrape est précisément ce que le chantier passe son temps à tenir :
 * `@/session` écrit du réalisé **hors réseau** (l'app doit fonctionner dans un
 * sous-sol), et un import mal placé qui ferait partir une requête depuis une
 * écriture locale passerait sinon inaperçu — les tests réussiraient, en
 * s'appuyant sur un serveur qui n'existe pas.
 */

import { restoreFetch } from './http';

beforeEach(() => {
  restoreFetch();
});
