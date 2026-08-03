/**
 * Les trois gestes d'authentification (KL-25) : se connecter, se connecter par
 * QR, se déconnecter.
 *
 * Ils vivent ici et non dans `endpoints.ts` pour une raison de couches :
 * `endpoints.ts` est la transcription du contrat, sans effet de bord ; ces
 * fonctions-là **posent et effacent le jeton**. C'est aussi ce qui évite un
 * cycle d'imports — `session` ne connaît pas le réseau, `endpoints` ne connaît
 * pas la session, et ce fichier connaît les deux.
 */

import { getApiBaseUrl, setApiBaseUrl } from './baseUrl';
import { deviceName } from './device';
import * as endpoints from './endpoints';
import { NetworkError, TimeoutError } from './errors';
import { parsePairingQrPayload } from './pairingQr';
import { attachUser, closeSession, openSession } from './session';
import type { ApiUser } from './types';

/**
 * Connexion par mot de passe. Le nom d'appareil vient d'`expo-device` : personne
 * ne le saisit, et c'est lui qu'on relira dans `/profile/settings` pour décider
 * quoi révoquer.
 */
export async function signInWithPassword(credentials: {
  email: string;
  password: string;
}): Promise<ApiUser> {
  const { token, user } = await endpoints.login({
    email: credentials.email.trim(),
    password: credentials.password,
    deviceName: deviceName(),
  });

  await openSession(token, user);

  return user;
}

/**
 * Connexion par le code du QR d'appairage (KL-48).
 *
 * Le code est normalisé côté serveur (espaces retirés, majuscules) : la saisie
 * manuelle en repli retombe donc sur la même empreinte que le scan. On le
 * normalise quand même ici, pour que ce qui part sur le réseau soit ce qu'on
 * croit envoyer.
 */
export async function signInWithPairingCode(code: string): Promise<ApiUser> {
  const { token, user } = await endpoints.pair({
    code: code.trim().toUpperCase(),
    deviceName: deviceName(),
  });

  await openSession(token, user);

  return user;
}

/**
 * Connexion par la lecture caméra du QR (KL-48).
 *
 * Le QR porte aussi l'URL du serveur (§0.6) : la poser **avant** l'échange est
 * ce qui rend l'app utilisable sans aucune saisie, y compris contre une IP LAN
 * en développement. Si l'URL scannée ne répond pas du tout (réseau, délai),
 * elle est **remise** à ce qu'elle était : un QR illisible ne doit pas stranger
 * la saisie manuelle de repli sur un serveur injoignable pour le reste de la
 * session. Une réponse du serveur qui refuse le code (expiré, déjà consommé)
 * n'est en revanche pas revertie — le serveur a répondu, l'URL est donc bonne.
 *
 * Ne persiste rien en base : `sync_state.apiUrl` est écrit par l'appelant
 * (l'écran d'appairage) après un succès, seul endroit qui connaît à la fois
 * `@/api` et `@/db` pour ce geste — même raison que `baseUrl.ts` n'importe
 * jamais `@/db`.
 */
export async function signInWithPairingQr(rawData: string): Promise<{
  user: ApiUser;
  apiUrl: string;
}> {
  const payload = parsePairingQrPayload(rawData);
  const previousBaseUrl = getApiBaseUrl();

  setApiBaseUrl(payload.url);

  try {
    const user = await signInWithPairingCode(payload.code);

    return { user, apiUrl: payload.url };
  } catch (cause) {
    if (cause instanceof NetworkError || cause instanceof TimeoutError) {
      setApiBaseUrl(previousBaseUrl);
    }

    throw cause;
  }
}

/**
 * Déconnexion.
 *
 * Le jeton local est effacé **quoi qu'il arrive**, même si l'appel de révocation
 * échoue : quelqu'un qui se déconnecte hors réseau doit être déconnecté. Le
 * jeton resté vivant côté serveur se révoque alors depuis `/profile/settings`,
 * et il périmera de lui-même — c'est le compromis, et il penche du bon côté :
 * l'inverse laisserait un jeton utilisable sur un téléphone qu'on croit fermé.
 */
export async function signOut(): Promise<void> {
  try {
    await endpoints.logout();
  } catch {
    // Sans réseau, il n'y a rien à révoquer maintenant. On continue.
  }

  await closeSession('none');
}

/**
 * Complète la session avec le compte, quand une session restaurée n'a que son
 * jeton. C'est aussi la façon la plus courte de vérifier qu'un jeton vaut encore
 * quelque chose : un `401` purge tout seul.
 */
export async function refreshMe(): Promise<ApiUser> {
  const { user } = await endpoints.me();

  attachUser(user);

  return user;
}
