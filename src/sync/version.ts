import Constants from 'expo-constants';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { appVersion } from '@/api';
import { getSyncState, patchSyncState, type SyncStateRow } from '@/db';

/**
 * Le contrôle de version au lancement (KL-43).
 *
 * ## Deux verdicts, deux poids
 *
 * Le serveur déclare deux nombres (`GET /api/app-version`). Le premier est la
 * dernière version **publiée** : au-dessus de la sienne, l'app le **dit** et rien
 * de plus — un bandeau qu'on peut ignorer des semaines, parce qu'on n'interrompt
 * pas une séance pour installer un APK. Le second est le **plancher** : en
 * dessous, l'app s'arrête. C'est la seule porte de sortie prévue si le format de
 * synchronisation change, et elle ne se lève qu'à cette occasion — pas pour
 * pousser une mise à jour de confort.
 *
 * ## Pourquoi le verdict est persisté
 *
 * Parce que sinon il ne vaut rien. Cette app s'ouvre le plus souvent sans réseau
 * : un plancher qui ne tiendrait que le temps d'un appel réussi disparaîtrait
 * exactement là où il protège, et l'app repartirait écrire du réalisé qu'elle ne
 * pourra pas pousser. Les quatre valeurs vivent donc dans `sync_state`
 * (`schema.ts`), et le lancement suivant part de ce qu'on savait.
 *
 * Corollaire dans l'autre sens : un plancher **redescend** aussi. Le serveur
 * garde la main, un blocage posé par erreur se relâche à la publication suivante,
 * sans rien à désinstaller.
 *
 * ## Ce qui ne bloque jamais
 *
 * - **Ne pas savoir.** Tant qu'aucun appel n'a abouti, les colonnes sont nulles
 *   et le verdict est `ok` : « on ignore » n'est pas « c'est trop vieux ».
 * - **Le développement.** Le manifeste servi par Metro porte le `versionCode`
 *   d'`app.json`, c'est-à-dire `1` : dès que le plancher dépasserait cette
 *   valeur, tout build de développement se bloquerait sur une version qui n'a
 *   jamais été distribuée. On ne compare donc que ce qui vient d'un APK.
 */

/** `ok` : rien à dire. `update` : une version plus récente existe. `blocked` : sous le plancher. */
export type AppVersionStatus = 'ok' | 'update' | 'blocked';

export interface AppVersionVerdict {
  status: AppVersionStatus;
  /** Le `versionCode` du binaire installé. `null` en développement — rien n'est alors comparé. */
  installed: number | null;
  /** Le numéro lisible de la dernière version publiée, pour l'écrire au lieu d'un build nu. */
  latestVersionName: string | null;
  /** La page d'installation du site. C'est ce que le bandeau et l'écran de blocage ouvrent. */
  installUrl: string | null;
}

const UNKNOWN: AppVersionVerdict = {
  status: 'ok',
  installed: null,
  latestVersionName: null,
  installUrl: null,
};

let verdict: AppVersionVerdict = UNKNOWN;
let checked = false;

const listeners = new Set<() => void>();

function publish(next: AppVersionVerdict): void {
  verdict = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getAppVersionVerdict(): AppVersionVerdict {
  return verdict;
}

/**
 * Le verdict courant, pour un écran. Même magasin de module que l'état du moteur
 * (`engine.ts`) et que la session : deux écrans qui le lisent lisent la même
 * valeur, et aucun ne relance de contrôle en se montant.
 */
export function useAppVersion(): AppVersionVerdict {
  return useSyncExternalStore(subscribe, getAppVersionVerdict, getAppVersionVerdict);
}

/**
 * Le contrôle lui-même : ce qu'on savait, puis ce que le serveur dit.
 *
 * **Ne lève jamais** — comme le moteur de synchronisation, et pour la même
 * raison : son appelant est un effet de montage, personne n'est là pour
 * rattraper. Un serveur muet laisse simplement le verdict persisté en place.
 *
 * L'ordre compte : on publie d'abord ce que la base garde, pour qu'un lancement
 * hors réseau ait son verdict tout de suite, sans attendre un appel qui n'aboutira
 * pas.
 */
export async function checkAppVersion(
  // Le `versionCode` installé est un paramètre, avec le vrai lecteur pour
  // défaut : sous Jest, `__DEV__` vaut toujours vrai, donc `installedVersionCode()`
  // y rend toujours `null` et la règle ne pourrait être éprouvée nulle part. Le
  // reste de l'app appelle sans argument.
  installed: number | null = installedVersionCode(),
): Promise<void> {
  try {
    publish(verdictFor(await getSyncState(), installed));
  } catch {
    // La base n'est pas lisible : c'est déjà traité ailleurs (le garde de
    // migrations du layout racine), et ce n'est pas à ce contrôle de le dire.
    return;
  }

  try {
    const payload = await appVersion();

    await patchSyncState({
      latestVersionCode: payload.versionCode,
      latestVersionName: payload.versionName,
      minVersionCode: payload.minimumVersionCode,
      installUrl: payload.installUrl,
    });

    publish(
      verdictFor(
        {
          latestVersionCode: payload.versionCode,
          latestVersionName: payload.versionName,
          minVersionCode: payload.minimumVersionCode,
          installUrl: payload.installUrl,
        },
        installed,
      ),
    );
  } catch {
    // Hors réseau, serveur muet, jeton périmé (l'endpoint est anonyme, mais
    // l'URL du serveur peut manquer avant tout appairage) : on garde ce qu'on
    // avait. Le prochain lancement réessaiera.
  }
}

/**
 * Le contrôle au lancement, monté **une fois** dans le layout racine.
 *
 * `enabled` attend que les migrations aient tourné : le verdict se lit en base
 * avant de se demander au serveur. Il n'attend en revanche **pas** la session —
 * un plancher doit se dire à l'écran de connexion aussi, et c'est même là qu'il
 * compte le plus le jour où l'ancien format n'est plus servi.
 *
 * Une seule fois par ouverture d'app : ni au retour au premier plan, ni à chaque
 * cycle de synchronisation. Une version installée ne change pas pendant qu'on
 * s'en sert — Android relance le processus quand l'APK est remplacé.
 */
export function useAppVersionCheck(enabled: boolean): AppVersionVerdict {
  useEffect(() => {
    if (!enabled || checked) {
      return;
    }

    checked = true;
    void checkAppVersion();
  }, [enabled]);

  return useAppVersion();
}

/**
 * La règle, isolée de tout : deux comparaisons et leur ordre.
 *
 * Le plancher passe **avant** la mise à jour disponible, sinon une app à la fois
 * trop vieille et dépassée n'annoncerait que la seconde. Exporté pour être
 * éprouvé sans base ni réseau.
 */
export function verdictFor(
  state: Pick<
    SyncStateRow,
    'latestVersionCode' | 'latestVersionName' | 'minVersionCode' | 'installUrl'
  > | null,
  installed: number | null,
): AppVersionVerdict {
  const known = {
    installed,
    latestVersionName: state?.latestVersionName ?? null,
    installUrl: state?.installUrl ?? null,
  };

  // Rien d'installé à comparer (développement), ou rien de connu du serveur.
  if (installed === null || state === null) {
    return { ...known, status: 'ok' };
  }

  if (state.minVersionCode !== null && installed < state.minVersionCode) {
    return { ...known, status: 'blocked' };
  }

  if (state.latestVersionCode !== null && installed < state.latestVersionCode) {
    return { ...known, status: 'update' };
  }

  return { ...known, status: 'ok' };
}

/**
 * Le `versionCode` du binaire, ou `null` quand il n'y en a pas de vrai.
 *
 * Lu dans le manifeste embarqué (`expo-constants`), comme l'écran de réglages
 * (KL-35) : l'app n'embarque pas `expo-updates`, le manifeste est figé au build.
 * C'est la question que KL-35 laissait ouverte, et la réponse n'a pas changé —
 * pas de module natif de plus pour une valeur déjà là.
 *
 * Figé, mais **pas garanti égal** au `versionCode` du binaire : ce sont deux
 * écritures de la même valeur, par deux chemins (le `prebuild` pour Android, une
 * tâche Gradle d'`expo-constants` pour ce manifeste-ci). La 1.0.0 les a vues
 * diverger — manifeste à `1`, APK à `10` — et l'app s'est bloquée elle-même. Le
 * workflow les recoupe désormais sur l'APK produit, juste après la compilation :
 * c'est là que la garantie se fabrique, pas ici.
 */
export function installedVersionCode(): number | null {
  if (__DEV__) {
    return null;
  }

  const code = Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : null;

  return typeof code === 'number' ? code : null;
}

/** Remet le contrôle à son état de lancement. Réservé aux tests. */
export function resetAppVersionCheck(): void {
  verdict = UNKNOWN;
  checked = false;
}
