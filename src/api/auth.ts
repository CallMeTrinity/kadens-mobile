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

import { deviceName } from './device';
import * as endpoints from './endpoints';
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
