/**
 * `expo-notifications` sous Jest (KL-36).
 *
 * Le module vrai **refuse de se charger** dans l'environnement de test : il
 * détecte Expo Go par `Constants.appOwnership`, que le préréglage de `jest-expo`
 * simule, et lève avant même qu'on l'appelle. Toute suite qui importe
 * `@/session` en hérite, puisque `close.ts` tire `rest.ts`.
 *
 * Le double est donc là pour rendre le module **importable**, pas pour vérifier
 * quoi que ce soit. La notification de fin de repos n'entre en base nulle part
 * (KL-31 : le repos ne fait pas partie du réalisé) et n'a rien à dire au serveur
 * — ce qu'elle a d'observable est un canal Android et une vibration, qui se
 * vérifient sur un téléphone, pas ici. La surface reprise est exactement celle
 * qu'appelle `src/session/rest.ts` : y ajouter du vide serait promettre un
 * comportement qu'on ne tient pas.
 */

export const AndroidImportance = { HIGH: 4 } as const;

export const SchedulableTriggerInputTypes = { TIME_INTERVAL: 'timeInterval' } as const;

export function setNotificationHandler(): void {}

export async function setNotificationChannelAsync(): Promise<null> {
  return null;
}

let nextId = 1;

export async function scheduleNotificationAsync(): Promise<string> {
  return `notification-${nextId++}`;
}

export async function cancelScheduledNotificationAsync(): Promise<void> {}

export async function cancelAllScheduledNotificationsAsync(): Promise<void> {}

export async function getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  return { granted: true, canAskAgain: true };
}

export async function requestPermissionsAsync(): Promise<{ granted: boolean }> {
  return { granted: true };
}
