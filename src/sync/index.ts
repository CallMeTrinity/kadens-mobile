/**
 * Point d'entrée du moteur de synchronisation (KL-27).
 *
 * Un écran importe **d'ici** (`@/sync`), jamais d'un fichier précis : même règle
 * que `@/db`, `@/api`, `@/theme` et `@/components`.
 *
 * C'est le seul module de l'app où `@/api` et `@/db` se rencontrent durablement
 * (le layout racine les croise aussi, le temps de restaurer l'URL et le jeton).
 * Cette frontière est voulue : le client HTTP n'ouvre pas SQLite, la base
 * n'appelle pas le réseau, et ce qui les met en rapport tient dans un endroit
 * qu'on peut lire d'un bout à l'autre.
 *
 * Ce qu'il faut savoir avant d'appeler quoi que ce soit :
 *
 * 1. **Le push passe toujours avant le pull.** Le pull remplace la fenêtre de
 *    séances datées ; lancé en premier, il écraserait ce qui n'est pas encore
 *    parti. Il n'y a donc pas de fonction « pull seul » exposée.
 * 2. **Rien ne lève et rien ne bloque.** `syncNow()` rend un rapport, jamais une
 *    exception : ses déclencheurs n'ont personne pour l'attraper. Les écrans
 *    lisent la base locale, qui republie ses lectures vives quand le pull écrit.
 * 3. **Une séance non confirmée par le serveur est intouchable.** Tant qu'une
 *    mutation la concerne, le pull ne l'écrase pas : la base locale fait autorité
 *    sur son réalisé.
 * 4. **Écrire du réalisé, c'est empiler une mutation dans la même transaction.**
 *    `enqueueSchedulePut(uuid, tx)` prend l'exécuteur de l'appelant, et c'est
 *    ainsi qu'il faut l'appeler — sinon une app tuée entre les deux laisse un
 *    réalisé que rien ne signale comme non poussé.
 * 5. **L'état du moteur et l'état persisté sont deux choses.** `useSyncStatus()`
 *    dit ce qui se passe maintenant et repart vide à chaque lancement ;
 *    `useSyncState()` lit ce que `sync_state` garde d'une session à l'autre. Un
 *    écran qui n'aurait lu que le premier annoncerait « jamais synchronisé » sur
 *    une base fraîche (KL-35).
 * 6. **Le contrôle de version est ici pour la même raison que le reste** : il
 *    croise le serveur et la base (`version.ts`, KL-43). Il ne bloque que sous le
 *    plancher déclaré par le serveur, ne bloque jamais faute de réponse, et son
 *    verdict est persisté — sinon il ne tiendrait pas un lancement hors réseau.
 */

export { getSyncStatus, syncNow, useSyncStatus } from './engine';
export type { SyncOutcome, SyncPhase, SyncStatus, SyncTrigger } from './engine';

export { useMutationQueue, useOfflineNotice, useSyncState } from './hooks';
export type { OfflineNotice, QueuedMutation } from './hooks';

export { resyncAll } from './reset';
export type { ResetOutcome, ResetRefusal } from './reset';

export { syncOnWorkoutCancelled, syncOnWorkoutClosed, useSyncTriggers } from './triggers';

export {
  checkAppVersion,
  getAppVersionVerdict,
  installedVersionCode,
  resetAppVersionCheck,
  useAppVersion,
  useAppVersionCheck,
  verdictFor,
} from './version';
export type { AppVersionStatus, AppVersionVerdict } from './version';

export {
  dropMutation,
  enqueueScheduleDelete,
  enqueueSchedulePut,
  isExhausted,
  listMutations,
  MAX_ATTEMPTS,
  pendingUuids,
  rearmExhausted,
} from './queue';

export { readScheduleDocument } from './document';

export type { PullReport } from './pull';
export type { PushReport } from './push';
