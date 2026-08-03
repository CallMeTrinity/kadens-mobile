/**
 * Le jeton porteur, dans le magasin sécurisé du système (KL-25).
 *
 * ## Pourquoi `expo-secure-store` et jamais `AsyncStorage`
 *
 * `AsyncStorage` est un fichier en clair dans le répertoire de l'app. Sur un
 * appareil rooté, ou dans une sauvegarde `adb backup`, le jeton se lit à l'œil —
 * et il vaut 90 jours d'accès glissants à tout le compte, réalisé compris.
 * `expo-secure-store` le range dans les `SharedPreferences` **chiffrées par
 * l'Android Keystore** : la clé ne sort jamais du matériel sécurisé.
 *
 * ## Ce qui n'est délibérément pas activé
 *
 * `requireAuthentication` (empreinte ou code avant chaque lecture) est refusé.
 * Le jeton est lu par **chaque** requête, y compris par un push de
 * synchronisation qui tourne pendant qu'on est barre en main : demander une
 * empreinte à ce moment-là rendrait la synchronisation impossible, et les
 * variantes synchrones de l'API bloquent le fil JavaScript pendant l'invite. Ce
 * qui protège ici, c'est le chiffrement au repos, pas un geste par requête.
 *
 * ## À savoir sur Android
 *
 * Les valeurs **ne survivent pas à une désinstallation** (contrairement au
 * trousseau iOS). Réinstaller l'app, c'est réappairer — c'est le comportement
 * attendu, et la raison pour laquelle rien d'autre que le jeton n'est stocké
 * ici : la base locale, elle, a son fichier.
 */

import * as SecureStore from 'expo-secure-store';

/**
 * Le service du trousseau. Il doit rester **identique** entre l'écriture et la
 * lecture : une valeur écrite sous un service donné ne se relit pas sans lui.
 * Le changer, c'est déconnecter tout le parc à la mise à jour suivante.
 */
const KEYCHAIN_SERVICE = 'fr.antoninpamart.kadens';

const TOKEN_KEY = 'kadens.api.token';

const OPTIONS: SecureStore.SecureStoreOptions = { keychainService: KEYCHAIN_SERVICE };

/** Le jeton conservé, ou `null`. Une lecture en échec vaut « pas de jeton ». */
export async function readToken(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(TOKEN_KEY, OPTIONS);

    // Une chaîne vide n'est pas un jeton : la traiter comme telle enverrait un
    // en-tête `Bearer ` que le serveur refuserait en 401 à chaque requête.
    return value !== null && value.length > 0 ? value : null;
  } catch {
    // Le magasin peut être indisponible (Keystore verrouillé, entrée corrompue
    // par une restauration). L'app doit alors se comporter comme au premier
    // lancement, pas planter au démarrage.
    return null;
  }
}

export async function writeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, OPTIONS);
}

/**
 * Efface le jeton. **Ne lève jamais** : c'est le geste d'un 401 et d'une
 * déconnexion, deux situations où l'app doit finir de se nettoyer même si le
 * magasin refuse de répondre.
 */
export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY, OPTIONS);
  } catch {
    // Rien à faire de plus : la session en mémoire est purgée par l'appelant, et
    // un jeton resté sur le disque sera écrasé au prochain appairage.
  }
}
