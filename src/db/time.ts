/**
 * Les deux façons d'écrire une date dans Kadens, et la frontière entre elles.
 *
 * Ce n'est pas un détail de confort : c'est la seule protection contre la limite
 * serveur documentée en §KL-19. Un horodatage envoyé avec un décalage autre que
 * `Z` voit son décalage **jeté** et son heure murale relue comme si elle était de
 * l'UTC — deux heures de faux en été, sans la moindre erreur pour le signaler.
 * D'où la règle : **tout instant part en UTC**, et il n'y a qu'un endroit qui le
 * formate.
 */

/**
 * Un **instant** : `2026-08-03T14:32:05.412Z`.
 *
 * `toISOString()` est toujours en UTC, quel que soit le fuseau du téléphone.
 * C'est ce qui va dans `startedAt`, `endedAt`, `completedAt`, `createdAt`.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Une **date de calendrier** : `2026-08-03`.
 *
 * Locale, et c'est voulu : « la séance d'aujourd'hui » est le jour affiché par le
 * téléphone de celui qui s'entraîne, pas celui de Greenwich. Une séance démarrée
 * à 23 h à Lyon appartient à la journée qui se termine, pas à celle qui commence
 * à Londres.
 *
 * `toISOString().slice(0, 10)` serait donc faux ici : c'est exactement le piège
 * que cette fonction existe pour fermer.
 */
export function localDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}
