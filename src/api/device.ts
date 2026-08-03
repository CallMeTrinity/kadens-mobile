/**
 * Le nom d'appareil envoyé à la connexion (KL-25).
 *
 * Il n'a qu'un lecteur, et c'est un humain : la liste des appareils de
 * `/profile/settings`, où il sert à décider **lequel révoquer**. « Appareil
 * Android » sur trois lignes rendrait cette page inutilisable, d'où la cascade
 * ci-dessous — le nom que le propriétaire a donné au téléphone d'abord, la
 * marque et le modèle ensuite.
 *
 * Aucun identifiant matériel n'y entre : ni ANDROID_ID, ni IMEI, ni empreinte de
 * build. Le serveur n'en fait rien, et un jeton révocable suffit déjà à ce qu'un
 * appareil soit distinguable.
 */

import * as Device from 'expo-device';

/** Contrainte de colonne côté serveur : `deviceName` ≤ 100 caractères (§6.1). */
const MAX_LENGTH = 100;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}

/**
 * Le nom à envoyer. Toujours une chaîne non vide : les trois constantes
 * d'`expo-device` sont nullables, et le sont réellement sur certains émulateurs.
 *
 * Le suffixe « (émulateur) » n'est pas décoratif : en développement, plusieurs
 * appairages successifs depuis le même poste produisent des lignes identiques
 * dans `/profile/settings`, et on ne sait plus laquelle est le vrai téléphone.
 */
export function deviceName(): string {
  const named = clean(Device.deviceName);
  const model = [clean(Device.brand), clean(Device.modelName)].filter(Boolean).join(' ');

  const base = named ?? clean(model) ?? 'Appareil Android';
  const full = Device.isDevice ? base : `${base} (émulateur)`;

  return full.length > MAX_LENGTH ? full.slice(0, MAX_LENGTH) : full;
}
