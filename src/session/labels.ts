/**
 * Les libellés français du vocabulaire de séance (KL-29).
 *
 * Ce sont les mêmes chaînes que les enums PHP (`SetType::getLabel()`,
 * `BlockRole::getLabel()`, `SetType::letter()`), recopiées et non calculées :
 * l'API transporte des **valeurs** (`warmup`, `cooldown`), pas des libellés, et
 * elle a raison — un libellé qui voyage est un libellé qu'on ne peut plus changer
 * sans invalider les caches des clients. Le prix est cette table, qui doit rester
 * d'accord avec le serveur ; c'est le même arbitrage que les noms de jours de
 * `days.ts`, et pour la même raison (l'app n'a qu'une langue, et aucune i18n
 * prévue).
 */

import type { BlockRole, SetType } from '@/db';

/** « Échauffement », « À l'échec »… `null` pour une série ordinaire, qui n'a rien à signaler. */
export function setTypeLabel(type: SetType): string | null {
  switch (type) {
    case 'warmup':
      return 'Échauffement';
    case 'degressive':
      return 'Dégressive';
    case 'to_failure':
      return "À l'échec";
    case 'drop_set':
      return 'Drop set';
    default:
      return null;
  }
}

/**
 * Le sigle de la pastille de type : W / D / F / DS.
 *
 * `null` pour `normal`, comme sur le web : une série de travail ordinaire est la
 * référence, la marquer reviendrait à marquer tout le tableau. D et DS restent
 * distincts — dégressive et drop set ne sont pas la même chose.
 */
export function setTypeLetter(type: SetType): string | null {
  switch (type) {
    case 'warmup':
      return 'W';
    case 'degressive':
      return 'D';
    case 'to_failure':
      return 'F';
    case 'drop_set':
      return 'DS';
    default:
      return null;
  }
}

/** Une série de travail compte dans le volume ; l'échauffement, jamais. */
export function countsAsWorking(type: SetType): boolean {
  return type !== 'warmup';
}

/** « Échauffement », « Entraînement », « Retour au calme ». */
export function blockRoleLabel(role: BlockRole | null): string {
  switch (role) {
    case 'warmup':
      return 'Échauffement';
    case 'cooldown':
      return 'Retour au calme';
    case 'main':
      return 'Entraînement';
    default:
      // Un bloc sans rôle reste une section de la séance : elle a un numéro et
      // un contenu, il lui faut juste un nom qui ne prétende rien.
      return 'Bloc';
  }
}
